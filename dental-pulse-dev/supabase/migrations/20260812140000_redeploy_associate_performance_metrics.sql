-- ============================================================================
-- Redeploy chart_get_associate_performance_metrics.
--
-- Confirmed live 2026-08-12: this RPC still errors with
-- `column "open_hours_per_day" does not exist` — the same organizations→
-- practice_locations drift as chart_get_production_metrics/chart_get_profit_metrics
-- (see 20260812120000 / 20260812130000). But this function's LATEST committed
-- definition (20260715000004_associate_performance_working_days_attended.sql,
-- 2026-07-15) doesn't reference `organizations` at all — working days there
-- were redefined to count distinct completed-appointment calendar days
-- instead of appointment-hours ÷ open_hours_per_day, which incidentally
-- dropped the only organizations reference. So the live database is simply
-- running an older, already-superseded version of this function; the fix
-- here is just to (re)deploy the current definition verbatim, not to author
-- a new one.
-- ============================================================================

CREATE OR REPLACE FUNCTION chart_get_associate_performance_metrics(
  p_start_date      DATE,
  p_end_date        DATE,
  p_organization_id UUID,
  p_provider_type   TEXT DEFAULT NULL,
  p_location_id     UUID DEFAULT NULL
)
RETURNS TABLE (
  provider_id                   UUID,
  provider_name                 TEXT,
  daily_production              NUMERIC,
  planning_avg_daily_production NUMERIC,
  target_gap                    NUMERIC,
  performance_percent           NUMERIC,
  rank                          INTEGER
) AS $$
BEGIN
  RETURN QUERY
  WITH
  base_providers_with_planning AS (
    SELECT
      grp.id,
      grp.name,
      grp.external_ids,
      COALESCE(latest_pdp.average_daily_production, 0) AS planning_target
    FROM (
      SELECT
        LOWER(COALESCE(NULLIF(TRIM(p.email), ''), p.name)) AS group_key,
        MIN(p.id::TEXT)::UUID AS id,
        MIN(p.name)           AS name,
        COALESCE(
          ARRAY_AGG(DISTINCT p.external_id::TEXT) FILTER (WHERE p.external_id IS NOT NULL),
          ARRAY[]::TEXT[]
        ) AS external_ids
      FROM providers p
      WHERE
        p.is_active            = true
        AND p.deleted_at       IS NULL
        AND p.organization_id  = p_organization_id
        AND (p_provider_type IS NULL OR p.provider_role ILIKE '%' || p_provider_type || '%')
        AND (p_location_id IS NULL OR p.location_id = p_location_id)
      GROUP BY group_key
    ) grp
    LEFT JOIN LATERAL (
      SELECT average_daily_production
      FROM planned_daily_production pdp
      WHERE pdp.provider_id     = grp.id
        AND pdp.organization_id = p_organization_id
      ORDER BY pdp.created_at DESC
      LIMIT 1
    ) latest_pdp ON true
  ),
  provider_metrics_raw AS (
    SELECT
      bp.id              AS provider_id,
      bp.name            AS provider_name,
      bp.planning_target,
      -- Use private_amount + membership_amount + nhs_amount to match
      -- useAllProvidersNetProduction (Production Data tab).
      COALESCE(SUM(prod.private_amount + prod.membership_amount + prod.nhs_amount), 0) AS total_amount,
      COALESCE(SUM(days.days_attended), 0) AS working_days
    FROM base_providers_with_planning bp
    CROSS JOIN UNNEST(bp.external_ids) AS u(ext_id)
    CROSS JOIN LATERAL (
      SELECT
        COALESCE(SUM(private_amount),    0) AS private_amount,
        COALESCE(SUM(membership_amount), 0) AS membership_amount,
        COALESCE(SUM(nhs_amount),        0) AS nhs_amount
      FROM get_provider_net_production_monthly(
        p_organization_id, p_start_date, p_end_date, u.ext_id::INTEGER, p_location_id
      )
    ) AS prod
    CROSS JOIN LATERAL (
      -- Working days = distinct CALENDAR days the practitioner had a COMPLETED
      -- appointment (with a patient), resolved in Europe/London. A day counts once
      -- regardless of hours worked.
      SELECT COUNT(DISTINCT (a.apmt_start_time AT TIME ZONE 'Europe/London')::DATE) AS days_attended
      FROM appointments a
      WHERE a.apmt_practitioner_id = u.ext_id::BIGINT
        AND a.organization_id      = p_organization_id
        AND LOWER(a.apmt_state)    = 'completed'
        AND (a.apmt_start_time AT TIME ZONE 'Europe/London')::DATE BETWEEN p_start_date AND p_end_date
        AND a.apmt_patient_id      IS NOT NULL
        AND a.deleted_at           IS NULL
        AND (p_location_id IS NULL OR a.location_id = p_location_id)
    ) AS days
    GROUP BY bp.id, bp.name, bp.planning_target
  ),
  provider_metrics_data AS (
    SELECT * FROM provider_metrics_raw
    WHERE total_amount > 0 OR working_days > 0
  )
  SELECT
    pmd.provider_id,
    pmd.provider_name,
    ROUND(
      CASE WHEN pmd.working_days > 0
        THEN pmd.total_amount / pmd.working_days
        ELSE 0
      END, 2
    ) AS daily_production,
    pmd.planning_target AS planning_avg_daily_production,
    ROUND(
      CASE WHEN pmd.working_days > 0
        THEN pmd.total_amount / pmd.working_days
        ELSE 0
      END - pmd.planning_target, 2
    ) AS target_gap,
    CASE
      WHEN pmd.planning_target > 0 AND pmd.working_days > 0 THEN
        ROUND((pmd.total_amount / pmd.working_days / pmd.planning_target) * 100, 0)
      ELSE NULL
    END AS performance_percent,
    ROW_NUMBER() OVER (
      ORDER BY
        CASE WHEN pmd.planning_target > 0 AND pmd.working_days > 0 THEN
          (pmd.total_amount / pmd.working_days / pmd.planning_target) * 100
        ELSE 0 END DESC
    )::INTEGER AS rank
  FROM provider_metrics_data pmd
  ORDER BY rank;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION chart_get_associate_performance_metrics(DATE, DATE, UUID, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION chart_get_associate_performance_metrics(DATE, DATE, UUID, TEXT, UUID) TO anon;
