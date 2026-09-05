-- ============================================================================
-- Patient Economics — v_patient_contribution (invoice-level clinician attribution)
-- Replaces the Day 2 flat 45% clinician-cost assumption.
-- Output grain: one row per patient (superseded by v_invoice_contribution).
-- Kept for migration history only — do not re-apply; see
-- 20260827130001_v_invoice_contribution.sql.
-- ============================================================================
-- Clinician cost is resolved per INVOICE, not per line item:
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
--     → no item on the invoice has a practitioner_id (charting/invoicing habit)
--   has_missing_rate / revenue_missing_rate
--     → dominant practitioner found, but no rate for the invoice date (Settings)
-- Neither defaults cost to zero: incomplete invoice revenue is excluded from
-- contribution, never silently treated as free.
-- Live view — no backfill; next SELECT reflects newly configured rates.
-- ============================================================================

DROP VIEW IF EXISTS public.v_patient_contribution;

CREATE OR REPLACE VIEW public.v_patient_contribution
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
  -- Largest tagged £ wins; provider_id tie-break for stability
  SELECT DISTINCT ON (organization_id, invoice_id)
    organization_id,
    invoice_id,
    provider_id,
    tagged_value
  FROM practitioner_votes
  ORDER BY organization_id, invoice_id, tagged_value DESC, provider_id
),
invoice_cost AS (
  SELECT
    i.id AS invoice_id,
    i.organization_id,
    i.patient_id::bigint AS pt_id,
    COALESCE(ip.private_revenue, 0)::numeric(15, 2) AS private_revenue,
    COALESCE(i.nhs_amount, 0)::numeric(15, 2) AS nhs_excluded_amount,
    d.provider_id AS dominant_provider_id,
    r.rate AS private_share_rate,
    CASE
      WHEN COALESCE(ip.private_revenue, 0) > 0 AND d.provider_id IS NULL
      THEN true ELSE false
    END AS missing_practitioner,
    CASE
      WHEN COALESCE(ip.private_revenue, 0) > 0
       AND d.provider_id IS NOT NULL
       AND r.rate IS NULL
      THEN true ELSE false
    END AS missing_rate,
    CASE
      WHEN d.provider_id IS NOT NULL AND r.rate IS NOT NULL
      THEN ROUND(COALESCE(ip.private_revenue, 0) * (r.rate / 100.0), 2)::numeric(15, 2)
      ELSE NULL  -- excluded from clinician_cost sum (not £0)
    END AS clinician_cost
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
  WHERE i.platform_type = 'dentally'
    AND i.deleted_at IS NULL
    AND i.patient_id IS NOT NULL
),
invoice_agg AS (
  SELECT
    organization_id,
    pt_id,
    COALESCE(SUM(private_revenue), 0)::numeric(15, 2) AS revenue_private_plan,
    COALESCE(SUM(nhs_excluded_amount), 0)::numeric(15, 2) AS nhs_excluded_amount,
    COUNT(*)::bigint AS invoice_count,
    COALESCE(SUM(clinician_cost), 0)::numeric(15, 2) AS clinician_cost,
    COALESCE(BOOL_OR(missing_practitioner), false) AS has_missing_practitioner,
    COALESCE(BOOL_OR(missing_rate), false) AS has_missing_rate,
    COALESCE(SUM(CASE WHEN missing_practitioner THEN private_revenue ELSE 0 END), 0)
      ::numeric(15, 2) AS revenue_no_practitioner,
    COALESCE(SUM(CASE WHEN missing_rate THEN private_revenue ELSE 0 END), 0)
      ::numeric(15, 2) AS revenue_missing_rate,
    COALESCE(SUM(CASE WHEN clinician_cost IS NOT NULL THEN private_revenue ELSE 0 END), 0)
      ::numeric(15, 2) AS revenue_attributed
  FROM invoice_cost
  GROUP BY organization_id, pt_id
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
  COALESCE(ia.clinician_cost, 0)::numeric(15, 2) AS clinician_cost,
  COALESCE(la.lab_cost, 0)::numeric(15, 2) AS lab_cost,
  (
    COALESCE(ia.clinician_cost, 0) + COALESCE(la.lab_cost, 0)
  )::numeric(15, 2) AS direct_cost,
  (
    COALESCE(ia.revenue_attributed, 0)
    - COALESCE(ia.clinician_cost, 0)
    - COALESCE(la.lab_cost, 0)
  )::numeric(15, 2) AS contribution,
  COALESCE(ia.has_missing_practitioner, false) AS has_missing_practitioner,
  COALESCE(ia.has_missing_rate, false) AS has_missing_rate,
  COALESCE(ia.revenue_no_practitioner, 0)::numeric(15, 2) AS revenue_no_practitioner,
  COALESCE(ia.revenue_missing_rate, 0)::numeric(15, 2) AS revenue_missing_rate,
  CASE
    WHEN COALESCE(ia.has_missing_practitioner, false) THEN 'partial_no_practitioner'
    WHEN COALESCE(ia.has_missing_rate, false) THEN 'partial_missing_rate'
    ELSE 'complete'
  END::text AS contribution_provenance_status,
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
  'PE patient contribution: private/plan invoice revenue − invoice-level clinician cost (dominant practitioner × effective private_share rate) − lab. Incomplete invoices excluded from contribution (missing practitioner vs missing rate tracked separately). Live view; no backfill. security_invoker for org RLS.';

GRANT SELECT ON public.v_patient_contribution TO authenticated;
GRANT SELECT ON public.v_patient_contribution TO service_role;
