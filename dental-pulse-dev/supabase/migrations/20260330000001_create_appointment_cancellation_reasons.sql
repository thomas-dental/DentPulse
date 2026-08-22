-- Appointment Cancellation Reasons lookup table
-- Synced from Dentally API: /v1/appointment_cancellation_reasons
CREATE TABLE IF NOT EXISTS public.appointment_cancellation_reasons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  acr_id BIGINT NOT NULL,
  acr_name TEXT NOT NULL,
  acr_is_active BOOLEAN DEFAULT true,
  acr_colour TEXT,
  acr_created_at TIMESTAMPTZ,
  acr_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID,
  updated_by UUID,
  deleted_at TIMESTAMPTZ,
  user_id UUID REFERENCES auth.users(id),
  UNIQUE(organization_id, acr_id)
);

-- Index for fast lookups by acr_id within an org
CREATE INDEX IF NOT EXISTS idx_acr_org_acr_id ON public.appointment_cancellation_reasons(organization_id, acr_id);

-- Enable RLS
ALTER TABLE public.appointment_cancellation_reasons ENABLE ROW LEVEL SECURITY;

-- RLS policy: users can read cancellation reasons for their org
CREATE POLICY "Users can view cancellation reasons for their org"
  ON public.appointment_cancellation_reasons
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM public.user_roles WHERE user_id = auth.uid()
    )
    OR
    organization_id IN (
      SELECT id FROM public.organizations WHERE user_id = auth.uid() OR created_by = auth.uid()
    )
  );
