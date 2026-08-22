-- Per-organization (and optional integration) saved benchmark % targets for Profit Benchmark screen.

CREATE TABLE IF NOT EXISTS public.profit_benchmark_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    platform_integration_id UUID REFERENCES public.platform_integrations(id) ON DELETE CASCADE,
    group_account_master_id SMALLINT REFERENCES public.group_account_master(id) ON DELETE CASCADE,
    is_profit_row BOOLEAN NOT NULL DEFAULT FALSE,
    benchmark_percent NUMERIC(10, 4) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
    CONSTRAINT profit_benchmark_settings_profit_xor_group CHECK (
        (is_profit_row = TRUE AND group_account_master_id IS NULL)
        OR (is_profit_row = FALSE AND group_account_master_id IS NOT NULL)
    )
);

-- One row per org + platform scope + target (profit uses sentinel -1 in expression).
CREATE UNIQUE INDEX IF NOT EXISTS profit_benchmark_settings_scope_unique
    ON public.profit_benchmark_settings (
        organization_id,
        COALESCE(platform_integration_id, '00000000-0000-0000-0000-000000000000'::uuid),
        (CASE WHEN is_profit_row THEN -1 ELSE group_account_master_id::integer END)
    );

CREATE INDEX IF NOT EXISTS idx_profit_benchmark_settings_org
    ON public.profit_benchmark_settings (organization_id);

COMMENT ON TABLE public.profit_benchmark_settings IS
    'User-editable benchmark % per profit expense group (group_account_master) and optional net profit row; scoped by org and platform integration.';

ALTER TABLE public.profit_benchmark_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profit_benchmark_settings_select" ON public.profit_benchmark_settings;
CREATE POLICY "profit_benchmark_settings_select"
    ON public.profit_benchmark_settings FOR SELECT
    USING (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "profit_benchmark_settings_insert" ON public.profit_benchmark_settings;
CREATE POLICY "profit_benchmark_settings_insert"
    ON public.profit_benchmark_settings FOR INSERT
    WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "profit_benchmark_settings_update" ON public.profit_benchmark_settings;
CREATE POLICY "profit_benchmark_settings_update"
    ON public.profit_benchmark_settings FOR UPDATE
    USING (public.user_in_org(auth.uid(), organization_id))
    WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "profit_benchmark_settings_delete" ON public.profit_benchmark_settings;
CREATE POLICY "profit_benchmark_settings_delete"
    ON public.profit_benchmark_settings FOR DELETE
    USING (public.user_in_org(auth.uid(), organization_id));

DROP TRIGGER IF EXISTS profit_benchmark_settings_set_updated_at ON public.profit_benchmark_settings;
CREATE TRIGGER profit_benchmark_settings_set_updated_at
    BEFORE UPDATE ON public.profit_benchmark_settings
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
