ALTER TABLE vendor_bank_accounts
ADD COLUMN IF NOT EXISTS plaid_recipient_id TEXT;
