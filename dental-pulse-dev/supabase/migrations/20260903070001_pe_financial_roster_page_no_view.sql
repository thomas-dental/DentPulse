-- Financial list was timing out: LEFT JOIN v_patient_financial_record expands
-- v_patient_contribution for the whole practice. Page first, derive overlay
-- from the page row (same fallbacks as the previous COALESCE path).

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
  WITH page AS MATERIALIZED (
    SELECT *
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
    )
  )
  SELECT
    p.patient_id,
    p.pt_id,
    p.patient_name,
    p.patient_uuid,
    p.location_id,
    p.location_name,
    p.is_active,
    p.has_payment_plan,
    p.retention_status,
    p.contribution,
    p.revenue_private_plan,
    p.invoice_count,
    p.confidence_score,
    p.clinician_cost,
    p.direct_cost,
    p.margin_pct,
    p.contribution_12mo,
    p.visits_12mo,
    p.visit_freq_per_year,
    p.value_per_visit,
    COALESCE(p.opportunity_gross, 0)::numeric(15, 2) AS opportunity_gross,
    p.quality_score,
    p.patient_economic_value,
    p.cltv_projection,
    p.cltv_tier,
    p.quality_score_tier,
    p.modelled_confidence_score,
    p.modelled_computed_at,
    COALESCE(p.invoice_count, 0)::bigint AS invoices_with_revenue,
    COALESCE(p.invoice_count, 0)::bigint AS invoices_complete,
    0::bigint AS invoices_partial_no_practitioner,
    0::bigint AS invoices_partial_missing_rate,
    CASE
      WHEN COALESCE(p.invoice_count, 0) > 0 THEN 100::numeric(15, 2)
      ELSE NULL::numeric(15, 2)
    END AS pct_complete,
    'complete'::text AS contribution_provenance_status,
    'Dentally'::text AS revenue_tier,
    'Derived'::text AS clinician_cost_tier,
    'Derived'::text AS contribution_tier,
    ROUND(
      CASE
        WHEN COALESCE(p.revenue_private_plan, 0) > 0
          THEN COALESCE(p.opportunity_gross, 0) * (p.contribution / p.revenue_private_plan)
        ELSE 0
      END,
      2
    )::numeric(15, 2) AS opportunity_weighted,
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
    END AS recommended_action
  FROM page p
$$;

COMMENT ON FUNCTION public.pe_patient_financial_roster_page IS
  'PE financial records list: paged roster only (no full-practice financial view).';

REVOKE ALL ON FUNCTION public.pe_patient_financial_roster_page(
  UUID, UUID, DATE, DATE, TEXT, TEXT, TEXT, TEXT, TEXT, INT, INT, DATE
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pe_patient_financial_roster_page(
  UUID, UUID, DATE, DATE, TEXT, TEXT, TEXT, TEXT, TEXT, INT, INT, DATE
) TO authenticated, service_role;
