-- Accounting-side income mappings for the Revenue Income panel.
--
-- The Revenue Income picker is source-aware: when an income type's
-- *_income_source is 'pms' it maps to Dentally payment-plan pp_ids (stored in the
-- existing *_income_accounts columns); when 'accounting' it maps to connected
-- Chart-of-Account UUIDs. Both mappings must persist independently so toggling the
-- PMS App / Accounting App radio restores the mapping saved for that source.
--
-- These columns hold the ACCOUNTING (Chart-of-Account UUID) mapping per income
-- type. The PMS mapping stays in private_/membership_/nhs_income_accounts.
ALTER TABLE practice_locations
  ADD COLUMN IF NOT EXISTS private_income_coa_accounts    JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS membership_income_coa_accounts JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS nhs_income_coa_accounts        JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN practice_locations.private_income_coa_accounts    IS 'Array of Chart-of-Account UUIDs for private income when private_income_source = accounting';
COMMENT ON COLUMN practice_locations.membership_income_coa_accounts IS 'Array of Chart-of-Account UUIDs for membership income when membership_income_source = accounting';
COMMENT ON COLUMN practice_locations.nhs_income_coa_accounts        IS 'Array of Chart-of-Account UUIDs for NHS income when nhs_income_source = accounting';
