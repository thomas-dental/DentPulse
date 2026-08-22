-- EBITDA-to-Value module tables
-- ebitda_adjustments: manual normalisation/sustainability items entered by finance team
-- ebitda_valuation_settings: per-org valuation configuration

CREATE TABLE IF NOT EXISTS ebitda_adjustments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  label TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  category TEXT NOT NULL DEFAULT 'normalisation'
    CHECK (category IN ('normalisation', 'sustainability_manual')),
  confidence_pct INTEGER CHECK (confidence_pct IS NULL OR (confidence_pct >= 0 AND confidence_pct <= 100)),
  is_active BOOLEAN DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_ebitda_adj_org ON ebitda_adjustments(organization_id) WHERE deleted_at IS NULL;

ALTER TABLE ebitda_adjustments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view ebitda_adjustments for their org"
  ON ebitda_adjustments FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM user_roles WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert ebitda_adjustments for their org"
  ON ebitda_adjustments FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM user_roles WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update ebitda_adjustments for their org"
  ON ebitda_adjustments FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM user_roles WHERE user_id = auth.uid()
    )
  );

-- Valuation settings (one row per org)
CREATE TABLE IF NOT EXISTS ebitda_valuation_settings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE UNIQUE,
  net_debt NUMERIC DEFAULT 0,
  base_multiple NUMERIC DEFAULT 5.8,
  new_associate_ramp_up NUMERIC DEFAULT 0,
  new_associate_ramp_confidence INTEGER DEFAULT 50,
  utilisation_improvement NUMERIC DEFAULT 0,
  utilisation_improvement_confidence INTEGER DEFAULT 70,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE ebitda_valuation_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view ebitda_valuation_settings for their org"
  ON ebitda_valuation_settings FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM user_roles WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert ebitda_valuation_settings for their org"
  ON ebitda_valuation_settings FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM user_roles WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update ebitda_valuation_settings for their org"
  ON ebitda_valuation_settings FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM user_roles WHERE user_id = auth.uid()
    )
  );
