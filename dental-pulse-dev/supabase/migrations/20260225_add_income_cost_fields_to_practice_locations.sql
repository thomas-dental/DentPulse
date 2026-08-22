-- Add income and cost mapping fields to practice_locations table
ALTER TABLE practice_locations
ADD COLUMN IF NOT EXISTS logo_url TEXT,
-- Income Type Mapping (radio buttons: 'pms' or 'accounting')
ADD COLUMN IF NOT EXISTS private_income_source TEXT DEFAULT 'pms',
ADD COLUMN IF NOT EXISTS membership_income_source TEXT DEFAULT 'accounting',
ADD COLUMN IF NOT EXISTS nhs_income_source TEXT DEFAULT 'accounting',
-- Expenses Accounts (array of account IDs)
ADD COLUMN IF NOT EXISTS lab_fees_accounts JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS staff_costs_accounts JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS operating_lease_accounts JSONB DEFAULT '[]'::jsonb,
-- Revenue Income Accounts (array of account IDs)
ADD COLUMN IF NOT EXISTS membership_income_accounts JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS nhs_income_accounts JSONB DEFAULT '[]'::jsonb;

-- Add comments for documentation
COMMENT ON COLUMN practice_locations.logo_url IS 'URL to the location logo image';
COMMENT ON COLUMN practice_locations.private_income_source IS 'Private income source type: pms or accounting';
COMMENT ON COLUMN practice_locations.membership_income_source IS 'Membership income source type: pms or accounting';
COMMENT ON COLUMN practice_locations.nhs_income_source IS 'NHS income source type: pms or accounting';
COMMENT ON COLUMN practice_locations.lab_fees_accounts IS 'Array of chart of account IDs for lab fees expenses';
COMMENT ON COLUMN practice_locations.staff_costs_accounts IS 'Array of chart of account IDs for staff costs expenses';
COMMENT ON COLUMN practice_locations.operating_lease_accounts IS 'Array of chart of account IDs for operating lease expenses';
COMMENT ON COLUMN practice_locations.membership_income_accounts IS 'Array of chart of account IDs for membership income revenue';
COMMENT ON COLUMN practice_locations.nhs_income_accounts IS 'Array of chart of account IDs for NHS income revenue';
