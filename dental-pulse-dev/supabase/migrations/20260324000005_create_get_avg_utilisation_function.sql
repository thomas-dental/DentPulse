-- ============================================================================
-- Create get_avg_utilisation RPC function
--
-- Formula:
--   Utilisation (%) =
--     SUM(apmt_duration for active providers of given type)
--     ─────────────────────────────────────────────────────── × 100
--     COUNT(unique active providers) × working_days × hours_per_day × 60
--
-- Fixes vs previous JS approach:
--   - Joins directly with providers by role (no ID list from frontend)
--   - Uses org's open_hours_per_day (not hardcoded 8)
--   - Includes all 4 appointment states: Completed, Pending, In surgery, Confirmed
--   - Adds apmt_patient_id IS NOT NULL (excludes admin/block slots)
--   - Deduplicates providers by email for accurate provider count
-- ============================================================================

CREATE OR REPLACE FUNCTION get_avg_utilisation(
  p_organization_id UUID,
  p_start_date      TIMESTAMPTZ,
  p_end_date        TIMESTAMPTZ,
  p_provider_type   TEXT DEFAULT NULL,
  p_location_id     UUID DEFAULT NULL
)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_hours_per_day  NUMERIC;
  v_total_minutes  NUMERIC;
  v_provider_count INTEGER;
  v_working_days   INTEGER;
BEGIN
  -- Get org hours per day setting
  SELECT COALESCE(NULLIF(open_hours_per_day, 0), 8)
  INTO v_hours_per_day
  FROM organizations
  WHERE id = p_organization_id;

  IF v_hours_per_day IS NULL THEN v_hours_per_day := 8; END IF;

  -- Count unique active providers of the given type (deduplicated by email)
  SELECT COUNT(DISTINCT LOWER(COALESCE(NULLIF(TRIM(email), ''), name)))
  INTO v_provider_count
  FROM providers
  WHERE organization_id = p_organization_id
    AND is_active        = true
    AND deleted_at       IS NULL
    AND (
      p_provider_type IS NULL
      OR (p_provider_type = 'Other' AND provider_role NOT IN ('Dentist', 'Therapist', 'Hygienist'))
      OR provider_role = p_provider_type
    );

  IF v_provider_count = 0 THEN RETURN 0; END IF;

  -- Count Mon–Fri working days in the date range
  SELECT COUNT(*)
  INTO v_working_days
  FROM generate_series(p_start_date::DATE, p_end_date::DATE, '1 day'::interval) AS d
  WHERE EXTRACT(DOW FROM d) NOT IN (0, 6);

  IF v_working_days = 0 THEN RETURN 0; END IF;

  -- Sum appointment minutes (all 4 active states, patient only, joined with active providers)
  SELECT COALESCE(SUM(a.apmt_duration), 0)
  INTO v_total_minutes
  FROM appointments a
  JOIN providers p
    ON p.external_id::BIGINT = a.apmt_practitioner_id
   AND p.organization_id     = a.organization_id
   AND p.is_active            = true
   AND p.deleted_at          IS NULL
   AND (
     p_provider_type IS NULL
     OR (p_provider_type = 'Other' AND p.provider_role NOT IN ('Dentist', 'Therapist', 'Hygienist'))
     OR p.provider_role = p_provider_type
   )
  WHERE a.organization_id = p_organization_id
    AND a.apmt_state       IN ('Completed', 'Pending', 'In surgery', 'Confirmed')
    AND a.apmt_start_time >= p_start_date
    AND a.apmt_start_time <= p_end_date
    AND a.apmt_duration   IS NOT NULL
    AND a.apmt_patient_id IS NOT NULL
    AND a.deleted_at      IS NULL
    AND (p_location_id IS NULL OR a.location_id = p_location_id);

  -- Return utilisation % capped at 100
  RETURN LEAST(
    ROUND(
      (v_total_minutes / (v_provider_count::NUMERIC * v_working_days * v_hours_per_day * 60)) * 100,
      1
    ),
    100
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_avg_utilisation(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_avg_utilisation(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, UUID) TO anon;

COMMENT ON FUNCTION get_avg_utilisation IS
'Returns chair utilisation % for active providers of the given type.

PARAMETERS:
  p_organization_id - Organization UUID
  p_start_date      - Start of date range (inclusive)
  p_end_date        - End of date range (inclusive)
  p_provider_type   - ''Dentist'', ''Therapist'', ''Hygienist'', ''Other'', or NULL (all)
  p_location_id     - (optional) Specific location UUID. NULL = all locations.';
