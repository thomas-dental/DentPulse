-- Create platform_overpayments table
CREATE TABLE IF NOT EXISTS public.platform_overpayments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Foreign Keys
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    platform_integration_id UUID REFERENCES public.platform_integrations(id) ON DELETE CASCADE,
    platform_integration_organization_id UUID REFERENCES public.platform_integration_organizations(id) ON DELETE CASCADE,
    
    -- Platform Identifiers
    overpayment_id VARCHAR(500),
    account_type VARCHAR(100),
    
    -- Financial Details (NUMERIC to match current DB)
    remaining_credit NUMERIC(10, 2) DEFAULT 0,
    sub_total NUMERIC(10, 2) DEFAULT 0,
    total_tax NUMERIC(10, 2) DEFAULT 0,
    total NUMERIC(10, 2) DEFAULT 0,
    currency_code VARCHAR(10),
    
    -- Contact Details
    contact_id VARCHAR(500),
    contact_name VARCHAR(500),
    
    -- Dates
    overpayment_date DATE NOT NULL,
    
    -- Status & Types
    status VARCHAR(100),
    line_amount_types VARCHAR(50),
    
    -- Timestamps
    updated_date_utc TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT platform_overpayments_unique_per_org UNIQUE (organization_id, platform_integration_organization_id, overpayment_id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_platform_overpayments_organization_id ON public.platform_overpayments(organization_id);
CREATE INDEX IF NOT EXISTS idx_platform_overpayments_platform_integration_id ON public.platform_overpayments(platform_integration_id);
CREATE INDEX IF NOT EXISTS idx_platform_overpayments_platform_integration_org_id ON public.platform_overpayments(platform_integration_organization_id);
CREATE INDEX IF NOT EXISTS idx_platform_overpayments_overpayment_id ON public.platform_overpayments(overpayment_id);
CREATE INDEX IF NOT EXISTS idx_platform_overpayments_account_type ON public.platform_overpayments(account_type);
CREATE INDEX IF NOT EXISTS idx_platform_overpayments_status ON public.platform_overpayments(status);
CREATE INDEX IF NOT EXISTS idx_platform_overpayments_overpayment_date ON public.platform_overpayments(overpayment_date);
CREATE INDEX IF NOT EXISTS idx_platform_overpayments_updated_date_utc ON public.platform_overpayments(updated_date_utc);
CREATE INDEX IF NOT EXISTS idx_platform_overpayments_contact_id ON public.platform_overpayments(contact_id);

-- Enable RLS
ALTER TABLE public.platform_overpayments ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Users can view platform overpayments in their org" ON public.platform_overpayments;
CREATE POLICY "Users can view platform overpayments in their org"
ON public.platform_overpayments FOR SELECT
USING (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can insert platform overpayments in their org" ON public.platform_overpayments;
CREATE POLICY "Users can insert platform overpayments in their org"
ON public.platform_overpayments FOR INSERT
WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can update platform overpayments in their org" ON public.platform_overpayments;
CREATE POLICY "Users can update platform overpayments in their org"
ON public.platform_overpayments FOR UPDATE
USING (public.user_in_org(auth.uid(), organization_id))
WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can delete platform overpayments in their org" ON public.platform_overpayments;
CREATE POLICY "Users can delete platform overpayments in their org"
ON public.platform_overpayments FOR DELETE
USING (public.user_in_org(auth.uid(), organization_id));

-- Update trigger
CREATE OR REPLACE FUNCTION update_platform_overpayments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_platform_overpayments_updated_at ON public.platform_overpayments;
CREATE TRIGGER update_platform_overpayments_updated_at
    BEFORE UPDATE ON public.platform_overpayments
    FOR EACH ROW
    EXECUTE FUNCTION update_platform_overpayments_updated_at();
