-- ============================================================================
-- PE invoice contribution: expose is_paid / status; Existing Patient Value = paid only
-- ============================================================================

-- 1. Facts columns
ALTER TABLE public.pe_invoice_contribution_facts
  ADD COLUMN IF NOT EXISTS is_paid boolean NOT NULL DEFAULT false;

ALTER TABLE public.pe_invoice_contribution_facts
  ADD COLUMN IF NOT EXISTS status text;

CREATE INDEX IF NOT EXISTS idx_pe_invoice_facts_practice_paid_date
  ON public.pe_invoice_contribution_facts (practice_id, is_paid, invoice_date);

COMMENT ON COLUMN public.pe_invoice_contribution_facts.is_paid IS
  'From platform_integration_invoices.is_paid (Dentally fully paid). Unpaid rows kept for worklists; EPV / summary RPCs filter is_paid = true.';

COMMENT ON COLUMN public.pe_invoice_contribution_facts.status IS
  'From platform_integration_invoices.status (draft/sent/paid/…).';

-- 2. Recreate invoice view with is_paid + status (append columns; dependents keep working)
CREATE OR REPLACE VIEW public.v_invoice_contribution
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
    COALESCE(i.is_paid, false) AS is_paid,
    i.status,
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
  0::numeric(15, 2) AS membership_service_cost,
  0::numeric(15, 2) AS allocated_cac,
  (
    CASE
      WHEN ir.missing_practitioner THEN 0::numeric(15, 2)
      ELSE ROUND(ir.private_revenue * (ir.effective_rate / 100.0), 2)
    END
    + ir.lab_cost
    + ir.materials_cost
    + 0::numeric(15, 2)
    + 0::numeric(15, 2)
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
  'Dentally'::text AS revenue_tier,
  CASE
    WHEN ir.private_revenue > 0
         AND NOT ir.missing_practitioner
         AND NOT COALESCE(ir.rate_was_defaulted, false)
    THEN 'Derived'
    WHEN ir.private_revenue > 0
    THEN 'External'
    ELSE 'Derived'
  END::text AS clinician_cost_tier,
  'Modelled'::text AS lab_cost_tier,
  'Modelled'::text AS material_cost_tier,
  'Modelled'::text AS membership_service_cost_tier,
  'Modelled'::text AS allocated_cac_tier,
  'Derived'::text AS contribution_tier,
  CASE
    WHEN ir.private_revenue <= 0 THEN 100
    WHEN ir.missing_practitioner THEN 40
    WHEN COALESCE(ir.rate_was_defaulted, false) THEN 55
    ELSE 85
  END::integer AS confidence_score,
  'derived'::text AS confidence,
  ir.is_paid,
  ir.status
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
  'PE invoice contribution: private/plan revenue − costs; NHS separate. Includes is_paid/status from platform invoices. Existing Patient Value / summary RPCs use is_paid = true only.';

GRANT SELECT ON public.v_invoice_contribution TO authenticated;
GRANT SELECT ON public.v_invoice_contribution TO service_role;

-- 3. Summary RPC — paid invoices only (Existing Patient Value + revenue mix)
CREATE OR REPLACE FUNCTION public.pe_invoice_contribution_summary(
  p_practice_id UUID,
  p_location_id UUID DEFAULT NULL,
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  use_facts boolean;
  result JSONB;
  revenue_plan numeric;
  revenue_private numeric;
  total_revenue numeric;
BEGIN
  use_facts := public.pe_invoice_source_has_facts(p_practice_id);

  IF use_facts THEN
    SELECT
      COALESCE(SUM(f.revenue_private_plan) FILTER (
        WHERE f.revenue_private_plan > 0
          AND f.pt_id IS NOT NULL
          AND f.pt_id IN (
            SELECT p.pt_id
            FROM public.patients p
            WHERE p.organization_id = p_practice_id
              AND p.deleted_at IS NULL
              AND (p_location_id IS NULL OR p.location_id = p_location_id)
              AND p.pt_payment_plan_id IN (
                SELECT public.pe_membership_plan_pp_ids(p_practice_id)
              )
          )
      ), 0),
      COALESCE(SUM(f.revenue_private_plan) FILTER (
        WHERE f.revenue_private_plan > 0
          AND (
            f.pt_id IS NULL
            OR f.pt_id NOT IN (
              SELECT p.pt_id
              FROM public.patients p
              WHERE p.organization_id = p_practice_id
                AND p.deleted_at IS NULL
                AND (p_location_id IS NULL OR p.location_id = p_location_id)
                AND p.pt_payment_plan_id IN (
                  SELECT public.pe_membership_plan_pp_ids(p_practice_id)
                )
            )
          )
      ), 0),
      COALESCE(SUM(f.revenue_private_plan), 0)
    INTO revenue_plan, revenue_private, total_revenue
    FROM public.pe_invoice_contribution_facts f
    LEFT JOIN public.patients p
      ON p.id = f.patient_id
     AND p.organization_id = f.practice_id
     AND p.deleted_at IS NULL
    WHERE f.practice_id = p_practice_id
      AND f.is_paid = true
      AND (p_start_date IS NULL OR f.invoice_date >= p_start_date)
      AND (p_end_date IS NULL OR f.invoice_date <= p_end_date)
      AND (p_location_id IS NULL OR p.location_id = p_location_id);

    IF revenue_plan = 0 AND revenue_private = 0 AND total_revenue > 0 THEN
      revenue_private := total_revenue;
    END IF;

    SELECT jsonb_build_object(
      'invoice_count', COUNT(*)::bigint,
      'invoices_with_revenue', COUNT(*) FILTER (WHERE revenue_private_plan > 0)::bigint,
      'patient_count', COUNT(DISTINCT patient_id)::bigint,
      'patients_with_revenue', COUNT(DISTINCT patient_id) FILTER (WHERE revenue_private_plan > 0)::bigint,
      'total_contribution', COALESCE(SUM(contribution), 0),
      'total_revenue', COALESCE(SUM(revenue_private_plan), 0),
      'revenue_nhs', COALESCE(SUM(revenue_nhs), 0),
      'revenue_private', revenue_private,
      'revenue_plan', revenue_plan,
      'invoices_missing_practitioner', COUNT(*) FILTER (WHERE has_missing_practitioner)::bigint,
      'invoices_missing_rate', COUNT(*) FILTER (WHERE has_missing_rate)::bigint,
      'revenue_no_practitioner', COALESCE(SUM(revenue_no_practitioner), 0),
      'revenue_missing_rate', COALESCE(SUM(revenue_missing_rate), 0)
    )
    INTO result
    FROM public.pe_invoice_contribution_facts f
    LEFT JOIN public.patients p
      ON p.id = f.patient_id
     AND p.organization_id = f.practice_id
     AND p.deleted_at IS NULL
    WHERE f.practice_id = p_practice_id
      AND f.is_paid = true
      AND (p_start_date IS NULL OR f.invoice_date >= p_start_date)
      AND (p_end_date IS NULL OR f.invoice_date <= p_end_date)
      AND (p_location_id IS NULL OR p.location_id = p_location_id);
  ELSE
    SELECT jsonb_build_object(
      'invoice_count', COUNT(*)::bigint,
      'invoices_with_revenue', COUNT(*) FILTER (WHERE v.revenue_private_plan > 0)::bigint,
      'patient_count', COUNT(DISTINCT v.patient_id)::bigint,
      'patients_with_revenue', COUNT(DISTINCT v.patient_id) FILTER (WHERE v.revenue_private_plan > 0)::bigint,
      'total_contribution', COALESCE(SUM(v.contribution), 0),
      'total_revenue', COALESCE(SUM(v.revenue_private_plan), 0),
      'revenue_nhs', COALESCE(SUM(v.revenue_nhs), 0),
      'revenue_private', COALESCE(SUM(v.revenue_private_plan), 0),
      'revenue_plan', 0,
      'invoices_missing_practitioner', COUNT(*) FILTER (WHERE v.has_missing_practitioner)::bigint,
      'invoices_missing_rate', COUNT(*) FILTER (WHERE v.has_missing_rate)::bigint,
      'revenue_no_practitioner', COALESCE(SUM(v.revenue_no_practitioner), 0),
      'revenue_missing_rate', COALESCE(SUM(v.revenue_missing_rate), 0)
    )
    INTO result
    FROM public.v_invoice_contribution v
    LEFT JOIN public.patients p
      ON p.id = v.patient_id
     AND p.organization_id = v.practice_id
     AND p.deleted_at IS NULL
    WHERE v.practice_id = p_practice_id
      AND v.is_paid = true
      AND (p_start_date IS NULL OR v.invoice_date >= p_start_date)
      AND (p_end_date IS NULL OR v.invoice_date <= p_end_date)
      AND (
        p_location_id IS NULL
        OR p.location_id = p_location_id
      );
  END IF;

  RETURN COALESCE(result, '{}'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.pe_invoice_contribution_summary(UUID, UUID, DATE, DATE)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.pe_invoice_contribution_summary(UUID, UUID, DATE, DATE) IS
  'PE invoice contribution + revenue mix for Existing Patient Value. Fully paid invoices only (is_paid = true); NHS/UDA never blended into contribution.';
