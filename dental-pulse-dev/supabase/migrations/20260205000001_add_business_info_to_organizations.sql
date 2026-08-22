-- Add business info fields to organizations table
ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS week_open_per_year INTEGER DEFAULT 46,
ADD COLUMN IF NOT EXISTS days_open_per_week INTEGER DEFAULT 5,
ADD COLUMN IF NOT EXISTS open_hours_per_day NUMERIC(5,2) DEFAULT 8,
ADD COLUMN IF NOT EXISTS number_of_surgeries INTEGER DEFAULT 3,
ADD COLUMN IF NOT EXISTS associate_weeks_per_year INTEGER DEFAULT 46,
ADD COLUMN IF NOT EXISTS associate_days_per_week INTEGER DEFAULT 5,
ADD COLUMN IF NOT EXISTS associate_cost_lab_source TEXT DEFAULT 'flat_per_by_practice',
ADD COLUMN IF NOT EXISTS associate_cost_labs_percent NUMERIC(5,2) DEFAULT 10,
ADD COLUMN IF NOT EXISTS practice_cost_materials_percent NUMERIC(5,2) DEFAULT 5,
ADD COLUMN IF NOT EXISTS target_profit_percent NUMERIC(5,2) DEFAULT 15,
ADD COLUMN IF NOT EXISTS target_chair_revenue_per_hour NUMERIC(10,2) DEFAULT 300,
ADD COLUMN IF NOT EXISTS employee_working_duration_type TEXT DEFAULT 'hours';

-- Add comments for documentation
COMMENT ON COLUMN organizations.week_open_per_year IS 'Number of weeks the practice is open per year';
COMMENT ON COLUMN organizations.days_open_per_week IS 'Number of days the practice is open per week';
COMMENT ON COLUMN organizations.open_hours_per_day IS 'Number of hours the practice is open per day';
COMMENT ON COLUMN organizations.number_of_surgeries IS 'Number of surgery rooms/chairs available';
COMMENT ON COLUMN organizations.associate_weeks_per_year IS 'Number of weeks associates work per year';
COMMENT ON COLUMN organizations.associate_days_per_week IS 'Number of days associates work per week';
COMMENT ON COLUMN organizations.associate_cost_lab_source IS 'Source for associate lab cost calculation (Flat Per by Practice or Associate Wise)';
COMMENT ON COLUMN organizations.associate_cost_labs_percent IS 'Percentage of lab costs for associates';
COMMENT ON COLUMN organizations.practice_cost_materials_percent IS 'Percentage of material costs for practice';
COMMENT ON COLUMN organizations.target_profit_percent IS 'Target profit percentage';
COMMENT ON COLUMN organizations.target_chair_revenue_per_hour IS 'Target revenue per chair per hour';
COMMENT ON COLUMN organizations.employee_working_duration_type IS 'Type of working duration tracking (Hours or Days)';
