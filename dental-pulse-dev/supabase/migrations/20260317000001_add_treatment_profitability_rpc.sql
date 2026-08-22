-- RPC function: get_treatment_profitability
-- Matches Dentally income report by using tpi_completed_at date range
-- Location resolution: TPI location_id first, then patient's registered location as fallback
-- This matches Dentally's behavior where location is resolved via patient's site
drop function if exists get_treatment_profitability(uuid, date, date, uuid);

create or replace function get_treatment_profitability(
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
  completed_month text,
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
  select
    t.id as treatment_id,
    t.treatment_name,
    t.treatment_code,
    coalesce(tc.name, '-') as category_name,
    to_char(tpi.tpi_completed_at, 'YYYY-MM') as completed_month,
    count(*)::bigint as no_of_treatments,
    coalesce(sum(tpi.tpi_price), 0) as total_revenue,
    case when count(*) > 0
      then coalesce(sum(tpi.tpi_price), 0) / count(*)
      else 0
    end as avg_income,
    coalesce(t.material_cost, 0) as material_cost,
    coalesce(t.lab_bill, 0) as lab_bill,
    coalesce(t.therapist_pay_rate, 0) as therapist_pay_rate,
    coalesce(t.percent_fees, 0) as percent_fees,
    coalesce(t.finance_fee, 0) as finance_fee,
    coalesce(t.hourly_rate, 0) as hourly_rate,
    coalesce(t.duration_minutes, 0) as duration_minutes
  from
    treatment_plan_items tpi
    join treatments t on (
      t.organization_id = tpi.organization_id
      and t.external_id = tpi.tpi_treatment_id
      and t.deleted_at is null
      and t.is_active = true
    )
    left join treatment_categories tc on (
      tc.organization_id = tpi.organization_id
      and tc.id = t.category_id
      and tc.deleted_at is null
    )
    -- Patient join for location fallback when TPI location_id is NULL
    left join patients pt on (
      pt.organization_id = tpi.organization_id
      and pt.pt_id = tpi.tpi_patient_id
      and pt.deleted_at is null
    )
  where
    tpi.organization_id = p_organization_id
    and tpi.tpi_completed_at is not null
    and tpi.tpi_completed_at::date >= p_from_date
    and tpi.tpi_completed_at::date <= p_to_date
    -- Location filter: TPI location_id first, then patient's registered location as fallback
    and (
      p_location_id is null
      or coalesce(tpi.location_id, pt.location_id) = p_location_id
    )
  group by
    t.id, t.treatment_name, t.treatment_code, tc.name,
    to_char(tpi.tpi_completed_at, 'YYYY-MM'),
    t.material_cost, t.lab_bill, t.therapist_pay_rate,
    t.percent_fees, t.finance_fee, t.hourly_rate, t.duration_minutes
  order by
    total_revenue desc, t.treatment_name, completed_month;
$$;
