-- Fix get_provider_net_production_monthly: remove restrictive payment plan WHERE clause
-- Previously, TPIs were ONLY included if their payment_plan_id matched a configured
-- income type (private/membership/nhs). This excluded TPIs with unmapped payment plans,
-- causing net production totals to be lower than Dentally's actual figures.
--
-- Changes:
-- 1. Removed payment plan WHERE clause - total now includes ALL completed non-zero TPIs
-- 2. Added deleted_at IS NULL filter (was missing)
-- 3. Added NULL safety to CASE statements for income type classification

CREATE OR REPLACE FUNCTION get_provider_net_production_monthly(
  p_organization_id UUID,
  p_from_date DATE,
  p_to_date DATE,
  p_practitioner_id INTEGER
)
RETURNS TABLE (
  month TEXT,  -- 'Jan-25', 'Feb-25', etc.
  total_amount NUMERIC,
  private_amount NUMERIC,
  membership_amount NUMERIC,
  nhs_amount NUMERIC
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_private_accounts TEXT[];
  v_membership_accounts TEXT[];
  v_nhs_accounts TEXT[];
  v_org_record RECORD;
BEGIN
  SET LOCAL statement_timeout = '60s';

  -- Fetch organization income configuration
  SELECT
    private_income,
    membership_income,
    nhs_income
  INTO v_org_record
  FROM organizations
  WHERE id = p_organization_id;

  -- Extract payment plan IDs from JSON configurations
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

  -- Return aggregated monthly data
  -- Total includes ALL completed non-zero TPIs (not filtered by payment plan)
  -- Breakdown columns classify by configured income types using CASE statements
  RETURN QUERY
  SELECT
    TO_CHAR(tpi.tpi_completed_at, 'Mon-YY') AS month,
    SUM(tpi.tpi_price) AS total_amount,
    SUM(CASE WHEN v_private_accounts IS NOT NULL AND tpi.tpi_payment_plan_id::TEXT = ANY(v_private_accounts) THEN tpi.tpi_price ELSE 0 END) AS private_amount,
    SUM(CASE WHEN v_membership_accounts IS NOT NULL AND tpi.tpi_payment_plan_id::TEXT = ANY(v_membership_accounts) THEN tpi.tpi_price ELSE 0 END) AS membership_amount,
    SUM(CASE WHEN v_nhs_accounts IS NOT NULL AND tpi.tpi_payment_plan_id::TEXT = ANY(v_nhs_accounts) THEN tpi.tpi_price ELSE 0 END) AS nhs_amount
  FROM treatment_plan_items tpi
  WHERE tpi.organization_id = p_organization_id
    AND tpi.tpi_practitioner_id = p_practitioner_id
    AND tpi.tpi_completed_at IS NOT NULL
    AND tpi.tpi_completed = true
    AND tpi.tpi_completed_at::DATE BETWEEN p_from_date AND p_to_date
    AND tpi.tpi_price IS NOT NULL
    AND tpi.tpi_price <> 0
    AND tpi.deleted_at IS NULL
  GROUP BY TO_CHAR(tpi.tpi_completed_at, 'Mon-YY'), DATE_TRUNC('month', tpi.tpi_completed_at)
  ORDER BY DATE_TRUNC('month', tpi.tpi_completed_at);
END;
$$;

COMMENT ON FUNCTION get_provider_net_production_monthly IS
'Optimized function that returns pre-aggregated monthly totals for net production.
Avoids the 1000-row limit by doing aggregation in the database.
Returns one row per month with totals by income type.
Total includes ALL completed non-zero TPIs; breakdown columns classify by configured income types.';
