-- Retention Recovery Loop: honour TopBar location + period (flagged_at in scope).

DROP FUNCTION IF EXISTS public.pe_retention_recovery_loop(UUID, UUID);

CREATE OR REPLACE FUNCTION public.pe_retention_recovery_loop(
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
  v_recovery_window_days integer := 365;
  v_min_contribution numeric := 100;
  v_trailing_months integer := 12;
  v_start_ts timestamptz;
  v_end_ts timestamptz;
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

  IF p_start_date IS NOT NULL THEN
    v_start_ts := (p_start_date::text || 'T00:00:00.000Z')::timestamptz;
  END IF;

  IF p_end_date IS NOT NULL THEN
    v_end_ts := (p_end_date::text || 'T23:59:59.999Z')::timestamptz;
  END IF;

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
      AND (
        p_start_date IS NULL
        OR p_end_date IS NULL
        OR (
          fl.flagged_at >= v_start_ts
          AND fl.flagged_at <= v_end_ts
        )
      )
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

GRANT EXECUTE ON FUNCTION public.pe_retention_recovery_loop(UUID, UUID, DATE, DATE)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.pe_retention_recovery_loop(UUID, UUID, DATE, DATE) IS
  'Retention recovery loop: reactivation flags + patient meta + last visit; scoped by patient location and flagged_at period.';
