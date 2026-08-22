-- Create platform_journals table
CREATE TABLE IF NOT EXISTS public.platform_journals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Foreign Keys
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    platform_integration_id UUID REFERENCES public.platform_integrations(id) ON DELETE CASCADE,
    platform_integration_organization_id UUID REFERENCES public.platform_integration_organizations(id) ON DELETE CASCADE,
    
    -- Platform Identifiers
    journal_id VARCHAR(500),
    journal_number INTEGER NOT NULL,
    
    -- Journal Details
    journal_date DATE NOT NULL,
    platform_created_date_utc TIMESTAMP WITH TIME ZONE NOT NULL,
    reference TEXT,
    source_id VARCHAR(500),
    source_type VARCHAR(100) NOT NULL,
    source_type_desc VARCHAR(200),
    
    -- Financial Details (NUMERIC to match current DB)
    total_amount NUMERIC(10, 2) DEFAULT 0,
    due_amount NUMERIC(10, 2) DEFAULT 0,
    
    -- Contact Details
    contact_id VARCHAR(500),
    contact_name VARCHAR(500),
    
    -- Status Flags
    is_deleted_from_platform BOOLEAN DEFAULT false,
    is_ignore_transactions BOOLEAN DEFAULT false,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT platform_journals_unique_per_org UNIQUE (organization_id, platform_integration_organization_id, journal_id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_platform_journals_organization_id ON public.platform_journals(organization_id);
CREATE INDEX IF NOT EXISTS idx_platform_journals_platform_integration_id ON public.platform_journals(platform_integration_id);
CREATE INDEX IF NOT EXISTS idx_platform_journals_platform_integration_org_id ON public.platform_journals(platform_integration_organization_id);
CREATE INDEX IF NOT EXISTS idx_platform_journals_journal_id ON public.platform_journals(journal_id);
CREATE INDEX IF NOT EXISTS idx_platform_journals_journal_number ON public.platform_journals(journal_number);
CREATE INDEX IF NOT EXISTS idx_platform_journals_journal_date ON public.platform_journals(journal_date);
CREATE INDEX IF NOT EXISTS idx_platform_journals_source_type ON public.platform_journals(source_type);
CREATE INDEX IF NOT EXISTS idx_platform_journals_source_id ON public.platform_journals(source_id);
CREATE INDEX IF NOT EXISTS idx_platform_journals_platform_created_date_utc ON public.platform_journals(platform_created_date_utc);

-- Enable RLS
ALTER TABLE public.platform_journals ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Users can view platform journals in their org" ON public.platform_journals;
CREATE POLICY "Users can view platform journals in their org"
ON public.platform_journals FOR SELECT
USING (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can insert platform journals in their org" ON public.platform_journals;
CREATE POLICY "Users can insert platform journals in their org"
ON public.platform_journals FOR INSERT
WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can update platform journals in their org" ON public.platform_journals;
CREATE POLICY "Users can update platform journals in their org"
ON public.platform_journals FOR UPDATE
USING (public.user_in_org(auth.uid(), organization_id))
WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can delete platform journals in their org" ON public.platform_journals;
CREATE POLICY "Users can delete platform journals in their org"
ON public.platform_journals FOR DELETE
USING (public.user_in_org(auth.uid(), organization_id));

-- Update trigger
CREATE OR REPLACE FUNCTION update_platform_journals_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_platform_journals_updated_at ON public.platform_journals;
CREATE TRIGGER update_platform_journals_updated_at
    BEFORE UPDATE ON public.platform_journals
    FOR EACH ROW
    EXECUTE FUNCTION update_platform_journals_updated_at();
