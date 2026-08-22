-- Migration: Change platform_integration_chart_of_accounts.platform_integration_organization_id
-- FROM: UUID FK referencing platform_integration_organizations.id (internal row ID)
-- TO:   TEXT storing platform_org_id directly (Xero tenant ID / Iplicit org ID)
--
-- Reason: Easier tenant-wise filtering without needing a join to platform_integration_organizations.

-- Step 1: Drop the FK constraint (exact name from Supabase error)
ALTER TABLE platform_integration_chart_of_accounts
  DROP CONSTRAINT IF EXISTS platform_integration_chart_of_platform_integration_organiz_fkey;

-- Also try alternate names in case schema differs across environments
ALTER TABLE platform_integration_chart_of_accounts
  DROP CONSTRAINT IF EXISTS platform_integration_chart_of_accounts_platform_integration_org_fkey;

ALTER TABLE platform_integration_chart_of_accounts
  DROP CONSTRAINT IF EXISTS platform_integration_chart_of_accounts_platform_integration_organization_id_fkey;

-- Step 2: Change column type from UUID to TEXT
--         (existing UUID values become their text representation)
ALTER TABLE platform_integration_chart_of_accounts
  ALTER COLUMN platform_integration_organization_id TYPE TEXT
  USING platform_integration_organization_id::text;

-- Step 3: Backfill — replace the internal row UUID with the actual platform_org_id
UPDATE platform_integration_chart_of_accounts coa
SET    platform_integration_organization_id = pio.platform_org_id
FROM   platform_integration_organizations pio
WHERE  coa.platform_integration_organization_id = pio.id::text;
