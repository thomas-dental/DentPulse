-- ============================================================================
-- Patient recall fields on public.patients (Dentally GET /v1/patients)
--
-- Dentally does not expose a separate /v1/recalls list endpoint. Recall due
-- dates, intervals, and preferred contact method are patient attributes.
-- PE syncRecalls upserts these columns via the patients API.
-- ============================================================================

ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS pt_hygienist_recall_date DATE NULL,
  ADD COLUMN IF NOT EXISTS pt_hygienist_recall_interval INTEGER NULL,
  ADD COLUMN IF NOT EXISTS pt_recall_method VARCHAR(50) NULL;

COMMENT ON COLUMN public.patients.pt_hygienist_recall_date IS
  'Dentally hygienist_recall_date — next hygiene recall due date.';
COMMENT ON COLUMN public.patients.pt_hygienist_recall_interval IS
  'Dentally hygienist_recall_interval — months between hygiene recalls.';
COMMENT ON COLUMN public.patients.pt_recall_method IS
  'Dentally recall_method — preferred recall contact method (Letter, SMS, Email, Phone).';
