-- Special Treatments: per-provider treatment-group associate-split
-- overrides, configured from the Contract Details tab. Ported from
-- fe-dentpulse-live's "Special Treatments" card (Contract Details tab) —
-- that version has no backing table/consumer yet, so this schema is
-- designed fresh, following this codebase's existing "replace all on save"
-- pattern (see provider_sliding_scales).

CREATE TABLE IF NOT EXISTS public.provider_special_treatments (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    provider_id UUID NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
    group_name VARCHAR(100) NOT NULL,
    associate_split_percentage DECIMAL(5, 2) NOT NULL DEFAULT 0,
    -- Postgres arrays hold the treatment multi-select directly — no join
    -- table needed (unlike the SQL Server precedent this was ported from).
    treatment_ids UUID[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_provider_special_treatments_provider_id
    ON public.provider_special_treatments(provider_id);
CREATE INDEX IF NOT EXISTS idx_provider_special_treatments_organization_id
    ON public.provider_special_treatments(organization_id);

-- Function may already exist from earlier migrations; redefine idempotently.
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = TIMEZONE('utc'::text, NOW());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_updated_at ON public.provider_special_treatments;
CREATE TRIGGER set_updated_at
    BEFORE UPDATE ON public.provider_special_treatments
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.provider_special_treatments ENABLE ROW LEVEL SECURITY;

-- Uses public.user_in_org() (org membership via user_roles), not the legacy
-- organizations.user_id = auth.uid() pattern — see
-- 20260813000003_fix_contract_tables_rls_use_user_in_org.sql for why that
-- older pattern silently blocks every non-owner team member.
CREATE POLICY "Users can view special treatments for their organization"
    ON public.provider_special_treatments
    FOR SELECT
    USING (auth.uid() IS NOT NULL AND public.user_in_org(auth.uid(), organization_id));

CREATE POLICY "Users can insert special treatments for their organization"
    ON public.provider_special_treatments
    FOR INSERT
    WITH CHECK (auth.uid() IS NOT NULL AND public.user_in_org(auth.uid(), organization_id));

CREATE POLICY "Users can update special treatments for their organization"
    ON public.provider_special_treatments
    FOR UPDATE
    USING (auth.uid() IS NOT NULL AND public.user_in_org(auth.uid(), organization_id));

CREATE POLICY "Users can delete special treatments for their organization"
    ON public.provider_special_treatments
    FOR DELETE
    USING (auth.uid() IS NOT NULL AND public.user_in_org(auth.uid(), organization_id));
