-- Update get_chair_metrics to use chair_settings table instead of practice_locations.chairs_count
-- and hardcoded daily hours. Also returns benchmark values from settings.

-- Drop old function first (return type changed)
DROP FUNCTION IF EXISTS get_chair_metrics(uuid,date,date,date,date);

CREATE OR REPLACE FUNCTION get_chair_metrics(
  _organization_id UUID,
  _start_date DATE,
  _end_date DATE,
  _prev_start_date DATE,
  _prev_end_date DATE
)
RETURNS TABLE (
  location_id UUID,
  location_name TEXT,
  chairs_count INTEGER,
  completed_hours NUMERIC,
  appointment_count BIGINT,
  available_hours NUMERIC,
  occupancy_pct NUMERIC,
  utilisation_pct NUMERIC,
  revenue NUMERIC,
  revenue_per_chair NUMERIC,
  prev_revenue_per_chair NUMERIC,
  trend_pct NUMERIC,
  benchmark_occupancy NUMERIC,
  benchmark_revenue_per_chair_per_hour NUMERIC,
  clinic_opening_hours_per_day NUMERIC,
  clinic_working_days_per_week INTEGER,
  clinic_working_weeks_per_year INTEGER,
  clinic_working_days_per_year INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _working_days INTEGER;
  _prev_working_days INTEGER;
BEGIN
  -- Count weekdays (Mon-Fri) in current period
  SELECT COUNT(*)::INTEGER INTO _working_days
  FROM generate_series(_start_date, _end_date - INTERVAL '1 day', '1 day') d
  WHERE EXTRACT(DOW FROM d) BETWEEN 1 AND 5;

  -- Count weekdays in previous period
  SELECT COUNT(*)::INTEGER INTO _prev_working_days
  FROM generate_series(_prev_start_date, _prev_end_date - INTERVAL '1 day', '1 day') d
  WHERE EXTRACT(DOW FROM d) BETWEEN 1 AND 5;

  RETURN QUERY
  WITH loc AS (
    SELECT
      pl.id AS loc_id,
      pl.location_name AS loc_name,
      -- Use chair_settings if available, else fall back to practice_locations.chairs_count, else 0
      COALESCE(cs.number_of_chairs, pl.chairs_count, 0) AS loc_chairs,
      COALESCE(cs.clinic_opening_hours_per_day, 8) AS loc_daily_hours,
      COALESCE(cs.clinic_working_days_per_week, 5) AS loc_days_per_week,
      COALESCE(cs.clinic_working_weeks_per_year, 46) AS loc_weeks_per_year,
      COALESCE(cs.clinic_working_days_per_year, 230) AS loc_days_per_year,
      cs.industry_benchmark_occupancy AS loc_benchmark_occupancy,
      COALESCE(cs.benchmark_revenue_per_chair_per_hour, 300) AS loc_benchmark_rev
    FROM practice_locations pl
    LEFT JOIN chair_settings cs
      ON cs.organization_id = pl.organization_id
      AND cs.location_id = pl.id
    WHERE pl.organization_id = _organization_id
      AND pl.deleted_at IS NULL
      AND pl.is_active = true
  ),
  -- Current period: completed appointment hours per location
  -- Uses actual occupied time (finish - start), falls back to apmt_duration if finish_time is NULL
  apmt_current AS (
    SELECT
      a.location_id AS loc_id,
      SUM(
        CASE
          WHEN a.apmt_finish_time IS NOT NULL AND a.apmt_start_time IS NOT NULL
          THEN EXTRACT(EPOCH FROM (a.apmt_finish_time - a.apmt_start_time)) / 3600.0
          ELSE COALESCE(a.apmt_duration, 0) / 60.0
        END
      ) AS total_hours,
      COUNT(*) AS total_count
    FROM appointments a
    WHERE a.organization_id = _organization_id
      AND a.apmt_state = 'Completed'
      AND a.apmt_start_time >= _start_date::TIMESTAMPTZ
      AND a.apmt_start_time <= (_end_date)::TIMESTAMPTZ
      AND (a.apmt_finish_time IS NOT NULL OR a.apmt_duration IS NOT NULL)
      AND a.deleted_at IS NULL
    GROUP BY a.location_id
  ),
  -- Current period: revenue per location from treatment_plan_items
  -- Uses tpi.location_id (set from Dentally site_id), with patient fallback when NULL
  rev_current AS (
    SELECT
      COALESCE(tpi.location_id, pt.location_id) AS loc_id,
      SUM(COALESCE(tpi.tpi_price, 0)) AS total_revenue
    FROM treatment_plan_items tpi
    LEFT JOIN patients pt ON pt.pt_id = tpi.tpi_patient_id
      AND pt.organization_id = _organization_id
    WHERE tpi.organization_id = _organization_id
      AND tpi.tpi_completed = true
      AND tpi.tpi_completed_at >= _start_date::TIMESTAMPTZ
      AND tpi.tpi_completed_at <= (_end_date)::TIMESTAMPTZ + INTERVAL '23 hours 59 minutes 59 seconds'
      AND tpi.deleted_at IS NULL
    GROUP BY COALESCE(tpi.location_id, pt.location_id)
  ),
  -- Previous period: revenue per location (for trend)
  rev_prev AS (
    SELECT
      COALESCE(tpi.location_id, pt.location_id) AS loc_id,
      SUM(COALESCE(tpi.tpi_price, 0)) AS total_revenue
    FROM treatment_plan_items tpi
    LEFT JOIN patients pt ON pt.pt_id = tpi.tpi_patient_id
      AND pt.organization_id = _organization_id
    WHERE tpi.organization_id = _organization_id
      AND tpi.tpi_completed = true
      AND tpi.tpi_completed_at >= _prev_start_date::TIMESTAMPTZ
      AND tpi.tpi_completed_at < (_prev_end_date)::TIMESTAMPTZ
      AND tpi.deleted_at IS NULL
    GROUP BY COALESCE(tpi.location_id, pt.location_id)
  )
  SELECT
    l.loc_id AS location_id,
    l.loc_name::TEXT AS location_name,
    l.loc_chairs::INTEGER AS chairs_count,
    COALESCE(ac.total_hours, 0) AS completed_hours,
    COALESCE(ac.total_count, 0) AS appointment_count,
    -- Available hours = chairs × daily_hours × working_days_in_period
    (l.loc_chairs * l.loc_daily_hours * _working_days) AS available_hours,
    -- Occupancy %
    CASE
      WHEN l.loc_chairs > 0 AND (l.loc_chairs * l.loc_daily_hours * _working_days) > 0
      THEN ROUND(COALESCE(ac.total_hours, 0) / (l.loc_chairs * l.loc_daily_hours * _working_days) * 100, 1)
      ELSE 0
    END AS occupancy_pct,
    -- Utilisation %
    CASE
      WHEN l.loc_chairs > 0 AND (l.loc_chairs * l.loc_daily_hours * _working_days) > 0
      THEN ROUND(COALESCE(ac.total_hours, 0) / (l.loc_chairs * l.loc_daily_hours * _working_days) * 100, 1)
      ELSE 0
    END AS utilisation_pct,
    COALESCE(rc.total_revenue, 0) AS revenue,
    -- Revenue per chair
    CASE
      WHEN l.loc_chairs > 0
      THEN ROUND(COALESCE(rc.total_revenue, 0) / l.loc_chairs, 0)
      ELSE 0
    END AS revenue_per_chair,
    -- Previous period revenue per chair
    CASE
      WHEN l.loc_chairs > 0
      THEN ROUND(COALESCE(rp.total_revenue, 0) / l.loc_chairs, 0)
      ELSE 0
    END AS prev_revenue_per_chair,
    -- Trend %
    CASE
      WHEN l.loc_chairs > 0 AND COALESCE(rp.total_revenue, 0) > 0
      THEN ROUND(
        (COALESCE(rc.total_revenue, 0) - COALESCE(rp.total_revenue, 0))
        / COALESCE(rp.total_revenue, 0) * 100, 1
      )
      ELSE 0
    END AS trend_pct,
    l.loc_benchmark_occupancy AS benchmark_occupancy,
    l.loc_benchmark_rev AS benchmark_revenue_per_chair_per_hour,
    l.loc_daily_hours AS clinic_opening_hours_per_day,
    l.loc_days_per_week::INTEGER AS clinic_working_days_per_week,
    l.loc_weeks_per_year::INTEGER AS clinic_working_weeks_per_year,
    l.loc_days_per_year::INTEGER AS clinic_working_days_per_year
  FROM loc l
  LEFT JOIN apmt_current ac ON ac.loc_id = l.loc_id
  LEFT JOIN rev_current rc ON rc.loc_id = l.loc_id
  LEFT JOIN rev_prev rp ON rp.loc_id = l.loc_id
  ORDER BY l.loc_name;
END;
$$;
