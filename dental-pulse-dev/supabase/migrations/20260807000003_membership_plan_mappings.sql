-- ============================================
-- Membership Plan Mappings
-- Maps a Practice Plan statement plan (its fee-category label, e.g.
-- "Comprehensive", "Low B") to the Dentally payment plan(s) it corresponds
-- to. PP statement plans group by their own label and deliberately have no
-- payment_plans row; this explicit, user-maintained mapping gives each one
-- a Dentally plan identity so analytics (treatment consumption, drill-down,
-- utilisation) can join statement plans to Dentally data.
--
-- One statement plan can map to SEVERAL Dentally plans (same shape as
-- denplan_facility_mappings.payment_plan_ids — Postgres can't FK array
-- elements, so ids are validated client-side against payment_plans).
-- Maintained from the Membership page's Plan Mapping dialog.
-- ============================================

CREATE TABLE IF NOT EXISTS public.membership_plan_mappings (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id   UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    -- Statement plan label (matches membership_upload_members.fee_category
    -- for Practice Plan rows)
    plan_label        TEXT NOT NULL,
    payment_plan_ids  UUID[] NOT NULL DEFAULT '{}'::UUID[],
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by        UUID,
    UNIQUE(organization_id, plan_label)
);

CREATE INDEX IF NOT EXISTS idx_membership_plan_mappings_org
    ON public.membership_plan_mappings(organization_id);

-- RLS (same pattern as denplan_facility_mappings: settings maintained
-- client-side by org users, plus service-role full access)
ALTER TABLE public.membership_plan_mappings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view membership plan mappings in their org" ON public.membership_plan_mappings;
CREATE POLICY "Users can view membership plan mappings in their org"
ON public.membership_plan_mappings FOR SELECT
USING (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can insert membership plan mappings in their org" ON public.membership_plan_mappings;
CREATE POLICY "Users can insert membership plan mappings in their org"
ON public.membership_plan_mappings FOR INSERT
WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can update membership plan mappings in their org" ON public.membership_plan_mappings;
CREATE POLICY "Users can update membership plan mappings in their org"
ON public.membership_plan_mappings FOR UPDATE
USING (public.user_in_org(auth.uid(), organization_id))
WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can delete membership plan mappings in their org" ON public.membership_plan_mappings;
CREATE POLICY "Users can delete membership plan mappings in their org"
ON public.membership_plan_mappings FOR DELETE
USING (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Service role full access to membership_plan_mappings" ON public.membership_plan_mappings;
CREATE POLICY "Service role full access to membership_plan_mappings"
ON public.membership_plan_mappings FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_membership_plan_mappings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_membership_plan_mappings_updated_at ON public.membership_plan_mappings;
CREATE TRIGGER update_membership_plan_mappings_updated_at
    BEFORE UPDATE ON public.membership_plan_mappings
    FOR EACH ROW
    EXECUTE FUNCTION update_membership_plan_mappings_updated_at();

COMMENT ON TABLE public.membership_plan_mappings IS
    'Maps Practice Plan statement plan labels (fee_category) to one or more Dentally payment plans (payment_plan_ids array).';
