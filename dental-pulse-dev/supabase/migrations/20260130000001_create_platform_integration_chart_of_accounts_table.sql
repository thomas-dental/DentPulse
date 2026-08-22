-- Create platform_integration_chart_of_accounts table
CREATE TABLE IF NOT EXISTS public.platform_integration_chart_of_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Foreign Keys
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    platform_integration_id UUID REFERENCES public.platform_integrations(id) ON DELETE CASCADE,
    platform_integration_organization_id UUID REFERENCES public.platform_integration_organizations(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    
    -- Platform Details
    platform_name VARCHAR(255) NOT NULL,
    
    -- Chart of Accounts Details
    coa_account_id VARCHAR(500) NOT NULL,
    coa_account_code VARCHAR(255),
    coa_account_name VARCHAR(500) NOT NULL,
    coa_account_type VARCHAR(100) NOT NULL,
    coa_account_sub_type VARCHAR(255),
    coa_classification VARCHAR(100),
    coa_description TEXT,
    coa_tax_type VARCHAR(255),
    coa_bank_account_type VARCHAR(100),
    coa_reporting_code VARCHAR(255),
    coa_reporting_name VARCHAR(500),
    coa_is_active BOOLEAN DEFAULT true,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT platform_integration_coa_account_id_not_empty CHECK (length(coa_account_id) >= 1),
    CONSTRAINT platform_integration_coa_account_name_not_empty CHECK (length(coa_account_name) >= 1),
    CONSTRAINT platform_integration_coa_unique_account_per_org UNIQUE (organization_id, platform_integration_id, coa_account_id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_platform_integration_coa_organization_id ON public.platform_integration_chart_of_accounts(organization_id);
CREATE INDEX IF NOT EXISTS idx_platform_integration_coa_platform_integration_id ON public.platform_integration_chart_of_accounts(platform_integration_id);
CREATE INDEX IF NOT EXISTS idx_platform_integration_coa_platform_integration_org_id ON public.platform_integration_chart_of_accounts(platform_integration_organization_id);
CREATE INDEX IF NOT EXISTS idx_platform_integration_coa_user_id ON public.platform_integration_chart_of_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_platform_integration_coa_platform_name ON public.platform_integration_chart_of_accounts(platform_name);
CREATE INDEX IF NOT EXISTS idx_platform_integration_coa_account_id ON public.platform_integration_chart_of_accounts(coa_account_id);
CREATE INDEX IF NOT EXISTS idx_platform_integration_coa_account_type ON public.platform_integration_chart_of_accounts(coa_account_type);
CREATE INDEX IF NOT EXISTS idx_platform_integration_coa_classification ON public.platform_integration_chart_of_accounts(coa_classification);
CREATE INDEX IF NOT EXISTS idx_platform_integration_coa_is_active ON public.platform_integration_chart_of_accounts(coa_is_active);
CREATE INDEX IF NOT EXISTS idx_platform_integration_coa_org_platform_account ON public.platform_integration_chart_of_accounts(organization_id, platform_integration_id, coa_account_id);

-- Enable RLS
ALTER TABLE public.platform_integration_chart_of_accounts ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Users can view chart of accounts in their organization
DROP POLICY IF EXISTS "Users can view platform integration chart of accounts in their org" ON public.platform_integration_chart_of_accounts;
CREATE POLICY "Users can view platform integration chart of accounts in their org"
ON public.platform_integration_chart_of_accounts FOR SELECT
USING (
    public.user_in_org(auth.uid(), organization_id)
);

-- Users can insert chart of accounts in their organization
DROP POLICY IF EXISTS "Users can insert platform integration chart of accounts in their org" ON public.platform_integration_chart_of_accounts;
CREATE POLICY "Users can insert platform integration chart of accounts in their org"
ON public.platform_integration_chart_of_accounts FOR INSERT
WITH CHECK (
    public.user_in_org(auth.uid(), organization_id)
);

-- Users can update chart of accounts in their organization
DROP POLICY IF EXISTS "Users can update platform integration chart of accounts in their org" ON public.platform_integration_chart_of_accounts;
CREATE POLICY "Users can update platform integration chart of accounts in their org"
ON public.platform_integration_chart_of_accounts FOR UPDATE
USING (
    public.user_in_org(auth.uid(), organization_id)
)
WITH CHECK (
    public.user_in_org(auth.uid(), organization_id)
);

-- Users can delete chart of accounts in their organization
DROP POLICY IF EXISTS "Users can delete platform integration chart of accounts in their org" ON public.platform_integration_chart_of_accounts;
CREATE POLICY "Users can delete platform integration chart of accounts in their org"
ON public.platform_integration_chart_of_accounts FOR DELETE
USING (
    public.user_in_org(auth.uid(), organization_id)
);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_platform_integration_chart_of_accounts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at
DROP TRIGGER IF EXISTS update_platform_integration_chart_of_accounts_updated_at ON public.platform_integration_chart_of_accounts;
CREATE TRIGGER update_platform_integration_chart_of_accounts_updated_at
    BEFORE UPDATE ON public.platform_integration_chart_of_accounts
    FOR EACH ROW
    EXECUTE FUNCTION update_platform_integration_chart_of_accounts_updated_at();
