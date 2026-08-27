-- ============================================================================
-- Patient Economics — v_invoice_contribution (invoice grain)
--
-- Replaces patient-grained v_patient_contribution. One row per Dentally invoice.
-- Economic Pulse / summaries aggregate this view in the app.
-- ============================================================================
-- Clinician cost is resolved per INVOICE:
--   1) Sum private/plan £ across items where is_nhs = false (Dentally nhs_charge).
--   2) Dominant practitioner = among items WITH practitioner_id, largest £ on
--      that invoice. Untagged items don't vote and don't block attribution.
--   3) Apply that practitioner's effective-dated rate from
--      practitioner_private_share_rates to the invoice's FULL private revenue.
--
-- TRADE-OFF (documented approximation, not a bug): an invoice genuinely split
-- across two different doctors is attributed entirely to whichever has the
-- larger £ value on it, not split proportionally. Expected to be rare.
--
-- Incomplete-data reasons (distinct — different practice-side fixes):
--   has_missing_practitioner / revenue_no_practitioner
--   has_missing_rate / revenue_missing_rate
-- Neither defaults cost to zero: incomplete invoice revenue is excluded from
-- contribution, never silently treated as free.
-- Live view — no backfill; next SELECT reflects newly configured rates.
--
-- Lab cost / payments are not invoice-native here (patient/catalog feeds) — left 0.
-- ============================================================================

DROP VIEW IF EXISTS public.v_patient_contribution;
DROP VIEW IF EXISTS public.v_invoice_contribution;

CREATE VIEW public.v_invoice_contribution
WITH (security_invoker = true)
AS
WITH private_items AS (
  SELECT
    li.organization_id,
    li.invoice_id,
    COALESCE(li.net, li.line_amount, li.gross, 0)::numeric(15, 2) AS item_amount,
    NULLIF(BTRIM(li.practitioner_id::text), '') AS practitioner_ext_id
  FROM public.platform_integration_invoice_line_items li
  WHERE COALESCE(li.is_nhs, false) = false
),
invoice_private AS (
  SELECT
    organization_id,
    invoice_id,
    COALESCE(SUM(item_amount), 0)::numeric(15, 2) AS private_revenue
  FROM private_items
  GROUP BY organization_id, invoice_id
),
practitioner_votes AS (
  SELECT
    pi.organization_id,
    pi.invoice_id,
    p.id AS provider_id,
    SUM(pi.item_amount)::numeric(15, 2) AS tagged_value
  FROM private_items pi
  INNER JOIN public.providers p
    ON p.organization_id = pi.organization_id
   AND p.external_id::text = pi.practitioner_ext_id
   AND p.deleted_at IS NULL
  WHERE pi.practitioner_ext_id IS NOT NULL
  GROUP BY pi.organization_id, pi.invoice_id, p.id
),
dominant AS (
  SELECT DISTINCT ON (organization_id, invoice_id)
    organization_id,
    invoice_id,
    provider_id,
    tagged_value
  FROM practitioner_votes
  ORDER BY organization_id, invoice_id, tagged_value DESC, provider_id
)
SELECT
  i.organization_id AS practice_id,
  i.id AS invoice_id,
  i.platform_invoice_id,
  i.invoice_date,
  pt.id AS patient_id,
  i.patient_id::bigint AS pt_id,
  COALESCE(ip.private_revenue, 0)::numeric(15, 2) AS revenue_private_plan,
  COALESCE(i.nhs_amount, 0)::numeric(15, 2) AS nhs_excluded_amount,
  d.provider_id AS dominant_practitioner_id,
  r.rate AS private_share_rate,
  CASE
    WHEN COALESCE(ip.private_revenue, 0) > 0 AND d.provider_id IS NULL
    THEN true ELSE false
  END AS has_missing_practitioner,
  CASE
    WHEN COALESCE(ip.private_revenue, 0) > 0
     AND d.provider_id IS NOT NULL
     AND r.rate IS NULL
    THEN true ELSE false
  END AS has_missing_rate,
  CASE
    WHEN COALESCE(ip.private_revenue, 0) > 0 AND d.provider_id IS NULL
    THEN COALESCE(ip.private_revenue, 0)
    ELSE 0
  END::numeric(15, 2) AS revenue_no_practitioner,
  CASE
    WHEN COALESCE(ip.private_revenue, 0) > 0
     AND d.provider_id IS NOT NULL
     AND r.rate IS NULL
    THEN COALESCE(ip.private_revenue, 0)
    ELSE 0
  END::numeric(15, 2) AS revenue_missing_rate,
  CASE
    WHEN d.provider_id IS NOT NULL AND r.rate IS NOT NULL
    THEN ROUND(COALESCE(ip.private_revenue, 0) * (r.rate / 100.0), 2)::numeric(15, 2)
    ELSE 0::numeric(15, 2)
  END AS clinician_cost,
  0::numeric(15, 2) AS lab_cost,
  CASE
    WHEN d.provider_id IS NOT NULL AND r.rate IS NOT NULL
    THEN ROUND(COALESCE(ip.private_revenue, 0) * (r.rate / 100.0), 2)::numeric(15, 2)
    ELSE 0::numeric(15, 2)
  END AS direct_cost,
  CASE
    WHEN d.provider_id IS NOT NULL AND r.rate IS NOT NULL
    THEN (
      COALESCE(ip.private_revenue, 0)
      - ROUND(COALESCE(ip.private_revenue, 0) * (r.rate / 100.0), 2)
    )::numeric(15, 2)
    ELSE 0::numeric(15, 2)
  END AS contribution,
  CASE
    WHEN COALESCE(ip.private_revenue, 0) > 0 AND d.provider_id IS NULL
    THEN 'partial_no_practitioner'
    WHEN COALESCE(ip.private_revenue, 0) > 0
     AND d.provider_id IS NOT NULL
     AND r.rate IS NULL
    THEN 'partial_missing_rate'
    ELSE 'complete'
  END::text AS contribution_provenance_status,
  'derived'::text AS confidence
FROM public.platform_integration_invoices i
LEFT JOIN invoice_private ip
  ON ip.organization_id = i.organization_id
 AND ip.invoice_id = i.id
LEFT JOIN dominant d
  ON d.organization_id = i.organization_id
 AND d.invoice_id = i.id
LEFT JOIN LATERAL (
  SELECT ppsr.rate
  FROM public.practitioner_private_share_rates ppsr
  WHERE ppsr.practice_id = i.organization_id
    AND ppsr.practitioner_id = d.provider_id
    AND ppsr.effective_from <= COALESCE(
      i.invoice_date,
      (i.api_record_created_at AT TIME ZONE 'UTC')::date
    )
  ORDER BY ppsr.effective_from DESC
  LIMIT 1
) r ON true
LEFT JOIN public.patients pt
  ON pt.organization_id = i.organization_id
 AND pt.pt_id = i.patient_id::bigint
 AND pt.deleted_at IS NULL
WHERE i.platform_type = 'dentally'
  AND i.deleted_at IS NULL
  AND i.patient_id IS NOT NULL;

COMMENT ON VIEW public.v_invoice_contribution IS
  'PE invoice contribution: one row per Dentally invoice. Private/plan revenue − dominant-practitioner private_share rate. Incomplete invoices contribute £0 (revenue tracked in revenue_no_practitioner / revenue_missing_rate). Replaces v_patient_contribution. security_invoker for org RLS.';

GRANT SELECT ON public.v_invoice_contribution TO authenticated;
GRANT SELECT ON public.v_invoice_contribution TO service_role;
