-- EBITDA add-back Chart-of-Account mappings (Setup Categories → EBITDA tab).
-- Values are external COA ids (e.g. Xero account GUID), matching Setup Categories AccountMultiSelect.
ALTER TABLE practice_locations
  ADD COLUMN IF NOT EXISTS ebitda_depreciation_accounts JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS ebitda_amortisation_accounts JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS ebitda_interest_accounts JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS ebitda_tax_accounts JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN practice_locations.ebitda_depreciation_accounts IS 'External Chart-of-Account ids (e.g. Xero GUID) added back for EBITDA Depreciation';
COMMENT ON COLUMN practice_locations.ebitda_amortisation_accounts IS 'External Chart-of-Account ids added back for EBITDA Amortisation';
COMMENT ON COLUMN practice_locations.ebitda_interest_accounts IS 'External Chart-of-Account ids added back for EBITDA Interest Paid';
COMMENT ON COLUMN practice_locations.ebitda_tax_accounts IS 'External Chart-of-Account ids added back for EBITDA Tax';
