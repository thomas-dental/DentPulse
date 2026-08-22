-- Add user_id column to appointments table

ALTER TABLE public.appointments
ADD COLUMN IF NOT EXISTS user_id UUID NULL;

-- Create index for user_id
CREATE INDEX IF NOT EXISTS idx_appointments_user_id
  ON public.appointments(user_id);

-- Add comment
COMMENT ON COLUMN public.appointments.user_id IS 'Reference to user associated with this appointment';
