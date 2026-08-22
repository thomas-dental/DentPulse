-- Add departure_risk_factor to ebitda_valuation_settings
-- Previously hardcoded at 0.30 (30%), now configurable per org
ALTER TABLE ebitda_valuation_settings
  ADD COLUMN IF NOT EXISTS departure_risk_factor NUMERIC DEFAULT 30;
