-- Add duration_minutes (raw integer) to get_provider_working_hours_by_location.
--
-- Root cause of sub-£1 avg daily production decimal mismatch between Overview and
-- Profit Goals: TypeScript sums 11 monthly (SUM_minutes/60.0) float64 values, each
-- incurring a rounding error. Overview does one big SUM/60/hours_per_day in SQL —
-- one rounding event instead of 11.
--
-- Fix: return SUM(apmt_duration) as duration_minutes (BIGINT, exact integer arithmetic).
-- TypeScript accumulates integer minutes across months, then divides by 60.0 once —
-- identical to Overview's single-query approach.

-- Must drop first because return type is changing (adding duration_minutes column)
DROP FUNCTION IF EXISTS get_provider_working_hours_by_location(UUID, BIGINT[], UUID, DATE, DATE);

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
  working_duration_hours NUMERIC,
  duration_minutes       BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    apmt_practitioner_id                          AS practitioner_id,
    DATE_TRUNC('month', apmt_start_time)::DATE    AS month,
    SUM(apmt_duration)::NUMERIC / 60.0            AS working_duration_hours,
    SUM(apmt_duration)::BIGINT                    AS duration_minutes
  FROM appointments
  WHERE organization_id       = p_organization_id
    AND apmt_practitioner_id  = ANY(p_practitioner_ids)
    AND location_id           = p_location_id
    AND apmt_state            IN ('Completed', 'Pending', 'In surgery', 'Confirmed')
    AND apmt_duration         IS NOT NULL
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
