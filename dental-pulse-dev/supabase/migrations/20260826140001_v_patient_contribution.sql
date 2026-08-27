-- ============================================================================
-- Patient Economics — v_patient_contribution (Day 2 — SUPERSEDED)
-- Superseded by 20260827130001_v_invoice_contribution.sql (invoice grain).
-- Do not re-apply this file on environments that already have v_invoice_contribution.
-- ============================================================================
-- Contribution = private/plan invoice revenue − clinician cost − lab cost.
-- Queryable directly by the frontend under RLS (security_invoker → underlying
-- patients / invoice / payment table policies via user_in_org).
--
-- Revenue: Dentally platform_integration_invoices only.
--   private/plan = GREATEST(subtotal − nhs_amount, 0).
--   NHS/UDA excluded via nhs_amount (hardcoded interim; formal is_nhs /
--   is_private split lands with Economic Assumptions work).
--
-- Clinician cost: 45% placeholder of private/plan revenue until the PE
--   Economic Assumptions / clinician remuneration config exists.
--
-- Lab cost: sum of treatments.lab_bill on charged non-NHS treatment_plan_items.
--   0 until catalog / standard-cost library is populated.
--
-- Materials, membership service cost, CAC: not included here (later).
-- payments_collected is informational only — not used in contribution.
-- ============================================================================

CREATE OR REPLACE VIEW public.v_patient_contribution
WITH (security_invoker = true)
AS
WITH invoice_agg AS (
  SELECT
    i.organization_id,
    i.patient_id::bigint AS pt_id,
    COALESCE(SUM(
      GREATEST(
        COALESCE(i.subtotal, i.total_amount, 0)
          - COALESCE(i.nhs_amount, 0),
        0
      )
    ), 0)::numeric(15, 2) AS revenue_private_plan,
    COALESCE(SUM(COALESCE(i.nhs_amount, 0)), 0)::numeric(15, 2) AS nhs_excluded_amount,
    COUNT(*)::bigint AS invoice_count
  FROM public.platform_integration_invoices i
  WHERE i.platform_type = 'dentally'
    AND i.deleted_at IS NULL
    AND i.patient_id IS NOT NULL
  GROUP BY i.organization_id, i.patient_id::bigint
),
payment_agg AS (
  SELECT
    p.organization_id,
    p.dp_patient_id::bigint AS pt_id,
    COALESCE(SUM(COALESCE(p.dp_amount, 0)), 0)::numeric(15, 2) AS payments_collected
  FROM public.dentally_payments p
  WHERE p.deleted_at IS NULL
    AND p.dp_patient_id IS NOT NULL
    AND (
      p.dp_status IS NULL
      OR lower(p.dp_status) IN ('paid', 'completed', 'success')
    )
  GROUP BY p.organization_id, p.dp_patient_id::bigint
),
lab_agg AS (
  SELECT
    tpi.organization_id,
    tpi.tpi_patient_id::bigint AS pt_id,
    COALESCE(SUM(COALESCE(t.lab_bill, 0)), 0)::numeric(15, 2) AS lab_cost
  FROM public.treatment_plan_items tpi
  JOIN public.treatments t
    ON t.organization_id = tpi.organization_id
   AND t.external_id = tpi.tpi_treatment_id
   AND t.deleted_at IS NULL
  WHERE tpi.tpi_charged IS TRUE
    AND tpi.tpi_patient_id IS NOT NULL
    AND lower(COALESCE(t.treatment_type, 'private')) <> 'nhs'
  GROUP BY tpi.organization_id, tpi.tpi_patient_id::bigint
)
SELECT
  pt.organization_id AS practice_id,
  pt.id AS patient_id,
  pt.pt_id,
  COALESCE(ia.revenue_private_plan, 0)::numeric(15, 2) AS revenue_private_plan,
  COALESCE(ia.nhs_excluded_amount, 0)::numeric(15, 2) AS nhs_excluded_amount,
  COALESCE(ia.invoice_count, 0)::bigint AS invoice_count,
  COALESCE(pa.payments_collected, 0)::numeric(15, 2) AS payments_collected,
  ROUND(COALESCE(ia.revenue_private_plan, 0) * 0.45, 2)::numeric(15, 2) AS clinician_cost,
  COALESCE(la.lab_cost, 0)::numeric(15, 2) AS lab_cost,
  (
    ROUND(COALESCE(ia.revenue_private_plan, 0) * 0.45, 2)
    + COALESCE(la.lab_cost, 0)
  )::numeric(15, 2) AS direct_cost,
  (
    COALESCE(ia.revenue_private_plan, 0)
    - ROUND(COALESCE(ia.revenue_private_plan, 0) * 0.45, 2)
    - COALESCE(la.lab_cost, 0)
  )::numeric(15, 2) AS contribution,
  0.45::numeric(5, 4) AS clinician_share_placeholder,
  'derived'::text AS confidence
FROM public.patients pt
LEFT JOIN invoice_agg ia
  ON ia.organization_id = pt.organization_id
 AND ia.pt_id = pt.pt_id
LEFT JOIN payment_agg pa
  ON pa.organization_id = pt.organization_id
 AND pa.pt_id = pt.pt_id
LEFT JOIN lab_agg la
  ON la.organization_id = pt.organization_id
 AND la.pt_id = pt.pt_id
WHERE pt.deleted_at IS NULL
  AND pt.pt_id IS NOT NULL;

COMMENT ON VIEW public.v_patient_contribution IS
  'PE patient contribution: private/plan invoice revenue − clinician (45% placeholder) − lab (treatments.lab_bill). NHS via nhs_amount excluded. security_invoker for org RLS. Materials/membership/CAC later.';

GRANT SELECT ON public.v_patient_contribution TO authenticated;
GRANT SELECT ON public.v_patient_contribution TO service_role;
