-- ============================================================
-- Sync Settings: replaces backend/config/syncSettings.json.
--
-- The JSON file is a single flat blob whose keys grow per integration
-- (sync_*, iplicit_*, xero_*, quickbooks_*), and every route does a
-- read-modify-write of the whole object. Storing it as JSONB mirrors that
-- exactly, so adding a new integration needs no schema change.
--
-- A NULL organization_id is the global/superadmin row that all orgs
-- inherit — same default/override pattern as organization_module_access.
--
-- Why move off the file at all: the API runs on hosts with an ephemeral
-- filesystem, so a redeploy silently reverted admin-configured date ranges
-- back to whatever was committed.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.sync_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE, -- NULL = global default
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- One row per org, plus exactly one global row. NULLs are distinct in a
-- normal UNIQUE, so COALESCE to a sentinel to enforce the single global row.
CREATE UNIQUE INDEX IF NOT EXISTS sync_settings_unique_idx
  ON public.sync_settings
  (COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Superadmin-only configuration, reached exclusively with the service-role
-- key (which bypasses RLS). RLS is enabled with no policies so that anon /
-- authenticated clients are denied by default.
ALTER TABLE public.sync_settings ENABLE ROW LEVEL SECURITY;

-- Seed the global row from the current committed syncSettings.json values so
-- the first DB read matches today's behaviour. ON CONFLICT keeps this re-runnable.
INSERT INTO public.sync_settings (organization_id, settings)
VALUES (NULL, '{
  "sync_start_date": "2020-01-01",
  "sync_end_date": "2020-12-31",
  "sync_mode": "current",
  "xero_start_date": "2024-01-01",
  "xero_end_date": "2026-07-31",
  "xero_modified_since": "2024-01-01T00:00:00Z"
}'::jsonb)
ON CONFLICT (COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid))
DO NOTHING;
