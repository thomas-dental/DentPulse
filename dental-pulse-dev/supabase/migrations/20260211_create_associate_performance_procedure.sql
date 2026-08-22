-- Function to calculate associate profit performance metrics (Actual vs Target)
-- Matches Profit Goals Settings page logic for daily production calculations
-- Planning targets are retrieved from planned_daily_production table
CREATE OR REPLACE FUNCTION chart_get_associate_performance_metrics(
  p_start_date DATE,
  p_end_date DATE,
  p_organization_id UUID,
  p_provider_type TEXT DEFAULT NULL
)
RETURNS TABLE (
  provider_id UUID,
  provider_name TEXT,
  daily_production NUMERIC,
  planning_avg_daily_production NUMERIC,
  target_gap NUMERIC,
  performance_percent NUMERIC,
  rank INTEGER
) AS $$
BEGIN
  RETURN QUERY
  WITH
  -- Get base provider list with their latest planning targets (optimized with DISTINCT ON)
  base_providers_with_planning AS (
    SELECT DISTINCT ON (p.id)
      p.id,
      p.name,
      p.external_id,
      COALESCE(pdp.average_daily_production, 0) AS planning_target
    FROM providers p
    LEFT JOIN planned_daily_production pdp ON
      pdp.provider_id = p.id
      AND pdp.organization_id = p_organization_id
    WHERE
      p.is_active = true
      AND p.deleted_at IS NULL
      AND p.organization_id = p_organization_id
      AND (p_provider_type IS NULL OR p.provider_role ILIKE '%' || p_provider_type || '%')
    ORDER BY p.id, pdp.created_at DESC
  ),
  -- Get production and hours data together (optimized - single CTE)
  provider_metrics_data AS (
    SELECT
      bp.id AS provider_id,
      bp.name AS provider_name,
      bp.planning_target,
      prod.total_amount,
      hours.total_hours
    FROM base_providers_with_planning bp
    CROSS JOIN LATERAL (
      SELECT COALESCE(SUM(total_amount), 0) AS total_amount
      FROM get_provider_net_production_monthly(
        p_organization_id,
        p_start_date,
        p_end_date,
        bp.external_id::INTEGER
      )
    ) AS prod
    CROSS JOIN LATERAL (
      SELECT COALESCE(SUM(total_hours), 0) AS total_hours
      FROM get_provider_working_hours_monthly(
        p_organization_id,
        p_start_date,
        p_end_date,
        bp.external_id::INTEGER
      )
    ) AS hours
    WHERE prod.total_amount > 0 OR hours.total_hours > 0
  )
  -- Calculate final metrics and ranking (optimized - combined calculation)
  SELECT
    pmd.provider_id,
    pmd.provider_name,
    ROUND(
      CASE
        WHEN pmd.total_hours > 0 THEN pmd.total_amount / (pmd.total_hours / 8.0)
        ELSE 0
      END,
      2
    ) AS daily_production,
    pmd.planning_target AS planning_avg_daily_production,
    ROUND(
      CASE
        WHEN pmd.total_hours > 0 THEN pmd.total_amount / (pmd.total_hours / 8.0)
        ELSE 0
      END - pmd.planning_target,
      2
    ) AS target_gap,
    CASE
      WHEN pmd.planning_target > 0 AND pmd.total_hours > 0 THEN
        ROUND((pmd.total_amount / (pmd.total_hours / 8.0) / pmd.planning_target) * 100, 0)
      ELSE NULL
    END AS performance_percent,
    ROW_NUMBER() OVER (
      ORDER BY
        CASE
          WHEN pmd.planning_target > 0 AND pmd.total_hours > 0 THEN
            (pmd.total_amount / (pmd.total_hours / 8.0) / pmd.planning_target) * 100
          ELSE 0
        END DESC
    )::INTEGER AS rank
  FROM provider_metrics_data pmd
  ORDER BY rank;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION chart_get_associate_performance_metrics(DATE, DATE, UUID, TEXT) TO authenticated;

-- Add comment
COMMENT ON FUNCTION chart_get_associate_performance_metrics(DATE, DATE, UUID, TEXT) IS
'Calculates associate profit performance metrics (Actual vs Target).
Daily Production (Actual) = Total Production / Working Days
Planning Average Daily Production (Target) = From planned_daily_production table (latest record by created_at)
Target Gap = Actual - Target (negative means below target)
Performance % = (Actual / Target) × 100 (NULL if no planning target)
Ranking: By Performance % (highest to lowest = best to worst performance)
Returns provider_id, name, daily production, planning target, target gap, performance %, and rank.
If no planning record exists for a provider, planning target defaults to 0 and performance % is NULL.';
