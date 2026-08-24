-- ============================================================================
-- Status/hint columns on public.integrations for encrypted Dentally PAT UI
-- (encrypted_pat / encrypted_pat_iv / validated_at already added in 20260824130001)
-- ============================================================================

ALTER TABLE public.integrations
  ADD COLUMN IF NOT EXISTS pat_hint TEXT,
  ADD COLUMN IF NOT EXISTS needs_reconnection BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auth_error_message TEXT,
  ADD COLUMN IF NOT EXISTS auth_failed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.integrations.pat_hint IS
  'Safe display hint for Dentally token (e.g. first4••••••••last4). Never the full token.';
COMMENT ON COLUMN public.integrations.needs_reconnection IS
  'True when Dentally rejected the stored token (401/403). Cleared on successful validate.';
COMMENT ON COLUMN public.integrations.auth_error_message IS
  'Last auth failure message (no secrets).';
COMMENT ON COLUMN public.integrations.auth_failed_at IS
  'When needs_reconnection was last set.';

-- Keep ciphertext columns service-role only (re-assert after any grant drift)
REVOKE SELECT (encrypted_pat, encrypted_pat_iv) ON public.integrations FROM authenticated;
REVOKE INSERT (encrypted_pat, encrypted_pat_iv) ON public.integrations FROM authenticated;
REVOKE UPDATE (encrypted_pat, encrypted_pat_iv) ON public.integrations FROM authenticated;
GRANT SELECT (encrypted_pat, encrypted_pat_iv) ON public.integrations TO service_role;
GRANT INSERT (encrypted_pat, encrypted_pat_iv) ON public.integrations TO service_role;
GRANT UPDATE (encrypted_pat, encrypted_pat_iv) ON public.integrations TO service_role;
