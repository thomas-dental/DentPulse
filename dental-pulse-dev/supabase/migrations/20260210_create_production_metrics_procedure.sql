-- Optimized function to calculate production metrics per provider
-- Matches Profit Goals Settings calculation exactly
-- Production: Only treatments with payment plans in org's income config
-- Working Hours: Only completed appointments with patient name
-- Working Days = Total Appointment Hours ÷ 8
CREATE OR REPLACE FUNCTION chart_get_production_metrics(
  p_start_date DATE,
  p_end_date DATE,
  p_organization_id UUID,
  p_provider_type TEXT DEFAULT NULL
)
RETURNS TABLE (
  provider_id UUID,
  provider_name TEXT,
  production_amount NUMERIC,
  days_worked NUMERIC,
  avg_daily_production NUMERIC,
  rank INTEGER
) AS $$
BEGIN
  RETURN QUERY
  WITH
  -- Extract payment plan IDs from organization income configuration
  payment_plan_ids AS (
    SELECT DISTINCT value::TEXT AS plan_id
    FROM organizations o,
         LATERAL (
           SELECT value FROM jsonb_array_elements_text(COALESCE((o.private_income::JSONB)->'selected_account', '[]'::JSONB))
           UNION ALL
           SELECT value FROM jsonb_array_elements_text(COALESCE((o.membership_income::JSONB)->'selected_account', '[]'::JSONB))
           UNION ALL
           SELECT value FROM jsonb_array_elements_text(COALESCE((o.nhs_income::JSONB)->'selected_account', '[]'::JSONB))
         ) AS value
    WHERE o.id = p_organization_id
  ),
  -- Step 1: Get base provider list (filtered once)
  base_providers AS (
    SELECT
      id AS provider_id,
      name AS provider_name,
      external_id
    FROM providers
    WHERE
      is_active = true
      AND deleted_at IS NULL
      AND organization_id = p_organization_id
      AND (p_provider_type IS NULL OR provider_role ILIKE '%' || p_provider_type || '%')
  ),
  -- Step 2: Calculate production for these providers
  -- Only count completed treatments with payment plans matching org income config
  provider_production AS (
    SELECT
      bp.provider_id,
      COALESCE(SUM(tpi.tpi_price), 0) AS total_production
    FROM base_providers bp
    LEFT JOIN treatment_plan_items tpi ON bp.external_id = tpi.tpi_practitioner_id
      AND tpi.tpi_completed = true
      AND tpi.tpi_completed_at IS NOT NULL
      AND tpi.tpi_completed_at BETWEEN p_start_date AND p_end_date
      AND tpi.tpi_price IS NOT NULL
      AND tpi.tpi_price <> 0
      AND tpi.deleted_at IS NULL
      AND tpi.organization_id = p_organization_id
      AND tpi.tpi_payment_plan_id::TEXT IN (SELECT plan_id FROM payment_plan_ids)
    GROUP BY bp.provider_id
  ),
  -- Step 3: Calculate working hours for these providers
  -- Only count completed appointments with start_time in date range
  provider_hours AS (
    SELECT
      bp.provider_id,
      COALESCE((SUM(a.apmt_duration)::NUMERIC / 60.0) / 8.0, 0) AS working_days
    FROM base_providers bp
    LEFT JOIN appointments a ON bp.external_id = a.apmt_practitioner_id
      AND a.apmt_state = 'Completed'
      AND a.apmt_start_time IS NOT NULL
      AND a.apmt_start_time BETWEEN p_start_date AND p_end_date
      AND a.apmt_duration IS NOT NULL
      AND a.apmt_patient_name IS NOT NULL
      AND a.deleted_at IS NULL
      AND a.organization_id = p_organization_id
    GROUP BY bp.provider_id
  ),
  -- Step 4: Combine everything
  production_data AS (
    SELECT
      bp.provider_id,
      bp.provider_name,
      COALESCE(pp.total_production, 0) AS prod_amount,
      COALESCE(ph.working_days, 0) AS days_count
    FROM base_providers bp
    LEFT JOIN provider_production pp ON bp.provider_id = pp.provider_id
    LEFT JOIN provider_hours ph ON bp.provider_id = ph.provider_id
  ),
  ranked_data AS (
    SELECT
      pd.provider_id,
      pd.provider_name,
      pd.prod_amount AS production_amount,
      ROUND(pd.days_count, 2) AS days_worked,
      CASE
        WHEN pd.days_count > 0 THEN ROUND(pd.prod_amount / pd.days_count, 2)
        ELSE 0
      END AS avg_daily_production,
      ROW_NUMBER() OVER (
        ORDER BY
          CASE
            WHEN pd.days_count > 0 THEN pd.prod_amount / pd.days_count
            ELSE 0
          END DESC
      )::INTEGER AS rank
    FROM production_data pd
  )
  SELECT
    rd.provider_id,
    rd.provider_name,
    rd.production_amount,
    rd.days_worked,
    rd.avg_daily_production,
    rd.rank
  FROM ranked_data rd
  WHERE rd.production_amount > 0 OR rd.days_worked > 0  -- Only include providers with data
  ORDER BY rd.rank;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION chart_get_production_metrics(DATE, DATE, UUID, TEXT) TO authenticated;

-- Add comment
COMMENT ON FUNCTION chart_get_production_metrics(DATE, DATE, UUID, TEXT) IS
'Optimized production metrics calculation matching Profit Goals Settings exactly.
Production: Sum of completed treatment prices with payment plans in org income config.
Working Days: (Sum of completed appointment durations in minutes / 60) / 8.
Avg Daily Production: Total Production / Working Days.
Returns provider_id (UUID), name, production, days worked, avg daily production, and rank.
Filter results by provider_id for specific provider queries.';
