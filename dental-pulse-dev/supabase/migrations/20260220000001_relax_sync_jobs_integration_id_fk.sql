-- Allow sync_jobs.integration_id to store IDs from platform_integrations table (iplicit, xero, etc.)
-- Previously constrained as NOT NULL FK to integrations table (dentally only).
-- Now we store platform_integrations.id here for platform-based integrations.

-- 1. Drop the FK constraint so we can store any integration UUID (integrations or platform_integrations)
ALTER TABLE public.sync_jobs
  DROP CONSTRAINT IF EXISTS sync_jobs_integration_id_fkey;

-- 2. Make integration_id nullable (iplicit jobs are linked via platform_integrations, not integrations)
ALTER TABLE public.sync_jobs
  ALTER COLUMN integration_id DROP NOT NULL;

COMMENT ON COLUMN public.sync_jobs.integration_id IS
  'Integration ID — stores integrations.id for Dentally, or platform_integrations.id for iplicit/xero. FK constraint removed to support both tables.';
