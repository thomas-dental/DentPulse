-- ============================================================================
-- Patient Economics — v_patient_financial_record (Patient Records aggregation)
--
-- Single read surface for the Patient Financial Records tab. Joins:
--   • v_patient_contribution — revenue, cost breakdown, contribution, margin,
--     provenance tiers (Day 1/2/2.5 + Step 1a), opportunity gross/weighted,
--     retention status (Step 2), patient economic value + recommended action (Step 3)
--   • patient_economics_modelled_scores — explicit CLTV projection, quality
--     score tiers, modelled confidence, computed_at (Day 3 Modelled job)
--
-- security_invoker → underlying org RLS on v_invoice_contribution (invoice
-- grain) and patient_economics_modelled_scores (practice_id policy via
-- user_in_org). A user cannot read another practice's patient by supplying
-- only a foreign patient_id: rows carry practice_id from contribution rollup
-- and RLS filters invoice / modelled sources to the caller's org(s).
--
-- RLS regression: backend/scripts/testPatientFinancialRecordRls.js
-- ============================================================================

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
  ms.cltv_projection,
  ms.cltv_tier,
  ms.quality_score_tier,
  ms.confidence_score AS modelled_confidence_score,
  ms.computed_at AS modelled_computed_at
FROM public.v_patient_contribution pc
LEFT JOIN public.patient_economics_modelled_scores ms
  ON ms.practice_id = pc.practice_id
 AND ms.patient_id = pc.patient_id;

COMMENT ON VIEW public.v_patient_financial_record IS
  'PE Patient Records aggregation: contribution rollup + opportunity + retention + PEV + recommended action + Day 3 modelled CLTV/quality. security_invoker for org RLS.';

COMMENT ON COLUMN public.v_patient_financial_record.cltv_projection IS
  'Day 3 Modelled job CLTV projection (£). Null when job row missing; PEV falls back to contribution.';

COMMENT ON COLUMN public.v_patient_financial_record.cltv_tier IS
  'Provenance tier for CLTV projection — Modelled when job row present.';

COMMENT ON COLUMN public.v_patient_financial_record.quality_score_tier IS
  'Provenance tier for quality_score — Modelled when job row present.';

COMMENT ON COLUMN public.v_patient_financial_record.modelled_confidence_score IS
  '0–100 confidence in Modelled outputs (distinct from contribution confidence_score).';

COMMENT ON COLUMN public.v_patient_financial_record.modelled_computed_at IS
  'When the Day 3 modelled job last wrote this patient row.';

GRANT SELECT ON public.v_patient_financial_record TO authenticated;
GRANT SELECT ON public.v_patient_financial_record TO service_role;
