-- Create platform_credit_note_allocations table
CREATE TABLE IF NOT EXISTS public.platform_credit_note_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Foreign Keys
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    platform_integration_id UUID REFERENCES public.platform_integrations(id) ON DELETE CASCADE,
    platform_integration_organization_id UUID REFERENCES public.platform_integration_organizations(id) ON DELETE CASCADE,
    credit_note_id UUID REFERENCES public.platform_credit_notes(id) ON DELETE CASCADE,
    
    -- Platform Identifiers
    allocation_id VARCHAR(500),
    platform_credit_note_id VARCHAR(500), -- Reference to platform credit note ID (not UUID)
    
    -- Allocation Details (NUMERIC to match current DB)
    allocation_amount NUMERIC(10, 2) DEFAULT 0,
    allocation_date DATE NOT NULL,
    invoice_id VARCHAR(500),
    invoice_number VARCHAR(500),
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT platform_credit_note_allocations_unique_per_allocation UNIQUE (organization_id, platform_integration_organization_id, platform_credit_note_id, allocation_id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_platform_credit_note_allocations_organization_id ON public.platform_credit_note_allocations(organization_id);
CREATE INDEX IF NOT EXISTS idx_platform_credit_note_allocations_platform_integration_id ON public.platform_credit_note_allocations(platform_integration_id);
CREATE INDEX IF NOT EXISTS idx_platform_credit_note_allocations_platform_integration_org_id ON public.platform_credit_note_allocations(platform_integration_organization_id);
CREATE INDEX IF NOT EXISTS idx_platform_credit_note_allocations_credit_note_id ON public.platform_credit_note_allocations(credit_note_id);
CREATE INDEX IF NOT EXISTS idx_platform_credit_note_allocations_platform_credit_note_id ON public.platform_credit_note_allocations(platform_credit_note_id);
CREATE INDEX IF NOT EXISTS idx_platform_credit_note_allocations_allocation_id ON public.platform_credit_note_allocations(allocation_id);
CREATE INDEX IF NOT EXISTS idx_platform_credit_note_allocations_invoice_id ON public.platform_credit_note_allocations(invoice_id);

-- Enable RLS
ALTER TABLE public.platform_credit_note_allocations ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Users can view platform credit note allocations in their org" ON public.platform_credit_note_allocations;
CREATE POLICY "Users can view platform credit note allocations in their org"
ON public.platform_credit_note_allocations FOR SELECT
USING (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can insert platform credit note allocations in their org" ON public.platform_credit_note_allocations;
CREATE POLICY "Users can insert platform credit note allocations in their org"
ON public.platform_credit_note_allocations FOR INSERT
WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can update platform credit note allocations in their org" ON public.platform_credit_note_allocations;
CREATE POLICY "Users can update platform credit note allocations in their org"
ON public.platform_credit_note_allocations FOR UPDATE
USING (public.user_in_org(auth.uid(), organization_id))
WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can delete platform credit note allocations in their org" ON public.platform_credit_note_allocations;
CREATE POLICY "Users can delete platform credit note allocations in their org"
ON public.platform_credit_note_allocations FOR DELETE
USING (public.user_in_org(auth.uid(), organization_id));

-- Update trigger
CREATE OR REPLACE FUNCTION update_platform_credit_note_allocations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_platform_credit_note_allocations_updated_at ON public.platform_credit_note_allocations;
CREATE TRIGGER update_platform_credit_note_allocations_updated_at
    BEFORE UPDATE ON public.platform_credit_note_allocations
    FOR EACH ROW
    EXECUTE FUNCTION update_platform_credit_note_allocations_updated_at();
