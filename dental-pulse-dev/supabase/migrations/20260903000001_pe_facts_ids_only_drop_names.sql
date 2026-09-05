-- PE facts / scoped RPC: keep IDs only (practice_id, patient_id, location_id).
-- Drop denormalized display names — resolve names at API read from patients /
-- practice_locations / organizations.

ALTER TABLE public.pe_patient_contribution_facts
  DROP COLUMN IF EXISTS location_name;

COMMENT ON COLUMN public.pe_patient_contribution_facts.location_id IS
  'Patient home location at last facts refresh (patients.location_id). Names come from practice_locations at read time.';

-- Scoped patient stubs: IDs only (no location_name).
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
  location_id UUID
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
      COALESCE(pf.location_id, p.location_id)
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
      COALESCE(pf.location_id, p.location_id)
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
    ORDER BY s.contrib DESC;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.pe_patient_contribution_facts_scoped(UUID, UUID, DATE, DATE) IS
  'Scoped patient contribution stubs (IDs only). Includes orphan pt_id rows. Resolve location/patient names at API read.';

REVOKE ALL ON FUNCTION public.pe_patient_contribution_facts_scoped(UUID, UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pe_patient_contribution_facts_scoped(UUID, UUID, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pe_patient_contribution_facts_scoped(UUID, UUID, DATE, DATE) TO service_role;

-- Financial record view: keep location_id; drop denormalized location_name.
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
LEFT JOIN public.patient_economics_modelled_scores ms
  ON ms.practice_id = pc.practice_id
 AND ms.patient_id = pc.patient_id;

COMMENT ON VIEW public.v_patient_financial_record IS
  'PE Patient Records: contribution + opportunity + retention + PEV + location_id + modelled CLTV. Names resolved at API read.';

COMMENT ON COLUMN public.v_patient_financial_record.location_id IS
  'Patient home location (patients.location_id). Null for orphan rows.';

GRANT SELECT ON public.v_patient_financial_record TO authenticated;
GRANT SELECT ON public.v_patient_financial_record TO service_role;
