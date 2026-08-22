-- Add user_id column to patients table

ALTER TABLE public.patients
ADD COLUMN IF NOT EXISTS user_id UUID NULL;

-- Create index for user_id
CREATE INDEX IF NOT EXISTS idx_patients_user_id
  ON public.patients(user_id);

-- Add comment
COMMENT ON COLUMN public.patients.user_id IS 'Reference to user associated with this patient';
