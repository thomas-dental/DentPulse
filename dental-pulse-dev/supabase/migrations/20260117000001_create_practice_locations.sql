-- Enable pgcrypto extension for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Create regions table
CREATE TABLE IF NOT EXISTS public.regions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    
    -- Region Details
    name VARCHAR(255) NOT NULL, -- e.g., "South London", "North Manhattan"
    code VARCHAR(50), -- Optional short code
    description TEXT,
    
    -- Status
    is_active BOOLEAN DEFAULT true,
    
    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    
    CONSTRAINT regions_name_not_empty CHECK (length(name) >= 2)
);

-- Create practice_locations table
CREATE TABLE public.practice_locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    region_id UUID REFERENCES public.regions(id),
    
    -- Location Details
    location_name VARCHAR(255) NOT NULL, -- e.g., "London Office", "Downtown Clinic"
    location_code VARCHAR(50), -- Short code for internal reference
    
    -- Contact Information
    email VARCHAR(255),
    phone VARCHAR(20),
    fax VARCHAR(20),
    
    -- Address
    address_line1 VARCHAR(255),
    address_line2 VARCHAR(255),
    city VARCHAR(100),
    state VARCHAR(50),
    postal_code VARCHAR(20),
    country VARCHAR(100) DEFAULT 'USA',
    
    -- Operating Hours (stored as JSONB for flexibility)
    operating_hours JSONB, -- e.g., {"monday": {"open": "09:00", "close": "17:00"}, ...}
    
    -- Location Settings
    timezone VARCHAR(100) DEFAULT 'America/New_York',
    is_primary BOOLEAN DEFAULT false, -- Mark one location as primary
    is_active BOOLEAN DEFAULT true,
    
    -- Notes
    notes TEXT,
    
    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    
    CONSTRAINT practice_locations_name_not_empty CHECK (length(location_name) >= 2)
);

-- Create indexes for practice_locations
CREATE INDEX idx_practice_locations_organization_id ON public.practice_locations(organization_id);
CREATE INDEX idx_practice_locations_region_id ON public.practice_locations(region_id);
CREATE INDEX idx_practice_locations_deleted_at ON public.practice_locations(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_practice_locations_is_active ON public.practice_locations(is_active);
CREATE INDEX idx_practice_locations_is_primary ON public.practice_locations(is_primary);

-- Create indexes for regions
CREATE INDEX idx_regions_organization_id ON public.regions(organization_id);
CREATE INDEX idx_regions_deleted_at ON public.regions(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_regions_is_active ON public.regions(is_active);

-- Enable RLS
ALTER TABLE public.regions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.practice_locations ENABLE ROW LEVEL SECURITY;

-- Regions RLS Policies
CREATE POLICY "Users can view regions in their org"
ON public.regions FOR SELECT
USING (
  public.user_in_org(auth.uid(), organization_id) AND 
  (deleted_at IS NULL)
);

CREATE POLICY "Owners and admins can insert regions"
ON public.regions FOR INSERT
WITH CHECK (
  public.has_org_role(auth.uid(), organization_id, 'owner'::app_role) OR 
  public.has_org_role(auth.uid(), organization_id, 'admin'::app_role)
);

CREATE POLICY "Owners and admins can update regions"
ON public.regions FOR UPDATE
USING (
  public.has_org_role(auth.uid(), organization_id, 'owner'::app_role) OR 
  public.has_org_role(auth.uid(), organization_id, 'admin'::app_role)
)
WITH CHECK (
  public.has_org_role(auth.uid(), organization_id, 'owner'::app_role) OR 
  public.has_org_role(auth.uid(), organization_id, 'admin'::app_role)
);

CREATE POLICY "Owners and admins can delete regions"
ON public.regions FOR DELETE
USING (
  public.has_org_role(auth.uid(), organization_id, 'owner'::app_role) OR 
  public.has_org_role(auth.uid(), organization_id, 'admin'::app_role)
);

-- Practice Locations RLS Policies
CREATE POLICY "Users can view locations in their org"
ON public.practice_locations FOR SELECT
USING (
  public.user_in_org(auth.uid(), organization_id) AND 
  (deleted_at IS NULL)
);

CREATE POLICY "Owners and admins can insert locations"
ON public.practice_locations FOR INSERT
WITH CHECK (
  public.has_org_role(auth.uid(), organization_id, 'owner'::app_role) OR 
  public.has_org_role(auth.uid(), organization_id, 'admin'::app_role)
);

CREATE POLICY "Owners and admins can update locations"
ON public.practice_locations FOR UPDATE
USING (
  public.has_org_role(auth.uid(), organization_id, 'owner'::app_role) OR 
  public.has_org_role(auth.uid(), organization_id, 'admin'::app_role)
);

CREATE POLICY "Owners and admins can delete locations"
ON public.practice_locations FOR DELETE
USING (
  public.has_org_role(auth.uid(), organization_id, 'owner'::app_role) OR 
  public.has_org_role(auth.uid(), organization_id, 'admin'::app_role)
);

-- Trigger function for updated_at (if not exists)
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
CREATE TRIGGER update_regions_updated_at
BEFORE UPDATE ON public.regions
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_practice_locations_updated_at
BEFORE UPDATE ON public.practice_locations
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Function to ensure only one primary location per organization
CREATE OR REPLACE FUNCTION public.ensure_single_primary_location()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.is_primary = true THEN
        -- Unset other primary locations in the same organization
        UPDATE public.practice_locations
        SET is_primary = false
        WHERE organization_id = NEW.organization_id
          AND id != NEW.id
          AND is_primary = true
          AND deleted_at IS NULL;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to ensure single primary location
CREATE TRIGGER ensure_single_primary_location_trigger
BEFORE INSERT OR UPDATE ON public.practice_locations
FOR EACH ROW
WHEN (NEW.is_primary = true)
EXECUTE FUNCTION public.ensure_single_primary_location();
