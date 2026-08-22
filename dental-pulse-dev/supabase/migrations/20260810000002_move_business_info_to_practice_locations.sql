-- Business Information (weeks open/year, surgeries count, target profit %, etc.)
-- moves from organization-wide to per-location. Previously every location in an
-- org shared one set of values on `organizations`; going forward each
-- practice_location has its own, editable from Location Details → Business Settings.

ALTER TABLE practice_locations
ADD COLUMN IF NOT EXISTS week_open_per_year NUMERIC(5,2) DEFAULT 46,
ADD COLUMN IF NOT EXISTS days_open_per_week NUMERIC(5,2) DEFAULT 5,
ADD COLUMN IF NOT EXISTS open_hours_per_day NUMERIC(5,2) DEFAULT 8,
ADD COLUMN IF NOT EXISTS number_of_surgeries NUMERIC(5,2) DEFAULT 3,
ADD COLUMN IF NOT EXISTS associate_weeks_per_year NUMERIC(5,2) DEFAULT 46,
ADD COLUMN IF NOT EXISTS associate_days_per_week NUMERIC(5,2) DEFAULT 5,
ADD COLUMN IF NOT EXISTS associate_cost_lab_source TEXT DEFAULT 'flat_per_by_practice',
ADD COLUMN IF NOT EXISTS associate_cost_labs_percent NUMERIC(5,2) DEFAULT 10,
ADD COLUMN IF NOT EXISTS material_cost_source TEXT DEFAULT 'flat_per_by_practice',
ADD COLUMN IF NOT EXISTS practice_cost_materials_percent NUMERIC(5,2) DEFAULT 5,
ADD COLUMN IF NOT EXISTS target_profit_percent NUMERIC(5,2) DEFAULT 15,
ADD COLUMN IF NOT EXISTS target_chair_revenue_per_hour NUMERIC(10,2) DEFAULT 300,
ADD COLUMN IF NOT EXISTS employee_working_duration_type TEXT DEFAULT 'hours';

COMMENT ON COLUMN practice_locations.week_open_per_year IS 'Number of weeks this location is open per year (decimals allowed, e.g. 46.5)';
COMMENT ON COLUMN practice_locations.days_open_per_week IS 'Number of days this location is open per week (decimals allowed, e.g. 4.5)';
COMMENT ON COLUMN practice_locations.open_hours_per_day IS 'Number of hours this location is open per day';
COMMENT ON COLUMN practice_locations.number_of_surgeries IS 'Number of surgery rooms/chairs available at this location (decimals allowed for part-time rooms)';
COMMENT ON COLUMN practice_locations.associate_weeks_per_year IS 'Number of weeks associates work per year at this location';
COMMENT ON COLUMN practice_locations.associate_days_per_week IS 'Number of days associates work per week at this location';
COMMENT ON COLUMN practice_locations.associate_cost_lab_source IS 'Source for associate lab cost calculation (Flat Per by Practice or Associate Wise)';
COMMENT ON COLUMN practice_locations.associate_cost_labs_percent IS 'Percentage of lab costs for associates at this location';
COMMENT ON COLUMN practice_locations.material_cost_source IS 'Source for material cost calculation (Flat Per by Practice or Associate Wise)';
COMMENT ON COLUMN practice_locations.practice_cost_materials_percent IS 'Percentage of material costs for this location';
COMMENT ON COLUMN practice_locations.target_profit_percent IS 'Target profit percentage for this location';
COMMENT ON COLUMN practice_locations.target_chair_revenue_per_hour IS 'Target revenue per chair per hour for this location';
COMMENT ON COLUMN practice_locations.employee_working_duration_type IS 'Type of working duration tracking (Hours or Days) for this location';

-- Backfill every existing location from its parent organization's current values,
-- so nothing changes for existing profit/payslip calculations at migration time.
UPDATE practice_locations pl
SET
  week_open_per_year = o.week_open_per_year,
  days_open_per_week = o.days_open_per_week,
  open_hours_per_day = o.open_hours_per_day,
  number_of_surgeries = o.number_of_surgeries,
  associate_weeks_per_year = o.associate_weeks_per_year,
  associate_days_per_week = o.associate_days_per_week,
  associate_cost_lab_source = o.associate_cost_lab_source,
  associate_cost_labs_percent = o.associate_cost_labs_percent,
  practice_cost_materials_percent = o.practice_cost_materials_percent,
  target_profit_percent = o.target_profit_percent,
  target_chair_revenue_per_hour = o.target_chair_revenue_per_hour,
  employee_working_duration_type = o.employee_working_duration_type
FROM organizations o
WHERE pl.organization_id = o.id;

ALTER TABLE organizations
  DROP COLUMN IF EXISTS week_open_per_year,
  DROP COLUMN IF EXISTS days_open_per_week,
  DROP COLUMN IF EXISTS open_hours_per_day,
  DROP COLUMN IF EXISTS number_of_surgeries,
  DROP COLUMN IF EXISTS associate_weeks_per_year,
  DROP COLUMN IF EXISTS associate_days_per_week,
  DROP COLUMN IF EXISTS associate_cost_lab_source,
  DROP COLUMN IF EXISTS associate_cost_labs_percent,
  DROP COLUMN IF EXISTS practice_cost_materials_percent,
  DROP COLUMN IF EXISTS target_profit_percent,
  DROP COLUMN IF EXISTS target_chair_revenue_per_hour,
  DROP COLUMN IF EXISTS employee_working_duration_type;
