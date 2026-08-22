-- Update regions table to match the complete schema
-- Add missing columns if they don't exist

-- Add code column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'regions' 
        AND column_name = 'code'
    ) THEN
        ALTER TABLE public.regions ADD COLUMN code VARCHAR(50);
    END IF;
END $$;

-- Add is_active column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'regions' 
        AND column_name = 'is_active'
    ) THEN
        ALTER TABLE public.regions ADD COLUMN is_active BOOLEAN DEFAULT true;
    END IF;
END $$;

-- Add deleted_at column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'regions' 
        AND column_name = 'deleted_at'
    ) THEN
        ALTER TABLE public.regions ADD COLUMN deleted_at TIMESTAMP WITH TIME ZONE;
    END IF;
END $$;

-- Add updated_by column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'regions' 
        AND column_name = 'updated_by'
    ) THEN
        ALTER TABLE public.regions ADD COLUMN updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
    END IF;
END $$;

-- Add constraint if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'regions_name_not_empty'
    ) THEN
        ALTER TABLE public.regions ADD CONSTRAINT regions_name_not_empty 
        CHECK (length(name) >= 2);
    END IF;
END $$;

-- Drop all existing RLS policies
DROP POLICY IF EXISTS "Users can view regions in their org" ON public.regions;
DROP POLICY IF EXISTS "Owners and admins can manage regions" ON public.regions;
DROP POLICY IF EXISTS "Owners and admins can insert regions" ON public.regions;
DROP POLICY IF EXISTS "Owners and admins can update regions" ON public.regions;
DROP POLICY IF EXISTS "Owners and admins can delete regions" ON public.regions;

-- Create SELECT policy
CREATE POLICY "Users can view regions in their org"
ON public.regions FOR SELECT
USING (
  auth.uid() IS NOT NULL AND
  public.user_in_org(auth.uid(), organization_id) AND 
  deleted_at IS NULL
);

-- Create INSERT policy
CREATE POLICY "Owners and admins can insert regions"
ON public.regions FOR INSERT
WITH CHECK (
  auth.uid() IS NOT NULL AND (
    public.has_org_role(auth.uid(), organization_id, 'owner'::app_role) OR 
    public.has_org_role(auth.uid(), organization_id, 'admin'::app_role)
  )
);

-- Create UPDATE policy - allow owners/admins to update (including for soft deletes)
CREATE POLICY "Owners and admins can update regions"
ON public.regions FOR UPDATE
USING (
  auth.uid() IS NOT NULL AND (
    public.has_org_role(auth.uid(), organization_id, 'owner'::app_role) OR 
    public.has_org_role(auth.uid(), organization_id, 'admin'::app_role)
  )
)
WITH CHECK (
  auth.uid() IS NOT NULL AND
  organization_id IS NOT NULL AND (
    public.has_org_role(auth.uid(), organization_id, 'owner'::app_role) OR 
    public.has_org_role(auth.uid(), organization_id, 'admin'::app_role)
  )
);

-- Create DELETE policy
CREATE POLICY "Owners and admins can delete regions"
ON public.regions FOR DELETE
USING (
  auth.uid() IS NOT NULL AND (
    public.has_org_role(auth.uid(), organization_id, 'owner'::app_role) OR 
    public.has_org_role(auth.uid(), organization_id, 'admin'::app_role)
  )
);

-- Create indexes if they don't exist
CREATE INDEX IF NOT EXISTS idx_regions_organization_id ON public.regions(organization_id);
CREATE INDEX IF NOT EXISTS idx_regions_deleted_at ON public.regions(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_regions_is_active ON public.regions(is_active);