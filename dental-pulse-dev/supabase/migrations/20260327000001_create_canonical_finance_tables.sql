-- Canonical finance model: platform-agnostic journal + accounts + reporting cache + sync metadata.
-- App and reports should read these tables; platform-specific tables (iplicit_*, etc.) remain ingestion/staging.
-- RLS uses public.user_in_org() (SECURITY DEFINER) for org isolation, consistent with iplicit_* policies.

-- ---------------------------------------------------------------------------
-- 1) Data source (one row per connected accounting integration per org)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.finance_data_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    platform TEXT NOT NULL,
    platform_integration_id UUID REFERENCES public.platform_integrations(id) ON DELETE SET NULL,
    base_currency CHAR(3),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
    CONSTRAINT finance_data_sources_platform_check
        CHECK (platform IN (
            'iplicit',
            'xero',
            'quickbooks',
            'quickbooks_online',
            'microsoft_dynamics',
            'other'
        ))
);

-- One row per org+platform when no integration id; one row per org+platform+integration when linked.
-- (Plain UNIQUE (..., platform_integration_id) allows duplicate NULLs in PostgreSQL.)
CREATE UNIQUE INDEX IF NOT EXISTS finance_data_sources_org_platform_no_integration_unique
    ON public.finance_data_sources (organization_id, platform)
    WHERE platform_integration_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS finance_data_sources_org_platform_integration_unique
    ON public.finance_data_sources (organization_id, platform, platform_integration_id)
    WHERE platform_integration_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_finance_data_sources_org
    ON public.finance_data_sources (organization_id);

CREATE INDEX IF NOT EXISTS idx_finance_data_sources_platform_integration
    ON public.finance_data_sources (platform_integration_id)
    WHERE platform_integration_id IS NOT NULL;

COMMENT ON TABLE public.finance_data_sources IS
    'Canonical accounting data source: links org to one platform integration (QuickBooks, Xero, iplicit, etc.).';

-- ---------------------------------------------------------------------------
-- 2) Chart of accounts (canonical)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.finance_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    source_id UUID NOT NULL REFERENCES public.finance_data_sources(id) ON DELETE CASCADE,
    canonical_account_code TEXT NOT NULL,
    account_name TEXT NOT NULL,
    account_type TEXT,
    report_category TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    parent_account_id UUID REFERENCES public.finance_accounts(id) ON DELETE SET NULL,
    attributes_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
    CONSTRAINT finance_accounts_org_source_code_unique UNIQUE (organization_id, source_id, canonical_account_code)
);

CREATE INDEX IF NOT EXISTS idx_finance_accounts_org
    ON public.finance_accounts (organization_id);

CREATE INDEX IF NOT EXISTS idx_finance_accounts_source
    ON public.finance_accounts (source_id);

CREATE INDEX IF NOT EXISTS idx_finance_accounts_parent
    ON public.finance_accounts (parent_account_id)
    WHERE parent_account_id IS NOT NULL;

COMMENT ON TABLE public.finance_accounts IS
    'Normalized chart of accounts; one row per logical account per finance_data_source.';

-- ---------------------------------------------------------------------------
-- 3) Journal entry headers
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.finance_journal_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    source_id UUID NOT NULL REFERENCES public.finance_data_sources(id) ON DELETE CASCADE,
    external_journal_id TEXT NOT NULL,
    journal_number TEXT,
    posting_date DATE NOT NULL,
    document_date DATE,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'posted',
    currency_code CHAR(3),
    fx_rate NUMERIC(19, 8),
    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
    CONSTRAINT finance_journal_entries_source_external_unique UNIQUE (source_id, external_journal_id),
    CONSTRAINT finance_journal_entries_status_check
        CHECK (status IN ('draft', 'posted', 'void', 'archived', 'other'))
);

CREATE INDEX IF NOT EXISTS idx_finance_journal_entries_org_posting
    ON public.finance_journal_entries (organization_id, posting_date);

CREATE INDEX IF NOT EXISTS idx_finance_journal_entries_source_posting
    ON public.finance_journal_entries (source_id, posting_date);

COMMENT ON TABLE public.finance_journal_entries IS
    'Canonical journal headers; idempotent upsert key is (source_id, external_journal_id).';

-- ---------------------------------------------------------------------------
-- 4) Journal lines (row-level source of truth for reports / cashflow)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.finance_journal_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    source_id UUID NOT NULL REFERENCES public.finance_data_sources(id) ON DELETE CASCADE,
    journal_entry_id UUID NOT NULL REFERENCES public.finance_journal_entries(id) ON DELETE CASCADE,
    external_line_id TEXT NOT NULL,
    account_id UUID NOT NULL REFERENCES public.finance_accounts(id) ON DELETE RESTRICT,
    posting_date DATE NOT NULL,
    line_order INTEGER NOT NULL DEFAULT 0,
    debit_amount NUMERIC(19, 4) NOT NULL DEFAULT 0,
    credit_amount NUMERIC(19, 4) NOT NULL DEFAULT 0,
    net_amount NUMERIC(19, 4) GENERATED ALWAYS AS (debit_amount - credit_amount) STORED,
    tax_code TEXT,
    cost_center TEXT,
    contact_ref TEXT,
    project_ref TEXT,
    dimensions_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    extras_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
    CONSTRAINT finance_journal_lines_entry_line_unique UNIQUE (journal_entry_id, external_line_id),
    CONSTRAINT finance_journal_lines_non_negative_debit_credit CHECK (
        debit_amount >= 0 AND credit_amount >= 0
    )
);

CREATE INDEX IF NOT EXISTS idx_finance_journal_lines_org_account_posting
    ON public.finance_journal_lines (organization_id, account_id, posting_date);

CREATE INDEX IF NOT EXISTS idx_finance_journal_lines_org_posting
    ON public.finance_journal_lines (organization_id, posting_date);

CREATE INDEX IF NOT EXISTS idx_finance_journal_lines_entry
    ON public.finance_journal_lines (journal_entry_id);

CREATE INDEX IF NOT EXISTS idx_finance_journal_lines_source
    ON public.finance_journal_lines (source_id, posting_date);

COMMENT ON TABLE public.finance_journal_lines IS
    'Canonical journal lines; reporting and cashflow aggregate from these rows.';

-- ---------------------------------------------------------------------------
-- 5) Platform id → canonical id mapping (for sync / debugging)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.finance_platform_mapping (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    source_id UUID NOT NULL REFERENCES public.finance_data_sources(id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL,
    platform_key TEXT NOT NULL,
    canonical_id UUID,
    canonical_text TEXT,
    raw_json JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
    CONSTRAINT finance_platform_mapping_entity_check
        CHECK (entity_type IN (
            'account',
            'journal_entry',
            'journal_line',
            'contact',
            'tax_code',
            'product',
            'other'
        )),
    CONSTRAINT finance_platform_mapping_source_entity_platform_unique UNIQUE (source_id, entity_type, platform_key)
);

CREATE INDEX IF NOT EXISTS idx_finance_platform_mapping_org
    ON public.finance_platform_mapping (organization_id);

CREATE INDEX IF NOT EXISTS idx_finance_platform_mapping_source_entity
    ON public.finance_platform_mapping (source_id, entity_type);

COMMENT ON TABLE public.finance_platform_mapping IS
    'Maps external platform identifiers to canonical UUIDs / keys for idempotent sync.';

-- ---------------------------------------------------------------------------
-- 6) Sync run audit / idempotency
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.finance_sync_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    source_id UUID NOT NULL REFERENCES public.finance_data_sources(id) ON DELETE CASCADE,
    sync_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    started_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
    completed_at TIMESTAMPTZ,
    cursor_json JSONB,
    stats_json JSONB,
    error_json JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
    CONSTRAINT finance_sync_runs_status_check
        CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_finance_sync_runs_org_started
    ON public.finance_sync_runs (organization_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_finance_sync_runs_source_status
    ON public.finance_sync_runs (source_id, status);

COMMENT ON TABLE public.finance_sync_runs IS
    'Audit trail and cursor state for canonical finance sync jobs.';

-- ---------------------------------------------------------------------------
-- 7) Optional denormalized reporting facts (pre-aggregated for fast UI)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.finance_reporting_facts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    source_id UUID NOT NULL REFERENCES public.finance_data_sources(id) ON DELETE CASCADE,
    fact_type TEXT NOT NULL,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    account_id UUID REFERENCES public.finance_accounts(id) ON DELETE SET NULL,
    dimension_key TEXT,
    amount NUMERIC(19, 4) NOT NULL DEFAULT 0,
    currency_code CHAR(3),
    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
    CONSTRAINT finance_reporting_facts_fact_type_check
        CHECK (fact_type IN (
            'cashflow',
            'profit_loss',
            'balance_sheet',
            'trial_balance',
            'other'
        )),
    CONSTRAINT finance_reporting_facts_period_order CHECK (period_end >= period_start)
);

-- Avoid duplicate NULL account_id rows: PostgreSQL UNIQUE treats NULLs as distinct.
CREATE UNIQUE INDEX IF NOT EXISTS finance_reporting_facts_unique_with_account
    ON public.finance_reporting_facts (
        organization_id,
        source_id,
        fact_type,
        period_start,
        period_end,
        account_id,
        COALESCE(dimension_key, '')
    )
    WHERE account_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS finance_reporting_facts_unique_no_account
    ON public.finance_reporting_facts (
        organization_id,
        source_id,
        fact_type,
        period_start,
        period_end,
        COALESCE(dimension_key, '')
    )
    WHERE account_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_finance_reporting_facts_org_period
    ON public.finance_reporting_facts (organization_id, period_start, period_end);

CREATE INDEX IF NOT EXISTS idx_finance_reporting_facts_source_fact
    ON public.finance_reporting_facts (source_id, fact_type, period_start, period_end);

COMMENT ON TABLE public.finance_reporting_facts IS
    'Optional materialized aggregates for dashboards; rebuild from finance_journal_lines when needed.';

-- ---------------------------------------------------------------------------
-- updated_at triggers (idempotent; matches existing public.handle_updated_at pattern)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = TIMEZONE('utc'::text, NOW());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS finance_data_sources_set_updated_at ON public.finance_data_sources;
CREATE TRIGGER finance_data_sources_set_updated_at
    BEFORE UPDATE ON public.finance_data_sources
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS finance_accounts_set_updated_at ON public.finance_accounts;
CREATE TRIGGER finance_accounts_set_updated_at
    BEFORE UPDATE ON public.finance_accounts
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS finance_journal_entries_set_updated_at ON public.finance_journal_entries;
CREATE TRIGGER finance_journal_entries_set_updated_at
    BEFORE UPDATE ON public.finance_journal_entries
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS finance_journal_lines_set_updated_at ON public.finance_journal_lines;
CREATE TRIGGER finance_journal_lines_set_updated_at
    BEFORE UPDATE ON public.finance_journal_lines
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS finance_platform_mapping_set_updated_at ON public.finance_platform_mapping;
CREATE TRIGGER finance_platform_mapping_set_updated_at
    BEFORE UPDATE ON public.finance_platform_mapping
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS finance_sync_runs_set_updated_at ON public.finance_sync_runs;
CREATE TRIGGER finance_sync_runs_set_updated_at
    BEFORE UPDATE ON public.finance_sync_runs
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS finance_reporting_facts_set_updated_at ON public.finance_reporting_facts;
CREATE TRIGGER finance_reporting_facts_set_updated_at
    BEFORE UPDATE ON public.finance_reporting_facts
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
ALTER TABLE public.finance_data_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_journal_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_platform_mapping ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_reporting_facts ENABLE ROW LEVEL SECURITY;

-- finance_data_sources
DROP POLICY IF EXISTS "finance_data_sources_select" ON public.finance_data_sources;
CREATE POLICY "finance_data_sources_select"
    ON public.finance_data_sources FOR SELECT
    USING (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "finance_data_sources_insert" ON public.finance_data_sources;
CREATE POLICY "finance_data_sources_insert"
    ON public.finance_data_sources FOR INSERT
    WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "finance_data_sources_update" ON public.finance_data_sources;
CREATE POLICY "finance_data_sources_update"
    ON public.finance_data_sources FOR UPDATE
    USING (public.user_in_org(auth.uid(), organization_id))
    WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "finance_data_sources_delete" ON public.finance_data_sources;
CREATE POLICY "finance_data_sources_delete"
    ON public.finance_data_sources FOR DELETE
    USING (public.user_in_org(auth.uid(), organization_id));

-- finance_accounts
DROP POLICY IF EXISTS "finance_accounts_select" ON public.finance_accounts;
CREATE POLICY "finance_accounts_select"
    ON public.finance_accounts FOR SELECT
    USING (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "finance_accounts_insert" ON public.finance_accounts;
CREATE POLICY "finance_accounts_insert"
    ON public.finance_accounts FOR INSERT
    WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "finance_accounts_update" ON public.finance_accounts;
CREATE POLICY "finance_accounts_update"
    ON public.finance_accounts FOR UPDATE
    USING (public.user_in_org(auth.uid(), organization_id))
    WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "finance_accounts_delete" ON public.finance_accounts;
CREATE POLICY "finance_accounts_delete"
    ON public.finance_accounts FOR DELETE
    USING (public.user_in_org(auth.uid(), organization_id));

-- finance_journal_entries
DROP POLICY IF EXISTS "finance_journal_entries_select" ON public.finance_journal_entries;
CREATE POLICY "finance_journal_entries_select"
    ON public.finance_journal_entries FOR SELECT
    USING (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "finance_journal_entries_insert" ON public.finance_journal_entries;
CREATE POLICY "finance_journal_entries_insert"
    ON public.finance_journal_entries FOR INSERT
    WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "finance_journal_entries_update" ON public.finance_journal_entries;
CREATE POLICY "finance_journal_entries_update"
    ON public.finance_journal_entries FOR UPDATE
    USING (public.user_in_org(auth.uid(), organization_id))
    WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "finance_journal_entries_delete" ON public.finance_journal_entries;
CREATE POLICY "finance_journal_entries_delete"
    ON public.finance_journal_entries FOR DELETE
    USING (public.user_in_org(auth.uid(), organization_id));

-- finance_journal_lines
DROP POLICY IF EXISTS "finance_journal_lines_select" ON public.finance_journal_lines;
CREATE POLICY "finance_journal_lines_select"
    ON public.finance_journal_lines FOR SELECT
    USING (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "finance_journal_lines_insert" ON public.finance_journal_lines;
CREATE POLICY "finance_journal_lines_insert"
    ON public.finance_journal_lines FOR INSERT
    WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "finance_journal_lines_update" ON public.finance_journal_lines;
CREATE POLICY "finance_journal_lines_update"
    ON public.finance_journal_lines FOR UPDATE
    USING (public.user_in_org(auth.uid(), organization_id))
    WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "finance_journal_lines_delete" ON public.finance_journal_lines;
CREATE POLICY "finance_journal_lines_delete"
    ON public.finance_journal_lines FOR DELETE
    USING (public.user_in_org(auth.uid(), organization_id));

-- finance_platform_mapping
DROP POLICY IF EXISTS "finance_platform_mapping_select" ON public.finance_platform_mapping;
CREATE POLICY "finance_platform_mapping_select"
    ON public.finance_platform_mapping FOR SELECT
    USING (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "finance_platform_mapping_insert" ON public.finance_platform_mapping;
CREATE POLICY "finance_platform_mapping_insert"
    ON public.finance_platform_mapping FOR INSERT
    WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "finance_platform_mapping_update" ON public.finance_platform_mapping;
CREATE POLICY "finance_platform_mapping_update"
    ON public.finance_platform_mapping FOR UPDATE
    USING (public.user_in_org(auth.uid(), organization_id))
    WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "finance_platform_mapping_delete" ON public.finance_platform_mapping;
CREATE POLICY "finance_platform_mapping_delete"
    ON public.finance_platform_mapping FOR DELETE
    USING (public.user_in_org(auth.uid(), organization_id));

-- finance_sync_runs
DROP POLICY IF EXISTS "finance_sync_runs_select" ON public.finance_sync_runs;
CREATE POLICY "finance_sync_runs_select"
    ON public.finance_sync_runs FOR SELECT
    USING (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "finance_sync_runs_insert" ON public.finance_sync_runs;
CREATE POLICY "finance_sync_runs_insert"
    ON public.finance_sync_runs FOR INSERT
    WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "finance_sync_runs_update" ON public.finance_sync_runs;
CREATE POLICY "finance_sync_runs_update"
    ON public.finance_sync_runs FOR UPDATE
    USING (public.user_in_org(auth.uid(), organization_id))
    WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "finance_sync_runs_delete" ON public.finance_sync_runs;
CREATE POLICY "finance_sync_runs_delete"
    ON public.finance_sync_runs FOR DELETE
    USING (public.user_in_org(auth.uid(), organization_id));

-- finance_reporting_facts
DROP POLICY IF EXISTS "finance_reporting_facts_select" ON public.finance_reporting_facts;
CREATE POLICY "finance_reporting_facts_select"
    ON public.finance_reporting_facts FOR SELECT
    USING (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "finance_reporting_facts_insert" ON public.finance_reporting_facts;
CREATE POLICY "finance_reporting_facts_insert"
    ON public.finance_reporting_facts FOR INSERT
    WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "finance_reporting_facts_update" ON public.finance_reporting_facts;
CREATE POLICY "finance_reporting_facts_update"
    ON public.finance_reporting_facts FOR UPDATE
    USING (public.user_in_org(auth.uid(), organization_id))
    WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "finance_reporting_facts_delete" ON public.finance_reporting_facts;
CREATE POLICY "finance_reporting_facts_delete"
    ON public.finance_reporting_facts FOR DELETE
    USING (public.user_in_org(auth.uid(), organization_id));
