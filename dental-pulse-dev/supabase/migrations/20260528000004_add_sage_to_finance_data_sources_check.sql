-- ============================================================
-- Add 'sage' to the finance_data_sources.platform CHECK constraint
-- ============================================================
--
-- The original migration (20260327000001_create_canonical_finance_tables.sql)
-- allowed platform IN ('iplicit', 'xero', 'quickbooks', 'quickbooks_online',
-- 'microsoft_dynamics', 'other') — Sage wasn't a known integration at the time.
--
-- Now that Sage has shipped (PART A.5 + Wave 1+2 on 2026-05-28) and we are
-- building sageToCanonical.js, the canonical ETL needs to insert
-- finance_data_sources rows with platform='sage'. Without this constraint
-- update, the insert errors with:
--   "new row for relation 'finance_data_sources' violates check constraint
--    'finance_data_sources_platform_check'"
--
-- This migration drops + recreates the CHECK constraint with 'sage' added.

BEGIN;

ALTER TABLE public.finance_data_sources
    DROP CONSTRAINT IF EXISTS finance_data_sources_platform_check;

ALTER TABLE public.finance_data_sources
    ADD CONSTRAINT finance_data_sources_platform_check
    CHECK (platform IN (
        'iplicit',
        'xero',
        'quickbooks',
        'quickbooks_online',
        'microsoft_dynamics',
        'sage',
        'other'
    ));

COMMIT;
