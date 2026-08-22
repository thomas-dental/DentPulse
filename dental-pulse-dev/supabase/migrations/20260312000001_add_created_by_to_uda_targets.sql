-- Add created_by and created_by_email to uda_targets
-- These fields are set by the frontend when saving monthly targets

ALTER TABLE uda_targets
  ADD COLUMN IF NOT EXISTS created_by       UUID   NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by_email TEXT   NULL;
