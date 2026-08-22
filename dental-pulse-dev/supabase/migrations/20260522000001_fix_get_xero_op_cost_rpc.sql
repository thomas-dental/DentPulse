-- ============================================================
-- Fix: get_xero_op_cost
-- Replaced practice_locations account bucket lookup with
-- platform_integration_organization_mapping → xero_tenant_id.
-- Filters xero_chart_of_accounts by account_type IN
-- ('EXPENSE', 'DEPRECIATN', 'OVERHEADS') and joins
-- xero_profit_loss on xero_tenant_id for correctness.
-- ============================================================

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
    WITH location_tenant AS (
        SELECT pio.id AS xero_tenant_id
        FROM public.platform_integration_organization_mapping piom
        JOIN public.platform_integration_organizations pio
            ON pio.id = piom.platform_integration_organizations_id
        WHERE piom.location_id     = p_location_id
          AND piom.organization_id = p_org_id
          AND pio.platform_name    = 'xero'
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
    WHERE coa.organization_id = p_org_id
      AND coa.xero_tenant_id  = (SELECT xero_tenant_id FROM location_tenant)
      AND coa.account_type    IN ('EXPENSE', 'DEPRECIATN', 'OVERHEADS');
$$;

COMMENT ON FUNCTION public.get_xero_op_cost IS
    'Returns total operating cost from xero_profit_loss for a location. '
    'Resolves xero_tenant_id via platform_integration_organization_mapping '
    'and sums P&L entries for account_type EXPENSE / DEPRECIATN / OVERHEADS.';
