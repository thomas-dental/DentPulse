-- Treatment Economic Journey: aggregate event_ledger in Postgres (one round-trip).

CREATE OR REPLACE FUNCTION public.pe_payload_value_gbp(payload jsonb)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    NULLIF(payload->>'planned_value', '')::numeric,
    NULLIF(payload->>'tp_private_treatment_value', '')::numeric,
    NULLIF(payload->>'value', '')::numeric,
    NULLIF(payload->>'amount', '')::numeric,
    NULLIF(payload->>'total', '')::numeric,
    0
  );
$$;

CREATE OR REPLACE FUNCTION public.pe_payload_plan_key(payload jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    NULLIF(BTRIM(payload->>'plan_id'), ''),
    NULLIF(BTRIM(payload->>'ta_treatment_plan_id'), '')
  );
$$;

CREATE INDEX IF NOT EXISTS idx_event_ledger_journey_loc
  ON public.event_ledger (practice_id, location_id, event_type, created_at)
  WHERE location_id IS NOT NULL;

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
  PERFORM set_config('statement_timeout', '120000', true);

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

  WITH base AS (
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
      AND (p_location_id IS NULL OR el.location_id = p_location_id)
      AND (v_start_ts IS NULL OR el.created_at >= v_start_ts)
      AND (v_end_ts IS NULL OR el.created_at <= v_end_ts)
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

GRANT EXECUTE ON FUNCTION public.pe_payload_value_gbp(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pe_payload_plan_key(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pe_treatment_economic_journey(UUID, UUID, DATE, DATE)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.pe_treatment_economic_journey(UUID, UUID, DATE, DATE) IS
  'Treatment Economic Journey funnel stages aggregated from event_ledger in one query.';
