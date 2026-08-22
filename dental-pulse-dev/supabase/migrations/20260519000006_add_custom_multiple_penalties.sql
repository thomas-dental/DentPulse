-- Custom (user-defined) Multiple Impact Penalties.
--
-- The Multiple Impact Penalties UI previously had only the 3 fixed factors
-- (Management Depth / Standardisation / Leverage Risk). This adds a flexible
-- JSONB array so users can add their own named multiplier penalties via the
-- "+" action — applied by the Multiple Engine the same way as the fixed ones.
--
-- Shape: [{ "id": "<uuid>", "label": "Key-man risk", "value": -0.2 }, ...]
-- value is the multiple delta (negative = penalty, positive = premium).

ALTER TABLE ebitda_valuation_settings
  ADD COLUMN IF NOT EXISTS custom_penalties JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN ebitda_valuation_settings.custom_penalties IS
  'User-defined multiple-impact penalties: array of {id,label,value}. value '
  'is added to the valuation multiple waterfall (negative = penalty). Applied '
  'by multipleEngine everywhere the multiple is computed (Enterprise '
  'Overview, Multiple Engine, Value Progression, Scenario Simulator, '
  'Group Heatmap). Added 2026-05-19.';
