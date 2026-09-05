-- Fix pe_planned_unscheduled_leakage / pe_retention_recovery_loop: BTRIM(uuid) → cast to text.

CREATE OR REPLACE FUNCTION public.pe_planned_unscheduled_leakage(
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
  v_threshold integer := 60;
  v_margin_pct numeric;
  v_contrib_row JSONB;
  v_rev numeric;
  v_contrib numeric;
  v_start_ts timestamptz;
  v_end_ts timestamptz;
  v_item_count integer := 0;
  v_total numeric := 0;
  v_rows JSONB := '[]'::jsonb;
BEGIN
  PERFORM set_config('statement_timeout', '120000', true);

  SELECT COALESCE(ea.leakage_unscheduled_threshold_days, 60)
  INTO v_threshold
  FROM public.pe_economic_assumptions ea
  WHERE ea.practice_id = p_practice_id
  LIMIT 1;

  v_threshold := GREATEST(1, COALESCE(v_threshold, 60));

  IF p_start_date IS NOT NULL THEN
    v_start_ts := (p_start_date::text || 'T00:00:00.000Z')::timestamptz;
  END IF;

  IF p_end_date IS NOT NULL THEN
    v_end_ts := (p_end_date::text || 'T23:59:59.999Z')::timestamptz;
  END IF;

  v_contrib_row := public.pe_practice_contribution_row(p_practice_id);
  v_margin_pct := NULLIF((v_contrib_row->>'margin_pct')::numeric, 0);

  IF v_margin_pct IS NULL OR v_margin_pct <= 0 THEN
    v_rev := COALESCE((v_contrib_row->>'revenue_private_plan')::numeric, 0);
    v_contrib := COALESCE((v_contrib_row->>'contribution')::numeric, 0);
    IF v_rev > 0 AND v_contrib > 0 THEN
      v_margin_pct := ROUND((v_contrib / v_rev) * 1000) / 10;
    ELSE
      v_margin_pct := NULL;
    END IF;
  END IF;

  WITH filtered AS (
    SELECT
      el.patient_id,
      el.event_type,
      el.created_at,
      el.payload,
      public.pe_payload_plan_id(el.payload) AS plan_id
    FROM public.event_ledger el
    WHERE el.practice_id = p_practice_id
      AND el.event_type IN (
        'PLAN_CREATED',
        'APPOINTMENT_LINKED',
        'APPOINTMENT_UNLINKED',
        'PLAN_COMPLETED'
      )
      AND (
        p_location_id IS NULL
        OR el.location_id = p_location_id
        OR (
          el.location_id IS NULL
          AND el.patient_id IN (
            SELECT p.id
            FROM public.patients p
            WHERE p.organization_id = p_practice_id
              AND p.location_id = p_location_id
              AND p.deleted_at IS NULL
          )
        )
      )
      AND (v_start_ts IS NULL OR el.created_at >= v_start_ts)
      AND (v_end_ts IS NULL OR el.created_at <= v_end_ts)
  ),
  plan_states AS (
    SELECT
      f.plan_id,
      (MIN(f.patient_id::text) FILTER (WHERE f.patient_id IS NOT NULL))::uuid AS patient_id,
      MIN(f.created_at) FILTER (WHERE f.event_type = 'PLAN_CREATED') AS plan_created_at,
      MAX(f.created_at) FILTER (WHERE f.event_type = 'APPOINTMENT_LINKED') AS last_linked_at,
      MAX(f.created_at) FILTER (WHERE f.event_type = 'APPOINTMENT_UNLINKED') AS last_unlinked_at,
      BOOL_OR(f.event_type = 'PLAN_COMPLETED') AS is_completed
    FROM filtered f
    WHERE f.plan_id IS NOT NULL
      AND f.plan_id ~ '^[0-9]+$'
    GROUP BY f.plan_id
    HAVING MIN(f.created_at) FILTER (WHERE f.event_type = 'PLAN_CREATED') IS NOT NULL
  ),
  eligible_plans AS (
    SELECT
      ps.plan_id,
      ps.patient_id,
      ps.plan_created_at,
      (FLOOR(
        EXTRACT(EPOCH FROM (timezone('UTC', now()) - timezone('UTC', ps.plan_created_at)))
        / 86400
      ))::integer AS days_unscheduled
    FROM plan_states ps
    WHERE NOT COALESCE(ps.is_completed, false)
      AND (
        ps.last_linked_at IS NULL
        OR (
          ps.last_unlinked_at IS NOT NULL
          AND ps.last_unlinked_at > ps.last_linked_at
        )
      )
      AND (FLOOR(
        EXTRACT(EPOCH FROM (timezone('UTC', now()) - timezone('UTC', ps.plan_created_at)))
        / 86400
      ))::integer > v_threshold
  ),
  detail AS (
    SELECT
      ep.plan_id,
      tpi.tpi_id::text AS tpi_id,
      ep.patient_id,
      COALESCE(
        NULLIF(TRIM(CONCAT_WS(' ', p.pt_first_name, p.pt_last_name)), ''),
        CASE WHEN p.pt_id IS NOT NULL THEN 'Patient #' || p.pt_id::text END,
        'Unknown patient'
      ) AS patient_name,
      NULLIF(BTRIM(p.pt_unique_id::text), '') AS dentally_patient_uuid,
      ROUND(COALESCE(tpi.tpi_price, 0)::numeric, 2) AS treatment_value,
      ep.days_unscheduled,
      ep.plan_created_at
    FROM eligible_plans ep
    JOIN public.treatment_plan_items tpi
      ON tpi.organization_id = p_practice_id
     AND tpi.tpi_treatment_plan_id::text = ep.plan_id
     AND tpi.deleted_at IS NULL
     AND COALESCE(tpi.tpi_price, 0) > 0
     AND tpi.tpi_treatment_id IS NOT NULL
    JOIN public.treatments tr
      ON tr.organization_id = p_practice_id
     AND tr.external_id = tpi.tpi_treatment_id
     AND tr.deleted_at IS NULL
     AND tr.treatment_type = 'private'
    LEFT JOIN public.patients p
      ON p.organization_id = p_practice_id
     AND p.id = ep.patient_id
     AND p.deleted_at IS NULL
  )
  SELECT
    COUNT(*)::integer,
    ROUND(COALESCE(SUM(d.treatment_value), 0), 2),
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'planId', d.plan_id,
          'tpiId', d.tpi_id,
          'patientId', d.patient_id,
          'patientName', d.patient_name,
          'dentallyPatientUuid', d.dentally_patient_uuid,
          'treatmentValue', d.treatment_value,
          'daysUnscheduled', d.days_unscheduled,
          'planCreatedAt', d.plan_created_at
        )
        ORDER BY d.treatment_value DESC, d.plan_id, d.tpi_id
      ),
      '[]'::jsonb
    )
  INTO v_item_count, v_total, v_rows
  FROM detail d;

  RETURN jsonb_build_object(
    'practiceId', p_practice_id,
    'thresholdDays', v_threshold,
    'itemCount', COALESCE(v_item_count, 0),
    'totalValueAtRisk', COALESCE(v_total, 0),
    'marginPct', v_margin_pct,
    'contributionOpportunity',
      CASE
        WHEN v_margin_pct IS NOT NULL AND COALESCE(v_total, 0) > 0
        THEN ROUND(v_total * (v_margin_pct / 100.0), 2)
        ELSE NULL
      END,
    'rows', COALESCE(v_rows, '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.pe_retention_recovery_loop(
  p_practice_id UUID,
  p_location_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_use_facts boolean := false;
  v_recovery_window_days integer := 365;
  v_min_contribution numeric := 100;
  v_trailing_months integer := 12;
  v_flags jsonb;
BEGIN
  PERFORM set_config('statement_timeout', '120000', true);

  SELECT EXISTS (
    SELECT 1
    FROM public.pe_patient_contribution_facts f
    WHERE f.practice_id = p_practice_id
    LIMIT 1
  )
  INTO v_use_facts;

  SELECT
    COALESCE(ea.reactivation_recovery_contribution_window_days, 365),
    COALESCE(ea.reactivation_min_contribution_at_risk_gbp, 100),
    COALESCE(ea.reactivation_worklist_trailing_months, 12)
  INTO v_recovery_window_days, v_min_contribution, v_trailing_months
  FROM public.pe_economic_assumptions ea
  WHERE ea.practice_id = p_practice_id
  LIMIT 1;

  v_recovery_window_days := GREATEST(1, COALESCE(v_recovery_window_days, 365));
  v_min_contribution := GREATEST(0, COALESCE(v_min_contribution, 100));
  v_trailing_months := GREATEST(1, COALESCE(v_trailing_months, 12));

  WITH flags AS (
    SELECT
      fl.id,
      fl.practice_id,
      fl.patient_id,
      fl.segment_at_flag_time,
      fl.contribution_at_risk_at_flag_time,
      fl.lifetime_contribution_at_flag,
      fl.flagged_at,
      fl.status,
      fl.recovered_at,
      fl.reactivation_event_at,
      fl.contribution_recovered,
      fl.trailing_months,
      fl.recovery_window_days,
      fl.min_contribution_threshold_gbp
    FROM public.pe_reactivation_flags fl
    WHERE fl.practice_id = p_practice_id
    ORDER BY fl.flagged_at DESC
  ),
  scoped AS (
    SELECT
      f.*,
      p.pt_id,
      COALESCE(
        NULLIF(TRIM(CONCAT_WS(' ', p.pt_first_name, p.pt_last_name)), ''),
        'Unknown patient'
      ) AS patient_name,
      NULLIF(BTRIM(p.pt_unique_id::text), '') AS dentally_patient_uuid,
      p.pt_dentist_recall_date AS dentist_recall_date,
      p.pt_hygienist_recall_date AS hygienist_recall_date,
      CASE
        WHEN v_use_facts THEN facts.retention_status
        ELSE vpc.retention_status
      END AS current_retention_status
    FROM flags f
    JOIN public.patients p
      ON p.id = f.patient_id
     AND p.organization_id = p_practice_id
     AND p.deleted_at IS NULL
     AND (p_location_id IS NULL OR p.location_id = p_location_id)
    LEFT JOIN public.pe_patient_contribution_facts facts
      ON facts.practice_id = p_practice_id
     AND facts.patient_id = f.patient_id
    LEFT JOIN public.v_patient_contribution vpc
      ON vpc.practice_id = p_practice_id
     AND vpc.patient_id = f.patient_id
  ),
  last_visit AS (
    SELECT
      s.patient_id,
      MAX(a.apmt_completed_at) AS last_visit_at
    FROM scoped s
    JOIN public.appointments a
      ON a.organization_id = p_practice_id
     AND a.apmt_patient_id = s.pt_id
     AND a.apmt_completed_at IS NOT NULL
     AND a.apmt_completed_at::date <= CURRENT_DATE
     AND LOWER(BTRIM(COALESCE(a.apmt_state, ''))) NOT IN ('cancelled', 'did not attend', 'dna')
    WHERE s.pt_id IS NOT NULL
    GROUP BY s.patient_id
  ),
  enriched AS (
    SELECT
      s.id,
      s.practice_id,
      s.patient_id,
      s.segment_at_flag_time,
      s.contribution_at_risk_at_flag_time,
      s.lifetime_contribution_at_flag,
      s.flagged_at,
      s.status,
      s.recovered_at,
      s.reactivation_event_at,
      s.contribution_recovered,
      s.trailing_months,
      s.recovery_window_days,
      s.min_contribution_threshold_gbp,
      s.patient_name,
      s.dentally_patient_uuid,
      s.current_retention_status,
      s.dentist_recall_date,
      s.hygienist_recall_date,
      lv.last_visit_at
    FROM scoped s
    LEFT JOIN last_visit lv ON lv.patient_id = s.patient_id
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', e.id,
        'practice_id', e.practice_id,
        'patient_id', e.patient_id,
        'segment_at_flag_time', e.segment_at_flag_time,
        'contribution_at_risk_at_flag_time', ROUND(e.contribution_at_risk_at_flag_time, 2),
        'lifetime_contribution_at_flag', ROUND(e.lifetime_contribution_at_flag, 2),
        'flagged_at', e.flagged_at,
        'status', e.status,
        'recovered_at', e.recovered_at,
        'reactivation_event_at', e.reactivation_event_at,
        'contribution_recovered',
          CASE
            WHEN e.contribution_recovered IS NULL THEN NULL
            ELSE ROUND(e.contribution_recovered, 2)
          END,
        'trailing_months', e.trailing_months,
        'recovery_window_days', e.recovery_window_days,
        'patient_name', e.patient_name,
        'dentally_patient_uuid', e.dentally_patient_uuid,
        'current_retention_status', e.current_retention_status,
        'dentist_recall_date', e.dentist_recall_date,
        'hygienist_recall_date', e.hygienist_recall_date,
        'last_visit_at', e.last_visit_at
      )
      ORDER BY e.flagged_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_flags
  FROM enriched e;

  RETURN jsonb_build_object(
    'recoveryWindowDays', v_recovery_window_days,
    'minContributionThresholdGbp', ROUND(v_min_contribution, 2),
    'trailingMonths', v_trailing_months,
    'flags', COALESCE(v_flags, '[]'::jsonb)
  );
EXCEPTION
  WHEN undefined_table THEN
    RETURN jsonb_build_object(
      'recoveryWindowDays', v_recovery_window_days,
      'minContributionThresholdGbp', ROUND(v_min_contribution, 2),
      'trailingMonths', v_trailing_months,
      'flags', '[]'::jsonb
    );
END;
$$;
