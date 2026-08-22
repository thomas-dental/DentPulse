-- get_hourly_chair_utilisation: cap each hour at its physical capacity.
--
-- Supersedes 20260519000003. The time-overlap model in 003 is correct and
-- reconciles with the tile, but a clock-hour can still read slightly >100%
-- (e.g. 08:00 = 102.3%) when that hour is genuinely over capacity —
-- appointments starting before the configured open time spilling into the
-- first hour, or overlapping/double-booked appointments exceeding the chair
-- count that hour.
--
-- The tile (get_chair_metrics) enforces "you cannot deliver more treatment
-- than the chair was available" via LEAST() PER APPOINTMENT. This applies
-- the SAME principle at the hour grain: an hour cannot be more than fully
-- utilised, so delivered minutes are LEAST()-capped at that hour's open
-- chair-minutes. An at/over-capacity hour now reads exactly 100% (fully
-- booked) — consistent with how the tile treats over-long appointments.
--
-- Everything else is byte-identical to 003 (same numerator time-overlap
-- split, same operating_hours-based per-hour denominator, same dedup + tile
-- cap). Only the final utilisation_pct gets the per-hour LEAST cap. Return
-- signature unchanged — no frontend edit needed. Aggregate still ≈ the tile
-- (only genuinely over-capacity hours are trimmed, mirroring the tile's own
-- capping behaviour).

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
  _default_loc_id UUID;
BEGIN
  SELECT pl.id INTO _default_loc_id
  FROM practice_locations pl
  WHERE pl.organization_id = _organization_id
    AND pl.deleted_at IS NULL AND pl.is_active = true
  ORDER BY pl.location_name LIMIT 1;

  RETURN QUERY
  WITH
  dow_map(dow, day_name) AS (
    VALUES (0,'sunday'),(1,'monday'),(2,'tuesday'),(3,'wednesday'),
           (4,'thursday'),(5,'friday'),(6,'saturday')
  ),
  loc AS (
    SELECT
      pl.id AS loc_id,
      COALESCE(cs.number_of_chairs, pl.chairs_count, 0) AS chairs,
      pl.operating_hours AS op_hours,
      COALESCE(cs.clinic_opening_hours_per_day, 8) AS fallback_daily_hours
    FROM practice_locations pl
    LEFT JOIN chair_settings cs
      ON cs.organization_id = pl.organization_id AND cs.location_id = pl.id
    WHERE pl.organization_id = _organization_id
      AND pl.deleted_at IS NULL
      AND pl.is_active = true
      AND (_location_id IS NULL OR pl.id = _location_id)
  ),
  loc_dow_window AS (
    SELECT
      l.loc_id,
      d.dow,
      CASE
        WHEN l.op_hours IS NULL THEN 8 * 60.0
        WHEN (l.op_hours -> d.day_name) IS NULL THEN NULL
        WHEN COALESCE((l.op_hours -> d.day_name ->> 'closed')::boolean, false) THEN NULL
        WHEN (l.op_hours -> d.day_name ->> 'open') IS NULL
          OR (l.op_hours -> d.day_name ->> 'close') IS NULL THEN NULL
        ELSE EXTRACT(EPOCH FROM (l.op_hours -> d.day_name ->> 'open')::time) / 60.0
      END AS open_min,
      CASE
        WHEN l.op_hours IS NULL THEN (8 + l.fallback_daily_hours) * 60.0
        WHEN (l.op_hours -> d.day_name) IS NULL THEN NULL
        WHEN COALESCE((l.op_hours -> d.day_name ->> 'closed')::boolean, false) THEN NULL
        WHEN (l.op_hours -> d.day_name ->> 'open') IS NULL
          OR (l.op_hours -> d.day_name ->> 'close') IS NULL THEN NULL
        ELSE EXTRACT(EPOCH FROM (l.op_hours -> d.day_name ->> 'close')::time) / 60.0
      END AS close_min
    FROM loc l
    CROSS JOIN dow_map d
  ),
  apmt_base AS (
    SELECT
      a.apmt_id,
      a.apmt_start_time,
      DATE(a.apmt_start_time) AS work_date,
      EXTRACT(DOW FROM a.apmt_start_time)::INTEGER AS dow,
      EXTRACT(EPOCH FROM a.apmt_start_time::time) / 60.0 AS start_min,
      COALESCE(a.apmt_duration, 0) AS dur_min,
      COALESCE(a.location_id, pt.location_id, pl_fb.id, _default_loc_id) AS loc_id
    FROM appointments a
    LEFT JOIN LATERAL (
      SELECT p.location_id FROM patients p
      WHERE p.pt_id = a.apmt_patient_id AND p.organization_id = _organization_id
      LIMIT 1
    ) pt ON TRUE
    LEFT JOIN LATERAL (
      SELECT pl2.id FROM practice_locations pl2
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
  apmt_scoped AS (
    SELECT ab.* FROM apmt_base ab
    JOIN loc lc ON lc.loc_id = ab.loc_id
  ),
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
  appt_effective AS (
    SELECT
      ab.apmt_id,
      ab.start_min,
      ab.dur_min,
      LEAST(
        ab.dur_min::NUMERIC,
        SUM(COALESCE(t.duration_minutes, 0))
      ) AS effective_minutes
    FROM apmt_scoped ab
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
    WHERE ab.dur_min > 0
    GROUP BY ab.apmt_id, ab.start_min, ab.dur_min
  ),
  hours AS (SELECT generate_series(0, 23) AS h),
  treat_by_hour AS (
    SELECT
      hrs.h,
      SUM(
        ae.effective_minutes
        * GREATEST(0,
            LEAST(ae.start_min + ae.dur_min, (hrs.h + 1) * 60.0)
            - GREATEST(ae.start_min, hrs.h * 60.0)
          )
        / ae.dur_min
      ) AS treat_minutes
    FROM appt_effective ae
    JOIN hours hrs
      ON ae.start_min < (hrs.h + 1) * 60.0
     AND ae.start_min + ae.dur_min > hrs.h * 60.0
    GROUP BY hrs.h
  ),
  apmt_by_hour AS (
    SELECT FLOOR(ab.start_min / 60.0)::INTEGER AS h,
           SUM(ab.dur_min) AS appt_minutes,
           COUNT(*) AS cnt
    FROM apmt_scoped ab
    GROUP BY FLOOR(ab.start_min / 60.0)::INTEGER
  ),
  loc_dow_days AS (
    SELECT loc_id, dow, COUNT(DISTINCT work_date) AS day_count
    FROM apmt_scoped
    GROUP BY loc_id, dow
  ),
  cap_by_hour AS (
    SELECT
      hrs.h,
      SUM(
        lc.chairs
        * GREATEST(0,
            LEAST(ldw.close_min, (hrs.h + 1) * 60.0)
            - GREATEST(ldw.open_min, hrs.h * 60.0)
          )
        * ldd.day_count
      ) AS cap_minutes
    FROM hours hrs
    JOIN loc lc ON TRUE
    JOIN loc_dow_days ldd ON ldd.loc_id = lc.loc_id
    JOIN loc_dow_window ldw
      ON ldw.loc_id = lc.loc_id AND ldw.dow = ldd.dow
    WHERE ldw.open_min IS NOT NULL
      AND ldw.close_min IS NOT NULL
    GROUP BY hrs.h
  )
  SELECT
    hrs.h AS hour_slot,
    LPAD(hrs.h::TEXT, 2, '0') || ':00' AS hour_label,
    COALESCE(ab.appt_minutes, 0)::NUMERIC AS appointment_minutes,
    COALESCE(ab.cnt, 0)::BIGINT AS total_appointments,
    COALESCE(cb.cap_minutes, 0)::NUMERIC AS capacity_minutes,
    CASE
      WHEN COALESCE(cb.cap_minutes, 0) > 0
      THEN ROUND(
        -- Hour-grain analogue of the tile's per-appointment LEAST cap:
        -- a chair-hour cannot be more than fully utilised.
        LEAST(COALESCE(tb.treat_minutes, 0), cb.cap_minutes)
        / cb.cap_minutes * 100, 1)
      ELSE 0
    END AS utilisation_pct
  FROM hours hrs
  LEFT JOIN apmt_by_hour  ab ON ab.h = hrs.h
  LEFT JOIN treat_by_hour tb ON tb.h = hrs.h
  LEFT JOIN cap_by_hour   cb ON cb.h = hrs.h
  ORDER BY hrs.h;
END;
$$;

COMMENT ON FUNCTION get_hourly_chair_utilisation(uuid,uuid,date,date) IS
  'Hourly chair utilisation, time-overlap model with per-hour physical cap. '
  'Numerator = tile-capped effective treatment minutes split across the hours '
  'each appointment spans, LEAST-capped at the hour''s open chair-minutes '
  '(hour-grain analogue of get_chair_metrics'' per-appointment cap). '
  'Denominator = chairs × open-minutes that hour × working-days from '
  'operating_hours. Reconciles with the Avg Utilisation tile; never >100%. '
  'Fixed 2026-05-19.';
