-- Add approval fields to accounts_payable_invoice_line_item table

-- Create enum type for approval status
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'line_item_approval_status') THEN
        CREATE TYPE line_item_approval_status AS ENUM ('pending', 'approved', 'rejected');
    END IF;
END $$;

-- Add approval-related columns to accounts_payable_invoice_line_item table
ALTER TABLE public.accounts_payable_invoice_line_item
ADD COLUMN IF NOT EXISTS approval_status line_item_approval_status DEFAULT NULL,
ADD COLUMN IF NOT EXISTS approver_id UUID DEFAULT NULL REFERENCES public.providers(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
ADD COLUMN IF NOT EXISTS approver_amount NUMERIC(10, 2) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS approver_percentage NUMERIC(5, 2) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
ADD COLUMN IF NOT EXISTS approval_notes TEXT DEFAULT NULL;

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_ap_invoice_line_item_approval_status ON public.accounts_payable_invoice_line_item(approval_status);
CREATE INDEX IF NOT EXISTS idx_ap_invoice_line_item_approver_id ON public.accounts_payable_invoice_line_item(approver_id);

-- Add comments for documentation
COMMENT ON COLUMN public.accounts_payable_invoice_line_item.approval_status IS 'Approval status: pending, approved, or rejected';
COMMENT ON COLUMN public.accounts_payable_invoice_line_item.approver_id IS 'Reference to the provider who is assigned to approve this line item';
COMMENT ON COLUMN public.accounts_payable_invoice_line_item.assigned_at IS 'Timestamp when the approver was assigned';
COMMENT ON COLUMN public.accounts_payable_invoice_line_item.approver_amount IS 'Amount assigned to the approver for this line item';
COMMENT ON COLUMN public.accounts_payable_invoice_line_item.approver_percentage IS 'Percentage of the line item assigned to the approver';
COMMENT ON COLUMN public.accounts_payable_invoice_line_item.approved_at IS 'Timestamp when the line item was approved or rejected';
COMMENT ON COLUMN public.accounts_payable_invoice_line_item.approval_notes IS 'Notes or comments from the approver';
