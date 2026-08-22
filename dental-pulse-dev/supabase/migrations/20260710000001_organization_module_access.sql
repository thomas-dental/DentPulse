-- ============================================================
-- Module Access: per-organization module enable/disable, managed from the
-- DentPulse SuperAdmin panel. A system-default row (organization_id IS NULL)
-- is inherited by every org unless it has its own override. The app reads this
-- table to hide disabled modules (org-wide, for every role including owners).
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

-- RLS: authenticated users may READ the default row + their own org's rows.
-- Writes remain service-role only (performed by the SuperAdmin backend).
ALTER TABLE public.organization_module_access ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_read_module_access" ON public.organization_module_access;
CREATE POLICY "authenticated_read_module_access"
  ON public.organization_module_access FOR SELECT
  TO authenticated
  USING (
    organization_id IS NULL
    OR public.user_in_org(auth.uid(), organization_id)
  );
