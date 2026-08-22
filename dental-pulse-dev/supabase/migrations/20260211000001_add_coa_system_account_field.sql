-- Add coa_system_account field to platform_integration_chart_of_accounts table
-- This field stores the system account type (e.g., for special account categorization)

ALTER TABLE public.platform_integration_chart_of_accounts
ADD COLUMN IF NOT EXISTS coa_system_account VARCHAR(255) DEFAULT NULL;