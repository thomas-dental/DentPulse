-- ============================================================
-- Dedicated QuickBooks Online (QBO) data tables.
-- ============================================================
--
-- Mirrors the xero_* / iplicit_* dedicated-table model: QuickBooks data
-- lands in its own quickbooks_* tables (never the shared platform_* ones)
-- so downstream code can branch cleanly per platform.
--
-- Tenancy model (matches Phase-1 OAuth callback):
--   * platform_integration_id  -> platform_integrations.id (per-org Intuit app)
--   * quickbooks_company_id    -> platform_integration_organizations.id
--                                 (the QBO company row; ≈ xero_tenant_id)
--   * realm_id (TEXT)          -> the QBO realmId string
--                                 (= platform_integration_organizations.platform_org_id).
--                                 realmId is mandatory on every QBO API call.
--
-- Each table keeps the full QBO object verbatim in raw_data (JSONB) in
-- addition to the extracted, stable v3 scalar columns — nothing the API
-- returns is discarded, and downstream mapping can always re-derive from
-- raw_data. Unique key is (organization_id, realm_id, qb_<entity>_id).
--
-- NOTE: this is the Phase-2 READ pipeline only. No EBITDA / P&L / cost-bucket
-- resolver reads these tables yet — that downstream wiring (Phase 3) is
-- gated on £-for-£ reconciliation vs QuickBooks' own P&L and is intentionally
-- not part of this migration.

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- Helper: every table shares the same RLS shape (org membership).
-- Policies are created explicitly per table below (no DO-loop so the
-- migration stays greppable and idempotent via DROP POLICY IF EXISTS).
-- ─────────────────────────────────────────────────────────────

-- ============================================================
-- 1. quickbooks_chart_of_accounts  (QBO Account)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.quickbooks_chart_of_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  platform_integration_id UUID REFERENCES public.platform_integrations(id) ON DELETE CASCADE,
  quickbooks_company_id UUID REFERENCES public.platform_integration_organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  realm_id TEXT NOT NULL,

  qb_account_id VARCHAR(100) NOT NULL,
  sync_token VARCHAR(50),
  account_name VARCHAR(500),
  fully_qualified_name VARCHAR(1000),
  account_number VARCHAR(100),          -- QBO Account.AcctNum (≈ Xero account_code)
  account_type VARCHAR(100),            -- QBO AccountType
  account_sub_type VARCHAR(100),        -- QBO AccountSubType
  classification VARCHAR(100),          -- Asset / Liability / Equity / Revenue / Expense
  description TEXT,
  current_balance NUMERIC(18, 2),
  current_balance_with_sub_accounts NUMERIC(18, 2),
  currency VARCHAR(10),
  is_active BOOLEAN DEFAULT true,
  is_sub_account BOOLEAN DEFAULT false,
  parent_account_id VARCHAR(100),
  qb_created_at TIMESTAMP WITH TIME ZONE,
  qb_updated_at TIMESTAMP WITH TIME ZONE,

  raw_data JSONB,
  last_synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT quickbooks_coa_unique_per_company
    UNIQUE (organization_id, realm_id, qb_account_id)
);
CREATE INDEX IF NOT EXISTS idx_qb_coa_org           ON public.quickbooks_chart_of_accounts(organization_id);
CREATE INDEX IF NOT EXISTS idx_qb_coa_company       ON public.quickbooks_chart_of_accounts(quickbooks_company_id);
CREATE INDEX IF NOT EXISTS idx_qb_coa_realm         ON public.quickbooks_chart_of_accounts(realm_id);
CREATE INDEX IF NOT EXISTS idx_qb_coa_account_id    ON public.quickbooks_chart_of_accounts(qb_account_id);
CREATE INDEX IF NOT EXISTS idx_qb_coa_account_num   ON public.quickbooks_chart_of_accounts(account_number);
CREATE INDEX IF NOT EXISTS idx_qb_coa_type          ON public.quickbooks_chart_of_accounts(account_type);

-- ============================================================
-- 2. quickbooks_invoices  (QBO Invoice = ACCREC / sales)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.quickbooks_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  platform_integration_id UUID REFERENCES public.platform_integrations(id) ON DELETE CASCADE,
  quickbooks_company_id UUID REFERENCES public.platform_integration_organizations(id) ON DELETE CASCADE,
  location_id UUID REFERENCES public.practice_locations(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  realm_id TEXT NOT NULL,

  qb_invoice_id VARCHAR(100) NOT NULL,
  sync_token VARCHAR(50),
  doc_number VARCHAR(100),
  txn_date DATE,
  due_date DATE,
  currency VARCHAR(10),
  exchange_rate NUMERIC(18, 6),
  customer_id VARCHAR(100),
  customer_name VARCHAR(500),
  customer_memo TEXT,
  private_note TEXT,
  total_amount NUMERIC(18, 2),
  total_tax NUMERIC(18, 2),
  balance NUMERIC(18, 2),
  is_paid BOOLEAN DEFAULT false,
  email_status VARCHAR(50),
  qb_created_at TIMESTAMP WITH TIME ZONE,
  qb_updated_at TIMESTAMP WITH TIME ZONE,

  raw_data JSONB,
  last_synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT quickbooks_invoices_unique_per_company
    UNIQUE (organization_id, realm_id, qb_invoice_id)
);
CREATE INDEX IF NOT EXISTS idx_qb_inv_org      ON public.quickbooks_invoices(organization_id);
CREATE INDEX IF NOT EXISTS idx_qb_inv_company  ON public.quickbooks_invoices(quickbooks_company_id);
CREATE INDEX IF NOT EXISTS idx_qb_inv_realm    ON public.quickbooks_invoices(realm_id);
CREATE INDEX IF NOT EXISTS idx_qb_inv_txn_date ON public.quickbooks_invoices(txn_date);
CREATE INDEX IF NOT EXISTS idx_qb_inv_customer ON public.quickbooks_invoices(customer_id);

CREATE TABLE IF NOT EXISTS public.quickbooks_invoice_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES public.quickbooks_invoices(id) ON DELETE CASCADE,
  realm_id TEXT NOT NULL,
  qb_invoice_id VARCHAR(100) NOT NULL,

  line_num INTEGER,
  line_id VARCHAR(100),
  detail_type VARCHAR(100),
  description TEXT,
  amount NUMERIC(18, 2),
  quantity NUMERIC(18, 4),
  unit_price NUMERIC(18, 6),
  item_id VARCHAR(100),
  item_name VARCHAR(500),
  income_account_id VARCHAR(100),
  tax_code VARCHAR(50),

  raw_data JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT quickbooks_invoice_lines_unique
    UNIQUE (organization_id, realm_id, qb_invoice_id, line_num)
);
CREATE INDEX IF NOT EXISTS idx_qb_inv_li_org        ON public.quickbooks_invoice_line_items(organization_id);
CREATE INDEX IF NOT EXISTS idx_qb_inv_li_invoice    ON public.quickbooks_invoice_line_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_qb_inv_li_account    ON public.quickbooks_invoice_line_items(income_account_id);

-- ============================================================
-- 3. quickbooks_bills  (QBO Bill = ACCPAY / supplier bills)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.quickbooks_bills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  platform_integration_id UUID REFERENCES public.platform_integrations(id) ON DELETE CASCADE,
  quickbooks_company_id UUID REFERENCES public.platform_integration_organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  realm_id TEXT NOT NULL,

  qb_bill_id VARCHAR(100) NOT NULL,
  sync_token VARCHAR(50),
  doc_number VARCHAR(100),
  txn_date DATE,
  due_date DATE,
  currency VARCHAR(10),
  exchange_rate NUMERIC(18, 6),
  vendor_id VARCHAR(100),
  vendor_name VARCHAR(500),
  ap_account_id VARCHAR(100),
  private_note TEXT,
  total_amount NUMERIC(18, 2),
  balance NUMERIC(18, 2),
  is_paid BOOLEAN DEFAULT false,
  qb_created_at TIMESTAMP WITH TIME ZONE,
  qb_updated_at TIMESTAMP WITH TIME ZONE,

  raw_data JSONB,
  last_synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT quickbooks_bills_unique_per_company
    UNIQUE (organization_id, realm_id, qb_bill_id)
);
CREATE INDEX IF NOT EXISTS idx_qb_bill_org      ON public.quickbooks_bills(organization_id);
CREATE INDEX IF NOT EXISTS idx_qb_bill_company  ON public.quickbooks_bills(quickbooks_company_id);
CREATE INDEX IF NOT EXISTS idx_qb_bill_realm    ON public.quickbooks_bills(realm_id);
CREATE INDEX IF NOT EXISTS idx_qb_bill_txn_date ON public.quickbooks_bills(txn_date);
CREATE INDEX IF NOT EXISTS idx_qb_bill_vendor   ON public.quickbooks_bills(vendor_id);

CREATE TABLE IF NOT EXISTS public.quickbooks_bill_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  bill_id UUID NOT NULL REFERENCES public.quickbooks_bills(id) ON DELETE CASCADE,
  realm_id TEXT NOT NULL,
  qb_bill_id VARCHAR(100) NOT NULL,

  line_num INTEGER,
  line_id VARCHAR(100),
  detail_type VARCHAR(100),
  description TEXT,
  amount NUMERIC(18, 2),
  account_id VARCHAR(100),              -- AccountBasedExpenseLineDetail.AccountRef
  item_id VARCHAR(100),                 -- ItemBasedExpenseLineDetail.ItemRef
  customer_id VARCHAR(100),
  billable_status VARCHAR(50),
  tax_code VARCHAR(50),

  raw_data JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT quickbooks_bill_lines_unique
    UNIQUE (organization_id, realm_id, qb_bill_id, line_num)
);
CREATE INDEX IF NOT EXISTS idx_qb_bill_li_org     ON public.quickbooks_bill_line_items(organization_id);
CREATE INDEX IF NOT EXISTS idx_qb_bill_li_bill    ON public.quickbooks_bill_line_items(bill_id);
CREATE INDEX IF NOT EXISTS idx_qb_bill_li_account ON public.quickbooks_bill_line_items(account_id);

-- ============================================================
-- 4. quickbooks_journal_entries  (QBO JournalEntry — manual journals)
--    Header + lines, analogous to xero_journals / xero_journal_details.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.quickbooks_journal_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  platform_integration_id UUID REFERENCES public.platform_integrations(id) ON DELETE CASCADE,
  quickbooks_company_id UUID REFERENCES public.platform_integration_organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  realm_id TEXT NOT NULL,

  qb_journal_entry_id VARCHAR(100) NOT NULL,
  sync_token VARCHAR(50),
  doc_number VARCHAR(100),
  txn_date DATE,
  currency VARCHAR(10),
  exchange_rate NUMERIC(18, 6),
  private_note TEXT,
  total_amount NUMERIC(18, 2),
  is_adjustment BOOLEAN DEFAULT false,
  qb_created_at TIMESTAMP WITH TIME ZONE,
  qb_updated_at TIMESTAMP WITH TIME ZONE,

  raw_data JSONB,
  last_synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT quickbooks_je_unique_per_company
    UNIQUE (organization_id, realm_id, qb_journal_entry_id)
);
CREATE INDEX IF NOT EXISTS idx_qb_je_org      ON public.quickbooks_journal_entries(organization_id);
CREATE INDEX IF NOT EXISTS idx_qb_je_company  ON public.quickbooks_journal_entries(quickbooks_company_id);
CREATE INDEX IF NOT EXISTS idx_qb_je_realm    ON public.quickbooks_journal_entries(realm_id);
CREATE INDEX IF NOT EXISTS idx_qb_je_txn_date ON public.quickbooks_journal_entries(txn_date);

CREATE TABLE IF NOT EXISTS public.quickbooks_journal_entry_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  journal_entry_id UUID NOT NULL REFERENCES public.quickbooks_journal_entries(id) ON DELETE CASCADE,
  realm_id TEXT NOT NULL,
  qb_journal_entry_id VARCHAR(100) NOT NULL,

  line_num INTEGER,
  line_id VARCHAR(100),
  description TEXT,
  amount NUMERIC(18, 2),
  posting_type VARCHAR(20),             -- Debit / Credit
  account_id VARCHAR(100),
  account_name VARCHAR(500),
  entity_type VARCHAR(50),
  entity_id VARCHAR(100),
  txn_date DATE,                        -- carried from header for downstream date filtering

  raw_data JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT quickbooks_je_lines_unique
    UNIQUE (organization_id, realm_id, qb_journal_entry_id, line_num)
);
CREATE INDEX IF NOT EXISTS idx_qb_je_li_org     ON public.quickbooks_journal_entry_lines(organization_id);
CREATE INDEX IF NOT EXISTS idx_qb_je_li_je      ON public.quickbooks_journal_entry_lines(journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_qb_je_li_account ON public.quickbooks_journal_entry_lines(account_id);
CREATE INDEX IF NOT EXISTS idx_qb_je_li_date    ON public.quickbooks_journal_entry_lines(txn_date);

-- ============================================================
-- 5. quickbooks_purchases  (QBO Purchase — cash / cc / check expenses)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.quickbooks_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  platform_integration_id UUID REFERENCES public.platform_integrations(id) ON DELETE CASCADE,
  quickbooks_company_id UUID REFERENCES public.platform_integration_organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  realm_id TEXT NOT NULL,

  qb_purchase_id VARCHAR(100) NOT NULL,
  sync_token VARCHAR(50),
  doc_number VARCHAR(100),
  txn_date DATE,
  payment_type VARCHAR(50),             -- Cash / Check / CreditCard
  currency VARCHAR(10),
  exchange_rate NUMERIC(18, 6),
  account_id VARCHAR(100),              -- bank / cc account the payment came from
  entity_id VARCHAR(100),               -- vendor / customer / employee
  entity_name VARCHAR(500),
  private_note TEXT,
  total_amount NUMERIC(18, 2),
  is_credit BOOLEAN DEFAULT false,
  qb_created_at TIMESTAMP WITH TIME ZONE,
  qb_updated_at TIMESTAMP WITH TIME ZONE,

  raw_data JSONB,
  last_synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT quickbooks_purchases_unique_per_company
    UNIQUE (organization_id, realm_id, qb_purchase_id)
);
CREATE INDEX IF NOT EXISTS idx_qb_pur_org      ON public.quickbooks_purchases(organization_id);
CREATE INDEX IF NOT EXISTS idx_qb_pur_company  ON public.quickbooks_purchases(quickbooks_company_id);
CREATE INDEX IF NOT EXISTS idx_qb_pur_realm    ON public.quickbooks_purchases(realm_id);
CREATE INDEX IF NOT EXISTS idx_qb_pur_txn_date ON public.quickbooks_purchases(txn_date);

CREATE TABLE IF NOT EXISTS public.quickbooks_purchase_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  purchase_id UUID NOT NULL REFERENCES public.quickbooks_purchases(id) ON DELETE CASCADE,
  realm_id TEXT NOT NULL,
  qb_purchase_id VARCHAR(100) NOT NULL,

  line_num INTEGER,
  line_id VARCHAR(100),
  detail_type VARCHAR(100),
  description TEXT,
  amount NUMERIC(18, 2),
  account_id VARCHAR(100),
  item_id VARCHAR(100),
  customer_id VARCHAR(100),
  billable_status VARCHAR(50),
  tax_code VARCHAR(50),

  raw_data JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT quickbooks_purchase_lines_unique
    UNIQUE (organization_id, realm_id, qb_purchase_id, line_num)
);
CREATE INDEX IF NOT EXISTS idx_qb_pur_li_org      ON public.quickbooks_purchase_line_items(organization_id);
CREATE INDEX IF NOT EXISTS idx_qb_pur_li_purchase ON public.quickbooks_purchase_line_items(purchase_id);
CREATE INDEX IF NOT EXISTS idx_qb_pur_li_account  ON public.quickbooks_purchase_line_items(account_id);

-- ============================================================
-- 6. quickbooks_payments       (QBO Payment — customer receipts)
-- 7. quickbooks_bill_payments  (QBO BillPayment — supplier payments)
-- 8. quickbooks_credit_memos   (QBO CreditMemo)
-- 9. quickbooks_vendor_credits (QBO VendorCredit)
-- 10. quickbooks_deposits      (QBO Deposit)
-- 11. quickbooks_transfers     (QBO Transfer)
--    Single-table entities — header scalars + raw_data for full fidelity.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.quickbooks_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  platform_integration_id UUID REFERENCES public.platform_integrations(id) ON DELETE CASCADE,
  quickbooks_company_id UUID REFERENCES public.platform_integration_organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  realm_id TEXT NOT NULL,

  qb_payment_id VARCHAR(100) NOT NULL,
  sync_token VARCHAR(50),
  txn_date DATE,
  currency VARCHAR(10),
  exchange_rate NUMERIC(18, 6),
  customer_id VARCHAR(100),
  customer_name VARCHAR(500),
  deposit_account_id VARCHAR(100),
  total_amount NUMERIC(18, 2),
  unapplied_amount NUMERIC(18, 2),
  payment_ref_num VARCHAR(100),
  qb_created_at TIMESTAMP WITH TIME ZONE,
  qb_updated_at TIMESTAMP WITH TIME ZONE,

  raw_data JSONB,
  last_synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT quickbooks_payments_unique_per_company
    UNIQUE (organization_id, realm_id, qb_payment_id)
);
CREATE INDEX IF NOT EXISTS idx_qb_pay_org      ON public.quickbooks_payments(organization_id);
CREATE INDEX IF NOT EXISTS idx_qb_pay_company  ON public.quickbooks_payments(quickbooks_company_id);
CREATE INDEX IF NOT EXISTS idx_qb_pay_realm    ON public.quickbooks_payments(realm_id);
CREATE INDEX IF NOT EXISTS idx_qb_pay_txn_date ON public.quickbooks_payments(txn_date);

CREATE TABLE IF NOT EXISTS public.quickbooks_bill_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  platform_integration_id UUID REFERENCES public.platform_integrations(id) ON DELETE CASCADE,
  quickbooks_company_id UUID REFERENCES public.platform_integration_organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  realm_id TEXT NOT NULL,

  qb_bill_payment_id VARCHAR(100) NOT NULL,
  sync_token VARCHAR(50),
  doc_number VARCHAR(100),
  txn_date DATE,
  currency VARCHAR(10),
  exchange_rate NUMERIC(18, 6),
  vendor_id VARCHAR(100),
  vendor_name VARCHAR(500),
  pay_type VARCHAR(50),                 -- Check / CreditCard
  bank_account_id VARCHAR(100),
  cc_account_id VARCHAR(100),
  total_amount NUMERIC(18, 2),
  private_note TEXT,
  qb_created_at TIMESTAMP WITH TIME ZONE,
  qb_updated_at TIMESTAMP WITH TIME ZONE,

  raw_data JSONB,
  last_synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT quickbooks_bill_payments_unique_per_company
    UNIQUE (organization_id, realm_id, qb_bill_payment_id)
);
CREATE INDEX IF NOT EXISTS idx_qb_bpay_org      ON public.quickbooks_bill_payments(organization_id);
CREATE INDEX IF NOT EXISTS idx_qb_bpay_company  ON public.quickbooks_bill_payments(quickbooks_company_id);
CREATE INDEX IF NOT EXISTS idx_qb_bpay_realm    ON public.quickbooks_bill_payments(realm_id);
CREATE INDEX IF NOT EXISTS idx_qb_bpay_txn_date ON public.quickbooks_bill_payments(txn_date);

CREATE TABLE IF NOT EXISTS public.quickbooks_credit_memos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  platform_integration_id UUID REFERENCES public.platform_integrations(id) ON DELETE CASCADE,
  quickbooks_company_id UUID REFERENCES public.platform_integration_organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  realm_id TEXT NOT NULL,

  qb_credit_memo_id VARCHAR(100) NOT NULL,
  sync_token VARCHAR(50),
  doc_number VARCHAR(100),
  txn_date DATE,
  currency VARCHAR(10),
  exchange_rate NUMERIC(18, 6),
  customer_id VARCHAR(100),
  customer_name VARCHAR(500),
  total_amount NUMERIC(18, 2),
  total_tax NUMERIC(18, 2),
  balance NUMERIC(18, 2),
  remaining_credit NUMERIC(18, 2),
  private_note TEXT,
  qb_created_at TIMESTAMP WITH TIME ZONE,
  qb_updated_at TIMESTAMP WITH TIME ZONE,

  raw_data JSONB,
  last_synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT quickbooks_credit_memos_unique_per_company
    UNIQUE (organization_id, realm_id, qb_credit_memo_id)
);
CREATE INDEX IF NOT EXISTS idx_qb_cm_org      ON public.quickbooks_credit_memos(organization_id);
CREATE INDEX IF NOT EXISTS idx_qb_cm_company  ON public.quickbooks_credit_memos(quickbooks_company_id);
CREATE INDEX IF NOT EXISTS idx_qb_cm_realm    ON public.quickbooks_credit_memos(realm_id);
CREATE INDEX IF NOT EXISTS idx_qb_cm_txn_date ON public.quickbooks_credit_memos(txn_date);

CREATE TABLE IF NOT EXISTS public.quickbooks_vendor_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  platform_integration_id UUID REFERENCES public.platform_integrations(id) ON DELETE CASCADE,
  quickbooks_company_id UUID REFERENCES public.platform_integration_organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  realm_id TEXT NOT NULL,

  qb_vendor_credit_id VARCHAR(100) NOT NULL,
  sync_token VARCHAR(50),
  doc_number VARCHAR(100),
  txn_date DATE,
  currency VARCHAR(10),
  exchange_rate NUMERIC(18, 6),
  vendor_id VARCHAR(100),
  vendor_name VARCHAR(500),
  ap_account_id VARCHAR(100),
  total_amount NUMERIC(18, 2),
  private_note TEXT,
  qb_created_at TIMESTAMP WITH TIME ZONE,
  qb_updated_at TIMESTAMP WITH TIME ZONE,

  raw_data JSONB,
  last_synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT quickbooks_vendor_credits_unique_per_company
    UNIQUE (organization_id, realm_id, qb_vendor_credit_id)
);
CREATE INDEX IF NOT EXISTS idx_qb_vc_org      ON public.quickbooks_vendor_credits(organization_id);
CREATE INDEX IF NOT EXISTS idx_qb_vc_company  ON public.quickbooks_vendor_credits(quickbooks_company_id);
CREATE INDEX IF NOT EXISTS idx_qb_vc_realm    ON public.quickbooks_vendor_credits(realm_id);
CREATE INDEX IF NOT EXISTS idx_qb_vc_txn_date ON public.quickbooks_vendor_credits(txn_date);

CREATE TABLE IF NOT EXISTS public.quickbooks_deposits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  platform_integration_id UUID REFERENCES public.platform_integrations(id) ON DELETE CASCADE,
  quickbooks_company_id UUID REFERENCES public.platform_integration_organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  realm_id TEXT NOT NULL,

  qb_deposit_id VARCHAR(100) NOT NULL,
  sync_token VARCHAR(50),
  txn_date DATE,
  currency VARCHAR(10),
  exchange_rate NUMERIC(18, 6),
  deposit_to_account_id VARCHAR(100),
  total_amount NUMERIC(18, 2),
  private_note TEXT,
  qb_created_at TIMESTAMP WITH TIME ZONE,
  qb_updated_at TIMESTAMP WITH TIME ZONE,

  raw_data JSONB,
  last_synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT quickbooks_deposits_unique_per_company
    UNIQUE (organization_id, realm_id, qb_deposit_id)
);
CREATE INDEX IF NOT EXISTS idx_qb_dep_org      ON public.quickbooks_deposits(organization_id);
CREATE INDEX IF NOT EXISTS idx_qb_dep_company  ON public.quickbooks_deposits(quickbooks_company_id);
CREATE INDEX IF NOT EXISTS idx_qb_dep_realm    ON public.quickbooks_deposits(realm_id);
CREATE INDEX IF NOT EXISTS idx_qb_dep_txn_date ON public.quickbooks_deposits(txn_date);

CREATE TABLE IF NOT EXISTS public.quickbooks_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  platform_integration_id UUID REFERENCES public.platform_integrations(id) ON DELETE CASCADE,
  quickbooks_company_id UUID REFERENCES public.platform_integration_organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  realm_id TEXT NOT NULL,

  qb_transfer_id VARCHAR(100) NOT NULL,
  sync_token VARCHAR(50),
  txn_date DATE,
  currency VARCHAR(10),
  from_account_id VARCHAR(100),
  to_account_id VARCHAR(100),
  amount NUMERIC(18, 2),
  private_note TEXT,
  qb_created_at TIMESTAMP WITH TIME ZONE,
  qb_updated_at TIMESTAMP WITH TIME ZONE,

  raw_data JSONB,
  last_synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT quickbooks_transfers_unique_per_company
    UNIQUE (organization_id, realm_id, qb_transfer_id)
);
CREATE INDEX IF NOT EXISTS idx_qb_trf_org      ON public.quickbooks_transfers(organization_id);
CREATE INDEX IF NOT EXISTS idx_qb_trf_company  ON public.quickbooks_transfers(quickbooks_company_id);
CREATE INDEX IF NOT EXISTS idx_qb_trf_realm    ON public.quickbooks_transfers(realm_id);
CREATE INDEX IF NOT EXISTS idx_qb_trf_txn_date ON public.quickbooks_transfers(txn_date);

-- ============================================================
-- 12. quickbooks_vendors    (QBO Vendor)
-- 13. quickbooks_customers   (QBO Customer)
-- 14. quickbooks_items       (QBO Item)
--    Reference data (no date filter).
-- ============================================================
CREATE TABLE IF NOT EXISTS public.quickbooks_vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  platform_integration_id UUID REFERENCES public.platform_integrations(id) ON DELETE CASCADE,
  quickbooks_company_id UUID REFERENCES public.platform_integration_organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  realm_id TEXT NOT NULL,

  qb_vendor_id VARCHAR(100) NOT NULL,
  sync_token VARCHAR(50),
  display_name VARCHAR(500),
  company_name VARCHAR(500),
  email VARCHAR(500),
  phone VARCHAR(100),
  balance NUMERIC(18, 2),
  is_active BOOLEAN DEFAULT true,
  is_1099 BOOLEAN DEFAULT false,
  qb_created_at TIMESTAMP WITH TIME ZONE,
  qb_updated_at TIMESTAMP WITH TIME ZONE,

  raw_data JSONB,
  last_synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT quickbooks_vendors_unique_per_company
    UNIQUE (organization_id, realm_id, qb_vendor_id)
);
CREATE INDEX IF NOT EXISTS idx_qb_vend_org     ON public.quickbooks_vendors(organization_id);
CREATE INDEX IF NOT EXISTS idx_qb_vend_company ON public.quickbooks_vendors(quickbooks_company_id);
CREATE INDEX IF NOT EXISTS idx_qb_vend_realm   ON public.quickbooks_vendors(realm_id);

CREATE TABLE IF NOT EXISTS public.quickbooks_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  platform_integration_id UUID REFERENCES public.platform_integrations(id) ON DELETE CASCADE,
  quickbooks_company_id UUID REFERENCES public.platform_integration_organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  realm_id TEXT NOT NULL,

  qb_customer_id VARCHAR(100) NOT NULL,
  sync_token VARCHAR(50),
  display_name VARCHAR(500),
  company_name VARCHAR(500),
  email VARCHAR(500),
  phone VARCHAR(100),
  balance NUMERIC(18, 2),
  is_active BOOLEAN DEFAULT true,
  qb_created_at TIMESTAMP WITH TIME ZONE,
  qb_updated_at TIMESTAMP WITH TIME ZONE,

  raw_data JSONB,
  last_synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT quickbooks_customers_unique_per_company
    UNIQUE (organization_id, realm_id, qb_customer_id)
);
CREATE INDEX IF NOT EXISTS idx_qb_cust_org     ON public.quickbooks_customers(organization_id);
CREATE INDEX IF NOT EXISTS idx_qb_cust_company ON public.quickbooks_customers(quickbooks_company_id);
CREATE INDEX IF NOT EXISTS idx_qb_cust_realm   ON public.quickbooks_customers(realm_id);

CREATE TABLE IF NOT EXISTS public.quickbooks_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  platform_integration_id UUID REFERENCES public.platform_integrations(id) ON DELETE CASCADE,
  quickbooks_company_id UUID REFERENCES public.platform_integration_organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  realm_id TEXT NOT NULL,

  qb_item_id VARCHAR(100) NOT NULL,
  sync_token VARCHAR(50),
  name VARCHAR(500),
  fully_qualified_name VARCHAR(1000),
  item_type VARCHAR(100),
  description TEXT,
  unit_price NUMERIC(18, 6),
  purchase_cost NUMERIC(18, 6),
  income_account_id VARCHAR(100),
  expense_account_id VARCHAR(100),
  asset_account_id VARCHAR(100),
  is_active BOOLEAN DEFAULT true,
  qb_created_at TIMESTAMP WITH TIME ZONE,
  qb_updated_at TIMESTAMP WITH TIME ZONE,

  raw_data JSONB,
  last_synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT quickbooks_items_unique_per_company
    UNIQUE (organization_id, realm_id, qb_item_id)
);
CREATE INDEX IF NOT EXISTS idx_qb_item_org     ON public.quickbooks_items(organization_id);
CREATE INDEX IF NOT EXISTS idx_qb_item_company ON public.quickbooks_items(quickbooks_company_id);
CREATE INDEX IF NOT EXISTS idx_qb_item_realm   ON public.quickbooks_items(realm_id);

-- ============================================================
-- 15. quickbooks_profit_loss  (QBO ProfitAndLoss report)
--    One row per (account × calendar month). Mirrors xero_profit_loss.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.quickbooks_profit_loss (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  platform_integration_id UUID REFERENCES public.platform_integrations(id) ON DELETE CASCADE,
  quickbooks_company_id UUID REFERENCES public.platform_integration_organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  realm_id TEXT NOT NULL,

  from_date    DATE     NOT NULL,
  to_date      DATE     NOT NULL,
  period_year  SMALLINT NOT NULL,
  period_month SMALLINT NOT NULL,

  -- QBO P&L section title, e.g. Income / COGS / Expenses / Other Income /
  -- Other Expense (as returned by the report's row group hierarchy).
  section VARCHAR(255),

  -- QBO Account.Id — soft FK to quickbooks_chart_of_accounts.qb_account_id.
  qb_account_id VARCHAR(100) NOT NULL,
  account_name  VARCHAR(500),

  -- Amount exactly as shown in the QBO P&L for the period.
  amount NUMERIC(18, 2) NOT NULL DEFAULT 0,

  raw_data JSONB,
  synced_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT quickbooks_profit_loss_unique_per_period
    UNIQUE (organization_id, realm_id, qb_account_id, to_date)
);
CREATE INDEX IF NOT EXISTS idx_qb_pl_org       ON public.quickbooks_profit_loss(organization_id);
CREATE INDEX IF NOT EXISTS idx_qb_pl_company   ON public.quickbooks_profit_loss(quickbooks_company_id);
CREATE INDEX IF NOT EXISTS idx_qb_pl_realm     ON public.quickbooks_profit_loss(realm_id);
CREATE INDEX IF NOT EXISTS idx_qb_pl_to_date   ON public.quickbooks_profit_loss(to_date);
CREATE INDEX IF NOT EXISTS idx_qb_pl_section   ON public.quickbooks_profit_loss(section);
CREATE INDEX IF NOT EXISTS idx_qb_pl_account   ON public.quickbooks_profit_loss(qb_account_id);
CREATE INDEX IF NOT EXISTS idx_qb_pl_period    ON public.quickbooks_profit_loss(organization_id, realm_id, period_year, period_month);

-- ─────────────────────────────────────────────────────────────
-- Row Level Security — org-membership gated, mirrors xero_* policies.
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  t TEXT;
  tbls TEXT[] := ARRAY[
    'quickbooks_chart_of_accounts',
    'quickbooks_invoices',
    'quickbooks_invoice_line_items',
    'quickbooks_bills',
    'quickbooks_bill_line_items',
    'quickbooks_journal_entries',
    'quickbooks_journal_entry_lines',
    'quickbooks_purchases',
    'quickbooks_purchase_line_items',
    'quickbooks_payments',
    'quickbooks_bill_payments',
    'quickbooks_credit_memos',
    'quickbooks_vendor_credits',
    'quickbooks_deposits',
    'quickbooks_transfers',
    'quickbooks_vendors',
    'quickbooks_customers',
    'quickbooks_items',
    'quickbooks_profit_loss'
  ];
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', t || '_select', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT USING (public.user_in_org(auth.uid(), organization_id));',
      t || '_select', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', t || '_insert', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (public.user_in_org(auth.uid(), organization_id));',
      t || '_insert', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', t || '_update', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE USING (public.user_in_org(auth.uid(), organization_id)) WITH CHECK (public.user_in_org(auth.uid(), organization_id));',
      t || '_update', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', t || '_delete', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE USING (public.user_in_org(auth.uid(), organization_id));',
      t || '_delete', t);
  END LOOP;
END $$;

COMMENT ON TABLE public.quickbooks_chart_of_accounts IS 'QuickBooks Online Chart of Accounts (Account). Phase-2 read pipeline. Created 2026-05-19.';
COMMENT ON TABLE public.quickbooks_invoices          IS 'QuickBooks Online Invoices (ACCREC). Created 2026-05-19.';
COMMENT ON TABLE public.quickbooks_bills             IS 'QuickBooks Online Bills (ACCPAY). Created 2026-05-19.';
COMMENT ON TABLE public.quickbooks_journal_entries   IS 'QuickBooks Online manual JournalEntry headers. Created 2026-05-19.';
COMMENT ON TABLE public.quickbooks_journal_entry_lines IS 'QuickBooks Online JournalEntry lines (debit/credit). Created 2026-05-19.';
COMMENT ON TABLE public.quickbooks_profit_loss       IS 'QuickBooks Online P&L report — one row per account per calendar month. Join quickbooks_chart_of_accounts on qb_account_id. Created 2026-05-19.';

COMMIT;
