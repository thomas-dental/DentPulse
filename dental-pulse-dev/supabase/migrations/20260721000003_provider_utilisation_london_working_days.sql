-- Fix the working-days count in get_provider_utilisation.
--
-- The frontend passes Europe/London day boundaries as UTC instants — e.g. the start
-- of 1 Jul 2026 (BST) is 2026-06-30T23:00:00Z. The function counted working days with
-- `p_start_date::DATE`, which casts that instant in the SERVER (UTC) timezone and so
-- lands on 30 Jun. When the prior day is a weekday (30 Jun 2026 is a Tuesday) it was
-- counted as an extra working day: July became 24 working days instead of 23, which
-- inflated the denominator and understated utilisation (e.g. Charles Greensmith /
-- Leiston read 21.4% when the true figure is 22.4% = 2,160 min ÷ (23 × 7 × 60) × 100).
--
-- Cast the bounds AT TIME ZONE 'Europe/London' before ::DATE so the day count matches
-- the intended local window (23 working days for July). The appointment-minutes filter
-- is unchanged — it already compares the raw timestamptz instants, which is correct.
CREATE OR REPLACE FUNCTION get_provider_utilisation(
  p_organization_id  UUID,
  p_practitioner_id  BIGINT,
  p_start_date       TIMESTAMPTZ,
  p_end_date         TIMESTAMPTZ,
  p_location_id      UUID DEFAULT NULL
)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_hours_per_day  NUMERIC;
  v_total_minutes  NUMERIC;
  v_working_days   INTEGER;
BEGIN
  -- Org hours per day setting
  SELECT COALESCE(NULLIF(open_hours_per_day, 0), 8)
  INTO   v_hours_per_day
  FROM   organizations
  WHERE  id = p_organization_id;

  IF v_hours_per_day IS NULL THEN v_hours_per_day := 8; END IF;

  -- Mon–Fri working days in range, counted in Europe/London so the UK-midnight
  -- boundary instants map to the intended local dates (see header comment).
  SELECT COUNT(*)
  INTO   v_working_days
  FROM   generate_series(
           (p_start_date AT TIME ZONE 'Europe/London')::DATE,
           (p_end_date   AT TIME ZONE 'Europe/London')::DATE,
           '1 day'::INTERVAL
         ) AS d
  WHERE  EXTRACT(DOW FROM d) NOT IN (0, 6);

  IF v_working_days = 0 THEN RETURN 0; END IF;

  -- Sum appointment minutes (unchanged — instants compared directly)
  SELECT COALESCE(SUM(apmt_duration), 0)
  INTO   v_total_minutes
  FROM   appointments
  WHERE  organization_id      = p_organization_id
    AND  apmt_practitioner_id = p_practitioner_id
    AND  apmt_state           IN ('Completed', 'Pending', 'In surgery', 'Confirmed')
    AND  apmt_start_time     >= p_start_date
    AND  apmt_start_time     <= p_end_date
    AND  apmt_duration        IS NOT NULL
    AND  apmt_patient_id      IS NOT NULL
    AND  deleted_at           IS NULL
    AND  (p_location_id IS NULL OR location_id = p_location_id);

  RETURN LEAST(
    ROUND(
      (v_total_minutes / (v_working_days::NUMERIC * v_hours_per_day * 60)) * 100,
      1
    ),
    100
  );
END;
$$;
