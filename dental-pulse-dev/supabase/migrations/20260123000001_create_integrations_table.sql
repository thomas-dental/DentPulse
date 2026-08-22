-- Create integrations table
CREATE TABLE IF NOT EXISTS public.integrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    
    -- Integration Details
    integration_name VARCHAR(255) NOT NULL,
    integration_description TEXT,
    is_connected BOOLEAN DEFAULT false,
    
    -- API Configuration (required fields)
    api_endpoints VARCHAR(500) NOT NULL,
    api_key VARCHAR(500) NOT NULL,
    secret_key_id_available VARCHAR(500), -- Optional secret key or ID
    
    -- Sync Configuration
    sync_frequency VARCHAR(50), -- e.g., "15min", "1hour", "daily"
    sync_at TIMESTAMP WITH TIME ZONE, -- Last sync timestamp
    
    -- Data Sync Options (JSONB format)
    data_sync_json JSONB DEFAULT '[]'::jsonb, -- Array of objects: [{label, description, is_sync}]
    
    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    
    CONSTRAINT integrations_name_not_empty CHECK (length(integration_name) >= 2),
    CONSTRAINT integrations_api_endpoints_not_empty CHECK (length(api_endpoints) >= 5),
    CONSTRAINT integrations_api_key_not_empty CHECK (length(api_key) >= 1)
);

-- Create indexes
CREATE INDEX idx_integrations_organization_id ON public.integrations(organization_id);
CREATE INDEX idx_integrations_deleted_at ON public.integrations(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_integrations_is_connected ON public.integrations(is_connected);
CREATE INDEX idx_integrations_name ON public.integrations(integration_name);

-- Enable RLS
ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view integrations in their org"
ON public.integrations FOR SELECT
USING (
  public.user_in_org(auth.uid(), organization_id) AND 
  (deleted_at IS NULL)
);

CREATE POLICY "Owners and admins can insert integrations"
ON public.integrations FOR INSERT
WITH CHECK (
  public.has_org_role(auth.uid(), organization_id, 'owner'::app_role) OR 
  public.has_org_role(auth.uid(), organization_id, 'admin'::app_role)
);

CREATE POLICY "Owners and admins can update integrations"
ON public.integrations FOR UPDATE
USING (
  public.has_org_role(auth.uid(), organization_id, 'owner'::app_role) OR 
  public.has_org_role(auth.uid(), organization_id, 'admin'::app_role)
)
WITH CHECK (
  public.has_org_role(auth.uid(), organization_id, 'owner'::app_role) OR 
  public.has_org_role(auth.uid(), organization_id, 'admin'::app_role)
);

CREATE POLICY "Owners and admins can delete integrations"
ON public.integrations FOR DELETE
USING (
  public.has_org_role(auth.uid(), organization_id, 'owner'::app_role) OR 
  public.has_org_role(auth.uid(), organization_id, 'admin'::app_role)
);

-- Trigger for updated_at
CREATE TRIGGER update_integrations_updated_at
BEFORE UPDATE ON public.integrations
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
