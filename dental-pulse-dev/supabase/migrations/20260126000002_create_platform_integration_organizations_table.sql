-- Create platform_integration_organizations table
CREATE TABLE IF NOT EXISTS public.platform_integration_organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Foreign Keys
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    platform_integration_id UUID NOT NULL REFERENCES public.platform_integrations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    -- Platform Details
    platform_name VARCHAR(255) NOT NULL,
    
    -- Organization Details
    platform_org_id VARCHAR(255) NOT NULL, -- tenant_id / company_id / practice_id
    platform_org_name VARCHAR(500),
    platform_org_code VARCHAR(100),
    
    -- Contact & Location Info
    email VARCHAR(255),
    country VARCHAR(100),
    currency VARCHAR(10),
    timezone VARCHAR(100),
    
    -- Status
    status VARCHAR(50) DEFAULT 'active',
    is_selected BOOLEAN DEFAULT false,
    
    -- Additional Data
    raw_data JSONB,
    meta_data JSONB,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT platform_integration_orgs_name_not_empty CHECK (length(platform_name) >= 1),
    CONSTRAINT platform_integration_orgs_org_id_not_empty CHECK (length(platform_org_id) >= 1),
    CONSTRAINT platform_integration_orgs_status_valid CHECK (status IN ('active', 'inactive', 'suspended', 'pending'))
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_platform_integration_orgs_organization_id ON public.platform_integration_organizations(organization_id);
CREATE INDEX IF NOT EXISTS idx_platform_integration_orgs_platform_integration_id ON public.platform_integration_organizations(platform_integration_id);
CREATE INDEX IF NOT EXISTS idx_platform_integration_orgs_platform_name ON public.platform_integration_organizations(platform_name);
CREATE INDEX IF NOT EXISTS idx_platform_integration_orgs_platform_org_id ON public.platform_integration_organizations(platform_org_id);
CREATE INDEX IF NOT EXISTS idx_platform_integration_orgs_status ON public.platform_integration_organizations(status);
CREATE INDEX IF NOT EXISTS idx_platform_integration_orgs_is_selected ON public.platform_integration_organizations(is_selected);
CREATE INDEX IF NOT EXISTS idx_platform_integration_orgs_org_platform ON public.platform_integration_organizations(organization_id, platform_integration_id);

-- Unique constraint: One platform_org_id per platform_integration_id
CREATE UNIQUE INDEX idx_platform_integration_orgs_unique_org 
ON public.platform_integration_organizations(platform_integration_id, platform_org_id);

-- Enable RLS
ALTER TABLE public.platform_integration_organizations ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Users can view platform integration organizations in their organization
DROP POLICY IF EXISTS "Users can view platform integration orgs in their org" ON public.platform_integration_organizations;
CREATE POLICY "Users can view platform integration orgs in their org"
ON public.platform_integration_organizations FOR SELECT
USING (
    public.user_in_org(auth.uid(), organization_id)
);

-- Users can insert platform integration organizations in their organization
DROP POLICY IF EXISTS "Users can insert platform integration orgs in their org" ON public.platform_integration_organizations;
CREATE POLICY "Users can insert platform integration orgs in their org"
ON public.platform_integration_organizations FOR INSERT
WITH CHECK (
    public.user_in_org(auth.uid(), organization_id)
);

-- Users can update platform integration organizations in their organization
DROP POLICY IF EXISTS "Users can update platform integration orgs in their org" ON public.platform_integration_organizations;
CREATE POLICY "Users can update platform integration orgs in their org"
ON public.platform_integration_organizations FOR UPDATE
USING (
    public.user_in_org(auth.uid(), organization_id)
)
WITH CHECK (
    public.user_in_org(auth.uid(), organization_id)
);

-- Users can delete platform integration organizations in their organization
DROP POLICY IF EXISTS "Users can delete platform integration orgs in their org" ON public.platform_integration_organizations;
CREATE POLICY "Users can delete platform integration orgs in their org"
ON public.platform_integration_organizations FOR DELETE
USING (
    public.user_in_org(auth.uid(), organization_id)
);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_platform_integration_orgs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at
DROP TRIGGER IF EXISTS update_platform_integration_orgs_updated_at ON public.platform_integration_organizations;
CREATE TRIGGER update_platform_integration_orgs_updated_at
    BEFORE UPDATE ON public.platform_integration_organizations
    FOR EACH ROW
    EXECUTE FUNCTION update_platform_integration_orgs_updated_at();
