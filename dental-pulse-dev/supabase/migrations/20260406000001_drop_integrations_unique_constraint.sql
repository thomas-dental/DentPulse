-- Migration: Drop unique constraint on integrations to allow multiple Dentally accounts per organization
-- The idx_integrations_org_name_unique constraint previously enforced one integration per
-- (organization_id, integration_name). This is now removed to support connecting multiple
-- Dentally practice accounts to a single organization.

DROP INDEX IF EXISTS idx_integrations_org_name_unique;
