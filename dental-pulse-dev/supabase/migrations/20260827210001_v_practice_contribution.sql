-- ============================================================================
-- Patient Economics — v_practice_contribution (per-practice rollup)
--
-- Aggregates live v_invoice_contribution by practice_id for Economic Pulse
-- Per-Practice Economics table (multi-org / group view).
-- Provenance counts are invoice-grain (same contribution_provenance_status).
-- security_invoker → underlying org RLS via v_invoice_contribution.
-- ============================================================================

DROP VIEW IF EXISTS public.v_practice_contribution;

CREATE VIEW public.v_practice_contribution
WITH (security_invoker = true)
AS
SELECT
  practice_id,
  COUNT(*)::bigint AS invoice_count,
  COUNT(*) FILTER (WHERE revenue_private_plan > 0)::bigint AS invoices_with_revenue,
  COUNT(DISTINCT patient_id)::bigint AS patient_count,
  COUNT(DISTINCT patient_id) FILTER (WHERE revenue_private_plan > 0)::bigint
    AS patients_with_revenue,
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
    WHEN COUNT(*) FILTER (WHERE revenue_private_plan > 0) > 0 THEN
      ROUND(
        100.0 * COUNT(*) FILTER (
          WHERE revenue_private_plan > 0
            AND contribution_provenance_status = 'partial_no_practitioner'
        ) / NULLIF(COUNT(*) FILTER (WHERE revenue_private_plan > 0), 0),
        1
      )
    ELSE NULL
  END AS pct_partial_no_practitioner,
  CASE
    WHEN COUNT(*) FILTER (WHERE revenue_private_plan > 0) > 0 THEN
      ROUND(
        100.0 * COUNT(*) FILTER (
          WHERE revenue_private_plan > 0
            AND contribution_provenance_status = 'partial_missing_rate'
        ) / NULLIF(COUNT(*) FILTER (WHERE revenue_private_plan > 0), 0),
        1
      )
    ELSE NULL
  END AS pct_partial_missing_rate,
  CASE
    WHEN COUNT(*) FILTER (
      WHERE contribution_provenance_status = 'partial_no_practitioner'
    ) > 0 THEN 'partial_no_practitioner'
    WHEN COUNT(*) FILTER (
      WHERE contribution_provenance_status = 'partial_missing_rate'
    ) > 0 THEN 'partial_missing_rate'
    ELSE 'complete'
  END::text AS contribution_provenance_status,
  'Dentally'::text AS revenue_tier,
  CASE
    WHEN COUNT(*) FILTER (
      WHERE contribution_provenance_status IN (
        'partial_no_practitioner',
        'partial_missing_rate'
      )
    ) > 0 THEN 'External'
    ELSE 'Derived'
  END::text AS clinician_cost_tier,
  'Modelled'::text AS lab_cost_tier,
  'Modelled'::text AS material_cost_tier,
  'Derived'::text AS contribution_tier,
  ROUND(AVG(confidence_score))::integer AS confidence_score
FROM public.v_invoice_contribution
GROUP BY practice_id;

COMMENT ON VIEW public.v_practice_contribution IS
  'PE per-practice rollup of v_invoice_contribution: revenue, costs, contribution, margin %, and complete vs partial_no_practitioner / partial_missing_rate data-quality counts. security_invoker for org RLS.';

GRANT SELECT ON public.v_practice_contribution TO authenticated;
GRANT SELECT ON public.v_practice_contribution TO service_role;
