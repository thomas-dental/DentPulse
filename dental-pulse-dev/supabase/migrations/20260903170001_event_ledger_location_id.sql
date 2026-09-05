-- event_ledger.location_id — patient home location at write time (practice_locations.id).
-- Backfill from patients; orphans resolved via payload pt_id.

ALTER TABLE public.event_ledger
  ADD COLUMN IF NOT EXISTS location_id UUID
    REFERENCES public.practice_locations(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.event_ledger.location_id IS
  'Patient home location (practice_locations.id) when known. Nullable for orphans until patient sync resolves pt_id.';

CREATE INDEX IF NOT EXISTS idx_event_ledger_practice_location
  ON public.event_ledger (practice_id, location_id)
  WHERE location_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_event_ledger_practice_location_created
  ON public.event_ledger (practice_id, location_id, created_at DESC)
  WHERE location_id IS NOT NULL;

ALTER TABLE public.event_ledger DISABLE TRIGGER event_ledger_no_update;

UPDATE public.event_ledger el
SET location_id = p.location_id
FROM public.patients p
WHERE el.patient_id = p.id
  AND el.location_id IS DISTINCT FROM p.location_id;

UPDATE public.event_ledger el
SET location_id = p.location_id
FROM public.patients p
WHERE el.patient_id IS NULL
  AND el.location_id IS NULL
  AND p.organization_id = el.practice_id
  AND p.deleted_at IS NULL
  AND p.pt_id IS NOT NULL
  AND p.pt_id = NULLIF(BTRIM(el.payload ->> 'pt_id'), '')::bigint;

ALTER TABLE public.event_ledger ENABLE TRIGGER event_ledger_no_update;

CREATE OR REPLACE FUNCTION public.pe_event_ledger_backfill_location(
  p_practice_id UUID DEFAULT NULL
)
RETURNS TABLE (
  matched_updated BIGINT,
  orphan_updated BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_matched BIGINT;
  v_orphan BIGINT;
BEGIN
  ALTER TABLE public.event_ledger DISABLE TRIGGER event_ledger_no_update;

  UPDATE public.event_ledger el
  SET location_id = p.location_id
  FROM public.patients p
  WHERE el.patient_id = p.id
    AND (p_practice_id IS NULL OR el.practice_id = p_practice_id)
    AND el.location_id IS DISTINCT FROM p.location_id;

  GET DIAGNOSTICS v_matched = ROW_COUNT;

  UPDATE public.event_ledger el
  SET location_id = p.location_id
  FROM public.patients p
  WHERE el.patient_id IS NULL
    AND el.location_id IS NULL
    AND p.organization_id = el.practice_id
    AND p.deleted_at IS NULL
    AND p.pt_id IS NOT NULL
    AND p.pt_id = NULLIF(BTRIM(el.payload ->> 'pt_id'), '')::bigint
    AND (p_practice_id IS NULL OR el.practice_id = p_practice_id);

  GET DIAGNOSTICS v_orphan = ROW_COUNT;

  ALTER TABLE public.event_ledger ENABLE TRIGGER event_ledger_no_update;

  matched_updated := v_matched;
  orphan_updated := v_orphan;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.pe_event_ledger_backfill_location IS
  'Backfill event_ledger.location_id from patients (matched patient_id + orphan payload pt_id).';

REVOKE ALL ON FUNCTION public.pe_event_ledger_backfill_location(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pe_event_ledger_backfill_location(UUID) TO service_role;
