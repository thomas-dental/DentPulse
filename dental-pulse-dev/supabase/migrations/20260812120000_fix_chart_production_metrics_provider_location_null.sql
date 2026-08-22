-- ============================================================================
-- Fix chart_get_production_metrics: two bugs, confirmed live 2026-08-12 by
-- calling the RPC directly against production data for The Old Surgery /
-- Hygienist / Jul 2026 (Total Revenue £13,895.30, 325 patients, but Total
-- Hygienists = 0 and Production/Ranking = "No data available").
--
-- Bug 1 (the actual cause here): `SELECT o.open_hours_per_day FROM
-- organizations o` — this column no longer exists on `organizations`.
-- Confirmed live: `column "o.open_hours_per_day" does not exist`, on every
-- call, for every org/provider type/location. The business-info settings
-- (open_hours_per_day, number_of_surgeries, cost percentages, …) now live on
-- `practice_locations` per-location — that move was made directly on the
-- database and was never captured as a migration in this repo, so every RPC
-- still reading them from `organizations` has been hard-erroring since. The
-- frontend swallows the RPC error into an empty array, which renders as
-- "No data available" / 0 rather than surfacing the failure.
--
-- Fix: read open_hours_per_day from practice_locations instead — the
-- selected location's own row when p_location_id is given, else the average
-- across the org's active locations (client-approved fallback for "All
-- Locations" views, since there's no longer a single org-wide value).
--
-- Bug 2 (real but not what caused this symptom — verified: this org's
-- hygienist provider rows all had location_id already matching the selected
-- location): base_providers filtered `p.location_id = p_location_id` with NO
-- NULL fallback, while every OTHER location predicate in this same function
-- (provider_production's tpi.location_id, appt_monthly_hours' a.location_id)
-- already tolerates `... OR x.location_id IS NULL`. Kept as a hardening fix
-- for providers with an unassigned/multi-site location_id elsewhere.
-- ============================================================================

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
DECLARE
  v_org_hours_per_day NUMERIC;
BEGIN
  SELECT COALESCE(loc.open_hours_per_day, org_avg.avg_hours, 8)
  INTO v_org_hours_per_day
  FROM (SELECT 1) AS dummy
  LEFT JOIN practice_locations loc
    ON p_location_id IS NOT NULL AND loc.id = p_location_id
  LEFT JOIN (
    SELECT AVG(pl.open_hours_per_day) AS avg_hours
    FROM practice_locations pl
    WHERE pl.organization_id = p_organization_id
      AND pl.deleted_at IS NULL
      AND pl.is_active = true
  ) AS org_avg ON true;

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
        OR (
          p_provider_type <> 'Other'
          AND p.provider_role ILIKE '%' || p_provider_type || '%'
        )
      )
      -- Permissive like every other location predicate in this function: a
      -- provider with no assigned home location can still have produced at
      -- p_location_id — the transaction-level filters below decide that.
      AND (p_location_id IS NULL OR p.location_id = p_location_id OR p.location_id IS NULL)
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
      AND tpi.tpi_completed_at >= (p_start_date::timestamp AT TIME ZONE 'Europe/London')
      AND tpi.tpi_completed_at <  ((p_end_date + 1)::timestamp AT TIME ZONE 'Europe/London')
      AND tpi.tpi_price IS NOT NULL
      AND tpi.tpi_price <> 0
      AND tpi.tpi_treatment_appointment_id IS NOT NULL
      AND tpi.deleted_at IS NULL
      AND tpi.organization_id = p_organization_id
      AND (
        p_location_id IS NULL
        OR tpi.location_id = p_location_id
        OR tpi.location_id IS NULL
      )
    GROUP BY bp.provider_id
  ),
  appt_monthly_hours AS (
    SELECT
      a.apmt_practitioner_id AS ext_id,
      DATE_TRUNC('month', a.apmt_start_time AT TIME ZONE 'Europe/London')::DATE AS month,
      SUM(a.apmt_duration)::NUMERIC / 60.0 AS month_hours
    FROM appointments a
    WHERE a.apmt_state IN ('Completed', 'Pending', 'In surgery', 'Confirmed')
      AND a.apmt_start_time IS NOT NULL
      AND a.apmt_start_time >= (p_start_date::timestamp AT TIME ZONE 'Europe/London')
      AND a.apmt_start_time <  ((p_end_date + 1)::timestamp AT TIME ZONE 'Europe/London')
      AND a.apmt_duration IS NOT NULL
      AND a.apmt_patient_id IS NOT NULL
      AND a.deleted_at IS NULL
      AND a.organization_id = p_organization_id
      AND (
        p_location_id IS NULL
        OR a.location_id = p_location_id
        OR a.location_id IS NULL
      )
    GROUP BY a.apmt_practitioner_id,
             DATE_TRUNC('month', a.apmt_start_time AT TIME ZONE 'Europe/London')
  ),
  appt_monthly_days AS (
    SELECT
      amh.ext_id,
      COALESCE(
        amh.month_hours / NULLIF(COALESCE(am.working_hours_per_day, v_org_hours_per_day, 8), 0),
        0
      ) AS month_days
    FROM appt_monthly_hours amh
    LEFT JOIN appointment_summary am
      ON am.organization_id = p_organization_id
      AND am.practitioner_id = amh.ext_id
      AND am.month = amh.month
  ),
  provider_hours AS (
    SELECT
      bp.provider_id,
      COALESCE(SUM(amd.month_days), 0) AS working_days
    FROM base_providers bp
    CROSS JOIN UNNEST(bp.external_ids) AS u(ext_id)
    LEFT JOIN appt_monthly_days amd ON amd.ext_id = u.ext_id::BIGINT
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
