ALTER TABLE accounts_payable_invoice_line_item
  ADD COLUMN IF NOT EXISTS xero_item_code TEXT;
