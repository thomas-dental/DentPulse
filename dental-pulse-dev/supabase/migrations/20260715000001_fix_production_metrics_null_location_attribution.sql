-- Fix chart_get_production_metrics: per-location Production dropped every TPI whose
-- location_id is NULL, so the per-location figures never summed to the org total.
--
-- Dentally's API does not return site_id for treatment plan items, so tpi.location_id
-- is NULL for a large share of rows (the backend resolves it post-sync, and that
-- resolution is incomplete). The previous filter was:
--
--   AND (p_location_id IS NULL
--        OR tpi.location_id = p_location_id
--        OR (tpi.location_id IS NULL AND v_location_count = 1))
--
-- The NULL escape hatch only fired for SINGLE-location orgs (v_location_count = 1).
-- For a multi-location org every NULL-location TPI was silently discarded whenever a
-- location filter was applied — so Location A + Location B < All Locations, with the
-- gap growing with the share of unresolved TPIs.
--
-- Fix: attribute a NULL-location TPI to its PRACTITIONER'S primary location. This is
-- safe here because base_providers is ALREADY scoped by `p.location_id = p_location_id`
-- when p_location_id is supplied — so a NULL-location TPI reached via that provider
-- belongs to the location being asked about. This mirrors the reconciled
-- "practitioner primary location" attribution used elsewhere for Dentally matching.
--
-- Also applies the same two production corrections as
-- 20260715000002_fix_provider_net_production_charting_and_timezone (which fixes the
-- sibling RPC get_provider_net_production_monthly), so this RPC's production_amount
-- agrees with the Treatment Insights Profit section (whose production routes through
-- that sibling RPC):
--   • Exclude charting / tooth-status rows via tpi_treatment_appointment_id IS NOT NULL.
--   • Resolve the completed date in Europe/London, not UTC.
-- Still unchanged on purpose: rank is by avg_daily_production (tracked separately).

DROP FUNCTION IF EXISTS chart_get_production_metrics(DATE, DATE, UUID, TEXT, UUID);

CREATE OR REPLACE FUNCTION chart_get_production_metrics(
  p_start_date      DATE,
  p_end_date        DATE,
  p_organization_id UUID,
  p_provider_type   TEXT DEFAULT NULL,
  p_location_id     UUID DEFAULT NULL
)
RETURNS TABLE (
  provider_id          UUID,
  provider_name        TEXT,
  production_amount    NUMERIC,
  days_worked          NUMERIC,
  avg_daily_production NUMERIC,
  rank                 INTEGER
) AS $$
BEGIN
  RETURN QUERY
  WITH
  base_providers AS (
    SELECT
      LOWER(COALESCE(NULLIF(TRIM(p.email), ''), p.name)) AS group_key,
      MIN(p.id::TEXT)::UUID AS provider_id,
      MIN(p.name)           AS provider_name,
      COALESCE(
        ARRAY_AGG(DISTINCT p.external_id::TEXT) FILTER (WHERE p.external_id IS NOT NULL),
        ARRAY[]::TEXT[]
      ) AS external_ids
    FROM providers p
    WHERE
      p.is_active = true
      AND p.deleted_at IS NULL
      AND p.organization_id = p_organization_id
      AND (
        p_provider_type IS NULL
        -- "Other" = NOT a dentist, hygienist, or therapist
        OR (
          p_provider_type = 'Other'
          AND LOWER(COALESCE(p.provider_role, '')) NOT IN (
            'dentist', 'dental surgeon', 'principal dentist',
            'hygienist', 'dental hygienist', 'hygiene',
            'therapist', 'dental therapist', 'therapy'
          )
          AND LOWER(COALESCE(p.provider_role, '')) NOT LIKE '%dentist%'
          AND LOWER(COALESCE(p.provider_role, '')) NOT LIKE '%hygienist%'
          AND LOWER(COALESCE(p.provider_role, '')) NOT LIKE '%hygiene%'
          AND LOWER(COALESCE(p.provider_role, '')) NOT LIKE '%therapist%'
          AND LOWER(COALESCE(p.provider_role, '')) NOT LIKE '%therapy%'
        )
        -- Dentist / Hygienist / Therapist = normal ILIKE match
        OR (
          p_provider_type <> 'Other'
          AND p.provider_role ILIKE '%' || p_provider_type || '%'
        )
      )
      AND (p_location_id IS NULL OR p.location_id = p_location_id)
    GROUP BY LOWER(COALESCE(NULLIF(TRIM(p.email), ''), p.name))
  ),
  provider_production AS (
    SELECT
      bp.provider_id,
      COALESCE(SUM(tpi.tpi_price), 0) AS total_production
    FROM base_providers bp
    CROSS JOIN UNNEST(bp.external_ids) AS u(ext_id)
    LEFT JOIN treatment_plan_items tpi
      ON u.ext_id::BIGINT = tpi.tpi_practitioner_id
      AND tpi.tpi_completed = true
      AND tpi.tpi_completed_at IS NOT NULL
      -- Resolve the completed date in Europe/London, not UTC. Dentally date-only
      -- completions store as London midnight (e.g. 2026-05-31T23:00:00Z = 1 Jun 00:00
      -- BST); a UTC ::DATE cast filed them under the previous month. Mirrors
      -- get_provider_net_production_monthly so this RPC's production matches the
      -- Profit section's production (which routes through that RPC).
      AND (tpi.tpi_completed_at AT TIME ZONE 'Europe/London')::DATE BETWEEN p_start_date AND p_end_date
      AND tpi.tpi_price IS NOT NULL
      AND tpi.tpi_price <> 0
      -- Exclude charting / tooth-status rows (Missing, Caries, Unerupted, ...): not
      -- clinical procedures, carry spurious prices, and Dentally's activity report
      -- excludes them. Identified by having no treatment_appointment_id.
      AND tpi.tpi_treatment_appointment_id IS NOT NULL
      AND tpi.deleted_at IS NULL
      AND tpi.organization_id = p_organization_id
      AND (
        p_location_id IS NULL
        OR tpi.location_id = p_location_id
        -- Unresolved TPI location → attribute to the practitioner's primary location.
        -- base_providers is already restricted to p_location_id above, so reaching this
        -- row means the practitioner belongs to the requested location.
        OR tpi.location_id IS NULL
      )
    GROUP BY bp.provider_id
  ),
  provider_hours AS (
    SELECT
      bp.provider_id,
      COALESCE((SUM(a.apmt_duration)::NUMERIC / 60.0) / 8.0, 0) AS working_days
    FROM base_providers bp
    CROSS JOIN UNNEST(bp.external_ids) AS u(ext_id)
    LEFT JOIN appointments a
      ON u.ext_id::BIGINT = a.apmt_practitioner_id
      AND a.apmt_state IN ('Completed', 'Pending', 'In surgery', 'Confirmed')
      AND a.apmt_start_time IS NOT NULL
      AND a.apmt_start_time::DATE BETWEEN p_start_date AND p_end_date
      AND a.apmt_duration IS NOT NULL
      AND a.apmt_patient_id IS NOT NULL
      AND a.deleted_at IS NULL
      AND a.organization_id = p_organization_id
      AND (
        p_location_id IS NULL
        OR a.location_id = p_location_id
        -- Same practitioner-primary-location fallback as the production CTE above.
        OR a.location_id IS NULL
      )
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
      pd.prod_amount    AS production_amount,
      pd.days_count     AS days_worked,
      CASE
        WHEN pd.days_count > 0 THEN ROUND(pd.prod_amount / pd.days_count, 2)
        ELSE 0
      END AS avg_daily_production,
      ROW_NUMBER() OVER (
        ORDER BY CASE WHEN pd.days_count > 0 THEN pd.prod_amount / pd.days_count ELSE 0 END DESC
      )::INTEGER AS rank
    FROM production_data pd
  )
  SELECT rd.provider_id, rd.provider_name, rd.production_amount, rd.days_worked, rd.avg_daily_production, rd.rank
  FROM ranked_data rd
  WHERE rd.production_amount > 0 OR rd.days_worked > 0
  ORDER BY rd.rank;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION chart_get_production_metrics(DATE, DATE, UUID, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION chart_get_production_metrics(DATE, DATE, UUID, TEXT, UUID) TO anon;
