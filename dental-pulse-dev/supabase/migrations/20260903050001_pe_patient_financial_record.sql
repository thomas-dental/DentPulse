-- Single-patient financial record: same overlay as pe_patient_financial_roster_page
-- without ranking the full roster. Used by GET patient-financial-record.

CREATE OR REPLACE FUNCTION public.pe_patient_financial_record(
  p_practice_id UUID,
  p_patient_id UUID
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
  recommended_action TEXT,
  acquisition_source_name TEXT,
  dentist_recall_date DATE,
  hygienist_recall_date DATE
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  use_facts boolean;
  metrics_since date;
  visits_since date;
BEGIN
  use_facts := public.pe_invoice_source_has_facts(p_practice_id);
  metrics_since := (CURRENT_DATE - INTERVAL '12 months')::date;
  visits_since := metrics_since;

  RETURN QUERY
  SELECT
    p.id,
    p.pt_id,
    COALESCE(
      NULLIF(BTRIM(COALESCE(p.pt_first_name, '') || ' ' || COALESCE(p.pt_last_name, '')), ''),
      NULLIF(BTRIM(v.patient_name), ''),
      CASE WHEN p.pt_id IS NOT NULL THEN 'Patient #' || p.pt_id::text ELSE 'Unknown patient' END
    ) AS patient_name,
    COALESCE(
      NULLIF(BTRIM(COALESCE(p.pt_unique_id::text, '')), ''),
      NULLIF(BTRIM(v.patient_uuid::text), '')
    ) AS patient_uuid,
    COALESCE(p.location_id, v.location_id) AS location_id,
    COALESCE(NULLIF(BTRIM(pl.location_name), ''), 'Unassigned') AS location_name,
    COALESCE(p.is_active, false) AS is_active,
    COALESCE(p.pt_payment_plan_id IS NOT NULL, false) AS has_payment_plan,
    COALESCE(v.retention_status, pf.retention_status, 'active') AS retention_status,
    COALESCE(v.contribution, pf.contribution, 0)::numeric(15, 2),
    COALESCE(v.revenue_private_plan, pf.revenue_private_plan, 0)::numeric(15, 2),
    COALESCE(v.invoice_count, pf.invoice_count, 0)::bigint,
    COALESCE(v.confidence_score, pf.confidence_score) AS confidence_score,
    COALESCE(v.clinician_cost, cost.clin_cost, 0)::numeric(15, 2),
    COALESCE(v.direct_cost, cost.dir_cost, 0)::numeric(15, 2),
    COALESCE(
      v.margin_pct,
      CASE
        WHEN COALESCE(v.revenue_private_plan, pf.revenue_private_plan, 0) > 0
          THEN ROUND(
            (COALESCE(v.contribution, pf.contribution, 0)
              / COALESCE(v.revenue_private_plan, pf.revenue_private_plan)) * 100,
            1
          )
        ELSE NULL
      END
    )::numeric(15, 2) AS margin_pct,
    COALESCE(c12.c12, 0)::numeric(15, 2),
    COALESCE(vis.visit_count, 0)::bigint,
    CASE
      WHEN COALESCE(vis.visit_count, 0) > 0 THEN vis.visit_count::numeric(15, 2)
      ELSE NULL
    END,
    CASE
      WHEN COALESCE(vis.visit_count, 0) > 0 AND COALESCE(c12.c12, 0) > 0
        THEN ROUND(c12.c12 / vis.visit_count, 2)
      WHEN COALESCE(vis.visit_count, 0) > 0 THEN 0::numeric(15, 2)
      ELSE NULL
    END,
    COALESCE(NULLIF(opp.opportunity_gross, 0), v.opportunity_gross, 0)::numeric(15, 2),
    COALESCE(v.quality_score, ms.quality_score, 0)::integer,
    COALESCE(v.patient_economic_value, ROUND(COALESCE(ms.cltv_projection, v.contribution, pf.contribution, 0), 2))::numeric(15, 2),
    COALESCE(v.cltv_projection, ms.cltv_projection)::numeric(15, 2),
    COALESCE(v.cltv_tier, ms.cltv_tier)::text,
    COALESCE(v.quality_score_tier, ms.quality_score_tier)::text,
    COALESCE(v.modelled_confidence_score, ms.confidence_score)::integer,
    COALESCE(v.modelled_computed_at, ms.computed_at),
    COALESCE(v.invoices_with_revenue, 0)::bigint,
    COALESCE(v.invoices_complete, 0)::bigint,
    COALESCE(v.invoices_partial_no_practitioner, 0)::bigint,
    COALESCE(v.invoices_partial_missing_rate, 0)::bigint,
    v.pct_complete::numeric(15, 2),
    COALESCE(v.contribution_provenance_status, 'complete'),
    COALESCE(v.revenue_tier, 'Dentally'),
    COALESCE(v.clinician_cost_tier, 'Derived'),
    COALESCE(v.contribution_tier, 'Derived'),
    ROUND(
      CASE
        WHEN COALESCE(v.opportunity_weighted, 0) > 0 THEN v.opportunity_weighted
        WHEN COALESCE(v.revenue_private_plan, pf.revenue_private_plan, 0) > 0
          THEN COALESCE(opp.opportunity_gross, v.opportunity_gross, 0)
            * (
              COALESCE(v.contribution, pf.contribution, 0)
              / COALESCE(v.revenue_private_plan, pf.revenue_private_plan)
            )
        ELSE 0
      END,
      2
    )::numeric(15, 2),
    COALESCE(
      NULLIF(BTRIM(v.recommended_action), ''),
      CASE
        WHEN COALESCE(v.retention_status, pf.retention_status, 'active') IN ('lapsed', 'effectively_lost') THEN
          CASE
            WHEN COALESCE(opp.opportunity_gross, v.opportunity_gross, 0) >= 500 THEN 'priority_reactivation'
            WHEN COALESCE(v.quality_score, ms.quality_score, 0) >= 70 THEN 'reactivation_relationship'
            ELSE 'priority_reactivation'
          END
        WHEN COALESCE(v.retention_status, pf.retention_status, 'active') = 'drifting' THEN
          CASE
            WHEN COALESCE(opp.opportunity_gross, v.opportunity_gross, 0) >= 500 THEN 'schedule_treatment_recall'
            ELSE 'recall_follow_up'
          END
        WHEN COALESCE(opp.opportunity_gross, v.opportunity_gross, 0) >= 500
          AND COALESCE(v.quality_score, ms.quality_score, 0) < 40
          THEN 'chase_completion_data'
        WHEN COALESCE(opp.opportunity_gross, v.opportunity_gross, 0) >= 500
          AND COALESCE(v.quality_score, ms.quality_score, 0) >= 70
          THEN 'maintain_high_value'
        ELSE 'monitor'
      END
    ),
    NULLIF(BTRIM(COALESCE(p.pt_acquisition_source_name, '')), ''),
    p.pt_dentist_recall_date::date,
    p.pt_hygienist_recall_date::date
  FROM public.v_patient_financial_record v
  LEFT JOIN public.patients p
    ON p.id = v.patient_id
   AND p.organization_id = p_practice_id
   AND p.deleted_at IS NULL
  LEFT JOIN public.practice_locations pl
    ON pl.id = COALESCE(p.location_id, v.location_id)
   AND pl.organization_id = p_practice_id
   AND pl.deleted_at IS NULL
  LEFT JOIN public.pe_patient_contribution_facts pf
    ON pf.practice_id = p_practice_id
   AND pf.patient_id = p_patient_id
  LEFT JOIN public.patient_economics_modelled_scores ms
    ON ms.practice_id = p_practice_id
   AND ms.patient_id = p_patient_id
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(x.contribution), 0)::numeric(15, 2) AS c12
    FROM (
      SELECT inv.contribution
      FROM public.pe_invoice_contribution_facts inv
      WHERE use_facts
        AND inv.practice_id = p_practice_id
        AND inv.patient_id = p_patient_id
        AND inv.invoice_date >= metrics_since
      UNION ALL
      SELECT vw.contribution
      FROM public.v_invoice_contribution vw
      WHERE NOT use_facts
        AND vw.practice_id = p_practice_id
        AND vw.patient_id = p_patient_id
        AND vw.invoice_date >= metrics_since
    ) x
  ) c12 ON true
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::bigint AS visit_count
    FROM public.appointments a
    WHERE a.organization_id = p_practice_id
      AND a.apmt_patient_id = p.pt_id
      AND a.apmt_completed_at >= visits_since
      AND LOWER(BTRIM(COALESCE(a.apmt_state, ''))) NOT IN (
        'cancelled', 'did not attend', 'dna'
      )
  ) vis ON true
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(COALESCE(
      NULLIF(el.payload ->> 'planned_value', '')::numeric,
      NULLIF(el.payload ->> 'tp_private_treatment_value', '')::numeric,
      NULLIF(el.payload ->> 'value', '')::numeric,
      0::numeric
    )), 0)::numeric(15, 2) AS opportunity_gross
    FROM public.event_ledger el
    WHERE el.practice_id = p_practice_id
      AND el.event_type = 'PLAN_CREATED'
      AND el.patient_id = p_patient_id
  ) opp ON true
  LEFT JOIN LATERAL (
    SELECT
      COALESCE(SUM(x.clinician_cost), 0)::numeric(15, 2) AS clin_cost,
      COALESCE(SUM(x.direct_cost), 0)::numeric(15, 2) AS dir_cost
    FROM (
      SELECT inv.clinician_cost, inv.direct_cost
      FROM public.pe_invoice_contribution_facts inv
      WHERE use_facts
        AND inv.practice_id = p_practice_id
        AND inv.patient_id = p_patient_id
      UNION ALL
      SELECT vw.clinician_cost, vw.direct_cost
      FROM public.v_invoice_contribution vw
      WHERE NOT use_facts
        AND vw.practice_id = p_practice_id
        AND vw.patient_id = p_patient_id
    ) x
  ) cost ON true
  WHERE v.practice_id = p_practice_id
    AND v.patient_id = p_patient_id
  LIMIT 1;
END;
$$;

COMMENT ON FUNCTION public.pe_patient_financial_record IS
  'One PE financial-record row: view overlay + 12mo/visits/opportunity for a single patient.';

REVOKE ALL ON FUNCTION public.pe_patient_financial_record(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pe_patient_financial_record(UUID, UUID)
  TO authenticated, service_role;
