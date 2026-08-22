-- ============================================
-- Store the raw Dentally invoice reference on each invoice line item.
--
-- platform_integration_invoice_line_items.invoice_id is OUR internal FK
-- (= platform_integration_invoices.id, a Postgres UUID). The raw Dentally
-- value from the API line item (invoice_items[].invoice_id) was being dropped.
--
-- In Dentally's invoice DETAIL response this field is the invoice's own UUID —
-- the id used in app URLs (/invoices/{uuid}). Capturing it here lets us both
-- inspect the real value and backfill platform_integration_invoices.invoice_uuid
-- for deep links. Stored as TEXT (Dentally may render it as a UUID or, on some
-- endpoints, a numeric id).
--
-- Safe to re-run. Existing rows get NULL until the next invoices sync.
-- ============================================

ALTER TABLE public.platform_integration_invoice_line_items
  ADD COLUMN IF NOT EXISTS dentally_invoice_id TEXT;

CREATE INDEX IF NOT EXISTS idx_invoice_line_items_dentally_invoice_id
  ON public.platform_integration_invoice_line_items(dentally_invoice_id);

COMMENT ON COLUMN public.platform_integration_invoice_line_items.dentally_invoice_id IS
  'Raw Dentally invoice reference from invoice_items[].invoice_id (the invoice UUID in detail responses). Used to build Dentally invoice deep links. NOT the internal FK — see invoice_id for that.';
