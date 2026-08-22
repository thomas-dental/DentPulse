-- Re-point treatment_service_steps at the treatments table instead of synced
-- invoice line items. The Steps tab should simply show every treatment
-- already in the system (same source as the Treatments tab) and let an admin
-- flag "Is Main Treatment Step" / override "Completion Time Used Mins" per
-- treatment -- there is no separate "unmapped service" concept anymore.

-- Drop the invoice-derived sync RPC; it's no longer used.
DROP FUNCTION IF EXISTS public.sync_treatment_service_steps(uuid);

-- Clear out the invoice-derived rows synced under the old approach (test
-- data only -- of the 624 rows synced so far, just 1 had ever been mapped
-- and none had a completion time set).
TRUNCATE TABLE public.treatment_service_steps;

-- The old natural key (service_code/service_name) doesn't hold as the
-- identity anymore -- two treatments could share a name. treatment_id is now
-- the identity.
DROP INDEX IF EXISTS idx_treatment_service_steps_natural_key;

ALTER TABLE public.treatment_service_steps
  ALTER COLUMN treatment_id SET NOT NULL;

ALTER TABLE public.treatment_service_steps
  DROP CONSTRAINT treatment_service_steps_treatment_id_fkey;

ALTER TABLE public.treatment_service_steps
  ADD CONSTRAINT treatment_service_steps_treatment_id_fkey
  FOREIGN KEY (treatment_id) REFERENCES public.treatments(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_treatment_service_steps_treatment_id_unique
  ON public.treatment_service_steps (treatment_id)
  WHERE deleted_at IS NULL;

-- ============================================
-- Keep treatment_service_steps in lockstep with treatments automatically --
-- no manual "sync" action needed. Fires on every insert/update path
-- (Add Treatment dialog, CSV bulk upsert, Dentally sync), since it's a
-- table-level trigger.
-- ============================================
CREATE OR REPLACE FUNCTION public.sync_treatment_service_step_for_treatment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN
    UPDATE public.treatment_service_steps
    SET deleted_at = NEW.deleted_at, updated_by = NEW.updated_by
    WHERE treatment_id = NEW.id AND deleted_at IS NULL;
  ELSE
    INSERT INTO public.treatment_service_steps (
      organization_id, treatment_id, service_code, service_name, created_by
    )
    VALUES (
      NEW.organization_id, NEW.id, NEW.treatment_code, NEW.treatment_name,
      COALESCE(NEW.updated_by, NEW.created_by)
    )
    ON CONFLICT (treatment_id) WHERE deleted_at IS NULL
    DO UPDATE SET
      service_code = EXCLUDED.service_code,
      service_name = EXCLUDED.service_name;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_treatment_service_step ON public.treatments;
CREATE TRIGGER trg_sync_treatment_service_step
  AFTER INSERT OR UPDATE ON public.treatments
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_treatment_service_step_for_treatment();

-- One-time backfill for treatments that already existed before this trigger.
INSERT INTO public.treatment_service_steps (
  organization_id, treatment_id, service_code, service_name, created_by
)
SELECT organization_id, id, treatment_code, treatment_name, created_by
FROM public.treatments
WHERE deleted_at IS NULL
ON CONFLICT (treatment_id) WHERE deleted_at IS NULL DO NOTHING;

COMMENT ON TABLE public.treatment_service_steps IS 'Per-treatment step settings (Is Main Treatment Step, Completion Time Used Mins) for the Steps tab. One row per treatment, kept in sync automatically via trg_sync_treatment_service_step -- not a separate service catalog.';
COMMENT ON COLUMN public.treatment_service_steps.service_code IS 'Mirrors treatments.treatment_code at the time it was last synced by the trigger';
COMMENT ON COLUMN public.treatment_service_steps.service_name IS 'Mirrors treatments.treatment_name at the time it was last synced by the trigger';
COMMENT ON FUNCTION public.sync_treatment_service_step_for_treatment() IS 'Keeps treatment_service_steps in lockstep with treatments: inserts/refreshes the mirrored row on insert/update, soft-deletes it when the treatment is soft-deleted.';
