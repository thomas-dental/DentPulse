-- Batched location backfill to avoid statement timeout on large practices.

CREATE OR REPLACE FUNCTION public.pe_event_ledger_backfill_location_batch(
  p_practice_id UUID,
  p_batch_size INT DEFAULT 5000
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
  v_matched BIGINT := 0;
  v_orphan BIGINT := 0;
  v_lim INT := GREATEST(100, LEAST(COALESCE(p_batch_size, 5000), 20000));
BEGIN
  ALTER TABLE public.event_ledger DISABLE TRIGGER event_ledger_no_update;

  WITH batch AS (
    SELECT el.ctid AS row_id, p.location_id AS new_location_id
    FROM public.event_ledger el
    INNER JOIN public.patients p
      ON el.patient_id = p.id
    WHERE el.practice_id = p_practice_id
      AND el.location_id IS DISTINCT FROM p.location_id
    LIMIT v_lim
  )
  UPDATE public.event_ledger el
  SET location_id = batch.new_location_id
  FROM batch
  WHERE el.ctid = batch.row_id;

  GET DIAGNOSTICS v_matched = ROW_COUNT;

  WITH batch AS (
    SELECT el.ctid AS row_id, p.location_id AS new_location_id
    FROM public.event_ledger el
    INNER JOIN public.patients p
      ON p.organization_id = el.practice_id
     AND p.deleted_at IS NULL
     AND p.pt_id IS NOT NULL
     AND p.pt_id = NULLIF(BTRIM(el.payload ->> 'pt_id'), '')::bigint
    WHERE el.practice_id = p_practice_id
      AND el.patient_id IS NULL
      AND el.location_id IS NULL
    LIMIT v_lim
  )
  UPDATE public.event_ledger el
  SET location_id = batch.new_location_id
  FROM batch
  WHERE el.ctid = batch.row_id;

  GET DIAGNOSTICS v_orphan = ROW_COUNT;

  ALTER TABLE public.event_ledger ENABLE TRIGGER event_ledger_no_update;

  matched_updated := v_matched;
  orphan_updated := v_orphan;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.pe_event_ledger_backfill_location_batch IS
  'Backfill event_ledger.location_id in batches for one practice (avoids statement timeout).';

REVOKE ALL ON FUNCTION public.pe_event_ledger_backfill_location_batch(UUID, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pe_event_ledger_backfill_location_batch(UUID, INT) TO service_role;
