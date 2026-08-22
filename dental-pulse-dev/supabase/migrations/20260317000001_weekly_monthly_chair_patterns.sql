-- Weekly and Monthly chair pattern functions + fix hours to use apmt_duration (match Dentally)

-- ============================================================
-- 1. Fix get_chair_metrics: use apmt_duration for completed_hours (match Dentally)
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

-- ============================================================
-- 2. Fix get_hourly_chair_utilisation: use apmt_duration (match Dentally)
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
  _default_loc_id UUID;
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

  SELECT pl.id INTO _default_loc_id
  FROM practice_locations pl
  WHERE pl.organization_id = _organization_id
    AND pl.deleted_at IS NULL AND pl.is_active = true
  ORDER BY pl.location_name LIMIT 1;

  RETURN QUERY
  WITH hours AS (
    SELECT generate_series(0, 23) AS h
  ),
  apmt_by_hour AS (
    SELECT
      EXTRACT(HOUR FROM a.apmt_start_time)::INTEGER AS h,
      SUM(
        COALESCE(a.apmt_duration,
          CASE WHEN a.apmt_finish_time IS NOT NULL AND a.apmt_start_time IS NOT NULL
            THEN EXTRACT(EPOCH FROM (a.apmt_finish_time - a.apmt_start_time)) / 60.0
            ELSE 0
          END
        )
      )::NUMERIC AS total_minutes,
      COUNT(*) AS cnt
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
      AND (
        _location_id IS NULL
        OR COALESCE(a.location_id, pt.location_id, pl_fb.id, _default_loc_id) = _location_id
      )
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

-- ============================================================
-- 3. New: get_weekly_chair_pattern()
-- Returns occupancy & utilisation by day of week (Mon-Sun)
-- ============================================================

DROP FUNCTION IF EXISTS get_weekly_chair_pattern(uuid,uuid,date,date);

CREATE OR REPLACE FUNCTION get_weekly_chair_pattern(
  _organization_id UUID,
  _location_id UUID DEFAULT NULL,
  _start_date DATE DEFAULT CURRENT_DATE,
  _end_date DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  day_of_week INTEGER,
  day_name TEXT,
  appointment_hours NUMERIC,
  treatment_hours NUMERIC,
  appointment_count BIGINT,
  available_hours NUMERIC,
  occupancy_pct NUMERIC,
  utilisation_pct NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _total_chairs INTEGER;
  _daily_hours NUMERIC;
  _default_loc_id UUID;
BEGIN
  SELECT
    COALESCE(SUM(COALESCE(cs.number_of_chairs, pl.chairs_count, 0)), 0)::INTEGER,
    COALESCE(AVG(COALESCE(cs.clinic_opening_hours_per_day, 8)), 8)
  INTO _total_chairs, _daily_hours
  FROM practice_locations pl
  LEFT JOIN chair_settings cs
    ON cs.organization_id = pl.organization_id AND cs.location_id = pl.id
  WHERE pl.organization_id = _organization_id
    AND pl.deleted_at IS NULL
    AND pl.is_active = true
    AND (_location_id IS NULL OR pl.id = _location_id);

  IF _total_chairs = 0 THEN RETURN; END IF;

  SELECT pl.id INTO _default_loc_id
  FROM practice_locations pl
  WHERE pl.organization_id = _organization_id
    AND pl.deleted_at IS NULL AND pl.is_active = true
  ORDER BY pl.location_name LIMIT 1;

  RETURN QUERY
  WITH days AS (
    SELECT d AS iso_dow,
      CASE d
        WHEN 1 THEN 'Mon'
        WHEN 2 THEN 'Tue'
        WHEN 3 THEN 'Wed'
        WHEN 4 THEN 'Thu'
        WHEN 5 THEN 'Fri'
        WHEN 6 THEN 'Sat'
        WHEN 7 THEN 'Sun'
      END AS dname
    FROM generate_series(1, 7) d
  ),
  dow_counts AS (
    SELECT
      EXTRACT(ISODOW FROM dt)::INTEGER AS iso_dow,
      COUNT(*) AS day_count
    FROM generate_series(_start_date::TIMESTAMP, (_end_date - INTERVAL '1 day')::TIMESTAMP, '1 day') dt
    GROUP BY EXTRACT(ISODOW FROM dt)::INTEGER
  ),
  -- Utilisation: appointment duration by DOW
  apmt_by_dow AS (
    SELECT
      EXTRACT(ISODOW FROM a.apmt_start_time)::INTEGER AS iso_dow,
      SUM(COALESCE(a.apmt_duration, 0) / 60.0) AS total_hours,
      COUNT(*) AS cnt
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
      AND (
        _location_id IS NULL
        OR COALESCE(a.location_id, pt.location_id, pl_fb.id, _default_loc_id) = _location_id
      )
    GROUP BY EXTRACT(ISODOW FROM a.apmt_start_time)::INTEGER
  ),
  -- Occupancy: completed treatment duration by DOW
  occ_by_dow AS (
    SELECT
      EXTRACT(ISODOW FROM a.apmt_start_time)::INTEGER AS iso_dow,
      SUM(COALESCE(t.duration_minutes, 0)) / 60.0 AS treat_hours
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
      AND (
        _location_id IS NULL
        OR COALESCE(a.location_id, pt.location_id, pl_fb.id, _default_loc_id) = _location_id
      )
    GROUP BY EXTRACT(ISODOW FROM a.apmt_start_time)::INTEGER
  )
  SELECT
    d.iso_dow AS day_of_week,
    d.dname::TEXT AS day_name,
    COALESCE(ab.total_hours, 0) AS appointment_hours,
    COALESCE(ob.treat_hours, 0) AS treatment_hours,
    COALESCE(ab.cnt, 0) AS appointment_count,
    COALESCE(dc.day_count, 0) * _total_chairs * _daily_hours AS available_hours,
    CASE
      WHEN COALESCE(dc.day_count, 0) > 0 AND _total_chairs > 0
      THEN ROUND(
        COALESCE(ob.treat_hours, 0) / (dc.day_count * _total_chairs * _daily_hours) * 100, 1
      )
      ELSE 0
    END AS occupancy_pct,
    CASE
      WHEN COALESCE(dc.day_count, 0) > 0 AND _total_chairs > 0
      THEN ROUND(
        COALESCE(ab.total_hours, 0) / (dc.day_count * _total_chairs * _daily_hours) * 100, 1
      )
      ELSE 0
    END AS utilisation_pct
  FROM days d
  LEFT JOIN dow_counts dc ON dc.iso_dow = d.iso_dow
  LEFT JOIN apmt_by_dow ab ON ab.iso_dow = d.iso_dow
  LEFT JOIN occ_by_dow ob ON ob.iso_dow = d.iso_dow
  ORDER BY d.iso_dow;
END;
$$;

-- ============================================================
-- 4. New: get_monthly_chair_trends()
-- Returns occupancy & utilisation by calendar month
-- ============================================================

DROP FUNCTION IF EXISTS get_monthly_chair_trends(uuid,uuid,date,date);

CREATE OR REPLACE FUNCTION get_monthly_chair_trends(
  _organization_id UUID,
  _location_id UUID DEFAULT NULL,
  _start_date DATE DEFAULT CURRENT_DATE,
  _end_date DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  month_start DATE,
  month_label TEXT,
  appointment_hours NUMERIC,
  treatment_hours NUMERIC,
  appointment_count BIGINT,
  available_hours NUMERIC,
  occupancy_pct NUMERIC,
  utilisation_pct NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _total_chairs INTEGER;
  _daily_hours NUMERIC;
  _default_loc_id UUID;
BEGIN
  SELECT
    COALESCE(SUM(COALESCE(cs.number_of_chairs, pl.chairs_count, 0)), 0)::INTEGER,
    COALESCE(AVG(COALESCE(cs.clinic_opening_hours_per_day, 8)), 8)
  INTO _total_chairs, _daily_hours
  FROM practice_locations pl
  LEFT JOIN chair_settings cs
    ON cs.organization_id = pl.organization_id AND cs.location_id = pl.id
  WHERE pl.organization_id = _organization_id
    AND pl.deleted_at IS NULL
    AND pl.is_active = true
    AND (_location_id IS NULL OR pl.id = _location_id);

  IF _total_chairs = 0 THEN RETURN; END IF;

  SELECT pl.id INTO _default_loc_id
  FROM practice_locations pl
  WHERE pl.organization_id = _organization_id
    AND pl.deleted_at IS NULL AND pl.is_active = true
  ORDER BY pl.location_name LIMIT 1;

  RETURN QUERY
  WITH months AS (
    SELECT
      date_trunc('month', d)::DATE AS m_start,
      TO_CHAR(d, 'Mon YYYY') AS m_label
    FROM generate_series(
      date_trunc('month', _start_date::TIMESTAMP),
      date_trunc('month', (_end_date - INTERVAL '1 day')::TIMESTAMP),
      '1 month'
    ) d
  ),
  working_days_per_month AS (
    SELECT
      date_trunc('month', dt)::DATE AS m_start,
      COUNT(*) AS wd_count
    FROM generate_series(_start_date::TIMESTAMP, (_end_date - INTERVAL '1 day')::TIMESTAMP, '1 day') dt
    WHERE EXTRACT(DOW FROM dt) BETWEEN 1 AND 5
    GROUP BY date_trunc('month', dt)::DATE
  ),
  -- Utilisation: appointment duration by month
  apmt_by_month AS (
    SELECT
      date_trunc('month', a.apmt_start_time)::DATE AS m_start,
      SUM(COALESCE(a.apmt_duration, 0) / 60.0) AS total_hours,
      COUNT(*) AS cnt
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
      AND (
        _location_id IS NULL
        OR COALESCE(a.location_id, pt.location_id, pl_fb.id, _default_loc_id) = _location_id
      )
    GROUP BY date_trunc('month', a.apmt_start_time)::DATE
  ),
  -- Occupancy: completed treatment duration by month
  occ_by_month AS (
    SELECT
      date_trunc('month', a.apmt_start_time)::DATE AS m_start,
      SUM(COALESCE(t.duration_minutes, 0)) / 60.0 AS treat_hours
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
      AND (
        _location_id IS NULL
        OR COALESCE(a.location_id, pt.location_id, pl_fb.id, _default_loc_id) = _location_id
      )
    GROUP BY date_trunc('month', a.apmt_start_time)::DATE
  )
  SELECT
    m.m_start AS month_start,
    m.m_label::TEXT AS month_label,
    COALESCE(ab.total_hours, 0) AS appointment_hours,
    COALESCE(ob.treat_hours, 0) AS treatment_hours,
    COALESCE(ab.cnt, 0) AS appointment_count,
    COALESCE(wd.wd_count, 0) * _total_chairs * _daily_hours AS available_hours,
    CASE
      WHEN COALESCE(wd.wd_count, 0) > 0 AND _total_chairs > 0
      THEN ROUND(
        COALESCE(ob.treat_hours, 0) / (wd.wd_count * _total_chairs * _daily_hours) * 100, 1
      )
      ELSE 0
    END AS occupancy_pct,
    CASE
      WHEN COALESCE(wd.wd_count, 0) > 0 AND _total_chairs > 0
      THEN ROUND(
        COALESCE(ab.total_hours, 0) / (wd.wd_count * _total_chairs * _daily_hours) * 100, 1
      )
      ELSE 0
    END AS utilisation_pct
  FROM months m
  LEFT JOIN working_days_per_month wd ON wd.m_start = m.m_start
  LEFT JOIN apmt_by_month ab ON ab.m_start = m.m_start
  LEFT JOIN occ_by_month ob ON ob.m_start = m.m_start
  ORDER BY m.m_start;
END;
$$;
