-- ============================================================
-- Add P&L account buckets to practice_locations.
--
-- These map locations to the Xero COAs that make up the two
-- top-level P&L sections used in the Profit/Loss spreadsheet:
--
--   administrative_cost_accounts -> "Total Administrative Costs"
--   cost_of_sales_accounts       -> "Total Cost of Sales"
--
-- Stored as JSONB arrays of xero_chart_of_accounts.id (UUID strings)
-- to match the existing expense buckets (lab_fees_accounts,
-- staff_costs_accounts, overhead_cost_accounts, etc.).
-- ============================================================

ALTER TABLE public.practice_locations
  ADD COLUMN IF NOT EXISTS administrative_cost_accounts JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS cost_of_sales_accounts       JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.practice_locations.administrative_cost_accounts IS
  'Xero COA UUIDs (xero_chart_of_accounts.id) classified as Administrative Costs '
  'in this location''s P&L. Configured via Location Settings > Profit/Loss accounts.';

COMMENT ON COLUMN public.practice_locations.cost_of_sales_accounts IS
  'Xero COA UUIDs (xero_chart_of_accounts.id) classified as Cost of Sales '
  'in this location''s P&L. Configured via Location Settings > Profit/Loss accounts.';
