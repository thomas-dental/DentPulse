-- Fix `no_of_treatments` to match Dentally's treatment count.
--
-- Dentally counts one entry per treatment (procedure linked to a TPI) and
-- excludes non-treatment invoice line items (sundries: whitening, brushes,
-- misc charges with no treatment_plan_item_id).
--
-- Previous behaviour summed `qty` across every paid line item, so sundries
-- AND quantity-inflated sundry rows both added to `no_of_treatments`,
-- pushing the count above Dentally's figure even though revenue matched.
--
-- This migration keeps revenue totals untouched (sundry line_amounts still
-- contribute to total_revenue) and keeps the per-treatment `sum(qty)`
-- semantics for rows that ARE linked to a TPI — so Budget.tsx and the
-- Profitability page's `cost_per_unit * count` math remain unchanged for
-- real treatment groups.
drop function if exists get_profitability_invoice_items(uuid, date, date, uuid);

create or replace function get_profitability_invoice_items(
  p_organization_id uuid,
  p_from_date date,
  p_to_date date,
  p_location_id uuid default null
)
returns table (
  treatment_id uuid,
  treatment_name text,
  treatment_code text,
  category_name text,
  paid_month text,
  no_of_treatments bigint,
  total_revenue numeric,
  avg_income numeric,
  material_cost numeric,
  lab_bill numeric,
  therapist_pay_rate numeric,
  percent_fees numeric,
  finance_fee numeric,
  hourly_rate numeric,
  duration_minutes numeric
)
language sql
stable
security definer
as $$
  with line_items_with_treatment as (
    select
      piili.id as line_id,
      case when coalesce(piili.quantity, 0) > 0 then piili.quantity else 1 end as qty,
      piili.line_amount,
      piili.item_name,
      piili.treatment_plan_item_id,
      pii.invoice_date as effective_date,
      t_resolved.id as matched_treatment_id,
      t_resolved.treatment_name as matched_treatment_name,
      t_resolved.treatment_code as matched_treatment_code,
      t_resolved.material_cost as matched_material_cost,
      t_resolved.lab_bill as matched_lab_bill,
      t_resolved.therapist_pay_rate as matched_therapist_pay_rate,
      t_resolved.percent_fees as matched_percent_fees,
      t_resolved.finance_fee as matched_finance_fee,
      t_resolved.hourly_rate as matched_hourly_rate,
      t_resolved.duration_minutes as matched_duration_minutes,
      t_resolved.category_id as matched_category_id
    from
      platform_integration_invoices pii
      join platform_integration_invoice_line_items piili
        on piili.organization_id = pii.organization_id
        and piili.invoice_id = pii.id
      left join lateral (
        select t.*
        from treatment_plan_items tpi
        join treatments t
          on t.organization_id = p_organization_id
          and t.external_id = tpi.tpi_treatment_id::integer
          and t.deleted_at is null
        where tpi.organization_id = p_organization_id
          and piili.treatment_plan_item_id is not null
          and tpi.tpi_id = piili.treatment_plan_item_id::bigint
          and tpi.deleted_at is null
          and tpi.tpi_treatment_id is not null
        order by
          case when t.is_active then 0 else 1 end
        limit 1
      ) t_resolved on true
    where
      pii.organization_id = p_organization_id
      and pii.is_paid = true
      and pii.deleted_at is null
      and pii.invoice_date >= p_from_date
      and pii.invoice_date <= p_to_date
      and (
        p_location_id is null
        or pii.location_id = p_location_id
      )
  )
  select
    li.matched_treatment_id as treatment_id,
    coalesce(li.matched_treatment_name, trim(li.item_name)) as treatment_name,
    coalesce(li.matched_treatment_code, '') as treatment_code,
    coalesce(tc.name, '-') as category_name,
    to_char(li.effective_date, 'YYYY-MM') as paid_month,
    -- Only count rows that link to a TPI (real treatments).
    -- Sundry rows (treatment_plan_item_id IS NULL) contribute 0 to the
    -- count, matching Dentally's treatment-count definition, while still
    -- contributing their line_amount to total_revenue below.
    coalesce(
      sum(li.qty) filter (where li.treatment_plan_item_id is not null),
      0
    )::bigint as no_of_treatments,
    coalesce(sum(li.line_amount), 0) as total_revenue,
    case
      when coalesce(sum(li.qty) filter (where li.treatment_plan_item_id is not null), 0) > 0
      then coalesce(sum(li.line_amount) filter (where li.treatment_plan_item_id is not null), 0)
           / sum(li.qty) filter (where li.treatment_plan_item_id is not null)
      else 0
    end as avg_income,
    coalesce(li.matched_material_cost, 0) as material_cost,
    coalesce(li.matched_lab_bill, 0) as lab_bill,
    coalesce(li.matched_therapist_pay_rate, 0) as therapist_pay_rate,
    coalesce(li.matched_percent_fees, 0) as percent_fees,
    coalesce(li.matched_finance_fee, 0) as finance_fee,
    coalesce(li.matched_hourly_rate, 0) as hourly_rate,
    coalesce(li.matched_duration_minutes, 0) as duration_minutes
  from
    line_items_with_treatment li
    left join treatment_categories tc
      on tc.organization_id = p_organization_id
      and tc.id = li.matched_category_id
      and tc.deleted_at is null
  group by
    li.matched_treatment_id,
    coalesce(li.matched_treatment_name, trim(li.item_name)),
    coalesce(li.matched_treatment_code, ''),
    tc.name,
    to_char(li.effective_date, 'YYYY-MM'),
    li.matched_material_cost, li.matched_lab_bill, li.matched_therapist_pay_rate,
    li.matched_percent_fees, li.matched_finance_fee, li.matched_hourly_rate,
    li.matched_duration_minutes
  order by
    total_revenue desc, treatment_name, paid_month;
$$;
