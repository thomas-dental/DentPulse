-- Store unmatched Dentally pt_id rows in patient contribution facts/views
-- (patient_id NULL, grain by pt_id). PE read APIs still hide orphans.

-- ---------------------------------------------------------------------------
-- pe_patient_contribution_facts: nullable patient_id + grain_key PK
-- ---------------------------------------------------------------------------

ALTER TABLE public.pe_patient_contribution_facts
  DROP CONSTRAINT IF EXISTS pe_patient_contribution_facts_pkey;

ALTER TABLE public.pe_patient_contribution_facts
  ALTER COLUMN patient_id DROP NOT NULL;

DELETE FROM public.pe_patient_contribution_facts
WHERE patient_id IS NULL AND pt_id IS NULL;

ALTER TABLE public.pe_patient_contribution_facts
  DROP CONSTRAINT IF EXISTS pe_patient_contribution_facts_grain_check;

ALTER TABLE public.pe_patient_contribution_facts
  ADD CONSTRAINT pe_patient_contribution_facts_grain_check
  CHECK (patient_id IS NOT NULL OR pt_id IS NOT NULL);

ALTER TABLE public.pe_patient_contribution_facts
  DROP COLUMN IF EXISTS grain_key;

ALTER TABLE public.pe_patient_contribution_facts
  ADD COLUMN grain_key text
  GENERATED ALWAYS AS (
    COALESCE(patient_id::text, 'pt:' || pt_id::text)
  ) STORED;

ALTER TABLE public.pe_patient_contribution_facts
  ADD CONSTRAINT pe_patient_contribution_facts_pkey
  PRIMARY KEY (practice_id, grain_key);

COMMENT ON COLUMN public.pe_patient_contribution_facts.patient_id IS
  'DentPulse patients.id UUID when matched; NULL for orphan Dentally pt_id rows.';

COMMENT ON COLUMN public.pe_patient_contribution_facts.grain_key IS
  'Stable identity: patient UUID text, or pt:<dentally_pt_id> for orphans.';

COMMENT ON COLUMN public.pe_patient_contribution_facts.pt_id IS
  'Dentally patient id. Required when patient_id is NULL (orphan grain).';

-- ---------------------------------------------------------------------------
-- Views: emit orphan patient rows keyed by pt_id
-- ---------------------------------------------------------------------------

DROP VIEW IF EXISTS public.v_pe_retention_segment;
DROP VIEW IF EXISTS public.v_patient_financial_record;
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
  WHERE patient_id IS NOT NULL OR pt_id IS NOT NULL
  GROUP BY
    practice_id,
    patient_id,
    CASE WHEN patient_id IS NULL THEN pt_id ELSE NULL END
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
    public.pe_retention_status(agg.practice_id,
      p.is_active,
      p.pt_dentist_recall_date::date,
      p.pt_hygienist_recall_date::date,
      plv.last_completed_at
    )::text AS retention_status,
    public.pe_retention_status_tier(agg.practice_id,
      p.is_active,
      p.pt_dentist_recall_date::date,
      p.pt_hygienist_recall_date::date,
      plv.last_completed_at
    )::text AS retention_status_tier,
    COALESCE(po.opportunity_gross, 0)::numeric(15, 2) AS opportunity_gross,
    'Derived'::text AS opportunity_gross_tier,
    0::numeric(15, 2) AS opportunity_weighted,
    'Modelled'::text AS opportunity_weighted_tier,
    'Computed at read time from historical Commitment Rate — see opportunityCommitmentWeighting.js'::text
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
  LEFT JOIN public.patient_economics_modelled_scores ms
    ON ms.practice_id = agg.practice_id
   AND ms.patient_id = agg.patient_id
)
SELECT
  cr.*,
  'monitor'::text AS recommended_action,
  'Modelled'::text AS recommended_action_tier,
  'Computed at read time with commitment-weighted opportunity — see peRecommendedAction.js'::text
    AS recommended_action_tier_note
FROM contribution_rows cr;

COMMENT ON VIEW public.v_patient_contribution IS
  'PE per-patient rollup including orphan Dentally pt_id rows (patient_id NULL). PE UI hides orphans at API. security_invoker for org RLS.';

COMMENT ON COLUMN public.v_patient_contribution.opportunity_weighted IS
  'Placeholder 0 in view — API applies learned Commitment Rate per open plan (opportunityCommitmentWeighting.js).';

COMMENT ON COLUMN public.v_patient_contribution.opportunity_weighted_tier IS
  'Modelled — probability from historical Planned→Scheduled ledger conversions.';

COMMENT ON COLUMN public.v_patient_contribution.opportunity_weighted_tier_note IS
  'API read layer replaces with segment-specific confidence note.';

COMMENT ON COLUMN public.v_patient_contribution.opportunity_gross IS
  'Sum of PLAN_CREATED planned_value for plans not currently scheduled (ledger) and not PLAN_COMPLETED.';

COMMENT ON COLUMN public.v_patient_contribution.recommended_action IS
  'Placeholder monitor in view — API recomputes with commitment-weighted opportunity.';

COMMENT ON COLUMN public.v_patient_contribution.patient_id IS
  'DentPulse patients.id when matched; NULL for unmatched Dentally pt_id (orphan).';

GRANT SELECT ON public.v_patient_contribution TO authenticated;
GRANT SELECT ON public.v_patient_contribution TO service_role;

CREATE OR REPLACE VIEW public.v_patient_financial_record
WITH (security_invoker = true)
AS
SELECT
  pc.practice_id,
  pc.patient_id,
  pc.pt_id,
  pc.patient_name,
  pc.patient_uuid,
  pc.invoice_count,
  pc.invoices_with_revenue,
  pc.revenue_private_plan,
  pc.clinician_cost,
  pc.direct_cost,
  pc.contribution,
  pc.margin_pct,
  pc.invoices_complete,
  pc.invoices_partial_no_practitioner,
  pc.invoices_partial_missing_rate,
  pc.pct_complete,
  pc.contribution_provenance_status,
  pc.revenue_tier,
  pc.clinician_cost_tier,
  pc.contribution_tier,
  pc.confidence_score,
  pc.retention_status,
  pc.retention_status_tier,
  pc.opportunity_gross,
  pc.opportunity_gross_tier,
  pc.opportunity_weighted,
  pc.opportunity_weighted_tier,
  pc.opportunity_weighted_tier_note,
  pc.patient_economic_value,
  pc.patient_economic_value_tier,
  pc.patient_economic_value_tier_note,
  pc.quality_score,
  pc.recommended_action,
  pc.recommended_action_tier,
  pc.recommended_action_tier_note,
  p.location_id,
  NULLIF(BTRIM(pl.location_name), '') AS location_name,
  ms.cltv_projection,
  ms.cltv_tier,
  ms.quality_score_tier,
  ms.confidence_score AS modelled_confidence_score,
  ms.computed_at AS modelled_computed_at
FROM public.v_patient_contribution pc
LEFT JOIN public.patients p
  ON p.id = pc.patient_id
 AND p.organization_id = pc.practice_id
 AND p.deleted_at IS NULL
LEFT JOIN public.practice_locations pl
  ON pl.id = p.location_id
 AND pl.organization_id = pc.practice_id
 AND pl.deleted_at IS NULL
LEFT JOIN public.patient_economics_modelled_scores ms
  ON ms.practice_id = pc.practice_id
 AND ms.patient_id = pc.patient_id;

COMMENT ON VIEW public.v_patient_financial_record IS
  'PE Patient Records aggregation: contribution rollup + opportunity + retention + PEV + location + modelled CLTV/quality. Includes orphans (patient_id NULL); UI hides them at API.';

COMMENT ON COLUMN public.v_patient_financial_record.location_id IS
  'Patient home location (patients.location_id). Null for orphan rows.';

COMMENT ON COLUMN public.v_patient_financial_record.location_name IS
  'Display name from practice_locations for location_id.';

GRANT SELECT ON public.v_patient_financial_record TO authenticated;
GRANT SELECT ON public.v_patient_financial_record TO service_role;

CREATE OR REPLACE VIEW public.v_pe_retention_segment
WITH (security_invoker = true)
AS
SELECT
  practice_id,
  patient_id,
  pt_id,
  patient_name,
  retention_status,
  retention_status_tier,
  contribution,
  opportunity_gross,
  quality_score
FROM public.v_patient_contribution;

COMMENT ON VIEW public.v_pe_retention_segment IS
  'Queryable 4-tier retention segment per patient — shared by Patient Records and Retention & Reactivation.';

COMMENT ON COLUMN public.v_patient_contribution.retention_status IS
  '4-tier segment: active | drifting | lapsed | effectively_lost. pe_retention_status().';

COMMENT ON COLUMN public.v_patient_contribution.retention_status_tier IS
  'Derived (Dentally is_active / default active) or Modelled (day thresholds in pe_retention_status).';

GRANT SELECT ON public.v_pe_retention_segment TO authenticated;
GRANT SELECT ON public.v_pe_retention_segment TO service_role;
