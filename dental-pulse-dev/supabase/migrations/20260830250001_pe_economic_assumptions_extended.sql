-- ============================================================================
-- PE Economic Assumptions — extended columns for Settings consolidation.
-- Defaults match production inline constants (no behavior change on deploy).
-- Writes via economics-engine API (service_role); authenticated SELECT only.
-- ============================================================================

ALTER TABLE public.pe_economic_assumptions
  ADD COLUMN IF NOT EXISTS commitment_rate_clinician_window_days integer NOT NULL DEFAULT 30
    CHECK (commitment_rate_clinician_window_days >= 1 AND commitment_rate_clinician_window_days <= 365),
  ADD COLUMN IF NOT EXISTS commitment_rate_standard_windows_days jsonb NOT NULL DEFAULT '[7,30,60,90]'::jsonb,
  ADD COLUMN IF NOT EXISTS aging_bucket_boundary_days jsonb NOT NULL DEFAULT '[30,60,90]'::jsonb,
  ADD COLUMN IF NOT EXISTS retention_drifting_visit_gap_days integer NOT NULL DEFAULT 182
    CHECK (retention_drifting_visit_gap_days >= 1 AND retention_drifting_visit_gap_days <= 1095),
  ADD COLUMN IF NOT EXISTS retention_lapsed_recall_overdue_days integer NOT NULL DEFAULT 90
    CHECK (retention_lapsed_recall_overdue_days >= 1 AND retention_lapsed_recall_overdue_days <= 365),
  ADD COLUMN IF NOT EXISTS retention_lapsed_visit_gap_days integer NOT NULL DEFAULT 365
    CHECK (retention_lapsed_visit_gap_days >= 1 AND retention_lapsed_visit_gap_days <= 1095),
  ADD COLUMN IF NOT EXISTS retention_effectively_lost_recall_overdue_days integer NOT NULL DEFAULT 180
    CHECK (retention_effectively_lost_recall_overdue_days >= 1 AND retention_effectively_lost_recall_overdue_days <= 365),
  ADD COLUMN IF NOT EXISTS retention_effectively_lost_visit_gap_days integer NOT NULL DEFAULT 730
    CHECK (retention_effectively_lost_visit_gap_days >= 1 AND retention_effectively_lost_visit_gap_days <= 1825),
  ADD COLUMN IF NOT EXISTS reactivation_min_contribution_at_risk_gbp numeric(15, 2) NOT NULL DEFAULT 100
    CHECK (reactivation_min_contribution_at_risk_gbp >= 0),
  ADD COLUMN IF NOT EXISTS reactivation_recovery_contribution_window_days integer NOT NULL DEFAULT 365
    CHECK (reactivation_recovery_contribution_window_days >= 1 AND reactivation_recovery_contribution_window_days <= 1095),
  ADD COLUMN IF NOT EXISTS reactivation_high_value_at_risk_gbp numeric(15, 2) NOT NULL DEFAULT 500
    CHECK (reactivation_high_value_at_risk_gbp >= 0),
  ADD COLUMN IF NOT EXISTS reactivation_worklist_trailing_months integer NOT NULL DEFAULT 12
    CHECK (reactivation_worklist_trailing_months >= 1 AND reactivation_worklist_trailing_months <= 60),
  ADD COLUMN IF NOT EXISTS recommended_action_high_opportunity_weighted_gbp numeric(15, 2) NOT NULL DEFAULT 500
    CHECK (recommended_action_high_opportunity_weighted_gbp >= 0),
  ADD COLUMN IF NOT EXISTS recommended_action_high_quality_score integer NOT NULL DEFAULT 70
    CHECK (recommended_action_high_quality_score >= 0 AND recommended_action_high_quality_score <= 100),
  ADD COLUMN IF NOT EXISTS recommended_action_low_quality_score integer NOT NULL DEFAULT 40
    CHECK (recommended_action_low_quality_score >= 0 AND recommended_action_low_quality_score <= 100),
  ADD COLUMN IF NOT EXISTS projected_lifetime_years_active numeric(6, 2) NOT NULL DEFAULT 8
    CHECK (projected_lifetime_years_active >= 0 AND projected_lifetime_years_active <= 30),
  ADD COLUMN IF NOT EXISTS projected_lifetime_years_drifting numeric(6, 2) NOT NULL DEFAULT 5
    CHECK (projected_lifetime_years_drifting >= 0 AND projected_lifetime_years_drifting <= 30),
  ADD COLUMN IF NOT EXISTS projected_lifetime_years_lapsed numeric(6, 2) NOT NULL DEFAULT 2
    CHECK (projected_lifetime_years_lapsed >= 0 AND projected_lifetime_years_lapsed <= 30),
  ADD COLUMN IF NOT EXISTS projected_lifetime_years_effectively_lost numeric(6, 2) NOT NULL DEFAULT 1
    CHECK (projected_lifetime_years_effectively_lost >= 0 AND projected_lifetime_years_effectively_lost <= 30),
  ADD COLUMN IF NOT EXISTS cltv_projection_horizon_years integer NOT NULL DEFAULT 5
    CHECK (cltv_projection_horizon_years >= 1 AND cltv_projection_horizon_years <= 20),
  ADD COLUMN IF NOT EXISTS cltv_projection_discount_rate numeric(6, 4) NOT NULL DEFAULT 0.10
    CHECK (cltv_projection_discount_rate >= 0 AND cltv_projection_discount_rate <= 1),
  ADD COLUMN IF NOT EXISTS modelled_visits_per_year_cap numeric(6, 2) NOT NULL DEFAULT 6
    CHECK (modelled_visits_per_year_cap >= 1 AND modelled_visits_per_year_cap <= 24),
  ADD COLUMN IF NOT EXISTS modelled_min_visits_per_year_active numeric(6, 2) NOT NULL DEFAULT 0.5
    CHECK (modelled_min_visits_per_year_active >= 0 AND modelled_min_visits_per_year_active <= 12),
  ADD COLUMN IF NOT EXISTS modelled_inactive_retention_factor numeric(6, 4) NOT NULL DEFAULT 0.30
    CHECK (modelled_inactive_retention_factor >= 0 AND modelled_inactive_retention_factor <= 1),
  ADD COLUMN IF NOT EXISTS modelled_full_engagement_visits_per_year numeric(6, 2) NOT NULL DEFAULT 2
    CHECK (modelled_full_engagement_visits_per_year >= 0.5 AND modelled_full_engagement_visits_per_year <= 24),
  ADD COLUMN IF NOT EXISTS modelled_quality_score_plan_bonus integer NOT NULL DEFAULT 5
    CHECK (modelled_quality_score_plan_bonus >= 0 AND modelled_quality_score_plan_bonus <= 25),
  ADD COLUMN IF NOT EXISTS journey_min_planned_events integer NOT NULL DEFAULT 5
    CHECK (journey_min_planned_events >= 1 AND journey_min_planned_events <= 100),
  ADD COLUMN IF NOT EXISTS journey_min_total_funnel_events integer NOT NULL DEFAULT 10
    CHECK (journey_min_total_funnel_events >= 1 AND journey_min_total_funnel_events <= 500);

COMMENT ON COLUMN public.pe_economic_assumptions.commitment_rate_clinician_window_days IS
  'Commitment Rate window for per-clinician breakdown on Value & Leakage (default 30).';
COMMENT ON COLUMN public.pe_economic_assumptions.commitment_rate_standard_windows_days IS
  'JSON array of day windows for commitment rate chart (default [7,30,60,90]).';
COMMENT ON COLUMN public.pe_economic_assumptions.aging_bucket_boundary_days IS
  'JSON upper bounds for aged-debt buckets (default [30,60,90] → 0–30, 31–60, 61–90, 90+).';
COMMENT ON COLUMN public.pe_economic_assumptions.retention_drifting_visit_gap_days IS
  'Retention 4-tier: visit gap > N days → drifting (default 182).';
COMMENT ON COLUMN public.pe_economic_assumptions.reactivation_min_contribution_at_risk_gbp IS
  'Minimum contribution £ to open a reactivation flag (default 100).';

-- Align write access with practitioner rates / goal settings: SELECT only for authenticated.
DROP POLICY IF EXISTS "Users can upsert pe economic assumptions for their practice"
  ON public.pe_economic_assumptions;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.pe_economic_assumptions FROM authenticated;
GRANT SELECT ON TABLE public.pe_economic_assumptions TO authenticated;

REVOKE ALL ON TABLE public.pe_economic_assumptions FROM service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.pe_economic_assumptions TO service_role;
