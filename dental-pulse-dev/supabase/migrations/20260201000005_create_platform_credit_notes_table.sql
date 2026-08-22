-- Create platform_credit_notes table
CREATE TABLE IF NOT EXISTS public.platform_credit_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Foreign Keys
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    platform_integration_id UUID REFERENCES public.platform_integrations(id) ON DELETE CASCADE,
    platform_integration_organization_id UUID REFERENCES public.platform_integration_organizations(id) ON DELETE CASCADE,
    
    -- Platform Identifiers
    credit_note_id VARCHAR(500),
    credit_note_number VARCHAR(500) NOT NULL,
    account_type VARCHAR(100) NOT NULL,
    
    -- Credit Note Details
    credit_note_reference VARCHAR(500),
    fully_paid_on_date DATE,
    credit_note_date DATE,
    
    -- Financial Details (NUMERIC to match current DB)
    sub_total NUMERIC(10, 2) DEFAULT 0,
    total_tax NUMERIC(10, 2) DEFAULT 0,
    total NUMERIC(10, 2) DEFAULT 0,
    remaining_credit NUMERIC(10, 2) DEFAULT 0,
    currency_rate NUMERIC(10, 4) DEFAULT 0,
    currency_code VARCHAR(10),
    
    -- Payment Details (from first payment if exists)
    payment_id VARCHAR(500),
    payment_date DATE,
    payment_amount NUMERIC(10, 2) DEFAULT 0,
    payment_reference VARCHAR(500),
    
    -- Allocation Details (from first allocation if exists)
    allocation_id VARCHAR(500),
    allocation_amount NUMERIC(10, 2) DEFAULT 0,
    allocation_date DATE,
    invoice_id VARCHAR(500),
    invoice_number VARCHAR(500),
    
    -- Contact Details
    contact_id VARCHAR(500),
    contact_name VARCHAR(500),
    
    -- Status
    status VARCHAR(100),
    
    -- Timestamps
    updated_date_utc TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT platform_credit_notes_unique_per_org UNIQUE (organization_id, platform_integration_organization_id, credit_note_id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_platform_credit_notes_organization_id ON public.platform_credit_notes(organization_id);
CREATE INDEX IF NOT EXISTS idx_platform_credit_notes_platform_integration_id ON public.platform_credit_notes(platform_integration_id);
CREATE INDEX IF NOT EXISTS idx_platform_credit_notes_platform_integration_org_id ON public.platform_credit_notes(platform_integration_organization_id);
CREATE INDEX IF NOT EXISTS idx_platform_credit_notes_credit_note_id ON public.platform_credit_notes(credit_note_id);
CREATE INDEX IF NOT EXISTS idx_platform_credit_notes_credit_note_number ON public.platform_credit_notes(credit_note_number);
CREATE INDEX IF NOT EXISTS idx_platform_credit_notes_account_type ON public.platform_credit_notes(account_type);
CREATE INDEX IF NOT EXISTS idx_platform_credit_notes_status ON public.platform_credit_notes(status);
CREATE INDEX IF NOT EXISTS idx_platform_credit_notes_credit_note_date ON public.platform_credit_notes(credit_note_date);
CREATE INDEX IF NOT EXISTS idx_platform_credit_notes_updated_date_utc ON public.platform_credit_notes(updated_date_utc);
CREATE INDEX IF NOT EXISTS idx_platform_credit_notes_contact_id ON public.platform_credit_notes(contact_id);

-- Enable RLS
ALTER TABLE public.platform_credit_notes ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Users can view platform credit notes in their org" ON public.platform_credit_notes;
CREATE POLICY "Users can view platform credit notes in their org"
ON public.platform_credit_notes FOR SELECT
USING (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can insert platform credit notes in their org" ON public.platform_credit_notes;
CREATE POLICY "Users can insert platform credit notes in their org"
ON public.platform_credit_notes FOR INSERT
WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can update platform credit notes in their org" ON public.platform_credit_notes;
CREATE POLICY "Users can update platform credit notes in their org"
ON public.platform_credit_notes FOR UPDATE
USING (public.user_in_org(auth.uid(), organization_id))
WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can delete platform credit notes in their org" ON public.platform_credit_notes;
CREATE POLICY "Users can delete platform credit notes in their org"
ON public.platform_credit_notes FOR DELETE
USING (public.user_in_org(auth.uid(), organization_id));

-- Update trigger
CREATE OR REPLACE FUNCTION update_platform_credit_notes_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_platform_credit_notes_updated_at ON public.platform_credit_notes;
CREATE TRIGGER update_platform_credit_notes_updated_at
    BEFORE UPDATE ON public.platform_credit_notes
    FOR EACH ROW
    EXECUTE FUNCTION update_platform_credit_notes_updated_at();
