-- ============================================================================
-- Patient Economics — reactivation flags (point-in-time cohort for Recovery Loop)
--
-- FLAG OPEN RULE (tune via pe_economic_assumptions):
--   1. retention_status IN (drifting, lapsed, effectively_lost) on v_patient_contribution
--   2. trailing contribution £ over reactivation_worklist_trailing_months (default 12)
--      >= reactivation_min_contribution_at_risk_gbp (default £100)
--   3. no other open flag for (practice_id, patient_id)
--
-- contribution_at_risk_at_flag_time = trailing-window contribution at flag open.
-- Recovery: PATIENT_REACTIVATED in event_ledger AFTER flagged_at; post-event
-- contribution summed within reactivation_recovery_contribution_window_days (default 365).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.pe_reactivation_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  segment_at_flag_time TEXT NOT NULL
    CHECK (segment_at_flag_time IN ('drifting', 'lapsed', 'effectively_lost')),
  contribution_at_risk_at_flag_time NUMERIC(15, 2) NOT NULL
    CHECK (contribution_at_risk_at_flag_time >= 0),
  lifetime_contribution_at_flag NUMERIC(15, 2) NOT NULL DEFAULT 0
    CHECK (lifetime_contribution_at_flag >= 0),
  flagged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'recovered')),
  recovered_at TIMESTAMPTZ,
  reactivation_event_at TIMESTAMPTZ,
  contribution_recovered NUMERIC(15, 2)
    CHECK (contribution_recovered IS NULL OR contribution_recovered >= 0),
  trailing_months INTEGER DEFAULT 12
    CHECK (trailing_months IS NULL OR (trailing_months >= 1 AND trailing_months <= 60)),
  recovery_window_days INTEGER DEFAULT 365
    CHECK (recovery_window_days IS NULL OR (recovery_window_days >= 1 AND recovery_window_days <= 1095)),
  min_contribution_threshold_gbp NUMERIC(15, 2) DEFAULT 100
    CHECK (min_contribution_threshold_gbp IS NULL OR min_contribution_threshold_gbp >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Backfill optional metadata columns on tables created before this migration.
ALTER TABLE public.pe_reactivation_flags
  ADD COLUMN IF NOT EXISTS trailing_months INTEGER DEFAULT 12;
ALTER TABLE public.pe_reactivation_flags
  ADD COLUMN IF NOT EXISTS recovery_window_days INTEGER DEFAULT 365;
ALTER TABLE public.pe_reactivation_flags
  ADD COLUMN IF NOT EXISTS min_contribution_threshold_gbp NUMERIC(15, 2) DEFAULT 100;
ALTER TABLE public.pe_reactivation_flags
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

COMMENT ON TABLE public.pe_reactivation_flags IS
  'PE reactivation cohort: snapshot when at-risk segment + trailing contribution crosses threshold. Recovery via event_ledger PATIENT_REACTIVATED after flagged_at.';

COMMENT ON COLUMN public.pe_reactivation_flags.contribution_at_risk_at_flag_time IS
  'Trailing-window contribution £ at flag open (reactivation_worklist_trailing_months).';

COMMENT ON COLUMN public.pe_reactivation_flags.lifetime_contribution_at_flag IS
  'Trailing contribution £ at flag — baseline to compare post-reactivation recovery £.';

COMMENT ON COLUMN public.pe_reactivation_flags.contribution_recovered IS
  'Invoice contribution £ in recovery_window_days after PATIENT_REACTIVATED event.';

CREATE UNIQUE INDEX IF NOT EXISTS ux_pe_reactivation_flags_open_patient
  ON public.pe_reactivation_flags (practice_id, patient_id)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_pe_reactivation_flags_practice_status
  ON public.pe_reactivation_flags (practice_id, status, flagged_at DESC);

CREATE INDEX IF NOT EXISTS idx_pe_reactivation_flags_patient
  ON public.pe_reactivation_flags (practice_id, patient_id, flagged_at DESC);

ALTER TABLE public.pe_reactivation_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view pe reactivation flags for their practice"
  ON public.pe_reactivation_flags;
CREATE POLICY "Users can view pe reactivation flags for their practice"
  ON public.pe_reactivation_flags
  FOR SELECT
  TO authenticated
  USING (public.user_in_org(auth.uid(), practice_id));

REVOKE ALL ON TABLE public.pe_reactivation_flags FROM anon, authenticated;
GRANT SELECT ON TABLE public.pe_reactivation_flags TO authenticated;
GRANT ALL ON TABLE public.pe_reactivation_flags TO service_role;

DROP TRIGGER IF EXISTS set_pe_reactivation_flags_updated_at ON public.pe_reactivation_flags;
CREATE TRIGGER set_pe_reactivation_flags_updated_at
  BEFORE UPDATE ON public.pe_reactivation_flags
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
