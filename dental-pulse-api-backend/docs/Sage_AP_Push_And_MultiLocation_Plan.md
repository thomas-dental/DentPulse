# Sage — Accounts Payable Push + Multi-Location Plan

> **Status:** PLAN ONLY — no code started.
> **Created:** 2026-06-01 (manager day-start brief)
> **Principle:** Mirror the existing **Xero** AP-push flow exactly (`supabase/functions/xero-create-invoice/index.ts`).
> **Two tasks:**
> 1. **Feature 1** — Push uploaded Accounts-Payable invoices directly into Sage.
> 2. **Feature 2** — Connect multiple Sage accounts across different practice locations under one user/org.
>
> **Build order:** Feature 1 first (works on current single-connection model, fast to test live), then Feature 2.

---

## Background — how Xero does it today (the template we copy)

- **Trigger:** Manual button **"Send to Xero"** (or **"Update in Xero"** if already pushed) in `InvoiceDetailsDrawer.tsx` → `handleSendToAccounting()`. **Not** auto-on-approval.
- **Status:** User-selectable dropdown — **DRAFT / SUBMITTED / AUTHORISED / PAID**. (`PAID` is created as `AUTHORISED` then a payment is added — Xero can't create directly as PAID.)
- **Where the code lives:** Supabase **edge function** `xero-create-invoice` (885 lines). QuickBooks mirrors it (`quickbooks-create-invoice`). iplicit instead uses a **backend route** (`/api/iplicit-invoice/create|update`).
- **Data really goes to Xero:** the edge function POSTs to `https://api.xero.com/api.xro/2.0` — creates the Contact, the Invoice (`ACCPAY`), and optionally a Payment. We only store a **reference** back in Supabase: `platform_invoice_id`, `platform_status`, `shared_at` (and `paid_at`, `bank_account_id` if paid).
- **Per-location connection:** Xero resolves which tenant to use via `platform_integration_organization_mapping` (location_id → Xero org). This infra is **already built** and is what Feature 2 reuses.

### Decision locked
- Approach = **edge function** `sage-create-invoice` (mirror Xero). _(Alternative considered: backend route reusing `backend/api/sage/client.js` — would reuse Sage token logic but diverge from the Xero/QB drawer pattern. Chosen edge function for parity.)_
- Trigger = **manual "Send to Sage" button**.
- Status = **user-selectable** (Sage draft vs final).

---

## Current Sage state (what exists)

- **Read-only / pull only** — 15 entities synced FROM Sage into dedicated `sage_*` tables. **Zero writes** to Sage today.
- **Single-tenant** — connection stored in `platform_integrations` keyed by `organization_id` + `platform_name='sage'` only (`saveTokens` does `.maybeSingle()` upsert → a second Sage connect would **overwrite** the first).
- Sage business/tenant info mirrored into `platform_integration_organizations` (PIO) by `saveSageTenant()`.
- We **already sync** Sage Chart of Accounts (`sage_chart_of_accounts`) and Tax Rates (`sage_tax_rates`) → gives us the `ledger_account_id` / `tax_rate_id` GUIDs needed to push.
- AP invoice table `accounts_payable_invoice` already has: `location_id`, `platform_integration_id`, `platform_integration_organization_id`, `platform_invoice_id`, `platform_status`, `platform_name`, `shared_at`, `paid_at`, `bank_account_id`. Line items have `platform_account_id`.

### Key files
| Purpose | Path |
|---|---|
| Xero push (template) | `dental-pulse-dev/supabase/functions/xero-create-invoice/index.ts` |
| QuickBooks push (template) | `dental-pulse-dev/supabase/functions/quickbooks-create-invoice/index.ts` |
| Drawer (trigger + routing) | `dental-pulse-dev/src/components/accounts-payable/InvoiceDetailsDrawer.tsx` (`handleSendToAccounting`, ~L985; provider routing ~L1163) |
| Sage API client (backend) | `dental-pulse-api-backend/backend/api/sage/client.js` (`sageGet`, token refresh, `saveSageTenant`) |
| Sage routes (backend) | `dental-pulse-api-backend/backend/routes/sageSync.js` (connect/callback/dev-sync) |
| AP invoice schema | `dental-pulse-dev/supabase/migrations/20260123000010_*.sql` + line items `..._00011_*.sql` |

---

## FEATURE 1 — AP → Sage push

### New edge function: `supabase/functions/sage-create-invoice/index.ts`
Mirror `xero-create-invoice` step-for-step, swapping the Xero API for the Sage Accounting API (`https://api.accounting.sage.com/v3.1`).

| # | Xero does | Sage equivalent |
|---|---|---|
| 1 | Receive `{invoiceId, bankAccountId, xeroInvoiceId?, invoice:{...formData, line_items, status}}` | **Same request body shape** |
| 2 | Resolve tenant (via location mapping / fallback) | Resolve Sage `platform_integrations` row — **F1: by org**; **F2: by `location_id`** via `platform_integration_organization_mapping` |
| 3 | Refresh access token (Xero identity URL) | Refresh via Sage token URL (`SAGE_CLIENT_ID`/`SECRET`), 5-min token + 60s buffer |
| 4 | Search `/Contacts` → create if missing | `GET /contacts?contact_type_id=VENDOR` (by name/reference) → if missing `POST /contacts` `{name, contact_type_ids:["VENDOR"], reference}` → keep `contact_id` |
| 5 | Build `LineItems` (Description, Quantity, UnitAmount, AccountCode?, TaxType) | Build `invoice_lines` `{description, ledger_account_id, quantity, unit_price, tax_rate_id}` — map `platform_account_id` → Sage `ledger_account_id`; tax → `tax_rate_id` |
| 6 | Status: DRAFT/SUBMITTED/AUTHORISED; PAID→AUTHORISED then add payment | Same logic with Sage statuses; PAID → create then add payment |
| 7 | `POST /Invoices` Type `ACCPAY` | `POST /purchase_invoices` → `{purchase_invoice:{contact_id, date, due_date, vendor_reference, invoice_lines[]}}` (supplier's bill no. → `vendor_reference`; Sage has no `invoice_number` field) |
| 8 | If PAID + bank account → `POST /Payments` | If PAID + bank account → Sage purchase-invoice payment endpoint **(confirm exact endpoint at build time)** |
| 9 | _(Xero: no attachment)_ | 🆕 **`POST /attachments`** — original PDF base64 (`file`, `file_name`, `mime_type`) linked via `attachment_context_type_id` + `attachment_context_id` (= invoice **`origin_id`**) + `transaction_id` |
| 10 | Update AP row: `platform_invoice_id`, `platform_status`, `shared_at` (+ `paid_at`, `bank_account_id`) | **Same**, plus `platform_name='sage'` |

### Frontend changes — `InvoiceDetailsDrawer.tsx`
1. Add Sage to the edge-function routing branch:
   ```ts
   } else if (platform === 'sage') {
     functionName = 'sage-create-invoice';
   }
   ```
2. Extend `getAccountCode()` to resolve the Sage ledger-account id (next to iplicit `account_id` / xero `coa_account_id` / qb `qb_account_id`).
3. Ensure `sage` is recognised in `connectedPlatform` / `platformConfig` so the generic **"Send to Sage"** button + validation render automatically.

### Config
- Add Supabase edge-function secrets: `SAGE_CLIENT_ID`, `SAGE_CLIENT_SECRET`, Sage token URL.

### Verify during build (open technical items)
1. How `platform_account_id` maps to a Sage `ledger_account_id` GUID (which CoA table/column).
2. Exact Sage **payment** endpoint + body for paying a purchase invoice.
3. Exact `attachment_context_type_id` for purchase invoices, and `origin_id` vs `id` for the context link (Sage docs warn these differ).
4. Sage tax: when a line `tax_amount` is sent, `tax_rate_id` becomes required.
5. OAuth scope must be `full_access` (we already have it).

---

## FEATURE 2 — Multiple Sage accounts per practice location

Bring Sage up to Xero's multi-tenant model. Most of the infra (`platform_integration_organization_mapping`) already exists from Xero.

| # | Sage today (single) | New (Xero-style multi) |
|---|---|---|
| 1 | `saveTokens` upserts on org+platform → overwrites | Allow multiple `platform_integrations` sage rows (key on org+platform+`platform_org_id`) |
| 2 | Connect has no location | `/api/sage/connect` accepts `location_id`, passes it through OAuth `state` |
| 3 | Callback just saves token | Callback reads `location_id` back |
| 4 | No mapping | Write row in `platform_integration_organization_mapping` (location → Sage PIO row) — same table Xero uses |
| 5 | dev-sync per `orgId` | Make sync location-aware / loop each Sage connection |
| 6 | Push uses org's sage | Push (Feature 1) resolves Sage connection by invoice's `location_id` |
| 7 | Single connection UI | Practice-Location-Mapping UI: "Connect Sage" per location, show each location's Sage business (mirror Xero/QB) |

### Migration / risk
- The existing **live** Sage connection must be preserved — decide whether to auto-map it to a default location or require a clean re-connect.

---

## Open decisions (confirm before/while building)
1. ~~Code location — edge function vs backend route~~ → **edge function** (locked, mirror Xero).
2. ~~Trigger — manual vs auto~~ → **manual "Send to Sage" button** (locked).
3. ~~Draft vs final~~ → **user-selectable status** (locked).
4. Feature 2 assumption: **one Sage business per practice location** — confirm.
5. Existing live Sage connection on Feature 2 rollout: auto-map to a default location, or clean re-connect?

---

## Build sequence
1. **Feature 1** on current single-connection model → live end-to-end test (£ test invoice → appears in Sage with PDF attached).
2. **Feature 2** multi-location → then point Feature 1's connection lookup at `invoice.location_id`.
