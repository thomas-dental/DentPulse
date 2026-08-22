-- Returns hourly appointment utilisation for given location(s) and date range
-- Each row = one hour slot with total appointment minutes, chair capacity, and utilisation %

CREATE OR REPLACE FUNCTION get_hourly_chair_utilisation(
  _organization_id UUID,
  _location_id UUID DEFAULT NULL,  -- NULL = all locations aggregated
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
  -- Count weekdays in period
  SELECT COUNT(*)::INTEGER INTO _working_days
  FROM generate_series(_start_date, _end_date - INTERVAL '1 day', '1 day') d
  WHERE EXTRACT(DOW FROM d) BETWEEN 1 AND 5;

  -- If _working_days is 0 (e.g. weekend-only range), set to 1 to avoid div/0
  IF _working_days = 0 THEN _working_days := 1; END IF;

  -- Total chairs across relevant locations (from chair_settings, fallback practice_locations)
  SELECT COALESCE(SUM(COALESCE(cs.number_of_chairs, pl.chairs_count, 0)), 0)::INTEGER
  INTO _total_chairs
  FROM practice_locations pl
  LEFT JOIN chair_settings cs
    ON cs.organization_id = pl.organization_id AND cs.location_id = pl.id
  WHERE pl.organization_id = _organization_id
    AND pl.deleted_at IS NULL
    AND pl.is_active = true
    AND (_location_id IS NULL OR pl.id = _location_id);

  -- If no chairs, return empty
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
    WHERE a.organization_id = _organization_id
      AND a.apmt_state = 'Completed'
      AND a.apmt_start_time >= _start_date::TIMESTAMPTZ
      AND a.apmt_start_time < (_end_date + INTERVAL '1 day')::TIMESTAMPTZ
      AND (a.apmt_finish_time IS NOT NULL OR a.apmt_duration IS NOT NULL)
      AND a.deleted_at IS NULL
      AND (_location_id IS NULL OR a.location_id = _location_id)
    GROUP BY EXTRACT(HOUR FROM a.apmt_start_time)::INTEGER
  )
  SELECT
    hrs.h AS hour_slot,
    LPAD(hrs.h::TEXT, 2, '0') || ':00' AS hour_label,
    COALESCE(ab.total_minutes, 0) AS appointment_minutes,
    COALESCE(ab.cnt, 0) AS total_appointments,
    -- Capacity per hour slot = chairs × 60 min × working_days
    (_total_chairs * 60.0 * _working_days) AS capacity_minutes,
    -- Utilisation % = appointment minutes / capacity minutes × 100
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
