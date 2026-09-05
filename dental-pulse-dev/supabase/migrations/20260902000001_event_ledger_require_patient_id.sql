-- Treatment Economic Journey™ only includes ledger events tied to a synced patient.
-- Orphan rows (no patients.id for source pt_id) must not be written; remove any
-- that were inserted during a prior nullable-patient_id experiment.

-- One-time purge: append-only trigger blocks DELETE in normal operation.
DROP TRIGGER IF EXISTS event_ledger_no_delete ON public.event_ledger;

DELETE FROM public.event_ledger
WHERE patient_id IS NULL;

CREATE TRIGGER event_ledger_no_delete
  BEFORE DELETE ON public.event_ledger
  FOR EACH ROW
  EXECUTE FUNCTION public.event_ledger_reject_delete();

ALTER TABLE public.event_ledger
  ALTER COLUMN patient_id SET NOT NULL;

COMMENT ON COLUMN public.event_ledger.patient_id IS
  'FK to public.patients.id (DentPulse UUID). Required — sync skips ledger writes when pt_id does not resolve.';
