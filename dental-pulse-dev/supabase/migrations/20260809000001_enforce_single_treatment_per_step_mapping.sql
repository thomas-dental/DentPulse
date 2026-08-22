-- Enforce that a treatment step can only ever be mapped under ONE parent
-- treatment. The join table introduced in
-- 20260807000004_multi_map_treatment_service_steps.sql allowed a step to be
-- mapped to multiple treatments at once; that's no longer wanted now that
-- the "Treatment List Incl." tab + Add Steps modal on the Edit Treatment
-- page let an admin build a treatment's step list directly -- a step used by
-- one treatment must disappear from every other treatment's step picker.

-- Dedupe first (test data only): keep the earliest mapping per step, drop
-- the rest, so the new unique constraint below can be added cleanly.
DELETE FROM public.treatment_service_step_mappings m
WHERE m.id NOT IN (
  SELECT DISTINCT ON (step_id) id
  FROM public.treatment_service_step_mappings
  ORDER BY step_id, created_at ASC, id ASC
);

ALTER TABLE public.treatment_service_step_mappings
  ADD CONSTRAINT treatment_service_step_mappings_step_id_unique UNIQUE (step_id);

COMMENT ON TABLE public.treatment_service_step_mappings IS 'Which single parent/main treatment a treatment step is mapped under (at most one row per step_id, enforced by treatment_service_step_mappings_step_id_unique). Surfaced as the "Treatment List Incl." tab + Add Steps modal on the Edit Treatment page, and the Steps tab in Treatment Setup.';
