-- ============================================================================
-- get_avg_utilisation_breakdown
--
-- Companion to get_avg_utilisation (20260324000005). Returns the SAME utilisation
-- %, PLUS the four intermediate values behind it, so the "Avg Utilisation Formula"
-- help dialog can show the practice's REAL numbers instead of a static worked
-- example.
--
-- The computation is byte-identical to get_avg_utilisation (same provider dedup,
-- same 4 appointment states, same patient-only + active-provider join, same
-- Mon–Fri working-day count, same org hours/day). Keeping the maths in lockstep is
-- the whole point: the breakdown must reconcile to the tile's % exactly.
-- ============================================================================

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
  -- Org hours per day (default 8) — identical to get_avg_utilisation.
  SELECT COALESCE(NULLIF(open_hours_per_day, 0), 8)
  INTO v_hours_per_day
  FROM organizations
  WHERE id = p_organization_id;
  IF v_hours_per_day IS NULL THEN v_hours_per_day := 8; END IF;

  -- Unique active providers of the type (deduped by email).
  SELECT COUNT(DISTINCT LOWER(COALESCE(NULLIF(TRIM(email), ''), name)))
  INTO v_provider_count
  FROM providers
  WHERE organization_id = p_organization_id
    AND is_active        = true
    AND deleted_at       IS NULL
    AND (
      p_provider_type IS NULL
      OR (p_provider_type = 'Other' AND provider_role NOT IN ('Dentist', 'Therapist', 'Hygienist'))
      OR provider_role = p_provider_type
    );

  -- Mon–Fri working days in range.
  SELECT COUNT(*)
  INTO v_working_days
  FROM generate_series(p_start_date::DATE, p_end_date::DATE, '1 day'::interval) AS d
  WHERE EXTRACT(DOW FROM d) NOT IN (0, 6);

  -- Appointment minutes (4 active states, patient only, active-provider join, location).
  SELECT COALESCE(SUM(a.apmt_duration), 0)
  INTO v_total_minutes
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

  -- Same guard + same capped % as get_avg_utilisation.
  IF v_provider_count > 0 AND v_working_days > 0 THEN
    utilisation := LEAST(
      ROUND((v_total_minutes / (v_provider_count::NUMERIC * v_working_days * v_hours_per_day * 60)) * 100, 1),
      100
    );
  END IF;

  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION get_avg_utilisation_breakdown(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_avg_utilisation_breakdown(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, UUID) TO anon;

COMMENT ON FUNCTION get_avg_utilisation_breakdown IS
'Same utilisation % as get_avg_utilisation, plus its intermediate values
(total_minutes, provider_count, working_days, hours_per_day) so the UI can show
the real formula inputs. Maths kept identical to get_avg_utilisation.';
