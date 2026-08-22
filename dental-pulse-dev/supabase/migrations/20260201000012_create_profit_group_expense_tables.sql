-- Profit / Expense groups (reference: db-dentpulse GroupAccountMaster GroupType=2, GroupAccount)
-- group_type: 1 = Profit/Revenue, 2 = Expense/Benchmark (we only use 2 for dental-pulse-dev)

CREATE TABLE IF NOT EXISTS public.group_account_master (
    id SMALLINT PRIMARY KEY,
    range_order INT,
    name VARCHAR(100) NOT NULL,
    group_code VARCHAR(50) NOT NULL,
    description VARCHAR(250),
    sector_id SMALLINT,
    group_type SMALLINT NOT NULL DEFAULT 2
);

CREATE TABLE IF NOT EXISTS public.group_account (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    platform_integration_id UUID REFERENCES public.platform_integrations(id) ON DELETE CASCADE,
    group_account_master_id SMALLINT NOT NULL REFERENCES public.group_account_master(id),
    account_id VARCHAR(500) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_group_account_org ON public.group_account(organization_id);
CREATE INDEX IF NOT EXISTS idx_group_account_platform ON public.group_account(platform_integration_id);
CREATE INDEX IF NOT EXISTS idx_group_account_master ON public.group_account(group_account_master_id);

ALTER TABLE public.group_account_master ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_account ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read group_account_master" ON public.group_account_master;
CREATE POLICY "Allow read group_account_master" ON public.group_account_master FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can manage group_account in their org" ON public.group_account;
CREATE POLICY "Users can manage group_account in their org" ON public.group_account
FOR ALL USING (public.user_in_org(auth.uid(), organization_id))
WITH CHECK (public.user_in_org(auth.uid(), organization_id));
