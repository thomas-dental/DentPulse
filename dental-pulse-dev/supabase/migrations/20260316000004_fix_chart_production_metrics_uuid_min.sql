-- Fix: MIN(uuid) is not supported in PostgreSQL — cast to text first, then back to UUID.
-- This corrects the 20260316000001 migration.

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
  -- Deduplicate providers by email (fallback to name).
  -- Cast UUID to text for MIN() since PostgreSQL has no native MIN(uuid).
  base_providers AS (
    SELECT
      LOWER(COALESCE(NULLIF(TRIM(p.email), ''), p.name)) AS group_key,
      MIN(p.id::TEXT)::UUID AS provider_id,
      MIN(p.name)           AS provider_name,
      COALESCE(
        ARRAY_AGG(DISTINCT p.external_id) FILTER (WHERE p.external_id IS NOT NULL),
        ARRAY[]::TEXT[]
      ) AS external_ids
    FROM providers p
    WHERE
      p.is_active = true
      AND p.deleted_at IS NULL
      AND p.organization_id = p_organization_id
      AND (p_provider_type IS NULL OR p.provider_role ILIKE '%' || p_provider_type || '%')
    GROUP BY LOWER(COALESCE(NULLIF(TRIM(p.email), ''), p.name))
  ),
  -- Calculate production across all external_ids for the group
  provider_production AS (
    SELECT
      bp.provider_id,
      COALESCE(SUM(tpi.tpi_price), 0) AS total_production
    FROM base_providers bp
    CROSS JOIN UNNEST(bp.external_ids) AS u(ext_id)
    LEFT JOIN treatment_plan_items tpi ON u.ext_id = tpi.tpi_practitioner_id
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
  -- Calculate working hours across all external_ids for the group
  provider_hours AS (
    SELECT
      bp.provider_id,
      COALESCE((SUM(a.apmt_duration)::NUMERIC / 60.0) / 8.0, 0) AS working_days
    FROM base_providers bp
    CROSS JOIN UNNEST(bp.external_ids) AS u(ext_id)
    LEFT JOIN appointments a ON u.ext_id = a.apmt_practitioner_id
      AND a.apmt_state = 'Completed'
      AND a.apmt_start_time IS NOT NULL
      AND a.apmt_start_time BETWEEN p_start_date AND p_end_date
      AND a.apmt_duration IS NOT NULL
      AND a.apmt_patient_name IS NOT NULL
      AND a.deleted_at IS NULL
      AND a.organization_id = p_organization_id
    GROUP BY bp.provider_id
  ),
  production_data AS (
    SELECT
      bp.provider_id,
      bp.provider_name,
      COALESCE(pp.total_production, 0) AS prod_amount,
      COALESCE(ph.working_days, 0)     AS days_count
    FROM base_providers bp
    LEFT JOIN provider_production pp ON bp.provider_id = pp.provider_id
    LEFT JOIN provider_hours      ph ON bp.provider_id = ph.provider_id
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
  WHERE rd.production_amount > 0 OR rd.days_worked > 0
  ORDER BY rd.rank;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION chart_get_production_metrics(DATE, DATE, UUID, TEXT) TO authenticated;
