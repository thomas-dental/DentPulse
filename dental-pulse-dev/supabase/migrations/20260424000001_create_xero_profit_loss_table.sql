-- ============================================================
-- Dedicated Xero Profit & Loss table.
-- One row per (account × calendar month).
-- Account details (code, name, type) live in xero_chart_of_accounts
-- and are joined at query time — not duplicated here.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.xero_profit_loss (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Ownership / tenancy
  organization_id         UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  platform_integration_id UUID REFERENCES public.platform_integrations(id) ON DELETE CASCADE,
  xero_tenant_id          UUID REFERENCES public.platform_integration_organizations(id) ON DELETE CASCADE,
  user_id                 UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Period (one row = one calendar month)
  from_date    DATE     NOT NULL,   -- first day of the month
  to_date      DATE     NOT NULL,   -- last day of the month
  period_year  SMALLINT NOT NULL,
  period_month SMALLINT NOT NULL,

  -- P&L section hierarchy as returned by Xero.
  -- Top-level section title, e.g.:
  --   'Income', 'Cost of Sales', 'Less Operating Expenses',
  --   'Less Other Income', 'Less Other Expenses'
  section VARCHAR(255),

  -- Xero AccountID — soft FK to xero_chart_of_accounts.xero_account_id.
  -- Join to xero_chart_of_accounts for account_code / account_name / account_type.
  xero_account_id VARCHAR(500) NOT NULL,

  -- Amount exactly as shown in the Xero P&L.
  -- Positive for both income and expense lines (mirrors Xero display).
  amount NUMERIC(15, 2) NOT NULL DEFAULT 0,

  synced_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- One value per account per period per tenant
  CONSTRAINT xero_profit_loss_unique_per_period
    UNIQUE (organization_id, xero_tenant_id, xero_account_id, to_date)
);

CREATE INDEX IF NOT EXISTS idx_xero_pl_organization_id ON public.xero_profit_loss(organization_id);
CREATE INDEX IF NOT EXISTS idx_xero_pl_xero_tenant_id  ON public.xero_profit_loss(xero_tenant_id);
CREATE INDEX IF NOT EXISTS idx_xero_pl_to_date          ON public.xero_profit_loss(to_date);
CREATE INDEX IF NOT EXISTS idx_xero_pl_section          ON public.xero_profit_loss(section);
CREATE INDEX IF NOT EXISTS idx_xero_pl_xero_account_id  ON public.xero_profit_loss(xero_account_id);
CREATE INDEX IF NOT EXISTS idx_xero_pl_period           ON public.xero_profit_loss(organization_id, xero_tenant_id, period_year, period_month);

ALTER TABLE public.xero_profit_loss ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "xero_pl_select" ON public.xero_profit_loss;
CREATE POLICY "xero_pl_select" ON public.xero_profit_loss FOR SELECT
  USING (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "xero_pl_insert" ON public.xero_profit_loss;
CREATE POLICY "xero_pl_insert" ON public.xero_profit_loss FOR INSERT
  WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "xero_pl_update" ON public.xero_profit_loss;
CREATE POLICY "xero_pl_update" ON public.xero_profit_loss FOR UPDATE
  USING (public.user_in_org(auth.uid(), organization_id))
  WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "xero_pl_delete" ON public.xero_profit_loss;
CREATE POLICY "xero_pl_delete" ON public.xero_profit_loss FOR DELETE
  USING (public.user_in_org(auth.uid(), organization_id));

COMMENT ON TABLE public.xero_profit_loss IS
  'Xero P&L report — one row per account per calendar month. '
  'Join to xero_chart_of_accounts on xero_account_id for account details. '
  'Created 2026-04-24.';
