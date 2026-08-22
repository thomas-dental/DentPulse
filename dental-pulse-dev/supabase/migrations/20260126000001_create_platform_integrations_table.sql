-- Create platform_integrations table
CREATE TABLE IF NOT EXISTS public.platform_integrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Foreign Keys
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    
    -- Platform Details
    platform_name VARCHAR(255) NOT NULL,
    
    -- Authentication Configuration
    client_id VARCHAR(500),
    client_secret VARCHAR(500),
    
    -- Token Management
    access_token TEXT,
    refresh_token TEXT,
    token_expires_at TIMESTAMP WITH TIME ZONE,
    
    -- Connection Status
    is_connected BOOLEAN DEFAULT false,
    last_synced_at TIMESTAMP WITH TIME ZONE,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT platform_integrations_name_not_empty CHECK (length(platform_name) >= 1)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_platform_integrations_organization_id ON public.platform_integrations(organization_id);
CREATE INDEX IF NOT EXISTS idx_platform_integrations_user_id ON public.platform_integrations(user_id);
CREATE INDEX IF NOT EXISTS idx_platform_integrations_platform_name ON public.platform_integrations(platform_name);
CREATE INDEX IF NOT EXISTS idx_platform_integrations_is_connected ON public.platform_integrations(is_connected);

-- Enable RLS
ALTER TABLE public.platform_integrations ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Users can view platform integrations in their organization
DROP POLICY IF EXISTS "Users can view platform integrations in their org" ON public.platform_integrations;
CREATE POLICY "Users can view platform integrations in their org"
ON public.platform_integrations FOR SELECT
USING (
  public.user_in_org(auth.uid(), organization_id)
);

-- Users can insert platform integrations in their organization
DROP POLICY IF EXISTS "Users can insert platform integrations in their org" ON public.platform_integrations;
CREATE POLICY "Users can insert platform integrations in their org"
ON public.platform_integrations FOR INSERT
WITH CHECK (
  public.user_in_org(auth.uid(), organization_id)
);

-- Users can update platform integrations in their organization
DROP POLICY IF EXISTS "Users can update platform integrations in their org" ON public.platform_integrations;
CREATE POLICY "Users can update platform integrations in their org"
ON public.platform_integrations FOR UPDATE
USING (
  public.user_in_org(auth.uid(), organization_id)
)
WITH CHECK (
  public.user_in_org(auth.uid(), organization_id)
);

-- Users can delete platform integrations in their organization
DROP POLICY IF EXISTS "Users can delete platform integrations in their org" ON public.platform_integrations;
CREATE POLICY "Users can delete platform integrations in their org"
ON public.platform_integrations FOR DELETE
USING (
  public.user_in_org(auth.uid(), organization_id)
);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_platform_integrations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at
DROP TRIGGER IF EXISTS update_platform_integrations_updated_at ON public.platform_integrations;
CREATE TRIGGER update_platform_integrations_updated_at
    BEFORE UPDATE ON public.platform_integrations
    FOR EACH ROW
    EXECUTE FUNCTION update_platform_integrations_updated_at();
