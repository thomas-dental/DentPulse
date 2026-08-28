-- ============================================================================
-- Patient Economics — v_patient_contribution (per-patient rollup)
--
-- Aggregates live v_invoice_contribution by patient_id for Economic Pulse
-- Patient List directory. Uses Day 2.5 invoice-level practitioner attribution
-- (dominant practitioner private_share rate) — not a legacy patient-grain calc.
-- security_invoker → underlying org RLS via v_invoice_contribution.
-- ============================================================================

DROP VIEW IF EXISTS public.v_patient_contribution;

CREATE VIEW public.v_patient_contribution
WITH (security_invoker = true)
AS
WITH agg AS (
  SELECT
    practice_id,
    patient_id,
    MAX(pt_id) AS pt_id,
    COUNT(*)::bigint AS invoice_count,
    COUNT(*) FILTER (WHERE revenue_private_plan > 0)::bigint AS invoices_with_revenue,
    COALESCE(SUM(revenue_private_plan), 0)::numeric(15, 2) AS revenue_private_plan,
    COALESCE(SUM(clinician_cost), 0)::numeric(15, 2) AS clinician_cost,
    COALESCE(SUM(direct_cost), 0)::numeric(15, 2) AS direct_cost,
    COALESCE(SUM(contribution), 0)::numeric(15, 2) AS contribution,
    CASE
      WHEN SUM(revenue_private_plan) > 0
      THEN ROUND((SUM(contribution) / SUM(revenue_private_plan)) * 100, 1)
      ELSE NULL
    END AS margin_pct,
    COUNT(*) FILTER (WHERE contribution_provenance_status = 'complete')::bigint
      AS invoices_complete,
    COUNT(*) FILTER (
      WHERE contribution_provenance_status = 'partial_no_practitioner'
    )::bigint AS invoices_partial_no_practitioner,
    COUNT(*) FILTER (
      WHERE contribution_provenance_status = 'partial_missing_rate'
    )::bigint AS invoices_partial_missing_rate,
    CASE
      WHEN COUNT(*) FILTER (WHERE revenue_private_plan > 0) > 0 THEN
        ROUND(
          100.0 * COUNT(*) FILTER (
            WHERE revenue_private_plan > 0
              AND contribution_provenance_status = 'complete'
          ) / NULLIF(COUNT(*) FILTER (WHERE revenue_private_plan > 0), 0),
          1
        )
      ELSE NULL
    END AS pct_complete,
    CASE
      WHEN COUNT(*) FILTER (
        WHERE contribution_provenance_status = 'partial_no_practitioner'
      ) > 0 THEN 'partial_no_practitioner'
      WHEN COUNT(*) FILTER (
        WHERE contribution_provenance_status = 'partial_missing_rate'
      ) > 0 THEN 'partial_missing_rate'
      ELSE 'complete'
    END::text AS contribution_provenance_status,
  ROUND(AVG(confidence_score))::integer AS confidence_score
  FROM public.v_invoice_contribution
  WHERE patient_id IS NOT NULL
  GROUP BY practice_id, patient_id
)
SELECT
  agg.practice_id,
  agg.patient_id,
  agg.pt_id,
  TRIM(BOTH FROM COALESCE(p.pt_first_name, '') || ' ' || COALESCE(p.pt_last_name, ''))
    AS patient_name,
  p.pt_unique_id AS patient_uuid,
  agg.invoice_count,
  agg.invoices_with_revenue,
  agg.revenue_private_plan,
  agg.clinician_cost,
  agg.direct_cost,
  agg.contribution,
  agg.margin_pct,
  agg.invoices_complete,
  agg.invoices_partial_no_practitioner,
  agg.invoices_partial_missing_rate,
  agg.pct_complete,
  agg.contribution_provenance_status,
  'Dentally'::text AS revenue_tier,
  CASE
    WHEN agg.contribution_provenance_status IN (
      'partial_no_practitioner',
      'partial_missing_rate'
    ) THEN 'External'
    ELSE 'Derived'
  END::text AS clinician_cost_tier,
  'Derived'::text AS contribution_tier,
  agg.confidence_score
FROM agg
LEFT JOIN public.patients p
  ON p.id = agg.patient_id
 AND p.organization_id = agg.practice_id
 AND p.deleted_at IS NULL;

COMMENT ON VIEW public.v_patient_contribution IS
  'PE per-patient rollup of v_invoice_contribution: revenue, direct cost, contribution, and complete vs partial_no_practitioner / partial_missing_rate data-quality. Patient List directory grain. security_invoker for org RLS.';

GRANT SELECT ON public.v_patient_contribution TO authenticated;
GRANT SELECT ON public.v_patient_contribution TO service_role;
