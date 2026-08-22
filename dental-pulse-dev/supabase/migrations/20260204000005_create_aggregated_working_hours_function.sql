-- Create aggregated working hours function that returns monthly totals
-- This avoids the 1000-row limit by doing aggregation in the database

CREATE OR REPLACE FUNCTION get_provider_working_hours_monthly(
  p_organization_id UUID,
  p_from_date DATE,
  p_to_date DATE,
  p_practitioner_id INTEGER
)
RETURNS TABLE (
  month TEXT,  -- 'Jan-25', 'Feb-25', etc.
  appointment_count BIGINT,
  total_hours NUMERIC
)
LANGUAGE plpgsql
AS $$
BEGIN
  SET LOCAL statement_timeout = '60s';

  -- Return aggregated monthly working hours from appointments
  RETURN QUERY
  SELECT
    TO_CHAR(DATE_TRUNC('month', apmt_start_time), 'Mon-YY') AS month,
    COUNT(*) AS appointment_count,
    ROUND(SUM(apmt_duration) / 60.0, 1) AS total_hours
  FROM appointments
  WHERE organization_id = p_organization_id
    AND apmt_practitioner_id = p_practitioner_id
    AND apmt_state = 'Completed'
    AND apmt_start_time::DATE BETWEEN p_from_date AND p_to_date
    AND apmt_duration IS NOT NULL
    AND apmt_patient_name IS NOT NULL
  GROUP BY TO_CHAR(DATE_TRUNC('month', apmt_start_time), 'Mon-YY'), DATE_TRUNC('month', apmt_start_time)
  ORDER BY DATE_TRUNC('month', apmt_start_time);
END;
$$;

COMMENT ON FUNCTION get_provider_working_hours_monthly IS
'Optimized function that returns pre-aggregated monthly working hours from appointments.
Avoids the 1000-row limit by doing aggregation in the database.
Returns one row per month with appointment count and total hours.';
