-- Add configurable penalty columns for multiple engine factors
-- Previously hardcoded: Management Depth (-0.3), Standardisation (-0.2), Leverage (-0.2)

ALTER TABLE ebitda_valuation_settings
  ADD COLUMN IF NOT EXISTS mgmt_depth_penalty NUMERIC DEFAULT -0.3,
  ADD COLUMN IF NOT EXISTS standardisation_penalty NUMERIC DEFAULT -0.2,
  ADD COLUMN IF NOT EXISTS leverage_penalty NUMERIC DEFAULT -0.2;
