-- Hot-path indexes for scoped PE reads (facts, ledger, invoices).

CREATE INDEX IF NOT EXISTS idx_event_ledger_practice_created
  ON public.event_ledger (practice_id, created_at);

CREATE INDEX IF NOT EXISTS idx_pe_invoice_facts_practice_date_patient
  ON public.pe_invoice_contribution_facts (practice_id, invoice_date, patient_id);

CREATE INDEX IF NOT EXISTS idx_platform_invoices_org_date_location
  ON public.platform_integration_invoices (organization_id, invoice_date, location_id);
