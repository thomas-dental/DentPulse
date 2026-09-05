-- Faster pe_patient_lifetime_metrics: precomputed tenure on facts + optimized fallback.

ALTER TABLE public.pe_patient_contribution_facts
  ADD COLUMN IF NOT EXISTS first_activity_date date,
  ADD COLUMN IF NOT EXISTS tenure_years numeric(8, 2);

COMMENT ON COLUMN public.pe_patient_contribution_facts.first_activity_date IS
  'Earliest completed visit or invoice date; set at facts refresh for lifetime metrics.';

COMMENT ON COLUMN public.pe_patient_contribution_facts.tenure_years IS
  'Derived tenure from first_activity_date to refresh date; used by pe_patient_lifetime_metrics fast path.';

CREATE INDEX IF NOT EXISTS idx_event_ledger_practice_type_created
  ON public.event_ledger (practice_id, event_type, created_at);

CREATE OR REPLACE FUNCTION public.pe_patient_lifetime_metrics(
  p_practice_id UUID,
  p_location_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
  v_has_precomputed boolean;
BEGIN
  PERFORM set_config('statement_timeout', '120000', true);

  SELECT EXISTS (
    SELECT 1
    FROM public.pe_patient_contribution_facts pf
    JOIN public.patients p
      ON p.id = pf.patient_id
     AND p.organization_id = pf.practice_id
    WHERE pf.practice_id = p_practice_id
      AND pf.tenure_years IS NOT NULL
      AND p.is_active = true
      AND p.deleted_at IS NULL
      AND (p_location_id IS NULL OR p.location_id = p_location_id)
    LIMIT 1
  )
  INTO v_has_precomputed;

  IF v_has_precomputed THEN
    SELECT jsonb_build_object(
      'tenureYears', agg.tenure_years,
      'tenurePatientCount', agg.tenure_patient_count,
      'projectedLifetimeYears', agg.projected_lifetime_years,
      'projectedLifetimePatientCount', agg.projected_lifetime_patient_count,
      'hasTenureData', COALESCE(agg.tenure_patient_count, 0) > 0,
      'hasProjectedLifetimeData', COALESCE(agg.projected_lifetime_patient_count, 0) > 0
    )
    INTO v_result
    FROM (
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
          SELECT 1 FROM public.pe_economic_assumptions ea
          WHERE ea.practice_id = p_practice_id
        )
        LIMIT 1
      ),
      active_count AS (
        SELECT COUNT(*)::bigint AS n
        FROM public.patients p
        WHERE p.organization_id = p_practice_id
          AND p.is_active = true
          AND p.deleted_at IS NULL
          AND (p_location_id IS NULL OR p.location_id = p_location_id)
      ),
      pf_tenure AS (
        SELECT
          ROUND(AVG(pf.tenure_years), 2) AS tenure_years,
          COUNT(pf.tenure_years)::bigint AS tenure_patient_count
        FROM public.pe_patient_contribution_facts pf
        JOIN public.patients p
          ON p.id = pf.patient_id
         AND p.organization_id = pf.practice_id
        WHERE pf.practice_id = p_practice_id
          AND pf.tenure_years IS NOT NULL
          AND p.is_active = true
          AND p.deleted_at IS NULL
          AND (p_location_id IS NULL OR p.location_id = p_location_id)
      ),
      pf_projected AS (
        SELECT
          COUNT(*)::bigint AS pf_patient_count,
          COALESCE(
            SUM(
              CASE
                WHEN LOWER(BTRIM(COALESCE(pf.retention_status, 'active'))) = 'healthy' THEN a.yrs_active
                WHEN LOWER(BTRIM(COALESCE(pf.retention_status, 'active'))) = 'drifting' THEN a.yrs_drifting
                WHEN LOWER(BTRIM(COALESCE(pf.retention_status, 'active'))) = 'lapsed' THEN a.yrs_lapsed
                WHEN LOWER(BTRIM(COALESCE(pf.retention_status, 'active'))) = 'effectively_lost'
                  THEN a.yrs_lost
                ELSE a.yrs_active
              END
            ),
            0
          ) AS projected_sum
        FROM public.pe_patient_contribution_facts pf
        JOIN public.patients p
          ON p.id = pf.patient_id
         AND p.organization_id = pf.practice_id
        CROSS JOIN assumptions a
        WHERE pf.practice_id = p_practice_id
          AND p.is_active = true
          AND p.deleted_at IS NULL
          AND (p_location_id IS NULL OR p.location_id = p_location_id)
      )
      SELECT
        pt.tenure_years,
        pt.tenure_patient_count,
        ROUND(
          (
            pp.projected_sum
            + GREATEST(ac.n - pp.pf_patient_count, 0) * a.yrs_active
          ) / NULLIF(ac.n, 0),
          2
        ) AS projected_lifetime_years,
        ac.n AS projected_lifetime_patient_count
      FROM active_count ac
      CROSS JOIN assumptions a
      CROSS JOIN pf_tenure pt
      CROSS JOIN pf_projected pp
    ) agg;

    RETURN v_result;
  END IF;

  -- Fallback: live aggregation (pe_first_completed_visit_by_pt + active-patient invoice join).
  SELECT jsonb_build_object(
    'tenureYears', agg.tenure_years,
    'tenurePatientCount', agg.tenure_patient_count,
    'projectedLifetimeYears', agg.projected_lifetime_years,
    'projectedLifetimePatientCount', agg.projected_lifetime_patient_count,
    'hasTenureData', COALESCE(agg.tenure_patient_count, 0) > 0,
    'hasProjectedLifetimeData', COALESCE(agg.projected_lifetime_patient_count, 0) > 0
  )
  INTO v_result
  FROM (
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
        SELECT 1 FROM public.pe_economic_assumptions ea
        WHERE ea.practice_id = p_practice_id
      )
      LIMIT 1
    ),
    active_patients AS (
      SELECT p.id AS patient_id, p.pt_id
      FROM public.patients p
      WHERE p.organization_id = p_practice_id
        AND p.is_active = true
        AND p.deleted_at IS NULL
        AND (p_location_id IS NULL OR p.location_id = p_location_id)
    ),
    first_visit AS (
      SELECT
        (e.key)::bigint AS pt_id,
        (e.value)::date AS first_visit_date
      FROM jsonb_each_text(
        COALESCE(public.pe_first_completed_visit_by_pt(p_practice_id, p_location_id), '{}'::jsonb)
      ) AS e(key, value)
      WHERE EXISTS (
        SELECT 1
        FROM active_patients ap
        WHERE ap.pt_id IS NOT NULL
          AND ap.pt_id = (e.key)::bigint
      )
    ),
    first_invoice AS (
      SELECT
        ap.patient_id,
        MIN(f.invoice_date) AS first_invoice_date
      FROM active_patients ap
      JOIN public.pe_invoice_contribution_facts f
        ON f.practice_id = p_practice_id
       AND f.patient_id = ap.patient_id
       AND f.invoice_date IS NOT NULL
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
    )
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
  ) agg;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.pe_patient_lifetime_metrics(UUID, UUID) IS
  'Growth levers tenure + projected lifetime. Uses precomputed pe_patient_contribution_facts.tenure_years when present.';

GRANT EXECUTE ON FUNCTION public.pe_patient_lifetime_metrics(UUID, UUID) TO authenticated, service_role;
