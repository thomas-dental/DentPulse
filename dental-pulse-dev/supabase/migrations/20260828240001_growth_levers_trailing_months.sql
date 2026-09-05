-- Growth Levers — configurable trailing window for visit frequency / value per visit.

ALTER TABLE public.pe_economic_assumptions
  ADD COLUMN IF NOT EXISTS growth_levers_trailing_months integer NOT NULL DEFAULT 12
    CHECK (growth_levers_trailing_months > 0 AND growth_levers_trailing_months <= 60);

COMMENT ON COLUMN public.pe_economic_assumptions.growth_levers_trailing_months IS
  'Trailing months for Growth Levers visit frequency and value-per-visit (default 12).';
