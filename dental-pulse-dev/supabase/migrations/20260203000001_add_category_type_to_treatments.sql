-- Add type_of_treatment column to treatments table
-- This column stores the treatment category type (e.g., 'implant', 'invisalign', 'private', 'nhs', 'other')
-- which is separate from treatment_type (which is 'private' or 'nhs' for billing purposes)

ALTER TABLE public.treatments
  ADD COLUMN IF NOT EXISTS type_of_treatment varchar(50);

-- Add comment for the new field
COMMENT ON COLUMN public.treatments.type_of_treatment IS 'Treatment category type (e.g., implant, invisalign, private, nhs, other) - separate from treatment_type which is for billing';

-- Create index for faster filtering by type_of_treatment
CREATE INDEX IF NOT EXISTS idx_treatments_type_of_treatment ON public.treatments(type_of_treatment) WHERE type_of_treatment IS NOT NULL AND deleted_at IS NULL;
