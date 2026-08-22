-- ============================================================================
-- Processing Efficiency Metrics Stored Procedure
-- Returns Auto-Processed percentage for the specified date range
-- Auto-Processed = (Extracted invoices / Total email attachments) × 100
-- ============================================================================

CREATE OR REPLACE FUNCTION get_auto_processed_percentage(
  p_start_date DATE,
  p_end_date DATE,
  p_organization_id UUID
)
RETURNS TABLE (
  total_attachments INTEGER,
  extracted_invoices INTEGER,
  auto_processed_percentage NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  WITH filtered_attachments AS (
    SELECT
      iea.id,
      iea.invoice_id
    FROM inbound_email_attachments iea
    INNER JOIN inbound_emails ie ON ie.id = iea.inbound_email_id
    WHERE ie.organization_id = p_organization_id
      AND iea.is_invoice_pdf = true
      AND iea.created_at::DATE BETWEEN p_start_date AND p_end_date
  )
  SELECT
    COUNT(*)::INTEGER AS total_attachments,
    COUNT(invoice_id)::INTEGER AS extracted_invoices,
    CASE
      WHEN COUNT(*) > 0 THEN ROUND((COUNT(invoice_id)::NUMERIC / COUNT(*)::NUMERIC) * 100, 0)
      ELSE 0
    END AS auto_processed_percentage
  FROM filtered_attachments;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION get_auto_processed_percentage(DATE, DATE, UUID) TO authenticated;

-- Add comment
COMMENT ON FUNCTION get_auto_processed_percentage(DATE, DATE, UUID) IS
'Returns auto-processed percentage for the specified date range.
Calculates: (Extracted invoices / Total email attachments with is_invoice_pdf=true) × 100';
