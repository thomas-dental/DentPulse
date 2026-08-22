-- ============================================================================
-- Create get_total_distinct_patients RPC function
--
-- Purpose: Count distinct patients from completed appointments by joining
-- directly with active providers filtered by provider_role.
-- No practitioner ID list needed from the frontend.
-- ============================================================================

-- Drop old signatures if they exist
DROP FUNCTION IF EXISTS get_total_distinct_patients(UUID, TIMESTAMPTZ, TIMESTAMPTZ, BIGINT[], UUID);
DROP FUNCTION IF EXISTS get_total_distinct_patients(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT[], UUID);
DROP FUNCTION IF EXISTS get_total_distinct_patients(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, UUID);

CREATE OR REPLACE FUNCTION get_total_distinct_patients(
  p_organization_id UUID,
  p_start_date      TIMESTAMPTZ,
  p_end_date        TIMESTAMPTZ,
  p_provider_type   TEXT DEFAULT NULL,
  p_location_id     UUID DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT COUNT(DISTINCT a.apmt_patient_id)::INTEGER
  FROM appointments a
  JOIN providers p
    ON p.external_id::BIGINT = a.apmt_practitioner_id
   AND p.organization_id     = a.organization_id
   AND p.is_active            = true
   AND p.deleted_at          IS NULL
   AND (
     p_provider_type IS NULL
     OR (
       p_provider_type = 'Other'
       AND p.provider_role NOT IN ('Dentist', 'Therapist', 'Hygienist')
     )
     OR p.provider_role = p_provider_type
   )
  WHERE a.organization_id = p_organization_id
    AND a.apmt_state       = 'Completed'
    AND a.apmt_start_time >= p_start_date
    AND a.apmt_start_time <= p_end_date
    AND a.apmt_patient_id IS NOT NULL
    AND (p_location_id IS NULL OR a.location_id = p_location_id);
$$;

GRANT EXECUTE ON FUNCTION get_total_distinct_patients(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_total_distinct_patients(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, UUID) TO anon;

COMMENT ON FUNCTION get_total_distinct_patients IS
'Returns the count of distinct patients with Completed appointments for active
providers of the given type, within the date range, and optional location.

PARAMETERS:
  p_organization_id - Organization UUID
  p_start_date      - Start of date range (inclusive)
  p_end_date        - End of date range (inclusive)
  p_provider_type   - ''Dentist'', ''Therapist'', ''Hygienist'', ''Other'', or NULL (all types)
  p_location_id     - (optional) Specific location UUID. NULL = all locations.';
