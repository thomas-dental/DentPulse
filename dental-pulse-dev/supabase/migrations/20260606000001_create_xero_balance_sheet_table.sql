-- Xero Balance Sheet snapshots (month-end account balances).
-- Used to anchor cashflow statement opening/closing balances to match Xero BS.

CREATE TABLE IF NOT EXISTS public.xero_balance_sheet (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  organization_id         UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  platform_integration_id UUID REFERENCES public.platform_integrations(id) ON DELETE CASCADE,
  xero_tenant_id          UUID REFERENCES public.platform_integration_organizations(id) ON DELETE CASCADE,
  user_id                 UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  from_date    DATE     NOT NULL,
  to_date      DATE     NOT NULL,
  period_year  SMALLINT NOT NULL,
  period_month SMALLINT NOT NULL,

  -- BS section title, e.g. 'Cash at bank and in hand', 'Bank'
  section VARCHAR(255),

  xero_account_id VARCHAR(500) NOT NULL,
  amount          NUMERIC(15, 2) NOT NULL DEFAULT 0,

  synced_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT xero_balance_sheet_unique_per_period
    UNIQUE (organization_id, xero_tenant_id, xero_account_id, to_date)
);

CREATE INDEX IF NOT EXISTS idx_xero_bs_organization_id ON public.xero_balance_sheet(organization_id);
CREATE INDEX IF NOT EXISTS idx_xero_bs_xero_tenant_id  ON public.xero_balance_sheet(xero_tenant_id);
CREATE INDEX IF NOT EXISTS idx_xero_bs_to_date          ON public.xero_balance_sheet(to_date);
CREATE INDEX IF NOT EXISTS idx_xero_bs_section          ON public.xero_balance_sheet(section);
CREATE INDEX IF NOT EXISTS idx_xero_bs_xero_account_id  ON public.xero_balance_sheet(xero_account_id);
CREATE INDEX IF NOT EXISTS idx_xero_bs_period           ON public.xero_balance_sheet(organization_id, xero_tenant_id, period_year, period_month);

ALTER TABLE public.xero_balance_sheet ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "xero_bs_select" ON public.xero_balance_sheet;
CREATE POLICY "xero_bs_select" ON public.xero_balance_sheet FOR SELECT
  USING (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "xero_bs_insert" ON public.xero_balance_sheet;
CREATE POLICY "xero_bs_insert" ON public.xero_balance_sheet FOR INSERT
  WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "xero_bs_update" ON public.xero_balance_sheet;
CREATE POLICY "xero_bs_update" ON public.xero_balance_sheet FOR UPDATE
  USING (public.user_in_org(auth.uid(), organization_id))
  WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "xero_bs_delete" ON public.xero_balance_sheet;
CREATE POLICY "xero_bs_delete" ON public.xero_balance_sheet FOR DELETE
  USING (public.user_in_org(auth.uid(), organization_id));

COMMENT ON TABLE public.xero_balance_sheet IS
  'Xero Balance Sheet — one row per account per as-of date (typically month-end). '
  'Anchors cashflow statement balances to match Xero Total Cash at bank and in hand.';
