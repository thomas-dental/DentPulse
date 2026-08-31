-- Cash leakage (Charged-not-collected): flag when invoice remains unpaid after N days from raise.

ALTER TABLE public.pe_economic_assumptions
  ADD COLUMN IF NOT EXISTS cash_leakage_collection_window_days integer NOT NULL DEFAULT 30
    CHECK (cash_leakage_collection_window_days >= 1 AND cash_leakage_collection_window_days <= 365);

COMMENT ON COLUMN public.pe_economic_assumptions.cash_leakage_collection_window_days IS
  'Days after invoice_date before an outstanding charged invoice is flagged as cash leakage (Charged-not-collected). Default 30.';
