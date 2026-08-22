-- Fix get_hourly_chair_utilisation so its utilisation_pct matches the
-- Overview "Avg Utilisation" tile (get_chair_metrics, v20260504000001).
--
-- The old version produced impossible values (700–893%) because:
--   1. Numerator summed RAW treatments.duration_minutes for every completed
--      TPI bucketed by tpi_completed_at — uncapped template minutes, and a
--      whole plan's TPIs share one completion timestamp so they all dumped
--      into a single hour.
--   2. Denominator used _working_days = Mon–Fri calendar count of the range
--      while the numerator counted all days → asymmetric, inflated ratio.
--
-- The tile (get_chair_metrics) defines:
--   Utilisation = Σ per-appointment LEAST(appt_duration, Σ treatment template
--                 minutes for that appointment, via
--                 appointments → treatment_appointments → tpi_dedup →
--                 treatments)                                   [numerator]
--                 ÷ (chairs × Σ open-hours over the dates that had
--                 appointments)                                 [denominator]
--
-- This rewrite mirrors that EXACTLY (same CTE shape, dedup key and LEAST cap
-- as get_chair_metrics), bucketed by the hour the chair was in use
-- (appointments.apmt_start_time — the same period anchor the tile uses).
-- Per-hour capacity = Σ_loc (chairs × distinct working dates) × 60, which is
-- the per-hour analogue of the tile's chairs × total_open_hours, so the
-- capacity-weighted aggregate over the clinic's open hours reconciles to the
-- tile's Avg Utilisation. The per-appointment LEAST cap keeps every hour
-- ≤ ~100%.
--
-- Return signature is unchanged so useHourlyChairMetrics / Chairs.tsx keep
-- working without edits. Pure CTEs (no temp tables) — same style as the tile.

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
  -- Per-location chairs (same source the tile uses), scoped to the filter.
  loc_chairs AS (
    SELECT
      pl.id AS loc_id,
      COALESCE(cs.number_of_chairs, pl.chairs_count, 0) AS chairs
    FROM practice_locations pl
    LEFT JOIN chair_settings cs
      ON cs.organization_id = pl.organization_id AND cs.location_id = pl.id
    WHERE pl.organization_id = _organization_id
      AND pl.deleted_at IS NULL
      AND pl.is_active = true
      AND (_location_id IS NULL OR pl.id = _location_id)
  ),
  -- Appointments in the period, location-resolved exactly like the tile's
  -- apmt_base, then scoped to the in-filter locations.
  apmt_base AS (
    SELECT
      a.apmt_id,
      EXTRACT(HOUR FROM a.apmt_start_time)::INTEGER AS h,
      DATE(a.apmt_start_time) AS work_date,
      COALESCE(a.location_id, pt.location_id, pl_fb.id, _default_loc_id) AS loc_id,
      COALESCE(a.apmt_duration, 0) / 60.0 AS appointment_hrs
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
    SELECT ab.*
    FROM apmt_base ab
    JOIN loc_chairs lc ON lc.loc_id = ab.loc_id
  ),
  -- Distinct working dates per location (the tile's working_dates).
  loc_working_days AS (
    SELECT loc_id, COUNT(DISTINCT work_date) AS day_count
    FROM apmt_scoped
    GROUP BY loc_id
  ),
  -- Σ_loc (chairs × working dates) × 60 — per-hour analogue of the tile's
  -- chairs × total_open_hours. Constant across hours.
  capacity AS (
    SELECT COALESCE(SUM(lc.chairs * lwd.day_count), 0) * 60.0 AS cap_minutes
    FROM loc_chairs lc
    JOIN loc_working_days lwd ON lwd.loc_id = lc.loc_id
  ),
  -- Tile dedup: one row per logical TPI even if Dentally re-synced it.
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
  hours AS (
    SELECT generate_series(0, 23) AS h
  ),
  -- Appointment minutes + count per hour (display only).
  apmt_by_hour AS (
    SELECT ab.h,
           SUM(ab.appointment_hrs * 60.0) AS appt_minutes,
           COUNT(*) AS cnt
    FROM apmt_scoped ab
    GROUP BY ab.h
  ),
  -- Per-appointment effective treatment minutes, capped at the appointment
  -- duration (identical to the tile's tpi_current LEAST() logic), bucketed
  -- by the appointment's start hour.
  appt_effective AS (
    SELECT
      ab.h,
      ab.apmt_id,
      LEAST(
        ab.appointment_hrs * 60.0,
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
    GROUP BY ab.h, ab.apmt_id, ab.appointment_hrs
  ),
  treat_by_hour AS (
    SELECT h, SUM(effective_minutes) AS treat_minutes
    FROM appt_effective
    GROUP BY h
  )
  SELECT
    hrs.h AS hour_slot,
    LPAD(hrs.h::TEXT, 2, '0') || ':00' AS hour_label,
    COALESCE(ab.appt_minutes, 0)::NUMERIC AS appointment_minutes,
    COALESCE(ab.cnt, 0)::BIGINT AS total_appointments,
    cap.cap_minutes AS capacity_minutes,
    CASE
      WHEN cap.cap_minutes > 0
      THEN ROUND(COALESCE(tb.treat_minutes, 0) / cap.cap_minutes * 100, 1)
      ELSE 0
    END AS utilisation_pct
  FROM hours hrs
  CROSS JOIN capacity cap
  LEFT JOIN apmt_by_hour ab ON ab.h = hrs.h
  LEFT JOIN treat_by_hour tb ON tb.h = hrs.h
  ORDER BY hrs.h;
END;
$$;

COMMENT ON FUNCTION get_hourly_chair_utilisation(uuid,uuid,date,date) IS
  'Hourly chair utilisation. Numerator + denominator mirror the Overview '
  'Avg Utilisation tile (get_chair_metrics v20260504000001): appointment-'
  'linked, deduped, per-appointment-capped treatment minutes bucketed by '
  'apmt_start_time hour ÷ chairs×60×working-days. Reconciles with the tile. '
  'Fixed 2026-05-19 (was 700–893%).';
