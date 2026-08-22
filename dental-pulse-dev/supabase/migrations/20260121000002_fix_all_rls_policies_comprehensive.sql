-- Comprehensive RLS Policy Fix for All Tables
-- This migration ensures all tables have proper RLS policies with correct helper function usage

-- Step 1: Ensure helper functions exist and are correct
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

-- Step 2: Enable RLS on providers table if not already enabled
ALTER TABLE public.providers ENABLE ROW LEVEL SECURITY;

-- Step 3: Drop all existing policies on providers table
DROP POLICY IF EXISTS "Users can view providers in their org" ON public.providers;
DROP POLICY IF EXISTS "Owners and admins can insert providers" ON public.providers;
DROP POLICY IF EXISTS "Owners and admins can update providers" ON public.providers;
DROP POLICY IF EXISTS "Owners and admins can delete providers" ON public.providers;
DROP POLICY IF EXISTS "Users can manage providers in their org" ON public.providers;

-- Step 4: Create providers RLS policies
CREATE POLICY "Users can view providers in their org"
ON public.providers FOR SELECT
USING (
  auth.uid() IS NOT NULL AND
  organization_id IS NOT NULL AND
  public.user_in_org(auth.uid(), organization_id)
);

CREATE POLICY "Owners and admins can insert providers"
ON public.providers FOR INSERT
WITH CHECK (
  auth.uid() IS NOT NULL AND
  organization_id IS NOT NULL AND
  (
    public.has_org_role(auth.uid(), organization_id, 'owner'::app_role) OR 
    public.has_org_role(auth.uid(), organization_id, 'admin'::app_role)
  )
);

CREATE POLICY "Owners and admins can update providers"
ON public.providers FOR UPDATE
USING (
  auth.uid() IS NOT NULL AND
  organization_id IS NOT NULL AND
  (
    public.has_org_role(auth.uid(), organization_id, 'owner'::app_role) OR 
    public.has_org_role(auth.uid(), organization_id, 'admin'::app_role)
  )
)
WITH CHECK (
  auth.uid() IS NOT NULL AND
  organization_id IS NOT NULL AND
  (
    public.has_org_role(auth.uid(), organization_id, 'owner'::app_role) OR 
    public.has_org_role(auth.uid(), organization_id, 'admin'::app_role)
  )
);

CREATE POLICY "Owners and admins can delete providers"
ON public.providers FOR DELETE
USING (
  auth.uid() IS NOT NULL AND
  organization_id IS NOT NULL AND
  (
    public.has_org_role(auth.uid(), organization_id, 'owner'::app_role) OR 
    public.has_org_role(auth.uid(), organization_id, 'admin'::app_role)
  )
);

-- Step 5: Fix provider_types RLS policies (drop and recreate)
DROP POLICY IF EXISTS "Users can view provider types in their org" ON public.provider_types;
DROP POLICY IF EXISTS "Owners and admins can insert provider types" ON public.provider_types;
DROP POLICY IF EXISTS "Owners and admins can update provider types" ON public.provider_types;
DROP POLICY IF EXISTS "Owners and admins can delete provider types" ON public.provider_types;

CREATE POLICY "Users can view provider types in their org"
ON public.provider_types FOR SELECT
USING (
  auth.uid() IS NOT NULL AND
  organization_id IS NOT NULL AND
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
  auth.uid() IS NOT NULL AND
  organization_id IS NOT NULL AND
  (
    public.has_org_role(auth.uid(), organization_id, 'owner'::app_role) OR 
    public.has_org_role(auth.uid(), organization_id, 'admin'::app_role)
  )
)
WITH CHECK (
  auth.uid() IS NOT NULL AND
  organization_id IS NOT NULL AND
  (
    public.has_org_role(auth.uid(), organization_id, 'owner'::app_role) OR 
    public.has_org_role(auth.uid(), organization_id, 'admin'::app_role)
  )
);

CREATE POLICY "Owners and admins can delete provider types"
ON public.provider_types FOR DELETE
USING (
  auth.uid() IS NOT NULL AND
  organization_id IS NOT NULL AND
  (
    public.has_org_role(auth.uid(), organization_id, 'owner'::app_role) OR 
    public.has_org_role(auth.uid(), organization_id, 'admin'::app_role)
  )
);

-- Step 6: Fix specialties RLS policies (drop and recreate)
DROP POLICY IF EXISTS "Users can view specialties in their org" ON public.specialties;
DROP POLICY IF EXISTS "Owners and admins can insert specialties" ON public.specialties;
DROP POLICY IF EXISTS "Owners and admins can update specialties" ON public.specialties;
DROP POLICY IF EXISTS "Owners and admins can delete specialties" ON public.specialties;

CREATE POLICY "Users can view specialties in their org"
ON public.specialties FOR SELECT
USING (
  auth.uid() IS NOT NULL AND
  organization_id IS NOT NULL AND
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
  auth.uid() IS NOT NULL AND
  organization_id IS NOT NULL AND
  (
    public.has_org_role(auth.uid(), organization_id, 'owner'::app_role) OR 
    public.has_org_role(auth.uid(), organization_id, 'admin'::app_role)
  )
)
WITH CHECK (
  auth.uid() IS NOT NULL AND
  organization_id IS NOT NULL AND
  (
    public.has_org_role(auth.uid(), organization_id, 'owner'::app_role) OR 
    public.has_org_role(auth.uid(), organization_id, 'admin'::app_role)
  )
);

CREATE POLICY "Owners and admins can delete specialties"
ON public.specialties FOR DELETE
USING (
  auth.uid() IS NOT NULL AND
  organization_id IS NOT NULL AND
  (
    public.has_org_role(auth.uid(), organization_id, 'owner'::app_role) OR 
    public.has_org_role(auth.uid(), organization_id, 'admin'::app_role)
  )
);

-- Step 7: Fix regions RLS policies (drop and recreate)
DROP POLICY IF EXISTS "Users can view regions in their org" ON public.regions;
DROP POLICY IF EXISTS "Owners and admins can insert regions" ON public.regions;
DROP POLICY IF EXISTS "Owners and admins can update regions" ON public.regions;
DROP POLICY IF EXISTS "Owners and admins can delete regions" ON public.regions;

CREATE POLICY "Users can view regions in their org"
ON public.regions FOR SELECT
USING (
  auth.uid() IS NOT NULL AND
  organization_id IS NOT NULL AND
  public.user_in_org(auth.uid(), organization_id) AND 
  (deleted_at IS NULL)
);

CREATE POLICY "Owners and admins can insert regions"
ON public.regions FOR INSERT
WITH CHECK (
  auth.uid() IS NOT NULL AND
  organization_id IS NOT NULL AND
  (
    public.has_org_role(auth.uid(), organization_id, 'owner'::app_role) OR 
    public.has_org_role(auth.uid(), organization_id, 'admin'::app_role)
  )
);

CREATE POLICY "Owners and admins can update regions"
ON public.regions FOR UPDATE
USING (
  auth.uid() IS NOT NULL AND
  organization_id IS NOT NULL AND
  (
    public.has_org_role(auth.uid(), organization_id, 'owner'::app_role) OR 
    public.has_org_role(auth.uid(), organization_id, 'admin'::app_role)
  )
)
WITH CHECK (
  auth.uid() IS NOT NULL AND
  organization_id IS NOT NULL AND
  (
    public.has_org_role(auth.uid(), organization_id, 'owner'::app_role) OR 
    public.has_org_role(auth.uid(), organization_id, 'admin'::app_role)
  )
);

CREATE POLICY "Owners and admins can delete regions"
ON public.regions FOR DELETE
USING (
  auth.uid() IS NOT NULL AND
  organization_id IS NOT NULL AND
  (
    public.has_org_role(auth.uid(), organization_id, 'owner'::app_role) OR 
    public.has_org_role(auth.uid(), organization_id, 'admin'::app_role)
  )
);

-- Step 8: Fix practice_locations RLS policies (drop and recreate)
DROP POLICY IF EXISTS "Users can view locations in their org" ON public.practice_locations;
DROP POLICY IF EXISTS "Owners and admins can insert locations" ON public.practice_locations;
DROP POLICY IF EXISTS "Owners and admins can update locations" ON public.practice_locations;
DROP POLICY IF EXISTS "Owners and admins can delete locations" ON public.practice_locations;

CREATE POLICY "Users can view locations in their org"
ON public.practice_locations FOR SELECT
USING (
  auth.uid() IS NOT NULL AND
  organization_id IS NOT NULL AND
  public.user_in_org(auth.uid(), organization_id) AND 
  (deleted_at IS NULL)
);

CREATE POLICY "Owners and admins can insert locations"
ON public.practice_locations FOR INSERT
WITH CHECK (
  auth.uid() IS NOT NULL AND
  organization_id IS NOT NULL AND
  (
    public.has_org_role(auth.uid(), organization_id, 'owner'::app_role) OR 
    public.has_org_role(auth.uid(), organization_id, 'admin'::app_role)
  )
);

CREATE POLICY "Owners and admins can update locations"
ON public.practice_locations FOR UPDATE
USING (
  auth.uid() IS NOT NULL AND
  organization_id IS NOT NULL AND
  (
    public.has_org_role(auth.uid(), organization_id, 'owner'::app_role) OR 
    public.has_org_role(auth.uid(), organization_id, 'admin'::app_role)
  )
)
WITH CHECK (
  auth.uid() IS NOT NULL AND
  organization_id IS NOT NULL AND
  (
    public.has_org_role(auth.uid(), organization_id, 'owner'::app_role) OR 
    public.has_org_role(auth.uid(), organization_id, 'admin'::app_role)
  )
);

CREATE POLICY "Owners and admins can delete locations"
ON public.practice_locations FOR DELETE
USING (
  auth.uid() IS NOT NULL AND
  organization_id IS NOT NULL AND
  (
    public.has_org_role(auth.uid(), organization_id, 'owner'::app_role) OR 
    public.has_org_role(auth.uid(), organization_id, 'admin'::app_role)
  )
);
