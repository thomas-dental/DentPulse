-- Update platform_integration_chart_of_accounts table to add balance fields
ALTER TABLE public.platform_integration_chart_of_accounts
ADD COLUMN IF NOT EXISTS coa_current_balance NUMERIC(10, 2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS coa_opening_balance NUMERIC(10, 2),
ADD COLUMN IF NOT EXISTS coa_as_on_date_balance DATE,
ADD COLUMN IF NOT EXISTS coa_is_ar_account BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS coa_is_ap_account BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS coa_sub_account BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS coa_sync_token VARCHAR(500),
ADD COLUMN IF NOT EXISTS coa_updated_date_utc TIMESTAMP WITH TIME ZONE;

-- Create index for balance fields
CREATE INDEX IF NOT EXISTS idx_platform_integration_coa_current_balance ON public.platform_integration_chart_of_accounts(coa_current_balance);
CREATE INDEX IF NOT EXISTS idx_platform_integration_coa_opening_balance ON public.platform_integration_chart_of_accounts(coa_opening_balance);
CREATE INDEX IF NOT EXISTS idx_platform_integration_coa_is_ar_account ON public.platform_integration_chart_of_accounts(coa_is_ar_account);
CREATE INDEX IF NOT EXISTS idx_platform_integration_coa_is_ap_account ON public.platform_integration_chart_of_accounts(coa_is_ap_account);
