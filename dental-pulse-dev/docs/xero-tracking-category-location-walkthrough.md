# Xero tracking category walkthrough — DentPulse vs Xero

Use this guide to verify that **Dentally locations** map to a **Xero organisation**, then to a **Xero tracking category / option**, and that financial screens in DentPulse match the same tracking-filtered numbers in Xero.

The model is:

```
Dentally practice location
        ↓
Xero organisation (tenant)
        ↓
Xero tracking category  (e.g. "Location" or "Clinic")
        ↓
Xero tracking option    (e.g. "Caldicot", "Magor")
        ↓
Every synced transaction / journal line tagged with that option
        ↓
P&L, Balance Sheet, Cashflow, Dashboard, Profitability
```

One Xero organisation can serve **many** DentPulse locations. Tracking options are what split the shared ledger into per-clinic numbers.

---

## 0. What must already be true in Xero

Do this in Xero **before** expecting DentPulse to match.

### 0.1 Tracking categories exist and are Active

1. In Xero go to **Accounting → Advanced → Tracking categories**  
   (or **Settings → General settings → Tracking** depending on Xero UI).
2. Confirm at least one category (typical name: `Location`, `Clinic`, `Site`, `Department`).
3. Confirm each DentPulse clinic has a matching **option** under that category, status **Active**.
4. Write down:

   | DentPulse location | Xero organisation | Tracking category | Tracking option |
   | --- | --- | --- | --- |
   | (example) Caldicot | Acme Dental Ltd | Location | Caldicot |
   | (example) Magor | Acme Dental Ltd | Location | Magor |

### 0.2 Transactions actually carry tracking

Tracking only splits reports if Xero **posts it on the line**.

Check a sample of each:

| Xero screen | What to confirm |
| --- | --- |
| **Accounting → Reports → Journal report** (or Accounting → Advanced → Manual journals) | Each journal **line** has the tracking option |
| **Business → Invoices** (and Bills) | Each **line item** has tracking |
| **Accounting → Bank accounts → account → transaction** | Header or lines have tracking |
| **Accounting → Reports → Profit and Loss** | Tracking filter dropdown lists your category + options |
| **Accounting → Reports → Balance Sheet** | Same tracking filter is available |

If a journal / invoice has **no tracking**, DentPulse cannot allocate it to a location. Those lines will only appear in the **unscoped** (whole-organisation) totals.

---

## 1. Download the tracking catalog into DentPulse

Tracking options must be in our database **before** the mapping dropdown can show them.

### 1.1 Trigger the download

1. Open DentPulse → **Sync Summary** (`/sync-summary`).
2. Find the Xero integration.
3. Confirm these jobs exist and complete without error (order matters):

   | Sync job (UI name) | Entity alias | Why first |
   | --- | --- | --- |
   | Chart of Accounts | `xero_chart_of_accounts` | Accounts used by P&L / journals |
   | **Tracking categories** | `xero_tracking_categories` | Category + option catalog |
   | Invoices | `xero_invoices` | Line-level tracking stored |
   | Bank Transactions | `xero_bank_transactions` | Transaction-level tracking stored |
   | Journals | `xero_journals` | **Primary GL source** — line-level tracking |
   | Profit & Loss | `xero_profit_loss` | One row per account × month × tracking option |
   | Balance Sheet | `xero_balance_sheet` | Synced table is **not** option-scoped (live BS is) |

4. If Tracking categories is missing or old: run **entity sync** for `xero_tracking_categories`, then a **full Xero sync** (or at least Journals + Invoices + P&L).

Tracking categories use `dateFilter: none` — they are a catalog, not date-windowed. They must be queued on the **first** full sync as well as later runs.

### 1.2 Prove the catalog landed

In Supabase (SQL editor), for your org:

```sql
-- Categories per Xero tenant
SELECT pio.platform_org_name,
       tc.name AS category_name,
       tc.xero_tracking_category_id,
       tc.status,
       tc.synced_at
FROM xero_tracking_categories tc
JOIN platform_integration_organizations pio
  ON pio.id = tc.platform_integration_organizations_id
WHERE tc.organization_id = '<ORG_UUID>'
ORDER BY pio.platform_org_name, tc.name;

-- Options under each category
SELECT pio.platform_org_name,
       tc.name AS category_name,
       topt.name AS option_name,
       topt.xero_tracking_option_id,
       topt.status
FROM xero_tracking_options topt
JOIN xero_tracking_categories tc
  ON tc.xero_tracking_category_id = topt.xero_tracking_category_id
 AND tc.platform_integration_organizations_id = topt.platform_integration_organizations_id
JOIN platform_integration_organizations pio
  ON pio.id = topt.platform_integration_organizations_id
WHERE topt.organization_id = '<ORG_UUID>'
ORDER BY pio.platform_org_name, tc.name, topt.name;
```

**Pass:** every Active option you saw in Xero appears here with matching names.  
**Fail:** names missing → re-run Tracking categories sync; mapping UI will be empty.

---

## 2. Map Dentally location → Xero organisation → tracking option

This is the only place that tells DentPulse “this clinic = this tracking option”.

### 2.1 UI path

1. **Settings** (`/settings` or `/admin`) → tab **Integrations**.
2. Scroll to **Accounting Integrations** (Xero / QuickBooks / iplicit hub).
3. Confirm Xero is connected and the organisation (tenant) is listed.
4. For each **practice location** row:

   - Left: Dentally location name.
   - Right: organisation dropdown.
   - For Xero, options appear **under** the organisation, as:

     `Organisation name → Category name → Option name`

     Example: `Acme Dental Ltd → Location → Caldicot`

5. Pick **organisation + tracking option** (not organisation alone) when clinics share one Xero tenant.
6. Save mapping.

Notes:

- A tracking option can be used by **only one** location in the dropdown (already-used options are marked taken).
- Locations flagged **Hidden from financial display** (e.g. Saint Catherine) still sync, but are omitted from financial pickers and All Locations totals.
- Top bar location dropdown shows `Category · Option` under the location name after save.

### 2.2 Prove the mapping landed

```sql
SELECT
  pl.location_name,
  pio.platform_org_name AS xero_organisation,
  piom.xero_tracking_category_name,
  piom.xero_tracking_option_name,
  piom.xero_tracking_category_id,
  piom.xero_tracking_option_id,
  pl.exclude_from_financial_display
FROM platform_integration_organization_mapping piom
JOIN practice_locations pl ON pl.id = piom.location_id
JOIN platform_integration_organizations pio
  ON pio.id = piom.platform_integration_organizations_id
WHERE piom.organization_id = '<ORG_UUID>'
  AND pio.platform_name = 'xero'
ORDER BY pl.location_name;
```

**Pass:** every clinic you care about has both `xero_tracking_category_id` and `xero_tracking_option_id` filled.  
**Fail:** option columns NULL → DentPulse will show **whole-organisation** Xero numbers for that location (double-count risk when two clinics share a tenant).

After saving maps, **re-run P&L sync**. Scoped P&L rows are only pulled for options that exist on this mapping table.

---

## 3. Confirm tracking is stored on downloaded transactions

When we download Xero entities that carry tracking, we persist it **on the line** (journals, invoices) or on the transaction (bank).

| Entity | Table | Granularity | Columns |
| --- | --- | --- | --- |
| Journals (includes manuals, invoices, bills once they hit the GL) | `xero_journal_details` | **Line** | `tracking` JSONB, `tracking_option_ids` text[] |
| Invoices / bills | `xero_invoice_line_items` | **Line** | same |
| Bank transactions | `xero_bank_transactions` | **Transaction** (header, else merged lines) | same |
| P&L report | `xero_profit_loss` | Account × month × option | `xero_tracking_option_id` (`''` = unscoped org total) |

### 3.1 Spot-check journals (most important)

Pick a known journal in Xero that is tagged to one clinic. Then:

```sql
SELECT
  jd.journal_date,
  jd.account_code,
  jd.account_name,
  jd.description,
  jd.net_amount,
  jd.tracking,
  jd.tracking_option_ids
FROM xero_journal_details jd
WHERE jd.organization_id = '<ORG_UUID>'
  AND jd.journal_date BETWEEN '<FROM>' AND '<TO>'
  AND jd.tracking_option_ids @> ARRAY['<XERO_TRACKING_OPTION_ID>']
ORDER BY jd.journal_date, jd.account_code
LIMIT 50;
```

**Pass:** `tracking` JSON looks like:

```json
[{
  "Name": "Location",
  "Option": "Caldicot",
  "TrackingCategoryID": "...",
  "TrackingOptionID": "..."
}]
```

and `tracking_option_ids` contains that option GUID.

**Coverage check** (how much of the GL is tagged):

```sql
SELECT
  COUNT(*) AS lines,
  COUNT(*) FILTER (WHERE cardinality(tracking_option_ids) > 0) AS with_tracking,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE cardinality(tracking_option_ids) > 0) / NULLIF(COUNT(*), 0),
    1
  ) AS pct_tagged
FROM xero_journal_details
WHERE organization_id = '<ORG_UUID>'
  AND journal_date BETWEEN '<FROM>' AND '<TO>';
```

Low `% tagged` → Xero posting is incomplete; DentPulse location P&L will be lower than Xero org P&L (expected).

### 3.2 Spot-check invoice lines

```sql
SELECT
  li.description,
  li.line_amount,
  li.tracking,
  li.tracking_option_ids
FROM xero_invoice_line_items li
JOIN xero_invoices i ON i.id = li.invoice_id
WHERE i.organization_id = '<ORG_UUID>'
  AND cardinality(li.tracking_option_ids) > 0
LIMIT 20;
```

### 3.3 Spot-check scoped P&L cache

```sql
SELECT
  xero_tracking_option_id,
  COUNT(*) AS rows,
  SUM(amount) AS amount
FROM xero_profit_loss
WHERE organization_id = '<ORG_UUID>'
  AND to_date BETWEEN '<FROM>' AND '<TO>'
GROUP BY xero_tracking_option_id
ORDER BY xero_tracking_option_id;
```

You should see:

- `xero_tracking_option_id = ''` → full organisation P&L (unscoped).
- One group per mapped option → that clinic’s P&L.

### 3.4 Entities that do **not** store tracking today

Do not expect location split from these downloads:

- Credit notes (`xero_credit_notes`)
- Overpayments (`xero_overpayments`)
- Payments (nested under invoices / CNs / OPs)
- Synced Balance Sheet table (`xero_balance_sheet`) — **live** Balance Sheet screen is tracking-aware; the cached table is not

Journals usually still capture the GL effect of those documents. Prefer journal-line checks when in doubt.

---

## 4. How to read Xero so it matches DentPulse

Always compare **the same period** and **the same tracking option**.

### 4.1 Profit and Loss in Xero

1. **Accounting → Reports → Profit and Loss**.
2. Set **From / To** to the same dates as DentPulse (top-bar date filter, or Financial Reports date control).
3. Open the **Tracking** filter (sometimes labelled by the category name, e.g. Location).
4. Choose **one option** (Caldicot) — not “All”.
5. Run the report. Note **Total Income, Gross Profit, Total Expenses, Net Profit** and a few known account lines.

That is the number DentPulse must show when the top-bar location is that clinic.

### 4.2 Balance Sheet in Xero

1. **Accounting → Reports → Balance Sheet**.
2. Set **As at** = DentPulse report end date.
3. Apply the **same tracking option**.
4. Note Assets, Liabilities, Equity totals and a few accounts (bank, VAT, retained earnings).

Xero tracking on Balance Sheet only includes balances that were **posted with that option**. Untagged historical balances will not appear in the option-scoped report — DentPulse live BS will match Xero’s filtered BS, not the unfiltered org BS.

### 4.3 Organisation total (sanity)

Run the **same reports with tracking = All / none**.

- Sum of clinic options **plus untagged lines** ≈ organisation total.
- Sum of clinic options alone is usually **less** than organisation total if any postings have no tracking.

---

## 5. Screen-by-screen check in DentPulse

For every screen below:

1. Set **top-bar location** to one mapped clinic (not All Locations).
2. Set **date range** to the period you used in Xero.
3. Confirm the location label shows `Category · Option` in the picker.
4. Compare to the Xero report filtered to that option.

Use two clinics that share one Xero organisation. If Location A and Location B show **identical** P&L, the tracking option is not applied (mapping missing or journals not re-synced).

---

### Screen A — Settings / mapping (setup, not numbers)

| | |
| --- | --- |
| **DentPulse** | `/settings` → Integrations → Accounting Integrations |
| **Xero** | Accounting → Advanced → Tracking categories |
| **What to match** | Category names, option names, Active options |
| **Pass** | Every clinic has Org + Category + Option saved; hidden locations labelled |

---

### Screen B — Financial Reports → Profit & Loss (primary match)

| | |
| --- | --- |
| **DentPulse** | `/financial-reports` → tab **Profit & Loss** |
| **How it works** | Live Xero API `Reports/ProfitAndLoss` with `trackingCategoryID` + `trackingOptionID` from the location map |
| **Xero** | Accounting → Reports → Profit and Loss → filter tracking option |
| **What to match** | Section totals (Income, COS, Expenses, Net Profit) and account lines for the same dates |

**All Locations:** DentPulse unions distinct `(tenant, tracking option)` scopes and skips hidden locations. Compare to summing each clinic’s Xero tracking P&L — **not** to the unfiltered org P&L.

**Compare / Group (Average):** extra columns are derived from those same scoped reports.

---

### Screen C — Financial Reports → Balance Sheet (primary match)

| | |
| --- | --- |
| **DentPulse** | `/financial-reports` → tab **Balance Sheet** |
| **How it works** | Live Xero API `Reports/BalanceSheet` with the same tracking IDs |
| **Xero** | Accounting → Reports → Balance Sheet → same option, same as-at date |
| **What to match** | Assets / Liabilities / Equity totals and key accounts |

Do **not** compare this tab to the synced `xero_balance_sheet` table — that cache has no tracking dimension.

---

### Screen D — Financial Reports → Cash Flow Statement

| | |
| --- | --- |
| **DentPulse** | `/financial-reports` → tab **Cash Flow Statement**  
  (same engine as `/cashflow/preparing-statement`) |
| **How it works** | Edge function `cashflow-report` reads `xero_journal_details` and filters `tracking_option_ids` to the mapped option |
| **Xero** | Journal report or P&L cash view filtered by tracking; or Accounting → Reports → Cash Summary if you use it with tracking |
| **What to match** | Category totals for the location, then drill into a category and confirm transactions belong to that option |

---

### Screen E — Cashflow workspace

| Route | Tracking-aware? | How to check |
| --- | --- | --- |
| `/cashflow/preparing-statement` | **Yes** (same cashflow-report + journal `tracking_option_ids`) | Location A vs B must differ; drilldown lines must carry that option |
| `/cashflow/13-week-forecast` | **Partial** | COA mapping is location-scoped; weekly journal income fetch does **not** currently filter `tracking_option_ids`. If two clinics share a tenant, forecast **accounting** income can look too high / duplicated. Prefer P&L for tracking sign-off. |
| `/cashflow/cfo-summary` | Follows forecast / statement sources | Same caveat as forecast |
| `/cashflow/bills-to-pay` | Operational AP, not tracking P&L | Out of scope for this walkthrough |
| `/cashflow/growth` | Mixed | Spot-check only after statement matches |

---

### Screen F — Dashboard P&L tiles

| | |
| --- | --- |
| **DentPulse** | `/` (group dashboard) and `/dashboard-classic` |
| **How it works** | `useProfitLossOverview` sums `xero_journal_details` with `tracking_option_ids` contains / overlaps the mapped option(s) |
| **Xero** | P&L filtered to the same option, same dates (journal-based totals may differ slightly from the Xero P&L **report** because of report layout / accruals — direction and clinic split must still be correct) |
| **Pass** | Switching location in the top bar changes Gross Profit / Expenses / Net Profit. All Locations is the union of mapped options, not a raw tenant total. |

---

### Screen G — Profitability and Profit Benchmark

| | |
| --- | --- |
| **DentPulse** | `/profitability` and `/profitability/benchmark/:category` |
| **How it works** | Profit benchmark / category-detail edge functions filter journals by mapped `xero_tracking_option_id` |
| **Xero** | P&L by tracking option; drill a cost category and compare account totals |
| **Pass** | Location A benchmark ≠ Location B when they share a Xero org. Category drilldown transactions are tagged to that option. |

EBITDA bridge on this page (`useEbitdaBridge`) currently sums journals **without** a tracking filter. Treat EBITDA add-backs as **organisation-level** until that hook is scoped. Net profit from Profit Benchmark **is** location-scoped.

---

### Screen H — Setup Categories (COA mapping per location)

| | |
| --- | --- |
| **DentPulse** | `/settings/setup-categories` |
| **How it works** | Uses `useLocationAccountingScope` (tenant + tracking option) so each location maps its own income / cost accounts against the shared Xero COA |
| **What to check** | Select Location A, confirm accounts. Switch to Location B — mappings are per location, not overwritten. Reports that read these mappings still need tracking on the journal lines (Screen B / F / G). |

---

### Screen I — Operating cost / cost-impact tiles

These call `get_xero_op_cost` / `get_xero_op_cost_all_locations`, which read **`xero_profit_loss`** filtered by the location’s tracking option.

| DentPulse | Check |
| --- | --- |
| Cost impact dashboard `/cost-impact` | Location operating cost vs Xero P&L expenses for that option |
| Overhead / staff / materials / marketing / lab / clinician cost pages | Same: only match if those pages use Xero op-cost / P&L, and P&L sync has been re-run **after** mapping |

**Pass:** Location A op-cost equals Xero tracking P&L expense total for that option (for the mapped expense account types). All Locations equals sum of option-scoped rows (plus unscoped once for tenants with no option maps).

---

### Screen J — Top bar location picker

| | |
| --- | --- |
| **DentPulse** | Any page with the global location filter |
| **What to check** | Mapped locations show `Category · Option` under the name. Hidden locations (Saint Catherine) do not appear in financial location lists. Switching location refreshes P&L / BS / cashflow. |

---

## 6. Recommended click path (end-to-end, ~30 minutes)

Do this once per organisation after mapping.

1. **Xero** — confirm tracking category + options; tag a test invoice and a test journal to Location A.
2. **DentPulse Sync Summary** — run Tracking categories → Journals → Invoices → Profit & Loss.
3. **SQL** — catalog rows exist; mapping has option IDs; journal lines for the test docs have `tracking_option_ids`.
4. **Settings → Integrations** — Location A = Org + Category + Option A; Location B = same Org + Option B.
5. **Top bar** — Location A; date = last full month.
6. **`/financial-reports` P&L** — match Xero P&L with tracking = Option A (Net Profit and 3–5 account lines).
7. Switch top bar to **Location B** — numbers must change; match Xero Option B.
8. **`/financial-reports` Balance Sheet** — match Xero BS with the same option and as-at date.
9. **`/financial-reports` Cash Flow Statement** — location split present; drill one category.
10. **Dashboard** — GP / expenses / NP move with location.
11. **`/profitability`** — Location A vs B differ.
12. **All Locations** — ≈ A + B (plus any other mapped visible clinics); **not** equal to unfiltered Xero org total if untagged lines exist.

---

## 7. Pass / fail checklist

Copy this into a test note.

| # | Check | Location A | Location B | All Locations |
| --- | --- | --- | --- | --- |
| 1 | Tracking catalog downloaded | | | |
| 2 | Location mapped to org + option (not org only) | | | |
| 3 | Journal lines store `tracking_option_ids` | | | |
| 4 | Invoice lines store tracking | | | |
| 5 | `xero_profit_loss` has scoped rows for the option | | | |
| 6 | Financial Reports P&L matches Xero tracking P&L | | | |
| 7 | Financial Reports BS matches Xero tracking BS | | | |
| 8 | Cash flow statement is location-split | | | |
| 9 | Dashboard P&L tiles follow the location | | | |
| 10 | Profitability / benchmark follows the location | | | |
| 11 | A and B are **not** identical (shared tenant) | | | |
| 12 | Hidden location omitted from All Locations | | | |

---

## 8. Known gaps (where numbers will not match yet)

Keep these in mind so a mismatch is not chased as a mapping bug.

| Area | Behaviour today |
| --- | --- |
| Credit notes, overpayments, payments | Tracking is **not** written to those tables. GL effect is usually on **journals**. |
| Bank transactions | Tracking stored at **transaction** level (merged). Two lines with different options collapse to one set of IDs. |
| Synced `xero_balance_sheet` | No tracking key. Use **live** Financial Reports BS. |
| 13-week cashflow forecast (accounting income weeks) | Journal query is **not** filtered by tracking option. |
| EBITDA bridge add-backs | Journal sum is **not** filtered by tracking option. |
| Income accounting totals helper | Some journal sums have no tracking filter (provider/practice income from Setup Categories). |
| .NET data-engine (`dp-data-engine-be`) | Downloads tracking **catalog only**. Product reports use Node + Supabase. |
| Untagged Xero lines | Appear only in unscoped org totals, never on a clinic screen. |

---

## 9. If it does not match — debug order

1. **Mapping** — option IDs null? Fix Settings, save, re-sync P&L.
2. **Catalog** — option missing in `xero_tracking_options`? Re-sync Tracking categories.
3. **Journals** — `tracking_option_ids` empty on lines that are tagged in Xero? Re-sync `xero_journals` (tracking columns were added later; old rows need a re-download).
4. **Xero posting** — line has no tracking in Xero itself? DentPulse cannot invent it.
5. **Wrong report type** — live P&L (API report) vs journal-sum dashboard: small layout differences are OK; clinic **split** must still be correct.
6. **Shared tenant without options** — two locations mapped to the same org and **no** tracking option will show the **same** full-org numbers. That is the bug this mapping exists to prevent.
7. **Hidden location** — still in mapping and still syncing, but must not appear in financial UI totals.

---

## 10. Data flow (reference)

```
Xero GET /TrackingCategories
        → xero_tracking_categories + xero_tracking_options

User maps practice_locations
        → platform_integration_organization_mapping
           (platform_integration_organizations_id
            + xero_tracking_category_id
            + xero_tracking_option_id)

Xero GET /Journals, /Invoices, /BankTransactions
        → extract TrackingCategories / Tracking on each line
        → tracking JSONB + tracking_option_ids[]

Xero GET /Reports/ProfitAndLoss
        → unscoped (option = '')
        → plus one pull per mapped option
        → xero_profit_loss

DentPulse location filter
        → resolve mapping
        → live reports: pass trackingCategoryID + trackingOptionID to Xero
        → stored reports: WHERE tracking_option_ids @> [optionId]
```

Product code (live path):

- Sync: `dental-pulse-api-backend/backend/queue/xero/processor.js` (`syncTrackingCategories`, `extractTrackingFields`, `syncJournals`, `syncInvoices`, `syncProfitLossReport`)
- Mapping UI: `dental-pulse-dev/src/components/settings/AccountingIntegrationsHub.tsx`
- Live P&L / BS: `useAccountingFinancialReports.ts` → edge function `xero-data`
- Journal-scoped screens: `useProfitLossOverview.ts`, `cashflow-report`, `profit-benchmark`
