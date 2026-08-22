-- Remove period_date_from and period_date_to from iplicit_balance_sheet and iplicit_profit_loss.
-- These columns stored sync query parameters (not the transaction's own period), which was
-- confusing because they changed on every re-sync with a different date range.
-- The sync date range is already captured in sync_jobs.start_date / sync_jobs.end_date.
-- Use the record-level `period_date` column to filter by accounting period instead.

-- ============================================================
-- iplicit_balance_sheet
-- ============================================================

DROP INDEX IF EXISTS idx_iplicit_bs_period_range;

ALTER TABLE public.iplicit_balance_sheet
  DROP COLUMN IF EXISTS period_date_from,
  DROP COLUMN IF EXISTS period_date_to;

-- ============================================================
-- iplicit_profit_loss
-- ============================================================

DROP INDEX IF EXISTS idx_iplicit_pl_period_range;

ALTER TABLE public.iplicit_profit_loss
  DROP COLUMN IF EXISTS period_date_from,
  DROP COLUMN IF EXISTS period_date_to;
