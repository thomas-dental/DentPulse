-- Create platform_journal_details table
CREATE TABLE IF NOT EXISTS public.platform_journal_details (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Foreign Keys
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    platform_integration_id UUID REFERENCES public.platform_integrations(id) ON DELETE CASCADE,
    platform_integration_organization_id UUID REFERENCES public.platform_integration_organizations(id) ON DELETE CASCADE,
    journal_id UUID REFERENCES public.platform_journals(id) ON DELETE CASCADE,
    
    -- Platform Identifiers
    journal_line_id VARCHAR(500),
    source_id VARCHAR(500),
    platform_journal_id VARCHAR(500), -- Reference to platform journal ID (not UUID)
    
    -- Account Details
    account_id VARCHAR(500),
    account_code VARCHAR(255),
    account_type VARCHAR(100),
    account_name VARCHAR(500),
    
    -- Line Item Details (NUMERIC to match current DB)
    description TEXT,
    net_amount NUMERIC(10, 2),
    gross_amount NUMERIC(10, 2),
    tax_amount NUMERIC(10, 2),
    tax_type VARCHAR(255),
    tax_name VARCHAR(255),
    
    -- Date
    journal_date DATE NOT NULL,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT platform_journal_details_unique_per_journal UNIQUE (organization_id, platform_integration_organization_id, platform_journal_id, journal_line_id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_platform_journal_details_organization_id ON public.platform_journal_details(organization_id);
CREATE INDEX IF NOT EXISTS idx_platform_journal_details_platform_integration_id ON public.platform_journal_details(platform_integration_id);
CREATE INDEX IF NOT EXISTS idx_platform_journal_details_platform_integration_org_id ON public.platform_journal_details(platform_integration_organization_id);
CREATE INDEX IF NOT EXISTS idx_platform_journal_details_journal_id ON public.platform_journal_details(journal_id);
CREATE INDEX IF NOT EXISTS idx_platform_journal_details_platform_journal_id ON public.platform_journal_details(platform_journal_id);
CREATE INDEX IF NOT EXISTS idx_platform_journal_details_journal_line_id ON public.platform_journal_details(journal_line_id);
CREATE INDEX IF NOT EXISTS idx_platform_journal_details_account_id ON public.platform_journal_details(account_id);
CREATE INDEX IF NOT EXISTS idx_platform_journal_details_account_code ON public.platform_journal_details(account_code);
CREATE INDEX IF NOT EXISTS idx_platform_journal_details_journal_date ON public.platform_journal_details(journal_date);

-- Enable RLS
ALTER TABLE public.platform_journal_details ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Users can view platform journal details in their org" ON public.platform_journal_details;
CREATE POLICY "Users can view platform journal details in their org"
ON public.platform_journal_details FOR SELECT
USING (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can insert platform journal details in their org" ON public.platform_journal_details;
CREATE POLICY "Users can insert platform journal details in their org"
ON public.platform_journal_details FOR INSERT
WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can update platform journal details in their org" ON public.platform_journal_details;
CREATE POLICY "Users can update platform journal details in their org"
ON public.platform_journal_details FOR UPDATE
USING (public.user_in_org(auth.uid(), organization_id))
WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can delete platform journal details in their org" ON public.platform_journal_details;
CREATE POLICY "Users can delete platform journal details in their org"
ON public.platform_journal_details FOR DELETE
USING (public.user_in_org(auth.uid(), organization_id));

-- Update trigger
CREATE OR REPLACE FUNCTION update_platform_journal_details_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_platform_journal_details_updated_at ON public.platform_journal_details;
CREATE TRIGGER update_platform_journal_details_updated_at
    BEFORE UPDATE ON public.platform_journal_details
    FOR EACH ROW
    EXECUTE FUNCTION update_platform_journal_details_updated_at();
