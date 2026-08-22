-- ============================================================
-- Subscription plan tier per organization (Basic / Essential / Growth /
-- Accelerate). Read by the frontend (usePlanAccess) to gate sidebar nav and
-- routes on top of the existing RBAC + organization_module_access gates.
--
-- Written only by platform admins (profiles.is_platform_admin), via the new
-- /platform-admin/organizations page — there is no external SuperAdmin
-- backend for this, unlike organization_module_access.
-- ============================================================

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS plan_tier TEXT NOT NULL DEFAULT 'accelerate';

ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_plan_tier_check;

ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_plan_tier_check
  CHECK (plan_tier IN ('basic', 'essential', 'growth', 'accelerate'));

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT false;

-- Seed the requesting internal admin account so the new admin page is usable immediately.
UPDATE public.profiles
  SET is_platform_admin = true
  WHERE user_id IN (SELECT id FROM auth.users WHERE email = 'soni@dentpulse.ai');

-- Only platform admins may change an org's plan tier.
DROP POLICY IF EXISTS "platform_admin_update_plan_tier" ON public.organizations;
CREATE POLICY "platform_admin_update_plan_tier"
  ON public.organizations FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE user_id = auth.uid() AND is_platform_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE user_id = auth.uid() AND is_platform_admin = true
    )
  );

-- Platform admins may read every organization (needed to list orgs in the admin page).
DROP POLICY IF EXISTS "platform_admin_read_all_organizations" ON public.organizations;
CREATE POLICY "platform_admin_read_all_organizations"
  ON public.organizations FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE user_id = auth.uid() AND is_platform_admin = true
    )
  );
