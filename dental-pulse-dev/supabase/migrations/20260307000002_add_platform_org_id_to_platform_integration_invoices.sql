-- Migration: Add platform_integration_organization_id to platform_integration_invoices
-- Stores the Xero tenant ID (platform_org_id) directly for easy tenant-wise filtering.

ALTER TABLE public.platform_integration_invoices
  ADD COLUMN IF NOT EXISTS platform_integration_organization_id TEXT;

-- Index for efficient filtering by tenant
CREATE INDEX IF NOT EXISTS idx_platform_integration_invoices_platform_org_id
  ON public.platform_integration_invoices(platform_integration_organization_id);
