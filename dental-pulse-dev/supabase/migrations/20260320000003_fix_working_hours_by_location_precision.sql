-- Fix get_provider_working_hours_by_location: remove intermediate SQL rounding.
--
-- Previously ROUND(SUM(apmt_duration)/60.0, N) per month accumulated rounding errors
-- across months, causing avg daily production in Profit Goals to differ from Overview
-- (chart_get_production_metrics) which sums raw minutes in one full-period query.
--
-- Since SUM is distributive:
--   SUM(monthly_raw_hours) == full_period_raw_hours  (exact, no accumulation error)
--
-- Display rounding (1dp) is handled in the TypeScript hook, not here.

CREATE OR REPLACE FUNCTION get_provider_working_hours_by_location(
  p_organization_id   UUID,
  p_practitioner_ids  BIGINT[],
  p_location_id       UUID,
  p_from_date         DATE,
  p_to_date           DATE
)
RETURNS TABLE (
  practitioner_id        BIGINT,
  month                  DATE,
  working_duration_hours NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    apmt_practitioner_id                          AS practitioner_id,
    DATE_TRUNC('month', apmt_start_time)::DATE    AS month,
    SUM(apmt_duration)::NUMERIC / 60.0            AS working_duration_hours
  FROM appointments
  WHERE organization_id       = p_organization_id
    AND apmt_practitioner_id  = ANY(p_practitioner_ids)
    AND location_id           = p_location_id
    AND apmt_state            IN ('Completed', 'Pending', 'In surgery', 'Confirmed')
    AND apmt_duration         IS NOT NULL
    AND apmt_patient_id       IS NOT NULL
    AND apmt_start_time       IS NOT NULL
    AND deleted_at            IS NULL
    AND apmt_start_time::DATE >= p_from_date
    AND apmt_start_time::DATE <= p_to_date
  GROUP BY
    apmt_practitioner_id,
    DATE_TRUNC('month', apmt_start_time)::DATE
$$;

GRANT EXECUTE ON FUNCTION get_provider_working_hours_by_location TO authenticated;
GRANT EXECUTE ON FUNCTION get_provider_working_hours_by_location TO anon;
