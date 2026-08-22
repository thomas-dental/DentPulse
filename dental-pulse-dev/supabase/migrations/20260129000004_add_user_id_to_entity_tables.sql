-- Add user_id column to all entity tables that don't have it
-- This tracks which Supabase auth user owns/synced each record

-- 1. Add user_id to appointments table
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE appointments
  ADD CONSTRAINT IF NOT EXISTS appointments_user_id_fkey
  FOREIGN KEY (user_id)
  REFERENCES auth.users(id)
  ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_appointments_user_id ON appointments(user_id);
COMMENT ON COLUMN appointments.user_id IS 'Supabase auth user who synced this appointment';

-- 2. Add user_id to patients table
ALTER TABLE patients ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE patients
  ADD CONSTRAINT IF NOT EXISTS patients_user_id_fkey
  FOREIGN KEY (user_id)
  REFERENCES auth.users(id)
  ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_patients_user_id ON patients(user_id);
COMMENT ON COLUMN patients.user_id IS 'Supabase auth user who synced this patient';

-- 3. Add user_id to treatments table
ALTER TABLE treatments ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE treatments
  ADD CONSTRAINT IF NOT EXISTS treatments_user_id_fkey
  FOREIGN KEY (user_id)
  REFERENCES auth.users(id)
  ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_treatments_user_id ON treatments(user_id);
COMMENT ON COLUMN treatments.user_id IS 'Supabase auth user who synced this treatment';

-- 4. Add user_id to treatment_categories table
ALTER TABLE treatment_categories ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE treatment_categories
  ADD CONSTRAINT IF NOT EXISTS treatment_categories_user_id_fkey
  FOREIGN KEY (user_id)
  REFERENCES auth.users(id)
  ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_treatment_categories_user_id ON treatment_categories(user_id);
COMMENT ON COLUMN treatment_categories.user_id IS 'Supabase auth user who synced this treatment category';

-- 5. Add user_id to practice_locations table
ALTER TABLE practice_locations ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE practice_locations
  ADD CONSTRAINT IF NOT EXISTS practice_locations_user_id_fkey
  FOREIGN KEY (user_id)
  REFERENCES auth.users(id)
  ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_practice_locations_user_id ON practice_locations(user_id);
COMMENT ON COLUMN practice_locations.user_id IS 'Supabase auth user who synced this location';

-- 6. Add user_id to providers table
ALTER TABLE providers ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE providers
  ADD CONSTRAINT IF NOT EXISTS providers_user_id_fkey
  FOREIGN KEY (user_id)
  REFERENCES auth.users(id)
  ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_providers_user_id ON providers(user_id);
COMMENT ON COLUMN providers.user_id IS 'Supabase auth user who synced this provider';
