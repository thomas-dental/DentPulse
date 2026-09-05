-- Collection rate trailing window for PE Invoices screen (Settings-ready).

ALTER TABLE public.pe_economic_assumptions
  ADD COLUMN IF NOT EXISTS collection_rate_trailing_months integer NOT NULL DEFAULT 12
    CHECK (collection_rate_trailing_months > 0 AND collection_rate_trailing_months <= 60);

COMMENT ON COLUMN public.pe_economic_assumptions.collection_rate_trailing_months IS
  'Trailing months for invoiced vs collected collection rate on PE Invoices (default 12).';
