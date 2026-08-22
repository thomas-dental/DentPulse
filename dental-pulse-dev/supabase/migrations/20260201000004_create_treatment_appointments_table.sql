-- Create treatment_appointments table for Supabase
-- Stores treatment appointment data synced from external APIs (e.g., Dentally)

CREATE TABLE IF NOT EXISTS public.treatment_appointments (
  -- Primary key with UUID auto-generation
  id UUID NOT NULL DEFAULT gen_random_uuid(),

  -- Organization and location references
  organization_id UUID NOT NULL,
  location_id UUID NULL,
  region_id UUID NULL,

  -- Treatment appointment API fields (prefixed with ta_)
  ta_id BIGINT NULL, -- id from API response (int11 equivalent)
  ta_appointment_id BIGINT NULL, -- appointment ID from API
  ta_bookable BOOLEAN DEFAULT FALSE,
  ta_patient_id BIGINT NULL, -- references patients.pt_id (external API ID)
  ta_treatment_plan_id BIGINT NULL, -- references treatment_plans.tp_id (external API ID)
  ta_created_at TIMESTAMPTZ NULL,
  ta_updated_at TIMESTAMPTZ NULL,

  -- User reference
  user_id UUID NULL,

  -- Standard audit fields
  created_at TIMESTAMPTZ NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ NULL,
  created_by UUID NULL,
  updated_by UUID NULL,
  deleted_by UUID NULL,

  -- Primary key constraint
  CONSTRAINT treatment_appointments_pkey PRIMARY KEY (id),

  -- Foreign keys
  CONSTRAINT treatment_appointments_organization_id_fkey
    FOREIGN KEY (organization_id)
    REFERENCES public.organizations(id)
    ON DELETE CASCADE,

  CONSTRAINT treatment_appointments_location_id_fkey
    FOREIGN KEY (location_id)
    REFERENCES public.practice_locations(id)
    ON DELETE SET NULL,

  CONSTRAINT treatment_appointments_region_id_fkey
    FOREIGN KEY (region_id)
    REFERENCES public.regions(id)
    ON DELETE SET NULL,

  CONSTRAINT treatment_appointments_user_id_fkey
    FOREIGN KEY (user_id)
    REFERENCES auth.users(id)
    ON DELETE SET NULL,

  CONSTRAINT treatment_appointments_created_by_fkey
    FOREIGN KEY (created_by)
    REFERENCES auth.users(id)
    ON DELETE SET NULL,

  CONSTRAINT treatment_appointments_updated_by_fkey
    FOREIGN KEY (updated_by)
    REFERENCES auth.users(id)
    ON DELETE SET NULL,

  CONSTRAINT treatment_appointments_deleted_by_fkey
    FOREIGN KEY (deleted_by)
    REFERENCES auth.users(id)
    ON DELETE SET NULL
);

-- Note: ta_patient_id and ta_treatment_plan_id reference external API IDs
-- (patients.pt_id and treatment_plans.tp_id) which are not unique across organizations.
-- Foreign key constraints are not created for these, but indexes are added for query performance.

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_treatment_appointments_organization_id
  ON public.treatment_appointments(organization_id);

CREATE INDEX IF NOT EXISTS idx_treatment_appointments_location_id
  ON public.treatment_appointments(location_id);

CREATE INDEX IF NOT EXISTS idx_treatment_appointments_region_id
  ON public.treatment_appointments(region_id);

CREATE INDEX IF NOT EXISTS idx_treatment_appointments_ta_id
  ON public.treatment_appointments(ta_id);

CREATE INDEX IF NOT EXISTS idx_treatment_appointments_ta_appointment_id
  ON public.treatment_appointments(ta_appointment_id);

CREATE INDEX IF NOT EXISTS idx_treatment_appointments_ta_patient_id
  ON public.treatment_appointments(organization_id, ta_patient_id);

CREATE INDEX IF NOT EXISTS idx_treatment_appointments_ta_treatment_plan_id
  ON public.treatment_appointments(organization_id, ta_treatment_plan_id);

CREATE INDEX IF NOT EXISTS idx_treatment_appointments_ta_bookable
  ON public.treatment_appointments(ta_bookable);

CREATE INDEX IF NOT EXISTS idx_treatment_appointments_user_id
  ON public.treatment_appointments(user_id);

CREATE INDEX IF NOT EXISTS idx_treatment_appointments_deleted_at
  ON public.treatment_appointments(deleted_at);

-- Create index for common queries (active treatment appointments)
CREATE INDEX IF NOT EXISTS idx_treatment_appointments_active
  ON public.treatment_appointments(organization_id, ta_created_at)
  WHERE deleted_at IS NULL;

-- Create composite index for patient treatment appointments
CREATE INDEX IF NOT EXISTS idx_treatment_appointments_patient
  ON public.treatment_appointments(organization_id, ta_patient_id, ta_treatment_plan_id)
  WHERE deleted_at IS NULL;

-- Add comments to the table and key columns
COMMENT ON TABLE public.treatment_appointments IS 'Stores treatment appointment data synced from external APIs (e.g., Dentally)';
COMMENT ON COLUMN public.treatment_appointments.id IS 'Primary key (auto-generated UUID)';
COMMENT ON COLUMN public.treatment_appointments.ta_id IS 'Numeric ID from external API';
COMMENT ON COLUMN public.treatment_appointments.ta_appointment_id IS 'Appointment ID from external API';
COMMENT ON COLUMN public.treatment_appointments.ta_patient_id IS 'Patient ID from external API (references patients.pt_id)';
COMMENT ON COLUMN public.treatment_appointments.ta_treatment_plan_id IS 'Treatment plan ID from external API (references treatment_plans.tp_id)';
COMMENT ON COLUMN public.treatment_appointments.ta_bookable IS 'Whether the treatment appointment is bookable';
COMMENT ON COLUMN public.treatment_appointments.user_id IS 'Supabase auth user who synced this treatment appointment';

-- Enable Row Level Security (RLS)
ALTER TABLE public.treatment_appointments ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for organization access
CREATE POLICY treatment_appointments_org_isolation
  ON public.treatment_appointments
  FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id
      FROM public.user_roles
      WHERE user_id = auth.uid()
    )
  );

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_treatment_appointments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_treatment_appointments_updated_at
    BEFORE UPDATE ON public.treatment_appointments
    FOR EACH ROW
    EXECUTE FUNCTION update_treatment_appointments_updated_at();
