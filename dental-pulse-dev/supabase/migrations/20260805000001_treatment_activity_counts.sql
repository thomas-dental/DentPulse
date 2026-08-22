-- ============================================================================
-- get_treatment_activity_counts: Treatment Insights Patients / Treatment
-- Volume tiles in ONE query.
--
-- The frontend previously downloaded every qualifying treatment_plan_items row
-- (current + previous period, ~60k+ rows for a year window) through paginated
-- 1000-row requests just to COUNT rows and DISTINCT patients — the main reason
-- the Treatment Insights tiles render tens of seconds after the page loads.
--
-- Row rules MIRROR the reconciled Dentally Practitioner Activity export set
-- (verified 2026-08-04, Old Surgery 01 Apr 2025 – 31 Mar 2026: 33,601 rows /
-- 6,676 patients): completed TPIs, deleted_at IS NULL, appointment-linked
-- (charting gate), Europe/London completed dates, tpi.location_id site filter
-- with NULL kept, NO practitioner / payment-plan / price filters. Any change
-- here must match useTreatmentInsights' activityCounts fallback scan.
-- ============================================================================

CREATE OR REPLACE FUNCTION get_treatment_activity_counts(
  p_organization_id UUID,
  p_start           DATE,   -- current window start (London date, inclusive)
  p_end             DATE,   -- current window end   (London date, inclusive)
  p_prev_start      DATE,   -- previous window start; previous window = [p_prev_start, p_start)
  p_location_ids    UUID[] DEFAULT NULL  -- NULL = all locations
)
RETURNS TABLE (
  curr_volume   BIGINT,
  curr_patients BIGINT,
  prev_volume   BIGINT,
  prev_patients BIGINT
)
LANGUAGE plpgsql
AS $$
BEGIN
  SET LOCAL statement_timeout = '60s';

  RETURN QUERY
  WITH rows AS (
    SELECT
      (tpi.tpi_completed_at AT TIME ZONE 'Europe/London')::DATE AS d,
      tpi.tpi_patient_id                                        AS pat
    FROM treatment_plan_items tpi
    WHERE tpi.organization_id = p_organization_id
      AND tpi.tpi_completed   = true
      AND tpi.tpi_completed_at IS NOT NULL
      AND tpi.deleted_at      IS NULL
      AND tpi.tpi_treatment_appointment_id IS NOT NULL
      AND (p_location_ids IS NULL OR tpi.location_id = ANY(p_location_ids) OR tpi.location_id IS NULL)
      AND (tpi.tpi_completed_at AT TIME ZONE 'Europe/London')::DATE >= p_prev_start
      AND (tpi.tpi_completed_at AT TIME ZONE 'Europe/London')::DATE <= p_end
  )
  SELECT
    COUNT(*)            FILTER (WHERE rows.d >= p_start),
    COUNT(DISTINCT pat) FILTER (WHERE rows.d >= p_start),
    COUNT(*)            FILTER (WHERE rows.d < p_start),
    COUNT(DISTINCT pat) FILTER (WHERE rows.d < p_start)
  FROM rows;
END;
$$;

GRANT EXECUTE ON FUNCTION get_treatment_activity_counts(UUID, DATE, DATE, DATE, UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION get_treatment_activity_counts(UUID, DATE, DATE, DATE, UUID[]) TO anon;
