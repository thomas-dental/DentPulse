-- Create helper functions for RLS if they don't exist
-- Function to check if user is in an organization
CREATE OR REPLACE FUNCTION public.user_in_org(_user_id UUID, _organization_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 
        FROM public.user_roles 
        WHERE user_id = _user_id 
        AND organization_id = _organization_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check if user has a specific role in an organization
CREATE OR REPLACE FUNCTION public.has_org_role(_user_id UUID, _organization_id UUID, _role app_role)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 
        FROM public.user_roles 
        WHERE user_id = _user_id 
        AND organization_id = _organization_id
        AND role = _role
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop existing policies on provider_types if they exist
DROP POLICY IF EXISTS "Users can view provider types in their org" ON public.provider_types;
DROP POLICY IF EXISTS "Owners and admins can insert provider types" ON public.provider_types;
DROP POLICY IF EXISTS "Owners and admins can update provider types" ON public.provider_types;
DROP POLICY IF EXISTS "Owners and admins can delete provider types" ON public.provider_types;

-- Recreate Provider Types RLS Policies with correct function calls
CREATE POLICY "Users can view provider types in their org"
ON public.provider_types FOR SELECT
USING (
  public.user_in_org(auth.uid(), organization_id) AND 
  (deleted_at IS NULL)
);

CREATE POLICY "Owners and admins can insert provider types"
ON public.provider_types FOR INSERT
WITH CHECK (
  auth.uid() IS NOT NULL AND
  organization_id IS NOT NULL AND
  (
    public.has_org_role(auth.uid(), organization_id, 'owner'::app_role) OR 
    public.has_org_role(auth.uid(), organization_id, 'admin'::app_role)
  )
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

-- Drop existing policies on specialties if they exist
DROP POLICY IF EXISTS "Users can view specialties in their org" ON public.specialties;
DROP POLICY IF EXISTS "Owners and admins can insert specialties" ON public.specialties;
DROP POLICY IF EXISTS "Owners and admins can update specialties" ON public.specialties;
DROP POLICY IF EXISTS "Owners and admins can delete specialties" ON public.specialties;

-- Recreate Specialties RLS Policies with correct function calls
CREATE POLICY "Users can view specialties in their org"
ON public.specialties FOR SELECT
USING (
  public.user_in_org(auth.uid(), organization_id) AND 
  (deleted_at IS NULL)
);

CREATE POLICY "Owners and admins can insert specialties"
ON public.specialties FOR INSERT
WITH CHECK (
  auth.uid() IS NOT NULL AND
  organization_id IS NOT NULL AND
  (
    public.has_org_role(auth.uid(), organization_id, 'owner'::app_role) OR 
    public.has_org_role(auth.uid(), organization_id, 'admin'::app_role)
  )
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
