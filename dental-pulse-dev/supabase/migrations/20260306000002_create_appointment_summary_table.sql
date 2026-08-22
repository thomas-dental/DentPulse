-- Create appointment_summary table
-- Stores aggregated working hours per provider per month, auto-maintained by trigger.
-- Also stores manually entered fields: working_hours_per_day, uda_count.

CREATE TABLE IF NOT EXISTS appointment_summary (
  id                      UUID          NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id         UUID          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider_id             UUID          REFERENCES providers(id) ON DELETE SET NULL,
  practitioner_id         BIGINT        NOT NULL,  -- appointments.apmt_practitioner_id (Dentally external ID)
  month                   DATE          NOT NULL,  -- first day of month, e.g. 2026-03-01
  working_duration_hours  NUMERIC(10,2) NOT NULL DEFAULT 0,  -- auto-calculated from appointments
  working_hours_per_day   NUMERIC(5,2)  NULL,                -- manually entered
  uda_count               NUMERIC(10,2) NULL,                -- manually entered
  appointment_count       INTEGER       NOT NULL DEFAULT 0,  -- auto-calculated
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT appointment_summary_unique UNIQUE (organization_id, practitioner_id, month)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_appointment_summary_org_month
  ON appointment_summary (organization_id, month);

CREATE INDEX IF NOT EXISTS idx_appointment_summary_provider
  ON appointment_summary (provider_id);

CREATE INDEX IF NOT EXISTS idx_appointment_summary_org_practitioner_month
  ON appointment_summary (organization_id, practitioner_id, month);

-- Performance index on appointments to support the trigger's aggregate query
CREATE INDEX IF NOT EXISTS idx_appointments_practitioner_month
  ON appointments (organization_id, apmt_practitioner_id, apmt_start_time)
  WHERE apmt_state = 'Completed' AND apmt_duration IS NOT NULL;

-- updated_at auto-trigger
CREATE TRIGGER appointment_summary_updated_at
  BEFORE UPDATE ON appointment_summary
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ─────────────────────────────────────────────────────────────────────────────
-- Trigger function: re-aggregate one org+practitioner+month after each
-- appointment INSERT / UPDATE / DELETE.
-- Only updates the auto-calculated fields; never overwrites manual ones.
-- ─────────────────────────────────────────────────────────────────────────────
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
  SELECT
    COALESCE(ROUND(SUM(apmt_duration) / 60.0, 2), 0),
    COUNT(*)
  INTO v_total_hours, v_count
  FROM appointments
  WHERE organization_id  = v_org_id
    AND apmt_practitioner_id = v_practitioner_id
    AND apmt_state        = 'Completed'
    AND apmt_duration     IS NOT NULL
    AND apmt_patient_name IS NOT NULL
    AND apmt_start_time   IS NOT NULL
    AND DATE_TRUNC('month', apmt_start_time) = v_month;

  -- Look up provider UUID from external_id (external_id is integer, cast both sides)
  SELECT id INTO v_provider_id
  FROM providers
  WHERE organization_id  = v_org_id
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

-- Attach trigger to appointments table
CREATE TRIGGER sync_appointment_summary
  AFTER INSERT OR UPDATE OR DELETE ON appointments
  FOR EACH ROW EXECUTE FUNCTION maintain_appointment_summary();

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE appointment_summary ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their org appointment_summary"
  ON appointment_summary
  FOR ALL
  USING (
    organization_id IN (
      SELECT current_organization_id FROM profiles WHERE id = auth.uid()
      UNION
      SELECT organization_id FROM user_roles WHERE user_id = auth.uid()
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill from existing appointments
-- ─────────────────────────────────────────────────────────────────────────────
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
  ON  p.organization_id   = a.organization_id
  AND p.external_id::BIGINT = a.apmt_practitioner_id
WHERE a.apmt_state        = 'Completed'
  AND a.apmt_duration     IS NOT NULL
  AND a.apmt_patient_name IS NOT NULL
  AND a.apmt_start_time   IS NOT NULL
  AND a.apmt_practitioner_id IS NOT NULL
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
