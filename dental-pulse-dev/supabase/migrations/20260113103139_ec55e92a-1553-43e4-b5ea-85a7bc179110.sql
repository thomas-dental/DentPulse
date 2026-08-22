-- Allow users to insert their own initial owner role during onboarding
-- This is safe because they can only set their own user_id and must be the org creator

CREATE POLICY "Users can create their own initial role"
ON public.user_roles
FOR INSERT
WITH CHECK (
  auth.uid() = user_id 
  AND EXISTS (
    SELECT 1 FROM public.organizations 
    WHERE id = organization_id 
    AND created_by = auth.uid()
  )
);