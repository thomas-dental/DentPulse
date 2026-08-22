-- Add marketing_cost_percent to saved_scenarios, mirroring overhead_cost_percent
-- / material_cost_percent, so the Cost Impact scenario simulator can save/load
-- a Marketing Cost adjustment percentage alongside the other cost centers.
alter table saved_scenarios
  add column if not exists marketing_cost_percent numeric default 0;
