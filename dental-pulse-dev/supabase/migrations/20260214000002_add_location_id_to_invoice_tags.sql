-- Add location_id column to invoice_tags table
ALTER TABLE public.invoice_tags
ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES public.practice_locations(id) ON DELETE SET NULL;

-- Create index for location_id
CREATE INDEX IF NOT EXISTS idx_invoice_tags_location ON public.invoice_tags(location_id);

-- Drop the old unique constraint and create new one with location_id
ALTER TABLE public.invoice_tags
DROP CONSTRAINT IF EXISTS invoice_tags_name_org_unique;

ALTER TABLE public.invoice_tags
ADD CONSTRAINT invoice_tags_name_org_location_unique UNIQUE (organization_id, location_id, name);

-- Add comment
COMMENT ON COLUMN public.invoice_tags.location_id IS 'Location/practice the tag belongs to (optional)';
