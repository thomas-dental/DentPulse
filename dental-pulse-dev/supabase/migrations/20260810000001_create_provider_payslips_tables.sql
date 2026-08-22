-- Create provider_payslips (header) and its 4 line tables, modeled on
-- provider_sliding_scales (20260201000001_create_provider_sliding_scales_table.sql).

CREATE TABLE IF NOT EXISTS public.provider_payslips (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    provider_id UUID NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
    provider_name VARCHAR(200) NOT NULL,
    month_ending DATE NOT NULL,
    statement_date DATE NOT NULL,
    nhs_schedule TEXT,
    udas DECIMAL(10, 2),
    status VARCHAR(10) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted')),
    gross_fees_total DECIMAL(12, 2) NOT NULL DEFAULT 0,
    gross_deductions_total DECIMAL(12, 2) NOT NULL DEFAULT 0,
    total_gross_fees DECIMAL(12, 2) NOT NULL DEFAULT 0,
    associate_split_percentage DECIMAL(5, 2),
    associate_split_amount DECIMAL(12, 2),
    pay_band_associate_share_total DECIMAL(12, 2) NOT NULL DEFAULT 0,
    labs_total DECIMAL(12, 2) NOT NULL DEFAULT 0,
    associate_lab_split_percentage DECIMAL(5, 2),
    associate_lab_split_amount DECIMAL(12, 2),
    associate_lab_share_total DECIMAL(12, 2) NOT NULL DEFAULT 0,
    additions_total DECIMAL(12, 2) NOT NULL DEFAULT 0,
    deductions_total DECIMAL(12, 2) NOT NULL DEFAULT 0,
    net_pay DECIMAL(12, 2) NOT NULL DEFAULT 0,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    deleted_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_provider_payslips_provider_month
    ON public.provider_payslips(provider_id, month_ending)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_provider_payslips_provider_id ON public.provider_payslips(provider_id);
CREATE INDEX IF NOT EXISTS idx_provider_payslips_organization_id ON public.provider_payslips(organization_id);

CREATE TABLE IF NOT EXISTS public.provider_payslip_income_lines (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    payslip_id UUID NOT NULL REFERENCES public.provider_payslips(id) ON DELETE CASCADE,
    line_type VARCHAR(10) NOT NULL CHECK (line_type IN ('income', 'deduction')),
    line_key VARCHAR(50) NOT NULL,
    label VARCHAR(100) NOT NULL,
    display_order INT NOT NULL DEFAULT 0,
    amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_payslip_income_lines_payslip_id ON public.provider_payslip_income_lines(payslip_id);

CREATE TABLE IF NOT EXISTS public.provider_payslip_pay_band_lines (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    payslip_id UUID NOT NULL REFERENCES public.provider_payslips(id) ON DELETE CASCADE,
    band_order INT NOT NULL DEFAULT 0,
    band_name VARCHAR(100) NOT NULL,
    start_value DECIMAL(12, 2) NOT NULL DEFAULT 0,
    end_value DECIMAL(12, 2),
    associate_percentage DECIMAL(5, 2) NOT NULL DEFAULT 0,
    gross_band_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
    associate_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_payslip_pay_band_lines_payslip_id ON public.provider_payslip_pay_band_lines(payslip_id);

CREATE TABLE IF NOT EXISTS public.provider_payslip_lab_band_lines (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    payslip_id UUID NOT NULL REFERENCES public.provider_payslips(id) ON DELETE CASCADE,
    band_order INT NOT NULL DEFAULT 0,
    band_name VARCHAR(100) NOT NULL,
    start_value DECIMAL(12, 2) NOT NULL DEFAULT 0,
    end_value DECIMAL(12, 2),
    associate_percentage DECIMAL(5, 2) NOT NULL DEFAULT 0,
    gross_band_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
    associate_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_payslip_lab_band_lines_payslip_id ON public.provider_payslip_lab_band_lines(payslip_id);

CREATE TABLE IF NOT EXISTS public.provider_payslip_adjustment_lines (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    payslip_id UUID NOT NULL REFERENCES public.provider_payslips(id) ON DELETE CASCADE,
    adjustment_type VARCHAR(10) NOT NULL CHECK (adjustment_type IN ('addition', 'deduction')),
    label VARCHAR(100) NOT NULL,
    display_order INT NOT NULL DEFAULT 0,
    amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_payslip_adjustment_lines_payslip_id ON public.provider_payslip_adjustment_lines(payslip_id);

-- updated_at trigger (function may already exist from earlier migrations; redefine idempotently)
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = TIMEZONE('utc'::text, NOW());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_updated_at ON public.provider_payslips;
CREATE TRIGGER set_updated_at
    BEFORE UPDATE ON public.provider_payslips
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();

-- Row Level Security -- header table
ALTER TABLE public.provider_payslips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view payslips for their organization"
    ON public.provider_payslips
    FOR SELECT
    USING (
        organization_id IN (
            SELECT id FROM public.organizations
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert payslips for their organization"
    ON public.provider_payslips
    FOR INSERT
    WITH CHECK (
        organization_id IN (
            SELECT id FROM public.organizations
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update payslips for their organization"
    ON public.provider_payslips
    FOR UPDATE
    USING (
        organization_id IN (
            SELECT id FROM public.organizations
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Users can delete payslips for their organization"
    ON public.provider_payslips
    FOR DELETE
    USING (
        organization_id IN (
            SELECT id FROM public.organizations
            WHERE user_id = auth.uid()
        )
    );

-- Row Level Security -- line tables (same 4-policy pattern, repeated per table)
ALTER TABLE public.provider_payslip_income_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view payslip income lines for their organization"
    ON public.provider_payslip_income_lines
    FOR SELECT
    USING (
        organization_id IN (
            SELECT id FROM public.organizations
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert payslip income lines for their organization"
    ON public.provider_payslip_income_lines
    FOR INSERT
    WITH CHECK (
        organization_id IN (
            SELECT id FROM public.organizations
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update payslip income lines for their organization"
    ON public.provider_payslip_income_lines
    FOR UPDATE
    USING (
        organization_id IN (
            SELECT id FROM public.organizations
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Users can delete payslip income lines for their organization"
    ON public.provider_payslip_income_lines
    FOR DELETE
    USING (
        organization_id IN (
            SELECT id FROM public.organizations
            WHERE user_id = auth.uid()
        )
    );

ALTER TABLE public.provider_payslip_pay_band_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view payslip pay band lines for their organization"
    ON public.provider_payslip_pay_band_lines
    FOR SELECT
    USING (
        organization_id IN (
            SELECT id FROM public.organizations
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert payslip pay band lines for their organization"
    ON public.provider_payslip_pay_band_lines
    FOR INSERT
    WITH CHECK (
        organization_id IN (
            SELECT id FROM public.organizations
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update payslip pay band lines for their organization"
    ON public.provider_payslip_pay_band_lines
    FOR UPDATE
    USING (
        organization_id IN (
            SELECT id FROM public.organizations
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Users can delete payslip pay band lines for their organization"
    ON public.provider_payslip_pay_band_lines
    FOR DELETE
    USING (
        organization_id IN (
            SELECT id FROM public.organizations
            WHERE user_id = auth.uid()
        )
    );

ALTER TABLE public.provider_payslip_lab_band_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view payslip lab band lines for their organization"
    ON public.provider_payslip_lab_band_lines
    FOR SELECT
    USING (
        organization_id IN (
            SELECT id FROM public.organizations
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert payslip lab band lines for their organization"
    ON public.provider_payslip_lab_band_lines
    FOR INSERT
    WITH CHECK (
        organization_id IN (
            SELECT id FROM public.organizations
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update payslip lab band lines for their organization"
    ON public.provider_payslip_lab_band_lines
    FOR UPDATE
    USING (
        organization_id IN (
            SELECT id FROM public.organizations
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Users can delete payslip lab band lines for their organization"
    ON public.provider_payslip_lab_band_lines
    FOR DELETE
    USING (
        organization_id IN (
            SELECT id FROM public.organizations
            WHERE user_id = auth.uid()
        )
    );

ALTER TABLE public.provider_payslip_adjustment_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view payslip adjustment lines for their organization"
    ON public.provider_payslip_adjustment_lines
    FOR SELECT
    USING (
        organization_id IN (
            SELECT id FROM public.organizations
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert payslip adjustment lines for their organization"
    ON public.provider_payslip_adjustment_lines
    FOR INSERT
    WITH CHECK (
        organization_id IN (
            SELECT id FROM public.organizations
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update payslip adjustment lines for their organization"
    ON public.provider_payslip_adjustment_lines
    FOR UPDATE
    USING (
        organization_id IN (
            SELECT id FROM public.organizations
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Users can delete payslip adjustment lines for their organization"
    ON public.provider_payslip_adjustment_lines
    FOR DELETE
    USING (
        organization_id IN (
            SELECT id FROM public.organizations
            WHERE user_id = auth.uid()
        )
    );
