-- Contract attachment uploads (PDF/Word), attached to a provider from the
-- Contract Details tab. Modeled on due_diligence_documents — metadata row
-- here, actual file bytes in the 'uploads' storage bucket.

CREATE TABLE IF NOT EXISTS public.provider_contract_attachments (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    provider_id UUID NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
    uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    file_name VARCHAR(255) NOT NULL,
    file_path TEXT NOT NULL,
    file_size BIGINT,
    file_type VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_provider_contract_attachments_provider_id
    ON public.provider_contract_attachments(provider_id);
CREATE INDEX IF NOT EXISTS idx_provider_contract_attachments_organization_id
    ON public.provider_contract_attachments(organization_id);

ALTER TABLE public.provider_contract_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view contract attachments for their organization"
    ON public.provider_contract_attachments
    FOR SELECT
    USING (
        organization_id IN (
            SELECT id FROM public.organizations
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert contract attachments for their organization"
    ON public.provider_contract_attachments
    FOR INSERT
    WITH CHECK (
        organization_id IN (
            SELECT id FROM public.organizations
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update contract attachments for their organization"
    ON public.provider_contract_attachments
    FOR UPDATE
    USING (
        organization_id IN (
            SELECT id FROM public.organizations
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Users can delete contract attachments for their organization"
    ON public.provider_contract_attachments
    FOR DELETE
    USING (
        organization_id IN (
            SELECT id FROM public.organizations
            WHERE user_id = auth.uid()
        )
    );
