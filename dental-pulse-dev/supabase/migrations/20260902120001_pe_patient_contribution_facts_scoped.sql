-- Scoped patient contribution rollups from invoice facts (location + date range).
-- Replaces Node aggregatePatientContributionFromInvoices for TopBar read scope.

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
  confidence_score INTEGER
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
        f.pt_id AS dentally_pt_id,
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
        AND f.patient_id IS NOT NULL
        AND (p_start_date IS NULL OR f.invoice_date >= p_start_date)
        AND (p_end_date IS NULL OR f.invoice_date <= p_end_date)
        AND (p_location_id IS NULL OR p.location_id = p_location_id)
      GROUP BY f.patient_id, f.pt_id
    )
    SELECT
      s.pid,
      s.dentally_pt_id,
      COALESCE(pf.retention_status, 'active'),
      s.contrib,
      s.rev_pp,
      s.inv_count,
      s.conf_score
    FROM scoped s
    LEFT JOIN public.pe_patient_contribution_facts pf
      ON pf.practice_id = p_practice_id
     AND pf.patient_id = s.pid
    ORDER BY s.contrib DESC;
  ELSE
    RETURN QUERY
    WITH scoped AS (
      SELECT
        v.patient_id AS pid,
        v.pt_id AS dentally_pt_id,
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
        AND v.patient_id IS NOT NULL
        AND (p_start_date IS NULL OR v.invoice_date >= p_start_date)
        AND (p_end_date IS NULL OR v.invoice_date <= p_end_date)
        AND (p_location_id IS NULL OR p.location_id = p_location_id)
      GROUP BY v.patient_id, v.pt_id
    )
    SELECT
      s.pid,
      s.dentally_pt_id,
      COALESCE(pf.retention_status, 'active'),
      s.contrib,
      s.rev_pp,
      s.inv_count,
      s.conf_score
    FROM scoped s
    LEFT JOIN public.pe_patient_contribution_facts pf
      ON pf.practice_id = p_practice_id
     AND pf.patient_id = s.pid
    ORDER BY s.contrib DESC;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.pe_patient_contribution_facts_scoped(UUID, UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pe_patient_contribution_facts_scoped(UUID, UUID, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pe_patient_contribution_facts_scoped(UUID, UUID, DATE, DATE) TO service_role;
