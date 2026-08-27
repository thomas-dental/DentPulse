-- ============================================================================
-- Patient Economics — v_invoice_contribution: always compute contribution
--
-- Rules:
--   - No clinician → clinician_cost = 0, contribution = full private revenue
--   - Clinician but no rate → private_share_rate defaults to 0, same math
--   - Flags (has_missing_practitioner / has_missing_rate) stay for Settings UI
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
),
invoice_resolved AS (
  SELECT
    i.organization_id,
    i.id AS invoice_id,
    i.platform_invoice_id,
    i.invoice_date,
    i.patient_id,
    i.nhs_amount,
    COALESCE(ip.private_revenue, 0)::numeric(15, 2) AS private_revenue,
    d.provider_id AS dominant_provider_id,
    -- Rate defaults to 0 when unset; no clinician ⇒ treat as 0 cost (rate display 0)
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
  ir.private_revenue AS revenue_private_plan,
  COALESCE(ir.nhs_amount, 0)::numeric(15, 2) AS nhs_excluded_amount,
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
  -- No clinician ⇒ cost 0; with clinician ⇒ revenue × rate/100 (rate may be 0 default)
  CASE
    WHEN ir.missing_practitioner THEN 0::numeric(15, 2)
    ELSE ROUND(ir.private_revenue * (ir.effective_rate / 100.0), 2)::numeric(15, 2)
  END AS clinician_cost,
  0::numeric(15, 2) AS lab_cost,
  CASE
    WHEN ir.missing_practitioner THEN 0::numeric(15, 2)
    ELSE ROUND(ir.private_revenue * (ir.effective_rate / 100.0), 2)::numeric(15, 2)
  END AS direct_cost,
  -- Always: contribution = private revenue − clinician cost (never forced to 0)
  (
    ir.private_revenue
    - CASE
        WHEN ir.missing_practitioner THEN 0::numeric(15, 2)
        ELSE ROUND(ir.private_revenue * (ir.effective_rate / 100.0), 2)
      END
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
  'PE invoice contribution: one row per invoice. clinician_cost = 0 when no clinician or rate defaults to 0; contribution = private revenue − clinician_cost (always). Flags mark data gaps for Settings. security_invoker for org RLS.';

GRANT SELECT ON public.v_invoice_contribution TO authenticated;
GRANT SELECT ON public.v_invoice_contribution TO service_role;
