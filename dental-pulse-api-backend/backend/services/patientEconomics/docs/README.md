# Patient Economics Engine™

End-to-end feature guide for the DentPulse **Patient Economics Engine** (PE): architecture, branch history, local dev, and deployment.

**UI route:** `/patients` (tab query params for sub-screens).  
**Design reference:** `patient-economics-engine-mockup-v5.1.html` (repo root of integration workspace).

---

## What it does

PE turns every patient into a financial record: invoice **contribution**, **opportunity**, **value at risk**, retention segmentation, and growth levers — aggregated for multi-practice managers and drillable to patient-level P&L.

Nine live screens:

| Screen | Route |
|--------|--------|
| Economic Pulse | `/patients` |
| Growth Levers | `/patients?tab=growth-levers` |
| Value & Leakage | `/patients?tab=value-leakage` |
| Retention & Reactivation | `/patients?tab=retention` |
| Patient List | `/patients?tab=patient-list` |
| Patient Records | `/patients?tab=patient-records` |
| Invoices | `/patients?tab=invoices` |
| Goal Settings | `/patients?tab=goal-settings` |
| Settings | `/patients?tab=settings` |

---

## Architecture (three runtimes)

PE deliberately splits work across **backend**, **one Edge Function**, and **frontend direct reads** under RLS.

```
┌─────────────────────────────────────────────────────────────────────────┐
│  dental-pulse-dev (Vite React)                                          │
│  /patients → EconomicPulse.tsx tab router                               │
├─────────────────────────────────────────────────────────────────────────┤
│  Secrets / PAT / sync          │  Aggregated reads (JWT)               │
│  ─────────────────────────────│──────────────────────────────────────  │
│  patientEconomicsService.ts   │  GET /api/economics-engine/read/*     │
│  → backend :4000               │  GET /api/economics-engine/journey/*  │
│                                │  assumptions, goal settings, etc.     │
├────────────────────────────────┼────────────────────────────────────────┤
│  Direct Supabase (anon + user JWT, RLS)                                 │
│  • peInvoicesService — invoices screen (payments, outstanding, aging)   │
│  • PeNhsUdaContractSettings — uda_settings                            │
│  • ClinicianRemunerationProfiles — org/locations lookup                 │
│  • membershipImportService — Storage upload + functions.invoke          │
└─────────────────────────────────────────────────────────────────────────┘
         │                              │
         │ JWT / service key            │ user session + RLS policies
         ▼                              ▼
┌──────────────────────────┐   ┌────────────────────────────────────────┐
│ dental-pulse-api-backend │   │ Supabase (Postgres + Storage + Auth)   │
│ Express :4000            │   │ Views: v_invoice_contribution,         │
│                          │   │ v_patient_contribution,                │
│ • PAT encrypt/decrypt    │   │ v_patient_financial_record, …          │
│ • Chunked Dentally sync  │   │ pe_economic_assumptions, sync_cursors  │
│ • Event ledger writers   │   │ membership_upload_members, …           │
│ • Read aggregations      │   └────────────────────────────────────────┘
│ • peSyncCron (node-cron) │              │
└──────────────────────────┘              │
         │                                │
         │ Dentally API (PAT)             │ service role (Edge Function only)
         ▼                                ▼
   api.dentally.co              ┌────────────────────────────────────────┐
                                │ Edge Function:                         │
                                │ patient-economics-membership-import    │
                                │ (CSV → match patients → upsert rows)   │
                                └────────────────────────────────────────┘
```

### Backend (`dental-pulse-api-backend`) — **use for anything needing secrets**

| Responsibility | Location |
|----------------|----------|
| Dentally PAT storage (AES-GCM) | `patEncryption.js`, `routes/economicsEngine.js` `/credentials` |
| Resource sync (chunked, resumable) | `services/patientEconomics/sync/*` |
| Scheduler | `peSyncCron.js` — resume, incremental kickoff, full kickoff, modelled-score job |
| Event ledger / opportunity | `eventLedgerWriter.js`, journey/leakage services |
| Read APIs (service role aggregates, then return JSON) | `routes/economicsEngine.js` `/read/*` |
| Economic assumptions / practitioner rates | `/assumptions/*` |
| Goal settings rollup | `/read/goal-settings` |

Sync uses **service role** server-side only. The browser never receives the service key or decrypted PAT.

Deep dive: [`sync/README.md`](./sync/README.md).

### Edge Function — **membership import only (PE)**

| Function | Trigger | Why not backend? |
|----------|---------|------------------|
| `patient-economics-membership-import` | Frontend uploads Denplan/Practice Plan **CSV** to Storage, then `supabase.functions.invoke` | Upload parsing + bulk upsert; no Dentally PAT; uses Supabase service role inside the function boundary |

Practice Plan **PDF** parsing remains on the client (existing membership module).

Code: `dental-pulse-dev/supabase/functions/patient-economics-membership-import/`.  
Client: `dental-pulse-dev/src/services/membershipImportService.ts`.

### Frontend direct Supabase reads — **RLS-scoped**

Used when row-level policies are sufficient and no server secret is required:

| Surface | Service / component | Tables / views |
|---------|---------------------|----------------|
| Invoices screen | `peInvoicesService.ts` | `platform_integration_invoices`, `dentally_payments`, related patient/location rows |
| NHS contract inputs | `PeNhsUdaContractSettings.tsx` | `uda_settings`, `organizations`, `locations` |
| Clinician list for rates UI | `ClinicianRemunerationProfiles.tsx` | `organizations`, `locations` |

All other PE metrics (Pulse heroes, patient list, records, leakage, growth, retention, goals) go through **backend read routes** with the user’s Supabase JWT (`syncAuthMiddleware`).

---

## Data flow summary

1. **Connect Dentally** — user saves PAT via backend; validated against `DENTALLY_API_BASE_URL`.
2. **Sync** — cron or manual kickoff pages Dentally into Postgres (`sync_cursors` resume).
3. **Derive** — SQL views + event ledger; optional nightly `computePatientModelledScores.js`.
4. **Read** — UI calls backend aggregations or direct Supabase (Invoices).
5. **Membership** — optional CSV import via Edge Function into `membership_upload_members`.

---

## Repository layout

| Path | Role |
|------|------|
| `dental-pulse-dev/` | React app, Supabase migrations, Edge Functions |
| `dental-pulse-api-backend/` | Express API, PE sync + read services |
| `patient-economics-engine-mockup-v5.1.html` | Visual spec (integration repo root) |

Key PE backend paths:

- `backend/routes/economicsEngine.js` — HTTP surface
- `backend/services/patientEconomics/` — domain logic
- `backend/services/patientEconomics/docs/` — product/ops docs (this file, gaps, settings notes)
- `dental-pulse-dev/src/pages/patient-economics/` — screen components
- `dental-pulse-dev/supabase/migrations/` — `pe_*`, views, RLS

---

## Branch history (sprint delivery)

Merged feature branches on `main` (useful when bisecting or onboarding):

| Branch | Scope delivered |
|--------|----------------|
| `feature/patient-economics-engine` | Schema, PAT UI shell, sync cursor tables, early credentials |
| `feature/pe-invoices-payments-membership` | Invoice/payment sync, membership import Edge Function |
| `feature/pe-event-ledger` / `feature/pe-event-ledger-complete` | Treatment Economic Journey event ledger, UDA/Plan journey wiring |
| `feature/pe-appointments-treatment-plans` | Appointments, treatment plans/items sync |
| `feature/pe-per-practice-patient-list` | Per-practice economics table, provenance chips |
| `feature/pe-patient-records` | Patient Financial Record, backend read routing |
| `feature/pe-value-leakage` | Value & Leakage screen, commitment rate, weighted opportunity |
| `feature/pe-growth-levers` | Visit frequency, value/visit, tenure, CLTV by source, simulator |
| `feature/pe-invoices-settings` | Invoices UI, Goal Settings, Settings consolidation, deferred-panel docs |
| `feature/pe-retention-reactivation` | 4-tier retention, Recovery Loop™, reactivation worklist |
| `feature/pe-qa-handover` | QA fixes, visual alignment to mockup v5.1, handover docs |

Typical day-by-day progression (approximate):

1. Credentials + sync foundation + inspector  
2. Patients, accounts, recalls, acquisition sources  
3. Appointments, treatment plans/items, invoices, payments  
4. Event ledger + Economic Pulse journey  
5. Patient list + per-practice rollup  
6. Patient Financial Record + contribution views  
7. Value & Leakage + commitment intelligence  
8. Growth Levers + modelled CLTV job  
9. Invoices (direct read) + Goal Settings + Settings panels  
10. Retention segmentation + Recovery Loop  
11. QA, RLS regression, visual parity with mockup  

---

## Running locally

### Prerequisites

- Node.js ≥ 18  
- Linked Supabase project (migrations applied from `dental-pulse-dev/supabase/migrations/`)  
- Dentally sandbox PAT for at least one practice (`organization_id` = practice UUID)

### 1. Backend API

```bash
cd dental-pulse-api-backend
npm install
# Copy and fill backend .env — see docs/SECRETS.md (Backend section)
npm run dev    # default PORT 4000 in dev; package may use 5000 — check .env PORT
```

Enable PE sync cron in dev only when needed:

```bash
PE_SYNC_CRON_ENABLED=true
```

### 2. Frontend

```bash
cd dental-pulse-dev
npm install
# .env: VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY
# Optional: VITE_BACKEND_URL=http://localhost:4000
npm run dev    # default :8080
```

Open `http://localhost:8080/patients`.

### 3. Edge Function (membership import)

Deploy function to your Supabase project and set **Edge Function secrets** (not backend `.env`):

```bash
cd dental-pulse-dev
supabase functions deploy patient-economics-membership-import
```

See [`SECRETS.md`](./SECRETS.md) § Edge Function secrets.

### 4. Useful ops commands

```bash
# Cursor / sync status
node dental-pulse-api-backend/backend/scripts/peSyncStatus.js <practice_id>

# Kickoff smoke test
node dental-pulse-api-backend/backend/scripts/testPeScheduleKickoff.js <practice_id>

# RLS regression (Patient Financial Record grain)
node dental-pulse-api-backend/backend/scripts/testPatientFinancialRecordRls.js
```

Dev-only UI: `/dev/pe-sync-inspector` (owner/admin).

---

## Deploy

### Backend

- Deploy `dental-pulse-api-backend` to your Node host (Railway, DO, etc.).
- Set all variables in **Backend secrets** ([`SECRETS.md`](./SECRETS.md)).
- Ensure `CORS_ALLOWED_ORIGINS` includes the production frontend URL if not matched by default regex.
- Set `PE_SYNC_CRON_ENABLED=true` in production if scheduled sync should run on that instance.
- Health: `GET /api/v1/health` (global app health).

### Frontend

- Build: `cd dental-pulse-dev && npm run build` → `dist/`.
- Host on Vercel/static CDN; set `VITE_SUPABASE_*` and `VITE_BACKEND_URL` at build time.
- Apply Supabase migrations before shipping UI that depends on new columns/views.

### Supabase

- Run migrations (`supabase db push` or CI migration pipeline).
- Deploy Edge Function `patient-economics-membership-import`.
- Configure Edge Function secrets separately from backend env.
- Ensure Storage bucket `membership-imports` exists with policies allowing authenticated upload under `{organizationId}/` prefix.

---

## Known limitations & deferred work

See also [`PE_KNOWN_GAPS.md`](./PE_KNOWN_GAPS.md) and [`PE_SETTINGS_NOTES.md`](./PE_SETTINGS_NOTES.md).

### D17 — Patient Economic Value™ formula (business confirmation)

**Status:** Engineering proposal implemented; **not a settled Dentally or product spec term.**

**Implemented rule:**

- When Day 3 modelled scores exist: `PEV = cltv_projection` (from `patient_economics_modelled_scores`).
- Otherwise: `PEV = contribution` (invoice rollup to date only).
- **Not** `contribution + cltv_projection` (would double-count historical contribution already inside the projection).

**Why:** `cltv_projection` is defined as historical contribution plus discounted 5-year run-rate (@ 10%) in `computePatientModelledScores.js`. An alternative discussed with product — `PEV = contribution + opportunity_weighted` — is **not** implemented.

**Code:** `dental-pulse-dev/src/lib/pePatientEconomicValue.ts`, SQL on `v_patient_contribution`, Patient Records / Growth Levers UI footnotes.

### D18 — Cross-surface retention consistency

**Status:** Validated in QA; one fix shipped for worklist vs Patient Records.

- **Retention segment** on open reactivation flags must reflect **live** `retention_status` (from `v_patient_contribution`), not only `segment_at_flag_time` snapshot on the flag row.
- **Patient Records** and **Reactivation worklist** should agree on segment for the same patient when data is current.
- Segment **counts** on Retention heroes/charts use invoice rollup by current segment; flag cohorts are a subset (high trailing contribution).

Regression: compare worklist Segment column to Patient Records for open flags on the same practice.

### D19 — Deferred Settings sub-panels

Route: `/patients?tab=settings`. **Live:** Economic Assumptions (+ clinician remuneration), Conversion Probabilities (read-only), Data Provenance & Confidence (docs), NHS contract subset (`uda_settings`).

**Deferred (documented, not silent omission):**

1. **Status, Recall & Data Source** — mockup controls for “Active window (months)”, sync frequency dropdown, live integration health. Superseded in part by 4-tier retention + Economic Assumptions (`commitment_rate_window_days`). PAT management stays on app `/settings`. Planned v2: read-only sync/PAT health (~3–5h).

2. **NHS / UDA treatment (remainder)** — mockup toggles “Exclude UDA from contribution” and “Track UDA separately” are **disabled UI**; behaviour is already enforced in SQL/views. **Not built:** clawback alert threshold (%), mixed-patient handling policy, per-location NHS contract rows in PE Settings.

Full acceptance criteria: [`PE_SETTINGS_NOTES.md`](./PE_SETTINGS_NOTES.md).

---

## Related documentation

| Document | Contents |
|----------|----------|
| [`SECRETS.md`](./SECRETS.md) | Backend vs Edge Function environment variables |
| [`sync/README.md`](./sync/README.md) | Sync chunking, cursors, cron schedules |
| [`PE_UDA_JOURNEY_AND_SETTINGS.md`](./PE_UDA_JOURNEY_AND_SETTINGS.md) | NHS/UDA, Plan split, journey stages |
| [`PE_KNOWN_GAPS.md`](./PE_KNOWN_GAPS.md) | Formula gaps, partial features, RLS notes |
| [`PE_SETTINGS_NOTES.md`](./PE_SETTINGS_NOTES.md) | Deferred Settings panels (D19 detail) |

---

## API prefix

All PE routes mount under:

```
/api/economics-engine
```

Authenticated with Supabase user JWT (`Authorization: Bearer`) unless noted (kickoff routes also accept `x-service-key` for cron/machines). See `economicsEngine.js` for the full route list.
