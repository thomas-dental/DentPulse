-- Fix: Chair metrics undercounting appointments.
-- Two issues:
-- 1. Only counted apmt_state = 'Completed' (should include all except Cancelled/DNA)
-- 2. Appointments with NULL location_id were silently dropped by the JOIN
--    (same pattern as TPI revenue fix — fallback to patient location_id)

-- ============================================================
-- 1. Update get_chair_metrics()
-- ============================================================

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
  -- Current period: appointment hours per location
  -- Uses COALESCE(appointment.location_id, patient.location_id) to handle NULL location_id
  -- Include all states except Cancelled and Did Not Attend
  apmt_current AS (
    SELECT
      COALESCE(a.location_id, pt.location_id) AS loc_id,
      SUM(
        CASE
          WHEN a.apmt_finish_time IS NOT NULL AND a.apmt_start_time IS NOT NULL
          THEN EXTRACT(EPOCH FROM (a.apmt_finish_time - a.apmt_start_time)) / 3600.0
          ELSE COALESCE(a.apmt_duration, 0) / 60.0
        END
      ) AS total_hours,
      COUNT(*) AS total_count
    FROM appointments a
    LEFT JOIN patients pt ON pt.pt_id = a.apmt_patient_id
      AND pt.organization_id = _organization_id
    WHERE a.organization_id = _organization_id
      AND a.apmt_state NOT IN ('Cancelled', 'Did Not Attend', 'DNA')
      AND a.apmt_start_time >= _start_date::TIMESTAMPTZ
      AND a.apmt_start_time <= (_end_date)::TIMESTAMPTZ
      AND (a.apmt_finish_time IS NOT NULL OR a.apmt_duration IS NOT NULL)
      AND a.deleted_at IS NULL
    GROUP BY COALESCE(a.location_id, pt.location_id)
  ),
  -- Current period: revenue per location from treatment_plan_items
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
    (l.loc_chairs * l.loc_daily_hours * _working_days) AS available_hours,
    CASE
      WHEN l.loc_chairs > 0 AND (l.loc_chairs * l.loc_daily_hours * _working_days) > 0
      THEN ROUND(COALESCE(ac.total_hours, 0) / (l.loc_chairs * l.loc_daily_hours * _working_days) * 100, 1)
      ELSE 0
    END AS occupancy_pct,
    CASE
      WHEN l.loc_chairs > 0 AND (l.loc_chairs * l.loc_daily_hours * _working_days) > 0
      THEN ROUND(COALESCE(ac.total_hours, 0) / (l.loc_chairs * l.loc_daily_hours * _working_days) * 100, 1)
      ELSE 0
    END AS utilisation_pct,
    COALESCE(rc.total_revenue, 0) AS revenue,
    CASE
      WHEN l.loc_chairs > 0
      THEN ROUND(COALESCE(rc.total_revenue, 0) / l.loc_chairs, 0)
      ELSE 0
    END AS revenue_per_chair,
    CASE
      WHEN l.loc_chairs > 0
      THEN ROUND(COALESCE(rp.total_revenue, 0) / l.loc_chairs, 0)
      ELSE 0
    END AS prev_revenue_per_chair,
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

-- ============================================================
-- 2. Update get_hourly_chair_utilisation()
-- ============================================================

CREATE OR REPLACE FUNCTION get_hourly_chair_utilisation(
  _organization_id UUID,
  _location_id UUID DEFAULT NULL,
  _start_date DATE DEFAULT CURRENT_DATE,
  _end_date DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  hour_slot INTEGER,
  hour_label TEXT,
  appointment_minutes NUMERIC,
  total_appointments BIGINT,
  capacity_minutes NUMERIC,
  utilisation_pct NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _working_days INTEGER;
  _total_chairs INTEGER;
BEGIN
  SELECT COUNT(*)::INTEGER INTO _working_days
  FROM generate_series(_start_date, _end_date - INTERVAL '1 day', '1 day') d
  WHERE EXTRACT(DOW FROM d) BETWEEN 1 AND 5;

  IF _working_days = 0 THEN _working_days := 1; END IF;

  SELECT COALESCE(SUM(COALESCE(cs.number_of_chairs, pl.chairs_count, 0)), 0)::INTEGER
  INTO _total_chairs
  FROM practice_locations pl
  LEFT JOIN chair_settings cs
    ON cs.organization_id = pl.organization_id AND cs.location_id = pl.id
  WHERE pl.organization_id = _organization_id
    AND pl.deleted_at IS NULL
    AND pl.is_active = true
    AND (_location_id IS NULL OR pl.id = _location_id);

  IF _total_chairs = 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH hours AS (
    SELECT generate_series(0, 23) AS h
  ),
  apmt_by_hour AS (
    SELECT
      EXTRACT(HOUR FROM a.apmt_start_time)::INTEGER AS h,
      SUM(
        CASE
          WHEN a.apmt_finish_time IS NOT NULL AND a.apmt_start_time IS NOT NULL
          THEN EXTRACT(EPOCH FROM (a.apmt_finish_time - a.apmt_start_time)) / 60.0
          ELSE COALESCE(a.apmt_duration, 0)
        END
      )::NUMERIC AS total_minutes,
      COUNT(*) AS cnt
    FROM appointments a
    LEFT JOIN patients pt ON pt.pt_id = a.apmt_patient_id
      AND pt.organization_id = _organization_id
    WHERE a.organization_id = _organization_id
      AND a.apmt_state NOT IN ('Cancelled', 'Did Not Attend', 'DNA')
      AND a.apmt_start_time >= _start_date::TIMESTAMPTZ
      AND a.apmt_start_time < (_end_date + INTERVAL '1 day')::TIMESTAMPTZ
      AND (a.apmt_finish_time IS NOT NULL OR a.apmt_duration IS NOT NULL)
      AND a.deleted_at IS NULL
      AND (_location_id IS NULL OR COALESCE(a.location_id, pt.location_id) = _location_id)
    GROUP BY EXTRACT(HOUR FROM a.apmt_start_time)::INTEGER
  )
  SELECT
    hrs.h AS hour_slot,
    LPAD(hrs.h::TEXT, 2, '0') || ':00' AS hour_label,
    COALESCE(ab.total_minutes, 0) AS appointment_minutes,
    COALESCE(ab.cnt, 0) AS total_appointments,
    (_total_chairs * 60.0 * _working_days) AS capacity_minutes,
    CASE
      WHEN (_total_chairs * 60.0 * _working_days) > 0
      THEN ROUND(COALESCE(ab.total_minutes, 0) / (_total_chairs * 60.0 * _working_days) * 100, 1)
      ELSE 0
    END AS utilisation_pct
  FROM hours hrs
  LEFT JOIN apmt_by_hour ab ON ab.h = hrs.h
  ORDER BY hrs.h;
END;
$$;
