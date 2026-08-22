-- Add RLS policies for organizations table if they don't exist
-- This ensures users can update their organization's income mapping fields

-- Enable RLS on organizations table if not already enabled
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (to avoid conflicts)
DROP POLICY IF EXISTS "Users can view organizations in their org" ON public.organizations;
DROP POLICY IF EXISTS "Users can update organizations in their org" ON public.organizations;
DROP POLICY IF EXISTS "Owners and admins can update organizations" ON public.organizations;

-- Policy for SELECT: Users can view organizations they belong to
CREATE POLICY "Users can view organizations in their org"
ON public.organizations FOR SELECT
USING (
  auth.uid() IS NOT NULL AND
  (
    -- User is in the organization via user_roles
    public.user_in_org(auth.uid(), id) OR
    -- User created the organization
    created_by = auth.uid() OR
    -- User is the owner via user_id
    user_id = auth.uid()
  )
);

-- Policy for UPDATE: Users can update organizations they belong to
CREATE POLICY "Users can update organizations in their org"
ON public.organizations FOR UPDATE
USING (
  auth.uid() IS NOT NULL AND
  (
    -- User is in the organization via user_roles
    public.user_in_org(auth.uid(), id) OR
    -- User created the organization
    created_by = auth.uid() OR
    -- User is the owner via user_id
    user_id = auth.uid()
  )
)
WITH CHECK (
  auth.uid() IS NOT NULL AND
  (
    -- User is in the organization via user_roles
    public.user_in_org(auth.uid(), id) OR
    -- User created the organization
    created_by = auth.uid() OR
    -- User is the owner via user_id
    user_id = auth.uid()
  )
);
