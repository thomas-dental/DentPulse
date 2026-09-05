-- Financial roster page: pe_patient_roster_page (already paged) + view overlay on those rows only.
-- Avoids Node chunked v_patient_financial_record + full-ledger commitment weighting.

CREATE OR REPLACE FUNCTION public.pe_patient_financial_roster_page(
  p_practice_id UUID,
  p_location_id UUID DEFAULT NULL,
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_retention_filter TEXT DEFAULT 'all',
  p_type_filter TEXT DEFAULT 'all',
  p_sort_key TEXT DEFAULT 'contribution',
  p_sort_dir TEXT DEFAULT 'desc',
  p_limit INT DEFAULT 25,
  p_offset INT DEFAULT 0,
  p_metrics_since DATE DEFAULT NULL
)
RETURNS TABLE (
  patient_id UUID,
  pt_id BIGINT,
  patient_name TEXT,
  patient_uuid TEXT,
  location_id UUID,
  location_name TEXT,
  is_active BOOLEAN,
  has_payment_plan BOOLEAN,
  retention_status TEXT,
  contribution NUMERIC(15, 2),
  revenue_private_plan NUMERIC(15, 2),
  invoice_count BIGINT,
  confidence_score INTEGER,
  clinician_cost NUMERIC(15, 2),
  direct_cost NUMERIC(15, 2),
  margin_pct NUMERIC(15, 2),
  contribution_12mo NUMERIC(15, 2),
  visits_12mo BIGINT,
  visit_freq_per_year NUMERIC(15, 2),
  value_per_visit NUMERIC(15, 2),
  opportunity_gross NUMERIC(15, 2),
  quality_score INTEGER,
  patient_economic_value NUMERIC(15, 2),
  cltv_projection NUMERIC(15, 2),
  cltv_tier TEXT,
  quality_score_tier TEXT,
  modelled_confidence_score INTEGER,
  modelled_computed_at TIMESTAMPTZ,
  invoices_with_revenue BIGINT,
  invoices_complete BIGINT,
  invoices_partial_no_practitioner BIGINT,
  invoices_partial_missing_rate BIGINT,
  pct_complete NUMERIC(15, 2),
  contribution_provenance_status TEXT,
  revenue_tier TEXT,
  clinician_cost_tier TEXT,
  contribution_tier TEXT,
  opportunity_weighted NUMERIC(15, 2),
  recommended_action TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.patient_id,
    p.pt_id,
    COALESCE(NULLIF(BTRIM(v.patient_name), ''), p.patient_name) AS patient_name,
    COALESCE(NULLIF(BTRIM(v.patient_uuid::text), ''), p.patient_uuid) AS patient_uuid,
    COALESCE(v.location_id, p.location_id) AS location_id,
    p.location_name,
    p.is_active,
    p.has_payment_plan,
    p.retention_status,
    COALESCE(v.contribution, p.contribution) AS contribution,
    COALESCE(v.revenue_private_plan, p.revenue_private_plan) AS revenue_private_plan,
    COALESCE(v.invoice_count, p.invoice_count) AS invoice_count,
    COALESCE(v.confidence_score, p.confidence_score) AS confidence_score,
    COALESCE(v.clinician_cost, p.clinician_cost) AS clinician_cost,
    COALESCE(v.direct_cost, p.direct_cost) AS direct_cost,
    COALESCE(v.margin_pct, p.margin_pct) AS margin_pct,
    p.contribution_12mo,
    p.visits_12mo,
    p.visit_freq_per_year,
    p.value_per_visit,
    COALESCE(NULLIF(p.opportunity_gross, 0), v.opportunity_gross, 0)::numeric(15, 2) AS opportunity_gross,
    COALESCE(v.quality_score, p.quality_score) AS quality_score,
    COALESCE(v.patient_economic_value, p.patient_economic_value) AS patient_economic_value,
    COALESCE(v.cltv_projection, p.cltv_projection) AS cltv_projection,
    COALESCE(v.cltv_tier, p.cltv_tier) AS cltv_tier,
    COALESCE(v.quality_score_tier, p.quality_score_tier) AS quality_score_tier,
    COALESCE(v.modelled_confidence_score, p.modelled_confidence_score) AS modelled_confidence_score,
    COALESCE(v.modelled_computed_at, p.modelled_computed_at) AS modelled_computed_at,
    COALESCE(v.invoices_with_revenue, 0)::bigint AS invoices_with_revenue,
    COALESCE(v.invoices_complete, 0)::bigint AS invoices_complete,
    COALESCE(v.invoices_partial_no_practitioner, 0)::bigint AS invoices_partial_no_practitioner,
    COALESCE(v.invoices_partial_missing_rate, 0)::bigint AS invoices_partial_missing_rate,
    v.pct_complete::numeric(15, 2) AS pct_complete,
    COALESCE(v.contribution_provenance_status, 'complete') AS contribution_provenance_status,
    COALESCE(v.revenue_tier, 'Dentally') AS revenue_tier,
    COALESCE(v.clinician_cost_tier, 'Derived') AS clinician_cost_tier,
    COALESCE(v.contribution_tier, 'Derived') AS contribution_tier,
    ROUND(
      CASE
        WHEN COALESCE(v.opportunity_weighted, 0) > 0 THEN v.opportunity_weighted
        WHEN COALESCE(p.revenue_private_plan, 0) > 0
          THEN COALESCE(p.opportunity_gross, 0) * (p.contribution / p.revenue_private_plan)
        ELSE 0
      END,
      2
    )::numeric(15, 2) AS opportunity_weighted,
    COALESCE(
      NULLIF(BTRIM(v.recommended_action), ''),
      CASE
        WHEN p.retention_status IN ('lapsed', 'effectively_lost') THEN
          CASE
            WHEN COALESCE(p.opportunity_gross, 0) >= 500 THEN 'priority_reactivation'
            WHEN COALESCE(p.quality_score, 0) >= 70 THEN 'reactivation_relationship'
            ELSE 'priority_reactivation'
          END
        WHEN p.retention_status = 'drifting' THEN
          CASE
            WHEN COALESCE(p.opportunity_gross, 0) >= 500 THEN 'schedule_treatment_recall'
            ELSE 'recall_follow_up'
          END
        WHEN COALESCE(p.opportunity_gross, 0) >= 500 AND COALESCE(p.quality_score, 0) < 40
          THEN 'chase_completion_data'
        WHEN COALESCE(p.opportunity_gross, 0) >= 500 AND COALESCE(p.quality_score, 0) >= 70
          THEN 'maintain_high_value'
        ELSE 'monitor'
      END
    ) AS recommended_action
  FROM public.pe_patient_roster_page(
    p_practice_id,
    p_location_id,
    p_start_date,
    p_end_date,
    p_search,
    p_retention_filter,
    p_type_filter,
    p_sort_key,
    p_sort_dir,
    p_limit,
    p_offset,
    p_metrics_since
  ) p
  LEFT JOIN public.v_patient_financial_record v
    ON v.practice_id = p_practice_id
   AND v.patient_id = p.patient_id
$$;

COMMENT ON FUNCTION public.pe_patient_financial_roster_page IS
  'PE financial records list: paged roster + financial-view overlay on the page only.';

REVOKE ALL ON FUNCTION public.pe_patient_financial_roster_page(
  UUID, UUID, DATE, DATE, TEXT, TEXT, TEXT, TEXT, TEXT, INT, INT, DATE
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pe_patient_financial_roster_page(
  UUID, UUID, DATE, DATE, TEXT, TEXT, TEXT, TEXT, TEXT, INT, INT, DATE
) TO authenticated, service_role;
