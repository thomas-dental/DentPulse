-- ============================================================
-- Add ca_role_id to custom_roles
-- Stores Central Auth-issued logical role identifier so this row
-- can be matched with the same logical role on DentLedger / SK Marketing.
-- ============================================================

ALTER TABLE public.custom_roles
  ADD COLUMN IF NOT EXISTS ca_role_id UUID;

CREATE INDEX IF NOT EXISTS custom_roles_ca_role_id_idx
  ON public.custom_roles (ca_role_id);
