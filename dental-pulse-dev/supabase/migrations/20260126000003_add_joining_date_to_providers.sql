-- Add joining_date column to providers table
-- This stores when the provider joined (from Dentally user.created_at)

ALTER TABLE public.providers
  ADD COLUMN IF NOT EXISTS joining_date timestamptz;

-- Add index for date-based queries
CREATE INDEX IF NOT EXISTS idx_providers_joining_date
  ON public.providers(joining_date)
  WHERE joining_date IS NOT NULL;

-- Add comment
COMMENT ON COLUMN public.providers.joining_date IS 'Date when the provider joined (from Dentally user.created_at)';
