-- Add UOA (orthodontic) as a third contract type to the UDA goals settings
-- tables, alongside NHS and MOS. Mirrors 20260727000001_add_contract_type_to_uda_tables.sql,
-- which added MOS the same way. Existing NHS/MOS rows are unaffected — this only
-- widens the allowed values.

ALTER TABLE public.uda_settings DROP CONSTRAINT IF EXISTS uda_settings_contract_type_check;
ALTER TABLE public.uda_settings
  ADD CONSTRAINT uda_settings_contract_type_check
  CHECK (contract_type IN ('NHS', 'MOS', 'UOA'));

ALTER TABLE public.uda_targets DROP CONSTRAINT IF EXISTS uda_targets_contract_type_check;
ALTER TABLE public.uda_targets
  ADD CONSTRAINT uda_targets_contract_type_check
  CHECK (contract_type IN ('NHS', 'MOS', 'UOA'));
