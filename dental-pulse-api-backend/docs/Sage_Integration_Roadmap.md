# Sage Integration Roadmap — Sab Kuch Ek Place Pe

**Last Updated:** 2026-05-28 (PART A.5 + PART B Wave 1 done; Wave 2 built — awaiting test)
**Branch:** `feature/sage-integration`
**Current State:** Phase 1 + 2 + 2b + PART A.5 + Wave 1 complete; Wave 2 code built, migration + Sync Now test pending

---

## Quick Status

| Metric | Value |
|---|---|
| Entities Live | 6 (Suppliers, COA, Purchase Invoices+lines, Contact Persons, Bank Accounts, Bank Transactions) |
| Database Pattern | MIXED (3 dedicated `sage_*` + 2 shared `platform_*`) — needs migration to dedicated |
| Queue/Processor | Not built (sync-based dev endpoints) |
| Canonical ETL | Not built (Sage invoices not visible in `/accounts-payable`) |
| Auth | JWT middleware applied (uncommitted) |
| Production Ready | No |

---

# 🎯 EXECUTION DECISION (2026-05-28)

**Skip PART A for now.** Going straight with:

1. **PART A.5 — Database Migration to Dedicated Tables (Option A)** ← START HERE
2. **PART B — Adding new entities** (after migration done)
3. **PART A — Architecture gaps (queue, ETL, etc.)** → DEFERRED for later

**Rationale:** Pattern consistency with Xero/Iplicit/QuickBooks matters more than queue/ETL right now. Sab providers dedicated tables use kare che, only Sage hybrid hatu — pehla fix karyu.

---

# ✅ PART A.5: Database Architecture Migration (Option A) — COMPLETED 2026-05-28

## Problem Discovered (2026-05-28)

Sage currently uses MIXED table pattern, unlike all other providers:

| Provider | Pattern |
|---|---|
| **Xero** | All `xero_*` dedicated tables (migrated 2026-04-23) |
| **Iplicit** | All `iplicit_*` dedicated tables (day 1) |
| **QuickBooks** | All `quickbooks_*` dedicated tables (day 1, 2026-05-19) |
| **Sage** | ❌ MIXED — 3 dedicated + 2 shared (`platform_integration_*`) |

## Current Sage Tables (Mixed State)

| Sage Entity | Current Table | Should Be |
|---|---|---|
| Suppliers | `sage_suppliers` ✅ | `sage_suppliers` (already correct) |
| Bank Accounts | `sage_bank_accounts` ✅ | `sage_bank_accounts` (already correct) |
| Bank Transactions | `sage_bank_transactions` ✅ | `sage_bank_transactions` (already correct) |
| **Chart of Accounts** | `platform_integration_chart_of_accounts` ❌ | `sage_chart_of_accounts` |
| **Purchase Invoices** | `platform_integration_invoices` ❌ | `sage_invoices` |
| **Invoice Line Items** | `platform_integration_invoice_line_items` ❌ | `sage_invoice_line_items` |

## Migration Plan (Option A) — ALL DONE ✅

### Sub-step 1: Create New Dedicated Tables (Migration SQL) — ✅ DONE
- [x] Created `sage_chart_of_accounts`, `sage_invoices`, `sage_invoice_line_items`
- [x] Full RLS + indexes + updated_at triggers
- **Migration file:** `20260528000001_sage_dedicated_tables.sql` — applied to Supabase

### Sub-step 2: Migrate Existing Data — ⏭️ SKIPPED
- Approach: Re-sync from Sage API instead of SQL data migration
- Cleaner data, populates `raw_data` columns, tests new code

### Sub-step 3: Update Backend Service Code — ✅ DONE
- [x] `coaService.js` writes to `sage_chart_of_accounts`
- [x] `invoiceService.js` writes to `sage_invoices` + `sage_invoice_line_items`
- [x] `transformers/sage.js` dispatcher updated; column names cleaned (no `coa_` prefix)
- [x] Verified via Sync Now → 132 COA + 5 invoices + 5 lines in new tables

### Sub-step 4: Update Frontend Read Code — ✅ DONE
- [x] `SageDataViewer.tsx` queries dedicated `sage_*` tables
- [x] All 3 tabs working: 5 suppliers, 132 COA, 5 invoices + 5 line items
- [x] Verified at http://localhost:8080/sage-data

### Sub-step 5: Cleanup Old Data — ✅ DONE
- [x] Deleted 10 Sage rows from `platform_integration_invoices` (+ their line items)
- [x] Deleted 264 Sage rows from `platform_integration_chart_of_accounts`
- [x] Verified: 0 / 0 remaining in old tables (other providers unaffected)

**Final State:** Sage is now 100% on dedicated `sage_*` tables — matches Xero/Iplicit/QuickBooks pattern.

---

# PART B: Entities Add karva — Priority Order

**⚠️ Prerequisite:** PART A.5 (Database Migration) MUST be done first. All new entities will write to dedicated `sage_*` tables.

## Already Done (6 entities)

| # | Entity | Sage Endpoint | Current Table | Target Table (post-migration) | Live Count |
|---|---|---|---|---|---|
| 1 | Suppliers | `/contacts` (filter VENDOR) | `sage_suppliers` ✅ | `sage_suppliers` (no change) | 5 rows |
| 2 | Chart of Accounts | `/ledger_accounts` | `platform_integration_chart_of_accounts` ⚠️ | `sage_chart_of_accounts` (after migration) | 132 rows |
| 3 | Purchase Invoices + Line Items | `/purchase_invoices` | `platform_integration_invoices` + `_line_items` ⚠️ | `sage_invoices` + `sage_invoice_line_items` | 5 + 5 rows |
| 4 | Contact Persons (enrichment) | `/contact_persons` | UPDATES `sage_suppliers` ✅ | UPDATES `sage_suppliers` (no change) | 0 enriched |
| 5 | Bank Accounts | `/bank_accounts` | `sage_bank_accounts` ✅ | `sage_bank_accounts` (no change) | 2 rows |
| 6 | Bank Transactions | `/contact_payments` | `sage_bank_transactions` ✅ | `sage_bank_transactions` (no change) | 0 rows |

## HIGH Priority — Wave 1 (✅ DONE 2026-05-28)

| # | Entity | Sage Endpoint | Target Table | Status | Live Count |
|---|---|---|---|---|---|
| 1 | **Tax Rates** | `/tax_rates` | `sage_tax_rates` | ✅ DONE | 5 (UK VAT) |
| 2 | **Purchase Credit Notes** | `/purchase_credit_notes` | `sage_credit_notes` + `sage_credit_note_line_items` | ✅ DONE | 0 (empty tenant) |
| 3 | **Journals** | `/journals` | `sage_journals` + `sage_journal_lines` | ✅ DONE | 0 (empty tenant) |

**Migration:** `20260528000002_sage_tax_rates_credit_notes_journals.sql` applied to Supabase

## MEDIUM Priority — Wave 2 (code built 2026-05-28; awaiting test)

| # | Entity | Sage Endpoint | Target Table | Status |
|---|---|---|---|---|
| 4 | **Payment Methods** | `/payment_methods` | `sage_payment_methods` | 🆕 Built |
| 5 | **Products/Services** | `/products` + `/services` | `sage_products` (combined) | 🆕 Built |
| 6 | **Other Payments** | `/other_payments` | `sage_other_payments` | 🆕 Built |
| 7 | **Other Receipts** | `/other_receipts` | `sage_other_receipts` | 🆕 Built |
| 8 | **Bank Transfers** | `/bank_transfers` | `sage_bank_transfers` | 🆕 Built |
| 9 | **Attachments** | `/attachments` | `sage_attachments` | 🆕 Built |

**Migration to apply:** `20260528000003_sage_wave_2_entities.sql`

## MEDIUM Priority

| # | Entity | Sage Endpoint | Target Table | Why |
|---|---|---|---|---|
| 4 | **Attachments** | `/attachments` | `sage_attachments` (NEW) | Bridges to Invoice OCR pipeline (huge win) |
| 5 | **Products/Services** | `/products` + `/services` | `sage_products` (NEW) | Iplicit has it. Useful for matching invoice lines. |
| 6 | **Payment Methods** | `/payment_methods` | `sage_payment_methods` (NEW lookup) | BACS/cheque/card/transfer lookup |
| 7 | **Other Payments** | `/other_payments` | `sage_other_payments` (NEW) | Bank charges, transfers OUT (not tied to contact) |
| 8 | **Other Receipts** | `/other_receipts` | `sage_other_receipts` (NEW) | Interest, transfers IN (not tied to contact) |
| 9 | **Bank Transfers** | `/bank_transfers` | `sage_bank_transfers` (NEW) | Transfers between bank accounts |

## LOW Priority

| # | Entity | Sage Endpoint | Target Table | Why Lower |
|---|---|---|---|---|
| 10 | **Contact Allocations** | `/contact_allocations` | `sage_contact_allocations` (NEW) | Overpayment/credit allocation links |
| 11 | **Quick Entries** | `/quick_entries` | `sage_quick_entries` (NEW) | Sage shortcut entries — niche |
| 12 | **Bank Deposited Funds** | `/bank_deposited_funds` | `sage_bank_deposited_funds` (NEW) | Bank deposits — niche |
| 13 | **Recurring Invoices** | `/recurring_invoices` | `sage_recurring_invoices` (NEW) | If dental has recurring bills |
| 14 | **Stock Items** | `/stock_items` | `sage_stock_items` (NEW) | Inventory — usually empty for dental |

## SKIP (Not Useful for Dental SaaS)

| Entity | Why Skip |
|---|---|
| Sales Invoices | Dental uses Dentally for patient billing |
| Customer Contacts | Dental "customer" = patient = Dentally side |
| Balance Sheet API | Sage v3.1 ma exist nathi |
| Profit & Loss API | Sage v3.1 ma exist nathi |

---

# ⏸️ PART A: Architecture Gaps — DEFERRED FOR LATER

**Status:** Deferred per 2026-05-28 decision. Will revisit AFTER PART A.5 + PART B complete.

## Critical (Production-readiness)

| # | Task | Why Needed | Effort |
|---|---|---|---|
| 1 | **`sageToCanonical.js` normalizer** | Sage invoices `/accounts-payable` page ma display nathi thata. Staging → production AP table ETL. Mirror `xeroToCanonical.js`. | ~1-2 hrs |
| 2 | **Sage Queue + Processor** | Atyare synchronous dev-sync endpoints (blocks ~3-10s). Real async queue jevu Xero/Iplicit/QB ma chhe. Files: `backend/queue/sage/{jobQueue,processor}.js` | ~1 day |
| 3 | **`SageQueue.initialize()`** in `server.js` | Other 4 queues alongside register (JobQueue, IplicitQueue, XeroQueue, QuickBooksQueue) | 15 min |
| 4 | **Async sync routes** | Replace dev-sync with: `POST /trigger/:orgId[/:entity]`, `GET /sync-status/:orgId`, `POST /cancel/:jobId` | ~2 hrs |
| 5 | **`backend/api/sage/config.js`** | Entity registry like Xero/Iplicit have (ENTITIES array, TABLE_MAP, priority, dateFilter) | 30 min |
| 6 | **Use shared `sync_jobs` table** | Track sync status, progress, errors — same as other providers | ~1 hr |
| 7 | **Frontend per-entity progress UI** | Real-time "120/132 done" counts + cancel button (atyare just single label per entity) | ~2 hrs |

## Production Deploy Prep

| # | Task | Why |
|---|---|---|
| 8 | Regenerate `SAGE_CLIENT_SECRET` | Current chat-leaked: `bDX[GVsx#Tn}Dy?:/GHh` |
| 9 | Add production callback URL | `https://dent-enterprise-api.dentpulse.com/api/sage/callback` |
| 10 | Re-register Sage app under company email | Currently Ravi's personal `dfaldu387@gmail.com` |
| 11 | Update `CORS_ALLOWED_ORIGINS` for prod | Include `enterprise.dentpulse.com` |
| 12 | Optional: Port OAuth to Supabase edge function | Vercel-prod parity with Xero |
| 13 | Regenerate Sage MFA recovery key | Current chat-leaked: `S9ECMRYUQGE9ZEVYWFCBSJYA` |

## Testing Gaps

| # | Task |
|---|---|
| 14 | Token refresh tested under REAL expiry (5-min TTL) |
| 15 | Rate limiting tested (Sage ~5 req/sec) |
| 16 | Multi-page pagination (real client 500+ suppliers) |
| 17 | 5xx retry behavior |
| 18 | Token mid-sync expiry scenarios |
| 19 | Verify Sage's 132 COA auto-appears in `/treatments`, `/material-costs`, `/overhead-costs`, `/staff-costs` (theory says yes via `useChartOfAccounts`, untested) |

## Cleanup Items

| # | Task |
|---|---|
| 20 | Commit pending 2026-05-25 work (5 backend + 1 frontend + 2 migrations) |
| 21 | Add Bank Accounts + Bank Transactions tabs to `/sage-data` viewer page |
| 22 | Open PR: `feature/sage-integration` → `main` (both repos) |
| 23 | Remove TEMP DEBUG from `backend/routes/onboard.js` (7+ sessions old!) |
| 24 | Handle `docs/` folder (gitignore/commit/delete) |
| 25 | Manager: add SAGE env vars to dev server + restart |

## Auth Hardening (Already Started)

| # | Task | Status |
|---|---|---|
| A1 | `syncAuthMiddleware` on Sage routes | DONE (uncommitted) |
| A2 | Frontend JWT via `getSageAuthHeaders()` (3 fetch calls) | DONE (uncommitted) |
| A3 | Deep org-membership check inside handlers | Pending (matches Xero/Iplicit pattern intentionally) |
| A4 | Stronger CSRF for `/connect` + `/callback` | Pending (atyare 10-min Map) |
| A5 | Test auth under JWT expiry mid-sync | Pending |

---

# Provider Comparison

| Provider | Entities | Tables Pattern | ETL | Queue | Auth | Status |
|---|---|---|---|---|---|---|
| **Xero** | 7 | All `xero_*` dedicated | Yes (`xeroToCanonical.js`) | Yes | Yes | Production-ready |
| **Iplicit** | 12-13 | All `iplicit_*` dedicated | Yes | Yes | Yes | Production-ready |
| **QuickBooks** | 19 tables | All `quickbooks_*` dedicated | TBD | Yes | Yes | Recently merged |
| **Sage** | 6 | ⚠️ MIXED (3 dedicated + 2 shared) → migrating | No | No | Yes (uncommitted) | Dev-only |

---

# Summary

| Layer | Current | Target |
|---|---|---|
| **Tables Pattern** | ⚠️ Mixed (3 dedicated + 2 shared) | ✅ All `sage_*` dedicated (Option A) |
| **Entities** | 6 | 12-15 (match Iplicit) |
| **Queue/Processor** | Synchronous dev-sync | (Deferred) Async + sync_jobs |
| **Canonical ETL** | None | (Deferred) `sageToCanonical.js` → `/accounts-payable` |
| **Production deploy** | Dev only | (Deferred) Prod callback + edge function |
| **Per-entity progress** | Single label | (Deferred) "120/132 done" + cancel |

# Recommended Execution Order (UPDATED 2026-05-28)

1. **PART A.5 — Database Migration to Dedicated Tables (Option A)** ⭐ START HERE
   - Create `sage_chart_of_accounts`, `sage_invoices`, `sage_invoice_line_items`
   - Migrate existing 132 COA + 5 invoices + 5 lines
   - Update service code
   - Verify "Sync Now" still works
   - Cleanup old shared-table rows
2. **PART B — Add HIGH Priority entities** (Credit Notes, Tax Rates, Journals) — all to dedicated `sage_*` tables
3. **PART B — Add MEDIUM Priority entities** (Attachments, Products, Payment Methods, etc.)
4. **PART A — Architecture Gaps** (canonical ETL, queue, processor) — when needed for production
5. **Production deploy prep**

---

# Key Reference Points

## Sage OAuth Quick Facts

- **Authorize URL:** `https://www.sageone.com/oauth2/auth/central` (with `country=gb&locale=en-GB`)
- **Token URL:** `https://oauth.accounting.sage.com/token`
- **API base:** `https://api.accounting.sage.com/v3.1`
- **access_token TTL:** 5 minutes (refresh mandatory)
- **refresh_token TTL:** 31 days
- **Scope:** `full_access`

## Critical Sage API Gotchas

1. List endpoints sparse by default — always `?attributes=all`
2. Amounts are STRINGS — always `parseFloat()`
3. No global `/bank_transactions` endpoint — use `/contact_payments`
4. `main_address` + `main_contact_person` stay as refs even with attributes=all
5. `nominal_code` is number; display 4-digit padded
6. 404 PathNotFound has distinct shape (`$dataCode: "PathNotFound"`)

## Database Pattern Reference (Other Providers)

- **Xero migration example:** `supabase/migrations/20260423000002_xero_dedicated_tables.sql`
- **QuickBooks day-1 example:** `supabase/migrations/20260519000001_quickbooks_dedicated_tables.sql`
- **Iplicit per-entity:** Multiple migrations under `iplicit_*` prefix

Use these as templates for the upcoming `sage_dedicated_tables.sql` migration.

## Subscription State

- Product: Sage Accounting Standard
- Trial: FREE until 2026-06-20
- Auto-charge: £46.80/mo to Visa 3610
- Cancel deadline: ~2026-06-15
- Account: `support@dentpulse.com` (Shishir Khadka, manager-authorized)

## Active IDs

- Test org: `137f09b4-7ea1-4d61-8816-e827c64729c4`
- Sage integration_id: `1745d9d0-9d3c-451a-ab37-0e26a41f15c6`
- Supabase project: `fpqesehkowpvxraommsc`
