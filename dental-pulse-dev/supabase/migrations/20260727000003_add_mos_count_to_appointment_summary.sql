-- MOS Count — manually entered, mirrors uda_count (NHS) exactly. NHS pays per UDA,
-- so "NHS Count" reuses the existing uda_count column; MOS contracts are paid per
-- case, so MOS needs its own count column. Safe to add: maintain_appointment_summary()
-- only refreshes working_duration_hours/appointment_count/provider_id on conflict
-- (see 20260306000002), so this new manual column is never touched by that trigger,
-- same as uda_count and working_hours_per_day already aren't.

ALTER TABLE appointment_summary
  ADD COLUMN IF NOT EXISTS mos_count NUMERIC(10,2) NULL;

COMMENT ON COLUMN appointment_summary.mos_count IS
  'Manually entered MOS case count for this provider/month. Mirrors uda_count (NHS); never touched by maintain_appointment_summary().';
