-- Add patient location to PE financial record read surface and contribution facts.

ALTER TABLE public.pe_patient_contribution_facts
  ADD COLUMN IF NOT EXISTS location_id UUID,
  ADD COLUMN IF NOT EXISTS location_name TEXT;

CREATE INDEX IF NOT EXISTS idx_pe_patient_facts_practice_location
  ON public.pe_patient_contribution_facts (practice_id, location_id);

COMMENT ON COLUMN public.pe_patient_contribution_facts.location_id IS
  'Patient home location at last facts refresh (patients.location_id).';

COMMENT ON COLUMN public.pe_patient_contribution_facts.location_name IS
  'Display name from practice_locations at last facts refresh.';

DROP VIEW IF EXISTS public.v_patient_financial_record;

CREATE OR REPLACE VIEW public.v_patient_financial_record
WITH (security_invoker = true)
AS
SELECT
  pc.practice_id,
  pc.patient_id,
  pc.pt_id,
  pc.patient_name,
  pc.patient_uuid,
  pc.invoice_count,
  pc.invoices_with_revenue,
  pc.revenue_private_plan,
  pc.clinician_cost,
  pc.direct_cost,
  pc.contribution,
  pc.margin_pct,
  pc.invoices_complete,
  pc.invoices_partial_no_practitioner,
  pc.invoices_partial_missing_rate,
  pc.pct_complete,
  pc.contribution_provenance_status,
  pc.revenue_tier,
  pc.clinician_cost_tier,
  pc.contribution_tier,
  pc.confidence_score,
  pc.retention_status,
  pc.retention_status_tier,
  pc.opportunity_gross,
  pc.opportunity_gross_tier,
  pc.opportunity_weighted,
  pc.opportunity_weighted_tier,
  pc.opportunity_weighted_tier_note,
  pc.patient_economic_value,
  pc.patient_economic_value_tier,
  pc.patient_economic_value_tier_note,
  pc.quality_score,
  pc.recommended_action,
  pc.recommended_action_tier,
  pc.recommended_action_tier_note,
  p.location_id,
  NULLIF(BTRIM(pl.location_name), '') AS location_name,
  ms.cltv_projection,
  ms.cltv_tier,
  ms.quality_score_tier,
  ms.confidence_score AS modelled_confidence_score,
  ms.computed_at AS modelled_computed_at
FROM public.v_patient_contribution pc
LEFT JOIN public.patients p
  ON p.id = pc.patient_id
 AND p.organization_id = pc.practice_id
 AND p.deleted_at IS NULL
LEFT JOIN public.practice_locations pl
  ON pl.id = p.location_id
 AND pl.organization_id = pc.practice_id
 AND pl.deleted_at IS NULL
LEFT JOIN public.patient_economics_modelled_scores ms
  ON ms.practice_id = pc.practice_id
 AND ms.patient_id = pc.patient_id;

COMMENT ON VIEW public.v_patient_financial_record IS
  'PE Patient Records aggregation: contribution rollup + opportunity + retention + PEV + location + Day 3 modelled CLTV/quality. security_invoker for org RLS.';

COMMENT ON COLUMN public.v_patient_financial_record.location_id IS
  'Patient home location (patients.location_id).';

COMMENT ON COLUMN public.v_patient_financial_record.location_name IS
  'Display name from practice_locations for location_id.';

GRANT SELECT ON public.v_patient_financial_record TO authenticated;
GRANT SELECT ON public.v_patient_financial_record TO service_role;

-- Scoped patient facts RPC: expose location for list stubs.
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
      s.conf_score,
      COALESCE(pf.location_id, p.location_id),
      COALESCE(
        NULLIF(BTRIM(pf.location_name), ''),
        NULLIF(BTRIM(pl.location_name), '')
      )
    FROM scoped s
    LEFT JOIN public.pe_patient_contribution_facts pf
      ON pf.practice_id = p_practice_id
     AND pf.patient_id = s.pid
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
      s.conf_score,
      COALESCE(pf.location_id, p.location_id),
      COALESCE(
        NULLIF(BTRIM(pf.location_name), ''),
        NULLIF(BTRIM(pl.location_name), '')
      )
    FROM scoped s
    LEFT JOIN public.pe_patient_contribution_facts pf
      ON pf.practice_id = p_practice_id
     AND pf.patient_id = s.pid
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

REVOKE ALL ON FUNCTION public.pe_patient_contribution_facts_scoped(UUID, UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pe_patient_contribution_facts_scoped(UUID, UUID, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pe_patient_contribution_facts_scoped(UUID, UUID, DATE, DATE) TO service_role;
