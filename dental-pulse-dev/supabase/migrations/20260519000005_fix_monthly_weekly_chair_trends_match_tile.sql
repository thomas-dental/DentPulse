-- Fix get_monthly_chair_trends + get_weekly_chair_pattern so Occupancy /
-- Utilisation match the Overview tiles (get_chair_metrics v20260504000001)
-- and the on-screen formula:
--
--   Available hrs = chairs × opening hrs/day (each location's operating
--                   hours per weekday) × working days (distinct dates that
--                   had appointments) — bucketed per month / per weekday.
--   Occupancy %   = Σ appointment hrs (apmt_duration/60) ÷ Available hrs.
--   Utilisation % = Σ per-appointment LEAST(appt_duration, Σ treatment
--                   template minutes via appointments →
--                   treatment_appointments → tpi_dedup → treatments)
--                   ÷ Available hrs.
--
-- The old versions (20260501000002) showed 181.8% occupancy / 1622.9%
-- utilisation because they used RAW uncapped treatment template minutes by
-- tpi_completed_at over (Mon–Fri calendar count × avg daily hours). This
-- rewrite mirrors the tile's CTEs exactly (loc, loc_dow_hours, apmt_base,
-- working_dates, tpi_dedup, per-appointment LEAST cap), only changing the
-- GROUP BY to month / weekday. Return signatures unchanged — no frontend
-- edits needed. By construction these reconcile with the Overview tiles.

-- ============================================================
-- 1. get_monthly_chair_trends
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
  loc_dow_hours AS (
    SELECT
      l.loc_id, d.dow,
      CASE
        WHEN l.op_hours IS NULL THEN l.fallback_daily_hours
        WHEN (l.op_hours -> d.day_name) IS NULL THEN 0
        WHEN COALESCE((l.op_hours -> d.day_name ->> 'closed')::boolean, false) THEN 0
        WHEN (l.op_hours -> d.day_name ->> 'open') IS NULL
          OR (l.op_hours -> d.day_name ->> 'close') IS NULL THEN 0
        ELSE GREATEST(0, EXTRACT(EPOCH FROM
          (l.op_hours -> d.day_name ->> 'close')::time
          - (l.op_hours -> d.day_name ->> 'open')::time) / 3600.0)
      END AS hours_per_day
    FROM loc l CROSS JOIN dow_map d
  ),
  apmt_base AS (
    SELECT
      a.apmt_id,
      DATE_TRUNC('month', a.apmt_start_time)::DATE AS m_start,
      DATE(a.apmt_start_time) AS work_date,
      EXTRACT(DOW FROM a.apmt_start_time)::INTEGER AS dow,
      COALESCE(a.apmt_duration, 0) / 60.0 AS appointment_hrs,
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
        AND pl2.organization_id = _organization_id AND pl2.deleted_at IS NULL
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
    SELECT ab.* FROM apmt_base ab JOIN loc lc ON lc.loc_id = ab.loc_id
  ),
  working_dates AS (
    SELECT DISTINCT loc_id, work_date, m_start, dow FROM apmt_scoped
  ),
  avail_by_month AS (
    SELECT wd.m_start,
           SUM(lc.chairs * ldh.hours_per_day) AS available_hours
    FROM working_dates wd
    JOIN loc lc ON lc.loc_id = wd.loc_id
    JOIN loc_dow_hours ldh ON ldh.loc_id = wd.loc_id AND ldh.dow = wd.dow
    GROUP BY wd.m_start
  ),
  apmt_by_month AS (
    SELECT m_start, SUM(appointment_hrs) AS appt_hours, COUNT(*) AS cnt
    FROM apmt_scoped GROUP BY m_start
  ),
  tpi_dedup AS (
    SELECT DISTINCT ON (
      COALESCE(tpi.tpi_id::TEXT,
        COALESCE(tpi.tpi_patient_id::TEXT,'') || '|' ||
        COALESCE(tpi.tpi_completed_at::TEXT,'') || '|' ||
        COALESCE(tpi.tpi_price::TEXT,'') || '|' ||
        COALESCE(tpi.tpi_treatment_id::TEXT,'') || '|' ||
        COALESCE(tpi.tpi_invoice_id::TEXT,''))
    )
      tpi.tpi_treatment_appointment_id, tpi.tpi_treatment_id
    FROM treatment_plan_items tpi
    WHERE tpi.organization_id = _organization_id
      AND tpi.deleted_at IS NULL
      AND tpi.tpi_treatment_appointment_id IS NOT NULL
    ORDER BY
      COALESCE(tpi.tpi_id::TEXT,
        COALESCE(tpi.tpi_patient_id::TEXT,'') || '|' ||
        COALESCE(tpi.tpi_completed_at::TEXT,'') || '|' ||
        COALESCE(tpi.tpi_price::TEXT,'') || '|' ||
        COALESCE(tpi.tpi_treatment_id::TEXT,'') || '|' ||
        COALESCE(tpi.tpi_invoice_id::TEXT,'')),
      tpi.created_at ASC
  ),
  treat_by_month AS (
    SELECT capped.m_start, SUM(capped.effective_hrs) AS treat_hours
    FROM (
      SELECT ab.m_start, ab.apmt_id,
             LEAST(ab.appointment_hrs,
                   SUM(COALESCE(t.duration_minutes,0)) / 60.0) AS effective_hrs
      FROM apmt_scoped ab
      JOIN treatment_appointments ta
        ON ta.ta_appointment_id = ab.apmt_id
        AND ta.organization_id = _organization_id AND ta.deleted_at IS NULL
      JOIN tpi_dedup td ON td.tpi_treatment_appointment_id = ta.ta_id
      LEFT JOIN treatments t
        ON t.external_id = td.tpi_treatment_id::INTEGER
        AND t.organization_id = _organization_id AND t.deleted_at IS NULL
      GROUP BY ab.m_start, ab.apmt_id, ab.appointment_hrs
    ) capped
    GROUP BY capped.m_start
  ),
  months AS (
    SELECT DATE_TRUNC('month', d)::DATE AS m_start,
           TO_CHAR(d, 'Mon YYYY') AS m_label
    FROM generate_series(
      DATE_TRUNC('month', _start_date::TIMESTAMP),
      DATE_TRUNC('month', (_end_date - INTERVAL '1 day')::TIMESTAMP),
      '1 month') d
  )
  SELECT
    m.m_start AS month_start,
    m.m_label::TEXT AS month_label,
    COALESCE(am.appt_hours, 0) AS appointment_hours,
    COALESCE(tm.treat_hours, 0) AS treatment_hours,
    COALESCE(am.cnt, 0)::BIGINT AS appointment_count,
    COALESCE(av.available_hours, 0) AS available_hours,
    CASE WHEN COALESCE(av.available_hours,0) > 0
      THEN ROUND(COALESCE(am.appt_hours,0) / av.available_hours * 100, 1)
      ELSE 0 END AS occupancy_pct,
    CASE WHEN COALESCE(av.available_hours,0) > 0
      THEN ROUND(COALESCE(tm.treat_hours,0) / av.available_hours * 100, 1)
      ELSE 0 END AS utilisation_pct
  FROM months m
  LEFT JOIN avail_by_month av ON av.m_start = m.m_start
  LEFT JOIN apmt_by_month  am ON am.m_start = m.m_start
  LEFT JOIN treat_by_month tm ON tm.m_start = m.m_start
  ORDER BY m.m_start;
END;
$$;

-- ============================================================
-- 2. get_weekly_chair_pattern
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
  days(iso_dow, dname) AS (
    VALUES (1,'Mon'),(2,'Tue'),(3,'Wed'),(4,'Thu'),(5,'Fri'),(6,'Sat'),(7,'Sun')
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
  loc_dow_hours AS (
    SELECT
      l.loc_id, d.dow,
      CASE
        WHEN l.op_hours IS NULL THEN l.fallback_daily_hours
        WHEN (l.op_hours -> d.day_name) IS NULL THEN 0
        WHEN COALESCE((l.op_hours -> d.day_name ->> 'closed')::boolean, false) THEN 0
        WHEN (l.op_hours -> d.day_name ->> 'open') IS NULL
          OR (l.op_hours -> d.day_name ->> 'close') IS NULL THEN 0
        ELSE GREATEST(0, EXTRACT(EPOCH FROM
          (l.op_hours -> d.day_name ->> 'close')::time
          - (l.op_hours -> d.day_name ->> 'open')::time) / 3600.0)
      END AS hours_per_day
    FROM loc l CROSS JOIN dow_map d
  ),
  apmt_base AS (
    SELECT
      a.apmt_id,
      DATE(a.apmt_start_time) AS work_date,
      EXTRACT(DOW FROM a.apmt_start_time)::INTEGER AS dow,
      EXTRACT(ISODOW FROM a.apmt_start_time)::INTEGER AS iso_dow,
      COALESCE(a.apmt_duration, 0) / 60.0 AS appointment_hrs,
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
        AND pl2.organization_id = _organization_id AND pl2.deleted_at IS NULL
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
    SELECT ab.* FROM apmt_base ab JOIN loc lc ON lc.loc_id = ab.loc_id
  ),
  working_dates AS (
    SELECT DISTINCT loc_id, work_date, dow, iso_dow FROM apmt_scoped
  ),
  avail_by_dow AS (
    SELECT wd.iso_dow,
           SUM(lc.chairs * ldh.hours_per_day) AS available_hours
    FROM working_dates wd
    JOIN loc lc ON lc.loc_id = wd.loc_id
    JOIN loc_dow_hours ldh ON ldh.loc_id = wd.loc_id AND ldh.dow = wd.dow
    GROUP BY wd.iso_dow
  ),
  apmt_by_dow AS (
    SELECT iso_dow, SUM(appointment_hrs) AS appt_hours, COUNT(*) AS cnt
    FROM apmt_scoped GROUP BY iso_dow
  ),
  tpi_dedup AS (
    SELECT DISTINCT ON (
      COALESCE(tpi.tpi_id::TEXT,
        COALESCE(tpi.tpi_patient_id::TEXT,'') || '|' ||
        COALESCE(tpi.tpi_completed_at::TEXT,'') || '|' ||
        COALESCE(tpi.tpi_price::TEXT,'') || '|' ||
        COALESCE(tpi.tpi_treatment_id::TEXT,'') || '|' ||
        COALESCE(tpi.tpi_invoice_id::TEXT,''))
    )
      tpi.tpi_treatment_appointment_id, tpi.tpi_treatment_id
    FROM treatment_plan_items tpi
    WHERE tpi.organization_id = _organization_id
      AND tpi.deleted_at IS NULL
      AND tpi.tpi_treatment_appointment_id IS NOT NULL
    ORDER BY
      COALESCE(tpi.tpi_id::TEXT,
        COALESCE(tpi.tpi_patient_id::TEXT,'') || '|' ||
        COALESCE(tpi.tpi_completed_at::TEXT,'') || '|' ||
        COALESCE(tpi.tpi_price::TEXT,'') || '|' ||
        COALESCE(tpi.tpi_treatment_id::TEXT,'') || '|' ||
        COALESCE(tpi.tpi_invoice_id::TEXT,'')),
      tpi.created_at ASC
  ),
  treat_by_dow AS (
    SELECT capped.iso_dow, SUM(capped.effective_hrs) AS treat_hours
    FROM (
      SELECT ab.iso_dow, ab.apmt_id,
             LEAST(ab.appointment_hrs,
                   SUM(COALESCE(t.duration_minutes,0)) / 60.0) AS effective_hrs
      FROM apmt_scoped ab
      JOIN treatment_appointments ta
        ON ta.ta_appointment_id = ab.apmt_id
        AND ta.organization_id = _organization_id AND ta.deleted_at IS NULL
      JOIN tpi_dedup td ON td.tpi_treatment_appointment_id = ta.ta_id
      LEFT JOIN treatments t
        ON t.external_id = td.tpi_treatment_id::INTEGER
        AND t.organization_id = _organization_id AND t.deleted_at IS NULL
      GROUP BY ab.iso_dow, ab.apmt_id, ab.appointment_hrs
    ) capped
    GROUP BY capped.iso_dow
  )
  SELECT
    d.iso_dow AS day_of_week,
    d.dname::TEXT AS day_name,
    COALESCE(ad.appt_hours, 0) AS appointment_hours,
    COALESCE(tdw.treat_hours, 0) AS treatment_hours,
    COALESCE(ad.cnt, 0)::BIGINT AS appointment_count,
    COALESCE(av.available_hours, 0) AS available_hours,
    CASE WHEN COALESCE(av.available_hours,0) > 0
      THEN ROUND(COALESCE(ad.appt_hours,0) / av.available_hours * 100, 1)
      ELSE 0 END AS occupancy_pct,
    CASE WHEN COALESCE(av.available_hours,0) > 0
      THEN ROUND(COALESCE(tdw.treat_hours,0) / av.available_hours * 100, 1)
      ELSE 0 END AS utilisation_pct
  FROM days d
  LEFT JOIN avail_by_dow av ON av.iso_dow = d.iso_dow
  LEFT JOIN apmt_by_dow  ad ON ad.iso_dow = d.iso_dow
  LEFT JOIN treat_by_dow tdw ON tdw.iso_dow = d.iso_dow
  ORDER BY d.iso_dow;
END;
$$;

COMMENT ON FUNCTION get_monthly_chair_trends(uuid,uuid,date,date) IS
  'Monthly Occupancy/Utilisation. Mirrors get_chair_metrics v20260504000001 '
  '(apmt_base + tpi_dedup + per-appointment LEAST cap, available = chairs × '
  'operating_hours over distinct working dates), grouped by month. Reconciles '
  'with the Overview tiles. Fixed 2026-05-19 (was 181.8%/1622.9%).';
COMMENT ON FUNCTION get_weekly_chair_pattern(uuid,uuid,date,date) IS
  'Weekday Occupancy/Utilisation. Same tile-aligned logic as '
  'get_monthly_chair_trends, grouped by ISO weekday. Fixed 2026-05-19.';
