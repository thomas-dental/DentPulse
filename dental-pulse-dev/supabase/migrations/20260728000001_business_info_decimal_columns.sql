-- Business Information fields must accept DECIMAL values (client request
-- 2026-07-28): e.g. 46.5 weeks open per year, 4.5 days per week, 3.5 surgeries
-- (a room used half-time). Five columns from 20260205000001 were INTEGER, so
-- Postgres silently rounded any decimal the frontend sent (the frontend's own
-- parseInt truncation is fixed in the same change).
--
-- open_hours_per_day / *_percent / target_chair_revenue_per_hour are already
-- NUMERIC and unchanged. INTEGER → NUMERIC is a safe widening cast: every
-- consumer (RPCs, valuation, profit calcs) reads these through arithmetic that
-- accepts numeric.

ALTER TABLE organizations
  ALTER COLUMN week_open_per_year TYPE NUMERIC(5,2) USING week_open_per_year::NUMERIC(5,2),
  ALTER COLUMN days_open_per_week TYPE NUMERIC(5,2) USING days_open_per_week::NUMERIC(5,2),
  ALTER COLUMN number_of_surgeries TYPE NUMERIC(5,2) USING number_of_surgeries::NUMERIC(5,2),
  ALTER COLUMN associate_weeks_per_year TYPE NUMERIC(5,2) USING associate_weeks_per_year::NUMERIC(5,2),
  ALTER COLUMN associate_days_per_week TYPE NUMERIC(5,2) USING associate_days_per_week::NUMERIC(5,2);

COMMENT ON COLUMN organizations.week_open_per_year IS 'Number of weeks the practice is open per year (decimals allowed, e.g. 46.5)';
COMMENT ON COLUMN organizations.days_open_per_week IS 'Number of days the practice is open per week (decimals allowed, e.g. 4.5)';
COMMENT ON COLUMN organizations.number_of_surgeries IS 'Number of surgery rooms/chairs available (decimals allowed for part-time rooms)';
COMMENT ON COLUMN organizations.associate_weeks_per_year IS 'Number of weeks associates work per year (decimals allowed)';
COMMENT ON COLUMN organizations.associate_days_per_week IS 'Number of days associates work per week (decimals allowed)';
