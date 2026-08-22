-- ============================================
-- Add Dentally invoice UUID column to platform_integration_invoices.
--
-- The /v1/invoices endpoint returns both a numeric `id` (already stored as
-- platform_invoice_id) and a `uuid`. The UUID is what Dentally uses in app
-- URLs:
--   https://app.dentally.co/patients/{patient_uuid}/account/{account_uuid}/invoices/{invoice_uuid}
-- so we need it to deep-link from DentPulse rows straight to a specific
-- invoice in Dentally (e.g. from the ProviderActivity Price column). Without
-- it we can only link to the patient's account page, not the exact invoice.
--
-- Safe to re-run. Existing rows get NULL until the next invoices sync
-- repopulates them via the transformer.
-- ============================================

ALTER TABLE public.platform_integration_invoices
  ADD COLUMN IF NOT EXISTS invoice_uuid UUID;

CREATE INDEX IF NOT EXISTS idx_platform_integration_invoices_invoice_uuid
  ON public.platform_integration_invoices(invoice_uuid);

COMMENT ON COLUMN public.platform_integration_invoices.invoice_uuid IS
  'Dentally invoice UUID (from /v1/invoices.uuid). Used to build deep-link URLs into Dentally''s invoice page.';
