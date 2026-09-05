-- Private Storage bucket for Denplan / membership CSV exports before Edge Function import.
-- Objects live under {organization_id}/... ; the Edge Function deletes after processing.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'membership-imports',
  'membership-imports',
  false,
  20971520, -- 20 MB
  ARRAY['text/csv', 'text/plain', 'application/vnd.ms-excel', 'application/octet-stream']
)
ON CONFLICT (id) DO NOTHING;

-- Authenticated users may upload/read/delete only under their org prefix.
DROP POLICY IF EXISTS "membership_imports_select_own_org" ON storage.objects;
CREATE POLICY "membership_imports_select_own_org"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'membership-imports'
  AND public.user_in_org(auth.uid(), (storage.foldername(name))[1]::uuid)
);

DROP POLICY IF EXISTS "membership_imports_insert_own_org" ON storage.objects;
CREATE POLICY "membership_imports_insert_own_org"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'membership-imports'
  AND public.user_in_org(auth.uid(), (storage.foldername(name))[1]::uuid)
);

DROP POLICY IF EXISTS "membership_imports_update_own_org" ON storage.objects;
CREATE POLICY "membership_imports_update_own_org"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'membership-imports'
  AND public.user_in_org(auth.uid(), (storage.foldername(name))[1]::uuid)
);

DROP POLICY IF EXISTS "membership_imports_delete_own_org" ON storage.objects;
CREATE POLICY "membership_imports_delete_own_org"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'membership-imports'
  AND public.user_in_org(auth.uid(), (storage.foldername(name))[1]::uuid)
);

-- Service role (Edge Functions) full access
DROP POLICY IF EXISTS "membership_imports_service_role" ON storage.objects;
CREATE POLICY "membership_imports_service_role"
ON storage.objects FOR ALL TO service_role
USING (bucket_id = 'membership-imports')
WITH CHECK (bucket_id = 'membership-imports');
