-- Fast treatment_appointment discovery for Dentally appointment webhooks.
-- Replaces two separate Supabase client queries with one indexed RPC round trip.

CREATE INDEX IF NOT EXISTS idx_ta_org_appt_active
  ON public.treatment_appointments (organization_id, ta_appointment_id)
  WHERE deleted_at IS NULL AND ta_appointment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ta_org_patient_unlinked
  ON public.treatment_appointments (organization_id, ta_patient_id)
  WHERE deleted_at IS NULL AND ta_appointment_id IS NULL;

-- ---------------------------------------------------------------------------
-- Discover treatment_appointment ids linked (or candidate-unlinked) to a diary
-- appointment. Returns at most 25 ids, linked rows first.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pe_webhook_discover_ta_ids(
  p_practice_id UUID,
  p_appointment_id BIGINT,
  p_patient_id BIGINT DEFAULT NULL
)
RETURNS BIGINT[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '5s'
AS $$
  SELECT COALESCE(array_agg(s.ta_id), '{}'::bigint[])
  FROM (
    SELECT ta.ta_id
    FROM public.treatment_appointments ta
    WHERE ta.organization_id = p_practice_id
      AND ta.deleted_at IS NULL
      AND (
        ta.ta_appointment_id = p_appointment_id
        OR (
          p_patient_id IS NOT NULL
          AND ta.ta_patient_id = p_patient_id
          AND ta.ta_appointment_id IS NULL
        )
      )
    ORDER BY
      CASE WHEN ta.ta_appointment_id = p_appointment_id THEN 0 ELSE 1 END,
      ta.ta_updated_at DESC NULLS LAST,
      ta.ta_id
    LIMIT 25
  ) s;
$$;

GRANT EXECUTE ON FUNCTION public.pe_webhook_discover_ta_ids(UUID, BIGINT, BIGINT)
  TO service_role;

COMMENT ON FUNCTION public.pe_webhook_discover_ta_ids IS
  'Appointment webhook: find linked + patient-unlinked treatment_appointment candidates in one query.';

-- ---------------------------------------------------------------------------
-- Batch prefetch existing treatment_appointment rows + ledger idempotency keys
-- for a set of ta_ids (replaces N per-row ledger prefetches).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pe_webhook_ta_ledger_prefetch(
  p_practice_id UUID,
  p_ta_ids BIGINT[]
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '8s'
AS $$
DECLARE
  v_rows JSONB := '[]'::jsonb;
  v_keys TEXT[] := ARRAY[]::text[];
  v_found JSONB := '[]'::jsonb;
  r RECORD;
BEGIN
  IF p_ta_ids IS NULL OR cardinality(p_ta_ids) = 0 THEN
    RETURN jsonb_build_object('rows', '[]'::jsonb, 'ledger_keys', '[]'::jsonb);
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.ta_id), '[]'::jsonb)
  INTO v_rows
  FROM public.treatment_appointments t
  WHERE t.organization_id = p_practice_id
    AND t.ta_id = ANY(p_ta_ids);

  FOR r IN
    SELECT ta_id, ta_appointment_id
    FROM public.treatment_appointments
    WHERE organization_id = p_practice_id
      AND ta_id = ANY(p_ta_ids)
      AND ta_appointment_id IS NOT NULL
  LOOP
    v_keys := v_keys || ARRAY[
      'appointment_linked:' || r.ta_id::text || ':' || r.ta_appointment_id::text,
      'appointment_unlinked:' || r.ta_id::text || ':' || r.ta_appointment_id::text
    ];
  END LOOP;

  v_keys := ARRAY(SELECT DISTINCT unnest(v_keys));

  IF cardinality(v_keys) > 0 THEN
    SELECT COALESCE(jsonb_agg(el.idempotency_key ORDER BY el.idempotency_key), '[]'::jsonb)
    INTO v_found
    FROM public.event_ledger el
    WHERE el.practice_id = p_practice_id
      AND el.idempotency_key = ANY(v_keys);
  END IF;

  RETURN jsonb_build_object(
    'rows', v_rows,
    'ledger_keys', COALESCE(v_found, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.pe_webhook_ta_ledger_prefetch(UUID, BIGINT[])
  TO service_role;

COMMENT ON FUNCTION public.pe_webhook_ta_ledger_prefetch IS
  'Appointment webhook: batch-load existing TA rows + ledger keys before upsert diff.';
