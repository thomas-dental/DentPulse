-- ============================================
-- Accounts Payable Analytics Chart Procedure
-- ============================================

CREATE OR REPLACE FUNCTION chart_account_payable_analytics(
  p_start_date DATE,
  p_end_date DATE,
  p_organization_id UUID
)
RETURNS TABLE (
  month_year TEXT,
  month_name TEXT,
  invoice_count INTEGER,
  total_amount NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    TO_CHAR(COALESCE(api.invoice_date, api.created_at::DATE), 'YYYY-MM') AS month_year,
    TO_CHAR(COALESCE(api.invoice_date, api.created_at::DATE), 'Mon') AS month_name,
    COUNT(*)::INTEGER AS invoice_count,
    ROUND(COALESCE(SUM(COALESCE(api.total_amount, api.amount, 0)), 0), 2) AS total_amount
  FROM accounts_payable_invoice api
  WHERE api.organization_id = p_organization_id
    AND COALESCE(api.invoice_date, api.created_at::DATE) BETWEEN p_start_date AND p_end_date
  GROUP BY
    TO_CHAR(COALESCE(api.invoice_date, api.created_at::DATE), 'YYYY-MM'),
    TO_CHAR(COALESCE(api.invoice_date, api.created_at::DATE), 'Mon')
  ORDER BY month_year;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION chart_account_payable_analytics(DATE, DATE, UUID) TO authenticated;

-- Add comment
COMMENT ON FUNCTION chart_account_payable_analytics(DATE, DATE, UUID) IS
'Returns monthly invoice volume for Accounts Payable analytics chart.
Groups invoices by month and returns count and total amount.
Uses invoice_date if available, otherwise falls back to created_at.';
