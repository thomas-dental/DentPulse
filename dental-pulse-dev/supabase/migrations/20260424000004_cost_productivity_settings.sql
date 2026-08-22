-- Cost productivity target multipliers — per organization AND per location.
-- Covers the Staff / Clinician / Overhead / Material cost productivity cards.
--
-- Semantics:
-- * location_id IS NULL      -> org-wide default (used as fallback when no location row exists)
-- * location_id IS NOT NULL  -> override for that specific location
-- Uniqueness: (organization_id, category, location_id) with NULLS NOT DISTINCT
-- so there is exactly one org-wide row per category, and at most one row
-- per location per category.
--
-- This migration is idempotent and safe to re-run: it drops any previous
-- per-column attempts on organization_settings before creating the table.

-- Drop any previously-added columns on organization_settings. These were an
-- earlier org-wide-only design that is now replaced by cost_productivity_settings.
ALTER TABLE organization_settings
  DROP COLUMN IF EXISTS staff_productivity_target_multiplier,
  DROP COLUMN IF EXISTS clinician_productivity_target_multiplier,
  DROP COLUMN IF EXISTS overhead_productivity_target_multiplier,
  DROP COLUMN IF EXISTS material_productivity_target_multiplier;

-- Table
CREATE TABLE IF NOT EXISTS cost_productivity_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  location_id UUID REFERENCES practice_locations(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('staff', 'clinician', 'overhead', 'material')),
  multiplier NUMERIC(5, 3) NOT NULL DEFAULT 1.1 CHECK (multiplier > 0),
  budget_multiplier NUMERIC(5, 3) NOT NULL DEFAULT 1.05 CHECK (budget_multiplier > 0),
  benchmark_multiplier NUMERIC(5, 3) NOT NULL DEFAULT 0.95 CHECK (benchmark_multiplier > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id)
);

-- Ensure the trend columns exist if the table was created earlier without them.
ALTER TABLE cost_productivity_settings
  ADD COLUMN IF NOT EXISTS budget_multiplier NUMERIC(5, 3) NOT NULL DEFAULT 1.05,
  ADD COLUMN IF NOT EXISTS benchmark_multiplier NUMERIC(5, 3) NOT NULL DEFAULT 0.95;

-- Uniqueness: one row per (org, category, location). NULLS NOT DISTINCT so
-- the single org-wide row (location_id IS NULL) is enforced as unique too.
CREATE UNIQUE INDEX IF NOT EXISTS cost_productivity_settings_unique
  ON cost_productivity_settings (organization_id, category, location_id)
  NULLS NOT DISTINCT;

CREATE INDEX IF NOT EXISTS cost_productivity_settings_org_category_idx
  ON cost_productivity_settings (organization_id, category);

-- RLS
ALTER TABLE cost_productivity_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view cost productivity settings for their organization" ON cost_productivity_settings;
CREATE POLICY "Users can view cost productivity settings for their organization"
  ON cost_productivity_settings FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM user_roles WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can insert cost productivity settings for their organization" ON cost_productivity_settings;
CREATE POLICY "Users can insert cost productivity settings for their organization"
  ON cost_productivity_settings FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM user_roles WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can update cost productivity settings for their organization" ON cost_productivity_settings;
CREATE POLICY "Users can update cost productivity settings for their organization"
  ON cost_productivity_settings FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM user_roles WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can delete cost productivity settings for their organization" ON cost_productivity_settings;
CREATE POLICY "Users can delete cost productivity settings for their organization"
  ON cost_productivity_settings FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id FROM user_roles WHERE user_id = auth.uid()
    )
  );

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_cost_productivity_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS cost_productivity_settings_updated_at ON cost_productivity_settings;
CREATE TRIGGER cost_productivity_settings_updated_at
  BEFORE UPDATE ON cost_productivity_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_cost_productivity_settings_updated_at();
