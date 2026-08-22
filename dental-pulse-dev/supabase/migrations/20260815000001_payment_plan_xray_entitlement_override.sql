-- ============================================================================
-- Manual x-ray entitlement override for payment_plans.
--
-- Unlike exams/hygiene (pp_exam_appointments_included /
-- pp_hygiene_appointments_included, synced from Dentally's own payment plan
-- config — see 20260813000001), Dentally has no x-ray entitlement field at
-- all, so this column has no Dentally-synced counterpart to fall back to.
-- Null = no entitlement set (not "unlimited") for this plan.
-- ============================================================================

ALTER TABLE payment_plans
  ADD COLUMN IF NOT EXISTS xray_included_override INTEGER;

COMMENT ON COLUMN payment_plans.xray_included_override IS
  'Manual override for x-ray visits included per year, set from the app — Dentally has no equivalent synced field. Null = no entitlement set.';
