-- ============================================
-- Denplan Facility Mappings Table
-- Maps Denplan registration facility IDs to their product names.
-- Each CSV downloaded from denplan.co.uk comes from a specific facility
-- (e.g., 256891a = Denplan Care for Mr Adam Lody).
-- ============================================

CREATE TABLE IF NOT EXISTS public.denplan_facility_mappings (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id   UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    facility_id       TEXT NOT NULL,            -- e.g., "256891a"
    product_name      TEXT NOT NULL,            -- e.g., "Denplan Care"
    dentist_name      TEXT,                     -- optional, e.g., "Mr Adam Lody"
    payment_plan_id   UUID,                    -- legacy single-plan slot — superseded by payment_plan_ids
    payment_plan_ids  UUID[] DEFAULT '{}'::UUID[],
    created_at        TIMESTAMPTZ DEFAULT now(),
    updated_at        TIMESTAMPTZ DEFAULT now(),
    UNIQUE(organization_id, facility_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_denplan_facility_org ON public.denplan_facility_mappings(organization_id);
CREATE INDEX IF NOT EXISTS idx_denplan_facility_id ON public.denplan_facility_mappings(organization_id, facility_id);

-- RLS
ALTER TABLE public.denplan_facility_mappings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view facility mappings in their org" ON public.denplan_facility_mappings;
CREATE POLICY "Users can view facility mappings in their org"
ON public.denplan_facility_mappings FOR SELECT
USING (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can insert facility mappings in their org" ON public.denplan_facility_mappings;
CREATE POLICY "Users can insert facility mappings in their org"
ON public.denplan_facility_mappings FOR INSERT
WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can update facility mappings in their org" ON public.denplan_facility_mappings;
CREATE POLICY "Users can update facility mappings in their org"
ON public.denplan_facility_mappings FOR UPDATE
USING (public.user_in_org(auth.uid(), organization_id))
WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can delete facility mappings in their org" ON public.denplan_facility_mappings;
CREATE POLICY "Users can delete facility mappings in their org"
ON public.denplan_facility_mappings FOR DELETE
USING (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Service role full access to denplan_facility_mappings" ON public.denplan_facility_mappings;
CREATE POLICY "Service role full access to denplan_facility_mappings"
ON public.denplan_facility_mappings FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

-- Add source_facility_id column to membership_upload_members
ALTER TABLE public.membership_upload_members
  ADD COLUMN IF NOT EXISTS source_facility_id TEXT;

COMMENT ON TABLE public.denplan_facility_mappings IS 'Maps Denplan registration facility IDs (from CSV filenames) to Denplan product names';
COMMENT ON COLUMN public.membership_upload_members.source_facility_id IS 'Denplan facility ID extracted from the source CSV filename (e.g., 256891a)';
