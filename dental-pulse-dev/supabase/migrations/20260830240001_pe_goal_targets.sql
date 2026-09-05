-- ============================================================================
-- PE Goal Settings — group defaults + per-practice overrides (blank inherits group).
-- Writes via economics-engine API (service_role); authenticated SELECT only.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.pe_goal_defaults (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  target_commitment_rate_pct numeric(5, 2)
    CHECK (target_commitment_rate_pct IS NULL OR (target_commitment_rate_pct >= 0 AND target_commitment_rate_pct <= 100)),
  target_contribution_per_active_gbp numeric(15, 2)
    CHECK (target_contribution_per_active_gbp IS NULL OR target_contribution_per_active_gbp >= 0),
  target_opportunity_progression_gbp numeric(15, 2)
    CHECK (target_opportunity_progression_gbp IS NULL OR target_opportunity_progression_gbp >= 0),
  target_attrition_ceiling_pct numeric(5, 2)
    CHECK (target_attrition_ceiling_pct IS NULL OR (target_attrition_ceiling_pct >= 0 AND target_attrition_ceiling_pct <= 100)),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.pe_goal_defaults IS
  'PE Goal Settings group defaults for the selected organization context. Per-practice rows inherit when override columns are null.';

CREATE TABLE IF NOT EXISTS public.pe_goal_practice_overrides (
  practice_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  target_commitment_rate_pct numeric(5, 2)
    CHECK (target_commitment_rate_pct IS NULL OR (target_commitment_rate_pct >= 0 AND target_commitment_rate_pct <= 100)),
  target_contribution_per_active_gbp numeric(15, 2)
    CHECK (target_contribution_per_active_gbp IS NULL OR target_contribution_per_active_gbp >= 0),
  target_opportunity_progression_gbp numeric(15, 2)
    CHECK (target_opportunity_progression_gbp IS NULL OR target_opportunity_progression_gbp >= 0),
  target_attrition_ceiling_pct numeric(5, 2)
    CHECK (target_attrition_ceiling_pct IS NULL OR (target_attrition_ceiling_pct >= 0 AND target_attrition_ceiling_pct <= 100)),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.pe_goal_practice_overrides IS
  'PE Goal Settings per-practice target overrides. NULL column = inherit group default from pe_goal_defaults for context org.';

ALTER TABLE public.pe_goal_defaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pe_goal_practice_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view pe goal defaults for their practice"
  ON public.pe_goal_defaults;
CREATE POLICY "Users can view pe goal defaults for their practice"
  ON public.pe_goal_defaults
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND public.user_in_org(auth.uid(), organization_id)
  );

DROP POLICY IF EXISTS "Users can view pe goal practice overrides for their practice"
  ON public.pe_goal_practice_overrides;
CREATE POLICY "Users can view pe goal practice overrides for their practice"
  ON public.pe_goal_practice_overrides
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND public.user_in_org(auth.uid(), practice_id)
  );

REVOKE ALL ON TABLE public.pe_goal_defaults FROM anon, authenticated;
GRANT SELECT ON TABLE public.pe_goal_defaults TO authenticated;

REVOKE ALL ON TABLE public.pe_goal_practice_overrides FROM anon, authenticated;
GRANT SELECT ON TABLE public.pe_goal_practice_overrides TO authenticated;

REVOKE ALL ON TABLE public.pe_goal_defaults FROM service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.pe_goal_defaults TO service_role;

REVOKE ALL ON TABLE public.pe_goal_practice_overrides FROM service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.pe_goal_practice_overrides TO service_role;
