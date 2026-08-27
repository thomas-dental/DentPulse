-- ============================================================================
-- Backfill planned_value onto existing APPOINTMENT_LINKED event_ledger rows
-- from treatment_plans.tp_private_treatment_value (Option 2 enrichment).
-- Append-only UPDATE trigger is temporarily disabled for this patch only.
-- ============================================================================

ALTER TABLE public.event_ledger DISABLE TRIGGER event_ledger_no_update;

UPDATE public.event_ledger e
SET payload = e.payload
  || jsonb_build_object(
    'planned_value', tp.tp_private_treatment_value,
    'tp_private_treatment_value', tp.tp_private_treatment_value
  )
FROM public.treatment_plans tp
WHERE e.event_type = 'APPOINTMENT_LINKED'
  AND e.practice_id = tp.organization_id
  AND tp.tp_id = COALESCE(
    NULLIF(e.payload->>'plan_id', '')::bigint,
    NULLIF(e.payload->>'ta_treatment_plan_id', '')::bigint
  )
  AND tp.tp_private_treatment_value IS NOT NULL
  AND (
    e.payload->>'planned_value' IS NULL
    OR e.payload->>'planned_value' = ''
    OR e.payload->>'planned_value' = 'null'
  );

ALTER TABLE public.event_ledger ENABLE TRIGGER event_ledger_no_update;

COMMENT ON TABLE public.event_ledger IS
  'Patient Economics: append-only per-patient economic journey events. Org members SELECT; INSERT via service_role only. APPOINTMENT_LINKED carries planned_value copied from treatment_plans at write/backfill.';
