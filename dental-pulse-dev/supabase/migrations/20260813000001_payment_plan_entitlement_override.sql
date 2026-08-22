-- ============================================================================
-- Manual entitlement override for payment_plans.
--
-- pp_exam_appointments_included / pp_hygiene_appointments_included are
-- synced from Dentally's own payment plan config — but many practices never
-- configure this in Dentally, leaving both columns null/0 for every plan.
-- These two new columns let a practice set the real "2 exams, 2 hygiene
-- visits a year" entitlement manually from the app's own Settings tab when
-- Dentally has nothing. Nullable: null means "no manual override, use
-- Dentally's own synced value (or nothing, if that's empty too)".
--
-- Org-added columns on an otherwise Dentally-synced table — same pattern as
-- providers.provider_role (20260126000001): the sync UPSERT only writes the
-- Dentally-sourced columns it knows about, so these are never overwritten.
-- ============================================================================

ALTER TABLE payment_plans
  ADD COLUMN IF NOT EXISTS exams_included_override    INTEGER,
  ADD COLUMN IF NOT EXISTS hygiene_included_override   INTEGER;

COMMENT ON COLUMN payment_plans.exams_included_override IS
  'Manual override for exam visits included per year, set from the app when Dentally''s own pp_exam_appointments_included is empty/wrong. Null = no override.';
COMMENT ON COLUMN payment_plans.hygiene_included_override IS
  'Manual override for hygiene visits included per year, set from the app when Dentally''s own pp_hygiene_appointments_included is empty/wrong. Null = no override.';
