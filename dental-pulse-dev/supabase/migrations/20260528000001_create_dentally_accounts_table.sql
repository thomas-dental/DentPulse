-- ============================================
-- Dentally Accounts Table
-- Stores per-patient account/balance records synced from Dentally /v1/accounts.
-- Each account belongs to one patient (1:1) and tracks current/opening balance
-- plus planned NHS/private treatment values.
-- ============================================

CREATE TABLE IF NOT EXISTS public.dentally_patients_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Core fields
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    location_id UUID REFERENCES public.practice_locations(id) ON DELETE SET NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    integration_id UUID REFERENCES public.integrations(id) ON DELETE SET NULL,

    -- Dentally account fields (from GET /v1/accounts)
    da_id BIGINT NOT NULL,                                  -- Dentally account id
    da_patient_id BIGINT,                                   -- Dentally patient id this account belongs to
    da_patient_name VARCHAR(510),                           -- Denormalised patient name
    da_current_balance NUMERIC(15, 2),                      -- Current outstanding balance (positive = patient owes practice)
    da_opening_balance NUMERIC(15, 2),                      -- Opening balance at start of period
    da_planned_nhs_treatment_value NUMERIC(15, 2),          -- Total planned NHS treatment value
    da_planned_private_treatment_value NUMERIC(15, 2),      -- Total planned private treatment value

    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE,

    CONSTRAINT unique_dentally_patients_accounts UNIQUE (organization_id, da_id)
);

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_dentally_patients_accounts_org_id ON public.dentally_patients_accounts(organization_id);
CREATE INDEX IF NOT EXISTS idx_dentally_patients_accounts_location_id ON public.dentally_patients_accounts(location_id);
CREATE INDEX IF NOT EXISTS idx_dentally_patients_accounts_integration_id ON public.dentally_patients_accounts(integration_id);
CREATE INDEX IF NOT EXISTS idx_dentally_patients_accounts_da_id ON public.dentally_patients_accounts(da_id);
CREATE INDEX IF NOT EXISTS idx_dentally_patients_accounts_da_patient_id ON public.dentally_patients_accounts(da_patient_id);
CREATE INDEX IF NOT EXISTS idx_dentally_patients_accounts_da_current_balance ON public.dentally_patients_accounts(da_current_balance);
CREATE INDEX IF NOT EXISTS idx_dentally_patients_accounts_deleted_at ON public.dentally_patients_accounts(deleted_at) WHERE deleted_at IS NULL;

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================
ALTER TABLE public.dentally_patients_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view dentally accounts in their org" ON public.dentally_patients_accounts;
CREATE POLICY "Users can view dentally accounts in their org"
ON public.dentally_patients_accounts FOR SELECT
USING (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can insert dentally accounts in their org" ON public.dentally_patients_accounts;
CREATE POLICY "Users can insert dentally accounts in their org"
ON public.dentally_patients_accounts FOR INSERT
WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can update dentally accounts in their org" ON public.dentally_patients_accounts;
CREATE POLICY "Users can update dentally accounts in their org"
ON public.dentally_patients_accounts FOR UPDATE
USING (public.user_in_org(auth.uid(), organization_id))
WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can delete dentally accounts in their org" ON public.dentally_patients_accounts;
CREATE POLICY "Users can delete dentally accounts in their org"
ON public.dentally_patients_accounts FOR DELETE
USING (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Service role full access to dentally_patients_accounts" ON public.dentally_patients_accounts;
CREATE POLICY "Service role full access to dentally_patients_accounts"
ON public.dentally_patients_accounts FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

-- ============================================
-- TRIGGERS
-- ============================================
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

-- ============================================
-- COMMENTS
-- ============================================
COMMENT ON TABLE public.dentally_patients_accounts IS 'Per-patient account/balance records from Dentally /v1/accounts. One row per patient account.';
COMMENT ON COLUMN public.dentally_patients_accounts.da_id IS 'Dentally account id (patients.pt_account_id and invoices.account_id reference this).';
COMMENT ON COLUMN public.dentally_patients_accounts.da_current_balance IS 'Current outstanding balance. Negative = practice owes patient (credit); positive = patient owes practice.';
COMMENT ON COLUMN public.dentally_patients_accounts.da_opening_balance IS 'Opening balance at start of period.';
COMMENT ON COLUMN public.dentally_patients_accounts.da_planned_nhs_treatment_value IS 'Sum of planned NHS treatment value across the patient''s treatment plans.';
COMMENT ON COLUMN public.dentally_patients_accounts.da_planned_private_treatment_value IS 'Sum of planned private treatment value across the patient''s treatment plans.';

-- ============================================
-- Seed integration_sync_entities so accounts shows up in the Settings UI
-- and gets enqueued by the sync engine.
-- ============================================
INSERT INTO public.integration_sync_entities (
  integration_id,
  entity_alias,
  entity_label,
  entity_description,
  is_sync,
  is_available,
  last_synced_at,
  created_at,
  updated_at
)
SELECT
  i.id,
  'accounts',
  'Accounts',
  'Sync per-patient account balances from Dentally',
  TRUE,
  TRUE,
  NULL,
  NOW(),
  NOW()
FROM public.integrations i
WHERE i.integration_name ILIKE 'Dentally'
  AND i.is_connected = TRUE
  AND NOT EXISTS (
    SELECT 1
    FROM public.integration_sync_entities ise
    WHERE ise.integration_id = i.id
      AND ise.entity_alias = 'accounts'
  )
ON CONFLICT (integration_id, entity_alias) DO NOTHING;
