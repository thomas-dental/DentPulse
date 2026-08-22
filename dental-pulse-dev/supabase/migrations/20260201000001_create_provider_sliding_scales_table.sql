-- Create provider_sliding_scales table
CREATE TABLE IF NOT EXISTS public.provider_sliding_scales (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    provider_id UUID NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
    scale_type VARCHAR(20) NOT NULL CHECK (scale_type IN ('sliding_scale', 'lab_sliding_scale')),
    band_name VARCHAR(100) NOT NULL,
    start_amount DECIMAL(10, 2) NOT NULL DEFAULT 0,
    end_amount DECIMAL(10, 2) NOT NULL,
    percentage_value DECIMAL(5, 2) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Create index for faster queries
CREATE INDEX idx_provider_sliding_scales_provider_id ON public.provider_sliding_scales(provider_id);
CREATE INDEX idx_provider_sliding_scales_organization_id ON public.provider_sliding_scales(organization_id);
CREATE INDEX idx_provider_sliding_scales_scale_type ON public.provider_sliding_scales(scale_type);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = TIMEZONE('utc'::text, NOW());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at
    BEFORE UPDATE ON public.provider_sliding_scales
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();

-- Enable Row Level Security
ALTER TABLE public.provider_sliding_scales ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view sliding scales for their organization"
    ON public.provider_sliding_scales
    FOR SELECT
    USING (
        organization_id IN (
            SELECT id FROM public.organizations
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert sliding scales for their organization"
    ON public.provider_sliding_scales
    FOR INSERT
    WITH CHECK (
        organization_id IN (
            SELECT id FROM public.organizations
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update sliding scales for their organization"
    ON public.provider_sliding_scales
    FOR UPDATE
    USING (
        organization_id IN (
            SELECT id FROM public.organizations
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Users can delete sliding scales for their organization"
    ON public.provider_sliding_scales
    FOR DELETE
    USING (
        organization_id IN (
            SELECT id FROM public.organizations
            WHERE user_id = auth.uid()
        )
    );
