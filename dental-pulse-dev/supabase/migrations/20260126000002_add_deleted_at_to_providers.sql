-- Add deleted_at column to providers table for soft deletes
-- Also add created_by and updated_by if they don't exist

ALTER TABLE public.providers
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id);

-- Add index for soft delete queries (filter out deleted records)
CREATE INDEX IF NOT EXISTS idx_providers_deleted_at
  ON public.providers(deleted_at)
  WHERE deleted_at IS NULL;

-- Add comments
COMMENT ON COLUMN public.providers.deleted_at IS 'Soft delete timestamp - NULL means not deleted';
COMMENT ON COLUMN public.providers.created_by IS 'User who created this provider record';
COMMENT ON COLUMN public.providers.updated_by IS 'User who last updated this provider record';
