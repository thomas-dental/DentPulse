-- get_hourly_chair_utilisation: true per-hour model (time-overlap split).
--
-- Supersedes 20260519000002. That version reconciled with the Overview
-- "Avg Utilisation" tile on AVERAGE but peak hours still showed ~105%,
-- because each appointment's minutes were dumped into its START hour and
-- divided by a flat daily-average per-hour capacity.
--
-- This version is the correct per-hour model:
--
--   NUMERATOR  per hour H = Σ over appointments of
--       effective_minutes × (minutes of the appointment window that fall
--       inside hour H) ÷ appointment_duration
--     where effective_minutes = LEAST(appt_duration,
--       Σ treatment template minutes) — IDENTICAL per-appointment cap and
--       appointment→treatment_appointments→tpi_dedup→treatments join as the
--       tile (get_chair_metrics v20260504000001). A 90-min appointment that
--       runs 08:30–10:00 now contributes its effective minutes to 08:00 and
--       09:00 in proportion to the real overlap — not all to 08:00.
--
--   DENOMINATOR per hour H = Σ over locations of
--       chairs × (minutes hour H is inside the clinic's open window for that
--       weekday) × (number of distinct dates that had appointments on that
--       weekday) — the per-hour analogue of the tile's
--       chairs × total_open_hours, parsed from operating_hours exactly like
--       the tile's loc_dow_hours.
--
-- Σ_H NUMERATOR  = Σ effective_minutes              = tile numerator.
-- Σ_H DENOMINATOR = chairs × total_open_minutes      = tile denominator.
-- So the capacity-weighted aggregate reconciles with the tile, AND because
-- each hour's numerator is bounded by the chair-minutes physically open in
-- that hour, no hour exceeds ~100% (barring genuine overbooking).
--
-- Return signature unchanged — no frontend edit needed.

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
  -- Per-location, per-weekday open window in minutes-from-midnight.
  -- Mirrors get_chair_metrics.loc_dow_hours; fallback window = 08:00 for
  -- fallback_daily_hours hours (matches the chart's 08:00 start assumption).
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
  -- Appointments in the period, location-resolved exactly like the tile.
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
  -- Tile dedup (same key as get_chair_metrics).
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
  -- Per-appointment effective minutes: tile's LEAST() cap.
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
  -- Numerator: split each appointment's effective minutes across the hours
  -- its [start, start+duration] window overlaps, in proportion to the
  -- overlap. Σ over h = effective_minutes (Σ overlap = dur_min).
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
  -- Appointment minutes + count per START hour (display only).
  apmt_by_hour AS (
    SELECT FLOOR(ab.start_min / 60.0)::INTEGER AS h,
           SUM(ab.dur_min) AS appt_minutes,
           COUNT(*) AS cnt
    FROM apmt_scoped ab
    GROUP BY FLOOR(ab.start_min / 60.0)::INTEGER
  ),
  -- Distinct working dates per (location, weekday) — the tile's
  -- working_dates, used to weight the per-hour open capacity.
  loc_dow_days AS (
    SELECT loc_id, dow, COUNT(DISTINCT work_date) AS day_count
    FROM apmt_scoped
    GROUP BY loc_id, dow
  ),
  -- Per-hour capacity = Σ_loc chairs × (minutes hour H is open that weekday)
  -- × (#working dates on that weekday).
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
      THEN ROUND(COALESCE(tb.treat_minutes, 0) / cb.cap_minutes * 100, 1)
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
  'Hourly chair utilisation, true per-hour time-overlap model. Numerator = '
  'tile-capped (get_chair_metrics) effective treatment minutes split across '
  'the hours each appointment spans; denominator = chairs × open-minutes that '
  'hour × working-days, from operating_hours. Reconciles with the Avg '
  'Utilisation tile on aggregate and stays ≤~100% per hour. Fixed 2026-05-19.';
