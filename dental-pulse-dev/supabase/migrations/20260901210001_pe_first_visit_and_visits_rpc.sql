-- PE growth levers / patient list — aggregate appointments without JS pagination

CREATE OR REPLACE FUNCTION public.pe_first_completed_visit_by_pt(
  p_practice_id UUID,
  p_location_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    jsonb_object_agg(apmt_patient_id::text, min_date),
    '{}'::jsonb
  )
  FROM (
    SELECT
      a.apmt_patient_id,
      MIN(a.apmt_completed_at::date) AS min_date
    FROM public.appointments a
    WHERE a.organization_id = p_practice_id
      AND a.apmt_patient_id IS NOT NULL
      AND (
        a.apmt_completed_at IS NOT NULL
        OR LOWER(BTRIM(COALESCE(a.apmt_state, ''))) = 'completed'
      )
      AND LOWER(BTRIM(COALESCE(a.apmt_state, ''))) NOT IN (
        'cancelled', 'did not attend', 'dna'
      )
      AND a.apmt_completed_at IS NOT NULL
      AND (p_location_id IS NULL OR a.location_id = p_location_id)
    GROUP BY a.apmt_patient_id
  ) v;
$$;

CREATE OR REPLACE FUNCTION public.pe_completed_visits_12mo_by_pt(
  p_practice_id UUID,
  p_since_date DATE
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    jsonb_object_agg(apmt_patient_id::text, visit_count),
    '{}'::jsonb
  )
  FROM (
    SELECT
      a.apmt_patient_id,
      COUNT(*)::bigint AS visit_count
    FROM public.appointments a
    WHERE a.organization_id = p_practice_id
      AND a.apmt_patient_id IS NOT NULL
      AND a.apmt_completed_at >= p_since_date
      AND (
        a.apmt_completed_at IS NOT NULL
        OR LOWER(BTRIM(COALESCE(a.apmt_state, ''))) = 'completed'
      )
      AND LOWER(BTRIM(COALESCE(a.apmt_state, ''))) NOT IN (
        'cancelled', 'did not attend', 'dna'
      )
    GROUP BY a.apmt_patient_id
  ) v;
$$;

GRANT EXECUTE ON FUNCTION public.pe_first_completed_visit_by_pt(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pe_completed_visits_12mo_by_pt(UUID, DATE) TO authenticated, service_role;
