-- Add therapist completion time used column to treatments
ALTER TABLE treatments
ADD COLUMN IF NOT EXISTS therapist_completion_mins integer DEFAULT 0;

COMMENT ON COLUMN treatments.therapist_completion_mins IS 'Actual completion time used by therapist in minutes';
