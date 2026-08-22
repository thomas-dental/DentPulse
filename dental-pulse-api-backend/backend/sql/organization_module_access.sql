-- ============================================================
-- Module Access: per-organization module enable/disable, with a
-- system-default row (organization_id IS NULL) that all orgs inherit
-- unless they have their own override. Mirrors the ai_pricing_settings
-- default/override pattern used elsewhere in this project.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.organization_module_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE, -- NULL = system default
  module_key TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  updated_by UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- One row per (org, module). NULLs are distinct in a normal UNIQUE, so use a
-- COALESCE expression index to also enforce a single default row per module.
CREATE UNIQUE INDEX IF NOT EXISTS organization_module_access_unique_idx
  ON public.organization_module_access
  (COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), module_key);

CREATE INDEX IF NOT EXISTS organization_module_access_org_idx
  ON public.organization_module_access (organization_id);

-- The SuperAdmin backend reaches this table with the service-role key, which
-- bypasses RLS. Enable RLS and add a read-only policy so the DentPulse app
-- (authenticated users) can see the system default row + their own org's rows.
-- Writes stay service-role only (SuperAdmin panel).
ALTER TABLE public.organization_module_access ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_read_module_access" ON public.organization_module_access;
CREATE POLICY "authenticated_read_module_access"
  ON public.organization_module_access FOR SELECT
  TO authenticated
  USING (
    organization_id IS NULL
    OR public.user_in_org(auth.uid(), organization_id)
  );
