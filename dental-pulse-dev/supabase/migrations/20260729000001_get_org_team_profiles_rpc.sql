-- Team Management shows "Unnamed User" for any org member whose profiles row
-- the viewer cannot read: profiles deliberately has no cross-user SELECT policy
-- (see 20260618000001), and the org creator never gets a team_members fallback
-- row because they are never "invited". This SECURITY DEFINER RPC returns the
-- minimal directory fields (name/email/avatar) for one organization's members,
-- and only to callers who belong to that organization themselves.

CREATE OR REPLACE FUNCTION public.get_org_team_profiles(_organization_id UUID)
RETURNS TABLE (user_id UUID, email TEXT, full_name TEXT, avatar_url TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.user_id, p.email, p.full_name, p.avatar_url
  FROM public.profiles p
  WHERE
    -- Caller must belong to the org: member via user_roles, or org owner/creator
    (
      public.user_in_org(auth.uid(), _organization_id)
      OR EXISTS (
        SELECT 1 FROM public.organizations o
        WHERE o.id = _organization_id
          AND (o.user_id = auth.uid() OR o.created_by = auth.uid())
      )
    )
    -- Only expose profiles of that same org's members (never other tenants)
    AND (
      EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = p.user_id AND ur.organization_id = _organization_id
      )
      OR EXISTS (
        SELECT 1 FROM public.organizations o
        WHERE o.id = _organization_id
          AND (o.user_id = p.user_id OR o.created_by = p.user_id)
      )
    );
$$;

REVOKE ALL ON FUNCTION public.get_org_team_profiles(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_org_team_profiles(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_org_team_profiles(UUID) TO authenticated;
