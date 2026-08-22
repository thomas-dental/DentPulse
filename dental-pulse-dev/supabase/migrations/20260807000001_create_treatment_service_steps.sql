-- Treatment service-step mapping ("Steps" tab in Treatment Setup)
-- Ports the legacy fe-dentpulse-live "Treatment List Inc." feature: each row is a
-- billable service (as it appears on a synced invoice) mapped to a Treatment,
-- with a "main step" flag and a completion-time override. Unlike the legacy
-- system (which required a manual CSV/SOE export upload), rows here are
-- auto-derived from platform_integration_invoice_line_items, which dental-pulse-dev
-- already syncs live from Dentally/Xero/QuickBooks.

CREATE TABLE IF NOT EXISTS public.treatment_service_steps (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  treatment_id uuid,

  service_code varchar(100),
  service_name varchar(255) NOT NULL,

  is_main_treatment_step boolean DEFAULT false,
  completion_time_used_mins integer,

  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  deleted_at timestamp with time zone,
  created_by uuid,
  updated_by uuid,

  CONSTRAINT treatment_service_steps_pkey PRIMARY KEY (id),
  CONSTRAINT treatment_service_steps_name_not_empty CHECK (length(service_name) >= 1),
  CONSTRAINT treatment_service_steps_completion_time_non_negative CHECK (completion_time_used_mins IS NULL OR completion_time_used_mins >= 0)
);

ALTER TABLE public.treatment_service_steps
  ADD CONSTRAINT treatment_service_steps_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE public.treatment_service_steps
  ADD CONSTRAINT treatment_service_steps_treatment_id_fkey
  FOREIGN KEY (treatment_id) REFERENCES public.treatments(id) ON DELETE SET NULL;

ALTER TABLE public.treatment_service_steps
  ADD CONSTRAINT treatment_service_steps_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.treatment_service_steps
  ADD CONSTRAINT treatment_service_steps_updated_by_fkey
  FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- Natural key for dedup, matching the legacy (ConnectionId, ServiceCode, Service) key.
-- coalesce() so two rows with a NULL service_code but the same name are still deduped.
CREATE UNIQUE INDEX IF NOT EXISTS idx_treatment_service_steps_natural_key
  ON public.treatment_service_steps (organization_id, COALESCE(service_code, ''), service_name)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_treatment_service_steps_organization_id ON public.treatment_service_steps(organization_id);
CREATE INDEX IF NOT EXISTS idx_treatment_service_steps_treatment_id ON public.treatment_service_steps(treatment_id);
CREATE INDEX IF NOT EXISTS idx_treatment_service_steps_deleted_at ON public.treatment_service_steps(deleted_at) WHERE deleted_at IS NULL;

CREATE TRIGGER update_treatment_service_steps_updated_at
  BEFORE UPDATE ON public.treatment_service_steps
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.treatment_service_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view treatment service steps in their org"
ON public.treatment_service_steps FOR SELECT
USING (
  auth.uid() IS NOT NULL AND
  organization_id IS NOT NULL AND
  deleted_at IS NULL AND
  public.user_in_org(auth.uid(), organization_id)
);

CREATE POLICY "Owners and admins can insert treatment service steps"
ON public.treatment_service_steps FOR INSERT
WITH CHECK (
  auth.uid() IS NOT NULL AND
  organization_id IS NOT NULL AND
  (
    public.has_org_role(auth.uid(), organization_id, 'owner'::app_role) OR
    public.has_org_role(auth.uid(), organization_id, 'admin'::app_role)
  )
);

CREATE POLICY "Owners and admins can update treatment service steps"
ON public.treatment_service_steps FOR UPDATE
USING (
  auth.uid() IS NOT NULL AND
  organization_id IS NOT NULL AND
  (
    public.has_org_role(auth.uid(), organization_id, 'owner'::app_role) OR
    public.has_org_role(auth.uid(), organization_id, 'admin'::app_role)
  )
)
WITH CHECK (
  auth.uid() IS NOT NULL AND
  organization_id IS NOT NULL AND
  (
    public.has_org_role(auth.uid(), organization_id, 'owner'::app_role) OR
    public.has_org_role(auth.uid(), organization_id, 'admin'::app_role)
  )
);

CREATE POLICY "Owners and admins can delete treatment service steps"
ON public.treatment_service_steps FOR DELETE
USING (
  auth.uid() IS NOT NULL AND
  organization_id IS NOT NULL AND
  (
    public.has_org_role(auth.uid(), organization_id, 'owner'::app_role) OR
    public.has_org_role(auth.uid(), organization_id, 'admin'::app_role)
  )
);

COMMENT ON TABLE public.treatment_service_steps IS 'Maps billable service names/codes seen on synced invoices to a Treatment, mirroring the legacy DentalTreatmentSteps "Treatment List Inc." mapping feature';
COMMENT ON COLUMN public.treatment_service_steps.service_code IS 'Item/service code as it appears on the source invoice line item (item_code); freeform, may be null';
COMMENT ON COLUMN public.treatment_service_steps.service_name IS 'Item/service name as it appears on the source invoice line item (item_name)';
COMMENT ON COLUMN public.treatment_service_steps.treatment_id IS 'The Treatment this service is mapped to; null while unmapped';
COMMENT ON COLUMN public.treatment_service_steps.is_main_treatment_step IS 'Flags this service as the main/billable step of a multi-visit treatment (vs. a supporting step)';

-- ============================================
-- Sync function: pulls distinct services off synced invoice line items
-- ============================================
-- Insert-only upsert (ON CONFLICT DO NOTHING) against the natural key above,
-- so re-running never clobbers a mapping/toggle an admin has already set.
CREATE OR REPLACE FUNCTION public.sync_treatment_service_steps(p_organization_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted integer;
BEGIN
  IF p_organization_id IS NULL OR NOT public.user_in_org(auth.uid(), p_organization_id) THEN
    RAISE EXCEPTION 'Not authorized for this organization';
  END IF;

  WITH distinct_services AS (
    SELECT DISTINCT
      trim(li.item_name) AS service_name,
      NULLIF(trim(li.item_code), '') AS service_code
    FROM public.platform_integration_invoice_line_items li
    WHERE li.organization_id = p_organization_id
      AND li.item_name IS NOT NULL
      AND trim(li.item_name) <> ''
  ),
  inserted AS (
    INSERT INTO public.treatment_service_steps (
      organization_id, service_code, service_name, created_by
    )
    SELECT p_organization_id, ds.service_code, ds.service_name, auth.uid()
    FROM distinct_services ds
    ON CONFLICT (organization_id, COALESCE(service_code, ''), service_name)
      WHERE deleted_at IS NULL
      DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_inserted FROM inserted;

  RETURN v_inserted;
END;
$$;

COMMENT ON FUNCTION public.sync_treatment_service_steps(uuid) IS 'Inserts any new distinct (item_code, item_name) pairs from synced invoice line items into treatment_service_steps for the given org; existing mapped rows are left untouched. Returns the number of new rows created.';
