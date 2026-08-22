-- Migration: Add integration_id to all Dentally synced tables for multi-account support
-- This allows tracking which Dentally account each record was synced from

-- 1. Add integration_id column to all Dentally synced tables
ALTER TABLE practice_locations ADD COLUMN IF NOT EXISTS integration_id UUID REFERENCES integrations(id);
ALTER TABLE treatment_categories ADD COLUMN IF NOT EXISTS integration_id UUID REFERENCES integrations(id);
ALTER TABLE payment_plans ADD COLUMN IF NOT EXISTS integration_id UUID REFERENCES integrations(id);
ALTER TABLE appointment_cancellation_reasons ADD COLUMN IF NOT EXISTS integration_id UUID REFERENCES integrations(id);
ALTER TABLE treatments ADD COLUMN IF NOT EXISTS integration_id UUID REFERENCES integrations(id);
ALTER TABLE providers ADD COLUMN IF NOT EXISTS integration_id UUID REFERENCES integrations(id);
ALTER TABLE patients ADD COLUMN IF NOT EXISTS integration_id UUID REFERENCES integrations(id);
ALTER TABLE treatment_plans ADD COLUMN IF NOT EXISTS integration_id UUID REFERENCES integrations(id);
ALTER TABLE treatment_plan_items ADD COLUMN IF NOT EXISTS integration_id UUID REFERENCES integrations(id);
ALTER TABLE treatment_appointments ADD COLUMN IF NOT EXISTS integration_id UUID REFERENCES integrations(id);
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS integration_id UUID REFERENCES integrations(id);
ALTER TABLE platform_integration_invoices ADD COLUMN IF NOT EXISTS integration_id UUID REFERENCES integrations(id);
ALTER TABLE platform_integration_invoice_line_items ADD COLUMN IF NOT EXISTS integration_id UUID REFERENCES integrations(id);
ALTER TABLE nhs_claims ADD COLUMN IF NOT EXISTS integration_id UUID REFERENCES integrations(id);

-- 2. Create indexes for efficient filtering by integration_id
CREATE INDEX IF NOT EXISTS idx_practice_locations_integration ON practice_locations(integration_id);
CREATE INDEX IF NOT EXISTS idx_treatment_categories_integration ON treatment_categories(integration_id);
CREATE INDEX IF NOT EXISTS idx_payment_plans_integration ON payment_plans(integration_id);
CREATE INDEX IF NOT EXISTS idx_cancellation_reasons_integration ON appointment_cancellation_reasons(integration_id);
CREATE INDEX IF NOT EXISTS idx_treatments_integration ON treatments(integration_id);
CREATE INDEX IF NOT EXISTS idx_providers_integration ON providers(integration_id);
CREATE INDEX IF NOT EXISTS idx_patients_integration ON patients(integration_id);
CREATE INDEX IF NOT EXISTS idx_treatment_plans_integration ON treatment_plans(integration_id);
CREATE INDEX IF NOT EXISTS idx_treatment_plan_items_integration ON treatment_plan_items(integration_id);
CREATE INDEX IF NOT EXISTS idx_treatment_appointments_integration ON treatment_appointments(integration_id);
CREATE INDEX IF NOT EXISTS idx_appointments_integration ON appointments(integration_id);
CREATE INDEX IF NOT EXISTS idx_invoices_integration ON platform_integration_invoices(integration_id);
CREATE INDEX IF NOT EXISTS idx_invoice_line_items_integration ON platform_integration_invoice_line_items(integration_id);
CREATE INDEX IF NOT EXISTS idx_nhs_claims_integration ON nhs_claims(integration_id);
