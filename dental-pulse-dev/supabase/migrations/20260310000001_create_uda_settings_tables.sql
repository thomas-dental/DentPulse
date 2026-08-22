-- ─────────────────────────────────────────────────────────────────────────────
-- UDA Goals Settings Tables
-- Two tables:
--   1. uda_settings  - FY-level NHS contract settings per org
--   2. uda_targets   - Per-provider UDA targets (yearly & monthly)
-- ─────────────────────────────────────────────────────────────────────────────


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. uda_settings
--    Stores NHS contract value & total UDA obligation per org per financial year.
--    uda_rate is auto-computed as nhs_contract_value / total_uda_obligation.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS uda_settings (
  id                    UUID          NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id       UUID          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  financial_year        INTEGER       NOT NULL,   -- e.g. 2025 = FY 01-Apr-2025 to 31-Mar-2026
  nhs_contract_value    NUMERIC(15,2) NULL,
  total_uda_obligation  NUMERIC(10,2) NULL,
  uda_rate              NUMERIC(10,4) GENERATED ALWAYS AS (
                          CASE
                            WHEN total_uda_obligation IS NOT NULL
                             AND total_uda_obligation > 0
                            THEN ROUND(nhs_contract_value / total_uda_obligation, 4)
                            ELSE NULL
                          END
                        ) STORED,                -- read-only, auto-computed
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT uda_settings_unique UNIQUE (organization_id, financial_year)
);

CREATE INDEX IF NOT EXISTS idx_uda_settings_org_fy
  ON uda_settings (organization_id, financial_year);

CREATE TRIGGER uda_settings_updated_at
  BEFORE UPDATE ON uda_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE uda_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their org uda_settings"
  ON uda_settings FOR ALL
  USING (
    organization_id IN (
      SELECT current_organization_id FROM profiles WHERE id = auth.uid()
      UNION
      SELECT organization_id FROM user_roles WHERE user_id = auth.uid()
    )
  );

COMMENT ON TABLE uda_settings IS
  'NHS contract-level UDA settings per organization per financial year.';
COMMENT ON COLUMN uda_settings.financial_year IS
  'Start year of the financial year. 2025 = 01-Apr-2025 to 31-Mar-2026.';
COMMENT ON COLUMN uda_settings.uda_rate IS
  'Auto-computed: nhs_contract_value / total_uda_obligation. Read-only.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. uda_targets
--    Per-provider UDA targets for both yearly and monthly periods.
--    period_type = 'yearly'  → period = FY start date (e.g. 2025-04-01)
--    period_type = 'monthly' → period = first day of month (e.g. 2026-03-01)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TYPE uda_period_type AS ENUM ('yearly', 'monthly');

CREATE TABLE IF NOT EXISTS uda_targets (
  id               UUID             NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id  UUID             NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider_id      UUID             NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  period_type      uda_period_type  NOT NULL,  -- 'yearly' or 'monthly'
  period           DATE             NOT NULL,  -- yearly: 2025-04-01, monthly: 2026-03-01
  uda_target       NUMERIC(10,2)    NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ      NOT NULL DEFAULT NOW(),

  CONSTRAINT uda_targets_unique UNIQUE (organization_id, provider_id, period_type, period)
);

CREATE INDEX IF NOT EXISTS idx_uda_targets_org_period
  ON uda_targets (organization_id, period_type, period);

CREATE INDEX IF NOT EXISTS idx_uda_targets_provider
  ON uda_targets (provider_id);

CREATE TRIGGER uda_targets_updated_at
  BEFORE UPDATE ON uda_targets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE uda_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their org uda_targets"
  ON uda_targets FOR ALL
  USING (
    organization_id IN (
      SELECT current_organization_id FROM profiles WHERE id = auth.uid()
      UNION
      SELECT organization_id FROM user_roles WHERE user_id = auth.uid()
    )
  );

COMMENT ON TABLE uda_targets IS
  'Per-provider UDA targets for yearly and monthly periods.';
COMMENT ON COLUMN uda_targets.period_type IS
  'yearly = full financial year target, monthly = single month target.';
COMMENT ON COLUMN uda_targets.period IS
  'First day of the period. yearly: FY start (e.g. 2025-04-01), monthly: month start (e.g. 2026-03-01).';
