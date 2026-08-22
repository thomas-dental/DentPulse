-- Create nhs_claims table for Supabase
-- Stores NHS claim data synced from Dentally API (/v1/nhs_claims)

CREATE TABLE IF NOT EXISTS public.nhs_claims (
  -- Primary key with UUID auto-generation
  id UUID NOT NULL DEFAULT gen_random_uuid(),

  -- Organization and location references
  organization_id UUID NOT NULL,
  location_id UUID NULL,
  region_id UUID NULL,

  -- NHS claim API fields (prefixed with nc_)
  nc_id BIGINT NULL, -- id from Dentally API
  nc_claim_status VARCHAR(50) NULL, -- new, queued, submitted, completed, error, invalid, received, queried, withdrawn
  nc_sequence_number VARCHAR(100) NULL, -- NHS reference number
  nc_approval_date TIMESTAMPTZ NULL,
  nc_submitted_date TIMESTAMPTZ NULL,

  -- Financial fields
  nc_awarded_uda DECIMAL(15, 4) NULL, -- UDA amount awarded by NHS
  nc_expected_uda DECIMAL(15, 4) NULL, -- Claimed UDA value
  nc_uda_band VARCHAR(50) NULL, -- UDA band classification
  nc_dentist_charge DECIMAL(15, 2) NULL, -- Practitioner fee amount
  nc_patient_charge DECIMAL(15, 2) NULL, -- Patient fee amount

  -- Northern Ireland specific
  nc_ni_dentist_fee DECIMAL(15, 2) NULL,
  nc_ni_patient_fee DECIMAL(15, 2) NULL,

  -- Scotland specific
  nc_scot_amount_authorised DECIMAL(15, 2) NULL,
  nc_scot_amount_expected DECIMAL(15, 2) NULL,

  -- Relationship fields (external API IDs)
  nc_patient_id BIGINT NULL, -- references patients.pt_id
  nc_practitioner_id BIGINT NULL, -- references providers.external_id
  nc_treatment_plan_id BIGINT NULL, -- references treatment_plans.tp_id
  nc_site_id VARCHAR(255) NULL, -- Dentally site UUID
  nc_contract_id BIGINT NULL,

  -- Additional fields
  nc_ortho BOOLEAN DEFAULT FALSE, -- Orthodontic claim
  nc_continuation_part_number VARCHAR(50) NULL,
  nc_status_comments TEXT NULL,

  -- Dentally timestamps
  nc_created_at TIMESTAMPTZ NULL,
  nc_updated_at TIMESTAMPTZ NULL,
  nc_nhs_updated_at TIMESTAMPTZ NULL,

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
  CONSTRAINT nhs_claims_pkey PRIMARY KEY (id),

  -- Foreign keys
  CONSTRAINT nhs_claims_organization_id_fkey
    FOREIGN KEY (organization_id)
    REFERENCES public.organizations(id)
    ON DELETE CASCADE,

  CONSTRAINT nhs_claims_location_id_fkey
    FOREIGN KEY (location_id)
    REFERENCES public.practice_locations(id)
    ON DELETE SET NULL,

  CONSTRAINT nhs_claims_region_id_fkey
    FOREIGN KEY (region_id)
    REFERENCES public.regions(id)
    ON DELETE SET NULL,

  CONSTRAINT nhs_claims_user_id_fkey
    FOREIGN KEY (user_id)
    REFERENCES auth.users(id)
    ON DELETE SET NULL,

  CONSTRAINT nhs_claims_created_by_fkey
    FOREIGN KEY (created_by)
    REFERENCES auth.users(id)
    ON DELETE SET NULL,

  CONSTRAINT nhs_claims_updated_by_fkey
    FOREIGN KEY (updated_by)
    REFERENCES auth.users(id)
    ON DELETE SET NULL,

  CONSTRAINT nhs_claims_deleted_by_fkey
    FOREIGN KEY (deleted_by)
    REFERENCES auth.users(id)
    ON DELETE SET NULL,

  -- Unique constraint for API record (prevent duplicate claims from API)
  CONSTRAINT nhs_claims_org_nc_id_key
    UNIQUE (organization_id, nc_id)
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_nhs_claims_organization_id
  ON public.nhs_claims(organization_id);

CREATE INDEX IF NOT EXISTS idx_nhs_claims_location_id
  ON public.nhs_claims(location_id);

CREATE INDEX IF NOT EXISTS idx_nhs_claims_region_id
  ON public.nhs_claims(region_id);

CREATE INDEX IF NOT EXISTS idx_nhs_claims_nc_id
  ON public.nhs_claims(nc_id);

CREATE INDEX IF NOT EXISTS idx_nhs_claims_nc_patient_id
  ON public.nhs_claims(organization_id, nc_patient_id);

CREATE INDEX IF NOT EXISTS idx_nhs_claims_nc_practitioner_id
  ON public.nhs_claims(organization_id, nc_practitioner_id);

CREATE INDEX IF NOT EXISTS idx_nhs_claims_nc_treatment_plan_id
  ON public.nhs_claims(organization_id, nc_treatment_plan_id);

CREATE INDEX IF NOT EXISTS idx_nhs_claims_nc_claim_status
  ON public.nhs_claims(nc_claim_status);

CREATE INDEX IF NOT EXISTS idx_nhs_claims_nc_submitted_date
  ON public.nhs_claims(nc_submitted_date);

CREATE INDEX IF NOT EXISTS idx_nhs_claims_nc_approval_date
  ON public.nhs_claims(nc_approval_date);

CREATE INDEX IF NOT EXISTS idx_nhs_claims_user_id
  ON public.nhs_claims(user_id);

CREATE INDEX IF NOT EXISTS idx_nhs_claims_deleted_at
  ON public.nhs_claims(deleted_at);

-- Create index for common queries (active claims)
CREATE INDEX IF NOT EXISTS idx_nhs_claims_active
  ON public.nhs_claims(organization_id, nc_claim_status)
  WHERE deleted_at IS NULL;

-- Create composite index for patient claims
CREATE INDEX IF NOT EXISTS idx_nhs_claims_by_patient
  ON public.nhs_claims(organization_id, nc_patient_id, nc_claim_status)
  WHERE deleted_at IS NULL;

-- Add comments
COMMENT ON TABLE public.nhs_claims IS 'Stores NHS claim data synced from Dentally API';
COMMENT ON COLUMN public.nhs_claims.id IS 'Primary key (auto-generated UUID)';
COMMENT ON COLUMN public.nhs_claims.nc_id IS 'Numeric ID from Dentally API';
COMMENT ON COLUMN public.nhs_claims.nc_claim_status IS 'Claim status: new, queued, submitted, completed, error, invalid, received, queried, withdrawn';
COMMENT ON COLUMN public.nhs_claims.nc_sequence_number IS 'NHS reference number';
COMMENT ON COLUMN public.nhs_claims.nc_awarded_uda IS 'UDA amount awarded by NHS';
COMMENT ON COLUMN public.nhs_claims.nc_expected_uda IS 'Claimed UDA value';
COMMENT ON COLUMN public.nhs_claims.nc_dentist_charge IS 'Practitioner fee amount';
COMMENT ON COLUMN public.nhs_claims.nc_patient_charge IS 'Patient fee amount';
COMMENT ON COLUMN public.nhs_claims.nc_ortho IS 'Whether this is an orthodontic claim';

-- Enable Row Level Security (RLS)
ALTER TABLE public.nhs_claims ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for organization access
CREATE POLICY nhs_claims_org_isolation
  ON public.nhs_claims
  FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id
      FROM public.user_roles
      WHERE user_id = auth.uid()
    )
  );

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_nhs_claims_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_nhs_claims_updated_at
    BEFORE UPDATE ON public.nhs_claims
    FOR EACH ROW
    EXECUTE FUNCTION update_nhs_claims_updated_at();
