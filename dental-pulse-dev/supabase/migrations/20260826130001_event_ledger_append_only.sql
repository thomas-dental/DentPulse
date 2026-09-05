-- ============================================================================
-- Patient Economics — Event Ledger (append-only)
--
-- Step 1 audit (2026-08-26):
--   • No reusable patient economic journey table to extend in-repo.
--   • Closest PE relatives (sync_runs, sync_run_history, membership events)
--     are sync/ops or membership-scoped — not extended.
--   • Linked remote already had public.event_ledger from an earlier branch
--     that was reset from git. This migration is the repo source of truth:
--     CREATE IF NOT EXISTS + harden grants/RLS/triggers so local and remote
--     converge.
--
-- practice_id = public.organizations.id (DentPulse tenant / "practice").
-- patient_id  = public.patients.id (row UUID, not Dentally pt_id).
--
-- ---------------------------------------------------------------------------
-- Expected payload contract (JSONB) — every sync hook MUST satisfy this.
-- Extra keys are allowed; listed keys are the minimum meaningful shape.
--
-- PLAN_CREATED
--   plan_id / tp_id (Dentally treatment plan id), planned_value /
--   tp_private_treatment_value, optional tp_nickname, tp_patient_id,
--   source_table='treatment_plans', source_record_id
--
-- APPOINTMENT_LINKED
--   appointment_id / ta_appointment_id (diary appointment id),
--   plan_id / ta_treatment_plan_id, ta_id, ta_patient_id,
--   planned_value / tp_private_treatment_value (copied from treatment_plans
--   at write time so Journey Scheduled can chart £),
--   source_table='treatment_appointments', source_record_id
--
-- APPOINTMENT_UNLINKED
--   previous appointment_id / previous_ta_appointment_id, plan_id /
--   ta_treatment_plan_id, ta_id, ta_patient_id (ta_appointment_id null),
--   optional planned_value (same copy when available),
--   source_table='treatment_appointments', source_record_id
--
-- TREATMENT_STARTED
--   plan_id / tp_id, start_date / tp_start_date, optional planned_value,
--   tp_nickname, tp_patient_id, source_table='treatment_plans',
--   source_record_id
--
-- ITEM_COMPLETED
--   treatment_item_id / tpi_id, plan_id, completed_at / completed_date,
--   optional value, patient id, source_table='treatment_plan_items',
--   source_record_id
--
-- PLAN_COMPLETED
--   plan_id / tp_id, completed_at / tp_completed_at (or equivalent),
--   optional planned_value, tp_patient_id, source_table='treatment_plans',
--   source_record_id
--
-- INVOICE_RAISED
--   invoice_id, optional plan_id, amount / total, raised_at / invoice_date,
--   patient id, source_table, source_record_id
--
-- PAYMENT_ALLOCATED
--   payment_id, optional invoice_id, amount, allocated_at / payment_date,
--   patient id, source_table, source_record_id
--
-- RECALL_DUE
--   recall_id, due_date, optional recall_type, patient id, source_table,
--   source_record_id
--
-- RECALL_OVERDUE
--   recall_id, due_date, overdue_as_of (or equivalent), optional recall_type,
--   patient id, source_table, source_record_id
--
-- PATIENT_REACTIVATED
--   patient Dentally id / pt_id, reactivated_at, optional prior_inactive_since,
--   source_table='patients', source_record_id
-- ---------------------------------------------------------------------------
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'pe_economic_event_type') THEN
    CREATE TYPE public.pe_economic_event_type AS ENUM (
      'PLAN_CREATED',
      'APPOINTMENT_LINKED',
      'APPOINTMENT_UNLINKED',
      'TREATMENT_STARTED',
      'ITEM_COMPLETED',
      'PLAN_COMPLETED',
      'INVOICE_RAISED',
      'PAYMENT_ALLOCATED',
      'RECALL_DUE',
      'RECALL_OVERDUE',
      'PATIENT_REACTIVATED'
    );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.event_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  event_type public.pe_economic_event_type NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Stable upsert key for sync + backfill (practice-scoped).
  idempotency_key TEXT NOT NULL
);

COMMENT ON TABLE public.event_ledger IS
  'Patient Economics: append-only per-patient economic journey events. Org members SELECT; INSERT via service_role only. See migration header for payload contract per event_type.';
COMMENT ON COLUMN public.event_ledger.practice_id IS
  'FK to public.organizations (tenant / practice).';
COMMENT ON COLUMN public.event_ledger.patient_id IS
  'FK to public.patients.id (DentPulse UUID, not Dentally pt_id).';
COMMENT ON COLUMN public.event_ledger.event_type IS
  'Journey transition; enum pe_economic_event_type.';
COMMENT ON COLUMN public.event_ledger.payload IS
  'Event-specific JSON. Minimum shapes documented in migration 20260826130001 header.';
COMMENT ON COLUMN public.event_ledger.created_at IS
  'When the economic event occurred (prefer Dentally timestamp when available).';
COMMENT ON COLUMN public.event_ledger.idempotency_key IS
  'Unique per practice; e.g. plan_created:{tp_id}, appointment_linked:{ta_id}:{appt_id}.';

-- Idempotent column add if an older remote table lacked it
ALTER TABLE public.event_ledger
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

-- Backfill empty keys only if column was just added with nulls (safe no-op when NOT NULL + populated)
UPDATE public.event_ledger
SET idempotency_key = id::text
WHERE idempotency_key IS NULL OR idempotency_key = '';

ALTER TABLE public.event_ledger
  ALTER COLUMN idempotency_key SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS event_ledger_practice_idempotency_unique
  ON public.event_ledger (practice_id, idempotency_key);

CREATE INDEX IF NOT EXISTS idx_event_ledger_timeline
  ON public.event_ledger (practice_id, patient_id, event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_event_ledger_practice_id
  ON public.event_ledger (practice_id);

CREATE INDEX IF NOT EXISTS idx_event_ledger_patient_id
  ON public.event_ledger (patient_id);

-- ---------------------------------------------------------------------------
-- Append-only at Postgres level: reject UPDATE/DELETE for all roles
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.event_ledger_reject_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'event_ledger is append-only: UPDATE not allowed';
END;
$$;

CREATE OR REPLACE FUNCTION public.event_ledger_reject_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'event_ledger is append-only: DELETE not allowed';
END;
$$;

DROP TRIGGER IF EXISTS event_ledger_no_update ON public.event_ledger;
CREATE TRIGGER event_ledger_no_update
  BEFORE UPDATE ON public.event_ledger
  FOR EACH ROW
  EXECUTE FUNCTION public.event_ledger_reject_update();

DROP TRIGGER IF EXISTS event_ledger_no_delete ON public.event_ledger;
CREATE TRIGGER event_ledger_no_delete
  BEFORE DELETE ON public.event_ledger
  FOR EACH ROW
  EXECUTE FUNCTION public.event_ledger_reject_delete();

-- ---------------------------------------------------------------------------
-- RLS + grants (match PE sync_runs pattern; stricter write grants)
-- ---------------------------------------------------------------------------
ALTER TABLE public.event_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view event ledger for their practice" ON public.event_ledger;
CREATE POLICY "Users can view event ledger for their practice"
  ON public.event_ledger
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND public.user_in_org(auth.uid(), practice_id)
  );

REVOKE ALL ON TABLE public.event_ledger FROM anon, authenticated;
GRANT SELECT ON TABLE public.event_ledger TO authenticated;

-- Service role: SELECT + INSERT only (no UPDATE/DELETE grants — triggers also block)
REVOKE ALL ON TABLE public.event_ledger FROM service_role;
GRANT SELECT, INSERT ON TABLE public.event_ledger TO service_role;
