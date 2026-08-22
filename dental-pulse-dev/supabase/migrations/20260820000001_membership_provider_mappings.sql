-- ============================================
-- Membership Provider Mappings
-- Maps a Practice Plan / Denplan statement provider name (the upload rows'
-- treating_dentist, e.g. "Dr Israr Razaq 2") to the enterprise provider
-- record it belongs to, plus the practice location that provider's
-- statement figures should be attributed to. Statement names rarely equal
-- providers.name exactly (titles, nicknames, PP's numbered provider
-- variants), so consumers fall back to fuzzy name matching
-- (lib/dentistNameMatch.ts) — this explicit, user-maintained mapping takes
-- precedence wherever it exists.
--
-- provider_id / location_id are independently optional: a row can pin just
-- the site for a dentist the fuzzy matcher already resolves, or just the
-- provider. A row with neither is deleted client-side.
-- Maintained from the Membership module's Settings tab.
-- ============================================

CREATE TABLE IF NOT EXISTS public.membership_provider_mappings (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id   UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    -- Statement provider name (matches membership_upload_members.treating_dentist)
    provider_label    TEXT NOT NULL,
    provider_id       UUID REFERENCES public.providers(id) ON DELETE SET NULL,
    location_id       UUID REFERENCES public.practice_locations(id) ON DELETE SET NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by        UUID,
    UNIQUE(organization_id, provider_label)
);

CREATE INDEX IF NOT EXISTS idx_membership_provider_mappings_org
    ON public.membership_provider_mappings(organization_id);

-- RLS (same pattern as membership_plan_mappings: settings maintained
-- client-side by org users, plus service-role full access)
ALTER TABLE public.membership_provider_mappings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view membership provider mappings in their org" ON public.membership_provider_mappings;
CREATE POLICY "Users can view membership provider mappings in their org"
ON public.membership_provider_mappings FOR SELECT
USING (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can insert membership provider mappings in their org" ON public.membership_provider_mappings;
CREATE POLICY "Users can insert membership provider mappings in their org"
ON public.membership_provider_mappings FOR INSERT
WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can update membership provider mappings in their org" ON public.membership_provider_mappings;
CREATE POLICY "Users can update membership provider mappings in their org"
ON public.membership_provider_mappings FOR UPDATE
USING (public.user_in_org(auth.uid(), organization_id))
WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can delete membership provider mappings in their org" ON public.membership_provider_mappings;
CREATE POLICY "Users can delete membership provider mappings in their org"
ON public.membership_provider_mappings FOR DELETE
USING (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Service role full access to membership_provider_mappings" ON public.membership_provider_mappings;
CREATE POLICY "Service role full access to membership_provider_mappings"
ON public.membership_provider_mappings FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_membership_provider_mappings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_membership_provider_mappings_updated_at ON public.membership_provider_mappings;
CREATE TRIGGER update_membership_provider_mappings_updated_at
    BEFORE UPDATE ON public.membership_provider_mappings
    FOR EACH ROW
    EXECUTE FUNCTION update_membership_provider_mappings_updated_at();

COMMENT ON TABLE public.membership_provider_mappings IS
    'Maps statement provider names (membership_upload_members.treating_dentist) to an enterprise providers row and/or a practice location. Overrides fuzzy name matching where present.';
