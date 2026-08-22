-- Create planned_daily_production table
-- Stores planned daily production values for providers

CREATE TABLE IF NOT EXISTS public.planned_daily_production (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Foreign Keys
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    provider_id UUID NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- Planned Production Data
    average_daily_production DECIMAL(12, 2) NOT NULL DEFAULT 0.00,

    -- Date Range (for Operations)
    date_range_start DATE NOT NULL,
    date_range_end DATE NOT NULL,

    -- Planning Month
    planning_month DATE NOT NULL,

    -- Calculated Metrics (optional - can be computed on the fly)
    planned_total_production DECIMAL(12, 2),
    planned_associate_net_pay DECIMAL(12, 2),
    planned_cost_of_labs DECIMAL(12, 2),
    planned_materials DECIMAL(12, 2),
    planned_practice_pl DECIMAL(12, 2),
    working_days DECIMAL(10, 2),

    -- Metadata
    notes TEXT,

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_by_email TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Constraints
    CONSTRAINT planned_daily_production_amount_positive CHECK (average_daily_production >= 0),
    CONSTRAINT planned_daily_production_dates_valid CHECK (date_range_end >= date_range_start)
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_planned_daily_production_organization_id
    ON public.planned_daily_production(organization_id);

CREATE INDEX IF NOT EXISTS idx_planned_daily_production_provider_id
    ON public.planned_daily_production(provider_id);

CREATE INDEX IF NOT EXISTS idx_planned_daily_production_user_id
    ON public.planned_daily_production(user_id);

CREATE INDEX IF NOT EXISTS idx_planned_daily_production_date_range
    ON public.planned_daily_production(date_range_start, date_range_end);

CREATE INDEX IF NOT EXISTS idx_planned_daily_production_planning_month
    ON public.planned_daily_production(planning_month);

CREATE INDEX IF NOT EXISTS idx_planned_daily_production_created_at
    ON public.planned_daily_production(created_at DESC);

-- Enable RLS
ALTER TABLE public.planned_daily_production ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Users can view planned production in their organization
DROP POLICY IF EXISTS "Users can view planned production in their org"
    ON public.planned_daily_production;
CREATE POLICY "Users can view planned production in their org"
    ON public.planned_daily_production FOR SELECT
    USING (
        public.user_in_org(auth.uid(), organization_id)
    );

-- Users can insert planned production in their organization
DROP POLICY IF EXISTS "Users can insert planned production in their org"
    ON public.planned_daily_production;
CREATE POLICY "Users can insert planned production in their org"
    ON public.planned_daily_production FOR INSERT
    WITH CHECK (
        public.user_in_org(auth.uid(), organization_id)
    );

-- Users can update planned production in their organization
DROP POLICY IF EXISTS "Users can update planned production in their org"
    ON public.planned_daily_production;
CREATE POLICY "Users can update planned production in their org"
    ON public.planned_daily_production FOR UPDATE
    USING (
        public.user_in_org(auth.uid(), organization_id)
    )
    WITH CHECK (
        public.user_in_org(auth.uid(), organization_id)
    );

-- Users can delete planned production in their organization
DROP POLICY IF EXISTS "Users can delete planned production in their org"
    ON public.planned_daily_production;
CREATE POLICY "Users can delete planned production in their org"
    ON public.planned_daily_production FOR DELETE
    USING (
        public.user_in_org(auth.uid(), organization_id)
    );

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_planned_daily_production_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at
DROP TRIGGER IF EXISTS update_planned_daily_production_updated_at
    ON public.planned_daily_production;
CREATE TRIGGER update_planned_daily_production_updated_at
    BEFORE UPDATE ON public.planned_daily_production
    FOR EACH ROW
    EXECUTE FUNCTION update_planned_daily_production_updated_at();

-- Add comment
COMMENT ON TABLE public.planned_daily_production IS
'Stores planned daily production targets for providers with date ranges and planning months';

COMMENT ON COLUMN public.planned_daily_production.average_daily_production IS
'The planned average daily production amount entered by the user';

COMMENT ON COLUMN public.planned_daily_production.date_range_start IS
'Start date of the operations date range (Date Selection for Operations)';

COMMENT ON COLUMN public.planned_daily_production.date_range_end IS
'End date of the operations date range (Date Selection for Operations)';

COMMENT ON COLUMN public.planned_daily_production.planning_month IS
'The planning month selected (Planning Month field)';
