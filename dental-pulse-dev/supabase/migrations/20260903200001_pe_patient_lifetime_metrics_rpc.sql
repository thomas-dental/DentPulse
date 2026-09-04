-- Growth levers lifetime metrics — single SQL pass (replaces JS pagination in computePatientLifetimeMetrics).

CREATE INDEX IF NOT EXISTS idx_patients_org_active_location
  ON public.patients (organization_id, location_id)
  WHERE is_active = true AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_appt_org_pt_completed
  ON public.appointments (organization_id, apmt_patient_id, apmt_completed_at)
  WHERE apmt_completed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pe_patient_facts_practice_patient
  ON public.pe_patient_contribution_facts (practice_id, patient_id);

CREATE OR REPLACE FUNCTION public.pe_patient_lifetime_metrics(
  p_practice_id UUID,
  p_location_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH assumptions AS (
    SELECT
      COALESCE(ea.projected_lifetime_years_active, 8)::numeric AS yrs_active,
      COALESCE(ea.projected_lifetime_years_drifting, 5)::numeric AS yrs_drifting,
      COALESCE(ea.projected_lifetime_years_lapsed, 2)::numeric AS yrs_lapsed,
      COALESCE(ea.projected_lifetime_years_effectively_lost, 1)::numeric AS yrs_lost
    FROM public.pe_economic_assumptions ea
    WHERE ea.practice_id = p_practice_id
    UNION ALL
    SELECT 8::numeric, 5::numeric, 2::numeric, 1::numeric
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.pe_economic_assumptions ea
      WHERE ea.practice_id = p_practice_id
    )
    LIMIT 1
  ),
  active_patients AS (
    SELECT
      p.id AS patient_id,
      p.pt_id
    FROM public.patients p
    WHERE p.organization_id = p_practice_id
      AND p.is_active = true
      AND p.deleted_at IS NULL
      AND (p_location_id IS NULL OR p.location_id = p_location_id)
  ),
  invoice_source AS (
    SELECT
      f.patient_id,
      f.invoice_date
    FROM public.pe_invoice_contribution_facts f
    WHERE f.practice_id = p_practice_id
      AND f.patient_id IS NOT NULL
      AND f.invoice_date IS NOT NULL
    UNION ALL
    SELECT
      v.patient_id,
      v.invoice_date
    FROM public.v_invoice_contribution v
    WHERE v.practice_id = p_practice_id
      AND v.patient_id IS NOT NULL
      AND v.invoice_date IS NOT NULL
      AND NOT public.pe_invoice_source_has_facts(p_practice_id)
  ),
  first_visit AS (
    SELECT
      ap.pt_id,
      MIN(a.apmt_completed_at::date) AS first_visit_date
    FROM active_patients ap
    JOIN public.appointments a
      ON a.organization_id = p_practice_id
     AND a.apmt_patient_id = ap.pt_id
     AND a.apmt_completed_at IS NOT NULL
     AND LOWER(BTRIM(COALESCE(a.apmt_state, ''))) NOT IN ('cancelled', 'did not attend', 'dna')
     AND (p_location_id IS NULL OR a.location_id = p_location_id)
    WHERE ap.pt_id IS NOT NULL
    GROUP BY ap.pt_id
  ),
  first_invoice AS (
    SELECT
      ap.patient_id,
      MIN(src.invoice_date) AS first_invoice_date
    FROM active_patients ap
    JOIN invoice_source src
      ON src.patient_id = ap.patient_id
    GROUP BY ap.patient_id
  ),
  per_patient AS (
    SELECT
      CASE
        WHEN LEAST(fv.first_visit_date, fi.first_invoice_date) IS NULL THEN NULL
        WHEN LEAST(fv.first_visit_date, fi.first_invoice_date) > CURRENT_DATE THEN NULL
        ELSE ROUND(
          (
            (CURRENT_DATE - LEAST(fv.first_visit_date, fi.first_invoice_date))::numeric
            / 365.25
          ),
          2
        )
      END AS tenure_years,
      CASE
        WHEN LOWER(BTRIM(COALESCE(pf.retention_status, 'active'))) = 'healthy' THEN 'active'
        WHEN LOWER(BTRIM(COALESCE(pf.retention_status, 'active'))) IN (
          'drifting', 'lapsed', 'effectively_lost'
        ) THEN LOWER(BTRIM(COALESCE(pf.retention_status, 'active')))
        ELSE 'active'
      END AS retention_status_norm
    FROM active_patients ap
    LEFT JOIN first_visit fv
      ON ap.pt_id IS NOT NULL
     AND fv.pt_id = ap.pt_id
    LEFT JOIN first_invoice fi
      ON fi.patient_id = ap.patient_id
    LEFT JOIN public.pe_patient_contribution_facts pf
      ON pf.practice_id = p_practice_id
     AND pf.patient_id = ap.patient_id
  ),
  agg AS (
    SELECT
      ROUND(AVG(pp.tenure_years), 2) AS tenure_years,
      COUNT(pp.tenure_years)::bigint AS tenure_patient_count,
      ROUND(
        AVG(
          CASE pp.retention_status_norm
            WHEN 'drifting' THEN a.yrs_drifting
            WHEN 'lapsed' THEN a.yrs_lapsed
            WHEN 'effectively_lost' THEN a.yrs_lost
            ELSE a.yrs_active
          END
        ),
        2
      ) AS projected_lifetime_years,
      COUNT(*)::bigint AS projected_lifetime_patient_count
    FROM per_patient pp
    CROSS JOIN assumptions a
  )
  SELECT jsonb_build_object(
    'tenureYears', agg.tenure_years,
    'tenurePatientCount', agg.tenure_patient_count,
    'projectedLifetimeYears', agg.projected_lifetime_years,
    'projectedLifetimePatientCount', agg.projected_lifetime_patient_count,
    'hasTenureData', COALESCE(agg.tenure_patient_count, 0) > 0,
    'hasProjectedLifetimeData', COALESCE(agg.projected_lifetime_patient_count, 0) > 0
  )
  FROM agg;
$$;

COMMENT ON FUNCTION public.pe_patient_lifetime_metrics(UUID, UUID) IS
  'Growth levers tenure + projected lifetime for active patients. Scoped to location when p_location_id set.';

GRANT EXECUTE ON FUNCTION public.pe_patient_lifetime_metrics(UUID, UUID) TO authenticated, service_role;
