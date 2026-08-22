-- Monthly journal net totals for a set of Xero account IDs.
-- Used by Group Dashboard profit trend to replace N×month journal pagination
-- with one GROUP BY month query (same abs(sum) contract as client sumRevenue).

CREATE OR REPLACE FUNCTION public.get_xero_journal_net_by_month(
  p_organization_id uuid,
  p_from_date date,
  p_to_date date,
  p_account_ids text[]
)
RETURNS TABLE (
  month_start date,
  net_sum numeric
)
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
  GROUP BY 1
  ORDER BY 1;
$$;

COMMENT ON FUNCTION public.get_xero_journal_net_by_month(uuid, date, date, text[]) IS
  'Sum xero_journal_details.net_amount by calendar month for the given accounts; used for multi-month income trend.';

GRANT EXECUTE ON FUNCTION public.get_xero_journal_net_by_month(uuid, date, date, text[])
  TO authenticated, service_role;
