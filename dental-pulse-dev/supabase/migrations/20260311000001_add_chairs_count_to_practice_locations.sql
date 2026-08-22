-- Add chairs_count column to practice_locations table
ALTER TABLE practice_locations
ADD COLUMN IF NOT EXISTS chairs_count INTEGER DEFAULT NULL;

-- Add comment for documentation
COMMENT ON COLUMN practice_locations.chairs_count IS 'Number of dental chairs at this location';
