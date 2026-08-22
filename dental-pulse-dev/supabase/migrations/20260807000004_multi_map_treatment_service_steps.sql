-- Allow a treatment step to be mapped to MULTIPLE parent/main treatments
-- (previously a single mapped_treatment_id column supported only one).
-- Introduces a join table, migrates existing single mappings into it, then
-- drops the old column.

CREATE TABLE IF NOT EXISTS public.treatment_service_step_mappings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  step_id uuid NOT NULL,
  treatment_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  created_by uuid,
  CONSTRAINT treatment_service_step_mappings_pkey PRIMARY KEY (id),
  CONSTRAINT treatment_service_step_mappings_unique UNIQUE (step_id, treatment_id)
);

ALTER TABLE public.treatment_service_step_mappings
  ADD CONSTRAINT treatment_service_step_mappings_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE public.treatment_service_step_mappings
  ADD CONSTRAINT treatment_service_step_mappings_step_id_fkey
  FOREIGN KEY (step_id) REFERENCES public.treatment_service_steps(id) ON DELETE CASCADE;

ALTER TABLE public.treatment_service_step_mappings
  ADD CONSTRAINT treatment_service_step_mappings_treatment_id_fkey
  FOREIGN KEY (treatment_id) REFERENCES public.treatments(id) ON DELETE CASCADE;

ALTER TABLE public.treatment_service_step_mappings
  ADD CONSTRAINT treatment_service_step_mappings_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_treatment_service_step_mappings_step_id ON public.treatment_service_step_mappings(step_id);
CREATE INDEX IF NOT EXISTS idx_treatment_service_step_mappings_treatment_id ON public.treatment_service_step_mappings(treatment_id);
CREATE INDEX IF NOT EXISTS idx_treatment_service_step_mappings_organization_id ON public.treatment_service_step_mappings(organization_id);

-- A step can't be mapped under its own treatment.
CREATE OR REPLACE FUNCTION public.prevent_self_treatment_step_mapping()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.treatment_service_steps s
    WHERE s.id = NEW.step_id AND s.treatment_id = NEW.treatment_id
  ) THEN
    RAISE EXCEPTION 'A treatment step cannot be mapped to its own treatment';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_self_treatment_step_mapping ON public.treatment_service_step_mappings;
CREATE TRIGGER trg_prevent_self_treatment_step_mapping
  BEFORE INSERT ON public.treatment_service_step_mappings
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_self_treatment_step_mapping();

ALTER TABLE public.treatment_service_step_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view treatment service step mappings in their org"
ON public.treatment_service_step_mappings FOR SELECT
USING (
  auth.uid() IS NOT NULL AND
  public.user_in_org(auth.uid(), organization_id)
);

CREATE POLICY "Owners and admins can insert treatment service step mappings"
ON public.treatment_service_step_mappings FOR INSERT
WITH CHECK (
  auth.uid() IS NOT NULL AND
  (
    public.has_org_role(auth.uid(), organization_id, 'owner'::app_role) OR
    public.has_org_role(auth.uid(), organization_id, 'admin'::app_role)
  )
);

CREATE POLICY "Owners and admins can delete treatment service step mappings"
ON public.treatment_service_step_mappings FOR DELETE
USING (
  auth.uid() IS NOT NULL AND
  (
    public.has_org_role(auth.uid(), organization_id, 'owner'::app_role) OR
    public.has_org_role(auth.uid(), organization_id, 'admin'::app_role)
  )
);
-- No UPDATE policy -- mappings are replaced via delete+insert, never edited in place.

-- Migrate existing single mappings across before dropping the column.
INSERT INTO public.treatment_service_step_mappings (organization_id, step_id, treatment_id, created_by)
SELECT organization_id, id, mapped_treatment_id, updated_by
FROM public.treatment_service_steps
WHERE mapped_treatment_id IS NOT NULL
ON CONFLICT (step_id, treatment_id) DO NOTHING;

ALTER TABLE public.treatment_service_steps
  DROP CONSTRAINT IF EXISTS treatment_service_steps_mapped_treatment_id_fkey;
ALTER TABLE public.treatment_service_steps
  DROP CONSTRAINT IF EXISTS treatment_service_steps_no_self_mapping;
DROP INDEX IF EXISTS idx_treatment_service_steps_mapped_treatment_id;
ALTER TABLE public.treatment_service_steps
  DROP COLUMN IF EXISTS mapped_treatment_id;

COMMENT ON TABLE public.treatment_service_step_mappings IS 'Many-to-many: which parent/main treatment(s) a treatment step is mapped under. Replaces the old single mapped_treatment_id column on treatment_service_steps.';
