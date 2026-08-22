-- Fix: MIN(uuid) is not supported in PostgreSQL — cast to text first, then back to UUID.
-- This corrects the 20260316000003 migration.

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
  -- Deduplicate providers by email (fallback to name).
  -- Cast UUID to text for MIN() since PostgreSQL has no native MIN(uuid).
  -- Sum planning targets: if only one location has a target set the others are 0,
  -- so SUM equals that single target value.
  base_providers_with_planning AS (
    SELECT
      LOWER(COALESCE(NULLIF(TRIM(p.email), ''), p.name)) AS group_key,
      MIN(p.id::TEXT)::UUID AS id,
      MIN(p.name)           AS name,
      COALESCE(
        ARRAY_AGG(DISTINCT p.external_id) FILTER (WHERE p.external_id IS NOT NULL),
        ARRAY[]::TEXT[]
      ) AS external_ids,
      COALESCE(SUM(latest_pdp.avg_daily_prod), 0) AS planning_target
    FROM providers p
    LEFT JOIN LATERAL (
      SELECT average_daily_production AS avg_daily_prod
      FROM planned_daily_production pdp
      WHERE pdp.provider_id = p.id
        AND pdp.organization_id = p_organization_id
      ORDER BY pdp.created_at DESC
      LIMIT 1
    ) AS latest_pdp ON true
    WHERE
      p.is_active = true
      AND p.deleted_at IS NULL
      AND p.organization_id = p_organization_id
      AND (p_provider_type IS NULL OR p.provider_role ILIKE '%' || p_provider_type || '%')
    GROUP BY group_key
  ),
  -- Call functions for each external_id and sum production + hours
  provider_metrics_raw AS (
    SELECT
      bp.id   AS provider_id,
      bp.name AS provider_name,
      bp.planning_target,
      COALESCE(SUM(prod.total_amount), 0) AS total_amount,
      COALESCE(SUM(hours.total_hours), 0) AS total_hours
    FROM base_providers_with_planning bp
    CROSS JOIN UNNEST(bp.external_ids) AS u(ext_id)
    CROSS JOIN LATERAL (
      SELECT COALESCE(SUM(total_amount), 0) AS total_amount
      FROM get_provider_net_production_monthly(
        p_organization_id,
        p_start_date,
        p_end_date,
        u.ext_id::INTEGER
      )
    ) AS prod
    CROSS JOIN LATERAL (
      SELECT COALESCE(SUM(total_hours), 0) AS total_hours
      FROM get_provider_working_hours_monthly(
        p_organization_id,
        p_start_date,
        p_end_date,
        u.ext_id::INTEGER
      )
    ) AS hours
    GROUP BY bp.id, bp.name, bp.planning_target
  ),
  provider_metrics_data AS (
    SELECT * FROM provider_metrics_raw
    WHERE total_amount > 0 OR total_hours > 0
  )
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

GRANT EXECUTE ON FUNCTION chart_get_associate_performance_metrics(DATE, DATE, UUID, TEXT) TO authenticated;

COMMENT ON FUNCTION chart_get_associate_performance_metrics(DATE, DATE, UUID, TEXT) IS
'Associate performance metrics deduplicated by provider email (fallback: name).
Production, hours and planning targets are summed across all location rows for the same person.';
