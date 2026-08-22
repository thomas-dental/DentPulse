-- Chair Recovery Goal feature: persisted recovery targets at the practice
-- level and per-associate (practitioner). Each save produces a history row
-- (NOT an upsert) so users can see the full timeline of goals on the page.
--
-- period_type = 'year' for now (matches the Period Type filter dropdown).
-- actual_fy / planning_fy are the financial-year start years (e.g. 2025 /
-- 2026). Together with location_id (practice scope) they identify the row a
-- user is editing; saving simply inserts another history row.

CREATE TABLE IF NOT EXISTS chair_recovery_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  location_id UUID REFERENCES practice_locations(id) ON DELETE CASCADE,
  period_type TEXT NOT NULL DEFAULT 'year',
  -- Holds either a year ("2025") or a YYYY-MM ("2026-04") depending on
  -- period_type. Kept as TEXT so the same column shape covers both modes.
  actual_period TEXT NOT NULL,
  planning_period TEXT NOT NULL,
  -- The input the user actually changes — a target occupancy uplift %.
  chair_occupancy_pct NUMERIC(5,2) NOT NULL,
  -- Snapshots of the live metrics at the time of save, so history reads
  -- don't have to re-derive a moving total from later-synced data.
  current_chair_time_occupied_hrs NUMERIC(12,2) NOT NULL DEFAULT 0,
  recovery_chair_time_hrs NUMERIC(12,2) NOT NULL DEFAULT 0,
  current_total_revenue NUMERIC(14,2) NOT NULL DEFAULT 0,
  potential_revenue_recovery NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS chair_recovery_goals_org_loc_idx
  ON chair_recovery_goals (organization_id, location_id, created_at DESC);

ALTER TABLE chair_recovery_goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view chair recovery goals for their organization"
  ON chair_recovery_goals FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM user_roles WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert chair recovery goals for their organization"
  ON chair_recovery_goals FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM user_roles WHERE user_id = auth.uid()
    )
  );

-- Associate-level potential goals saved in one batch alongside the practice
-- goal. We don't FK provider_id to providers — associates can be archived /
-- renamed in Dentally and we still want the historical row to read.
CREATE TABLE IF NOT EXISTS associate_potential_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  location_id UUID REFERENCES practice_locations(id) ON DELETE CASCADE,
  period_type TEXT NOT NULL DEFAULT 'year',
  -- Holds either a year ("2025") or a YYYY-MM ("2026-04") depending on
  -- period_type. Kept as TEXT so the same column shape covers both modes.
  actual_period TEXT NOT NULL,
  planning_period TEXT NOT NULL,
  provider_external_id TEXT,
  associate_name TEXT NOT NULL,
  chair_time_target_hrs NUMERIC(12,2) NOT NULL DEFAULT 0,
  target_revenue_per_chair_hour NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS associate_potential_goals_org_loc_idx
  ON associate_potential_goals (organization_id, location_id, created_at DESC);

ALTER TABLE associate_potential_goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view associate potential goals for their organization"
  ON associate_potential_goals FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM user_roles WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert associate potential goals for their organization"
  ON associate_potential_goals FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM user_roles WHERE user_id = auth.uid()
    )
  );
