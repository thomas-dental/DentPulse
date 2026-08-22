-- Chair Efficiency Engine table data source.
--
-- Returns one row per (invoice date, treatment) from PAID invoice line items,
-- with the units sold, revenue, and the resolved treatment's configured
-- duration. The frontend derives:
--   Total Time (mins)              = duration × units
--   Current Chair Time Occupied (h) = Total Time / 60
--
-- This mirrors get_profitability_invoice_items exactly (same source tables,
-- same paid-invoice + invoice_date filter, same TPI→treatment lateral resolve)
-- but groups by DAY instead of month and exposes SUM(quantity) as "units" for
-- ALL line items — including sundries (toothbrushes, whitening, etc.), which is
-- what the Chair Efficiency table shows. Sundries have no treatment_plan_item_id
-- so they resolve to duration 0 and use the invoice item_name as the label.
--
-- SECURITY DEFINER: the invoice line-item table's RLS otherwise blocks client
-- reads (same reason the profitability RPC is definer).

drop function if exists get_chair_efficiency_treatments(uuid, date, date, uuid);

create or replace function get_chair_efficiency_treatments(
  p_organization_id uuid,
  p_from_date date,
  p_to_date date,
  p_location_id uuid default null
)
returns table (
  item_date date,
  treatment_id uuid,
  treatment_name text,
  units numeric,
  total_income numeric,
  duration_minutes numeric
)
language sql
stable
security definer
as $$
  with line_items_with_treatment as (
    select
      case when coalesce(piili.quantity, 0) > 0 then piili.quantity else 1 end as qty,
      piili.line_amount,
      piili.item_name,
      pii.invoice_date::date as effective_date,
      t_resolved.id as matched_treatment_id,
      t_resolved.treatment_name as matched_treatment_name,
      t_resolved.duration_minutes as matched_duration_minutes
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
    li.effective_date as item_date,
    li.matched_treatment_id as treatment_id,
    coalesce(li.matched_treatment_name, trim(li.item_name)) as treatment_name,
    sum(li.qty)::numeric as units,
    coalesce(sum(li.line_amount), 0) as total_income,
    coalesce(li.matched_duration_minutes, 0) as duration_minutes
  from
    line_items_with_treatment li
  group by
    li.effective_date,
    li.matched_treatment_id,
    coalesce(li.matched_treatment_name, trim(li.item_name)),
    li.matched_duration_minutes
  order by
    li.effective_date desc, treatment_name;
$$;

grant execute on function get_chair_efficiency_treatments(uuid, date, date, uuid) to authenticated;
