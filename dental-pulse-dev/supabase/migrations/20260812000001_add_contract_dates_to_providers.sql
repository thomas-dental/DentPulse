-- Adds Contract Start Date / Contract End Date, settable from a provider's
-- Contract Details tab -> Contract Period.

ALTER TABLE public.providers
  ADD COLUMN IF NOT EXISTS contract_start_date date,
  ADD COLUMN IF NOT EXISTS contract_end_date date;

COMMENT ON COLUMN public.providers.contract_start_date IS 'Contract start date, set from the Contract Details tab';
COMMENT ON COLUMN public.providers.contract_end_date IS 'Contract end date, set from the Contract Details tab';
