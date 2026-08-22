-- Add lab_split_percentage_sliding field to providers table
-- This field stores the Lab Split Percentage value when Split Source Method is "Sliding Scale"
-- The existing lab_split_percentage field is used when Split Source Method is "Flat Percentage"

ALTER TABLE providers
ADD COLUMN IF NOT EXISTS lab_split_percentage_sliding DECIMAL(5,2) DEFAULT 0;

COMMENT ON COLUMN providers.lab_split_percentage_sliding IS 'Lab split percentage used when split_source_method is sliding-scale';
COMMENT ON COLUMN providers.lab_split_percentage IS 'Lab split percentage used when split_source_method is flat-percentage';
