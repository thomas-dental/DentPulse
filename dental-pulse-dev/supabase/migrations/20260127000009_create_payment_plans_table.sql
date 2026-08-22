-- Create payment_plans table for Supabase
-- Stores payment plan data synced from external APIs (e.g., Dentally)

CREATE TABLE IF NOT EXISTS public.payment_plans (
  -- Primary key with UUID auto-generation
  id UUID NOT NULL DEFAULT gen_random_uuid(),

  -- Organization and location references
  organization_id UUID NOT NULL,
  location_id UUID NULL,
  region_id UUID NULL,

  -- Payment plan API fields (prefixed with pp_)
  pp_id BIGINT NULL, -- id from API response
  pp_name VARCHAR(255) NULL,
  pp_is_active BOOLEAN DEFAULT TRUE,
  pp_dentist_recall_interval INTEGER NULL,
  pp_emergency_duration INTEGER NULL,
  pp_exam_appointments_included INTEGER NULL,
  pp_exam_duration INTEGER NULL,
  pp_exam_scale_and_polish_duration INTEGER NULL,
  pp_hygiene_appointments_included INTEGER NULL,
  pp_hygienist_recall_interval INTEGER NULL,
  pp_monthly_memberhsip_fee DECIMAL(15, 2) NULL,
  pp_patient_friendly_name VARCHAR(255) NULL,
  pp_recall_method VARCHAR(100) NULL,
  pp_scale_and_polish_duration INTEGER NULL,
  pp_colour VARCHAR(50) NULL, -- colour from API
  pp_site_id UUID NULL, -- site_id from API
  pp_created_at TIMESTAMPTZ NULL,

  -- User reference
  user_id UUID NULL,

  -- Standard audit fields
  created_at TIMESTAMPTZ NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ NULL,
  created_by UUID NULL,
  updated_by UUID NULL,

  -- Primary key constraint
  CONSTRAINT payment_plans_pkey PRIMARY KEY (id),

  -- Foreign keys
  CONSTRAINT payment_plans_organization_id_fkey
    FOREIGN KEY (organization_id)
    REFERENCES public.organizations(id)
    ON DELETE CASCADE,

  CONSTRAINT payment_plans_location_id_fkey
    FOREIGN KEY (location_id)
    REFERENCES public.practice_locations(id)
    ON DELETE SET NULL,

  CONSTRAINT payment_plans_region_id_fkey
    FOREIGN KEY (region_id)
    REFERENCES public.regions(id)
    ON DELETE SET NULL,

  -- Unique constraint for API record (prevent duplicate payment plans from API)
  CONSTRAINT payment_plans_org_pp_id_key
    UNIQUE (organization_id, pp_id)
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_payment_plans_organization_id
  ON public.payment_plans(organization_id);

CREATE INDEX IF NOT EXISTS idx_payment_plans_location_id
  ON public.payment_plans(location_id);

CREATE INDEX IF NOT EXISTS idx_payment_plans_region_id
  ON public.payment_plans(region_id);

CREATE INDEX IF NOT EXISTS idx_payment_plans_pp_id
  ON public.payment_plans(pp_id);

CREATE INDEX IF NOT EXISTS idx_payment_plans_pp_is_active
  ON public.payment_plans(pp_is_active);

CREATE INDEX IF NOT EXISTS idx_payment_plans_user_id
  ON public.payment_plans(user_id);

CREATE INDEX IF NOT EXISTS idx_payment_plans_deleted_at
  ON public.payment_plans(deleted_at);

-- Create index for common queries (active payment plans)
CREATE INDEX IF NOT EXISTS idx_payment_plans_active
  ON public.payment_plans(organization_id, pp_is_active)
  WHERE deleted_at IS NULL;

-- Add comments to the table and key columns
COMMENT ON TABLE public.payment_plans IS 'Stores payment plan data synced from external APIs (e.g., Dentally)';
COMMENT ON COLUMN public.payment_plans.id IS 'Primary key (auto-generated UUID)';
COMMENT ON COLUMN public.payment_plans.pp_id IS 'Numeric ID from external API';
COMMENT ON COLUMN public.payment_plans.pp_is_active IS 'Whether the payment plan is active';
COMMENT ON COLUMN public.payment_plans.pp_monthly_memberhsip_fee IS 'Monthly membership fee for the payment plan';

-- Enable Row Level Security (RLS)
ALTER TABLE public.payment_plans ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for organization access
CREATE POLICY payment_plans_org_isolation
  ON public.payment_plans
  FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id
      FROM public.user_roles
      WHERE user_id = auth.uid()
    )
  );
