-- UOA Count — manually entered, mirrors mos_count/uda_count exactly. UOA
-- (orthodontic) contracts are paid per Unit of Orthodontic Activity, so they
-- need their own count column alongside uda_count (NHS) and mos_count (MOS).
-- Safe to add: maintain_appointment_summary() only refreshes
-- working_duration_hours/appointment_count/provider_id on conflict (see
-- 20260306000002), so this new manual column is never touched by that trigger.

ALTER TABLE appointment_summary
  ADD COLUMN IF NOT EXISTS uoa_count NUMERIC(10,2) NULL;

COMMENT ON COLUMN appointment_summary.uoa_count IS
  'Manually entered UOA case count for this provider/month. Mirrors uda_count (NHS) and mos_count (MOS); never touched by maintain_appointment_summary().';
