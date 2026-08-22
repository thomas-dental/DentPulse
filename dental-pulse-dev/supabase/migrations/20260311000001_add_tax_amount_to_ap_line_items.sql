-- Add tax_amount column to accounts_payable_invoice_line_item table
ALTER TABLE accounts_payable_invoice_line_item
ADD COLUMN IF NOT EXISTS tax_amount NUMERIC DEFAULT 0;
