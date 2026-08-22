-- ============================================================================
-- ADD INVOICE_ID TO INBOUND_EMAILS TABLE
-- Links email directly to created invoice for easy lookup
-- ============================================================================

-- Add invoice_id column to inbound_emails table
ALTER TABLE inbound_emails
ADD COLUMN IF NOT EXISTS invoice_id UUID REFERENCES accounts_payable_invoice(id) ON DELETE SET NULL;

-- Create index for invoice_id
CREATE INDEX IF NOT EXISTS idx_inbound_emails_invoice_id ON inbound_emails(invoice_id);

-- Add comment
COMMENT ON COLUMN inbound_emails.invoice_id IS
'Invoice created from this email (if any)';
