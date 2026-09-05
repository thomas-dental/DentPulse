-- Fast incremental contribution-facts refresh for Dentally payment webhooks.
-- Replaces full-practice delete/rescan (4016+ rows) with scoped upserts.

CREATE INDEX IF NOT EXISTS idx_pe_invoice_facts_practice_platform_id
  ON public.pe_invoice_contribution_facts (practice_id, platform_invoice_id);

CREATE INDEX IF NOT EXISTS idx_dentally_payments_org_dp
  ON public.dentally_payments (organization_id, dp_id);

-- ---------------------------------------------------------------------------
-- Invoice ids previously linked to a payment (single query vs 2 round trips)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pe_webhook_payment_invoice_ids(
  p_practice_id UUID,
  p_dp_id BIGINT
)
RETURNS BIGINT[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    array_agg(DISTINCT e.dpe_invoice_id ORDER BY e.dpe_invoice_id)
      FILTER (WHERE e.dpe_invoice_id IS NOT NULL AND e.dpe_invoice_id > 0),
    '{}'::bigint[]
  )
  FROM public.dentally_payments p
  JOIN public.dentally_payment_explanations e
    ON e.payment_id = p.id
   AND e.organization_id = p.organization_id
  WHERE p.organization_id = p_practice_id
    AND p.dp_id = p_dp_id;
$$;

GRANT EXECUTE ON FUNCTION public.pe_webhook_payment_invoice_ids(UUID, BIGINT)
  TO service_role;

-- ---------------------------------------------------------------------------
-- Incremental facts refresh for touched platform invoice ids
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pe_webhook_refresh_contribution_facts(
  p_practice_id UUID,
  p_platform_invoice_ids TEXT[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice_count integer := 0;
  v_patient_count integer := 0;
  v_ids text[];
BEGIN
  PERFORM set_config('statement_timeout', '90000', true);

  v_ids := ARRAY(
    SELECT DISTINCT NULLIF(BTRIM(x), '')
    FROM unnest(COALESCE(p_platform_invoice_ids, '{}'::text[])) AS x
    WHERE NULLIF(BTRIM(x), '') IS NOT NULL
  );

  IF array_length(v_ids, 1) IS NULL OR array_length(v_ids, 1) = 0 THEN
    RETURN jsonb_build_object(
      'invoiceCount', 0,
      'patientCount', 0,
      'skipped', true
    );
  END IF;

  -- 1) Upsert invoice facts for touched invoices only (from live view)
  INSERT INTO public.pe_invoice_contribution_facts (
    practice_id, invoice_id, platform_invoice_id, invoice_date, patient_id, pt_id,
    revenue_private_plan, revenue_nhs, nhs_excluded_amount, is_private_or_plan, is_nhs,
    dominant_practitioner_id, private_share_rate, has_missing_practitioner, has_missing_rate,
    revenue_no_practitioner, revenue_missing_rate, clinician_cost, lab_cost, materials_cost,
    membership_service_cost, allocated_cac, direct_cost, contribution,
    contribution_provenance_status, revenue_tier, clinician_cost_tier, lab_cost_tier,
    material_cost_tier, membership_service_cost_tier, allocated_cac_tier, contribution_tier,
    confidence_score, confidence, is_paid, status, refreshed_at
  )
  SELECT
    v.practice_id, v.invoice_id, v.platform_invoice_id, v.invoice_date, v.patient_id, v.pt_id,
    COALESCE(v.revenue_private_plan, 0), COALESCE(v.revenue_nhs, 0), COALESCE(v.nhs_excluded_amount, 0),
    COALESCE(v.is_private_or_plan, false), COALESCE(v.is_nhs, false),
    v.dominant_practitioner_id, v.private_share_rate,
    COALESCE(v.has_missing_practitioner, false), COALESCE(v.has_missing_rate, false),
    COALESCE(v.revenue_no_practitioner, 0), COALESCE(v.revenue_missing_rate, 0),
    COALESCE(v.clinician_cost, 0), COALESCE(v.lab_cost, 0), COALESCE(v.materials_cost, 0),
    COALESCE(v.membership_service_cost, 0), COALESCE(v.allocated_cac, 0), COALESCE(v.direct_cost, 0),
    COALESCE(v.contribution, 0),
    COALESCE(v.contribution_provenance_status, 'complete'),
    v.revenue_tier, v.clinician_cost_tier, v.lab_cost_tier, v.material_cost_tier,
    v.membership_service_cost_tier, v.allocated_cac_tier, v.contribution_tier,
    v.confidence_score, v.confidence, COALESCE(v.is_paid, false), v.status, NOW()
  FROM public.v_invoice_contribution v
  WHERE v.practice_id = p_practice_id
    AND v.platform_invoice_id = ANY(v_ids)
  ON CONFLICT (practice_id, invoice_id) DO UPDATE SET
    platform_invoice_id = EXCLUDED.platform_invoice_id,
    invoice_date = EXCLUDED.invoice_date,
    patient_id = EXCLUDED.patient_id,
    pt_id = EXCLUDED.pt_id,
    revenue_private_plan = EXCLUDED.revenue_private_plan,
    revenue_nhs = EXCLUDED.revenue_nhs,
    nhs_excluded_amount = EXCLUDED.nhs_excluded_amount,
    is_private_or_plan = EXCLUDED.is_private_or_plan,
    is_nhs = EXCLUDED.is_nhs,
    dominant_practitioner_id = EXCLUDED.dominant_practitioner_id,
    private_share_rate = EXCLUDED.private_share_rate,
    has_missing_practitioner = EXCLUDED.has_missing_practitioner,
    has_missing_rate = EXCLUDED.has_missing_rate,
    revenue_no_practitioner = EXCLUDED.revenue_no_practitioner,
    revenue_missing_rate = EXCLUDED.revenue_missing_rate,
    clinician_cost = EXCLUDED.clinician_cost,
    lab_cost = EXCLUDED.lab_cost,
    materials_cost = EXCLUDED.materials_cost,
    membership_service_cost = EXCLUDED.membership_service_cost,
    allocated_cac = EXCLUDED.allocated_cac,
    direct_cost = EXCLUDED.direct_cost,
    contribution = EXCLUDED.contribution,
    contribution_provenance_status = EXCLUDED.contribution_provenance_status,
    revenue_tier = EXCLUDED.revenue_tier,
    clinician_cost_tier = EXCLUDED.clinician_cost_tier,
    lab_cost_tier = EXCLUDED.lab_cost_tier,
    material_cost_tier = EXCLUDED.material_cost_tier,
    membership_service_cost_tier = EXCLUDED.membership_service_cost_tier,
    allocated_cac_tier = EXCLUDED.allocated_cac_tier,
    contribution_tier = EXCLUDED.contribution_tier,
    confidence_score = EXCLUDED.confidence_score,
    confidence = EXCLUDED.confidence,
    is_paid = EXCLUDED.is_paid,
    status = EXCLUDED.status,
    refreshed_at = NOW();

  GET DIAGNOSTICS v_invoice_count = ROW_COUNT;

  -- 2) Re-aggregate patient facts for grains touched by these invoices
  WITH touched AS (
    SELECT DISTINCT
      COALESCE(f.patient_id::text, 'pt:' || f.pt_id::text) AS grain_key
    FROM public.pe_invoice_contribution_facts f
    WHERE f.practice_id = p_practice_id
      AND f.platform_invoice_id = ANY(v_ids)
      AND (f.patient_id IS NOT NULL OR f.pt_id IS NOT NULL)
  ),
  agg AS (
    SELECT
      f.practice_id,
      MAX(f.patient_id::text)::uuid AS patient_id,
      MAX(f.pt_id) AS pt_id,
      COALESCE(SUM(f.contribution) FILTER (WHERE f.is_paid), 0)::numeric(15, 2) AS contribution,
      COALESCE(SUM(f.revenue_private_plan) FILTER (WHERE f.is_paid), 0)::numeric(15, 2)
        AS revenue_private_plan,
      COUNT(*) FILTER (WHERE f.is_paid)::bigint AS invoice_count,
      ROUND(AVG(f.confidence_score) FILTER (WHERE f.is_paid))::integer AS confidence_score,
      MIN(f.invoice_date) FILTER (WHERE f.is_paid) AS first_activity_date
    FROM public.pe_invoice_contribution_facts f
    INNER JOIN touched t
      ON COALESCE(f.patient_id::text, 'pt:' || f.pt_id::text) = t.grain_key
    WHERE f.practice_id = p_practice_id
    GROUP BY f.practice_id, COALESCE(f.patient_id::text, 'pt:' || f.pt_id::text)
  )
  INSERT INTO public.pe_patient_contribution_facts (
    practice_id, patient_id, pt_id, retention_status,
    contribution, revenue_private_plan, invoice_count, confidence_score,
    location_id, first_activity_date, tenure_years, refreshed_at
  )
  SELECT
    a.practice_id,
    a.patient_id,
    a.pt_id,
    COALESCE(rs.retention_status, 'active'),
    a.contribution,
    a.revenue_private_plan,
    a.invoice_count,
    a.confidence_score,
    p.location_id,
    a.first_activity_date,
    CASE
      WHEN a.first_activity_date IS NOT NULL
      THEN ROUND(
        (CURRENT_DATE - a.first_activity_date)::numeric / 365.25,
        2
      )
      ELSE NULL
    END,
    NOW()
  FROM agg a
  LEFT JOIN public.patients p
    ON p.id = a.patient_id
   AND p.organization_id = a.practice_id
   AND p.deleted_at IS NULL
  LEFT JOIN public.v_pe_retention_segment rs
    ON rs.practice_id = a.practice_id
   AND rs.patient_id IS NOT DISTINCT FROM a.patient_id
   AND rs.pt_id IS NOT DISTINCT FROM a.pt_id
  ON CONFLICT (practice_id, grain_key) DO UPDATE SET
    patient_id = EXCLUDED.patient_id,
    pt_id = EXCLUDED.pt_id,
    retention_status = EXCLUDED.retention_status,
    contribution = EXCLUDED.contribution,
    revenue_private_plan = EXCLUDED.revenue_private_plan,
    invoice_count = EXCLUDED.invoice_count,
    confidence_score = EXCLUDED.confidence_score,
    location_id = EXCLUDED.location_id,
    first_activity_date = EXCLUDED.first_activity_date,
    tenure_years = EXCLUDED.tenure_years,
    refreshed_at = NOW();

  GET DIAGNOSTICS v_patient_count = ROW_COUNT;

  -- 3) Practice rollup — single aggregate over facts (paid invoices)
  INSERT INTO public.pe_practice_contribution_facts (
    practice_id, invoice_count, invoices_with_revenue, patient_count, patients_with_revenue,
    revenue_private_plan, clinician_cost, direct_cost, contribution, margin_pct,
    invoices_complete, invoices_partial_no_practitioner, invoices_partial_missing_rate,
    pct_complete, pct_partial_no_practitioner, pct_partial_missing_rate,
    contribution_provenance_status, refreshed_at
  )
  SELECT
    p_practice_id,
    COUNT(*)::bigint,
    COUNT(*) FILTER (WHERE f.revenue_private_plan > 0)::bigint,
    COUNT(DISTINCT f.patient_id)::bigint,
    COUNT(DISTINCT f.patient_id) FILTER (WHERE f.revenue_private_plan > 0)::bigint,
    COALESCE(SUM(f.revenue_private_plan), 0)::numeric(15, 2),
    COALESCE(SUM(f.clinician_cost), 0)::numeric(15, 2),
    COALESCE(SUM(f.direct_cost), 0)::numeric(15, 2),
    COALESCE(SUM(f.contribution), 0)::numeric(15, 2),
    CASE
      WHEN SUM(f.revenue_private_plan) > 0
      THEN ROUND((SUM(f.contribution) / SUM(f.revenue_private_plan)) * 100, 1)
      ELSE NULL
    END,
    COUNT(*) FILTER (
      WHERE f.revenue_private_plan > 0 AND f.contribution_provenance_status = 'complete'
    )::bigint,
    COUNT(*) FILTER (
      WHERE f.revenue_private_plan > 0
        AND f.contribution_provenance_status = 'partial_no_practitioner'
    )::bigint,
    COUNT(*) FILTER (
      WHERE f.revenue_private_plan > 0
        AND f.contribution_provenance_status = 'partial_missing_rate'
    )::bigint,
    CASE
      WHEN COUNT(*) FILTER (WHERE f.revenue_private_plan > 0) > 0 THEN
        ROUND(
          100.0 * COUNT(*) FILTER (
            WHERE f.revenue_private_plan > 0
              AND f.contribution_provenance_status = 'complete'
          ) / NULLIF(COUNT(*) FILTER (WHERE f.revenue_private_plan > 0), 0),
          1
        )
      ELSE NULL
    END,
    CASE
      WHEN COUNT(*) FILTER (
        WHERE f.revenue_private_plan > 0
          AND f.contribution_provenance_status = 'partial_no_practitioner'
      ) > 0 THEN
        ROUND(
          100.0 * COUNT(*) FILTER (
            WHERE f.revenue_private_plan > 0
              AND f.contribution_provenance_status = 'partial_no_practitioner'
          ) / NULLIF(COUNT(*) FILTER (WHERE f.revenue_private_plan > 0), 0),
          1
        )
      ELSE NULL
    END,
    CASE
      WHEN COUNT(*) FILTER (
        WHERE f.revenue_private_plan > 0
          AND f.contribution_provenance_status = 'partial_missing_rate'
      ) > 0 THEN
        ROUND(
          100.0 * COUNT(*) FILTER (
            WHERE f.revenue_private_plan > 0
              AND f.contribution_provenance_status = 'partial_missing_rate'
          ) / NULLIF(COUNT(*) FILTER (WHERE f.revenue_private_plan > 0), 0),
          1
        )
      ELSE NULL
    END,
    CASE
      WHEN COUNT(*) FILTER (
        WHERE f.contribution_provenance_status = 'partial_no_practitioner'
      ) > 0 THEN 'partial_no_practitioner'
      WHEN COUNT(*) FILTER (
        WHERE f.contribution_provenance_status = 'partial_missing_rate'
      ) > 0 THEN 'partial_missing_rate'
      ELSE 'complete'
    END,
    NOW()
  FROM public.pe_invoice_contribution_facts f
  WHERE f.practice_id = p_practice_id
    AND f.is_paid = true
  ON CONFLICT (practice_id) DO UPDATE SET
    invoice_count = EXCLUDED.invoice_count,
    invoices_with_revenue = EXCLUDED.invoices_with_revenue,
    patient_count = EXCLUDED.patient_count,
    patients_with_revenue = EXCLUDED.patients_with_revenue,
    revenue_private_plan = EXCLUDED.revenue_private_plan,
    clinician_cost = EXCLUDED.clinician_cost,
    direct_cost = EXCLUDED.direct_cost,
    contribution = EXCLUDED.contribution,
    margin_pct = EXCLUDED.margin_pct,
    invoices_complete = EXCLUDED.invoices_complete,
    invoices_partial_no_practitioner = EXCLUDED.invoices_partial_no_practitioner,
    invoices_partial_missing_rate = EXCLUDED.invoices_partial_missing_rate,
    pct_complete = EXCLUDED.pct_complete,
    pct_partial_no_practitioner = EXCLUDED.pct_partial_no_practitioner,
    pct_partial_missing_rate = EXCLUDED.pct_partial_missing_rate,
    contribution_provenance_status = EXCLUDED.contribution_provenance_status,
    refreshed_at = NOW();

  RETURN jsonb_build_object(
    'invoiceCount', v_invoice_count,
    'patientCount', v_patient_count,
    'platformInvoiceIds', to_jsonb(v_ids)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.pe_webhook_refresh_contribution_facts(UUID, TEXT[])
  TO service_role;

COMMENT ON FUNCTION public.pe_webhook_payment_invoice_ids(UUID, BIGINT) IS
  'Returns Dentally invoice ids linked to a payment — used by payment webhook delete path.';

COMMENT ON FUNCTION public.pe_webhook_refresh_contribution_facts(UUID, TEXT[]) IS
  'Incremental PE facts refresh after payment webhook: upsert touched invoice facts, re-aggregate affected patients, refresh practice rollup.';
