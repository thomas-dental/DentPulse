-- Create treatment_goal_targets table
-- Stores treatment goal targets (unit targets and average amount targets) by category, period, and location/region

CREATE TABLE IF NOT EXISTS public.treatment_goal_targets (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  
  -- Organization and location references
  organization_id UUID NOT NULL,
  location_id UUID NULL,
  region_id UUID NULL,
  
  -- Category reference (by name, not ID, to allow flexibility)
  category_name VARCHAR(255) NOT NULL,
  
  -- Period information
  period_type VARCHAR(10) NOT NULL CHECK (period_type IN ('month', 'year')),
  period_date DATE NOT NULL, -- Start of the period (first day of month or year)
  
  -- Target values
  unit_target NUMERIC(10, 2) NOT NULL DEFAULT 0,
  avg_amount_target NUMERIC(10, 2) NOT NULL DEFAULT 0,
  
  -- Audit fields
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NULL,
  updated_by UUID NULL,
  
  -- Primary key
  CONSTRAINT treatment_goal_targets_pkey PRIMARY KEY (id),
  
  -- Foreign keys
  CONSTRAINT treatment_goal_targets_organization_id_fkey
    FOREIGN KEY (organization_id)
    REFERENCES public.organizations(id)
    ON DELETE CASCADE,
  
  CONSTRAINT treatment_goal_targets_location_id_fkey
    FOREIGN KEY (location_id)
    REFERENCES public.practice_locations(id)
    ON DELETE SET NULL,
  
  CONSTRAINT treatment_goal_targets_region_id_fkey
    FOREIGN KEY (region_id)
    REFERENCES public.regions(id)
    ON DELETE SET NULL,
  
  CONSTRAINT treatment_goal_targets_created_by_fkey
    FOREIGN KEY (created_by)
    REFERENCES auth.users(id)
    ON DELETE SET NULL,
  
  CONSTRAINT treatment_goal_targets_updated_by_fkey
    FOREIGN KEY (updated_by)
    REFERENCES auth.users(id)
    ON DELETE SET NULL
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_treatment_goal_targets_organization_id
  ON public.treatment_goal_targets(organization_id);

CREATE INDEX IF NOT EXISTS idx_treatment_goal_targets_period
  ON public.treatment_goal_targets(organization_id, period_type, period_date);

CREATE INDEX IF NOT EXISTS idx_treatment_goal_targets_category
  ON public.treatment_goal_targets(organization_id, category_name);

CREATE INDEX IF NOT EXISTS idx_treatment_goal_targets_location
  ON public.treatment_goal_targets(location_id)
  WHERE location_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_treatment_goal_targets_region
  ON public.treatment_goal_targets(region_id)
  WHERE region_id IS NOT NULL;

-- Create unique index to prevent duplicate targets
-- Uses COALESCE to handle NULL values in location_id and region_id
CREATE UNIQUE INDEX IF NOT EXISTS idx_treatment_goal_targets_unique
  ON public.treatment_goal_targets(
    organization_id, 
    category_name, 
    period_type, 
    period_date, 
    COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::UUID), 
    COALESCE(region_id, '00000000-0000-0000-0000-000000000000'::UUID)
  );

-- Add comments
COMMENT ON TABLE public.treatment_goal_targets IS 'Stores treatment goal targets (unit and average amount) by category, period type, and period date';
COMMENT ON COLUMN public.treatment_goal_targets.period_type IS 'Type of period: month or year';
COMMENT ON COLUMN public.treatment_goal_targets.period_date IS 'Start date of the period (first day of month or year)';
COMMENT ON COLUMN public.treatment_goal_targets.unit_target IS 'Target number of units (completed treatments) for this category and period';
COMMENT ON COLUMN public.treatment_goal_targets.avg_amount_target IS 'Target average treatment amount for this category and period';

-- Enable Row Level Security (RLS)
ALTER TABLE public.treatment_goal_targets ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for organization access
CREATE POLICY treatment_goal_targets_org_isolation
  ON public.treatment_goal_targets
  FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id
      FROM public.user_roles
      WHERE user_id = auth.uid()
    )
  );

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_treatment_goal_targets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_treatment_goal_targets_updated_at
    BEFORE UPDATE ON public.treatment_goal_targets
    FOR EACH ROW
    EXECUTE FUNCTION update_treatment_goal_targets_updated_at();
