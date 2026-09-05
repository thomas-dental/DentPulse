-- Commitment / leakage reads: aggregate event_ledger plan state in Postgres (one round-trip).

CREATE OR REPLACE FUNCTION public.pe_payload_plan_id(payload jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    NULLIF(BTRIM(payload->>'tp_id'), ''),
    NULLIF(BTRIM(payload->>'plan_id'), ''),
    NULLIF(BTRIM(payload->>'ta_treatment_plan_id'), '')
  );
$$;

CREATE OR REPLACE FUNCTION public.pe_payload_planned_value(payload jsonb)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    NULLIF(NULLIF(payload->>'planned_value', '')::numeric, 0),
    NULLIF(NULLIF(payload->>'tp_private_treatment_value', '')::numeric, 0),
    NULLIF(NULLIF(payload->>'value', '')::numeric, 0),
    NULLIF(NULLIF(payload->>'amount', '')::numeric, 0),
    NULLIF(NULLIF(payload->>'total', '')::numeric, 0),
    0
  );
$$;

CREATE INDEX IF NOT EXISTS idx_event_ledger_commitment_loc
  ON public.event_ledger (practice_id, location_id, event_type, created_at)
  WHERE event_type IN (
    'PLAN_CREATED',
    'APPOINTMENT_LINKED',
    'APPOINTMENT_UNLINKED',
    'PLAN_COMPLETED'
  );

CREATE INDEX IF NOT EXISTS idx_tpi_org_plan
  ON public.treatment_plan_items (organization_id, tpi_treatment_plan_id)
  WHERE deleted_at IS NULL;

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
  PERFORM set_config('statement_timeout', '120000', true);

  IF p_start_date IS NOT NULL THEN
    v_start_ts := (p_start_date::text || 'T00:00:00.000Z')::timestamptz;
  END IF;

  IF p_end_date IS NOT NULL THEN
    v_end_ts := (p_end_date::text || 'T23:59:59.999Z')::timestamptz;
  END IF;

  RETURN (
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

GRANT EXECUTE ON FUNCTION public.pe_payload_plan_id(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pe_payload_planned_value(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pe_ledger_plan_states(UUID, UUID, DATE, DATE)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.pe_ledger_plan_states(UUID, UUID, DATE, DATE) IS
  'Per-plan ledger state for commitment rate and value/leakage reads (replaces paginated event_ledger scans).';
