-- Provider-level Lab/Material Cost Source, for parity with the sibling app.
-- Activates only when a location's Business Settings has the matching source
-- set to 'associate_wise' AND a provider has explicitly been configured
-- (source method columns default to NULL = "not configured") — so existing
-- calculations are unaffected until an admin opts a provider in.

ALTER TABLE providers
ADD COLUMN IF NOT EXISTS lab_cost_source_method TEXT
  CHECK (lab_cost_source_method IN ('flat_percentage', 'accounting_application', 'sliding_scale', 'monthly')),
ADD COLUMN IF NOT EXISTS lab_cost_percentage NUMERIC(5,2),
ADD COLUMN IF NOT EXISTS lab_cost_account_id UUID,
ADD COLUMN IF NOT EXISTS lab_cost_account_platform TEXT
  CHECK (lab_cost_account_platform IN ('xero', 'iplicit', 'quickbooks', 'sage')),
ADD COLUMN IF NOT EXISTS material_cost_source_method TEXT
  CHECK (material_cost_source_method IN ('flat_percentage', 'accounting_application', 'sliding_scale', 'monthly')),
ADD COLUMN IF NOT EXISTS material_cost_percentage NUMERIC(5,2),
ADD COLUMN IF NOT EXISTS material_cost_account_id UUID,
ADD COLUMN IF NOT EXISTS material_cost_account_platform TEXT
  CHECK (material_cost_account_platform IN ('xero', 'iplicit', 'quickbooks', 'sage')),
ADD COLUMN IF NOT EXISTS material_split_percentage NUMERIC(5,2) DEFAULT 50.00;

COMMENT ON COLUMN providers.lab_cost_source_method IS 'How this provider''s lab cost is sourced when their location is Associate Wise. NULL = not configured, falls back to the location flat percentage.';
COMMENT ON COLUMN providers.lab_cost_percentage IS 'Flat lab cost percentage of production, used when lab_cost_source_method = flat_percentage';
COMMENT ON COLUMN providers.lab_cost_account_id IS 'Chart-of-accounts row id this provider''s lab cost is linked to, used when lab_cost_source_method = accounting_application';
COMMENT ON COLUMN providers.lab_cost_account_platform IS 'Which platform table lab_cost_account_id belongs to (xero/iplicit/quickbooks/sage chart_of_accounts)';
COMMENT ON COLUMN providers.material_cost_source_method IS 'How this provider''s material cost is sourced when their location is Associate Wise. NULL = not configured, falls back to the location flat percentage.';
COMMENT ON COLUMN providers.material_cost_percentage IS 'Flat material cost percentage of production, used when material_cost_source_method = flat_percentage';
COMMENT ON COLUMN providers.material_cost_account_id IS 'Chart-of-accounts row id this provider''s material cost is linked to, used when material_cost_source_method = accounting_application';
COMMENT ON COLUMN providers.material_cost_account_platform IS 'Which platform table material_cost_account_id belongs to (xero/iplicit/quickbooks/sage chart_of_accounts)';
COMMENT ON COLUMN providers.material_split_percentage IS 'Percentage of the sourced material cost charged back to this provider (mirrors lab_split_percentage)';

-- Manually-entered monthly lab/material cost values, used when
-- *_cost_source_method = 'monthly'. Not stored on appointment_summary:
-- that table keys on the Dentally practitioner_id (NOT NULL bigint) and its
-- existing write path silently skips providers without an external_id,
-- which is unacceptable for a figure that feeds a payslip.
CREATE TABLE IF NOT EXISTS provider_monthly_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  month DATE NOT NULL,
  lab_cost_value NUMERIC(18,2),
  material_cost_value NUMERIC(18,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (organization_id, provider_id, month)
);

CREATE INDEX IF NOT EXISTS idx_provider_monthly_costs_provider ON provider_monthly_costs(provider_id);
CREATE INDEX IF NOT EXISTS idx_provider_monthly_costs_org ON provider_monthly_costs(organization_id);

ALTER TABLE provider_monthly_costs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view provider monthly costs in their organization"
  ON provider_monthly_costs FOR SELECT
  USING (organization_id IN (SELECT organization_id FROM user_roles WHERE user_id = auth.uid()));

CREATE POLICY "Users can insert provider monthly costs in their organization"
  ON provider_monthly_costs FOR INSERT
  WITH CHECK (organization_id IN (SELECT organization_id FROM user_roles WHERE user_id = auth.uid()));

CREATE POLICY "Users can update provider monthly costs in their organization"
  ON provider_monthly_costs FOR UPDATE
  USING (organization_id IN (SELECT organization_id FROM user_roles WHERE user_id = auth.uid()));

CREATE POLICY "Users can delete provider monthly costs in their organization"
  ON provider_monthly_costs FOR DELETE
  USING (organization_id IN (SELECT organization_id FROM user_roles WHERE user_id = auth.uid()));

CREATE TRIGGER set_provider_monthly_costs_updated_at
  BEFORE UPDATE ON provider_monthly_costs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- New sliding-scale types for lab/material COST sourcing — distinct from the
-- existing 'sliding_scale' (associate pay split) and 'lab_sliding_scale'
-- (lab deduction split), which are a different, already-shipped concept and
-- are left untouched. Both new literals fit the existing VARCHAR(20).
ALTER TABLE provider_sliding_scales DROP CONSTRAINT IF EXISTS provider_sliding_scales_scale_type_check;
ALTER TABLE provider_sliding_scales ADD CONSTRAINT provider_sliding_scales_scale_type_check
  CHECK (scale_type IN ('sliding_scale', 'lab_sliding_scale', 'lab_cost_scale', 'material_cost_scale'));
