-- Hot-path indexes for multi-month / multi-year report queries.
-- Business logic unchanged: these only help Postgres pick range scans faster
-- for cashflow, profit-benchmark, NHS, and production-style filters.

-- ── xero_journal_details ────────────────────────────────────────────────────
-- Cashflow report + income accounting totals page this table by org + date.
-- Existing indexes are single-column (org OR journal_date); composite is needed
-- for range scans that grow with months/years.
CREATE INDEX IF NOT EXISTS idx_xero_journal_details_org_journal_date
  ON public.xero_journal_details (organization_id, journal_date);

-- Common filter: org + date + account_id (COA mapping / category totals)
CREATE INDEX IF NOT EXISTS idx_xero_journal_details_org_date_account
  ON public.xero_journal_details (organization_id, journal_date, account_id);

-- ── finance_journal_lines (canonical path used by profit-benchmark) ─────────
-- Already has org+posting and org+account+posting in some envs; ensure present.
CREATE INDEX IF NOT EXISTS idx_finance_journal_lines_org_posting_date
  ON public.finance_journal_lines (organization_id, posting_date);

-- ── nhs_claims ──────────────────────────────────────────────────────────────
-- NHS Contract Performance paginates by submitted date then filters in JS.
-- Composite org + date (active rows) cuts multi-year scans.
CREATE INDEX IF NOT EXISTS idx_nhs_claims_org_submitted_date
  ON public.nhs_claims (organization_id, nc_submitted_date)
  WHERE deleted_at IS NULL;

-- ── treatment_plan_items ────────────────────────────────────────────────────
-- Production RPCs filter completed_at by org; reinforce composite for wide ranges.
CREATE INDEX IF NOT EXISTS idx_tpi_org_completed_at_active
  ON public.treatment_plan_items (organization_id, tpi_completed_at)
  WHERE deleted_at IS NULL
    AND tpi_completed_at IS NOT NULL;

-- ── platform_integration_invoices ───────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_platform_invoices_org_invoice_date
  ON public.platform_integration_invoices (organization_id, invoice_date)
  WHERE deleted_at IS NULL;

COMMENT ON INDEX public.idx_xero_journal_details_org_journal_date IS
  'Speeds cashflow / profit journal range scans for multi-month windows';
