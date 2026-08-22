-- Fix get_provider_net_production_monthly:
-- 1. Remove restrictive payment-plan WHERE clause so orgs without income config
--    still get production totals (was returning 0 rows when all income arrays = NULL)
-- 2. Add optional p_location_id parameter so location-specific views only count
--    production done at that location (treatment_plan_items.location_id)
--
-- When p_location_id IS NULL  → returns all locations (existing behaviour)
-- When p_location_id IS NOT NULL → filters tpi.location_id = p_location_id

-- Drop old signature first (4-param version) so we can replace with 5-param version
DROP FUNCTION IF EXISTS get_provider_net_production_monthly(UUID, DATE, DATE, INTEGER);

CREATE OR REPLACE FUNCTION get_provider_net_production_monthly(
  p_organization_id  UUID,
  p_from_date        DATE,
  p_to_date          DATE,
  p_practitioner_id  INTEGER,
  p_location_id      UUID DEFAULT NULL
)
RETURNS TABLE (
  month              TEXT,
  total_amount       NUMERIC,
  private_amount     NUMERIC,
  membership_amount  NUMERIC,
  nhs_amount         NUMERIC
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_private_accounts    TEXT[];
  v_membership_accounts TEXT[];
  v_nhs_accounts        TEXT[];
  v_org_record          RECORD;
BEGIN
  SET LOCAL statement_timeout = '60s';

  -- Fetch organization income configuration
  SELECT private_income, membership_income, nhs_income
  INTO v_org_record
  FROM organizations
  WHERE id = p_organization_id;

  -- Extract payment plan IDs from JSON configurations (for breakdown columns only)
  IF v_org_record.private_income IS NOT NULL AND v_org_record.private_income != '' THEN
    SELECT array_agg(value::TEXT)
    INTO v_private_accounts
    FROM jsonb_array_elements_text((v_org_record.private_income::JSONB)->'selected_account');
  END IF;

  IF v_org_record.membership_income IS NOT NULL AND v_org_record.membership_income != '' THEN
    SELECT array_agg(value::TEXT)
    INTO v_membership_accounts
    FROM jsonb_array_elements_text((v_org_record.membership_income::JSONB)->'selected_account');
  END IF;

  IF v_org_record.nhs_income IS NOT NULL AND v_org_record.nhs_income != '' THEN
    SELECT array_agg(value::TEXT)
    INTO v_nhs_accounts
    FROM jsonb_array_elements_text((v_org_record.nhs_income::JSONB)->'selected_account');
  END IF;

  -- Return aggregated monthly data.
  -- Total includes ALL completed non-zero TPIs (not filtered by payment plan).
  -- Breakdown columns classify by configured income types using CASE statements.
  -- When p_location_id is provided, only counts TPIs performed at that location.
  RETURN QUERY
  SELECT
    TO_CHAR(tpi.tpi_completed_at, 'Mon-YY') AS month,
    SUM(tpi.tpi_price) AS total_amount,
    SUM(CASE WHEN v_private_accounts IS NOT NULL AND tpi.tpi_payment_plan_id::TEXT = ANY(v_private_accounts)    THEN tpi.tpi_price ELSE 0 END) AS private_amount,
    SUM(CASE WHEN v_membership_accounts IS NOT NULL AND tpi.tpi_payment_plan_id::TEXT = ANY(v_membership_accounts) THEN tpi.tpi_price ELSE 0 END) AS membership_amount,
    SUM(CASE WHEN v_nhs_accounts IS NOT NULL AND tpi.tpi_payment_plan_id::TEXT = ANY(v_nhs_accounts)           THEN tpi.tpi_price ELSE 0 END) AS nhs_amount
  FROM treatment_plan_items tpi
  WHERE tpi.organization_id      = p_organization_id
    AND tpi.tpi_practitioner_id  = p_practitioner_id
    AND tpi.tpi_completed_at     IS NOT NULL
    AND tpi.tpi_completed        = true
    AND tpi.tpi_completed_at::DATE BETWEEN p_from_date AND p_to_date
    AND tpi.tpi_price            IS NOT NULL
    AND tpi.tpi_price            <> 0
    AND tpi.deleted_at           IS NULL
    AND (p_location_id IS NULL OR tpi.location_id = p_location_id)
  GROUP BY TO_CHAR(tpi.tpi_completed_at, 'Mon-YY'), DATE_TRUNC('month', tpi.tpi_completed_at)
  ORDER BY DATE_TRUNC('month', tpi.tpi_completed_at);
END;
$$;

GRANT EXECUTE ON FUNCTION get_provider_net_production_monthly(UUID, DATE, DATE, INTEGER, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_provider_net_production_monthly(UUID, DATE, DATE, INTEGER, UUID) TO anon;
