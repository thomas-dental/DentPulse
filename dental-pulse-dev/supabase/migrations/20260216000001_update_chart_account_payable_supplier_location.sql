-- ============================================
-- Update Account Payable Supplier Analytics Procedure
-- Add optional location_id filter
-- ============================================

-- Drop the old function first
DROP FUNCTION IF EXISTS chart_account_payable_supplier(DATE, DATE, UUID);

-- Create updated function with location filter
CREATE OR REPLACE FUNCTION chart_account_payable_supplier(
  p_start_date DATE,
  p_end_date DATE,
  p_organization_id UUID,
  p_location_id UUID DEFAULT NULL
)
RETURNS TABLE (
  vendor_name TEXT,
  invoice_count INTEGER,
  total_amount NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(api.vendor_name, 'Unknown Supplier')::TEXT AS vendor_name,
    COUNT(*)::INTEGER AS invoice_count,
    ROUND(COALESCE(SUM(COALESCE(api.total_amount, api.amount, 0)), 0), 2) AS total_amount
  FROM accounts_payable_invoice api
  WHERE api.organization_id = p_organization_id
    AND COALESCE(api.invoice_date, api.created_at::DATE) BETWEEN p_start_date AND p_end_date
    AND (p_location_id IS NULL OR api.location_id = p_location_id)
  GROUP BY api.vendor_name
  ORDER BY total_amount DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION chart_account_payable_supplier(DATE, DATE, UUID, UUID) TO authenticated;

-- Add comment
COMMENT ON FUNCTION chart_account_payable_supplier(DATE, DATE, UUID, UUID) IS
'Returns supplier spend analytics for Accounts Payable.
Groups invoices by vendor and returns count and total amount.
Optionally filters by location_id (NULL = all locations).
Ordered by total amount descending (highest spenders first).';
