-- Add duration, treatment_id, and created_at fields to treatment_plan_items table
-- These fields come from Dentally API when syncing treatment plan items
-- All fields are nullable with NULL default to avoid affecting existing codebase

ALTER TABLE treatment_plan_items
  ADD COLUMN IF NOT EXISTS duration INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS tpi_treatment_id INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS tpi_created_at TIMESTAMPTZ DEFAULT NULL;

COMMENT ON COLUMN treatment_plan_items.duration IS 'Duration of the treatment in minutes from Dentally (nullable)';
COMMENT ON COLUMN treatment_plan_items.tpi_treatment_id IS 'Treatment ID from Dentally API (nullable)';
COMMENT ON COLUMN treatment_plan_items.tpi_created_at IS 'Created at timestamp from Dentally API (nullable)';
