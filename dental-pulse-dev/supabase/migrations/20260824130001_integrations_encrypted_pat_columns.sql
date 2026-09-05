-- ============================================================================
-- Extend public.integrations (existing Dentally PAT / API key storage) with
-- encrypted columns. No new table.
--
-- - encrypted_pat / encrypted_pat_iv: AES-256-GCM ciphertext (see patEncryption.js)
-- - validated_at: set only after a real Dentally validate call (not by migrate script)
-- - updated_at: already present — confirmed only
--
-- Column privileges: anon/authenticated cannot SELECT encrypted_* columns.
-- Existing row RLS for integration metadata is left intact (Settings still needs it).
-- api_key plaintext column is NOT dropped (rollback buffer; cleared by migrate script).
-- ============================================================================

ALTER TABLE public.integrations
  ADD COLUMN IF NOT EXISTS encrypted_pat TEXT,
  ADD COLUMN IF NOT EXISTS encrypted_pat_iv TEXT,
  ADD COLUMN IF NOT EXISTS validated_at TIMESTAMPTZ;

-- updated_at already exists on integrations; no-op if present
ALTER TABLE public.integrations
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

COMMENT ON COLUMN public.integrations.encrypted_pat IS
  'AES-256-GCM ciphertext||tag (base64) for Dentally PAT/API key. Readable only via service_role.';
COMMENT ON COLUMN public.integrations.encrypted_pat_iv IS
  'Base64 12-byte IV for encrypted_pat. Readable only via service_role.';
COMMENT ON COLUMN public.integrations.validated_at IS
  'Set when backend successfully validates the token with Dentally. Not set by encrypt-migrate script.';
COMMENT ON COLUMN public.integrations.api_key IS
  'Legacy plaintext Dentally API key. Cleared after encryption migrate; retained as rollback buffer until a later drop.';

-- ---------------------------------------------------------------------------
-- Deny direct client reads of encrypted secret columns
-- (row RLS alone cannot hide columns — use GRANT/REVOKE)
-- ---------------------------------------------------------------------------
REVOKE ALL ON TABLE public.integrations FROM anon;
-- Keep authenticated table access for non-secret columns (existing Settings UI),
-- but strip ability to read ciphertext columns.
REVOKE SELECT (encrypted_pat, encrypted_pat_iv) ON public.integrations FROM authenticated;
REVOKE INSERT (encrypted_pat, encrypted_pat_iv) ON public.integrations FROM authenticated;
REVOKE UPDATE (encrypted_pat, encrypted_pat_iv) ON public.integrations FROM authenticated;

GRANT ALL ON TABLE public.integrations TO service_role;
GRANT SELECT (encrypted_pat, encrypted_pat_iv) ON public.integrations TO service_role;
GRANT INSERT (encrypted_pat, encrypted_pat_iv) ON public.integrations TO service_role;
GRANT UPDATE (encrypted_pat, encrypted_pat_iv) ON public.integrations TO service_role;
