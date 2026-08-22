-- ============================================================
-- RPC: get_xero_op_cost
-- Returns the total operating cost from xero_profit_loss for
-- a given location, org, and date range.
--
-- Account IDs stored in practice_locations expense columns are
-- xero_chart_of_accounts.id (Supabase UUID). We translate them
-- to xero_account_id (Xero GUID) to match xero_profit_loss.
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
    WITH coa_uuids AS (
        SELECT jsonb_array_elements_text(v) AS coa_id
        FROM public.practice_locations,
        LATERAL (VALUES
            (COALESCE(lab_fees_accounts,        '[]'::jsonb)),
            (COALESCE(staff_costs_accounts,     '[]'::jsonb)),
            (COALESCE(operating_lease_accounts, '[]'::jsonb)),
            (COALESCE(clinician_cost_accounts,  '[]'::jsonb)),
            (COALESCE(overhead_cost_accounts,   '[]'::jsonb)),
            (COALESCE(material_cost_accounts,   '[]'::jsonb))
        ) AS t(v)
        WHERE id = p_location_id
    ),
    xero_account_ids AS (
        SELECT coa.xero_account_id
        FROM public.xero_chart_of_accounts coa
        JOIN coa_uuids ON coa.id::text = coa_uuids.coa_id
        WHERE coa.organization_id = p_org_id
    )
    SELECT COALESCE(SUM(pl.amount), 0)
    FROM public.xero_profit_loss pl
    WHERE pl.organization_id = p_org_id
      AND pl.from_date       >= p_from_date
      AND pl.to_date         <= p_to_date
      AND pl.xero_account_id IN (SELECT xero_account_id FROM xero_account_ids);
$$;

COMMENT ON FUNCTION public.get_xero_op_cost IS
    'Returns total operating cost from xero_profit_loss for a location '
    'using expense accounts configured in practice_locations. '
    'Translates practice_locations account UUIDs (xero_chart_of_accounts.id) '
    'to Xero GUIDs (xero_account_id) before matching.';
