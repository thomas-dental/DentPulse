-- Per-location chair settings for the Chairs module
CREATE TABLE IF NOT EXISTS chair_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES practice_locations(id) ON DELETE CASCADE,
  number_of_chairs INTEGER NOT NULL DEFAULT 3,
  clinic_opening_hours_per_day NUMERIC(4,1) NOT NULL DEFAULT 8,
  clinic_working_weeks_per_year INTEGER NOT NULL DEFAULT 46,
  clinic_working_days_per_year INTEGER NOT NULL DEFAULT 230,
  clinic_working_days_per_week INTEGER NOT NULL DEFAULT 5,
  industry_benchmark_occupancy NUMERIC(5,1),
  benchmark_revenue_per_chair_per_hour NUMERIC(10,2) NOT NULL DEFAULT 300,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id),
  UNIQUE(organization_id, location_id)
);

-- RLS policies
ALTER TABLE chair_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view chair settings for their organization"
  ON chair_settings FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM user_roles WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert chair settings for their organization"
  ON chair_settings FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM user_roles WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update chair settings for their organization"
  ON chair_settings FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM user_roles WHERE user_id = auth.uid()
    )
  );

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_chair_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER chair_settings_updated_at
  BEFORE UPDATE ON chair_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_chair_settings_updated_at();
