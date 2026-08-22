-- Create treatment_plans table for Supabase
-- Stores treatment plan data synced from external APIs (e.g., Dentally)

CREATE TABLE IF NOT EXISTS public.treatment_plans (
  -- Primary key with UUID auto-generation
  id UUID NOT NULL DEFAULT gen_random_uuid(),

  -- Organization and location references
  organization_id UUID NOT NULL,
  location_id UUID NULL,
  region_id UUID NULL,

  -- Treatment plan API fields (prefixed with tp_)
  tp_id BIGINT NULL, -- id from API response
  tp_nickname VARCHAR(255) NULL,
  tp_patient_id BIGINT NULL,
  tp_practitioner_id BIGINT NULL,
  tp_private_treatment_value DECIMAL(15, 2) NULL,
  tp_start_date DATE NULL,
  tp_completed_at TIMESTAMPTZ NULL,
  tp_is_completed BOOLEAN DEFAULT FALSE,
  tp_end_date DATE NULL,
  tp_last_completed_at TIMESTAMPTZ NULL,
  tp_created_at TIMESTAMPTZ NULL,
  tp_updated_at TIMESTAMPTZ NULL,

  -- User reference
  user_id UUID NULL,

  -- Standard audit fields
  created_at TIMESTAMPTZ NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ NULL,
  created_by UUID NULL,
  updated_by UUID NULL,

  -- Primary key constraint
  CONSTRAINT treatment_plans_pkey PRIMARY KEY (id),

  -- Foreign keys
  CONSTRAINT treatment_plans_organization_id_fkey
    FOREIGN KEY (organization_id)
    REFERENCES public.organizations(id)
    ON DELETE CASCADE,

  CONSTRAINT treatment_plans_location_id_fkey
    FOREIGN KEY (location_id)
    REFERENCES public.practice_locations(id)
    ON DELETE SET NULL,

  CONSTRAINT treatment_plans_region_id_fkey
    FOREIGN KEY (region_id)
    REFERENCES public.regions(id)
    ON DELETE SET NULL,

  -- Unique constraint for API record (prevent duplicate treatment plans from API)
  CONSTRAINT treatment_plans_org_tp_id_key
    UNIQUE (organization_id, tp_id)
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_treatment_plans_organization_id
  ON public.treatment_plans(organization_id);

CREATE INDEX IF NOT EXISTS idx_treatment_plans_location_id
  ON public.treatment_plans(location_id);

CREATE INDEX IF NOT EXISTS idx_treatment_plans_region_id
  ON public.treatment_plans(region_id);

CREATE INDEX IF NOT EXISTS idx_treatment_plans_tp_id
  ON public.treatment_plans(tp_id);

CREATE INDEX IF NOT EXISTS idx_treatment_plans_tp_patient_id
  ON public.treatment_plans(tp_patient_id);

CREATE INDEX IF NOT EXISTS idx_treatment_plans_tp_practitioner_id
  ON public.treatment_plans(tp_practitioner_id);

CREATE INDEX IF NOT EXISTS idx_treatment_plans_tp_is_completed
  ON public.treatment_plans(tp_is_completed);

CREATE INDEX IF NOT EXISTS idx_treatment_plans_user_id
  ON public.treatment_plans(user_id);

CREATE INDEX IF NOT EXISTS idx_treatment_plans_deleted_at
  ON public.treatment_plans(deleted_at);

-- Create index for common queries (active treatment plans)
CREATE INDEX IF NOT EXISTS idx_treatment_plans_active
  ON public.treatment_plans(organization_id, tp_is_completed)
  WHERE deleted_at IS NULL;

-- Create index for patient treatment plans
CREATE INDEX IF NOT EXISTS idx_treatment_plans_patient_active
  ON public.treatment_plans(tp_patient_id, tp_is_completed)
  WHERE deleted_at IS NULL;

-- Add comments to the table and key columns
COMMENT ON TABLE public.treatment_plans IS 'Stores treatment plan data synced from external APIs (e.g., Dentally)';
COMMENT ON COLUMN public.treatment_plans.id IS 'Primary key (auto-generated UUID)';
COMMENT ON COLUMN public.treatment_plans.tp_id IS 'Numeric ID from external API';
COMMENT ON COLUMN public.treatment_plans.tp_patient_id IS 'Patient ID from external API';
COMMENT ON COLUMN public.treatment_plans.tp_practitioner_id IS 'Practitioner ID from external API';
COMMENT ON COLUMN public.treatment_plans.tp_is_completed IS 'Whether the treatment plan is completed';

-- Enable Row Level Security (RLS)
ALTER TABLE public.treatment_plans ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for organization access
CREATE POLICY treatment_plans_org_isolation
  ON public.treatment_plans
  FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id
      FROM public.user_roles
      WHERE user_id = auth.uid()
    )
  );
