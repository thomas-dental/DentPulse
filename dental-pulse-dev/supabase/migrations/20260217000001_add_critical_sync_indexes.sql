-- Migration to add critical indexes for sync operations
-- This will significantly reduce Disk IO usage during incremental syncs

-- 1. Add index on treatment_plan_items.tpi_updated_at (CRITICAL)
-- Used by incremental sync: fetchDentallyData with updated_after filter
CREATE INDEX IF NOT EXISTS idx_treatment_plan_items_tpi_updated_at
ON treatment_plan_items (tpi_updated_at);

-- 2. Add composite index for treatment_plan_items sync queries
-- Allows efficient filtering by organization AND update date
CREATE INDEX IF NOT EXISTS idx_treatment_plan_items_org_updated
ON treatment_plan_items (organization_id, tpi_updated_at);

-- 3. Add index on appointments.apmt_updated_at
-- Used by incremental sync: fetchDentallyData with updated_since filter
CREATE INDEX IF NOT EXISTS idx_appointments_apmt_updated_at
ON appointments (apmt_updated_at);

-- 4. Add composite index for appointments sync queries
CREATE INDEX IF NOT EXISTS idx_appointments_org_updated
ON appointments (organization_id, apmt_updated_at);

-- 5. Add index on patients.pt_updated_at
-- Used by incremental patient sync
CREATE INDEX IF NOT EXISTS idx_patients_pt_updated_at
ON patients (pt_updated_at);

-- 6. Add composite index for patients sync queries
CREATE INDEX IF NOT EXISTS idx_patients_org_updated
ON patients (organization_id, pt_updated_at);

-- 7. Add composite index for invoice date range queries
-- Used by invoice sync with dated_on_after/dated_on_before filters
CREATE INDEX IF NOT EXISTS idx_platform_invoices_org_date
ON platform_integration_invoices (organization_id, invoice_date);

-- 8. Add composite index for invoice line items upsert conflicts
-- Prevents fallback to individual upserts
CREATE INDEX IF NOT EXISTS idx_invoice_line_items_conflict_resolution
ON platform_integration_invoice_line_items (organization_id, platform_line_id, invoice_id);

-- 9. Add composite index for invoice line items lookup
CREATE INDEX IF NOT EXISTS idx_invoice_line_items_lookup
ON platform_integration_invoice_line_items (invoice_id, organization_id);

-- 10. Add composite index for patient lookup in invoice sync
CREATE INDEX IF NOT EXISTS idx_patients_org_pt_id
ON patients (organization_id, pt_id);

-- Add comments explaining why these indexes are critical
COMMENT ON INDEX idx_treatment_plan_items_tpi_updated_at IS
'Critical for incremental sync performance - prevents full table scans when filtering by updated_after';

COMMENT ON INDEX idx_appointments_apmt_updated_at IS
'Critical for incremental appointment sync - prevents full table scans when filtering by updated_since';

COMMENT ON INDEX idx_patients_pt_updated_at IS
'Critical for incremental patient sync - prevents full table scans when filtering by update date';
