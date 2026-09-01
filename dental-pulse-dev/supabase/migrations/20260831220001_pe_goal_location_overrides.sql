-- Per-location PE goal overrides (multi-site org rollup).

CREATE TABLE IF NOT EXISTS public.pe_goal_location_overrides (
  location_id uuid PRIMARY KEY REFERENCES public.practice_locations(id) ON DELETE CASCADE,
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

COMMENT ON TABLE public.pe_goal_location_overrides IS
  'PE Goal Settings per-location overrides. NULL column = inherit group default from pe_goal_defaults.';

ALTER TABLE public.pe_goal_location_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view pe goal location overrides for their practice"
  ON public.pe_goal_location_overrides;
CREATE POLICY "Users can view pe goal location overrides for their practice"
  ON public.pe_goal_location_overrides
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.practice_locations pl
      WHERE pl.id = location_id
        AND public.user_in_org(auth.uid(), pl.organization_id)
    )
  );

REVOKE ALL ON TABLE public.pe_goal_location_overrides FROM anon, authenticated;
GRANT SELECT ON TABLE public.pe_goal_location_overrides TO authenticated;

REVOKE ALL ON TABLE public.pe_goal_location_overrides FROM service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.pe_goal_location_overrides TO service_role;
