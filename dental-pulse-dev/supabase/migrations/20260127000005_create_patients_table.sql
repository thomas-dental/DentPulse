-- Create patients table for Supabase
-- Stores patient data synced from external APIs (e.g., Dentally)

CREATE TABLE IF NOT EXISTS public.patients (
  -- Primary key with UUID auto-generation
  id UUID NOT NULL DEFAULT gen_random_uuid(),

  -- Organization and location references
  organization_id UUID NOT NULL,
  location_id UUID NULL,
  region_id UUID NULL,

  -- Patient API fields (prefixed with pt_)
  pt_unique_id UUID NULL, -- uuid from API response
  pt_id BIGINT NULL, -- id from API response
  pt_account_id VARCHAR(255) NULL,
  is_active BOOLEAN DEFAULT TRUE,
  pt_title VARCHAR(50) NULL,
  pt_first_name VARCHAR(255) NULL,
  pt_middle_name VARCHAR(255) NULL,
  pt_last_name VARCHAR(255) NULL,
  pt_site_id UUID NULL,
  pt_address_line_1 VARCHAR(255) NULL,
  pt_address_line_2 VARCHAR(255) NULL,
  pt_address_line_3 VARCHAR(255) NULL,
  pt_county VARCHAR(255) NULL,
  pt_dob DATE NULL,
  pt_dentist_id BIGINT NULL,
  pt_dentist_recall_date DATE NULL,
  pt_dentist_recall_interval INTEGER NULL, -- recall interval in days/months
  pt_doctor_id BIGINT NULL,
  pt_email VARCHAR(255) NULL,
  pt_family_id BIGINT NULL,
  pt_gender VARCHAR(50) NULL,
  pt_image_url TEXT NULL,
  pt_is_student BOOLEAN DEFAULT FALSE,
  pt_mobile_phone VARCHAR(50) NULL,
  pt_payment_plan_id BIGINT NULL,
  pt_payment_plan_subscription_id VARCHAR(255) NULL,
  pt_payment_plan_subscription_status VARCHAR(100) NULL,
  pt_postcode VARCHAR(20) NULL,
  pt_region VARCHAR(255) NULL,
  pt_town VARCHAR(255) NULL,
  pt_created_at TIMESTAMPTZ NULL,
  pt_updated_at TIMESTAMPTZ NULL,

  -- Standard audit fields
  created_at TIMESTAMPTZ NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ NULL,
  created_by UUID NULL,
  updated_by UUID NULL,

  -- Primary key constraint
  CONSTRAINT patients_pkey PRIMARY KEY (id),

  -- Foreign keys
  CONSTRAINT patients_organization_id_fkey
    FOREIGN KEY (organization_id)
    REFERENCES public.organizations(id)
    ON DELETE CASCADE,

  CONSTRAINT patients_location_id_fkey
    FOREIGN KEY (location_id)
    REFERENCES public.practice_locations(id)
    ON DELETE SET NULL,

  CONSTRAINT patients_region_id_fkey
    FOREIGN KEY (region_id)
    REFERENCES public.regions(id)
    ON DELETE SET NULL,

  -- Unique constraint for API record (prevent duplicate patients from API)
  CONSTRAINT patients_org_pt_unique_id_key
    UNIQUE (organization_id, pt_unique_id)
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_patients_organization_id
  ON public.patients(organization_id);

CREATE INDEX IF NOT EXISTS idx_patients_location_id
  ON public.patients(location_id);

CREATE INDEX IF NOT EXISTS idx_patients_region_id
  ON public.patients(region_id);

CREATE INDEX IF NOT EXISTS idx_patients_pt_unique_id
  ON public.patients(pt_unique_id);

CREATE INDEX IF NOT EXISTS idx_patients_pt_id
  ON public.patients(pt_id);

CREATE INDEX IF NOT EXISTS idx_patients_pt_email
  ON public.patients(pt_email);

CREATE INDEX IF NOT EXISTS idx_patients_pt_mobile_phone
  ON public.patients(pt_mobile_phone);

CREATE INDEX IF NOT EXISTS idx_patients_pt_last_name
  ON public.patients(pt_last_name);

CREATE INDEX IF NOT EXISTS idx_patients_pt_family_id
  ON public.patients(pt_family_id);

CREATE INDEX IF NOT EXISTS idx_patients_deleted_at
  ON public.patients(deleted_at);

-- Create index for common queries (active patients)
CREATE INDEX IF NOT EXISTS idx_patients_active
  ON public.patients(organization_id, is_active)
  WHERE deleted_at IS NULL;

-- Add comments to the table and key columns
COMMENT ON TABLE public.patients IS 'Stores patient data synced from external APIs (e.g., Dentally)';
COMMENT ON COLUMN public.patients.id IS 'Primary key (auto-generated UUID)';
COMMENT ON COLUMN public.patients.pt_unique_id IS 'UUID from external API (unique identifier)';
COMMENT ON COLUMN public.patients.pt_id IS 'Numeric ID from external API';
COMMENT ON COLUMN public.patients.is_active IS 'Whether the patient is active';

-- Enable Row Level Security (RLS)
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for organization access
CREATE POLICY patients_org_isolation
  ON public.patients
  FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id
      FROM public.user_roles
      WHERE user_id = auth.uid()
    )
  );
