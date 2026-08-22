-- Update comments to reflect that revenue income columns now store payment plan IDs, not account IDs
COMMENT ON COLUMN practice_locations.private_income_accounts IS 'Array of payment plan pp_id values for private income revenue';
COMMENT ON COLUMN practice_locations.membership_income_accounts IS 'Array of payment plan pp_id values for membership income revenue';
COMMENT ON COLUMN practice_locations.nhs_income_accounts IS 'Array of payment plan pp_id values for NHS income revenue';
