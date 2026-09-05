-- Allow event_ledger rows when Dentally pt_id does not yet resolve to patients.id.
-- Orphan events keep patient_id NULL; pt_id is stored in payload for later backfill.

ALTER TABLE public.event_ledger
  ALTER COLUMN patient_id DROP NOT NULL;

COMMENT ON COLUMN public.event_ledger.patient_id IS
  'FK to public.patients.id when matched. NULL for orphan Dentally pt_id rows (see payload.pt_id).';
