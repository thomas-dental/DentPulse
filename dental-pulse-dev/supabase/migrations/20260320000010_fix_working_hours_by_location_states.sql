-- Fix get_provider_working_hours_by_location to use same appointment criteria as
-- chart_get_production_metrics (Overview Ranking) so Profit Goals avg daily matches
-- Overview when a specific location is selected.
--
-- Root cause: migration 20260320000003 changed the function to:
--   - 4 states: Completed, Pending, In surgery, Confirmed  (should be 3, no Confirmed)
--   - apmt_patient_id IS NOT NULL                          (should be removed — block/admin
--                                                           slots count as working time)
-- This caused Profit Goals (specific-location path) to return ~375h vs Overview's ~409h.
--
-- Fix: revert to the original 3-state, no-patient-filter criteria from
-- 20260319000002 while keeping the rounding improvement from 20260320000003
-- (SUM without intermediate ROUND to avoid month-by-month accumulation errors).

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
    AND apmt_state            IN ('Completed', 'Pending', 'In surgery')
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
