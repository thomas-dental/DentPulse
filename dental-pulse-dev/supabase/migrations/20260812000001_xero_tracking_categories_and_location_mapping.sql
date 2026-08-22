-- ============================================================
-- Xero Tracking Categories + Location Mapping
-- - Catalog tables for categories/options per tenant
-- - Location mapping columns for category/option
-- - Persist tracking on journal / invoice / bank lines
-- - P&L unique key includes tracking option ('' = unscoped)
-- - practice_locations.exclude_from_financial_display (Saint Catherine)
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- A. Catalog: xero_tracking_categories
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.xero_tracking_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  platform_integration_id UUID NOT NULL REFERENCES public.platform_integrations(id) ON DELETE CASCADE,
  platform_integration_organizations_id UUID NOT NULL REFERENCES public.platform_integration_organizations(id) ON DELETE CASCADE,
  xero_tracking_category_id VARCHAR(100) NOT NULL,
  name VARCHAR(255) NOT NULL,
  status VARCHAR(50) DEFAULT 'ACTIVE',
  synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT xero_tracking_categories_unique
    UNIQUE (organization_id, platform_integration_organizations_id, xero_tracking_category_id)
);

CREATE INDEX IF NOT EXISTS idx_xero_tc_org ON public.xero_tracking_categories(organization_id);
CREATE INDEX IF NOT EXISTS idx_xero_tc_pio ON public.xero_tracking_categories(platform_integration_organizations_id);
CREATE INDEX IF NOT EXISTS idx_xero_tc_integration ON public.xero_tracking_categories(platform_integration_id);

ALTER TABLE public.xero_tracking_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "xero_tc_select" ON public.xero_tracking_categories;
CREATE POLICY "xero_tc_select" ON public.xero_tracking_categories FOR SELECT
  USING (public.user_in_org(auth.uid(), organization_id));
DROP POLICY IF EXISTS "xero_tc_insert" ON public.xero_tracking_categories;
CREATE POLICY "xero_tc_insert" ON public.xero_tracking_categories FOR INSERT
  WITH CHECK (public.user_in_org(auth.uid(), organization_id));
DROP POLICY IF EXISTS "xero_tc_update" ON public.xero_tracking_categories;
CREATE POLICY "xero_tc_update" ON public.xero_tracking_categories FOR UPDATE
  USING (public.user_in_org(auth.uid(), organization_id))
  WITH CHECK (public.user_in_org(auth.uid(), organization_id));
DROP POLICY IF EXISTS "xero_tc_delete" ON public.xero_tracking_categories;
CREATE POLICY "xero_tc_delete" ON public.xero_tracking_categories FOR DELETE
  USING (public.user_in_org(auth.uid(), organization_id));

COMMENT ON TABLE public.xero_tracking_categories IS
  'Xero Tracking Categories per connected tenant. Synced from GET /TrackingCategories.';

-- ─────────────────────────────────────────────────────────────
-- A. Catalog: xero_tracking_options
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.xero_tracking_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  platform_integration_id UUID NOT NULL REFERENCES public.platform_integrations(id) ON DELETE CASCADE,
  platform_integration_organizations_id UUID NOT NULL REFERENCES public.platform_integration_organizations(id) ON DELETE CASCADE,
  xero_tracking_category_id VARCHAR(100) NOT NULL,
  xero_tracking_option_id VARCHAR(100) NOT NULL,
  name VARCHAR(255) NOT NULL,
  status VARCHAR(50) DEFAULT 'ACTIVE',
  synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT xero_tracking_options_unique
    UNIQUE (organization_id, platform_integration_organizations_id, xero_tracking_option_id)
);

CREATE INDEX IF NOT EXISTS idx_xero_to_org ON public.xero_tracking_options(organization_id);
CREATE INDEX IF NOT EXISTS idx_xero_to_pio ON public.xero_tracking_options(platform_integration_organizations_id);
CREATE INDEX IF NOT EXISTS idx_xero_to_category ON public.xero_tracking_options(xero_tracking_category_id);
CREATE INDEX IF NOT EXISTS idx_xero_to_integration ON public.xero_tracking_options(platform_integration_id);

ALTER TABLE public.xero_tracking_options ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "xero_to_select" ON public.xero_tracking_options;
CREATE POLICY "xero_to_select" ON public.xero_tracking_options FOR SELECT
  USING (public.user_in_org(auth.uid(), organization_id));
DROP POLICY IF EXISTS "xero_to_insert" ON public.xero_tracking_options;
CREATE POLICY "xero_to_insert" ON public.xero_tracking_options FOR INSERT
  WITH CHECK (public.user_in_org(auth.uid(), organization_id));
DROP POLICY IF EXISTS "xero_to_update" ON public.xero_tracking_options;
CREATE POLICY "xero_to_update" ON public.xero_tracking_options FOR UPDATE
  USING (public.user_in_org(auth.uid(), organization_id))
  WITH CHECK (public.user_in_org(auth.uid(), organization_id));
DROP POLICY IF EXISTS "xero_to_delete" ON public.xero_tracking_options;
CREATE POLICY "xero_to_delete" ON public.xero_tracking_options FOR DELETE
  USING (public.user_in_org(auth.uid(), organization_id));

COMMENT ON TABLE public.xero_tracking_options IS
  'Xero Tracking Options nested under categories. Synced from GET /TrackingCategories.';

-- ─────────────────────────────────────────────────────────────
-- B. Extend platform_integration_organization_mapping
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.platform_integration_organization_mapping
  ADD COLUMN IF NOT EXISTS xero_tracking_category_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS xero_tracking_option_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS xero_tracking_category_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS xero_tracking_option_name VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_piom_xero_tracking_option
  ON public.platform_integration_organization_mapping(xero_tracking_option_id)
  WHERE xero_tracking_option_id IS NOT NULL;

COMMENT ON COLUMN public.platform_integration_organization_mapping.xero_tracking_category_id IS
  'Xero TrackingCategoryID when location is scoped within a shared Xero tenant.';
COMMENT ON COLUMN public.platform_integration_organization_mapping.xero_tracking_option_id IS
  'Xero TrackingOptionID mapped to this practice location.';

-- ─────────────────────────────────────────────────────────────
-- C. Persist tracking on financial lines
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.xero_journal_details
  ADD COLUMN IF NOT EXISTS tracking JSONB,
  ADD COLUMN IF NOT EXISTS tracking_option_ids TEXT[] DEFAULT '{}';

ALTER TABLE public.xero_invoice_line_items
  ADD COLUMN IF NOT EXISTS tracking JSONB,
  ADD COLUMN IF NOT EXISTS tracking_option_ids TEXT[] DEFAULT '{}';

ALTER TABLE public.xero_bank_transactions
  ADD COLUMN IF NOT EXISTS tracking JSONB,
  ADD COLUMN IF NOT EXISTS tracking_option_ids TEXT[] DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_xero_jd_tracking_option_ids
  ON public.xero_journal_details USING GIN (tracking_option_ids);
CREATE INDEX IF NOT EXISTS idx_xero_li_tracking_option_ids
  ON public.xero_invoice_line_items USING GIN (tracking_option_ids);
CREATE INDEX IF NOT EXISTS idx_xero_bt_tracking_option_ids
  ON public.xero_bank_transactions USING GIN (tracking_option_ids);

-- ─────────────────────────────────────────────────────────────
-- D. Saint Catherine exclusion flag
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.practice_locations
  ADD COLUMN IF NOT EXISTS exclude_from_financial_display BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.practice_locations.exclude_from_financial_display IS
  'When true, location still syncs accounting data but is omitted from financial UI and All Locations aggregates.';

UPDATE public.practice_locations
SET exclude_from_financial_display = true,
    updated_at = NOW()
WHERE exclude_from_financial_display = false
  AND (
    location_name ~* 'saint[[:space:]]*catherine'
    OR location_name ~* 'st\.?[[:space:]]*catherine'
  );

-- ─────────────────────────────────────────────────────────────
-- E. P&L scoped by tracking option ('' = unscoped / org-level)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.xero_profit_loss
  ADD COLUMN IF NOT EXISTS xero_tracking_option_id VARCHAR(100) NOT NULL DEFAULT '';

-- Replace unique constraint to include tracking option
ALTER TABLE public.xero_profit_loss
  DROP CONSTRAINT IF EXISTS xero_profit_loss_unique_per_period;

ALTER TABLE public.xero_profit_loss
  ADD CONSTRAINT xero_profit_loss_unique_per_period
    UNIQUE (organization_id, xero_tenant_id, xero_account_id, to_date, xero_tracking_option_id);

CREATE INDEX IF NOT EXISTS idx_xero_pl_tracking_option
  ON public.xero_profit_loss(xero_tracking_option_id)
  WHERE xero_tracking_option_id <> '';

COMMENT ON COLUMN public.xero_profit_loss.xero_tracking_option_id IS
  'Xero TrackingOptionID for option-scoped P&L rows; empty string = unscoped tenant total.';

-- ─────────────────────────────────────────────────────────────
-- F. Update get_xero_op_cost to honour tracking option + exclude flag
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_xero_op_cost(
    p_org_id      UUID,
    p_location_id UUID,
    p_from_date   DATE,
    p_to_date     DATE
)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    WITH location_scope AS (
        SELECT
            pio.id AS xero_tenant_id,
            COALESCE(NULLIF(TRIM(piom.xero_tracking_option_id), ''), '') AS tracking_option_id
        FROM public.platform_integration_organization_mapping piom
        JOIN public.platform_integration_organizations pio
            ON pio.id = piom.platform_integration_organizations_id
        JOIN public.practice_locations ploc
            ON ploc.id = piom.location_id
        WHERE piom.location_id     = p_location_id
          AND piom.organization_id = p_org_id
          AND pio.platform_name    = 'xero'
          AND COALESCE(ploc.exclude_from_financial_display, false) = false
        LIMIT 1
    )
    SELECT COALESCE(SUM(pl.amount), 0)
    FROM public.xero_chart_of_accounts coa
    JOIN public.xero_profit_loss pl
        ON pl.xero_account_id = coa.xero_account_id
       AND pl.organization_id = coa.organization_id
       AND pl.xero_tenant_id  = coa.xero_tenant_id
       AND pl.from_date       >= p_from_date
       AND pl.to_date         <= p_to_date
       AND pl.xero_tracking_option_id = (SELECT tracking_option_id FROM location_scope)
    WHERE coa.organization_id = p_org_id
      AND coa.xero_tenant_id  = (SELECT xero_tenant_id FROM location_scope)
      AND coa.account_type    IN ('EXPENSE', 'DEPRECIATN', 'OVERHEADS')
      AND EXISTS (SELECT 1 FROM location_scope);
$$;

COMMENT ON FUNCTION public.get_xero_op_cost IS
    'Returns total operating cost from xero_profit_loss for a location. '
    'Uses platform_integration_organization_mapping tenant + optional '
    'xero_tracking_option_id. Locations with exclude_from_financial_display are skipped.';

-- All-locations: sum option-scoped rows for mapped options + unscoped once
-- per tenant that has no option mappings (excluding hidden locations).
CREATE OR REPLACE FUNCTION public.get_xero_op_cost_all_locations(
    p_org_id    UUID,
    p_from_date DATE,
    p_to_date   DATE
)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    WITH visible_mappings AS (
        SELECT
            pio.id AS xero_tenant_id,
            COALESCE(NULLIF(TRIM(pio.platform_org_id), ''), pio.id::text) AS tenant_key,
            COALESCE(NULLIF(TRIM(piom.xero_tracking_option_id), ''), '') AS tracking_option_id
        FROM public.platform_integration_organization_mapping piom
        JOIN public.platform_integration_organizations pio
            ON pio.id = piom.platform_integration_organizations_id
        JOIN public.practice_locations ploc
            ON ploc.id = piom.location_id
        WHERE piom.organization_id = p_org_id
          AND pio.platform_name    = 'xero'
          AND COALESCE(ploc.exclude_from_financial_display, false) = false
    ),
    -- Tenants that have at least one tracking option mapping among visible locs
    tenants_with_options AS (
        SELECT DISTINCT xero_tenant_id
        FROM visible_mappings
        WHERE tracking_option_id <> ''
    ),
    option_scopes AS (
        SELECT DISTINCT xero_tenant_id, tracking_option_id
        FROM visible_mappings
        WHERE tracking_option_id <> ''
    ),
    -- Unscoped: tenants with visible mappings but no option splits
    unscoped_tenants AS (
        SELECT DISTINCT ON (vm.tenant_key) vm.xero_tenant_id
        FROM visible_mappings vm
        WHERE vm.xero_tenant_id NOT IN (SELECT xero_tenant_id FROM tenants_with_options)
        ORDER BY vm.tenant_key, vm.xero_tenant_id
    ),
    option_total AS (
        SELECT COALESCE(SUM(pl.amount), 0) AS amount
        FROM option_scopes os
        JOIN public.xero_chart_of_accounts coa
            ON coa.organization_id = p_org_id
           AND coa.xero_tenant_id  = os.xero_tenant_id
           AND coa.account_type    IN ('EXPENSE', 'DEPRECIATN', 'OVERHEADS')
        JOIN public.xero_profit_loss pl
            ON pl.xero_account_id = coa.xero_account_id
           AND pl.organization_id = coa.organization_id
           AND pl.xero_tenant_id  = coa.xero_tenant_id
           AND pl.from_date       >= p_from_date
           AND pl.to_date         <= p_to_date
           AND pl.xero_tracking_option_id = os.tracking_option_id
    ),
    unscoped_total AS (
        SELECT COALESCE(SUM(pl.amount), 0) AS amount
        FROM unscoped_tenants ut
        JOIN public.xero_chart_of_accounts coa
            ON coa.organization_id = p_org_id
           AND coa.xero_tenant_id  = ut.xero_tenant_id
           AND coa.account_type    IN ('EXPENSE', 'DEPRECIATN', 'OVERHEADS')
        JOIN public.xero_profit_loss pl
            ON pl.xero_account_id = coa.xero_account_id
           AND pl.organization_id = coa.organization_id
           AND pl.xero_tenant_id  = coa.xero_tenant_id
           AND pl.from_date       >= p_from_date
           AND pl.to_date         <= p_to_date
           AND pl.xero_tracking_option_id = ''
    )
    SELECT COALESCE((SELECT amount FROM option_total), 0)
         + COALESCE((SELECT amount FROM unscoped_total), 0);
$$;

COMMENT ON FUNCTION public.get_xero_op_cost_all_locations IS
    'Org-wide Xero op cost: sums option-scoped P&L for mapped tracking options '
    'and unscoped P&L once per tenant without option mappings. Excludes '
    'practice_locations.exclude_from_financial_display.';

-- ─────────────────────────────────────────────────────────────
-- G. Journal net-by-month: keep 4-arg; add scoped overload
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_xero_journal_net_by_month_scoped(
  p_organization_id UUID,
  p_from_date DATE,
  p_to_date DATE,
  p_account_ids TEXT[],
  p_tenant_ids UUID[] DEFAULT NULL,
  p_tracking_option_id TEXT DEFAULT NULL
)
RETURNS TABLE(month_start DATE, net_sum NUMERIC)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    date_trunc('month', j.journal_date)::date AS month_start,
    COALESCE(SUM(j.net_amount), 0)::numeric AS net_sum
  FROM public.xero_journal_details j
  WHERE j.organization_id = p_organization_id
    AND j.journal_date >= p_from_date
    AND j.journal_date <= p_to_date
    AND (
      p_account_ids IS NULL
      OR cardinality(p_account_ids) = 0
      OR j.account_id = ANY (p_account_ids)
    )
    AND (p_tenant_ids IS NULL OR j.platform_integration_organization_id = ANY (p_tenant_ids))
    AND (
      p_tracking_option_id IS NULL
      OR p_tracking_option_id = ''
      OR j.tracking_option_ids @> ARRAY[p_tracking_option_id]::text[]
    )
  GROUP BY 1
  ORDER BY 1;
$$;

COMMENT ON FUNCTION public.get_xero_journal_net_by_month_scoped(uuid, date, date, text[], uuid[], text) IS
  'Sum xero_journal_details.net_amount by month with optional tenant + tracking option filters.';

GRANT EXECUTE ON FUNCTION public.get_xero_journal_net_by_month_scoped(uuid, date, date, text[], uuid[], text)
  TO authenticated, anon, service_role;
