-- Add marketing_cost_accounts to practice_locations, mirroring the existing
-- overhead_cost_accounts / material_cost_accounts location-level cost buckets.
-- The "Marketing" expense group (group_account_master.group_code = 'Marketing',
-- id 106) already exists and is selectable in Setup Categories > Expenses;
-- this column is where its per-location selected accounts are synced to, the
-- same way Staff/Operating Lease/Other Fixed Costs already are.
ALTER TABLE public.practice_locations
  ADD COLUMN IF NOT EXISTS marketing_cost_accounts JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.practice_locations.marketing_cost_accounts IS
  'Chart-of-accounts UUIDs classified as Marketing Cost for this location. '
  'Configured via Setup Categories > Expenses > Marketing.';
