-- ============================================
-- Account Payable Automation Progress Procedure
-- Returns monthly counts of manual vs email invoices
-- Manual: invoices NOT linked to inbound_email_attachments
-- Email: invoices linked to inbound_email_attachments (via invoice_id)
-- Filtered by organization_id through inbound_emails table
-- ============================================

CREATE OR REPLACE FUNCTION chart_account_payable_automation(
  p_start_date DATE,
  p_end_date DATE,
  p_organization_id UUID
)
RETURNS TABLE (
  month_year TEXT,
  month_name TEXT,
  manual_count INTEGER,
  email_count INTEGER,
  total_count INTEGER
) AS $$
BEGIN
  RETURN QUERY
  WITH invoice_source AS (
    SELECT
      api.id,
      COALESCE(api.invoice_date, api.created_at::DATE) AS inv_date,
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM inbound_email_attachments iea
          INNER JOIN inbound_emails ie ON ie.id = iea.inbound_email_id
          WHERE iea.invoice_id = api.id
            AND ie.organization_id = p_organization_id
        )
        THEN 'email'
        ELSE 'manual'
      END AS source_type
    FROM accounts_payable_invoice api
    WHERE api.organization_id = p_organization_id
      AND COALESCE(api.invoice_date, api.created_at::DATE) BETWEEN p_start_date AND p_end_date
  )
  SELECT
    TO_CHAR(DATE_TRUNC('month', inv_date), 'YYYY-MM') AS month_year,
    TO_CHAR(DATE_TRUNC('month', inv_date), 'Mon') AS month_name,
    COUNT(*) FILTER (WHERE source_type = 'manual')::INTEGER AS manual_count,
    COUNT(*) FILTER (WHERE source_type = 'email')::INTEGER AS email_count,
    COUNT(*)::INTEGER AS total_count
  FROM invoice_source
  GROUP BY DATE_TRUNC('month', inv_date)
  ORDER BY DATE_TRUNC('month', inv_date) ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION chart_account_payable_automation(DATE, DATE, UUID) TO authenticated;

-- Add comment
COMMENT ON FUNCTION chart_account_payable_automation(DATE, DATE, UUID) IS
'Returns monthly automation progress for Accounts Payable.
Shows count of manual vs email (automated) invoices per month.
Used to track automation adoption over time.';
