-- Add is_active column to user_roles for per-org member enable/disable
-- When is_active = false, the member cannot access that organization
ALTER TABLE public.user_roles
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
