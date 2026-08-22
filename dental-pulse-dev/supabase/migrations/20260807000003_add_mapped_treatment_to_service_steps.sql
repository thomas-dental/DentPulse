-- Restore the "map this step to a Treatment" capability from the original
-- design, now that each row's own identity is already a treatment
-- (treatment_id). This is a *separate* column: mapped_treatment_id links a
-- step (e.g. "X-ray", "Root Canal - Session 1") to the bigger/parent
-- treatment it belongs under (e.g. "Root Canal - Full Treatment").

ALTER TABLE public.treatment_service_steps
  ADD COLUMN IF NOT EXISTS mapped_treatment_id uuid;

ALTER TABLE public.treatment_service_steps
  ADD CONSTRAINT treatment_service_steps_mapped_treatment_id_fkey
  FOREIGN KEY (mapped_treatment_id) REFERENCES public.treatments(id) ON DELETE SET NULL;

ALTER TABLE public.treatment_service_steps
  ADD CONSTRAINT treatment_service_steps_no_self_mapping
  CHECK (mapped_treatment_id IS NULL OR mapped_treatment_id <> treatment_id);

CREATE INDEX IF NOT EXISTS idx_treatment_service_steps_mapped_treatment_id
  ON public.treatment_service_steps(mapped_treatment_id);

COMMENT ON COLUMN public.treatment_service_steps.mapped_treatment_id IS 'The parent/main treatment this step belongs to (e.g. "X-ray" mapped under "Root Canal - Full Treatment"); null while unmapped. Distinct from treatment_id, which is this row''s own identity.';
