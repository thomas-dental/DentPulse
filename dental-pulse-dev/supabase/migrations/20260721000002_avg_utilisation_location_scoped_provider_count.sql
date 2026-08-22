-- ============================================================================
-- Fix: Avg Utilisation provider count must be LOCATION-SCOPED PRODUCERS
--
-- Bug: get_avg_utilisation (and its breakdown companion) counted EVERY active
-- provider of the type in the whole ORGANISATION, ignoring p_location_id — while
-- the appointment minutes ARE location-scoped. So a Leiston view divided Leiston's
-- work by Leiston + Woodbridge capacity: 10 dentists instead of the 5 who actually
-- worked at Leiston, understating utilisation (18% vs the correct ~36%) and
-- disagreeing with the "Total Dentists = 5" tile and the Ranking.
--
-- Fix: derive the provider count from the SAME appointment set as the minutes —
-- the DISTINCT providers who produced in that period + location + type. This makes
-- the denominator's provider count equal the producers shown everywhere else on the
-- page (5 for Leiston June 2026), and keeps count + minutes mutually consistent.
--
-- Both functions are redefined identically so they stay in lockstep.
-- ============================================================================

-- ---------- get_avg_utilisation (number only) ----------
CREATE OR REPLACE FUNCTION get_avg_utilisation(
  p_organization_id UUID,
  p_start_date      TIMESTAMPTZ,
  p_end_date        TIMESTAMPTZ,
  p_provider_type   TEXT DEFAULT NULL,
  p_location_id     UUID DEFAULT NULL
)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_hours_per_day  NUMERIC;
  v_total_minutes  NUMERIC;
  v_provider_count INTEGER;
  v_working_days   INTEGER;
BEGIN
  SELECT COALESCE(NULLIF(open_hours_per_day, 0), 8)
  INTO v_hours_per_day FROM organizations WHERE id = p_organization_id;
  IF v_hours_per_day IS NULL THEN v_hours_per_day := 8; END IF;

  SELECT COUNT(*)
  INTO v_working_days
  FROM generate_series(p_start_date::DATE, p_end_date::DATE, '1 day'::interval) AS d
  WHERE EXTRACT(DOW FROM d) NOT IN (0, 6);
  IF v_working_days = 0 THEN RETURN 0; END IF;

  -- Minutes AND provider count from ONE appointment set → location-scoped producers.
  SELECT
    COALESCE(SUM(a.apmt_duration), 0),
    COUNT(DISTINCT LOWER(COALESCE(NULLIF(TRIM(p.email), ''), p.name)))
  INTO v_total_minutes, v_provider_count
  FROM appointments a
  JOIN providers p
    ON p.external_id::BIGINT = a.apmt_practitioner_id
   AND p.organization_id     = a.organization_id
   AND p.is_active            = true
   AND p.deleted_at          IS NULL
   AND (
     p_provider_type IS NULL
     OR (p_provider_type = 'Other' AND p.provider_role NOT IN ('Dentist', 'Therapist', 'Hygienist'))
     OR p.provider_role = p_provider_type
   )
  WHERE a.organization_id = p_organization_id
    AND a.apmt_state       IN ('Completed', 'Pending', 'In surgery', 'Confirmed')
    AND a.apmt_start_time >= p_start_date
    AND a.apmt_start_time <= p_end_date
    AND a.apmt_duration   IS NOT NULL
    AND a.apmt_patient_id IS NOT NULL
    AND a.deleted_at      IS NULL
    AND (p_location_id IS NULL OR a.location_id = p_location_id);

  IF v_provider_count = 0 THEN RETURN 0; END IF;

  RETURN LEAST(
    ROUND((v_total_minutes / (v_provider_count::NUMERIC * v_working_days * v_hours_per_day * 60)) * 100, 1),
    100
  );
END;
$$;

-- ---------- get_avg_utilisation_breakdown (number + inputs) ----------
CREATE OR REPLACE FUNCTION get_avg_utilisation_breakdown(
  p_organization_id UUID,
  p_start_date      TIMESTAMPTZ,
  p_end_date        TIMESTAMPTZ,
  p_provider_type   TEXT DEFAULT NULL,
  p_location_id     UUID DEFAULT NULL
)
RETURNS TABLE (
  utilisation    NUMERIC,
  total_minutes  NUMERIC,
  provider_count INTEGER,
  working_days   INTEGER,
  hours_per_day  NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_hours_per_day  NUMERIC;
  v_total_minutes  NUMERIC;
  v_provider_count INTEGER;
  v_working_days   INTEGER;
BEGIN
  SELECT COALESCE(NULLIF(open_hours_per_day, 0), 8)
  INTO v_hours_per_day FROM organizations WHERE id = p_organization_id;
  IF v_hours_per_day IS NULL THEN v_hours_per_day := 8; END IF;

  SELECT COUNT(*)
  INTO v_working_days
  FROM generate_series(p_start_date::DATE, p_end_date::DATE, '1 day'::interval) AS d
  WHERE EXTRACT(DOW FROM d) NOT IN (0, 6);

  SELECT
    COALESCE(SUM(a.apmt_duration), 0),
    COUNT(DISTINCT LOWER(COALESCE(NULLIF(TRIM(p.email), ''), p.name)))
  INTO v_total_minutes, v_provider_count
  FROM appointments a
  JOIN providers p
    ON p.external_id::BIGINT = a.apmt_practitioner_id
   AND p.organization_id     = a.organization_id
   AND p.is_active            = true
   AND p.deleted_at          IS NULL
   AND (
     p_provider_type IS NULL
     OR (p_provider_type = 'Other' AND p.provider_role NOT IN ('Dentist', 'Therapist', 'Hygienist'))
     OR p.provider_role = p_provider_type
   )
  WHERE a.organization_id = p_organization_id
    AND a.apmt_state       IN ('Completed', 'Pending', 'In surgery', 'Confirmed')
    AND a.apmt_start_time >= p_start_date
    AND a.apmt_start_time <= p_end_date
    AND a.apmt_duration   IS NOT NULL
    AND a.apmt_patient_id IS NOT NULL
    AND a.deleted_at      IS NULL
    AND (p_location_id IS NULL OR a.location_id = p_location_id);

  utilisation    := 0;
  total_minutes  := COALESCE(v_total_minutes, 0);
  provider_count := COALESCE(v_provider_count, 0);
  working_days   := COALESCE(v_working_days, 0);
  hours_per_day  := v_hours_per_day;

  IF v_provider_count > 0 AND v_working_days > 0 THEN
    utilisation := LEAST(
      ROUND((v_total_minutes / (v_provider_count::NUMERIC * v_working_days * v_hours_per_day * 60)) * 100, 1),
      100
    );
  END IF;

  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION get_avg_utilisation(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION get_avg_utilisation_breakdown(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, UUID) TO authenticated, anon;
