-- ============================================================
-- RPC: get_quickbooks_op_cost
-- Returns the total Expenses-section amount from
-- quickbooks_profit_loss for a given location, org, and date range.
--
-- The location is resolved to a quickbooks_company_id via
-- platform_integration_organization_mapping →
-- platform_integration_organizations (platform_name = 'quickbooks').
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_quickbooks_op_cost(
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
    WITH location_tenant AS (
        SELECT pio.id AS quickbooks_company_id
        FROM public.platform_integration_organization_mapping piom
        JOIN public.platform_integration_organizations pio
            ON pio.id = piom.platform_integration_organizations_id
        WHERE piom.location_id     = p_location_id
          AND piom.organization_id = p_org_id
          AND pio.platform_name    = 'quickbooks'
        LIMIT 1
    )
    SELECT COALESCE(SUM(pl.amount), 0)
    FROM public.quickbooks_chart_of_accounts coa
    JOIN public.quickbooks_profit_loss pl
        ON pl.qb_account_id         = coa.qb_account_id
       AND pl.organization_id       = coa.organization_id
       AND pl.quickbooks_company_id = coa.quickbooks_company_id
       AND pl.from_date             >= p_from_date
       AND pl.to_date               <= p_to_date
    WHERE coa.organization_id       = p_org_id
      AND coa.quickbooks_company_id = (SELECT quickbooks_company_id FROM location_tenant)
      AND pl.section                IN ('Expenses');
$$;

COMMENT ON FUNCTION public.get_quickbooks_op_cost IS
    'Returns total Expenses-section operating cost from quickbooks_profit_loss '
    'for a specific location. Resolves the location to its mapped QuickBooks '
    'company via platform_integration_organization_mapping.';
