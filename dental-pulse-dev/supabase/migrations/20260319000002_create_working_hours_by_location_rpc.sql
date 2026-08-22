-- RPC: get_provider_working_hours_by_location
--
-- For location-specific working hours, appointment_summary cannot be used because
-- it aggregates ALL locations for a practitioner. This function queries the
-- appointments table directly, filtered by location_id, to return accurate
-- per-location hours matching Dentally's "Total hours" report.

CREATE OR REPLACE FUNCTION get_provider_working_hours_by_location(
  p_organization_id   UUID,
  p_practitioner_ids  BIGINT[],
  p_location_id       UUID,
  p_from_date         DATE,
  p_to_date           DATE
)
RETURNS TABLE (
  practitioner_id       BIGINT,
  month                 DATE,
  working_duration_hours NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    apmt_practitioner_id                        AS practitioner_id,
    DATE_TRUNC('month', apmt_start_time)::DATE  AS month,
    ROUND(SUM(apmt_duration) / 60.0, 2)         AS working_duration_hours
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
