-- Add RLS policies for public invoice approval access
-- These policies allow anonymous access for the approval workflow via email links

-- Policy: Allow anonymous read access to invoices (for approval page)
CREATE POLICY "Allow anonymous read invoices for approval"
ON accounts_payable_invoice
FOR SELECT
TO anon
USING (true);

-- Policy: Allow anonymous read access to line items (for approval page)
CREATE POLICY "Allow anonymous read line items for approval"
ON accounts_payable_invoice_line_item
FOR SELECT
TO anon
USING (true);

-- Policy: Allow anonymous update of approval status on line items
CREATE POLICY "Allow anonymous update approval status"
ON accounts_payable_invoice_line_item
FOR UPDATE
TO anon
USING (approver_id IS NOT NULL)
WITH CHECK (approver_id IS NOT NULL);
