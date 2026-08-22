-- Contract History's "Delete" action in "View All Contracts" was doing a
-- hard DELETE on provider_contracts. Switch to soft delete (deleted_at
-- timestamp), matching the convention already used by the sibling
-- provider_contract_attachments table and the providers table itself.

ALTER TABLE public.provider_contracts
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN public.provider_contracts.deleted_at IS 'Soft delete timestamp - NULL means not deleted';

CREATE INDEX IF NOT EXISTS idx_provider_contracts_deleted_at
    ON public.provider_contracts(deleted_at)
    WHERE deleted_at IS NULL;

-- A soft-deleted "open" contract row must not block starting a new open
-- contract for the same provider, so exclude soft-deleted rows from the
-- one-open-contract-per-provider constraint.
DROP INDEX IF EXISTS public.ux_provider_contracts_open_per_provider;
CREATE UNIQUE INDEX IF NOT EXISTS ux_provider_contracts_open_per_provider
    ON public.provider_contracts(provider_id)
    WHERE contract_end_date IS NULL AND deleted_at IS NULL;
