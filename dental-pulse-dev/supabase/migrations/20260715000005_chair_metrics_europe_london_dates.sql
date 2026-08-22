-- get_chair_metrics: resolve all date-range boundaries and day/weekday grouping
-- in EUROPE/LONDON, not the database server's UTC.
--
-- Before: `_start_date::TIMESTAMPTZ` cast a DATE to a timestamptz using the server
-- timezone (UTC), so the window started/ended at UTC midnight. Dentally stores
-- London-day appointments as timestamptz; in BST a London-00:30 appointment is
-- 23:30Z the previous day and fell OUTSIDE a UTC-bounded month. `DATE(...)` and
-- `EXTRACT(DOW FROM ...)` likewise used the UTC calendar day, mis-bucketing
-- boundary appointments and their working-day counts.
--
-- After: `(_date::TIMESTAMP AT TIME ZONE 'Europe/London')` gives the exact UTC
-- instant of London midnight (23:00Z prev day in BST, 00:00Z in GMT); day ranges
-- are half-open [start-day 00:00 London, (end-day+1) 00:00 London). Day/weekday
-- grouping uses `... AT TIME ZONE 'Europe/London'`. Everything else is unchanged
-- from 20260522000001 (flat daily opening hours, dedup, capping).
--
-- clinic_opening_hours_per_day is still the practice's FLAT average daily opening
-- hours (open days only); available_hours = chairs × that × distinct working days.

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
  treatment_hours NUMERIC,
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
  _default_loc_id UUID;
BEGIN
  SELECT pl.id INTO _default_loc_id
  FROM practice_locations pl
  WHERE pl.organization_id = _organization_id
    AND pl.deleted_at IS NULL
    AND pl.is_active = true
  ORDER BY pl.location_name
  LIMIT 1;

  RETURN QUERY
  WITH
  dow_map(dow, day_name) AS (
    VALUES
      (0, 'sunday'),
      (1, 'monday'),
      (2, 'tuesday'),
      (3, 'wednesday'),
      (4, 'thursday'),
      (5, 'friday'),
      (6, 'saturday')
  ),
  loc AS (
    SELECT
      pl.id AS loc_id,
      pl.location_name AS loc_name,
      COALESCE(cs.number_of_chairs, pl.chairs_count, 0) AS loc_chairs,
      pl.operating_hours AS loc_op_hours,
      COALESCE(cs.clinic_opening_hours_per_day, 8) AS loc_fallback_daily_hours,
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
  loc_dow_hours AS (
    SELECT
      l.loc_id,
      d.dow,
      CASE
        WHEN l.loc_op_hours IS NULL
          THEN l.loc_fallback_daily_hours
        WHEN (l.loc_op_hours -> d.day_name) IS NULL
          THEN 0
        WHEN COALESCE((l.loc_op_hours -> d.day_name ->> 'closed')::boolean, false)
          THEN 0
        WHEN (l.loc_op_hours -> d.day_name ->> 'open') IS NULL
          OR (l.loc_op_hours -> d.day_name ->> 'close') IS NULL
          THEN 0
        ELSE GREATEST(0, EXTRACT(EPOCH FROM
          (l.loc_op_hours -> d.day_name ->> 'close')::time
          - (l.loc_op_hours -> d.day_name ->> 'open')::time
        ) / 3600.0)
      END AS hours_per_day
    FROM loc l
    CROSS JOIN dow_map d
  ),
  -- Practice's standard daily opening hours: a FLAT average across the days
  -- the practice is actually open (closed days excluded). e.g. Mon–Sat
  -- 8.5+8.5+9.5+8.5+6+4 = 45 over 6 open days = 7.5 h/day. Stable per
  -- practice — does NOT vary with which weekdays had appointments.
  loc_flat_hours AS (
    SELECT
      loc_id,
      AVG(hours_per_day) AS avg_daily_hours
    FROM loc_dow_hours
    WHERE hours_per_day > 0
    GROUP BY loc_id
  ),
  apmt_base AS (
    SELECT
      a.apmt_id,
      a.apmt_start_time,
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
      AND a.apmt_start_time >= (_start_date::TIMESTAMP AT TIME ZONE 'Europe/London')
      AND a.apmt_start_time <  ((_end_date + 1)::TIMESTAMP AT TIME ZONE 'Europe/London')
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
  working_dates AS (
    SELECT
      ab.loc_id,
      DATE(ab.apmt_start_time AT TIME ZONE 'Europe/London') AS work_date,
      EXTRACT(DOW FROM ab.apmt_start_time AT TIME ZONE 'Europe/London')::INTEGER AS dow
    FROM apmt_base ab
    GROUP BY ab.loc_id,
      DATE(ab.apmt_start_time AT TIME ZONE 'Europe/London'),
      EXTRACT(DOW FROM ab.apmt_start_time AT TIME ZONE 'Europe/London')
  ),
  -- Available chair-hours = chairs × (flat daily hours) × (working days).
  -- working_days_count = distinct dates with appointments (unchanged);
  -- total_open_hours now applies the flat per-practice daily average to every
  -- working day instead of summing each date's own weekday hours.
  loc_avail AS (
    SELECT
      wd.loc_id,
      COUNT(*) AS working_days_count,
      COUNT(*) * COALESCE(lfh.avg_daily_hours, 8) AS total_open_hours
    FROM working_dates wd
    LEFT JOIN loc_flat_hours lfh ON lfh.loc_id = wd.loc_id
    GROUP BY wd.loc_id, lfh.avg_daily_hours
  ),
  -- Treatment-appointment ids for the IN-RANGE appointments only. Used to scope the
  -- TPI dedup below so it doesn't DISTINCT-ON the org's ENTIRE treatment_plan_items
  -- table (61k+ rows) every call — the main reason get_chair_metrics timed out (57014)
  -- on wide ranges, blanking the Overview. Only TPIs linked to an in-range appointment
  -- feed treatment_hours anyway.
  in_range_ta AS (
    SELECT DISTINCT ta.ta_id
    FROM treatment_appointments ta
    JOIN apmt_base ab ON ab.apmt_id = ta.ta_appointment_id
    WHERE ta.organization_id = _organization_id
      AND ta.deleted_at IS NULL
  ),
  -- Dedup TPIs in case Dentally re-synced the same logical record under
  -- a new id. Same key as 20260424000003.
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
      tpi.tpi_treatment_appointment_id,
      tpi.tpi_treatment_id
    FROM treatment_plan_items tpi
    WHERE tpi.organization_id = _organization_id
      AND tpi.deleted_at IS NULL
      AND tpi.tpi_treatment_appointment_id IS NOT NULL
      AND tpi.tpi_treatment_appointment_id IN (SELECT ta_id FROM in_range_ta)
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
  -- Treatment hours = Σ treatments.duration_minutes for TPIs linked to
  -- an in-period appointment, BUT capped per-appointment at the
  -- appointment's actual duration. (See 20260504000001 for the rationale.)
  tpi_current AS (
    SELECT
      capped.loc_id,
      SUM(capped.effective_hrs) AS treatment_hours
    FROM (
      SELECT
        ab.loc_id,
        ab.apmt_id,
        LEAST(
          ab.appointment_hrs,
          SUM(COALESCE(t.duration_minutes, 0)) / 60.0
        ) AS effective_hrs
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
      GROUP BY ab.loc_id, ab.apmt_id, ab.appointment_hrs
    ) capped
    GROUP BY capped.loc_id
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
      AND tpi.tpi_completed_at >= (_start_date::TIMESTAMP AT TIME ZONE 'Europe/London')
      AND tpi.tpi_completed_at <  ((_end_date + 1)::TIMESTAMP AT TIME ZONE 'Europe/London')
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
      AND tpi.tpi_completed_at >= (_prev_start_date::TIMESTAMP AT TIME ZONE 'Europe/London')
      AND tpi.tpi_completed_at <  (_prev_end_date::TIMESTAMP AT TIME ZONE 'Europe/London')
      AND tpi.deleted_at IS NULL
    GROUP BY COALESCE(tpi.location_id, pt.location_id, _default_loc_id)
  )
  SELECT
    l.loc_id AS location_id,
    l.loc_name::TEXT AS location_name,
    l.loc_chairs::INTEGER AS chairs_count,
    COALESCE(ac.appointment_hours, 0) AS completed_hours,
    COALESCE(tc.treatment_hours, 0) AS treatment_hours,
    COALESCE(ac.total_count, 0) AS appointment_count,
    (l.loc_chairs * COALESCE(la.total_open_hours, 0))::NUMERIC AS available_hours,
    -- Occupancy = appointment hrs / available chair hrs
    CASE
      WHEN l.loc_chairs > 0
        AND (l.loc_chairs * COALESCE(la.total_open_hours, 0)) > 0
      THEN ROUND(
        COALESCE(ac.appointment_hours, 0)
        / (l.loc_chairs * la.total_open_hours) * 100, 1
      )
      ELSE 0
    END AS occupancy_pct,
    -- Utilisation = appointment-linked treatment hrs / available chair hrs
    CASE
      WHEN l.loc_chairs > 0
        AND (l.loc_chairs * COALESCE(la.total_open_hours, 0)) > 0
      THEN ROUND(
        COALESCE(tc.treatment_hours, 0)
        / (l.loc_chairs * la.total_open_hours) * 100, 1
      )
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
    -- Flat practice daily hours (loc_flat_hours). total_open_hours is now
    -- working_days_count × avg_daily_hours, so this division returns exactly
    -- the flat average (e.g. 7.5), independent of the booking pattern.
    CASE
      WHEN COALESCE(la.working_days_count, 0) > 0
      THEN ROUND(la.total_open_hours / la.working_days_count, 2)
      ELSE l.loc_fallback_daily_hours
    END AS clinic_opening_hours_per_day,
    l.loc_days_per_week::INTEGER AS clinic_working_days_per_week,
    l.loc_weeks_per_year::INTEGER AS clinic_working_weeks_per_year,
    l.loc_days_per_year::INTEGER AS clinic_working_days_per_year
  FROM loc l
  LEFT JOIN apmt_current ac ON ac.loc_id = l.loc_id
  LEFT JOIN tpi_current tc ON tc.loc_id = l.loc_id
  LEFT JOIN rev_current rc ON rc.loc_id = l.loc_id
  LEFT JOIN rev_prev rp ON rp.loc_id = l.loc_id
  LEFT JOIN loc_avail la ON la.loc_id = l.loc_id
  ORDER BY l.loc_name;
END;
$$;

COMMENT ON FUNCTION get_chair_metrics(uuid,date,date,date,date) IS
  'Chair metrics. Date windows + day/weekday grouping resolved in Europe/London '
  '(changed 2026-07-15; was UTC via ::TIMESTAMPTZ). clinic_opening_hours_per_day is '
  'the practice''s FLAT average daily opening hours (open days only); available_hours '
  '= chairs × that × distinct working days.';
