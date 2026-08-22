-- Add private_income_accounts field to practice_locations table
ALTER TABLE practice_locations
ADD COLUMN IF NOT EXISTS private_income_accounts JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN practice_locations.private_income_accounts IS 'Array of payment plan IDs for private income revenue';
