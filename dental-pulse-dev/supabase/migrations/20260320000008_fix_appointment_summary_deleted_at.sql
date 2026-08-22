-- Fix maintain_appointment_summary trigger: exclude soft-deleted appointments.
--
-- Root cause of Profit Goals vs Overview avg daily mismatch:
-- maintain_appointment_summary() aggregates ALL Completed appointments with
-- apmt_patient_name IS NOT NULL but DOES NOT filter deleted_at IS NULL.
-- Soft-deleted appointments (deleted_at IS NOT NULL) are counted in appointment_summary
-- but excluded from live queries (chart_get_production_metrics, get_provider_working_hours_by_location).
-- This inflates working_duration_hours → lower avg_daily_production in Profit Goals.
--
-- Fix: add AND deleted_at IS NULL to both the trigger aggregation and the backfill.
-- Then rebuild appointment_summary to reflect actual non-deleted appointment hours.

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

  -- Aggregate completed appointments for this org + practitioner + month
  -- NOTE: deleted_at IS NULL excludes soft-deleted appointments
  SELECT
    COALESCE(ROUND(SUM(apmt_duration) / 60.0, 2), 0),
    COUNT(*)
  INTO v_total_hours, v_count
  FROM appointments
  WHERE organization_id    = v_org_id
    AND apmt_practitioner_id = v_practitioner_id
    AND apmt_state         = 'Completed'
    AND apmt_duration      IS NOT NULL
    AND apmt_patient_name  IS NOT NULL
    AND apmt_start_time    IS NOT NULL
    AND deleted_at         IS NULL
    AND DATE_TRUNC('month', apmt_start_time) = v_month;

  -- Look up provider UUID from external_id (external_id is integer, cast both sides)
  SELECT id INTO v_provider_id
  FROM providers
  WHERE organization_id   = v_org_id
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

-- 2. Rebuild appointment_summary from scratch (excluding soft-deleted appointments)
-- Truncate and re-backfill to clear stale data. Manual fields (working_hours_per_day,
-- uda_count) will be lost — but these are the auto-calculated rows causing the mismatch,
-- so clearing them is correct.
--
-- To preserve manual entries, we use an UPDATE-only approach:
-- Re-aggregate and update working_duration_hours + appointment_count for all existing rows,
-- then insert any new org+practitioner+month combinations that were previously over-counted
-- and are now zero (they'll be deleted by the zero-hours cleanup below).

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
WHERE a.apmt_state         = 'Completed'
  AND a.apmt_duration      IS NOT NULL
  AND a.apmt_patient_name  IS NOT NULL
  AND a.apmt_start_time    IS NOT NULL
  AND a.apmt_practitioner_id IS NOT NULL
  AND a.deleted_at         IS NULL
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

-- 3. Zero out any rows whose org+practitioner+month now has no valid appointments
--    (i.e., all appointments for that slot were soft-deleted after the last backfill)
UPDATE appointment_summary AS s
SET    working_duration_hours = 0,
       appointment_count      = 0,
       updated_at             = NOW()
WHERE NOT EXISTS (
  SELECT 1
  FROM appointments a
  WHERE a.organization_id     = s.organization_id
    AND a.apmt_practitioner_id = s.practitioner_id
    AND a.apmt_state          = 'Completed'
    AND a.apmt_duration       IS NOT NULL
    AND a.apmt_patient_name   IS NOT NULL
    AND a.apmt_start_time     IS NOT NULL
    AND a.deleted_at          IS NULL
    AND DATE_TRUNC('month', a.apmt_start_time)::DATE = s.month
);
