-- Function to get private treatment revenue matching Dentally Practitioner Activity Report.
-- Filters: completed date range, private payment plan, paid invoices at location, active treatments.
CREATE OR REPLACE FUNCTION get_private_treatment_revenue(
  p_organization_id UUID,
  p_location_id UUID,
  p_start_date TIMESTAMP,
  p_end_date TIMESTAMP
)
RETURNS TABLE (
  total_revenue NUMERIC,
  total_items BIGINT
)
LANGUAGE sql
STABLE
AS $$
  WITH location_uuids AS (
    SELECT LOWER(api_record_unique_id) AS site_uuid
    FROM practice_locations
    WHERE id = p_location_id
      AND organization_id = p_organization_id
      AND deleted_at IS NULL
      AND api_record_unique_id IS NOT NULL
  ),
  private_plan_ids AS (
    SELECT jsonb_array_elements_text(private_income_accounts)::bigint AS pp_id
    FROM practice_locations
    WHERE id = p_location_id
      AND organization_id = p_organization_id
      AND deleted_at IS NULL
      AND private_income_accounts IS NOT NULL
  ),
  paid_invoices_at_location AS (
    SELECT DISTINCT CAST(platform_invoice_id AS BIGINT) AS inv_id
    FROM platform_integration_invoices
    WHERE organization_id = p_organization_id
      AND deleted_at IS NULL
      AND LOWER(status) = 'paid'
      AND platform_invoice_id IS NOT NULL
      AND platform_invoice_id != ''
      AND LOWER(site_id::text) IN (SELECT site_uuid FROM location_uuids)
  ),
  treatment_external_ids AS (
    SELECT external_id
    FROM treatments
    WHERE organization_id = p_organization_id
      AND deleted_at IS NULL
      AND is_active = true
      AND external_id IS NOT NULL
  ),
  qualified_tpis AS (
    SELECT DISTINCT ON (COALESCE(
      tpi.tpi_id::text,
      tpi.tpi_patient_id || '|' || LEFT(tpi.tpi_completed_at::text, 10) || '|' || tpi.tpi_treatment_id || '|' || tpi.tpi_price || '|' || COALESCE(tpi.tpi_invoice_id::text, '')
    ))
      tpi.id,
      tpi.tpi_price,
      tpi.tpi_invoice_id,
      tpi.tpi_treatment_id
    FROM treatment_plan_items tpi
    WHERE tpi.organization_id = p_organization_id
      AND tpi.tpi_completed = true
      AND tpi.tpi_completed_at IS NOT NULL
      AND tpi.deleted_at IS NULL
      AND tpi.tpi_completed_at >= p_start_date
      AND tpi.tpi_completed_at <= p_end_date
      AND tpi.tpi_treatment_id IN (SELECT external_id FROM treatment_external_ids)
      AND tpi.tpi_payment_plan_id IN (SELECT pp_id FROM private_plan_ids)
  )
  SELECT
    ROUND(SUM(CAST(q.tpi_price AS NUMERIC)), 2) AS total_revenue,
    COUNT(*) AS total_items
  FROM qualified_tpis q
  INNER JOIN paid_invoices_at_location pi
    ON CAST(q.tpi_invoice_id AS BIGINT) = pi.inv_id
  WHERE q.tpi_invoice_id IS NOT NULL;
$$;
