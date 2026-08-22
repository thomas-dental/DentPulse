-- ============================================================
-- Fix role_permissions unique constraint for upsert compatibility
-- The expression index (COALESCE) cannot be matched by ON CONFLICT
-- Replace with a plain UNIQUE constraint on actual columns
-- ============================================================

BEGIN;

-- Drop the expression-based index that ON CONFLICT can't match
DROP INDEX IF EXISTS role_permissions_unique_idx;

-- Replace NULLs in card with empty string
UPDATE public.role_permissions SET card = '' WHERE card IS NULL;

-- Make card NOT NULL with default ''
ALTER TABLE public.role_permissions
  ALTER COLUMN card SET DEFAULT '',
  ALTER COLUMN card SET NOT NULL;

-- Add a plain unique constraint that matches the upsert's onConflict
ALTER TABLE public.role_permissions
  ADD CONSTRAINT role_permissions_unique_permission UNIQUE (custom_role_id, module, card, action_type);

COMMIT;
