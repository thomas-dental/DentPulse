-- ============================================
-- Corrective migration: fix dentally_patients_accounts schema.
--
-- The original 20260528000001 was authored with a wrong assumption about the
-- /v1/accounts response (billing-account-holder demographics). The real API
-- returns a narrow per-patient balance row:
--   { id, patient_id, patient_name, current_balance, opening_balance,
--     planned_nhs_treatment_value, planned_private_treatment_value }
--
-- Because the original migration used `CREATE TABLE IF NOT EXISTS`, editing
-- it in-place was a no-op once it had already run. This migration drops the
-- mis-shaped table and recreates it with the correct columns. Safe because
-- the table has only ever held sync output (no human-curated data).
-- ============================================

DROP TABLE IF EXISTS public.dentally_patients_accounts CASCADE;

CREATE TABLE public.dentally_patients_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    location_id UUID REFERENCES public.practice_locations(id) ON DELETE SET NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    integration_id UUID REFERENCES public.integrations(id) ON DELETE SET NULL,

    da_id BIGINT NOT NULL,
    da_patient_id BIGINT,
    da_patient_name VARCHAR(510),
    da_current_balance NUMERIC(15, 2),
    da_opening_balance NUMERIC(15, 2),
    da_planned_nhs_treatment_value NUMERIC(15, 2),
    da_planned_private_treatment_value NUMERIC(15, 2),

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE,

    CONSTRAINT unique_dentally_patients_accounts UNIQUE (organization_id, da_id)
);

CREATE INDEX idx_dentally_patients_accounts_org_id ON public.dentally_patients_accounts(organization_id);
CREATE INDEX idx_dentally_patients_accounts_location_id ON public.dentally_patients_accounts(location_id);
CREATE INDEX idx_dentally_patients_accounts_integration_id ON public.dentally_patients_accounts(integration_id);
CREATE INDEX idx_dentally_patients_accounts_da_id ON public.dentally_patients_accounts(da_id);
CREATE INDEX idx_dentally_patients_accounts_da_patient_id ON public.dentally_patients_accounts(da_patient_id);
CREATE INDEX idx_dentally_patients_accounts_da_current_balance ON public.dentally_patients_accounts(da_current_balance);
CREATE INDEX idx_dentally_patients_accounts_deleted_at ON public.dentally_patients_accounts(deleted_at) WHERE deleted_at IS NULL;

ALTER TABLE public.dentally_patients_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view dentally accounts in their org"
ON public.dentally_patients_accounts FOR SELECT
USING (public.user_in_org(auth.uid(), organization_id));

CREATE POLICY "Users can insert dentally accounts in their org"
ON public.dentally_patients_accounts FOR INSERT
WITH CHECK (public.user_in_org(auth.uid(), organization_id));

CREATE POLICY "Users can update dentally accounts in their org"
ON public.dentally_patients_accounts FOR UPDATE
USING (public.user_in_org(auth.uid(), organization_id))
WITH CHECK (public.user_in_org(auth.uid(), organization_id));

CREATE POLICY "Users can delete dentally accounts in their org"
ON public.dentally_patients_accounts FOR DELETE
USING (public.user_in_org(auth.uid(), organization_id));

CREATE POLICY "Service role full access to dentally_patients_accounts"
ON public.dentally_patients_accounts FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION update_dentally_patients_accounts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_dentally_patients_accounts_updated_at ON public.dentally_patients_accounts;
CREATE TRIGGER update_dentally_patients_accounts_updated_at
    BEFORE UPDATE ON public.dentally_patients_accounts
    FOR EACH ROW
    EXECUTE FUNCTION update_dentally_patients_accounts_updated_at();

COMMENT ON TABLE public.dentally_patients_accounts IS 'Per-patient account/balance records from Dentally /v1/accounts. One row per patient account.';
COMMENT ON COLUMN public.dentally_patients_accounts.da_id IS 'Dentally account id (patients.pt_account_id and invoices.account_id reference this).';
COMMENT ON COLUMN public.dentally_patients_accounts.da_current_balance IS 'Current outstanding balance. Negative = practice owes patient (credit); positive = patient owes practice.';
COMMENT ON COLUMN public.dentally_patients_accounts.da_opening_balance IS 'Opening balance at start of period.';
COMMENT ON COLUMN public.dentally_patients_accounts.da_planned_nhs_treatment_value IS 'Sum of planned NHS treatment value across the patient''s treatment plans.';
COMMENT ON COLUMN public.dentally_patients_accounts.da_planned_private_treatment_value IS 'Sum of planned private treatment value across the patient''s treatment plans.';

-- Re-seed integration_sync_entities (the original migration already did this,
-- but include here for orgs whose row was somehow missed).
INSERT INTO public.integration_sync_entities (
  integration_id, entity_alias, entity_label, entity_description,
  is_sync, is_available, last_synced_at, created_at, updated_at
)
SELECT
  i.id, 'accounts', 'Accounts',
  'Sync per-patient account balances from Dentally',
  TRUE, TRUE, NULL, NOW(), NOW()
FROM public.integrations i
WHERE i.integration_name ILIKE 'Dentally'
  AND i.is_connected = TRUE
  AND NOT EXISTS (
    SELECT 1 FROM public.integration_sync_entities ise
    WHERE ise.integration_id = i.id AND ise.entity_alias = 'accounts'
  )
ON CONFLICT (integration_id, entity_alias) DO NOTHING;
