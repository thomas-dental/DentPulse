-- Create appointments table for Supabase
-- Stores appointments synced from external APIs (e.g., Dentally)

CREATE TABLE IF NOT EXISTS public.appointments (
  -- Primary key with UUID auto-generation
  id UUID NOT NULL DEFAULT gen_random_uuid(),

  -- Organization and location references
  organization_id UUID NOT NULL,
  location_id UUID NULL,
  region_id UUID NULL,

  -- Dentally API fields (prefixed with apmt_)
  apmt_unique_id UUID NULL, -- uuid from API response
  apmt_id BIGINT NULL, -- id from API response (can be large integer)
  apmt_practitioner_id BIGINT NULL,
  apmt_practitioner_name VARCHAR(255) NULL,
  apmt_practitioner_site_id UUID NULL,
  apmt_user_id BIGINT NULL,
  apmt_arrived_at TIMESTAMPTZ NULL,
  apmt_cancelled_at TIMESTAMPTZ NULL,
  apmt_completed_at TIMESTAMPTZ NULL,
  apmt_confirmed_at TIMESTAMPTZ NULL,
  apmt_created_at TIMESTAMPTZ NULL,
  apmt_duration INTEGER NULL, -- duration in minutes
  apmt_finish_time TIMESTAMPTZ NULL,
  apmt_in_surgery_at TIMESTAMPTZ NULL,
  apmt_patient_id BIGINT NULL,
  apmt_patient_image_url TEXT NULL,
  apmt_patient_name VARCHAR(255) NULL,
  apmt_payment_plan_id BIGINT NULL,
  apmt_pending_at TIMESTAMPTZ NULL,
  apmt_reason VARCHAR(255) NULL,
  apmt_start_time TIMESTAMPTZ NULL,
  apmt_state VARCHAR(50) NULL, -- "Completed", "Pending", "Cancelled", etc.
  apmt_treatment_description TEXT NULL,
  apmt_booked_via_api BOOLEAN DEFAULT FALSE,
  apmt_updated_at TIMESTAMPTZ NULL,
  apmt_appointment_cancellation_reason_id BIGINT NULL,
  apmt_did_not_attend_at TIMESTAMPTZ NULL, -- from API response
  apmt_notes TEXT NULL, -- from API response

  -- Standard audit fields
  created_at TIMESTAMPTZ NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ NULL,
  created_by UUID NULL,
  updated_by UUID NULL,

  -- Primary key constraint
  CONSTRAINT appointments_pkey PRIMARY KEY (id),

  -- Foreign keys
  CONSTRAINT appointments_organization_id_fkey
    FOREIGN KEY (organization_id)
    REFERENCES public.organizations(id)
    ON DELETE CASCADE,

  CONSTRAINT appointments_location_id_fkey
    FOREIGN KEY (location_id)
    REFERENCES public.practice_locations(id)
    ON DELETE SET NULL,

  CONSTRAINT appointments_region_id_fkey
    FOREIGN KEY (region_id)
    REFERENCES public.regions(id)
    ON DELETE SET NULL,

  -- Unique constraint for API record (prevent duplicate appointments from API)
  CONSTRAINT appointments_org_apmt_unique_id_key
    UNIQUE (organization_id, apmt_unique_id)
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_appointments_organization_id
  ON public.appointments(organization_id);

CREATE INDEX IF NOT EXISTS idx_appointments_location_id
  ON public.appointments(location_id);

CREATE INDEX IF NOT EXISTS idx_appointments_region_id
  ON public.appointments(region_id);

CREATE INDEX IF NOT EXISTS idx_appointments_apmt_unique_id
  ON public.appointments(apmt_unique_id);

CREATE INDEX IF NOT EXISTS idx_appointments_apmt_id
  ON public.appointments(apmt_id);

CREATE INDEX IF NOT EXISTS idx_appointments_apmt_practitioner_id
  ON public.appointments(apmt_practitioner_id);

CREATE INDEX IF NOT EXISTS idx_appointments_apmt_patient_id
  ON public.appointments(apmt_patient_id);

CREATE INDEX IF NOT EXISTS idx_appointments_apmt_start_time
  ON public.appointments(apmt_start_time);

CREATE INDEX IF NOT EXISTS idx_appointments_apmt_state
  ON public.appointments(apmt_state);

CREATE INDEX IF NOT EXISTS idx_appointments_deleted_at
  ON public.appointments(deleted_at);

-- Create index for common queries (active appointments)
CREATE INDEX IF NOT EXISTS idx_appointments_active
  ON public.appointments(organization_id, apmt_start_time)
  WHERE deleted_at IS NULL;

-- Add comments to the table and key columns
COMMENT ON TABLE public.appointments IS 'Stores appointments synced from external APIs (e.g., Dentally)';
COMMENT ON COLUMN public.appointments.id IS 'Primary key (auto-generated UUID)';
COMMENT ON COLUMN public.appointments.apmt_unique_id IS 'UUID from external API (unique identifier)';
COMMENT ON COLUMN public.appointments.apmt_id IS 'Numeric ID from external API';
COMMENT ON COLUMN public.appointments.apmt_state IS 'Appointment state: Pending, Confirmed, Completed, Cancelled, etc.';
COMMENT ON COLUMN public.appointments.apmt_duration IS 'Appointment duration in minutes';

-- Enable Row Level Security (RLS)
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for organization access
CREATE POLICY appointments_org_isolation
  ON public.appointments
  FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id
      FROM public.user_roles
      WHERE user_id = auth.uid()
    )
  );
