-- Create treatment_plan_items table for Supabase
-- Stores treatment plan item data synced from external APIs (e.g., Dentally)

CREATE TABLE IF NOT EXISTS public.treatment_plan_items (
  -- Primary key with UUID auto-generation
  id UUID NOT NULL DEFAULT gen_random_uuid(),

  -- Organization and location references
  organization_id UUID NOT NULL,
  location_id UUID NULL,
  region_id UUID NULL,

  -- Treatment plan item API fields (prefixed with tpi_)
  tpi_id BIGINT NULL, -- id from API response (int11 equivalent)
  tpi_charged BOOLEAN DEFAULT FALSE,
  tpi_completed_at TIMESTAMPTZ NULL,
  tpi_completed BOOLEAN DEFAULT FALSE,
  tpi_invoice_id BIGINT NULL,
  tpi_patient_id BIGINT NULL, -- references patients.pt_id (external API ID)
  tpi_patient_nomenclature VARCHAR(255) NULL,
  tpi_payment_plan_id BIGINT NULL,
  tpi_practitioner_id BIGINT NULL,
  tpi_price DECIMAL(15, 2) NULL,
  tpi_treatment_appointment_id BIGINT NULL, -- references treatment_appointments.ta_id (external API ID)
  tpi_treatment_plan_id BIGINT NULL, -- references treatment_plans.tp_id (external API ID)
  tpi_updated_at TIMESTAMPTZ NULL,

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
  CONSTRAINT treatment_plan_items_pkey PRIMARY KEY (id),

  -- Foreign keys
  CONSTRAINT treatment_plan_items_organization_id_fkey
    FOREIGN KEY (organization_id)
    REFERENCES public.organizations(id)
    ON DELETE CASCADE,

  CONSTRAINT treatment_plan_items_location_id_fkey
    FOREIGN KEY (location_id)
    REFERENCES public.practice_locations(id)
    ON DELETE SET NULL,

  CONSTRAINT treatment_plan_items_region_id_fkey
    FOREIGN KEY (region_id)
    REFERENCES public.regions(id)
    ON DELETE SET NULL,

  CONSTRAINT treatment_plan_items_user_id_fkey
    FOREIGN KEY (user_id)
    REFERENCES auth.users(id)
    ON DELETE SET NULL,

  CONSTRAINT treatment_plan_items_created_by_fkey
    FOREIGN KEY (created_by)
    REFERENCES auth.users(id)
    ON DELETE SET NULL,

  CONSTRAINT treatment_plan_items_updated_by_fkey
    FOREIGN KEY (updated_by)
    REFERENCES auth.users(id)
    ON DELETE SET NULL,

  CONSTRAINT treatment_plan_items_deleted_by_fkey
    FOREIGN KEY (deleted_by)
    REFERENCES auth.users(id)
    ON DELETE SET NULL
);

-- Note: tpi_patient_id, tpi_treatment_plan_id, and tpi_treatment_appointment_id reference external API IDs
-- (patients.pt_id, treatment_plans.tp_id, and treatment_appointments.ta_id) which are not unique across organizations.
-- Foreign key constraints are not created for these, but indexes are added for query performance.

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_treatment_plan_items_organization_id
  ON public.treatment_plan_items(organization_id);

CREATE INDEX IF NOT EXISTS idx_treatment_plan_items_location_id
  ON public.treatment_plan_items(location_id);

CREATE INDEX IF NOT EXISTS idx_treatment_plan_items_region_id
  ON public.treatment_plan_items(region_id);

CREATE INDEX IF NOT EXISTS idx_treatment_plan_items_tpi_id
  ON public.treatment_plan_items(tpi_id);

CREATE INDEX IF NOT EXISTS idx_treatment_plan_items_tpi_patient_id
  ON public.treatment_plan_items(organization_id, tpi_patient_id);

CREATE INDEX IF NOT EXISTS idx_treatment_plan_items_tpi_treatment_plan_id
  ON public.treatment_plan_items(organization_id, tpi_treatment_plan_id);

CREATE INDEX IF NOT EXISTS idx_treatment_plan_items_tpi_treatment_appointment_id
  ON public.treatment_plan_items(organization_id, tpi_treatment_appointment_id);

CREATE INDEX IF NOT EXISTS idx_treatment_plan_items_tpi_completed
  ON public.treatment_plan_items(tpi_completed);

CREATE INDEX IF NOT EXISTS idx_treatment_plan_items_tpi_charged
  ON public.treatment_plan_items(tpi_charged);

CREATE INDEX IF NOT EXISTS idx_treatment_plan_items_tpi_practitioner_id
  ON public.treatment_plan_items(tpi_practitioner_id);

CREATE INDEX IF NOT EXISTS idx_treatment_plan_items_tpi_payment_plan_id
  ON public.treatment_plan_items(tpi_payment_plan_id);

CREATE INDEX IF NOT EXISTS idx_treatment_plan_items_tpi_invoice_id
  ON public.treatment_plan_items(tpi_invoice_id);

CREATE INDEX IF NOT EXISTS idx_treatment_plan_items_user_id
  ON public.treatment_plan_items(user_id);

CREATE INDEX IF NOT EXISTS idx_treatment_plan_items_deleted_at
  ON public.treatment_plan_items(deleted_at);

-- Create index for common queries (active treatment plan items)
CREATE INDEX IF NOT EXISTS idx_treatment_plan_items_active
  ON public.treatment_plan_items(organization_id, tpi_completed)
  WHERE deleted_at IS NULL;

-- Create composite index for treatment plan items by plan
CREATE INDEX IF NOT EXISTS idx_treatment_plan_items_by_plan
  ON public.treatment_plan_items(organization_id, tpi_treatment_plan_id, tpi_completed)
  WHERE deleted_at IS NULL;

-- Create composite index for patient treatment plan items
CREATE INDEX IF NOT EXISTS idx_treatment_plan_items_by_patient
  ON public.treatment_plan_items(organization_id, tpi_patient_id, tpi_completed)
  WHERE deleted_at IS NULL;

-- Add comments to the table and key columns
COMMENT ON TABLE public.treatment_plan_items IS 'Stores treatment plan item data synced from external APIs (e.g., Dentally)';
COMMENT ON COLUMN public.treatment_plan_items.id IS 'Primary key (auto-generated UUID)';
COMMENT ON COLUMN public.treatment_plan_items.tpi_id IS 'Numeric ID from external API';
COMMENT ON COLUMN public.treatment_plan_items.tpi_patient_id IS 'Patient ID from external API (references patients.pt_id)';
COMMENT ON COLUMN public.treatment_plan_items.tpi_treatment_plan_id IS 'Treatment plan ID from external API (references treatment_plans.tp_id)';
COMMENT ON COLUMN public.treatment_plan_items.tpi_treatment_appointment_id IS 'Treatment appointment ID from external API (references treatment_appointments.ta_id)';
COMMENT ON COLUMN public.treatment_plan_items.tpi_completed IS 'Whether the treatment plan item is completed';
COMMENT ON COLUMN public.treatment_plan_items.tpi_charged IS 'Whether the treatment plan item has been charged';
COMMENT ON COLUMN public.treatment_plan_items.tpi_price IS 'Price of the treatment plan item';
COMMENT ON COLUMN public.treatment_plan_items.user_id IS 'Supabase auth user who synced this treatment plan item';

-- Enable Row Level Security (RLS)
ALTER TABLE public.treatment_plan_items ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for organization access
CREATE POLICY treatment_plan_items_org_isolation
  ON public.treatment_plan_items
  FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id
      FROM public.user_roles
      WHERE user_id = auth.uid()
    )
  );

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_treatment_plan_items_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_treatment_plan_items_updated_at
    BEFORE UPDATE ON public.treatment_plan_items
    FOR EACH ROW
    EXECUTE FUNCTION update_treatment_plan_items_updated_at();
