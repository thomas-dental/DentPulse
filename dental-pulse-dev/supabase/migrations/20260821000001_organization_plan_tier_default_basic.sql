-- ============================================================
-- Flip the default subscription plan tier for newly created
-- organizations from 'accelerate' to 'basic'.
--
-- 20260817000001_organization_plan_tier.sql originally defaulted
-- plan_tier to 'accelerate', which meant every organization created
-- since then silently got the top tier for free. New organizations
-- should start on the lowest tier (Basic) and only move up
-- deliberately, via the platform-admin surface in
-- dental-pulse-api-backend's Organizations page.
--
-- This only changes the default applied to NEW rows — existing
-- organizations' plan_tier is left untouched.
-- ============================================================

ALTER TABLE public.organizations
  ALTER COLUMN plan_tier SET DEFAULT 'basic';
