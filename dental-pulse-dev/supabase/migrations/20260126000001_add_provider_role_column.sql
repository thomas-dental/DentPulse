-- Add provider_role column to providers table
-- This stores the role from Dentally API (e.g., "Dentist", "Hygienist", "Therapist")

ALTER TABLE public.providers
  ADD COLUMN IF NOT EXISTS provider_role varchar(100);

-- Add index for faster filtering by role
CREATE INDEX IF NOT EXISTS idx_providers_provider_role
  ON public.providers(provider_role)
  WHERE provider_role IS NOT NULL;

-- Add comment
COMMENT ON COLUMN public.providers.provider_role IS 'Provider role from Dentally API (Dentist, Hygienist, Therapist, etc.)';
