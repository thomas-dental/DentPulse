-- Add clinician_cost_percent, overhead_cost_percent, material_cost_percent to saved_scenarios
alter table saved_scenarios
  add column if not exists clinician_cost_percent numeric default 0,
  add column if not exists overhead_cost_percent numeric default 0,
  add column if not exists material_cost_percent numeric default 0;
