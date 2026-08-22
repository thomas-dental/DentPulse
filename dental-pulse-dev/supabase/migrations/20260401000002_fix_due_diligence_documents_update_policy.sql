-- Fix UPDATE policy: allow org members to update (soft-delete) documents, not just the uploader
DROP POLICY IF EXISTS "Users can update their own due diligence documents" ON public.due_diligence_documents;

CREATE POLICY "Org members can update due diligence documents"
  ON public.due_diligence_documents
  FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM public.user_roles WHERE user_id = auth.uid()
    )
    OR organization_id IN (
      SELECT id FROM public.organizations WHERE user_id = auth.uid() OR created_by = auth.uid()
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.user_roles WHERE user_id = auth.uid()
    )
    OR organization_id IN (
      SELECT id FROM public.organizations WHERE user_id = auth.uid() OR created_by = auth.uid()
    )
  );
