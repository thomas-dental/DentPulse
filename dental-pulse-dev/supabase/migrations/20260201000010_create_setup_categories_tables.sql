-- Setup Categories feature (reference: db-dentpulse CategoryRangeMaster, CategoryRangeMap, CategoryWishListMaster, CategoryWishList)
-- Category Range Master (reference data - cash flow categories)
CREATE TABLE IF NOT EXISTS public.category_range_master (
    id SMALLINT PRIMARY KEY,
    range_order INT,
    code VARCHAR(100),
    name VARCHAR(100),
    range_group VARCHAR(50),
    range_sub_group VARCHAR(50)
);

-- Category Wish List Master (reference data - expense/revenue categories, sector-specific)
CREATE TABLE IF NOT EXISTS public.category_wish_list_master (
    id SMALLINT PRIMARY KEY,
    range_order INT,
    name VARCHAR(100),
    category_wish_list VARCHAR(255),
    sector_id SMALLINT NOT NULL DEFAULT 10
);

-- Category Range Map (org + connection scoped: maps COA account to a category range)
CREATE TABLE IF NOT EXISTS public.category_range_map (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    platform_integration_id UUID REFERENCES public.platform_integrations(id) ON DELETE CASCADE,
    platform_integration_organization_id UUID REFERENCES public.platform_integration_organizations(id) ON DELETE CASCADE,
    location_id VARCHAR(500) NOT NULL,
    category_range_id SMALLINT NOT NULL REFERENCES public.category_range_master(id),
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_category_range_map_org ON public.category_range_map(organization_id);
CREATE INDEX IF NOT EXISTS idx_category_range_map_platform ON public.category_range_map(platform_integration_id);
CREATE INDEX IF NOT EXISTS idx_category_range_map_org_platform ON public.category_range_map(organization_id, platform_integration_id);

-- Category Wish List (org + connection scoped: maps COA account to a wish list category)
CREATE TABLE IF NOT EXISTS public.category_wish_list (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    platform_integration_id UUID REFERENCES public.platform_integrations(id) ON DELETE CASCADE,
    platform_integration_organization_id UUID REFERENCES public.platform_integration_organizations(id) ON DELETE CASCADE,
    location_id VARCHAR(500) NOT NULL,
    category_wish_list_master_id SMALLINT NOT NULL REFERENCES public.category_wish_list_master(id),
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_category_wish_list_org ON public.category_wish_list(organization_id);
CREATE INDEX IF NOT EXISTS idx_category_wish_list_platform ON public.category_wish_list(platform_integration_id);
CREATE INDEX IF NOT EXISTS idx_category_wish_list_org_platform ON public.category_wish_list(organization_id, platform_integration_id);

-- Add AR/AP flags to chart of accounts (reference: be-dentpulse ChartOfAccounts.IsArAccount, IsApAccount)
ALTER TABLE public.platform_integration_chart_of_accounts
    ADD COLUMN IF NOT EXISTS coa_is_ar_account BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS coa_is_ap_account BOOLEAN DEFAULT false;

-- RLS for category_range_master, category_wish_list_master (read-only reference data, no RLS or allow anon read)
ALTER TABLE public.category_range_master ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.category_wish_list_master ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read category_range_master" ON public.category_range_master;
CREATE POLICY "Allow read category_range_master" ON public.category_range_master FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow read category_wish_list_master" ON public.category_wish_list_master;
CREATE POLICY "Allow read category_wish_list_master" ON public.category_wish_list_master FOR SELECT USING (true);

-- RLS for category_range_map, category_wish_list
ALTER TABLE public.category_range_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.category_wish_list ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage category_range_map in their org" ON public.category_range_map;
CREATE POLICY "Users can manage category_range_map in their org" ON public.category_range_map
FOR ALL USING (public.user_in_org(auth.uid(), organization_id))
WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can manage category_wish_list in their org" ON public.category_wish_list;
CREATE POLICY "Users can manage category_wish_list in their org" ON public.category_wish_list
FOR ALL USING (public.user_in_org(auth.uid(), organization_id))
WITH CHECK (public.user_in_org(auth.uid(), organization_id));
