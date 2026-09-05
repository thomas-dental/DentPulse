-- ============================================================================
-- Commitment Rate window (Goal Settings M7 precursor)
-- Default 30 days: % of eligible private planned value scheduled within window.
-- ============================================================================

ALTER TABLE public.pe_economic_assumptions
  ADD COLUMN IF NOT EXISTS commitment_rate_window_days integer NOT NULL DEFAULT 30
    CHECK (commitment_rate_window_days >= 1 AND commitment_rate_window_days <= 365);

COMMENT ON COLUMN public.pe_economic_assumptions.commitment_rate_window_days IS
  'Days from PLAN_CREATED to first APPOINTMENT_LINKED for Commitment Rate. Default 30. Goal Settings (M7) will expose per practice.';
