-- ============================================================================
-- Provider KPI RPC functions for the detail page
--
-- 1. get_provider_kpi_patients — returns current_patients, new_patients,
--    recall_rate for a single provider (by external practitioner ID)
--
-- 2. get_provider_utilisation — returns utilisation % for a single provider
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. get_provider_kpi_patients
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_provider_kpi_patients(
  p_organization_id  UUID,
  p_practitioner_id  BIGINT,
  p_start_date       TIMESTAMPTZ,
  p_end_date         TIMESTAMPTZ,
  p_history_months   INTEGER  DEFAULT 24,
  p_location_id      UUID     DEFAULT NULL
)
RETURNS TABLE (
  current_patients  INTEGER,
  new_patients      INTEGER,
  recall_rate       NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  WITH current_period AS (
    SELECT DISTINCT apmt_patient_id
    FROM   appointments
    WHERE  organization_id      = p_organization_id
      AND  apmt_practitioner_id = p_practitioner_id
      AND  apmt_state           = 'Completed'
      AND  apmt_start_time     >= p_start_date
      AND  apmt_start_time     <= p_end_date
      AND  apmt_patient_id      IS NOT NULL
      AND  deleted_at           IS NULL
      AND  (p_location_id IS NULL OR location_id = p_location_id)
  ),
  history AS (
    SELECT DISTINCT apmt_patient_id
    FROM   appointments
    WHERE  organization_id      = p_organization_id
      AND  apmt_practitioner_id = p_practitioner_id
      AND  apmt_state           = 'Completed'
      AND  apmt_start_time     >= (p_start_date - (p_history_months || ' months')::INTERVAL)
      AND  apmt_start_time      < p_start_date
      AND  apmt_patient_id      IS NOT NULL
      AND  deleted_at           IS NULL
  ),
  counts AS (
    SELECT
      COUNT(*)::INTEGER                                            AS total,
      COUNT(*) FILTER (WHERE cp.apmt_patient_id NOT IN (SELECT apmt_patient_id FROM history))::INTEGER AS new_cnt,
      COUNT(*) FILTER (WHERE cp.apmt_patient_id     IN (SELECT apmt_patient_id FROM history))::INTEGER AS returning_cnt
    FROM current_period cp
  )
  SELECT
    total                                                          AS current_patients,
    new_cnt                                                        AS new_patients,
    CASE WHEN total > 0 THEN ROUND(returning_cnt::NUMERIC / total * 100, 0) ELSE 0 END AS recall_rate
  FROM counts;
$$;

GRANT EXECUTE ON FUNCTION get_provider_kpi_patients(UUID, BIGINT, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_provider_kpi_patients(UUID, BIGINT, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, UUID) TO anon;

COMMENT ON FUNCTION get_provider_kpi_patients IS
'Returns patient KPIs for a single provider (by Dentally external practitioner ID).

RETURNS:
  current_patients - distinct patients with Completed appts in the date range
  new_patients     - patients in current range with no prior appointment (up to p_history_months back)
  recall_rate      - returning patients / total × 100

PARAMETERS:
  p_organization_id - Organization UUID
  p_practitioner_id - Dentally external practitioner ID (apmt_practitioner_id)
  p_start_date      - Start of date range (inclusive)
  p_end_date        - End of date range (inclusive)
  p_history_months  - How far back to look for prior visits (default 24)
  p_location_id     - (optional) filter by location UUID';


-- ----------------------------------------------------------------------------
-- 2. get_provider_utilisation
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_provider_utilisation(
  p_organization_id  UUID,
  p_practitioner_id  BIGINT,
  p_start_date       TIMESTAMPTZ,
  p_end_date         TIMESTAMPTZ,
  p_location_id      UUID DEFAULT NULL
)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_hours_per_day  NUMERIC;
  v_total_minutes  NUMERIC;
  v_working_days   INTEGER;
BEGIN
  -- Org hours per day setting
  SELECT COALESCE(NULLIF(open_hours_per_day, 0), 8)
  INTO   v_hours_per_day
  FROM   organizations
  WHERE  id = p_organization_id;

  IF v_hours_per_day IS NULL THEN v_hours_per_day := 8; END IF;

  -- Mon–Fri working days in range
  SELECT COUNT(*)
  INTO   v_working_days
  FROM   generate_series(p_start_date::DATE, p_end_date::DATE, '1 day'::INTERVAL) AS d
  WHERE  EXTRACT(DOW FROM d) NOT IN (0, 6);

  IF v_working_days = 0 THEN RETURN 0; END IF;

  -- Sum appointment minutes
  SELECT COALESCE(SUM(apmt_duration), 0)
  INTO   v_total_minutes
  FROM   appointments
  WHERE  organization_id      = p_organization_id
    AND  apmt_practitioner_id = p_practitioner_id
    AND  apmt_state           IN ('Completed', 'Pending', 'In surgery', 'Confirmed')
    AND  apmt_start_time     >= p_start_date
    AND  apmt_start_time     <= p_end_date
    AND  apmt_duration        IS NOT NULL
    AND  apmt_patient_id      IS NOT NULL
    AND  deleted_at           IS NULL
    AND  (p_location_id IS NULL OR location_id = p_location_id);

  RETURN LEAST(
    ROUND(
      (v_total_minutes / (v_working_days::NUMERIC * v_hours_per_day * 60)) * 100,
      1
    ),
    100
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_provider_utilisation(UUID, BIGINT, TIMESTAMPTZ, TIMESTAMPTZ, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_provider_utilisation(UUID, BIGINT, TIMESTAMPTZ, TIMESTAMPTZ, UUID) TO anon;

COMMENT ON FUNCTION get_provider_utilisation IS
'Returns utilisation % for a single provider (by Dentally external practitioner ID).

Formula: SUM(apmt_duration) / (working_days × hours_per_day × 60) × 100, capped at 100.

PARAMETERS:
  p_organization_id - Organization UUID
  p_practitioner_id - Dentally external practitioner ID (apmt_practitioner_id)
  p_start_date      - Start of date range (inclusive)
  p_end_date        - End of date range (inclusive)
  p_location_id     - (optional) filter by location UUID';
