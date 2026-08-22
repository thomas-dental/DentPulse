-- Add status_list (TEXT[]) to iplicit_purchase_invoice_payments and iplicit_sales_receipts

ALTER TABLE public.iplicit_purchase_invoice_payments
  ADD COLUMN IF NOT EXISTS status_list TEXT[];

ALTER TABLE public.iplicit_sales_receipts
  ADD COLUMN IF NOT EXISTS status_list TEXT[];
