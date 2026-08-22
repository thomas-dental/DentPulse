-- Add account_id to iplicit_gl_entries (iplicit Catalog Account ID – available in most APIs)
ALTER TABLE public.iplicit_gl_entries
ADD COLUMN IF NOT EXISTS account_id VARCHAR(500);

CREATE INDEX IF NOT EXISTS idx_iplicit_gl_entries_account_id ON public.iplicit_gl_entries(account_id);

COMMENT ON COLUMN public.iplicit_gl_entries.account_id IS 'iplicit Catalog Account ID – links to platform_integration_chart_of_accounts.coa_account_id';
