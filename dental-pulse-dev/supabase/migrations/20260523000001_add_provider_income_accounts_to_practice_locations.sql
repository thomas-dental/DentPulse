-- ============================================================
-- Add Provider Income account buckets to practice_locations.
--
-- Mirrors the Revenue Income columns (private_income_accounts /
-- membership_income_accounts / nhs_income_accounts) but stores
-- Chart-of-Accounts (Xero / Iplicit / QuickBooks) UUIDs that
-- represent the EXPENSE-side accounts paid out for each provider
-- income type. Configured via Location Settings > Provider Income.
--
-- Stored as JSONB arrays of UUID strings, same shape as the
-- existing expense buckets (lab_fees_accounts, staff_costs_accounts,
-- overhead_cost_accounts, etc.).
-- ============================================================

ALTER TABLE public.practice_locations
  ADD COLUMN IF NOT EXISTS provider_private_income_accounts    JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS provider_membership_income_accounts JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS provider_nhs_income_accounts        JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.practice_locations.provider_private_income_accounts IS
  'CoA UUIDs (xero/iplicit/quickbooks) tagged as Provider Income > Private for this location.';
COMMENT ON COLUMN public.practice_locations.provider_membership_income_accounts IS
  'CoA UUIDs (xero/iplicit/quickbooks) tagged as Provider Income > Membership for this location.';
COMMENT ON COLUMN public.practice_locations.provider_nhs_income_accounts IS
  'CoA UUIDs (xero/iplicit/quickbooks) tagged as Provider Income > NHS for this location.';
