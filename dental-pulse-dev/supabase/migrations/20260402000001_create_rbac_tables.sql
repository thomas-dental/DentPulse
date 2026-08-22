-- ============================================================
-- Dynamic RBAC: custom_roles + role_permissions tables
-- Wrapped in a transaction so all-or-nothing on failure
-- ============================================================

BEGIN;

-- 1. custom_roles — organization-scoped dynamic roles
CREATE TABLE public.custom_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  color TEXT,
  is_system BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(organization_id, name)
);

-- 2. role_permissions — granular module/card/action permissions per role
CREATE TABLE public.role_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  custom_role_id UUID NOT NULL REFERENCES public.custom_roles(id) ON DELETE CASCADE,
  module TEXT NOT NULL,
  card TEXT,
  action_type TEXT NOT NULL,
  granted BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX role_permissions_unique_idx
  ON public.role_permissions (custom_role_id, module, COALESCE(card, ''), action_type);

-- 3. Link user_roles to custom_roles
ALTER TABLE public.user_roles
  ADD COLUMN custom_role_id UUID REFERENCES public.custom_roles(id) ON DELETE SET NULL;

-- ============================================================
-- RLS policies
-- ============================================================

ALTER TABLE public.custom_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

-- custom_roles: org members can read
CREATE POLICY "org_members_read_custom_roles"
  ON public.custom_roles FOR SELECT
  USING (public.user_in_org(auth.uid(), organization_id));

-- custom_roles: owner can insert
CREATE POLICY "owner_insert_custom_roles"
  ON public.custom_roles FOR INSERT
  WITH CHECK (public.has_org_role(auth.uid(), organization_id, 'owner'));

-- custom_roles: owner can update
CREATE POLICY "owner_update_custom_roles"
  ON public.custom_roles FOR UPDATE
  USING (public.has_org_role(auth.uid(), organization_id, 'owner'));

-- custom_roles: owner can delete
CREATE POLICY "owner_delete_custom_roles"
  ON public.custom_roles FOR DELETE
  USING (public.has_org_role(auth.uid(), organization_id, 'owner'));

-- role_permissions: org members can read (via join to custom_roles)
CREATE POLICY "org_members_read_role_permissions"
  ON public.role_permissions FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.custom_roles cr
    WHERE cr.id = role_permissions.custom_role_id
    AND public.user_in_org(auth.uid(), cr.organization_id)
  ));

-- role_permissions: owner can insert
CREATE POLICY "owner_insert_role_permissions"
  ON public.role_permissions FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.custom_roles cr
    WHERE cr.id = role_permissions.custom_role_id
    AND public.has_org_role(auth.uid(), cr.organization_id, 'owner')
  ));

-- role_permissions: owner can update
CREATE POLICY "owner_update_role_permissions"
  ON public.role_permissions FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.custom_roles cr
    WHERE cr.id = role_permissions.custom_role_id
    AND public.has_org_role(auth.uid(), cr.organization_id, 'owner')
  ));

-- role_permissions: owner can delete
CREATE POLICY "owner_delete_role_permissions"
  ON public.role_permissions FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM public.custom_roles cr
    WHERE cr.id = role_permissions.custom_role_id
    AND public.has_org_role(auth.uid(), cr.organization_id, 'owner')
  ));

-- ============================================================
-- Data migration: create default custom roles for existing orgs
-- ============================================================

-- Create "Admin" custom role for each org that has admin users
INSERT INTO public.custom_roles (organization_id, name, description, is_system)
SELECT DISTINCT ur.organization_id, 'Admin', 'Migrated from built-in admin role. Full module access.', true
FROM public.user_roles ur
WHERE ur.role = 'admin'
ON CONFLICT (organization_id, name) DO NOTHING;

-- Create "Member" custom role for each org that has member users
INSERT INTO public.custom_roles (organization_id, name, description, is_system)
SELECT DISTINCT ur.organization_id, 'Member', 'Migrated from built-in member role. View-only access.', true
FROM public.user_roles ur
WHERE ur.role = 'member'
ON CONFLICT (organization_id, name) DO NOTHING;

-- Link existing admin users to the "Admin" custom role
UPDATE public.user_roles ur
SET custom_role_id = cr.id
FROM public.custom_roles cr
WHERE ur.role = 'admin'
  AND cr.organization_id = ur.organization_id
  AND cr.name = 'Admin';

-- Link existing member users to the "Member" custom role
UPDATE public.user_roles ur
SET custom_role_id = cr.id
FROM public.custom_roles cr
WHERE ur.role = 'member'
  AND cr.organization_id = ur.organization_id
  AND cr.name = 'Member';

COMMIT;
