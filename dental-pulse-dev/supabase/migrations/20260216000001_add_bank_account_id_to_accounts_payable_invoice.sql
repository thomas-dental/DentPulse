-- Add bank_account_id column to accounts_payable_invoice table
-- This stores the bank account used for payment when invoice is marked as PAID

ALTER TABLE accounts_payable_invoice
ADD COLUMN IF NOT EXISTS bank_account_id TEXT NULL;

-- Add comment to describe the column
COMMENT ON COLUMN accounts_payable_invoice.bank_account_id IS 'Bank account ID (from platform_integration_chart_of_accounts) used for payment when status is PAID';
