-- Update appointment_summary to include Pending + Completed + In surgery states.
-- Previously only 'Completed' was counted; Dentally's "Total hours" includes all three.

-- ============================================================
-- 1. Update maintain_appointment_summary trigger function
-- ============================================================
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
  IF TG_OP = 'DELETE' THEN
    v_org_id          := OLD.organization_id;
    v_practitioner_id := OLD.apmt_practitioner_id;
    v_month           := DATE_TRUNC('month', OLD.apmt_start_time)::DATE;
  ELSE
    v_org_id          := NEW.organization_id;
    v_practitioner_id := NEW.apmt_practitioner_id;
    v_month           := DATE_TRUNC('month', NEW.apmt_start_time)::DATE;
  END IF;

  IF v_practitioner_id IS NULL OR v_month IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT
    COALESCE(ROUND(SUM(apmt_duration) / 60.0, 2), 0),
    COUNT(*)
  INTO v_total_hours, v_count
  FROM appointments
  WHERE organization_id    = v_org_id
    AND apmt_practitioner_id = v_practitioner_id
    AND apmt_state           IN ('Completed', 'Pending', 'In surgery')
    AND apmt_duration        IS NOT NULL
    AND apmt_patient_id      IS NOT NULL
    AND apmt_start_time      IS NOT NULL
    AND deleted_at           IS NULL
    AND DATE_TRUNC('month', apmt_start_time) = v_month;

  SELECT id INTO v_provider_id
  FROM providers
  WHERE organization_id   = v_org_id
    AND external_id::BIGINT = v_practitioner_id
  LIMIT 1;

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

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- 2. Backfill appointment_summary with Completed + Pending + In surgery
-- ============================================================
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
WHERE a.apmt_state           IN ('Completed', 'Pending', 'In surgery')
  AND a.apmt_duration        IS NOT NULL
  AND a.apmt_patient_id      IS NOT NULL
  AND a.apmt_start_time      IS NOT NULL
  AND a.apmt_practitioner_id IS NOT NULL
  AND a.deleted_at           IS NULL
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
