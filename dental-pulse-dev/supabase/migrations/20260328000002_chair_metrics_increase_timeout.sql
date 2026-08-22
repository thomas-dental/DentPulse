-- Increase statement timeout for get_chair_metrics to 30 seconds (default is ~8s on Supabase).
-- The function performs multiple JOINs across large tables and can exceed the default timeout.

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
SET statement_timeout = '30s'
AS $$
DECLARE
  _working_days INTEGER;
  _prev_working_days INTEGER;
  _default_loc_id UUID;
BEGIN
  SELECT COUNT(*)::INTEGER INTO _working_days
  FROM generate_series(_start_date, _end_date - INTERVAL '1 day', '1 day') d
  WHERE EXTRACT(DOW FROM d) BETWEEN 1 AND 5;

  SELECT COUNT(*)::INTEGER INTO _prev_working_days
  FROM generate_series(_prev_start_date, _prev_end_date - INTERVAL '1 day', '1 day') d
  WHERE EXTRACT(DOW FROM d) BETWEEN 1 AND 5;

  SELECT pl.id INTO _default_loc_id
  FROM practice_locations pl
  WHERE pl.organization_id = _organization_id
    AND pl.deleted_at IS NULL
    AND pl.is_active = true
  ORDER BY pl.location_name
  LIMIT 1;

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
  -- Use apmt_duration / 60.0 to match Dentally exactly (integer minutes, no sub-minute precision)
  apmt_current AS (
    SELECT
      COALESCE(
        a.location_id,
        pt.location_id,
        pl_fb.id,
        _default_loc_id
      ) AS loc_id,
      SUM(
        COALESCE(a.apmt_duration,
          CASE WHEN a.apmt_finish_time IS NOT NULL AND a.apmt_start_time IS NOT NULL
            THEN EXTRACT(EPOCH FROM (a.apmt_finish_time - a.apmt_start_time)) / 60.0
            ELSE 0
          END
        ) / 60.0
      ) AS appointment_hours,
      COUNT(*) AS total_count
    FROM appointments a
    LEFT JOIN patients pt ON pt.pt_id = a.apmt_patient_id
      AND pt.organization_id = _organization_id
    LEFT JOIN practice_locations pl_fb
      ON pl_fb.api_record_unique_id = a.apmt_practitioner_site_id::TEXT
      AND pl_fb.organization_id = _organization_id
      AND pl_fb.deleted_at IS NULL
    WHERE a.organization_id = _organization_id
      AND a.apmt_patient_id IS NOT NULL
      AND LOWER(a.apmt_state) NOT IN ('cancelled', 'did not attend', 'dna')
      AND a.apmt_start_time >= _start_date::TIMESTAMPTZ
      AND a.apmt_start_time < (_end_date)::TIMESTAMPTZ + INTERVAL '1 day'
      AND a.deleted_at IS NULL
    GROUP BY COALESCE(a.location_id, pt.location_id, pl_fb.id, _default_loc_id)
  ),
  occupancy_current AS (
    SELECT
      COALESCE(
        a.location_id,
        pt.location_id,
        pl_fb.id,
        _default_loc_id
      ) AS loc_id,
      SUM(COALESCE(t.duration_minutes, 0)) / 60.0 AS treatment_hours
    FROM appointments a
    LEFT JOIN patients pt ON pt.pt_id = a.apmt_patient_id
      AND pt.organization_id = _organization_id
    LEFT JOIN practice_locations pl_fb
      ON pl_fb.api_record_unique_id = a.apmt_practitioner_site_id::TEXT
      AND pl_fb.organization_id = _organization_id
      AND pl_fb.deleted_at IS NULL
    JOIN treatment_appointments ta
      ON ta.ta_appointment_id = a.apmt_id
      AND ta.organization_id = _organization_id
      AND ta.deleted_at IS NULL
    JOIN treatment_plan_items tpi
      ON tpi.tpi_treatment_appointment_id = ta.ta_id
      AND tpi.organization_id = _organization_id
      AND tpi.deleted_at IS NULL
    JOIN treatments t
      ON t.external_id = tpi.tpi_treatment_id::INTEGER
      AND t.organization_id = _organization_id
      AND t.deleted_at IS NULL
    WHERE a.organization_id = _organization_id
      AND a.apmt_patient_id IS NOT NULL
      AND LOWER(a.apmt_state) NOT IN ('cancelled', 'did not attend', 'dna')
      AND a.apmt_start_time >= _start_date::TIMESTAMPTZ
      AND a.apmt_start_time < (_end_date)::TIMESTAMPTZ + INTERVAL '1 day'
      AND a.deleted_at IS NULL
    GROUP BY COALESCE(a.location_id, pt.location_id, pl_fb.id, _default_loc_id)
  ),
  rev_current AS (
    SELECT
      COALESCE(tpi.location_id, pt.location_id, _default_loc_id) AS loc_id,
      SUM(COALESCE(tpi.tpi_price, 0)) AS total_revenue
    FROM treatment_plan_items tpi
    LEFT JOIN patients pt ON pt.pt_id = tpi.tpi_patient_id
      AND pt.organization_id = _organization_id
    WHERE tpi.organization_id = _organization_id
      AND tpi.tpi_completed = true
      AND tpi.tpi_completed_at >= _start_date::TIMESTAMPTZ
      AND tpi.tpi_completed_at < (_end_date)::TIMESTAMPTZ + INTERVAL '1 day'
      AND tpi.deleted_at IS NULL
    GROUP BY COALESCE(tpi.location_id, pt.location_id, _default_loc_id)
  ),
  rev_prev AS (
    SELECT
      COALESCE(tpi.location_id, pt.location_id, _default_loc_id) AS loc_id,
      SUM(COALESCE(tpi.tpi_price, 0)) AS total_revenue
    FROM treatment_plan_items tpi
    LEFT JOIN patients pt ON pt.pt_id = tpi.tpi_patient_id
      AND pt.organization_id = _organization_id
    WHERE tpi.organization_id = _organization_id
      AND tpi.tpi_completed = true
      AND tpi.tpi_completed_at >= _prev_start_date::TIMESTAMPTZ
      AND tpi.tpi_completed_at < (_prev_end_date)::TIMESTAMPTZ
      AND tpi.deleted_at IS NULL
    GROUP BY COALESCE(tpi.location_id, pt.location_id, _default_loc_id)
  )
  SELECT
    l.loc_id AS location_id,
    l.loc_name::TEXT AS location_name,
    l.loc_chairs::INTEGER AS chairs_count,
    ROUND(COALESCE(ac.appointment_hours, 0), 1) AS completed_hours,
    COALESCE(ac.total_count, 0) AS appointment_count,
    (l.loc_chairs * l.loc_daily_hours * _working_days) AS available_hours,
    CASE
      WHEN l.loc_chairs > 0 AND (l.loc_chairs * l.loc_daily_hours * _working_days) > 0
      THEN ROUND(COALESCE(oc.treatment_hours, 0) / (l.loc_chairs * l.loc_daily_hours * _working_days) * 100, 1)
      ELSE 0
    END AS occupancy_pct,
    CASE
      WHEN l.loc_chairs > 0 AND (l.loc_chairs * l.loc_daily_hours * _working_days) > 0
      THEN ROUND(COALESCE(ac.appointment_hours, 0) / (l.loc_chairs * l.loc_daily_hours * _working_days) * 100, 1)
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
  LEFT JOIN occupancy_current oc ON oc.loc_id = l.loc_id
  LEFT JOIN rev_current rc ON rc.loc_id = l.loc_id
  LEFT JOIN rev_prev rp ON rp.loc_id = l.loc_id
  ORDER BY l.loc_name;
END;
$$;
