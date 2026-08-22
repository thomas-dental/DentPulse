-- ============================================================================
-- Migration: Remove dentally_site_id from organizations table
--
-- Reason: The column is no longer needed.
--   - Node backend sync routes data via practice_locations.api_record_unique_id
--   - The dentally-sync edge function is no longer used
--   - onboard.js used it only as a NULL filter (replaced by user_id check)
-- ============================================================================

ALTER TABLE public.organizations
  DROP COLUMN IF EXISTS dentally_site_id;
