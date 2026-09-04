# PE read contract

Patient Economics UI metrics must follow this read path. Direct browser Supabase queries for PE data are not allowed except legacy UDA settings surfaces (migrate separately).

## Contract

```
PE pages / hooks
  → JWT to economics-engine API (/api/economics-engine/read/*)
    → Node read services + SQL RPCs
    → pe_*_facts tables (preferred) or scoped SQL on invoice facts
    → Paginated, filtered JSON (never full-roster payloads)
```

## Frontend rules

- **No** `supabase.from(...)` in `dental-pulse-dev/src/pages/patient-economics/**`, `dental-pulse-dev/src/hooks/use*Pe*.ts`, or `dental-pulse-dev/src/services/integrations/pe*.ts` for metrics/lists/summaries.
- Hooks receive **display-ready pages**: `patients` / `invoiceListRows`, `total`, `page`, `pageSize`, `summary`, `baselineSummary`.
- **No** client-side `filterPatientRows`, `sortPatientRows`, `slice`, or `fetchAllPages` on PE roster data.
- Display-only helpers (`formatGbp`, badges, Dentally links) stay in the frontend.

## Backend rules

- List endpoints accept `page`, `pageSize`, `sort`, `sortDir`, `search`, `retentionFilter`, `typeFilter` (and invoice-specific filters).
- Scoped TopBar reads use SQL RPCs (`pe_invoice_contribution_summary`, `pe_patient_contribution_facts_scoped`) — not Node re-aggregation over full invoice scans.
- Invoice grain reads use `peReadSource.js` (facts-first, `v_invoice_contribution` fallback).
- Facts refresh is **Node-only**: `refreshPeContributionFacts.js` after invoice sync (`upsertPePage.js`). SQL `refresh_pe_contribution_facts` is removed.

## Matched vs orphan patients

Dentally invoices carry a numeric `pt_id`. Matching resolves `patients.pt_id` → `patients.id` (UUID).

| Layer | Unmatched (orphan) behavior |
|-------|----------------------------|
| `platform_integration_invoices` | Stored as synced |
| `v_invoice_contribution` / `pe_invoice_contribution_facts` | Stored with `patient_id` NULL |
| `v_patient_contribution` / `v_patient_financial_record` / `pe_patient_contribution_facts` | Stored with `patient_id` NULL, identity `grain_key = pt:<pt_id>` |
| `event_ledger` | **Not** written (Journey patient gate) |
| PE **tables** (invoice worklist, patient / financial lists) | **Hide** orphans (`patientRecordId` / `patientId` required) |
| PE **KPIs / summaries** | **Include** orphans (aged debt, cash leakage, list `summary` / `baselineSummary`, invoice contribution £) |

Orphans stay in facts/views so Dentally totals can match PE calculations; UI tables never list them.

## Required tables (keep)

| Asset | Purpose |
|-------|---------|
| `pe_invoice_contribution_facts` | Snapshot of `v_invoice_contribution` — avoids per-read view timeouts |
| `pe_patient_contribution_facts` | Patient rollups for list KPIs (includes orphans for summary math) |
| `pe_practice_contribution_facts` | Practice rollup row |
| `pePatientQueryChunks.js` | Chunks `patient_id IN (...)` for PostgREST / ledger limits |

## Key endpoints

| Endpoint | Returns |
|----------|---------|
| `GET /read/invoices-summary` | Aged debt KPIs + paginated invoice worklist (matched patients only) |
| `GET /read/patient-contribution-list` | Paginated patient list + summary KPIs |
| `GET /read/patient-financial-records` | Paginated financial records roster |
| `GET /read/economic-pulse-hero` | Invoice summary + UDA only (cards 2–5 via separate reads) |

## Invoice payment status (Existing Patient Value)

| Asset | Behavior |
|-------|----------|
| `v_invoice_contribution` / `pe_invoice_contribution_facts` | Store **all** Dentally invoices with `is_paid` + `status` from `platform_integration_invoices` |
| `pe_invoice_contribution_summary` / Economic Pulse Existing Patient Value | **Paid only** (`is_paid = true`); private+plan contribution; NHS/UDA excluded from contribution |
| `pe_patient_contribution_facts` refresh | Roll up **paid** invoice facts only |
| Invoices worklist | Still lists unpaid / part-paid / overdue from platform invoices (unchanged) |

Fully paid = Dentally `record.paid` → `is_paid = true` (same as Profitability RPCs). Part-paid invoices do not count toward Existing Patient Value.
