-- Due Diligence Document Vault
-- Stores uploaded documents tagged by category, scoped to org/location/user
CREATE TABLE IF NOT EXISTS public.due_diligence_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  location_id UUID REFERENCES public.practice_locations(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size BIGINT,
  file_type TEXT,
  document_tag TEXT NOT NULL CHECK (document_tag IN (
    'xero-export', 'associate-contracts', 'nhs-reports', 'lab-invoices', 'bank-statements'
  )),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_dd_docs_org_id ON public.due_diligence_documents(organization_id);
CREATE INDEX IF NOT EXISTS idx_dd_docs_location_id ON public.due_diligence_documents(location_id);
CREATE INDEX IF NOT EXISTS idx_dd_docs_tag ON public.due_diligence_documents(organization_id, document_tag);
CREATE INDEX IF NOT EXISTS idx_dd_docs_created ON public.due_diligence_documents(created_at DESC);

-- Enable RLS
ALTER TABLE public.due_diligence_documents ENABLE ROW LEVEL SECURITY;

-- SELECT: org members can view documents
CREATE POLICY "Users can view due diligence documents for their org"
  ON public.due_diligence_documents
  FOR SELECT
  USING (
    deleted_at IS NULL
    AND (
      organization_id IN (
        SELECT organization_id FROM public.user_roles WHERE user_id = auth.uid()
      )
      OR organization_id IN (
        SELECT id FROM public.organizations WHERE user_id = auth.uid() OR created_by = auth.uid()
      )
    )
  );

-- INSERT: org members can upload
CREATE POLICY "Org members can upload due diligence documents"
  ON public.due_diligence_documents
  FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.user_roles WHERE user_id = auth.uid()
    )
    OR organization_id IN (
      SELECT id FROM public.organizations WHERE user_id = auth.uid() OR created_by = auth.uid()
    )
  );

-- UPDATE: uploader can update their own documents
CREATE POLICY "Users can update their own due diligence documents"
  ON public.due_diligence_documents
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- DELETE: uploader can delete their own documents
CREATE POLICY "Users can delete their own due diligence documents"
  ON public.due_diligence_documents
  FOR DELETE
  USING (user_id = auth.uid());
