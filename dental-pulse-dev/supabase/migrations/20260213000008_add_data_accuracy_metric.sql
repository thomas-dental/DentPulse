-- ============================================================================
-- Update Processing Efficiency Metrics Stored Procedure
-- Add Data Accuracy calculation (Average confidence_score from extracted invoices)
-- ============================================================================

-- Drop the existing function first (required when changing return type)
DROP FUNCTION IF EXISTS get_processing_efficiency_metrics(DATE, DATE, UUID);

-- Recreate the function with data accuracy metric
CREATE OR REPLACE FUNCTION get_processing_efficiency_metrics(
  p_start_date DATE,
  p_end_date DATE,
  p_organization_id UUID
)
RETURNS TABLE (
  total_attachments INTEGER,
  extracted_invoices INTEGER,
  auto_processed_percentage NUMERIC,
  avg_days_to_pay NUMERIC,
  paid_invoices_count INTEGER,
  avg_data_accuracy NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  WITH
  -- Auto-processed metrics from email attachments
  filtered_attachments AS (
    SELECT
      iea.id,
      iea.invoice_id
    FROM inbound_email_attachments iea
    INNER JOIN inbound_emails ie ON ie.id = iea.inbound_email_id
    WHERE ie.organization_id = p_organization_id
      AND iea.is_invoice_pdf = true
      AND iea.created_at::DATE BETWEEN p_start_date AND p_end_date
  ),
  auto_processed AS (
    SELECT
      COUNT(*)::INTEGER AS total_attachments,
      COUNT(invoice_id)::INTEGER AS extracted_invoices,
      CASE
        WHEN COUNT(*) > 0 THEN ROUND((COUNT(invoice_id)::NUMERIC / COUNT(*)::NUMERIC) * 100, 0)
        ELSE 0
      END AS auto_processed_percentage
    FROM filtered_attachments
  ),
  -- Avg Days to Pay from paid invoices
  paid_invoices AS (
    SELECT
      EXTRACT(EPOCH FROM (paid_at - shared_at)) / 86400.0 AS days_to_pay
    FROM accounts_payable_invoice
    WHERE organization_id = p_organization_id
      AND platform_status = 'PAID'
      AND shared_at IS NOT NULL
      AND paid_at IS NOT NULL
      AND paid_at::DATE BETWEEN p_start_date AND p_end_date
  ),
  days_to_pay_calc AS (
    SELECT
      ROUND(COALESCE(AVG(days_to_pay), 0)::NUMERIC, 1) AS avg_days,
      COUNT(*)::INTEGER AS paid_count
    FROM paid_invoices
  ),
  -- Data Accuracy from extracted invoices (average confidence_score)
  data_accuracy_calc AS (
    SELECT
      ROUND(COALESCE(AVG(confidence_score), 0)::NUMERIC, 0) AS avg_accuracy
    FROM accounts_payable_invoice
    WHERE organization_id = p_organization_id
      AND confidence_score IS NOT NULL
      AND created_at::DATE BETWEEN p_start_date AND p_end_date
  )
  SELECT
    ap.total_attachments,
    ap.extracted_invoices,
    ap.auto_processed_percentage,
    dtc.avg_days AS avg_days_to_pay,
    dtc.paid_count AS paid_invoices_count,
    dac.avg_accuracy AS avg_data_accuracy
  FROM auto_processed ap, days_to_pay_calc dtc, data_accuracy_calc dac;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION get_processing_efficiency_metrics(DATE, DATE, UUID) TO authenticated;

-- Add comment
COMMENT ON FUNCTION get_processing_efficiency_metrics(DATE, DATE, UUID) IS
'Returns processing efficiency metrics for the specified date range:
- auto_processed_percentage: (Extracted invoices / Total email attachments) × 100
- avg_days_to_pay: Average days between shared_at and paid_at for PAID invoices
- avg_data_accuracy: Average confidence_score from extracted invoices (0-100)';
