-- Planned unscheduled leakage: full ledger for link state; period filters plan_created_at only.

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
      AND (
        p_start_date IS NULL
        OR p_end_date IS NULL
        OR (
          timezone('UTC', ps.plan_created_at)::date >= p_start_date
          AND timezone('UTC', ps.plan_created_at)::date <= p_end_date
        )
      )
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

COMMENT ON FUNCTION public.pe_planned_unscheduled_leakage(UUID, UUID, DATE, DATE) IS
  'Present-state planned-but-unscheduled private pipeline. Full event_ledger for link/completed state; '
  'TopBar period (when both dates set) filters plan_created_at only; 60-day threshold is relative to now().';
