-- Create a stored procedure to handle region soft delete with proper security context
CREATE OR REPLACE FUNCTION public.soft_delete_region(
  _region_id UUID,
  _organization_id UUID
)
RETURNS void AS $$
BEGIN
  -- Verify user has permission
  IF NOT (
    public.has_org_role(auth.uid(), _organization_id, 'owner'::app_role) OR 
    public.has_org_role(auth.uid(), _organization_id, 'admin'::app_role)
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions to delete region';
  END IF;

  -- Perform soft delete
  UPDATE public.regions
  SET 
    deleted_at = NOW(),
    updated_by = auth.uid(),
    updated_at = NOW()
  WHERE id = _region_id
  AND organization_id = _organization_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.soft_delete_region(UUID, UUID) TO authenticated;
