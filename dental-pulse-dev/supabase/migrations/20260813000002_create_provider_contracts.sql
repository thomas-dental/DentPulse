-- Contract history for providers. Until now a provider's contract details
-- (dates, split method/percentages) were plain columns on `providers` — a
-- single "current" contract with no memory of what came before. This table
-- adds real history: each row is one contract period, driven from the
-- Contract Details tab's "Is New Contract" checkbox — checking it and saving
-- closes the provider's current open period (contract_end_date = new
-- contract_start_date - 1 day) and opens a new one with the form's values.

CREATE TABLE IF NOT EXISTS public.provider_contracts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    provider_id UUID NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
    contract_start_date DATE NOT NULL,
    -- NULL = this is the provider's current, still-open contract period.
    contract_end_date DATE,
    split_source_method VARCHAR(30) NOT NULL DEFAULT 'flat-percentage',
    associate_split_percentage DECIMAL(5, 2),
    lab_split_percentage DECIMAL(5, 2),
    lab_split_percentage_sliding DECIMAL(5, 2),
    material_split_percentage DECIMAL(5, 2),
    associate_split_per_case_rate DECIMAL(10, 2),
    associate_split_per_hour_rate DECIMAL(10, 2),
    employment_type VARCHAR(20),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- At most one open (current) contract period per provider at any time.
CREATE UNIQUE INDEX IF NOT EXISTS ux_provider_contracts_open_per_provider
    ON public.provider_contracts(provider_id)
    WHERE contract_end_date IS NULL;

CREATE INDEX IF NOT EXISTS idx_provider_contracts_provider_id
    ON public.provider_contracts(provider_id);
CREATE INDEX IF NOT EXISTS idx_provider_contracts_organization_id
    ON public.provider_contracts(organization_id);

ALTER TABLE public.provider_contracts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view provider contracts for their organization"
    ON public.provider_contracts
    FOR SELECT
    USING (
        organization_id IN (
            SELECT id FROM public.organizations
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert provider contracts for their organization"
    ON public.provider_contracts
    FOR INSERT
    WITH CHECK (
        organization_id IN (
            SELECT id FROM public.organizations
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update provider contracts for their organization"
    ON public.provider_contracts
    FOR UPDATE
    USING (
        organization_id IN (
            SELECT id FROM public.organizations
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Users can delete provider contracts for their organization"
    ON public.provider_contracts
    FOR DELETE
    USING (
        organization_id IN (
            SELECT id FROM public.organizations
            WHERE user_id = auth.uid()
        )
    );
