-- Add contract_type (NHS / MOS) to the UDA goals settings tables.
--
-- The UDA Goals Settings tab is getting an MOS sub-tab alongside the existing
-- NHS one (mirroring the practice's other contract type). MOS needs its own
-- contract value / obligation / targets stored separately from NHS, so both
-- tables gain a contract_type column and the uniqueness constraints widen to
-- include it. Existing rows default to 'NHS' so current data keeps working
-- unchanged.

ALTER TABLE public.uda_settings
  ADD COLUMN IF NOT EXISTS contract_type TEXT NOT NULL DEFAULT 'NHS'
    CHECK (contract_type IN ('NHS', 'MOS'));

ALTER TABLE public.uda_settings DROP CONSTRAINT IF EXISTS uda_settings_unique_loc;
ALTER TABLE public.uda_settings
  ADD CONSTRAINT uda_settings_unique_loc
  UNIQUE NULLS NOT DISTINCT (organization_id, location_id, financial_year, contract_type);

CREATE INDEX IF NOT EXISTS idx_uda_settings_org_loc_fy_type
  ON public.uda_settings (organization_id, location_id, financial_year, contract_type);

COMMENT ON COLUMN public.uda_settings.contract_type IS
  'Which contract these settings belong to: NHS or MOS.';


ALTER TABLE public.uda_targets
  ADD COLUMN IF NOT EXISTS contract_type TEXT NOT NULL DEFAULT 'NHS'
    CHECK (contract_type IN ('NHS', 'MOS'));

ALTER TABLE public.uda_targets DROP CONSTRAINT IF EXISTS uda_targets_unique;
ALTER TABLE public.uda_targets
  ADD CONSTRAINT uda_targets_unique
  UNIQUE (organization_id, provider_id, period_type, period, contract_type);

COMMENT ON COLUMN public.uda_targets.contract_type IS
  'Which contract this target belongs to: NHS or MOS.';
