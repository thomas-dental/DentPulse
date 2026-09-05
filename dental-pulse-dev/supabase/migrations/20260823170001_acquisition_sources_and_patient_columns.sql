-- ============================================================================
-- Dentally acquisition sources (patient marketing source catalog)
-- + patient columns for PE / CLTV-by-acquisition-source (M6)
--
-- Convention: same as appointment_cancellation_reasons — reference table for
-- lookup, plus denormalized name on the patient row at sync time.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.acquisition_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  location_id UUID REFERENCES public.practice_locations(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  integration_id UUID REFERENCES public.integrations(id) ON DELETE SET NULL,

  -- Dentally acquisition source fields (as_*)
  as_id UUID NOT NULL,
  as_name TEXT NOT NULL DEFAULT '',
  as_active BOOLEAN DEFAULT true,
  as_notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,

  CONSTRAINT acquisition_sources_org_as_id_key UNIQUE (organization_id, as_id)
);

CREATE INDEX IF NOT EXISTS idx_acquisition_sources_org_id
  ON public.acquisition_sources(organization_id);
CREATE INDEX IF NOT EXISTS idx_acquisition_sources_org_as_id
  ON public.acquisition_sources(organization_id, as_id);

COMMENT ON TABLE public.acquisition_sources IS
  'Dentally acquisition sources catalog (GET /v1/acquisition_sources). Used to resolve patient acquisition_source_id to a name.';
COMMENT ON COLUMN public.acquisition_sources.as_id IS
  'Dentally acquisition source UUID.';

ALTER TABLE public.acquisition_sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view acquisition sources for their org" ON public.acquisition_sources;
CREATE POLICY "Users can view acquisition sources for their org"
  ON public.acquisition_sources
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND public.user_in_org(auth.uid(), organization_id)
  );

REVOKE ALL ON TABLE public.acquisition_sources FROM anon, authenticated;
GRANT SELECT ON TABLE public.acquisition_sources TO authenticated;
GRANT ALL ON TABLE public.acquisition_sources TO service_role;

DROP TRIGGER IF EXISTS set_acquisition_sources_updated_at ON public.acquisition_sources;
CREATE TRIGGER set_acquisition_sources_updated_at
  BEFORE UPDATE ON public.acquisition_sources
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Patient columns: ID + denormalized name (mirrors apmt_cancellation_reason_name)
ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS pt_acquisition_source_id UUID NULL,
  ADD COLUMN IF NOT EXISTS pt_acquisition_source_name VARCHAR(255) NULL;

CREATE INDEX IF NOT EXISTS idx_patients_org_acquisition_source
  ON public.patients(organization_id, pt_acquisition_source_id)
  WHERE pt_acquisition_source_id IS NOT NULL;

COMMENT ON COLUMN public.patients.pt_acquisition_source_id IS
  'Dentally acquisition_source_id (UUID). Used for CLTV-by-acquisition-source (M6).';
COMMENT ON COLUMN public.patients.pt_acquisition_source_name IS
  'Denormalized acquisition source name from acquisition_sources.as_name at sync time.';
