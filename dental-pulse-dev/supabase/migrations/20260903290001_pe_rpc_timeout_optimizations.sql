-- PE read RPC timeout fixes: single-pass invoice summary, drop v_patient_contribution
-- on recovery loop, MATERIALIZED location scope + partial ledger index, LATERAL last visit.

CREATE INDEX IF NOT EXISTS idx_event_ledger_pe_commitment_practice_created
  ON public.event_ledger (practice_id, created_at)
  WHERE event_type IN (
    'PLAN_CREATED',
    'APPOINTMENT_LINKED',
    'APPOINTMENT_UNLINKED',
    'PLAN_COMPLETED'
  );

CREATE INDEX IF NOT EXISTS idx_event_ledger_pe_journey_practice_created
  ON public.event_ledger (practice_id, created_at)
  WHERE event_type IN (
    'PLAN_CREATED',
    'APPOINTMENT_LINKED',
    'TREATMENT_STARTED',
    'PLAN_COMPLETED',
    'INVOICE_RAISED',
    'PAYMENT_ALLOCATED'
  );

CREATE INDEX IF NOT EXISTS idx_pe_reactivation_flags_practice_flagged
  ON public.pe_reactivation_flags (practice_id, flagged_at DESC);

-- ---------------------------------------------------------------------------
-- pe_invoice_contribution_summary — one facts scan (was two + nested subqueries)
-- ---------------------------------------------------------------------------
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
  PERFORM set_config('statement_timeout', '180000', true);

  use_facts := public.pe_invoice_source_has_facts(p_practice_id);

  IF use_facts THEN
    WITH membership_pts AS MATERIALIZED (
      SELECT p.pt_id
      FROM public.patients p
      WHERE p.organization_id = p_practice_id
        AND p.deleted_at IS NULL
        AND p.pt_id IS NOT NULL
        AND (p_location_id IS NULL OR p.location_id = p_location_id)
        AND p.pt_payment_plan_id IN (
          SELECT public.pe_membership_plan_pp_ids(p_practice_id)
        )
    ),
    scoped AS (
      SELECT
        f.patient_id,
        f.revenue_private_plan,
        f.contribution,
        f.revenue_nhs,
        f.has_missing_practitioner,
        f.has_missing_rate,
        f.revenue_no_practitioner,
        f.revenue_missing_rate,
        (f.revenue_private_plan > 0 AND mp.pt_id IS NOT NULL) AS is_plan_revenue
      FROM public.pe_invoice_contribution_facts f
      LEFT JOIN public.platform_integration_invoices inv
        ON inv.organization_id = f.practice_id
       AND inv.id = f.invoice_id
       AND inv.deleted_at IS NULL
      LEFT JOIN public.patients p
        ON p.id = f.patient_id
       AND p.organization_id = f.practice_id
       AND p.deleted_at IS NULL
      LEFT JOIN membership_pts mp
        ON mp.pt_id = f.pt_id
      WHERE f.practice_id = p_practice_id
        AND f.is_paid = true
        AND (p_start_date IS NULL OR f.invoice_date >= p_start_date)
        AND (p_end_date IS NULL OR f.invoice_date <= p_end_date)
        AND (
          p_location_id IS NULL
          OR COALESCE(inv.location_id, p.location_id) = p_location_id
        )
    )
    SELECT
      COALESCE(SUM(s.revenue_private_plan) FILTER (WHERE s.is_plan_revenue), 0),
      COALESCE(SUM(s.revenue_private_plan) FILTER (
        WHERE s.revenue_private_plan > 0 AND NOT s.is_plan_revenue
      ), 0),
      COALESCE(SUM(s.revenue_private_plan), 0),
      jsonb_build_object(
        'invoice_count', COUNT(*)::bigint,
        'invoices_with_revenue', COUNT(*) FILTER (WHERE s.revenue_private_plan > 0)::bigint,
        'patient_count', COUNT(DISTINCT s.patient_id)::bigint,
        'patients_with_revenue', COUNT(DISTINCT s.patient_id) FILTER (WHERE s.revenue_private_plan > 0)::bigint,
        'total_contribution', COALESCE(SUM(s.contribution), 0),
        'total_revenue', COALESCE(SUM(s.revenue_private_plan), 0),
        'revenue_nhs', COALESCE(SUM(s.revenue_nhs), 0),
        'revenue_private', 0,
        'revenue_plan', 0,
        'invoices_missing_practitioner', COUNT(*) FILTER (WHERE s.has_missing_practitioner)::bigint,
        'invoices_missing_rate', COUNT(*) FILTER (WHERE s.has_missing_rate)::bigint,
        'revenue_no_practitioner', COALESCE(SUM(s.revenue_no_practitioner), 0),
        'revenue_missing_rate', COALESCE(SUM(s.revenue_missing_rate), 0)
      )
    INTO revenue_plan, revenue_private, total_revenue, result
    FROM scoped s;

    IF revenue_plan = 0 AND revenue_private = 0 AND total_revenue > 0 THEN
      revenue_private := total_revenue;
    END IF;

    result := result
      || jsonb_build_object(
        'revenue_private', revenue_private,
        'revenue_plan', revenue_plan
      );
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
    LEFT JOIN public.platform_integration_invoices inv
      ON inv.organization_id = v.practice_id
     AND inv.id = v.invoice_id
     AND inv.deleted_at IS NULL
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
        OR COALESCE(inv.location_id, p.location_id) = p_location_id
      );
  END IF;

  RETURN COALESCE(result, '{}'::jsonb);
END;
$$;

-- ---------------------------------------------------------------------------
-- pe_ledger_plan_states — MATERIALIZED scoped patients + commitment index path
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pe_ledger_plan_states(
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
  v_start_ts timestamptz;
  v_end_ts timestamptz;
BEGIN
  PERFORM set_config('statement_timeout', '180000', true);

  IF p_start_date IS NOT NULL THEN
    v_start_ts := (p_start_date::text || 'T00:00:00.000Z')::timestamptz;
  END IF;

  IF p_end_date IS NOT NULL THEN
    v_end_ts := (p_end_date::text || 'T23:59:59.999Z')::timestamptz;
  END IF;

  RETURN (
    WITH scoped_patients AS MATERIALIZED (
      SELECT p.id
      FROM public.patients p
      WHERE p.organization_id = p_practice_id
        AND p.deleted_at IS NULL
        AND (p_location_id IS NULL OR p.location_id = p_location_id)
    ),
    filtered AS (
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
        AND (v_start_ts IS NULL OR el.created_at >= v_start_ts)
        AND (v_end_ts IS NULL OR el.created_at <= v_end_ts)
        AND (
          p_location_id IS NULL
          OR el.location_id = p_location_id
          OR (
            el.location_id IS NULL
            AND el.patient_id IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM scoped_patients sp
              WHERE sp.id = el.patient_id
            )
          )
        )
    ),
    plan_states AS (
      SELECT
        f.plan_id,
        (MIN(f.patient_id::text) FILTER (WHERE f.patient_id IS NOT NULL))::uuid AS patient_id,
        COALESCE(
          MAX(public.pe_payload_planned_value(f.payload))
            FILTER (WHERE f.event_type = 'PLAN_CREATED'),
          0
        ) AS planned_value,
        MIN(f.created_at) FILTER (WHERE f.event_type = 'PLAN_CREATED') AS plan_created_at,
        MIN(f.created_at) FILTER (WHERE f.event_type = 'APPOINTMENT_LINKED') AS first_linked_at,
        MAX(f.created_at) FILTER (WHERE f.event_type = 'APPOINTMENT_LINKED') AS last_linked_at,
        MAX(f.created_at) FILTER (WHERE f.event_type = 'APPOINTMENT_UNLINKED') AS last_unlinked_at,
        BOOL_OR(f.event_type = 'PLAN_COMPLETED') AS is_completed
      FROM filtered f
      WHERE f.plan_id IS NOT NULL
      GROUP BY f.plan_id
    )
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'planId', ps.plan_id,
          'patientId', ps.patient_id,
          'plannedValue', ROUND(ps.planned_value, 2),
          'planCreatedAt', ps.plan_created_at,
          'firstLinkedAt', ps.first_linked_at,
          'lastLinkedAt', ps.last_linked_at,
          'lastUnlinkedAt', ps.last_unlinked_at,
          'isCompleted', COALESCE(ps.is_completed, false)
        )
        ORDER BY ps.plan_created_at NULLS LAST, ps.plan_id
      ),
      '[]'::jsonb
    )
    FROM plan_states ps
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- pe_planned_unscheduled_leakage — same ledger scope pattern
-- ---------------------------------------------------------------------------
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
  PERFORM set_config('statement_timeout', '180000', true);

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

  WITH scoped_patients AS MATERIALIZED (
    SELECT p.id
    FROM public.patients p
    WHERE p.organization_id = p_practice_id
      AND p.deleted_at IS NULL
      AND (p_location_id IS NULL OR p.location_id = p_location_id)
  ),
  filtered AS (
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
      AND (v_start_ts IS NULL OR el.created_at >= v_start_ts)
      AND (v_end_ts IS NULL OR el.created_at <= v_end_ts)
      AND (
        p_location_id IS NULL
        OR el.location_id = p_location_id
        OR (
          el.location_id IS NULL
          AND el.patient_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM scoped_patients sp
            WHERE sp.id = el.patient_id
          )
        )
      )
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

-- ---------------------------------------------------------------------------
-- pe_treatment_economic_journey — location fallback for NULL ledger location_id
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pe_treatment_economic_journey(
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
  v_min_planned integer := 5;
  v_min_total integer := 10;
  v_start_ts timestamptz;
  v_end_ts timestamptz;
  v_result JSONB;
  v_planned_count bigint;
  v_total_events bigint;
BEGIN
  PERFORM set_config('statement_timeout', '180000', true);

  SELECT
    COALESCE(ea.journey_min_planned_events, 5),
    COALESCE(ea.journey_min_total_funnel_events, 10)
  INTO v_min_planned, v_min_total
  FROM public.pe_economic_assumptions ea
  WHERE ea.practice_id = p_practice_id
  LIMIT 1;

  IF p_start_date IS NOT NULL THEN
    v_start_ts := (p_start_date::text || 'T00:00:00.000Z')::timestamptz;
  END IF;

  IF p_end_date IS NOT NULL THEN
    v_end_ts := (p_end_date::text || 'T23:59:59.999Z')::timestamptz;
  END IF;

  WITH scoped_patients AS MATERIALIZED (
    SELECT p.id
    FROM public.patients p
    WHERE p.organization_id = p_practice_id
      AND p.deleted_at IS NULL
      AND (p_location_id IS NULL OR p.location_id = p_location_id)
  ),
  base AS (
    SELECT
      el.event_type,
      public.pe_payload_value_gbp(el.payload) AS value_gbp,
      public.pe_payload_plan_key(el.payload) AS plan_key
    FROM public.event_ledger el
    WHERE el.practice_id = p_practice_id
      AND el.event_type IN (
        'PLAN_CREATED',
        'APPOINTMENT_LINKED',
        'TREATMENT_STARTED',
        'PLAN_COMPLETED',
        'INVOICE_RAISED',
        'PAYMENT_ALLOCATED'
      )
      AND (v_start_ts IS NULL OR el.created_at >= v_start_ts)
      AND (v_end_ts IS NULL OR el.created_at <= v_end_ts)
      AND (
        p_location_id IS NULL
        OR el.location_id = p_location_id
        OR (
          el.location_id IS NULL
          AND el.patient_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM scoped_patients sp
            WHERE sp.id = el.patient_id
          )
        )
      )
  ),
  simple AS (
    SELECT
      event_type::text AS event_type,
      COUNT(*)::bigint AS event_count,
      ROUND(COALESCE(SUM(value_gbp), 0), 2) AS value_gbp
    FROM base
    WHERE event_type <> 'APPOINTMENT_LINKED'
    GROUP BY event_type
  ),
  appt_plan_max AS (
    SELECT
      plan_key,
      MAX(value_gbp) AS max_value
    FROM base
    WHERE event_type = 'APPOINTMENT_LINKED'
      AND plan_key IS NOT NULL
      AND plan_key NOT IN ('null', 'undefined')
    GROUP BY plan_key
  ),
  appt AS (
    SELECT
      'APPOINTMENT_LINKED'::text AS event_type,
      COUNT(*)::bigint AS event_count,
      ROUND(
        COALESCE(
          SUM(
            CASE
              WHEN plan_key IS NULL OR plan_key IN ('null', 'undefined') THEN value_gbp
              ELSE 0
            END
          ),
          0
        )
        + COALESCE((SELECT SUM(max_value) FROM appt_plan_max), 0),
        2
      ) AS value_gbp
    FROM base
    WHERE event_type = 'APPOINTMENT_LINKED'
  ),
  all_types AS (
    SELECT * FROM simple
    UNION ALL
    SELECT * FROM appt
  ),
  stages AS (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'key', s.key,
          'label', s.label,
          'eventType', s.event_type,
          'eventCount', COALESCE(t.event_count, 0),
          'valueGbp', COALESCE(t.value_gbp, 0)
        )
        ORDER BY s.ord
      ),
      '[]'::jsonb
    ) AS arr
    FROM (
      VALUES
        (1, 'planned', 'Planned', 'PLAN_CREATED'),
        (2, 'scheduled', 'Scheduled', 'APPOINTMENT_LINKED'),
        (3, 'started', 'Started', 'TREATMENT_STARTED'),
        (4, 'completed', 'Completed', 'PLAN_COMPLETED'),
        (5, 'charged', 'Charged', 'INVOICE_RAISED'),
        (6, 'collected', 'Collected', 'PAYMENT_ALLOCATED')
    ) AS s(ord, key, label, event_type)
    LEFT JOIN all_types t ON t.event_type = s.event_type
  )
  SELECT
    jsonb_build_object(
      'stages', (SELECT arr FROM stages),
      'totalEvents', COALESCE((SELECT SUM(event_count) FROM all_types), 0),
      'plannedEventCount', COALESCE(
        (SELECT event_count FROM all_types WHERE event_type = 'PLAN_CREATED'),
        0
      )
    ),
    COALESCE((SELECT SUM(event_count) FROM all_types), 0),
    COALESCE(
      (SELECT event_count FROM all_types WHERE event_type = 'PLAN_CREATED'),
      0
    )
  INTO v_result, v_total_events, v_planned_count;

  RETURN v_result || jsonb_build_object(
    'isBackfilling',
    v_planned_count < v_min_planned OR v_total_events < v_min_total
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- pe_retention_recovery_loop — facts-only retention; LATERAL last visit per flag
-- ---------------------------------------------------------------------------
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
  v_recovery_window_days integer := 365;
  v_min_contribution numeric := 100;
  v_trailing_months integer := 12;
  v_flags jsonb;
BEGIN
  PERFORM set_config('statement_timeout', '180000', true);

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
      facts.retention_status AS current_retention_status
    FROM flags f
    JOIN public.patients p
      ON p.id = f.patient_id
     AND p.organization_id = p_practice_id
     AND p.deleted_at IS NULL
     AND (p_location_id IS NULL OR p.location_id = p_location_id)
    LEFT JOIN public.pe_patient_contribution_facts facts
      ON facts.practice_id = p_practice_id
     AND facts.patient_id = f.patient_id
  ),
  flag_pt_ids AS (
    SELECT DISTINCT s.patient_id, s.pt_id
    FROM scoped s
    WHERE s.pt_id IS NOT NULL
  ),
  last_visit AS (
    SELECT
      fp.patient_id,
      lv.last_visit_at
    FROM flag_pt_ids fp
    CROSS JOIN LATERAL (
      SELECT a.apmt_completed_at AS last_visit_at
      FROM public.appointments a
      WHERE a.organization_id = p_practice_id
        AND a.apmt_patient_id = fp.pt_id
        AND a.apmt_completed_at IS NOT NULL
        AND a.apmt_completed_at::date <= CURRENT_DATE
        AND LOWER(BTRIM(COALESCE(a.apmt_state, ''))) NOT IN ('cancelled', 'did not attend', 'dna')
      ORDER BY a.apmt_completed_at DESC
      LIMIT 1
    ) lv
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

GRANT EXECUTE ON FUNCTION public.pe_invoice_contribution_summary(UUID, UUID, DATE, DATE)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pe_ledger_plan_states(UUID, UUID, DATE, DATE)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pe_planned_unscheduled_leakage(UUID, UUID, DATE, DATE)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pe_treatment_economic_journey(UUID, UUID, DATE, DATE)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pe_retention_recovery_loop(UUID, UUID)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.pe_invoice_contribution_summary(UUID, UUID, DATE, DATE) IS
  'PE invoice contribution + revenue mix. Single-pass facts aggregation when materialized facts exist.';
COMMENT ON FUNCTION public.pe_ledger_plan_states(UUID, UUID, DATE, DATE) IS
  'Per-plan ledger state for commitment rate and value/leakage reads (optimized location scope).';
COMMENT ON FUNCTION public.pe_planned_unscheduled_leakage(UUID, UUID, DATE, DATE) IS
  'Planned-but-unscheduled private pipeline leakage (optimized ledger scope).';
COMMENT ON FUNCTION public.pe_treatment_economic_journey(UUID, UUID, DATE, DATE) IS
  'Treatment Economic Journey funnel stages (optimized location scope).';
COMMENT ON FUNCTION public.pe_retention_recovery_loop(UUID, UUID) IS
  'Retention recovery loop: flags + patient meta + indexed LATERAL last visit (no v_patient_contribution).';
