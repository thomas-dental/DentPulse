-- Add quality_weights JSONB column to ebitda_valuation_settings
-- Stores configurable weights for the 6 EBITDA quality sub-scores

ALTER TABLE ebitda_valuation_settings
  ADD COLUMN IF NOT EXISTS quality_weights JSONB DEFAULT '{"revenue_predictability":0.20,"associate_dependency":0.20,"chair_stability":0.15,"treatment_mix":0.15,"cash_conversion":0.15,"nhs_delivery":0.15}'::JSONB;
