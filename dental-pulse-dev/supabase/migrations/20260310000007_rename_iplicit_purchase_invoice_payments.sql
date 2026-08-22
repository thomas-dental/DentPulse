-- Rename iplicit_purchase_invoice_payments to iplicit_payments

ALTER TABLE public.iplicit_purchase_invoice_payments
  RENAME TO iplicit_payments;

-- Rename indexes
ALTER INDEX IF EXISTS idx_iplicit_pip_org          RENAME TO idx_iplicit_payments_org;
ALTER INDEX IF EXISTS idx_iplicit_pip_integration  RENAME TO idx_iplicit_payments_integration;
ALTER INDEX IF EXISTS idx_iplicit_pip_payment_id   RENAME TO idx_iplicit_payments_payment_id;
ALTER INDEX IF EXISTS idx_iplicit_pip_contact      RENAME TO idx_iplicit_payments_contact;
ALTER INDEX IF EXISTS idx_iplicit_pip_doc_date     RENAME TO idx_iplicit_payments_doc_date;
ALTER INDEX IF EXISTS idx_iplicit_pip_legal_entity RENAME TO idx_iplicit_payments_legal_entity;
