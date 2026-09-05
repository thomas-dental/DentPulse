-- Growth Levers — benchmark method + optional target values for headroom.

ALTER TABLE public.pe_economic_assumptions
  ADD COLUMN IF NOT EXISTS growth_levers_benchmark_method text NOT NULL DEFAULT 'group_top'
    CHECK (growth_levers_benchmark_method IN ('group_top', 'configured_target'));

ALTER TABLE public.pe_economic_assumptions
  ADD COLUMN IF NOT EXISTS growth_levers_target_visit_frequency numeric(10, 2),
  ADD COLUMN IF NOT EXISTS growth_levers_target_value_per_visit numeric(15, 2),
  ADD COLUMN IF NOT EXISTS growth_levers_target_tenure_years numeric(10, 2),
  ADD COLUMN IF NOT EXISTS growth_levers_target_projected_lifetime_years numeric(10, 2);

ALTER TABLE public.pe_economic_assumptions
  ADD COLUMN IF NOT EXISTS cltv_acquisition_min_sample integer NOT NULL DEFAULT 5
    CHECK (cltv_acquisition_min_sample >= 1 AND cltv_acquisition_min_sample <= 100);

COMMENT ON COLUMN public.pe_economic_assumptions.growth_levers_benchmark_method IS
  'Headroom benchmark: group_top = max across user-visible practices per lever; configured_target = per-practice targets below.';

COMMENT ON COLUMN public.pe_economic_assumptions.growth_levers_target_visit_frequency IS
  'Configured target visit frequency (/yr trailing window) when benchmark_method = configured_target.';

COMMENT ON COLUMN public.pe_economic_assumptions.growth_levers_target_value_per_visit IS
  'Configured target £ private/plan revenue per completed visit when benchmark_method = configured_target.';

COMMENT ON COLUMN public.pe_economic_assumptions.growth_levers_target_tenure_years IS
  'Configured target tenure (elapsed years, Derived) when benchmark_method = configured_target.';

COMMENT ON COLUMN public.pe_economic_assumptions.growth_levers_target_projected_lifetime_years IS
  'Configured target projected lifetime (total years, Modelled) when benchmark_method = configured_target.';

COMMENT ON COLUMN public.pe_economic_assumptions.cltv_acquisition_min_sample IS
  'Minimum patients per acquisition source before CLTV rollup is treated as well-populated (default 5).';
