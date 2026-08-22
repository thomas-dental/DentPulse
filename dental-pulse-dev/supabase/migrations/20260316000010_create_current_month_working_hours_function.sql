-- Function to get current month working hours (Completed + Pending) aggregated per practitioner.
-- Called instead of fetching raw appointment rows to avoid Supabase's 1000-row default limit.
CREATE OR REPLACE FUNCTION get_current_month_working_hours(
  p_organization_id   UUID,
  p_practitioner_ids  BIGINT[],
  p_start_date        DATE,
  p_end_date          DATE
)
RETURNS TABLE (
  practitioner_id BIGINT,
  total_minutes   NUMERIC
)
LANGUAGE plpgsql
AS $$
BEGIN
  SET LOCAL statement_timeout = '30s';

  RETURN QUERY
  SELECT
    a.apmt_practitioner_id AS practitioner_id,
    SUM(a.apmt_duration)::NUMERIC AS total_minutes
  FROM appointments a
  WHERE a.organization_id       = p_organization_id
    AND a.apmt_practitioner_id  = ANY(p_practitioner_ids)
    AND a.apmt_state            IN ('Completed', 'Pending')
    AND a.apmt_start_time::DATE BETWEEN p_start_date AND p_end_date
    AND a.apmt_duration         IS NOT NULL
    AND a.apmt_patient_id       IS NOT NULL
    AND a.deleted_at            IS NULL
  GROUP BY a.apmt_practitioner_id;
END;
$$;

GRANT EXECUTE ON FUNCTION get_current_month_working_hours(UUID, BIGINT[], DATE, DATE) TO authenticated;
