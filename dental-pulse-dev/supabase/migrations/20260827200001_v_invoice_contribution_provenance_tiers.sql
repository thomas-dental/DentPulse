-- ============================================================================
-- Patient Economics — v_invoice_contribution: per-field provenance tiers
--
-- D11 PM (missed in Day 3 first pass): expose Dentally / Derived / Modelled /
-- External tags plus confidence_score so Step 1b UI chips consume real columns
-- instead of hardcoded values.
--
-- Live grain is v_invoice_contribution (v_patient_contribution superseded).
-- CTE body unchanged from 20260827160001; SELECT adds tier + score columns.
-- ============================================================================

DROP VIEW IF EXISTS public.v_invoice_contribution;

CREATE VIEW public.v_invoice_contribution
WITH (security_invoker = true)
AS
WITH private_items AS (
  SELECT
    li.organization_id,
    li.invoice_id,
    COALESCE(li.net, li.line_amount, li.gross, 0)::numeric(15, 2) AS item_amount,
    NULLIF(BTRIM(li.practitioner_id::text), '') AS practitioner_ext_id,
    NULLIF(BTRIM(li.treatment_plan_item_id::text), '') AS tpi_ext_id,
    NULLIF(BTRIM(li.treatment_id::text), '') AS treatment_ext_id
  FROM public.platform_integration_invoice_line_items li
  WHERE COALESCE(li.is_nhs, false) = false
),
nhs_items AS (
  SELECT
    li.organization_id,
    li.invoice_id,
    COALESCE(li.net, li.line_amount, li.gross, 0)::numeric(15, 2) AS item_amount
  FROM public.platform_integration_invoice_line_items li
  WHERE COALESCE(li.is_nhs, false) = true
),
invoice_private AS (
  SELECT
    organization_id,
    invoice_id,
    COALESCE(SUM(item_amount), 0)::numeric(15, 2) AS private_revenue
  FROM private_items
  GROUP BY organization_id, invoice_id
),
invoice_nhs AS (
  SELECT
    organization_id,
    invoice_id,
    COALESCE(SUM(item_amount), 0)::numeric(15, 2) AS nhs_revenue
  FROM nhs_items
  GROUP BY organization_id, invoice_id
),
-- Catalog costs on PRIVATE lines only (never NHS) via TPI → treatments,
-- falling back to line.treatment_id → treatments.external_id.
private_catalog_costs AS (
  SELECT
    pi.organization_id,
    pi.invoice_id,
    COALESCE(SUM(COALESCE(t.lab_bill, 0)), 0)::numeric(15, 2) AS lab_cost,
    COALESCE(SUM(COALESCE(t.material_cost, 0)), 0)::numeric(15, 2) AS materials_cost
  FROM private_items pi
  LEFT JOIN public.treatment_plan_items tpi
    ON tpi.organization_id = pi.organization_id
   AND pi.tpi_ext_id IS NOT NULL
   AND tpi.tpi_id = pi.tpi_ext_id::bigint
  LEFT JOIN public.treatments t
    ON t.organization_id = pi.organization_id
   AND t.deleted_at IS NULL
   AND (
     (tpi.tpi_treatment_id IS NOT NULL AND t.external_id = tpi.tpi_treatment_id)
     OR (
       tpi.tpi_treatment_id IS NULL
       AND pi.treatment_ext_id IS NOT NULL
       AND t.external_id::text = pi.treatment_ext_id
     )
   )
  GROUP BY pi.organization_id, pi.invoice_id
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
),
invoice_resolved AS (
  SELECT
    i.organization_id,
    i.id AS invoice_id,
    i.platform_invoice_id,
    i.invoice_date,
    i.patient_id,
    COALESCE(ip.private_revenue, 0)::numeric(15, 2) AS private_revenue,
    COALESCE(inh.nhs_revenue, 0)::numeric(15, 2) AS nhs_revenue,
    COALESCE(cc.lab_cost, 0)::numeric(15, 2) AS lab_cost,
    COALESCE(cc.materials_cost, 0)::numeric(15, 2) AS materials_cost,
    d.provider_id AS dominant_provider_id,
    CASE
      WHEN d.provider_id IS NOT NULL THEN COALESCE(r.rate, 0)
      ELSE 0
    END::numeric(5, 2) AS effective_rate,
    (d.provider_id IS NOT NULL AND r.rate IS NULL) AS rate_was_defaulted,
    (d.provider_id IS NULL) AS missing_practitioner
  FROM public.platform_integration_invoices i
  LEFT JOIN invoice_private ip
    ON ip.organization_id = i.organization_id
   AND ip.invoice_id = i.id
  LEFT JOIN invoice_nhs inh
    ON inh.organization_id = i.organization_id
   AND inh.invoice_id = i.id
  LEFT JOIN private_catalog_costs cc
    ON cc.organization_id = i.organization_id
   AND cc.invoice_id = i.id
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
)
SELECT
  ir.organization_id AS practice_id,
  ir.invoice_id,
  ir.platform_invoice_id,
  ir.invoice_date,
  pt.id AS patient_id,
  ir.patient_id::bigint AS pt_id,
  -- Strict split: contribution uses ONLY revenue_private_plan
  ir.private_revenue AS revenue_private_plan,
  ir.nhs_revenue AS revenue_nhs,
  ir.nhs_revenue AS nhs_excluded_amount,
  (ir.private_revenue > 0) AS is_private_or_plan,
  (ir.nhs_revenue > 0) AS is_nhs,
  ir.dominant_provider_id AS dominant_practitioner_id,
  ir.effective_rate AS private_share_rate,
  CASE
    WHEN ir.private_revenue > 0 AND ir.missing_practitioner
    THEN true ELSE false
  END AS has_missing_practitioner,
  COALESCE(ir.rate_was_defaulted, false) AS has_missing_rate,
  CASE
    WHEN ir.private_revenue > 0 AND ir.missing_practitioner
    THEN ir.private_revenue
    ELSE 0
  END::numeric(15, 2) AS revenue_no_practitioner,
  CASE
    WHEN ir.rate_was_defaulted THEN ir.private_revenue
    ELSE 0
  END::numeric(15, 2) AS revenue_missing_rate,
  CASE
    WHEN ir.missing_practitioner THEN 0::numeric(15, 2)
    ELSE ROUND(ir.private_revenue * (ir.effective_rate / 100.0), 2)::numeric(15, 2)
  END AS clinician_cost,
  ir.lab_cost,
  ir.materials_cost,
  -- Patient-level overheads; reserved at invoice grain (assumptions table ready)
  0::numeric(15, 2) AS membership_service_cost,
  0::numeric(15, 2) AS allocated_cac,
  (
    CASE
      WHEN ir.missing_practitioner THEN 0::numeric(15, 2)
      ELSE ROUND(ir.private_revenue * (ir.effective_rate / 100.0), 2)
    END
    + ir.lab_cost
    + ir.materials_cost
    + 0::numeric(15, 2)  -- membership_service_cost
    + 0::numeric(15, 2)  -- allocated_cac
  )::numeric(15, 2) AS direct_cost,
  (
    ir.private_revenue
    - (
      CASE
        WHEN ir.missing_practitioner THEN 0::numeric(15, 2)
        ELSE ROUND(ir.private_revenue * (ir.effective_rate / 100.0), 2)
      END
      + ir.lab_cost
      + ir.materials_cost
      + 0::numeric(15, 2)
      + 0::numeric(15, 2)
    )
  )::numeric(15, 2) AS contribution,
  CASE
    WHEN ir.private_revenue > 0 AND ir.missing_practitioner
    THEN 'partial_no_practitioner'
    WHEN ir.rate_was_defaulted
    THEN 'partial_missing_rate'
    ELSE 'complete'
  END::text AS contribution_provenance_status,
  -- Per-field provenance tiers (D11 PM — chip data for Step 1b UI).
  -- Values: Dentally | Derived | Modelled | External (mockup / Settings glossary).
  'Dentally'::text AS revenue_tier,
  -- clinician_cost_tier judgment: methodology lists associate pay as External
  -- (Settings/contract, not Dentally). We still emit Derived when attribution
  -- succeeds because the £ is deterministic (private_revenue × rate), not a
  -- Modelled probability. Incomplete → External (missing practitioner/rate).
  CASE
    WHEN ir.private_revenue > 0
         AND NOT ir.missing_practitioner
         AND NOT COALESCE(ir.rate_was_defaulted, false)
    THEN 'Derived'
    WHEN ir.private_revenue > 0
    THEN 'External'
    ELSE 'Derived'
  END::text AS clinician_cost_tier,
  -- Catalog / assumptions until live cost feeds (Phase 2 Xero → External).
  'Modelled'::text AS lab_cost_tier,
  'Modelled'::text AS material_cost_tier,
  'Modelled'::text AS membership_service_cost_tier,
  'Modelled'::text AS allocated_cac_tier,
  'Derived'::text AS contribution_tier,
  -- confidence_score 0–100: no Day-1 PE scorer exists; composite heuristic
  -- weighted toward complete Dentally revenue + Derived clinician attribution.
  -- Modelled cost legs keep a complete row below 100 until live feeds land.
  CASE
    WHEN ir.private_revenue <= 0 THEN 100
    WHEN ir.missing_practitioner THEN 40
    WHEN COALESCE(ir.rate_was_defaulted, false) THEN 55
    ELSE 85
  END::integer AS confidence_score,
  -- Legacy stub kept for older readers; prefer contribution_tier.
  'derived'::text AS confidence
FROM invoice_resolved ir
LEFT JOIN LATERAL (
  SELECT p.id
  FROM public.patients p
  WHERE p.organization_id = ir.organization_id
    AND p.pt_id = ir.patient_id::bigint
    AND p.deleted_at IS NULL
  ORDER BY p.id
  LIMIT 1
) pt ON true;

COMMENT ON VIEW public.v_invoice_contribution IS
  'PE invoice contribution: private/plan revenue (is_nhs=false lines only) − clinician − lab − materials − membership − CAC. NHS line revenue exposed separately (revenue_nhs); never blended into contribution. Per-field provenance tiers (revenue/clinician/lab/…) + confidence_score for UI chips. security_invoker for org RLS.';

GRANT SELECT ON public.v_invoice_contribution TO authenticated;
GRANT SELECT ON public.v_invoice_contribution TO service_role;
