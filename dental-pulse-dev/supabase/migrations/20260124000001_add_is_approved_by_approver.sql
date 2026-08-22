-- Add is_approved_by_approver column to accounts_payable_invoice table
-- This field indicates whether the invoice needs approval from approvers (0 = No, 1 = Yes)

ALTER TABLE accounts_payable_invoice
ADD COLUMN IF NOT EXISTS is_approved_by_approver INTEGER DEFAULT 0;

-- Add comment for documentation
COMMENT ON COLUMN accounts_payable_invoice.is_approved_by_approver IS 'Indicates if the invoice requires approval from approvers (0 = No, 1 = Yes)';
