-- Create platform_integration_organization_mapping table
CREATE TABLE IF NOT EXISTS public.platform_integration_organization_mapping (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Foreign Keys
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    location_id UUID NOT NULL REFERENCES public.practice_locations(id) ON DELETE CASCADE,
    platform_integration_organizations_id UUID NOT NULL REFERENCES public.platform_integration_organizations(id) ON DELETE CASCADE,
    platform_integration_id UUID NOT NULL REFERENCES public.platform_integrations(id) ON DELETE CASCADE,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT platform_integration_org_mapping_unique UNIQUE (location_id, platform_integration_organizations_id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_platform_integration_org_mapping_organization_id ON public.platform_integration_organization_mapping(organization_id);
CREATE INDEX IF NOT EXISTS idx_platform_integration_org_mapping_user_id ON public.platform_integration_organization_mapping(user_id);
CREATE INDEX IF NOT EXISTS idx_platform_integration_org_mapping_location_id ON public.platform_integration_organization_mapping(location_id);
CREATE INDEX IF NOT EXISTS idx_platform_integration_org_mapping_platform_integration_orgs_id ON public.platform_integration_organization_mapping(platform_integration_organizations_id);
CREATE INDEX IF NOT EXISTS idx_platform_integration_org_mapping_platform_integration_id ON public.platform_integration_organization_mapping(platform_integration_id);
CREATE INDEX IF NOT EXISTS idx_platform_integration_org_mapping_location_org ON public.platform_integration_organization_mapping(location_id, platform_integration_organizations_id);

-- Enable RLS
ALTER TABLE public.platform_integration_organization_mapping ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Users can view mappings in their organization
DROP POLICY IF EXISTS "Users can view platform integration org mappings in their org" ON public.platform_integration_organization_mapping;
CREATE POLICY "Users can view platform integration org mappings in their org"
ON public.platform_integration_organization_mapping FOR SELECT
USING (
    public.user_in_org(auth.uid(), organization_id)
);

-- Users can insert mappings in their organization
DROP POLICY IF EXISTS "Users can insert platform integration org mappings in their org" ON public.platform_integration_organization_mapping;
CREATE POLICY "Users can insert platform integration org mappings in their org"
ON public.platform_integration_organization_mapping FOR INSERT
WITH CHECK (
    public.user_in_org(auth.uid(), organization_id)
);

-- Users can update mappings in their organization
DROP POLICY IF EXISTS "Users can update platform integration org mappings in their org" ON public.platform_integration_organization_mapping;
CREATE POLICY "Users can update platform integration org mappings in their org"
ON public.platform_integration_organization_mapping FOR UPDATE
USING (
    public.user_in_org(auth.uid(), organization_id)
)
WITH CHECK (
    public.user_in_org(auth.uid(), organization_id)
);

-- Users can delete mappings in their organization
DROP POLICY IF EXISTS "Users can delete platform integration org mappings in their org" ON public.platform_integration_organization_mapping;
CREATE POLICY "Users can delete platform integration org mappings in their org"
ON public.platform_integration_organization_mapping FOR DELETE
USING (
    public.user_in_org(auth.uid(), organization_id)
);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_platform_integration_org_mapping_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at
DROP TRIGGER IF EXISTS update_platform_integration_org_mapping_updated_at ON public.platform_integration_organization_mapping;
CREATE TRIGGER update_platform_integration_org_mapping_updated_at
    BEFORE UPDATE ON public.platform_integration_organization_mapping
    FOR EACH ROW
    EXECUTE FUNCTION update_platform_integration_org_mapping_updated_at();
