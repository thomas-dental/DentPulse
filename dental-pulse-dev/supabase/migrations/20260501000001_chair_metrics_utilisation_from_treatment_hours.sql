-- get_chair_metrics: split Utilisation back from Occupancy.
--
--   Occupancy   = SUM(apmt_duration)              / available_hours   (unchanged)
--   Utilisation = SUM(treatments.duration_minutes) / available_hours   (NEW)
--
-- Treatment hours = sum of treatments.duration_minutes (minutes / 60) joined
-- via treatment_plan_items (tpi_treatment_id → treatments.external_id) for
-- TPIs completed in the period, with the same location-resolution as revenue
-- (tpi.location_id → patient.location_id → default location).
--
-- Adds a new return column `treatment_hours` so the Chairs page can show
-- the numerator alongside Available hrs in the Avg Utilisation tooltip.

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
  working_dates AS (
    SELECT
      ab.loc_id,
      DATE(ab.apmt_start_time) AS work_date,
      EXTRACT(DOW FROM ab.apmt_start_time)::INTEGER AS dow
    FROM apmt_base ab
    GROUP BY ab.loc_id, DATE(ab.apmt_start_time), EXTRACT(DOW FROM ab.apmt_start_time)
  ),
  loc_avail AS (
    SELECT
      wd.loc_id,
      SUM(ldh.hours_per_day) AS total_open_hours,
      COUNT(*) AS working_days_count
    FROM working_dates wd
    JOIN loc_dow_hours ldh
      ON ldh.loc_id = wd.loc_id
      AND ldh.dow = wd.dow
    GROUP BY wd.loc_id
  ),
  -- Σ treatments.duration_minutes (minutes → hours) for completed TPIs
  -- in the period. Same location-resolution as revenue.
  tpi_current AS (
    SELECT
      COALESCE(tpi.location_id, pt.location_id, _default_loc_id) AS loc_id,
      SUM(COALESCE(t.duration_minutes, 0) / 60.0) AS treatment_hours
    FROM treatment_plan_items tpi
    JOIN treatments t
      ON t.external_id = tpi.tpi_treatment_id::INTEGER
      AND t.organization_id = _organization_id
      AND t.deleted_at IS NULL
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
    COALESCE(tc.treatment_hours, 0) AS treatment_hours,
    COALESCE(ac.total_count, 0) AS appointment_count,
    (l.loc_chairs * COALESCE(la.total_open_hours, 0))::NUMERIC AS available_hours,
    -- Occupancy = appointment hrs / available chair hrs (unchanged)
    CASE
      WHEN l.loc_chairs > 0
        AND (l.loc_chairs * COALESCE(la.total_open_hours, 0)) > 0
      THEN ROUND(
        COALESCE(ac.appointment_hours, 0)
        / (l.loc_chairs * la.total_open_hours) * 100, 1
      )
      ELSE 0
    END AS occupancy_pct,
    -- Utilisation = treatment hrs / available chair hrs (NEW)
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
