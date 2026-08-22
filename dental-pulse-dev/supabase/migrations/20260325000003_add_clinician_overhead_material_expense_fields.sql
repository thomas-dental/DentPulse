-- Add clinician_cost, overhead, and material expense account mapping columns  add to practice_locations for location-level mapping
ALTER TABLE public.practice_locations
  ADD COLUMN IF NOT EXISTS clinician_cost_accounts JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS overhead_cost_accounts JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS material_cost_accounts JSONB DEFAULT '[]'::jsonb;
