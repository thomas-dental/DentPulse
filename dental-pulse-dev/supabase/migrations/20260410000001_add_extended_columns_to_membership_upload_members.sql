-- Add extended raw columns from membership CSV import.
-- Values are stored as-is; the UI continues to display only the
-- original subset (surname, initial, dob, treating_dentist, fee_category,
-- discount_percent, net_due).

ALTER TABLE public.membership_upload_members
  ADD COLUMN IF NOT EXISTS pay_grp_id              TEXT,
  ADD COLUMN IF NOT EXISTS patient_id              TEXT,
  ADD COLUMN IF NOT EXISTS title                   TEXT,
  ADD COLUMN IF NOT EXISTS pay_grp_size            INTEGER,
  ADD COLUMN IF NOT EXISTS multiple_payments       TEXT,
  ADD COLUMN IF NOT EXISTS unpaid_payment          TEXT,
  ADD COLUMN IF NOT EXISTS late_joiner             TEXT,
  ADD COLUMN IF NOT EXISTS supplementary_insurance TEXT,
  ADD COLUMN IF NOT EXISTS implant_insurance       TEXT,
  ADD COLUMN IF NOT EXISTS annual_payer            TEXT,
  ADD COLUMN IF NOT EXISTS explanatory_text        TEXT;
