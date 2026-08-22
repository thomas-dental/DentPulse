-- ============================================================================
-- ADD SOURCE COLUMN TO ACCOUNTS_PAYABLE_INVOICE TABLE
-- Tracks the origin of invoices: manual upload or email automation
-- ============================================================================

-- Add source column with default 'manual' for existing records
ALTER TABLE accounts_payable_invoice
ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'manual' CHECK (source IN ('manual', 'email'));

-- Create index for source column
CREATE INDEX IF NOT EXISTS idx_ap_invoice_source ON accounts_payable_invoice(source);

-- Create composite index for organization + source + date queries
CREATE INDEX IF NOT EXISTS idx_ap_invoice_org_source_date
ON accounts_payable_invoice(organization_id, source, invoice_date);

-- Add comment
COMMENT ON COLUMN accounts_payable_invoice.source IS
'Source of the invoice: manual (uploaded by user), email (from email automation)';
