-- ============================================================================
-- get_provider_recent_activity
--
-- Returns the latest N distinct completed TPI items for a single provider.
-- Deduplication uses DATE(tpi_completed_at) — not the full timestamp — so
-- records with the same treatment/patient/day/price but slightly different
-- timestamps (multi-location sync) are treated as one.
-- ============================================================================

CREATE OR REPLACE FUNCTION get_provider_recent_activity(
  p_organization_id  UUID,
  p_practitioner_id  BIGINT,
  p_limit            INTEGER DEFAULT 10,
  p_location_id      UUID    DEFAULT NULL
)
RETURNS TABLE (
  treatment    TEXT,
  patient_name TEXT,
  completed_at TIMESTAMPTZ,
  amount       NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT treatment, patient_name, completed_at, amount
  FROM (
    SELECT DISTINCT ON (
      tpi.tpi_patient_nomenclature,
      tpi.tpi_patient_id,
      tpi.tpi_completed_at::DATE,
      tpi.tpi_price
    )
      tpi.tpi_patient_nomenclature                                               AS treatment,
      TRIM(COALESCE(p.pt_first_name, '') || ' ' || COALESCE(p.pt_last_name, '')) AS patient_name,
      tpi.tpi_completed_at                                                       AS completed_at,
      tpi.tpi_price::NUMERIC                                                     AS amount
    FROM treatment_plan_items tpi
    LEFT JOIN patients p
      ON  p.pt_id           = tpi.tpi_patient_id
      AND p.organization_id = tpi.organization_id
    WHERE tpi.organization_id     = p_organization_id
      AND tpi.tpi_practitioner_id = p_practitioner_id
      AND tpi.tpi_completed        = true
      AND tpi.tpi_completed_at     IS NOT NULL
      AND (p_location_id IS NULL OR tpi.location_id = p_location_id)
    ORDER BY
      tpi.tpi_patient_nomenclature,
      tpi.tpi_patient_id,
      tpi.tpi_completed_at::DATE,
      tpi.tpi_price,
      tpi.tpi_completed_at DESC
  ) deduped
  ORDER BY completed_at DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION get_provider_recent_activity(UUID, BIGINT, INTEGER, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_provider_recent_activity(UUID, BIGINT, INTEGER, UUID) TO anon;

COMMENT ON FUNCTION get_provider_recent_activity IS
'Returns the latest N distinct completed TPI items for a provider.
Deduplication uses DATE(tpi_completed_at) so records with the same
treatment/patient/day/price but different timestamps are treated as one.

PARAMETERS:
  p_organization_id - Organization UUID
  p_practitioner_id - Dentally external practitioner ID
  p_limit           - Max rows to return (default 10)
  p_location_id     - (optional) Filter by location UUID';
