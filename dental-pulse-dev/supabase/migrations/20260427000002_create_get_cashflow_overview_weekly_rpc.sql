-- ============================================================
-- RPC: get_cashflow_overview_weekly
--
-- Powers the dashboard's "Cashflow Overview" widget. Returns Total
-- Received, Total Paid, Net Cashflow, and Closing Balance for two
-- adjacent calendar weeks, summed at the **bank-transaction level**
-- by transaction_date — no monthly average, no pro-rating.
--
-- Source: xero_bank_transactions
--   type = 'RECEIVE'  → Total Received
--   type = 'SPEND'    → Total Paid
--   type = 'TRANSFER' → counted on both sides (matches the
--                       cashflow-report edge function's behaviour)
--
-- Closing Balance is the cumulative (received − paid) over the report
-- window starting at p_anchor_date, mirroring the Statement of Cash
-- Flows page where the running balance starts at £0 on the report's
-- fromDate (default: Jan 1 of the current year).
-- ============================================================

DROP FUNCTION IF EXISTS public.get_cashflow_overview_weekly(UUID, UUID[], DATE, DATE, DATE, DATE);
DROP FUNCTION IF EXISTS public.get_cashflow_overview_weekly(UUID, UUID[], DATE, DATE, DATE, DATE, DATE);

CREATE OR REPLACE FUNCTION public.get_cashflow_overview_weekly(
    p_organization_id UUID,
    p_tenant_ids      UUID[],   -- platform_integration_organizations.id[]; NULL/empty = all
    p_anchor_date     DATE,     -- running balance starts at £0 on this date
    p_last_start      DATE,
    p_last_end        DATE,
    p_this_start      DATE,
    p_this_end        DATE
)
RETURNS TABLE (
    received_last  NUMERIC,
    paid_last      NUMERIC,
    net_last       NUMERIC,
    closing_last   NUMERIC,
    received_this  NUMERIC,
    paid_this      NUMERIC,
    net_this       NUMERIC,
    closing_this   NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    WITH scoped AS (
        SELECT
            transaction_date,
            UPPER(COALESCE(type, ''))     AS t,
            COALESCE(total, 0)::NUMERIC   AS amt
        FROM public.xero_bank_transactions
        WHERE organization_id = p_organization_id
          AND transaction_date IS NOT NULL
          AND transaction_date >= p_anchor_date
          AND (
              p_tenant_ids IS NULL
              OR array_length(p_tenant_ids, 1) IS NULL
              OR platform_integration_organization_id = ANY (p_tenant_ids)
          )
    ),
    flows AS (
        SELECT
            -- Last week
            COALESCE(SUM(amt) FILTER (
                WHERE transaction_date BETWEEN p_last_start AND p_last_end
                  AND (t = 'RECEIVE' OR t = 'TRANSFER')
            ), 0) AS received_last,
            COALESCE(SUM(amt) FILTER (
                WHERE transaction_date BETWEEN p_last_start AND p_last_end
                  AND (t = 'SPEND' OR t = 'TRANSFER')
            ), 0) AS paid_last,
            -- This week
            COALESCE(SUM(amt) FILTER (
                WHERE transaction_date BETWEEN p_this_start AND p_this_end
                  AND (t = 'RECEIVE' OR t = 'TRANSFER')
            ), 0) AS received_this,
            COALESCE(SUM(amt) FILTER (
                WHERE transaction_date BETWEEN p_this_start AND p_this_end
                  AND (t = 'SPEND' OR t = 'TRANSFER')
            ), 0) AS paid_this,
            -- Cumulative receipts/payments since p_anchor_date up to each week's end
            COALESCE(SUM(amt) FILTER (
                WHERE transaction_date <= p_last_end
                  AND (t = 'RECEIVE' OR t = 'TRANSFER')
            ), 0) AS cum_recv_last,
            COALESCE(SUM(amt) FILTER (
                WHERE transaction_date <= p_last_end
                  AND (t = 'SPEND' OR t = 'TRANSFER')
            ), 0) AS cum_paid_last,
            COALESCE(SUM(amt) FILTER (
                WHERE transaction_date <= p_this_end
                  AND (t = 'RECEIVE' OR t = 'TRANSFER')
            ), 0) AS cum_recv_this,
            COALESCE(SUM(amt) FILTER (
                WHERE transaction_date <= p_this_end
                  AND (t = 'SPEND' OR t = 'TRANSFER')
            ), 0) AS cum_paid_this
        FROM scoped
    )
    SELECT
        received_last,
        paid_last,
        (received_last - paid_last)                AS net_last,
        (cum_recv_last - cum_paid_last)            AS closing_last,
        received_this,
        paid_this,
        (received_this - paid_this)                AS net_this,
        (cum_recv_this - cum_paid_this)            AS closing_this
    FROM flows;
$$;

COMMENT ON FUNCTION public.get_cashflow_overview_weekly IS
    'Returns weekly cashflow metrics (received, paid, net, closing balance) '
    'for two adjacent weeks from xero_bank_transactions, summed at the '
    'transaction date level. Closing balance accumulates from p_anchor_date '
    '(the report-window start, matching the Statement of Cash Flows page). '
    'Used by the Cashflow Overview dashboard widget.';

GRANT EXECUTE ON FUNCTION public.get_cashflow_overview_weekly TO anon, authenticated;
