-- ============================================================================
-- Patient Economics — retention status + opportunity on v_patient_contribution
--
-- Adds per-patient:
--   retention_status + retention_status_tier
--   opportunity_gross + opportunity_gross_tier
--   opportunity_weighted + opportunity_weighted_tier + opportunity_weighted_tier_note
--   patient_economic_value + patient_economic_value_tier + patient_economic_value_tier_note
--   recommended_action + recommended_action_tier + recommended_action_tier_note
--   quality_score (from modelled job, for action rules)
--
-- RETENTION RULES (evaluated in order; first match wins):
--
--   Derived (direct from synced Dentally / appointment facts):
--     • is_active = false  → lapsed
--     • recall date < today (1–90 days overdue) → drifting
--     • any recall date > today → healthy
--     • default → active
--
--   Modelled (explicit threshold assumptions — not Dentally facts):
--     • recall overdue > 90 days → lapsed   (LAPSED_RECALL_OVERDUE_DAYS)
--     • no completed visit in 365 days → lapsed (LAPSED_VISIT_GAP_DAYS)
--     • no completed visit in 182 days → drifting (DRIFTING_VISIT_GAP_DAYS;
--       aligns with Membership “sleeping” window)
--
--   Completed visit = appointments.apmt_completed_at IS NOT NULL
--     OR lower(apmt_state) = 'completed'; excludes cancelled / DNA.
--
-- OPPORTUNITY (Event Ledger journey stages):
--   Gross = sum planned_value on PLAN_CREATED plans that are NOT currently
--   scheduled (no APPOINTMENT_LINKED after last APPOINTMENT_UNLINKED) and
--   NOT completed (no PLAN_COMPLETED for that plan_id).
--   Tier: Derived (ledger facts + dedupe rules in this view).
--
--   Weighted = gross × default_opportunity_probability from
--   pe_economic_assumptions (fallback 0.35). Tier: Modelled — partial until
--   Value & Leakage (M6) per-clinician/per-treatment probabilities land.
--
-- PATIENT ECONOMIC VALUE (PEV) — PROPOSED, BUSINESS CONFIRMATION REQUIRED:
--   When modelled scores exist: PEV = cltv_projection (already =
--     contribution_to_date + discounted 5yr future run-rate in Modelled job).
--   Else: PEV = contribution only (no forward component).
--   NOT contribution + cltv_projection (double-counts history).
--   NOT opportunity_weighted (different grain — pipeline vs run-rate CLTV).
--   See src/lib/pePatientEconomicValue.ts and computePatientModelledScores.js.
--   Tier: Modelled + tier_note documents proposal status.
--
-- RECOMMENDED ACTION — rule table (Modelled, not ML):
--   retention_status + opportunity_weighted + quality_score thresholds.
--   See src/lib/peRecommendedAction.ts (keep SQL CASE in sync).
--   Thresholds: HIGH_OPP >= 500 GBP, HIGH_QUALITY >= 70, LOW_QUALITY < 40.
-- ============================================================================

ALTER TABLE public.pe_economic_assumptions
  ADD COLUMN IF NOT EXISTS default_opportunity_probability numeric(5, 4) NOT NULL DEFAULT 0.35
    CHECK (default_opportunity_probability >= 0 AND default_opportunity_probability <= 1);

COMMENT ON COLUMN public.pe_economic_assumptions.default_opportunity_probability IS
  'Default probability (0–1) for weighted opportunity on v_patient_contribution. Partial M6 placeholder until per-treatment weighting.';

DROP VIEW IF EXISTS public.v_patient_contribution;

CREATE VIEW public.v_patient_contribution
WITH (security_invoker = true)
AS
WITH agg AS (
  SELECT
    practice_id,
    patient_id,
    MAX(pt_id) AS pt_id,
    COUNT(*)::bigint AS invoice_count,
    COUNT(*) FILTER (WHERE revenue_private_plan > 0)::bigint AS invoices_with_revenue,
    COALESCE(SUM(revenue_private_plan), 0)::numeric(15, 2) AS revenue_private_plan,
    COALESCE(SUM(clinician_cost), 0)::numeric(15, 2) AS clinician_cost,
    COALESCE(SUM(direct_cost), 0)::numeric(15, 2) AS direct_cost,
    COALESCE(SUM(contribution), 0)::numeric(15, 2) AS contribution,
    CASE
      WHEN SUM(revenue_private_plan) > 0
      THEN ROUND((SUM(contribution) / SUM(revenue_private_plan)) * 100, 1)
      ELSE NULL
    END AS margin_pct,
    COUNT(*) FILTER (WHERE contribution_provenance_status = 'complete')::bigint
      AS invoices_complete,
    COUNT(*) FILTER (
      WHERE contribution_provenance_status = 'partial_no_practitioner'
    )::bigint AS invoices_partial_no_practitioner,
    COUNT(*) FILTER (
      WHERE contribution_provenance_status = 'partial_missing_rate'
    )::bigint AS invoices_partial_missing_rate,
    CASE
      WHEN COUNT(*) FILTER (WHERE revenue_private_plan > 0) > 0 THEN
        ROUND(
          100.0 * COUNT(*) FILTER (
            WHERE revenue_private_plan > 0
              AND contribution_provenance_status = 'complete'
          ) / NULLIF(COUNT(*) FILTER (WHERE revenue_private_plan > 0), 0),
          1
        )
      ELSE NULL
    END AS pct_complete,
    CASE
      WHEN COUNT(*) FILTER (
        WHERE contribution_provenance_status = 'partial_no_practitioner'
      ) > 0 THEN 'partial_no_practitioner'
      WHEN COUNT(*) FILTER (
        WHERE contribution_provenance_status = 'partial_missing_rate'
      ) > 0 THEN 'partial_missing_rate'
      ELSE 'complete'
    END::text AS contribution_provenance_status,
    ROUND(AVG(confidence_score))::integer AS confidence_score
  FROM public.v_invoice_contribution
  WHERE patient_id IS NOT NULL
  GROUP BY practice_id, patient_id
),
patient_last_visit AS (
  SELECT
    p.organization_id AS practice_id,
    p.id AS patient_id,
    MAX(COALESCE(a.apmt_completed_at, a.apmt_start_time)) AS last_completed_at
  FROM public.patients p
  INNER JOIN public.appointments a
    ON a.organization_id = p.organization_id
   AND a.apmt_patient_id = p.pt_id
   AND (
     a.apmt_completed_at IS NOT NULL
     OR LOWER(BTRIM(COALESCE(a.apmt_state, ''))) = 'completed'
   )
   AND LOWER(BTRIM(COALESCE(a.apmt_state, ''))) NOT IN (
     'cancelled', 'did not attend', 'dna'
   )
  WHERE p.deleted_at IS NULL
    AND p.pt_id IS NOT NULL
  GROUP BY p.organization_id, p.id
),
ledger_plan_events AS (
  SELECT
    el.practice_id,
    el.patient_id,
    el.event_type,
    el.created_at,
    COALESCE(
      NULLIF(BTRIM(el.payload ->> 'tp_id'), ''),
      NULLIF(BTRIM(el.payload ->> 'plan_id'), ''),
      NULLIF(BTRIM(el.payload ->> 'ta_treatment_plan_id'), '')
    ) AS plan_id,
    COALESCE(
      NULLIF(el.payload ->> 'planned_value', '')::numeric,
      NULLIF(el.payload ->> 'tp_private_treatment_value', '')::numeric,
      NULLIF(el.payload ->> 'value', '')::numeric,
      NULLIF(el.payload ->> 'amount', '')::numeric,
      NULLIF(el.payload ->> 'total', '')::numeric,
      0::numeric
    ) AS planned_value
  FROM public.event_ledger el
  WHERE el.event_type IN (
    'PLAN_CREATED',
    'APPOINTMENT_LINKED',
    'APPOINTMENT_UNLINKED',
    'PLAN_COMPLETED'
  )
),
ledger_planned AS (
  SELECT
    practice_id,
    patient_id,
    plan_id,
    MAX(planned_value)::numeric(15, 2) AS planned_value
  FROM ledger_plan_events
  WHERE event_type = 'PLAN_CREATED'
    AND plan_id IS NOT NULL
  GROUP BY practice_id, patient_id, plan_id
),
ledger_plan_schedule AS (
  SELECT
    practice_id,
    patient_id,
    plan_id,
    MAX(created_at) FILTER (WHERE event_type = 'APPOINTMENT_LINKED') AS last_linked_at,
    MAX(created_at) FILTER (WHERE event_type = 'APPOINTMENT_UNLINKED') AS last_unlinked_at
  FROM ledger_plan_events
  WHERE plan_id IS NOT NULL
    AND event_type IN ('APPOINTMENT_LINKED', 'APPOINTMENT_UNLINKED')
  GROUP BY practice_id, patient_id, plan_id
),
ledger_completed_plans AS (
  SELECT DISTINCT
    practice_id,
    patient_id,
    plan_id
  FROM ledger_plan_events
  WHERE event_type = 'PLAN_COMPLETED'
    AND plan_id IS NOT NULL
),
patient_opportunity AS (
  SELECT
    lp.practice_id,
    lp.patient_id,
    COALESCE(SUM(lp.planned_value), 0)::numeric(15, 2) AS opportunity_gross
  FROM ledger_planned lp
  LEFT JOIN ledger_plan_schedule ps
    ON ps.practice_id = lp.practice_id
   AND ps.patient_id = lp.patient_id
   AND ps.plan_id = lp.plan_id
  WHERE NOT EXISTS (
    SELECT 1
    FROM ledger_completed_plans cp
    WHERE cp.practice_id = lp.practice_id
      AND cp.patient_id = lp.patient_id
      AND cp.plan_id = lp.plan_id
  )
    AND (
      ps.last_linked_at IS NULL
      OR (
        ps.last_unlinked_at IS NOT NULL
        AND ps.last_unlinked_at > ps.last_linked_at
      )
    )
  GROUP BY lp.practice_id, lp.patient_id
),
contribution_rows AS (
  SELECT
    agg.practice_id,
    agg.patient_id,
    agg.pt_id,
    TRIM(BOTH FROM COALESCE(p.pt_first_name, '') || ' ' || COALESCE(p.pt_last_name, ''))
      AS patient_name,
    p.pt_unique_id AS patient_uuid,
    agg.invoice_count,
    agg.invoices_with_revenue,
    agg.revenue_private_plan,
    agg.clinician_cost,
    agg.direct_cost,
    agg.contribution,
    agg.margin_pct,
    agg.invoices_complete,
    agg.invoices_partial_no_practitioner,
    agg.invoices_partial_missing_rate,
    agg.pct_complete,
    agg.contribution_provenance_status,
    'Dentally'::text AS revenue_tier,
    CASE
      WHEN agg.contribution_provenance_status IN (
        'partial_no_practitioner',
        'partial_missing_rate'
      ) THEN 'External'
      ELSE 'Derived'
    END::text AS clinician_cost_tier,
    'Derived'::text AS contribution_tier,
    agg.confidence_score,
    CASE
      WHEN p.is_active = false THEN 'lapsed'
      WHEN GREATEST(
        CASE
          WHEN p.pt_dentist_recall_date IS NOT NULL
               AND p.pt_dentist_recall_date::date < CURRENT_DATE
          THEN (CURRENT_DATE - p.pt_dentist_recall_date::date)
          ELSE 0
        END,
        CASE
          WHEN p.pt_hygienist_recall_date IS NOT NULL
               AND p.pt_hygienist_recall_date::date < CURRENT_DATE
          THEN (CURRENT_DATE - p.pt_hygienist_recall_date::date)
          ELSE 0
        END
      ) > 90 THEN 'lapsed'
      WHEN plv.last_completed_at IS NOT NULL
           AND (CURRENT_DATE - plv.last_completed_at::date) > 365 THEN 'lapsed'
      WHEN GREATEST(
        CASE
          WHEN p.pt_dentist_recall_date IS NOT NULL
               AND p.pt_dentist_recall_date::date < CURRENT_DATE
          THEN (CURRENT_DATE - p.pt_dentist_recall_date::date)
          ELSE 0
        END,
        CASE
          WHEN p.pt_hygienist_recall_date IS NOT NULL
               AND p.pt_hygienist_recall_date::date < CURRENT_DATE
          THEN (CURRENT_DATE - p.pt_hygienist_recall_date::date)
          ELSE 0
        END
      ) BETWEEN 1 AND 90 THEN 'drifting'
      WHEN plv.last_completed_at IS NOT NULL
           AND (CURRENT_DATE - plv.last_completed_at::date) > 182 THEN 'drifting'
      WHEN (
        p.pt_dentist_recall_date IS NOT NULL
        AND p.pt_dentist_recall_date::date > CURRENT_DATE
      ) OR (
        p.pt_hygienist_recall_date IS NOT NULL
        AND p.pt_hygienist_recall_date::date > CURRENT_DATE
      ) THEN 'healthy'
      ELSE 'active'
    END::text AS retention_status,
    CASE
      WHEN p.is_active = false THEN 'Derived'
      WHEN GREATEST(
        CASE
          WHEN p.pt_dentist_recall_date IS NOT NULL
               AND p.pt_dentist_recall_date::date < CURRENT_DATE
          THEN (CURRENT_DATE - p.pt_dentist_recall_date::date)
          ELSE 0
        END,
        CASE
          WHEN p.pt_hygienist_recall_date IS NOT NULL
               AND p.pt_hygienist_recall_date::date < CURRENT_DATE
          THEN (CURRENT_DATE - p.pt_hygienist_recall_date::date)
          ELSE 0
        END
      ) > 90 THEN 'Modelled'
      WHEN plv.last_completed_at IS NOT NULL
           AND (CURRENT_DATE - plv.last_completed_at::date) > 365 THEN 'Modelled'
      WHEN GREATEST(
        CASE
          WHEN p.pt_dentist_recall_date IS NOT NULL
               AND p.pt_dentist_recall_date::date < CURRENT_DATE
          THEN (CURRENT_DATE - p.pt_dentist_recall_date::date)
          ELSE 0
        END,
        CASE
          WHEN p.pt_hygienist_recall_date IS NOT NULL
               AND p.pt_hygienist_recall_date::date < CURRENT_DATE
          THEN (CURRENT_DATE - p.pt_hygienist_recall_date::date)
          ELSE 0
        END
      ) BETWEEN 1 AND 90 THEN 'Derived'
      WHEN plv.last_completed_at IS NOT NULL
           AND (CURRENT_DATE - plv.last_completed_at::date) > 182 THEN 'Modelled'
      WHEN (
        p.pt_dentist_recall_date IS NOT NULL
        AND p.pt_dentist_recall_date::date > CURRENT_DATE
      ) OR (
        p.pt_hygienist_recall_date IS NOT NULL
        AND p.pt_hygienist_recall_date::date > CURRENT_DATE
      ) THEN 'Derived'
      ELSE 'Derived'
    END::text AS retention_status_tier,
    COALESCE(po.opportunity_gross, 0)::numeric(15, 2) AS opportunity_gross,
    'Derived'::text AS opportunity_gross_tier,
    ROUND(
      COALESCE(po.opportunity_gross, 0)
      * COALESCE(pa.default_opportunity_probability, 0.35),
      2
    )::numeric(15, 2) AS opportunity_weighted,
    'Modelled'::text AS opportunity_weighted_tier,
    'Modelled — partial, full weighting arrives with Value & Leakage (M6)'::text
      AS opportunity_weighted_tier_note,
    ROUND(COALESCE(ms.cltv_projection, agg.contribution), 2)::numeric(15, 2)
      AS patient_economic_value,
    'Modelled'::text AS patient_economic_value_tier,
    'Proposed: cltv_projection when modelled job present (contrib + discounted 5yr run-rate); else contribution only. Confirm formula with business — not a settled spec.'::text
      AS patient_economic_value_tier_note,
    COALESCE(ms.quality_score, 0)::integer AS quality_score
  FROM agg
  LEFT JOIN public.patients p
    ON p.id = agg.patient_id
   AND p.organization_id = agg.practice_id
   AND p.deleted_at IS NULL
  LEFT JOIN patient_last_visit plv
    ON plv.practice_id = agg.practice_id
   AND plv.patient_id = agg.patient_id
  LEFT JOIN patient_opportunity po
    ON po.practice_id = agg.practice_id
   AND po.patient_id = agg.patient_id
  LEFT JOIN public.pe_economic_assumptions pa
    ON pa.practice_id = agg.practice_id
  LEFT JOIN public.patient_economics_modelled_scores ms
    ON ms.practice_id = agg.practice_id
   AND ms.patient_id = agg.patient_id
)
SELECT
  cr.*,
  -- Recommended action rule table — keep in sync with peRecommendedAction.ts
  CASE
    WHEN cr.retention_status = 'lapsed'
         AND cr.opportunity_weighted >= 500 THEN 'priority_reactivation'
    WHEN cr.retention_status = 'lapsed'
         AND cr.quality_score >= 70 THEN 'reactivation_relationship'
    WHEN cr.retention_status = 'lapsed' THEN 'priority_reactivation'
    WHEN cr.retention_status = 'drifting'
         AND cr.opportunity_weighted >= 500 THEN 'schedule_treatment_recall'
    WHEN cr.retention_status = 'drifting' THEN 'recall_follow_up'
    WHEN cr.retention_status = 'healthy'
         AND cr.opportunity_weighted >= 500 THEN 'review_unscheduled_next_visit'
    WHEN cr.retention_status = 'active'
         AND cr.opportunity_weighted >= 500
         AND cr.quality_score < 40 THEN 'chase_completion_data'
    WHEN cr.retention_status = 'active'
         AND cr.opportunity_weighted >= 500
         AND cr.quality_score >= 70 THEN 'maintain_high_value'
    WHEN cr.retention_status = 'healthy' THEN 'routine_recall'
    ELSE 'monitor'
  END::text AS recommended_action,
  'Modelled'::text AS recommended_action_tier,
  'Rule table: retention_status + opportunity_weighted (>=500 high) + quality_score (>=70 high, <40 low). See peRecommendedAction.ts — not ML.'::text
    AS recommended_action_tier_note
FROM contribution_rows cr;

COMMENT ON VIEW public.v_patient_contribution IS
  'PE per-patient rollup: invoice contribution, retention_status, opportunity, patient_economic_value (proposed formula), recommended_action (rule table). security_invoker for org RLS.';

COMMENT ON COLUMN public.v_patient_contribution.opportunity_weighted_tier_note IS
  'Free-text provenance note for partial Modelled opportunity weighting (M6).';

COMMENT ON COLUMN public.v_patient_contribution.patient_economic_value IS
  'Proposed PEV: cltv_projection when modelled scores exist, else contribution. Business confirmation required.';

COMMENT ON COLUMN public.v_patient_contribution.patient_economic_value_tier IS
  'Modelled — proposed formula; see patient_economic_value_tier_note.';

COMMENT ON COLUMN public.v_patient_contribution.patient_economic_value_tier_note IS
  'Documents proposed PEV assumption until product spec is settled.';

COMMENT ON COLUMN public.v_patient_contribution.recommended_action IS
  'Rule-based action key (snake_case). See peRecommendedAction.ts — not ML.';

COMMENT ON COLUMN public.v_patient_contribution.recommended_action_tier IS
  'Modelled — rule table on retention + opportunity + quality score.';

COMMENT ON COLUMN public.v_patient_contribution.recommended_action_tier_note IS
  'Free-text provenance note pointing to peRecommendedAction.ts rule table.';

COMMENT ON COLUMN public.v_patient_contribution.quality_score IS
  'Day 3 modelled quality_score (0 when job row missing). Used by recommended_action rules.';

COMMENT ON COLUMN public.v_patient_contribution.retention_status IS
  'Rule-based segmentation: active | drifting | lapsed | healthy. Thresholds documented in migration 20260828140001.';

COMMENT ON COLUMN public.v_patient_contribution.retention_status_tier IS
  'Derived = direct Dentally/recall/visit facts; Modelled = explicit day thresholds (90/182/365).';

COMMENT ON COLUMN public.v_patient_contribution.opportunity_gross IS
  'Sum of PLAN_CREATED planned_value for plans not currently scheduled (ledger) and not PLAN_COMPLETED.';

COMMENT ON COLUMN public.v_patient_contribution.opportunity_weighted IS
  'opportunity_gross × default_opportunity_probability. Partial — full per-treatment weighting in M6 Value & Leakage.';

COMMENT ON COLUMN public.v_patient_contribution.opportunity_weighted_tier IS
  'Modelled — partial; full weighting arrives with Value & Leakage (M6).';

GRANT SELECT ON public.v_patient_contribution TO authenticated;
GRANT SELECT ON public.v_patient_contribution TO service_role;
