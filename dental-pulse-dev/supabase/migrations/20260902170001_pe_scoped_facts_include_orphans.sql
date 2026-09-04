-- Include orphan (unmatched pt_id) rows in scoped patient facts for KPI math.
-- PE API still hides orphans from table rows; summaries include them.

DROP FUNCTION IF EXISTS public.pe_patient_contribution_facts_scoped(UUID, UUID, DATE, DATE);

CREATE OR REPLACE FUNCTION public.pe_patient_contribution_facts_scoped(
  p_practice_id UUID,
  p_location_id UUID DEFAULT NULL,
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL
)
RETURNS TABLE (
  patient_id UUID,
  pt_id BIGINT,
  retention_status TEXT,
  contribution NUMERIC(15, 2),
  revenue_private_plan NUMERIC(15, 2),
  invoice_count BIGINT,
  confidence_score INTEGER,
  location_id UUID,
  location_name TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  use_facts boolean;
BEGIN
  use_facts := public.pe_invoice_source_has_facts(p_practice_id);

  IF use_facts THEN
    RETURN QUERY
    WITH scoped AS (
      SELECT
        f.patient_id AS pid,
        MAX(f.pt_id) AS dentally_pt_id,
        COALESCE(SUM(f.contribution), 0)::numeric(15, 2) AS contrib,
        COALESCE(SUM(f.revenue_private_plan), 0)::numeric(15, 2) AS rev_pp,
        COUNT(*)::bigint AS inv_count,
        MAX(f.confidence_score) AS conf_score
      FROM public.pe_invoice_contribution_facts f
      LEFT JOIN public.patients p
        ON p.id = f.patient_id
       AND p.organization_id = f.practice_id
       AND p.deleted_at IS NULL
      WHERE f.practice_id = p_practice_id
        AND (f.patient_id IS NOT NULL OR f.pt_id IS NOT NULL)
        AND (p_start_date IS NULL OR f.invoice_date >= p_start_date)
        AND (p_end_date IS NULL OR f.invoice_date <= p_end_date)
        AND (
          p_location_id IS NULL
          OR p.location_id = p_location_id
        )
      GROUP BY
        f.patient_id,
        CASE WHEN f.patient_id IS NULL THEN f.pt_id ELSE NULL END
    )
    SELECT
      s.pid,
      s.dentally_pt_id,
      COALESCE(pf.retention_status, 'active'),
      s.contrib,
      s.rev_pp,
      s.inv_count,
      s.conf_score,
      COALESCE(pf.location_id, p.location_id),
      COALESCE(
        NULLIF(BTRIM(pf.location_name), ''),
        NULLIF(BTRIM(pl.location_name), '')
      )
    FROM scoped s
    LEFT JOIN public.pe_patient_contribution_facts pf
      ON pf.practice_id = p_practice_id
     AND (
       (s.pid IS NOT NULL AND pf.patient_id = s.pid)
       OR (
         s.pid IS NULL
         AND pf.patient_id IS NULL
         AND pf.pt_id IS NOT DISTINCT FROM s.dentally_pt_id
       )
     )
    LEFT JOIN public.patients p
      ON p.id = s.pid
     AND p.organization_id = p_practice_id
     AND p.deleted_at IS NULL
    LEFT JOIN public.practice_locations pl
      ON pl.id = COALESCE(pf.location_id, p.location_id)
     AND pl.organization_id = p_practice_id
     AND pl.deleted_at IS NULL
    ORDER BY s.contrib DESC;
  ELSE
    RETURN QUERY
    WITH scoped AS (
      SELECT
        v.patient_id AS pid,
        MAX(v.pt_id) AS dentally_pt_id,
        COALESCE(SUM(v.contribution), 0)::numeric(15, 2) AS contrib,
        COALESCE(SUM(v.revenue_private_plan), 0)::numeric(15, 2) AS rev_pp,
        COUNT(*)::bigint AS inv_count,
        MAX(v.confidence_score) AS conf_score
      FROM public.v_invoice_contribution v
      LEFT JOIN public.patients p
        ON p.id = v.patient_id
       AND p.organization_id = v.practice_id
       AND p.deleted_at IS NULL
      WHERE v.practice_id = p_practice_id
        AND (v.patient_id IS NOT NULL OR v.pt_id IS NOT NULL)
        AND (p_start_date IS NULL OR v.invoice_date >= p_start_date)
        AND (p_end_date IS NULL OR v.invoice_date <= p_end_date)
        AND (
          p_location_id IS NULL
          OR p.location_id = p_location_id
        )
      GROUP BY
        v.patient_id,
        CASE WHEN v.patient_id IS NULL THEN v.pt_id ELSE NULL END
    )
    SELECT
      s.pid,
      s.dentally_pt_id,
      COALESCE(pf.retention_status, 'active'),
      s.contrib,
      s.rev_pp,
      s.inv_count,
      s.conf_score,
      COALESCE(pf.location_id, p.location_id),
      COALESCE(
        NULLIF(BTRIM(pf.location_name), ''),
        NULLIF(BTRIM(pl.location_name), '')
      )
    FROM scoped s
    LEFT JOIN public.pe_patient_contribution_facts pf
      ON pf.practice_id = p_practice_id
     AND (
       (s.pid IS NOT NULL AND pf.patient_id = s.pid)
       OR (
         s.pid IS NULL
         AND pf.patient_id IS NULL
         AND pf.pt_id IS NOT DISTINCT FROM s.dentally_pt_id
       )
     )
    LEFT JOIN public.patients p
      ON p.id = s.pid
     AND p.organization_id = p_practice_id
     AND p.deleted_at IS NULL
    LEFT JOIN public.practice_locations pl
      ON pl.id = COALESCE(pf.location_id, p.location_id)
     AND pl.organization_id = p_practice_id
     AND pl.deleted_at IS NULL
    ORDER BY s.contrib DESC;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.pe_patient_contribution_facts_scoped(UUID, UUID, DATE, DATE) IS
  'Scoped patient contribution stubs including orphan pt_id rows (patient_id NULL). PE UI hides orphans from tables; summaries include them.';

REVOKE ALL ON FUNCTION public.pe_patient_contribution_facts_scoped(UUID, UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pe_patient_contribution_facts_scoped(UUID, UUID, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pe_patient_contribution_facts_scoped(UUID, UUID, DATE, DATE) TO service_role;
