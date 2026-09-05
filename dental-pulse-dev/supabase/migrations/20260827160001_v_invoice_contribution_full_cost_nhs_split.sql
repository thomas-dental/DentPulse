-- ============================================================================
-- Patient Economics — v_invoice_contribution: full direct cost + strict NHS split
--
-- Extends Day 1 / invoice-grain contribution:
--   direct_cost = clinician + lab + materials + membership_service + allocated_cac
--   contribution = revenue_private_plan − direct_cost
--
-- Strict never-blended split IN THE VIEW:
--   private_items  WHERE is_nhs = false  → revenue_private_plan (only base for costs)
--   nhs_items      WHERE is_nhs = true   → revenue_nhs (informational only)
--   Never uses subtotal − nhs_amount blending for contribution math.
--
-- Lab / materials: treatments catalog via private line → treatment_plan_item_id
--   → treatment_plan_items.tpi_treatment_id → treatments.external_id.
-- Membership svc + CAC: pe_economic_assumptions exists for Settings; at invoice
--   grain these stay 0 (patient-level overheads in the mockup — allocate later).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.pe_economic_assumptions (
  practice_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  membership_service_cost_annual numeric(15, 2) NOT NULL DEFAULT 0,
  default_cac numeric(15, 2) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.pe_economic_assumptions IS
  'PE Economic Assumptions: practice-level membership service cost (£/yr) and default CAC. Invoice view keeps membership/CAC at 0 until patient-level allocation lands.';

ALTER TABLE public.pe_economic_assumptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view pe economic assumptions for their practice"
  ON public.pe_economic_assumptions;
CREATE POLICY "Users can view pe economic assumptions for their practice"
  ON public.pe_economic_assumptions
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND public.user_in_org(auth.uid(), practice_id)
  );

DROP POLICY IF EXISTS "Users can upsert pe economic assumptions for their practice"
  ON public.pe_economic_assumptions;
CREATE POLICY "Users can upsert pe economic assumptions for their practice"
  ON public.pe_economic_assumptions
  FOR ALL
  TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND public.user_in_org(auth.uid(), practice_id)
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND public.user_in_org(auth.uid(), practice_id)
  );

GRANT SELECT, INSERT, UPDATE ON public.pe_economic_assumptions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pe_economic_assumptions TO service_role;

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
  'PE invoice contribution: private/plan revenue (is_nhs=false lines only) − clinician − lab − materials − membership − CAC. NHS line revenue exposed separately (revenue_nhs); never blended into contribution. security_invoker for org RLS.';

GRANT SELECT ON public.v_invoice_contribution TO authenticated;
GRANT SELECT ON public.v_invoice_contribution TO service_role;
