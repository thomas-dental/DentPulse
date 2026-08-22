-- ============================================================================
-- Membership Treatment Settings
--
-- Per-treatment dentist time / hygienist time / lab cost / material cost,
-- scoped to a hand-picked subset of the org's treatment catalog and used
-- ONLY by the Membership module's own cost-to-serve calculations — a
-- parallel, membership-specific override, never written back to the shared
-- `treatments` table (Treatment Setup, Chair Efficiency, Treatment
-- Profitability etc. all keep reading the general catalog's own
-- material_cost/lab_bill/therapist_pay_rate/duration_minutes untouched).
--
-- One row per (organization_id, treatment_id) — a treatment either has a
-- row (selected, with its own membership figures) or doesn't (not yet
-- configured for membership costing). Maintained from the Membership
-- module's new Treatments tab: a multi-select adds/removes rows, an Edit
-- action on a selected row updates its four figures.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.membership_treatment_settings (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id        UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    treatment_id           UUID NOT NULL REFERENCES public.treatments(id) ON DELETE CASCADE,
    dentist_time_minutes   NUMERIC,
    hygienist_time_minutes NUMERIC,
    lab_cost               NUMERIC,
    material_cost          NUMERIC,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by             UUID,
    UNIQUE(organization_id, treatment_id)
);

CREATE INDEX IF NOT EXISTS idx_membership_treatment_settings_org
    ON public.membership_treatment_settings(organization_id);

-- RLS (same pattern as membership_plan_mappings: settings maintained
-- client-side by org users, plus service-role full access)
ALTER TABLE public.membership_treatment_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view membership treatment settings in their org" ON public.membership_treatment_settings;
CREATE POLICY "Users can view membership treatment settings in their org"
ON public.membership_treatment_settings FOR SELECT
USING (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can insert membership treatment settings in their org" ON public.membership_treatment_settings;
CREATE POLICY "Users can insert membership treatment settings in their org"
ON public.membership_treatment_settings FOR INSERT
WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can update membership treatment settings in their org" ON public.membership_treatment_settings;
CREATE POLICY "Users can update membership treatment settings in their org"
ON public.membership_treatment_settings FOR UPDATE
USING (public.user_in_org(auth.uid(), organization_id))
WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can delete membership treatment settings in their org" ON public.membership_treatment_settings;
CREATE POLICY "Users can delete membership treatment settings in their org"
ON public.membership_treatment_settings FOR DELETE
USING (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Service role full access to membership_treatment_settings" ON public.membership_treatment_settings;
CREATE POLICY "Service role full access to membership_treatment_settings"
ON public.membership_treatment_settings FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_membership_treatment_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_membership_treatment_settings_updated_at ON public.membership_treatment_settings;
CREATE TRIGGER update_membership_treatment_settings_updated_at
    BEFORE UPDATE ON public.membership_treatment_settings
    FOR EACH ROW
    EXECUTE FUNCTION update_membership_treatment_settings_updated_at();

COMMENT ON TABLE public.membership_treatment_settings IS
    'Per-treatment dentist time / hygienist time / lab cost / material cost, for treatments hand-picked to be costed under membership — separate from and never overwriting the general treatments catalog.';
