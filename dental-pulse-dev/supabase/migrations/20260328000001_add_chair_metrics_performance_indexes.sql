-- Performance indexes for get_chair_metrics() to prevent statement timeouts.
-- The function joins appointments → treatment_appointments → treatment_plan_items → treatments
-- and scans by organization_id + date range. These composite indexes cover the hot paths.

-- 1. Appointments: org + patient + start_time covering filter (the main scan)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_appointments_chair_metrics
  ON appointments(organization_id, apmt_start_time)
  WHERE deleted_at IS NULL AND apmt_patient_id IS NOT NULL;

-- 2. Treatment appointments: JOIN key (ta_appointment_id) with org filter
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ta_apmt_id_org
  ON treatment_appointments(ta_appointment_id, organization_id)
  WHERE deleted_at IS NULL;

-- 3. Treatment plan items: JOIN key (tpi_treatment_appointment_id) with org filter
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tpi_ta_id_org
  ON treatment_plan_items(tpi_treatment_appointment_id, organization_id)
  WHERE deleted_at IS NULL;

-- 4. Treatment plan items: revenue CTEs scan by completed_at date range
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tpi_completed_at_org
  ON treatment_plan_items(organization_id, tpi_completed_at)
  WHERE deleted_at IS NULL AND tpi_completed = true;

-- 5. Patients: location fallback JOIN (pt_id → location_id)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_patients_pt_id_org
  ON patients(pt_id, organization_id);

-- 6. Practice locations: api_record_unique_id for practitioner site fallback
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_practice_locations_api_record
  ON practice_locations(api_record_unique_id, organization_id)
  WHERE deleted_at IS NULL;
