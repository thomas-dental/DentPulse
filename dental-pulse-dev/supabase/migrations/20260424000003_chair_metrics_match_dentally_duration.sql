-- Fix: get_chair_metrics should match Dentally's reported totals.
--
-- Changes from prior migration:
-- 1. Switch primary duration source from (apmt_finish_time - apmt_start_time) to apmt_duration
--    so totals match Dentally's "Appointments per Month" hours exactly. finish_time - start_time
--    was inflating results because some appointments have finish_time set to slot end rather
--    than actual end-of-treatment.
-- 2. Remove the LEAST() cap so real >100% values surface instead of being hidden behind
--    a flat 100% display (capping masked the underlying data issue).
-- 3. Keep the LATERAL LIMIT 1 patient/location fallback fix to prevent row multiplication.
-- 4. Keep the TPI dedup fix for occupancy.

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
  -- One row per appointment. LATERAL LIMIT 1 stops patient/location duplicates from
  -- multiplying the appointment. Duration uses apmt_duration (matches Dentally reporting).
  apmt_base AS (
    SELECT
      a.apmt_id,
      COALESCE(
        a.location_id,
        pt.location_id,
        pl_fb.id,
        _default_loc_id
      ) AS loc_id,
      COALESCE(a.apmt_duration, 0) / 60.0 AS appointment_hrs
    FROM appointments a
    LEFT JOIN LATERAL (
      SELECT p.location_id
      FROM patients p
      WHERE p.pt_id = a.apmt_patient_id
        AND p.organization_id = _organization_id
      LIMIT 1
    ) pt ON TRUE
    LEFT JOIN LATERAL (
      SELECT pl2.id
      FROM practice_locations pl2
      WHERE pl2.api_record_unique_id = a.apmt_practitioner_site_id::TEXT
        AND pl2.organization_id = _organization_id
        AND pl2.deleted_at IS NULL
      LIMIT 1
    ) pl_fb ON TRUE
    WHERE a.organization_id = _organization_id
      AND a.apmt_patient_id IS NOT NULL
      AND LOWER(a.apmt_state) NOT IN ('cancelled', 'did not attend', 'dna')
      AND a.apmt_start_time >= _start_date::TIMESTAMPTZ
      AND a.apmt_start_time < (_end_date)::TIMESTAMPTZ + INTERVAL '23 hours 59 minutes'
      AND a.deleted_at IS NULL
  ),
  apmt_current AS (
    SELECT
      loc_id,
      SUM(appointment_hrs) AS appointment_hours,
      COUNT(*) AS total_count
    FROM apmt_base
    GROUP BY loc_id
  ),
  -- Dedupe TPIs on a logical fingerprint before summing treatment durations.
  tpi_dedup AS (
    SELECT DISTINCT ON (
      COALESCE(
        tpi.tpi_id::TEXT,
        COALESCE(tpi.tpi_patient_id::TEXT, '') || '|' ||
        COALESCE(tpi.tpi_completed_at::TEXT, '') || '|' ||
        COALESCE(tpi.tpi_price::TEXT, '') || '|' ||
        COALESCE(tpi.tpi_treatment_id::TEXT, '') || '|' ||
        COALESCE(tpi.tpi_invoice_id::TEXT, '')
      )
    )
      tpi.id AS tpi_internal_id,
      tpi.tpi_treatment_appointment_id,
      tpi.tpi_treatment_id,
      tpi.tpi_patient_id
    FROM treatment_plan_items tpi
    WHERE tpi.organization_id = _organization_id
      AND tpi.deleted_at IS NULL
      AND tpi.tpi_treatment_appointment_id IS NOT NULL
    ORDER BY
      COALESCE(
        tpi.tpi_id::TEXT,
        COALESCE(tpi.tpi_patient_id::TEXT, '') || '|' ||
        COALESCE(tpi.tpi_completed_at::TEXT, '') || '|' ||
        COALESCE(tpi.tpi_price::TEXT, '') || '|' ||
        COALESCE(tpi.tpi_treatment_id::TEXT, '') || '|' ||
        COALESCE(tpi.tpi_invoice_id::TEXT, '')
      ),
      tpi.created_at ASC
  ),
  occupancy_current AS (
    SELECT
      ab.loc_id,
      SUM(COALESCE(t.duration_minutes, 0)) / 60.0 AS treatment_hours
    FROM apmt_base ab
    JOIN treatment_appointments ta
      ON ta.ta_appointment_id = ab.apmt_id
      AND ta.organization_id = _organization_id
      AND ta.deleted_at IS NULL
    JOIN tpi_dedup td
      ON td.tpi_treatment_appointment_id = ta.ta_id
    LEFT JOIN treatments t
      ON t.external_id = td.tpi_treatment_id::INTEGER
      AND t.organization_id = _organization_id
      AND t.deleted_at IS NULL
    GROUP BY ab.loc_id
  ),
  rev_current AS (
    SELECT
      COALESCE(tpi.location_id, pt.location_id, _default_loc_id) AS loc_id,
      SUM(COALESCE(tpi.tpi_price, 0)) AS total_revenue
    FROM treatment_plan_items tpi
    LEFT JOIN LATERAL (
      SELECT p.location_id
      FROM patients p
      WHERE p.pt_id = tpi.tpi_patient_id
        AND p.organization_id = _organization_id
      LIMIT 1
    ) pt ON TRUE
    WHERE tpi.organization_id = _organization_id
      AND tpi.tpi_completed = true
      AND tpi.tpi_completed_at >= _start_date::TIMESTAMPTZ
      AND tpi.tpi_completed_at <= (_end_date)::TIMESTAMPTZ + INTERVAL '23 hours 59 minutes 59 seconds'
      AND tpi.deleted_at IS NULL
    GROUP BY COALESCE(tpi.location_id, pt.location_id, _default_loc_id)
  ),
  rev_prev AS (
    SELECT
      COALESCE(tpi.location_id, pt.location_id, _default_loc_id) AS loc_id,
      SUM(COALESCE(tpi.tpi_price, 0)) AS total_revenue
    FROM treatment_plan_items tpi
    LEFT JOIN LATERAL (
      SELECT p.location_id
      FROM patients p
      WHERE p.pt_id = tpi.tpi_patient_id
        AND p.organization_id = _organization_id
      LIMIT 1
    ) pt ON TRUE
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
    COALESCE(ac.appointment_hours, 0) AS completed_hours,
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

-- Same duration change + uncap for hourly RPC
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
  apmt_base AS (
    SELECT
      a.apmt_id,
      EXTRACT(HOUR FROM a.apmt_start_time)::INTEGER AS h,
      COALESCE(
        a.location_id,
        pt.location_id,
        pl_fb.id,
        _default_loc_id
      ) AS loc_id,
      COALESCE(a.apmt_duration, 0)::NUMERIC AS total_minutes
    FROM appointments a
    LEFT JOIN LATERAL (
      SELECT p.location_id
      FROM patients p
      WHERE p.pt_id = a.apmt_patient_id
        AND p.organization_id = _organization_id
      LIMIT 1
    ) pt ON TRUE
    LEFT JOIN LATERAL (
      SELECT pl2.id
      FROM practice_locations pl2
      WHERE pl2.api_record_unique_id = a.apmt_practitioner_site_id::TEXT
        AND pl2.organization_id = _organization_id
        AND pl2.deleted_at IS NULL
      LIMIT 1
    ) pl_fb ON TRUE
    WHERE a.organization_id = _organization_id
      AND a.apmt_patient_id IS NOT NULL
      AND LOWER(a.apmt_state) NOT IN ('cancelled', 'did not attend', 'dna')
      AND a.apmt_start_time >= _start_date::TIMESTAMPTZ
      AND a.apmt_start_time < (_end_date)::TIMESTAMPTZ + INTERVAL '23 hours 59 minutes'
      AND a.deleted_at IS NULL
  ),
  apmt_by_hour AS (
    SELECT
      h,
      SUM(total_minutes)::NUMERIC AS total_minutes,
      COUNT(*) AS cnt
    FROM apmt_base
    WHERE _location_id IS NULL OR loc_id = _location_id
    GROUP BY h
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
