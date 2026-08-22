-- ============================================================================
-- Migration: Create function to get iplicit Profit & Loss total amount
--            by account group code (recursive hierarchy traversal)
-- Created: 2026-02-26
--
-- USAGE:
--   SELECT * FROM get_iplicit_pl_amount_cost_by_date(
--     'c6cf807a-9871-4b5a-a8c0-72e74e71dd31',  -- p_organization_id
--     '2025-04-01',                              -- p_start_date
--     '2026-01-31',                              -- p_end_date
--     'TC'                                       -- p_account_code
--   );
-- ============================================================================

CREATE OR REPLACE FUNCTION get_iplicit_pl_amount_cost_by_date(
  p_organization_id  UUID,
  p_start_date       DATE,
  p_end_date         DATE,
  p_account_code     VARCHAR
)
RETURNS TABLE (
  total_amount       NUMERIC,
  account_code       VARCHAR,
  account_group_desc VARCHAR,
  start_date         DATE,
  end_date           DATE
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  WITH RECURSIVE group_tree AS (
    -- Anchor: find the root account group matching the given code
    SELECT
      g.account_group_id,
      g.code,
      g.description
    FROM iplicit_coa_account_groups g
    WHERE g.code            = p_account_code
      AND g.organization_id = p_organization_id

    UNION ALL

    -- Recursive: find all child groups under the root
    SELECT
      g.account_group_id,
      g.code,
      g.description
    FROM iplicit_coa_account_groups g
    JOIN group_tree gt ON g.parent_coa_group_id = gt.account_group_id
    WHERE g.organization_id = p_organization_id
  )
  SELECT
    SUM(pl.amount)                              AS total_amount,
    p_account_code::VARCHAR                     AS account_code,
    (
      SELECT g.description
      FROM iplicit_coa_account_groups g
      WHERE g.code            = p_account_code
        AND g.organization_id = p_organization_id
      LIMIT 1
    )::VARCHAR                                  AS account_group_desc,
    p_start_date                                AS start_date,
    p_end_date                                  AS end_date
  FROM iplicit_profit_loss pl
  JOIN group_tree grp ON grp.account_group_id = pl.coa_group_id
  WHERE
    pl.organization_id       = p_organization_id
    AND pl.period_date::DATE >= p_start_date
    AND pl.period_date::DATE <= p_end_date;
END;
$$;

COMMENT ON FUNCTION get_iplicit_pl_amount_cost_by_date(UUID, DATE, DATE, VARCHAR) IS
'Returns total aggregated Profit & Loss amount for an iplicit account group
and all its descendants via recursive hierarchy traversal.

PARAMETERS:
  p_organization_id  - Organization UUID
  p_start_date       - Start of date range (inclusive)
  p_end_date         - End of date range (inclusive)
  p_account_code     - Root account group code (e.g. ''TC'', ''DR'', ''CR'')

RETURNS:
  total_amount       - Sum of all P&L amounts across the full date range
  account_code       - The account code passed as parameter
  account_group_desc - Description of the root account group

EXAMPLES:

  -- Get total for a single account group
  SELECT * FROM get_iplicit_pl_amount_cost_by_date(
    ''c6cf807a-9871-4b5a-a8c0-72e74e71dd31'',
    ''2025-04-01'',
    ''2026-01-31'',
    ''TC''
  );

  -- Get totals for multiple groups
  SELECT * FROM get_iplicit_pl_amount_cost_by_date(org_id, start, end, ''TC'')
  UNION ALL
  SELECT * FROM get_iplicit_pl_amount_cost_by_date(org_id, start, end, ''DR'');

  -- Via Supabase RPC
  supabase.rpc(''get_iplicit_pl_amount_cost_by_date'', {
    p_organization_id: orgId,
    p_start_date: ''2025-04-01'',
    p_end_date: ''2026-01-31'',
    p_account_code: ''TC''
  })
';
