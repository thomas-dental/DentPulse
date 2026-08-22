-- ============================================================
-- Sage multi-business support
-- ============================================================
--
-- Feature: one DentPulse org can connect Sage businesses and map a DIFFERENT
-- Sage business to each practice location (Xero-parity, 1:1 per location).
--
-- Sage difference vs Xero: a single OAuth token can access multiple businesses,
-- but the target business must be selected per-request via the `X-Business`
-- header (Xero uses `Xero-tenant-id`). Synced rows therefore need to record
-- WHICH Sage business they belong to so the frontend can scope a location's
-- chart of accounts / bank accounts to that location's business.
--
-- The Xero dedicated tables carry `xero_tenant_id` (= platform_integration_organizations.id)
-- for exactly this. Sage tables only had `platform_integration_id` (one connection).
-- This migration adds `sage_business_id` (the Sage business GUID, =
-- platform_integration_organizations.platform_org_id) to every Sage entity table.
--
-- Backfill: existing rows predate multi-business, so they all belong to the
-- single business currently mapped under their platform_integration. We copy
-- that business id from platform_integration_organizations.
--
-- Safe to run on a DB where only some sage_* tables exist (uses to_regclass +
-- ADD COLUMN IF NOT EXISTS).

BEGIN;

DO $$
DECLARE
  tbl    TEXT;
  tables TEXT[] := ARRAY[
    'sage_chart_of_accounts',
    'sage_bank_accounts',
    'sage_tax_rates',
    'sage_suppliers',
    'sage_invoices',
    'sage_payment_methods',
    'sage_products',
    'sage_credit_notes',
    'sage_journals',
    'sage_bank_transactions',
    'sage_other_payments',
    'sage_other_receipts',
    'sage_bank_transfers',
    'sage_attachments'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    IF to_regclass('public.' || tbl) IS NOT NULL THEN
      -- 1. Add the business-scope column (Sage business GUID).
      EXECUTE format(
        'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS sage_business_id VARCHAR(500)',
        tbl
      );

      -- 2. Index it (frontend scopes COA/bank by location''s business).
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS %I ON public.%I (sage_business_id)',
        'idx_' || tbl || '_sage_business_id',
        tbl
      );

      -- 3. Backfill existing rows from the single PIO mapped to their connection.
      EXECUTE format($f$
        UPDATE public.%I AS t
        SET sage_business_id = pio.platform_org_id
        FROM public.platform_integration_organizations AS pio
        WHERE pio.platform_integration_id = t.platform_integration_id
          AND pio.platform_name = 'sage'
          AND t.sage_business_id IS NULL
      $f$, tbl);

      RAISE NOTICE 'sage_business_id added + backfilled on %', tbl;
    END IF;
  END LOOP;
END $$;

COMMIT;
