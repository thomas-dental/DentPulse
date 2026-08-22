-- Align appointment_summary with get_provider_working_hours_by_location and
-- chart_get_production_metrics so Profit Goals avg daily matches Overview Ranking.
--
-- Root cause of remaining mismatch (£6,003.56 vs £6,551.15):
-- maintain_appointment_summary() only counts apmt_state = 'Completed' WITH
-- apmt_patient_name IS NOT NULL — fewer hours → higher avg daily in Profit Goals.
-- chart_get_production_metrics (Overview) and get_provider_working_hours_by_location
-- (Profit Goals specific-location path) both count Completed + Pending + In surgery
-- with NO patient_name filter and deleted_at IS NULL.
--
-- Fix: update trigger and backfill to use the same 3-state, no-patient-filter,
-- deleted_at IS NULL criteria. Also supersedes migration 008 (deleted_at fix).

-- 1. Fix the trigger function
CREATE OR REPLACE FUNCTION maintain_appointment_summary()
RETURNS TRIGGER AS $$
DECLARE
  v_org_id          UUID;
  v_practitioner_id BIGINT;
  v_month           DATE;
  v_provider_id     UUID;
  v_total_hours     NUMERIC;
  v_count           INTEGER;
BEGIN
  -- Determine which slot to refresh
  IF TG_OP = 'DELETE' THEN
    v_org_id          := OLD.organization_id;
    v_practitioner_id := OLD.apmt_practitioner_id;
    v_month           := DATE_TRUNC('month', OLD.apmt_start_time)::DATE;
  ELSE
    v_org_id          := NEW.organization_id;
    v_practitioner_id := NEW.apmt_practitioner_id;
    v_month           := DATE_TRUNC('month', NEW.apmt_start_time)::DATE;
  END IF;

  -- Skip if key data is missing
  IF v_practitioner_id IS NULL OR v_month IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Aggregate working hours for this org + practitioner + month.
  -- Matches get_provider_working_hours_by_location and chart_get_production_metrics:
  --   states: Completed, Pending, In surgery
  --   no patient_name filter (block/admin slots count as provider working time)
  --   deleted_at IS NULL (exclude soft-deleted appointments)
  SELECT
    COALESCE(ROUND(SUM(apmt_duration) / 60.0, 2), 0),
    COUNT(*)
  INTO v_total_hours, v_count
  FROM appointments
  WHERE organization_id      = v_org_id
    AND apmt_practitioner_id = v_practitioner_id
    AND apmt_state           IN ('Completed', 'Pending', 'In surgery')
    AND apmt_duration        IS NOT NULL
    AND apmt_start_time      IS NOT NULL
    AND deleted_at           IS NULL
    AND DATE_TRUNC('month', apmt_start_time)::DATE = v_month;

  -- Look up provider UUID from external_id
  SELECT id INTO v_provider_id
  FROM providers
  WHERE organization_id    = v_org_id
    AND external_id::BIGINT = v_practitioner_id
  LIMIT 1;

  -- Upsert — only refresh auto-calculated columns, preserve manual ones
  INSERT INTO appointment_summary (
    organization_id, practitioner_id, provider_id, month,
    working_duration_hours, appointment_count
  ) VALUES (
    v_org_id, v_practitioner_id, v_provider_id, v_month,
    v_total_hours, v_count
  )
  ON CONFLICT (organization_id, practitioner_id, month) DO UPDATE SET
    working_duration_hours = EXCLUDED.working_duration_hours,
    appointment_count      = EXCLUDED.appointment_count,
    provider_id            = COALESCE(EXCLUDED.provider_id, appointment_summary.provider_id),
    updated_at             = NOW();
    -- NOTE: working_hours_per_day and uda_count are intentionally NOT updated here

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- 2. Rebuild appointment_summary using the corrected criteria.
--    ON CONFLICT UPDATE preserves manual fields (working_hours_per_day, uda_count).
INSERT INTO appointment_summary (
  organization_id, practitioner_id, provider_id, month,
  working_duration_hours, appointment_count
)
SELECT
  a.organization_id,
  a.apmt_practitioner_id,
  p.id                                                          AS provider_id,
  DATE_TRUNC('month', a.apmt_start_time)::DATE                 AS month,
  ROUND(SUM(a.apmt_duration) / 60.0, 2)                        AS working_duration_hours,
  COUNT(*)                                                      AS appointment_count
FROM appointments a
LEFT JOIN providers p
  ON  p.organization_id    = a.organization_id
  AND p.external_id::BIGINT = a.apmt_practitioner_id
WHERE a.apmt_state            IN ('Completed', 'Pending', 'In surgery')
  AND a.apmt_duration         IS NOT NULL
  AND a.apmt_start_time       IS NOT NULL
  AND a.apmt_practitioner_id  IS NOT NULL
  AND a.deleted_at            IS NULL
GROUP BY
  a.organization_id,
  a.apmt_practitioner_id,
  DATE_TRUNC('month', a.apmt_start_time)::DATE,
  p.id
ON CONFLICT (organization_id, practitioner_id, month) DO UPDATE SET
  working_duration_hours = EXCLUDED.working_duration_hours,
  appointment_count      = EXCLUDED.appointment_count,
  provider_id            = COALESCE(EXCLUDED.provider_id, appointment_summary.provider_id),
  updated_at             = NOW();

-- 3. Zero out any org+practitioner+month rows that now have no valid appointments
--    (e.g. all appointments for that slot were soft-deleted or in other states)
UPDATE appointment_summary AS s
SET    working_duration_hours = 0,
       appointment_count      = 0,
       updated_at             = NOW()
WHERE NOT EXISTS (
  SELECT 1
  FROM appointments a
  WHERE a.organization_id      = s.organization_id
    AND a.apmt_practitioner_id = s.practitioner_id
    AND a.apmt_state           IN ('Completed', 'Pending', 'In surgery')
    AND a.apmt_duration        IS NOT NULL
    AND a.apmt_start_time      IS NOT NULL
    AND a.deleted_at           IS NULL
    AND DATE_TRUNC('month', a.apmt_start_time)::DATE = s.month
);
