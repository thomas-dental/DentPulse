-- Create treatment_budget_planning table
-- Stores planned/budget values for treatments (volume, revenue, margin targets)

CREATE TABLE IF NOT EXISTS public.treatment_budget_planning (
  -- Primary key
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  
  -- Foreign keys
  treatment_id UUID NOT NULL REFERENCES public.treatments(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES public.practice_locations(id) ON DELETE CASCADE,
  
  -- Period (year-month format: '2024-01', '2024-02', etc.)
  period VARCHAR(7) NOT NULL,
  
  -- Planned values
  planned_volume INTEGER DEFAULT 0,
  planned_revenue DECIMAL(15, 2) DEFAULT 0,
  target_margin DECIMAL(5, 2) DEFAULT 0, -- Percentage (e.g., 35.5 for 35.5%)
  
  -- Audit fields
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  
  -- Primary key constraint
  CONSTRAINT treatment_budget_planning_pkey PRIMARY KEY (id),
  
  -- Unique constraint: one plan per treatment per location per period
  CONSTRAINT treatment_budget_planning_unique UNIQUE (treatment_id, organization_id, location_id, period)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_treatment_budget_planning_treatment_id
  ON public.treatment_budget_planning(treatment_id);

CREATE INDEX IF NOT EXISTS idx_treatment_budget_planning_organization_id
  ON public.treatment_budget_planning(organization_id);

CREATE INDEX IF NOT EXISTS idx_treatment_budget_planning_location_id
  ON public.treatment_budget_planning(location_id);

CREATE INDEX IF NOT EXISTS idx_treatment_budget_planning_period
  ON public.treatment_budget_planning(period);

CREATE INDEX IF NOT EXISTS idx_treatment_budget_planning_org_location_period
  ON public.treatment_budget_planning(organization_id, location_id, period);

-- Enable RLS
ALTER TABLE public.treatment_budget_planning ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can view/edit budget planning for their organization
CREATE POLICY treatment_budget_planning_org_isolation
  ON public.treatment_budget_planning
  FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id
      FROM public.user_roles
      WHERE user_id = auth.uid()
    )
  );

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_treatment_budget_planning_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_treatment_budget_planning_updated_at
    BEFORE UPDATE ON public.treatment_budget_planning
    FOR EACH ROW
    EXECUTE FUNCTION update_treatment_budget_planning_updated_at();

-- Add comments
COMMENT ON TABLE public.treatment_budget_planning IS 'Stores planned/budget values for treatments (volume, revenue, margin targets) per location';
COMMENT ON COLUMN public.treatment_budget_planning.location_id IS 'Location ID (required) - budget planning is location-specific';
COMMENT ON COLUMN public.treatment_budget_planning.period IS 'Period in YYYY-MM format (e.g., 2024-01 for January 2024)';
COMMENT ON COLUMN public.treatment_budget_planning.planned_volume IS 'Planned number of treatments for the period';
COMMENT ON COLUMN public.treatment_budget_planning.planned_revenue IS 'Planned revenue for the period';
COMMENT ON COLUMN public.treatment_budget_planning.target_margin IS 'Target margin percentage (e.g., 35.5 for 35.5%)';
