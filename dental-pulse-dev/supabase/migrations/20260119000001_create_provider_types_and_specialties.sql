-- Create provider_types table
CREATE TABLE IF NOT EXISTS public.provider_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    
    -- Provider Type Details
    name VARCHAR(100) NOT NULL, -- e.g., "Associate Dentist", "Dental Therapist", "Dental Hygienist"
    code VARCHAR(50) NOT NULL, -- e.g., "associate", "therapist", "hygienist"
    description TEXT,
    
    -- Status
    is_active BOOLEAN DEFAULT true,
    display_order INTEGER DEFAULT 0, -- For ordering in dropdowns
    
    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    
    CONSTRAINT provider_types_name_not_empty CHECK (length(name) >= 2),
    CONSTRAINT provider_types_code_not_empty CHECK (length(code) >= 2),
    CONSTRAINT provider_types_org_code_unique UNIQUE (organization_id, code)
);

-- Create specialties table
CREATE TABLE IF NOT EXISTS public.specialties (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    
    -- Specialty Details
    name VARCHAR(100) NOT NULL, -- e.g., "General", "Implants", "Orthodontics"
    code VARCHAR(50), -- Optional short code
    description TEXT,
    
    -- Provider Type Association (which provider types can use this specialty)
    provider_type_id UUID REFERENCES public.provider_types(id) ON DELETE SET NULL,
    
    -- Status
    is_active BOOLEAN DEFAULT true,
    display_order INTEGER DEFAULT 0, -- For ordering in dropdowns
    
    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    
    CONSTRAINT specialties_name_not_empty CHECK (length(name) >= 2)
);

-- Create indexes for provider_types
CREATE INDEX idx_provider_types_organization_id ON public.provider_types(organization_id);
CREATE INDEX idx_provider_types_deleted_at ON public.provider_types(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_provider_types_is_active ON public.provider_types(is_active);
CREATE INDEX idx_provider_types_code ON public.provider_types(code);

-- Create indexes for specialties
CREATE INDEX idx_specialties_organization_id ON public.specialties(organization_id);
CREATE INDEX idx_specialties_provider_type_id ON public.specialties(provider_type_id);
CREATE INDEX idx_specialties_deleted_at ON public.specialties(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_specialties_is_active ON public.specialties(is_active);

-- Enable RLS
ALTER TABLE public.provider_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.specialties ENABLE ROW LEVEL SECURITY;

-- Provider Types RLS Policies
CREATE POLICY "Users can view provider types in their org"
ON public.provider_types FOR SELECT
USING (
  public.user_in_org(auth.uid(), organization_id) AND 
  (deleted_at IS NULL)
);

CREATE POLICY "Owners and admins can insert provider types"
ON public.provider_types FOR INSERT
WITH CHECK (
  public.has_org_role(auth.uid(), organization_id, 'owner'::app_role) OR 
  public.has_org_role(auth.uid(), organization_id, 'admin'::app_role)
);

CREATE POLICY "Owners and admins can update provider types"
ON public.provider_types FOR UPDATE
USING (
  public.has_org_role(auth.uid(), organization_id, 'owner'::app_role) OR 
  public.has_org_role(auth.uid(), organization_id, 'admin'::app_role)
)
WITH CHECK (
  public.has_org_role(auth.uid(), organization_id, 'owner'::app_role) OR 
  public.has_org_role(auth.uid(), organization_id, 'admin'::app_role)
);

CREATE POLICY "Owners and admins can delete provider types"
ON public.provider_types FOR DELETE
USING (
  public.has_org_role(auth.uid(), organization_id, 'owner'::app_role) OR 
  public.has_org_role(auth.uid(), organization_id, 'admin'::app_role)
);

-- Specialties RLS Policies
CREATE POLICY "Users can view specialties in their org"
ON public.specialties FOR SELECT
USING (
  public.user_in_org(auth.uid(), organization_id) AND 
  (deleted_at IS NULL)
);

CREATE POLICY "Owners and admins can insert specialties"
ON public.specialties FOR INSERT
WITH CHECK (
  public.has_org_role(auth.uid(), organization_id, 'owner'::app_role) OR 
  public.has_org_role(auth.uid(), organization_id, 'admin'::app_role)
);

CREATE POLICY "Owners and admins can update specialties"
ON public.specialties FOR UPDATE
USING (
  public.has_org_role(auth.uid(), organization_id, 'owner'::app_role) OR 
  public.has_org_role(auth.uid(), organization_id, 'admin'::app_role)
)
WITH CHECK (
  public.has_org_role(auth.uid(), organization_id, 'owner'::app_role) OR 
  public.has_org_role(auth.uid(), organization_id, 'admin'::app_role)
);

CREATE POLICY "Owners and admins can delete specialties"
ON public.specialties FOR DELETE
USING (
  public.has_org_role(auth.uid(), organization_id, 'owner'::app_role) OR 
  public.has_org_role(auth.uid(), organization_id, 'admin'::app_role)
);

-- Trigger function for updated_at
CREATE OR REPLACE FUNCTION public.update_provider_types_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.update_specialties_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
CREATE TRIGGER update_provider_types_updated_at
BEFORE UPDATE ON public.provider_types
FOR EACH ROW
EXECUTE FUNCTION public.update_provider_types_updated_at();

CREATE TRIGGER update_specialties_updated_at
BEFORE UPDATE ON public.specialties
FOR EACH ROW
EXECUTE FUNCTION public.update_specialties_updated_at();

-- Insert default provider types for existing organizations
-- This will be run per organization when needed
-- For now, we'll create a function to initialize default types
CREATE OR REPLACE FUNCTION public.initialize_default_provider_types(_org_id UUID, _user_id UUID)
RETURNS void AS $$
BEGIN
    -- Insert default provider types if they don't exist
    INSERT INTO public.provider_types (organization_id, name, code, description, is_active, display_order, created_by)
    SELECT _org_id, 'Associate Dentist', 'associate', 'Dental associate provider', true, 1, _user_id
    WHERE NOT EXISTS (
        SELECT 1 FROM public.provider_types 
        WHERE organization_id = _org_id AND code = 'associate'
    );
    
    INSERT INTO public.provider_types (organization_id, name, code, description, is_active, display_order, created_by)
    SELECT _org_id, 'Dental Therapist', 'therapist', 'Dental therapist provider', true, 2, _user_id
    WHERE NOT EXISTS (
        SELECT 1 FROM public.provider_types 
        WHERE organization_id = _org_id AND code = 'therapist'
    );
    
    INSERT INTO public.provider_types (organization_id, name, code, description, is_active, display_order, created_by)
    SELECT _org_id, 'Dental Hygienist', 'hygienist', 'Dental hygienist provider', true, 3, _user_id
    WHERE NOT EXISTS (
        SELECT 1 FROM public.provider_types 
        WHERE organization_id = _org_id AND code = 'hygienist'
    );
END;
$$ LANGUAGE plpgsql;

-- Insert default specialties for existing organizations
CREATE OR REPLACE FUNCTION public.initialize_default_specialties(_org_id UUID, _user_id UUID)
RETURNS void AS $$
DECLARE
    _associate_type_id UUID;
BEGIN
    -- Get associate provider type ID
    SELECT id INTO _associate_type_id
    FROM public.provider_types
    WHERE organization_id = _org_id AND code = 'associate'
    LIMIT 1;
    
    -- Insert default specialties if they don't exist
    INSERT INTO public.specialties (organization_id, name, code, description, provider_type_id, is_active, display_order, created_by)
    VALUES
        (_org_id, 'General', 'general', 'General dentistry', _associate_type_id, true, 1, _user_id),
        (_org_id, 'Implants', 'implants', 'Dental implants', _associate_type_id, true, 2, _user_id),
        (_org_id, 'Orthodontics', 'orthodontics', 'Orthodontic treatment', _associate_type_id, true, 3, _user_id),
        (_org_id, 'Cosmetic', 'cosmetic', 'Cosmetic dentistry', _associate_type_id, true, 4, _user_id),
        (_org_id, 'Endodontics', 'endodontics', 'Root canal treatment', _associate_type_id, true, 5, _user_id),
        (_org_id, 'Periodontics', 'periodontics', 'Gum disease treatment', _associate_type_id, true, 6, _user_id),
        (_org_id, 'Oral Surgery', 'oral_surgery', 'Oral and maxillofacial surgery', _associate_type_id, true, 7, _user_id),
        (_org_id, 'Pediatric', 'pediatric', 'Pediatric dentistry', _associate_type_id, true, 8, _user_id)
    ON CONFLICT DO NOTHING;
END;
$$ LANGUAGE plpgsql;
