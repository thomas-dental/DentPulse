-- Rollback for 20260809000001_enforce_single_treatment_per_step_mapping.sql.
-- Only reverses the constraint; the dedupe DELETE in that migration cannot be
-- undone here since the rows it removed were already deleted before this
-- runs (backup/point-in-time restore is the only way to get those back).

ALTER TABLE public.treatment_service_step_mappings
  DROP CONSTRAINT IF EXISTS treatment_service_step_mappings_step_id_unique;

COMMENT ON TABLE public.treatment_service_step_mappings IS 'Many-to-many: which parent/main treatment(s) a treatment step is mapped under.';
