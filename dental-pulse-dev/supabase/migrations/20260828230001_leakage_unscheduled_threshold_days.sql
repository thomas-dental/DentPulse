-- ============================================================================
-- Value & Leakage — unscheduled planned threshold (Goal Settings M7 precursor)
-- Plans with no APPOINTMENT_LINKED beyond this many days after PLAN_CREATED.
-- ============================================================================

ALTER TABLE public.pe_economic_assumptions
  ADD COLUMN IF NOT EXISTS leakage_unscheduled_threshold_days integer NOT NULL DEFAULT 60
    CHECK (leakage_unscheduled_threshold_days >= 1 AND leakage_unscheduled_threshold_days <= 365);

COMMENT ON COLUMN public.pe_economic_assumptions.leakage_unscheduled_threshold_days IS
  'Days after PLAN_CREATED without APPOINTMENT_LINKED for Planned>Xd unscheduled leakage list. Default 60. Goal Settings (M7) will expose per practice.';
