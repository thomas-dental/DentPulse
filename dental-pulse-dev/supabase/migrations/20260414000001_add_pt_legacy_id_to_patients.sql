-- Add pt_legacy_id to patients table.
-- Dentally's patient API exposes a `legacy_id` field (stringified number,
-- e.g. "4790595") that preserves the patient's id from their pre-Dentally
-- practice management system. Our membership CSV/XLSX uploads carry this
-- legacy id in the "patient_id" column and store it on
-- `membership_upload_members.patient_id`, so we need it on the patients
-- table to enable a direct join for member → patient resolution.

ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS pt_legacy_id VARCHAR(50) NULL;

CREATE INDEX IF NOT EXISTS idx_patients_org_legacy_id
  ON public.patients(organization_id, pt_legacy_id);
