-- ============================================================
-- Allow a system-default row in ai_pricing_settings.
--
-- The superadmin panel writes a global default that applies to any
-- org without its own row. We use organization_id IS NULL to mark
-- that row, and add a partial unique index so there can only ever
-- be ONE such system-default row (orgs continue to enforce
-- uniqueness via the existing organization_id_unique constraint).
--
-- Read access for the system-default row is opened to any
-- authenticated user, so the org-facing app can fall back to it
-- when no per-org row exists.
-- ============================================================

-- 1. Allow NULL on organization_id
ALTER TABLE public.ai_pricing_settings
  ALTER COLUMN organization_id DROP NOT NULL;

-- 2. The original UNIQUE (organization_id) constraint already permits
-- multiple NULLs in standard Postgres, so we drop and replace it with
-- a partial unique index that handles BOTH cases:
--   * exactly one NULL row (system default)
--   * exactly one row per non-NULL organization_id
ALTER TABLE public.ai_pricing_settings
  DROP CONSTRAINT IF EXISTS ai_pricing_settings_organization_id_unique;

CREATE UNIQUE INDEX IF NOT EXISTS
  ai_pricing_settings_org_unique_per_org
  ON public.ai_pricing_settings (organization_id)
  WHERE organization_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS
  ai_pricing_settings_system_default_singleton
  ON public.ai_pricing_settings ((organization_id IS NULL))
  WHERE organization_id IS NULL;

-- 3. RLS — allow any authenticated user to read the system-default row.
-- (Insert/update of the system-default row goes through the backend's
-- service-role client, which bypasses RLS, so we don't need a write
-- policy for the NULL row here.)
DROP POLICY IF EXISTS "Users can view system default AI pricing settings"
  ON public.ai_pricing_settings;

CREATE POLICY "Users can view system default AI pricing settings"
ON public.ai_pricing_settings FOR SELECT
USING (
  auth.uid() IS NOT NULL
  AND organization_id IS NULL
);

COMMENT ON INDEX public.ai_pricing_settings_system_default_singleton IS
'Enforces a single system-default row (organization_id IS NULL). The superadmin panel writes/updates this row via service role.';
