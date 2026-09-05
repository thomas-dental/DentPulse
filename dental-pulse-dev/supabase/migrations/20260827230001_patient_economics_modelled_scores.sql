-- ============================================================================
-- Patient Economics — materialized Modelled-tier CLTV projection + Quality Score
--
-- Populated by backend scheduled job (computePatientModelledScores.js), not live
-- views. Tier = Modelled (heuristic formulas documented in that service).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.patient_economics_modelled_scores (
  practice_id UUID NOT NULL,
  patient_id UUID NOT NULL,
  cltv_projection NUMERIC(15, 2) NOT NULL,
  quality_score INTEGER NOT NULL
    CHECK (quality_score >= 0 AND quality_score <= 100),
  cltv_tier TEXT NOT NULL DEFAULT 'Modelled',
  quality_score_tier TEXT NOT NULL DEFAULT 'Modelled',
  confidence_score INTEGER NOT NULL
    CHECK (confidence_score >= 0 AND confidence_score <= 100),
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT patient_economics_modelled_scores_pkey
    PRIMARY KEY (practice_id, patient_id),
  CONSTRAINT patient_economics_modelled_scores_patient_fkey
    FOREIGN KEY (patient_id) REFERENCES public.patients (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_patient_economics_modelled_practice
  ON public.patient_economics_modelled_scores (practice_id);

CREATE INDEX IF NOT EXISTS idx_patient_economics_modelled_computed_at
  ON public.patient_economics_modelled_scores (computed_at DESC);

COMMENT ON TABLE public.patient_economics_modelled_scores IS
  'PE Modelled-tier per-patient CLTV projection and Quality Score. Refreshed by backend scheduler; formulas in computePatientModelledScores.js.';

COMMENT ON COLUMN public.patient_economics_modelled_scores.cltv_projection IS
  '5-year horizon CLTV projection (£): historical contribution + discounted future run-rate (Modelled).';

COMMENT ON COLUMN public.patient_economics_modelled_scores.quality_score IS
  '0–100 engagement / retention quality composite (Modelled).';

COMMENT ON COLUMN public.patient_economics_modelled_scores.cltv_tier IS
  'Provenance tier for CLTV — always Modelled for this table.';

COMMENT ON COLUMN public.patient_economics_modelled_scores.quality_score_tier IS
  'Provenance tier for quality score — always Modelled for this table.';

COMMENT ON COLUMN public.patient_economics_modelled_scores.confidence_score IS
  '0–100 confidence in Modelled outputs (contribution data quality + signal coverage).';

-- ---------------------------------------------------------------------------
-- RLS + grants (PE pattern — org members read; service_role upserts)
-- ---------------------------------------------------------------------------
ALTER TABLE public.patient_economics_modelled_scores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view modelled patient scores for their practice"
  ON public.patient_economics_modelled_scores;
CREATE POLICY "Users can view modelled patient scores for their practice"
  ON public.patient_economics_modelled_scores
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND public.user_in_org(auth.uid(), practice_id)
  );

REVOKE ALL ON TABLE public.patient_economics_modelled_scores FROM anon, authenticated;
GRANT SELECT ON TABLE public.patient_economics_modelled_scores TO authenticated;

REVOKE ALL ON TABLE public.patient_economics_modelled_scores FROM service_role;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.patient_economics_modelled_scores TO service_role;
