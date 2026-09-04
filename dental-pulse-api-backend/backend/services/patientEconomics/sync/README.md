# Patient Economics Engine — Dentally sync architecture

Backend-only sync (requires decrypted PAT from `integrations.encrypted_pat`). Not an Edge Function: no execution-ceiling constraint; chunking is sized for HTTP timeouts, rate limits, and deploy/crash resilience.

## Tables

| Table | Role |
|-------|------|
| `integrations` (Dentally row) | Encrypted PAT per org (`encrypted_pat` / `encrypted_pat_iv`); `organization_id` = PE practice |
| `sync_runs` | Append-oriented **run** audit: started/completed, overall status, error |
| `sync_cursors` | **Standing checkpoint** per `(practice_id, resource_type)` — upserted after each chunk |

`sync_runs` answers “what happened on run X?”  
`sync_cursors` answers “where do I resume patients for this practice?”

### Why not `sync_jobs`?

Existing Dentally sync uses `sync_jobs` + in-memory queues keyed by `integrations.id`. PE sync decrypts `integrations.encrypted_pat` for the Dentally row (`organization_id` = practice). Cursors stay practice-scoped and separate from `sync_jobs`.

## Chunk size

**Default: 1 Dentally page per worker invocation.**

| Factor | In-repo value | Implication |
|--------|----------------|-------------|
| `per_page` max | 100 records (`api/dentally/client.js` → `PER_PAGE = 100`) | One page ≈ ≤100 API records |
| Request timeout | 60s per outbound call (`REQUEST_TIMEOUT_MS`) | One fetch + upsert must finish within a worker tick |
| Rate limit | 3600 requests/hour/account (403 + `X-RateLimit-*`) | 1 request/chunk preserves budget across many resources |
| Main sync precedent | Monthly date chunks split large sets (`processor.js`) | PE should use date windows **plus** page cursor for heavy resources |

**Do not** batch many pages into one invocation to “go faster” — that increases timeout risk and makes partial failure harder to reason about. If a resource is lightweight (e.g. sites, small static lists), a future optimization may raise the cap to **3 pages** per invocation; start at **1** everywhere.

### Cursor encoding

- **Simple list resources** (no date filter): cursor = decimal string of the **next page to fetch** (1-based). After page `N` is successfully upserted, store `"N+1"` or mark `complete` if `N >= meta.total_pages`.
- **Date-chunked resources** (patients, appointments, …): cursor = JSON string:

```json
{
  "chunkStart": "2026-01-01",
  "chunkEnd": "2026-01-31",
  "page": 3
}
```

When the last page of a month chunk finishes, advance to the next month chunk (reset `page` to 1) or mark `complete` when all chunks are done. Same JSON shape in one `cursor` column — no schema change per resource.

Dentally list endpoints use **page numbers**, not opaque pagination tokens (`reference.md`).

## One chunk per invocation (control flow)

```
┌─────────────────────────────────────────────────────────────┐
│  Worker invoked (HTTP route, cron tick, or queue job)       │
│  Input: practiceId, resourceType, optional syncRunId         │
└───────────────────────────┬─────────────────────────────────┘
                            ▼
              Load sync_cursors row (or insert default page=1)
              If status=complete → no-op (idempotent exit)
                            ▼
              Decrypt PAT (memory only) — never log or persist
                            ▼
              Fetch exactly ONE page (cursor.page) for resource
              Respect dentally/client rate limit + 60s timeout
                            ▼
              Upsert records (ON CONFLICT — idempotent)
                            ▼
         ┌──── success ────┴──── failure ────┐
         ▼                                    ▼
  Advance cursor                      status = failed
  (next page or next month chunk)     cursor UNCHANGED
  status = in_progress                error on sync_runs
  or complete if last page
         ▼
  UPDATE sync_cursors (upsert on practice_id + resource_type)
         ▼
  Touch sync_runs (completed_at if all resources done — later milestone)
```

## Idempotency and safe resume

1. **Cursor advances only after a successful chunk** — fetch + upsert + commit. If the process crashes after upsert but before cursor write, the next run re-processes the same page; upserts dedupe on natural keys (same pattern as `queue/processor.js`).
2. **Never advance cursor on partial page failure** — failed records increment error stats on the run; cursor stays at the last fully completed page.
3. **Re-invocation is safe** — reading `cursor` always means “start here”; no separate “in flight” flag required. `status = failed` means human or scheduler must retry; cursor still points at the correct resume point.
4. **status = complete** — worker exits immediately without calling Dentally (idempotent no-op).
5. **Deploy / crash** — no in-memory state required; only `sync_cursors` + optional in-progress `sync_runs` row.
6. **Concurrent workers** — one active worker per `(practice_id, resource_type)` must be enforced at the application layer (DB row lock or “claim” on `sync_runs`) before M2 implements the runner; cursors alone do not provide mutual exclusion.

## Rate limiting

Reuse `api/dentally/client.js` (`fetchWithRetry`, `X-RateLimit-Remaining`, 403 handling). PE PAT shares the same hourly bucket as any other client using that token.

**Within-chunk backoff** (`sync/rateLimitBackoff.js`): each fetch and enrich step wraps Dentally calls with exponential backoff (default 5 retries, 2s base, 60s cap). If retries are exhausted, the failure is classified as **transient** (see below): cursor stays on the current page, status becomes **`retryable`**, and the scheduler resumes after `next_retry_at`.

## Error categories & retry

All resource syncs go through `syncHelpers.syncResourceChunk` → shared `handleSyncError` / `upsertPeEntityPage`.

| Category | Examples | Cursor / credentials | Auto-retry? |
|----------|----------|----------------------|-------------|
| **Transient** | Network timeout, Dentally 5xx, rate-limit after in-chunk backoff | `status=retryable`, `retry_count++`, `next_retry_at` backoff | Yes, until `PE_SYNC_MAX_RETRIES` (default 5) |
| **Auth** | 401/403 invalid/expired PAT | `status=failed`; `integrations.needs_reconnection=true` | **No** — re-enter PAT in Settings |
| **Data** | Transform/upsert of one bad record | Record logged to `sync_skipped_records`; chunk continues | N/A (skip & continue) |
| **Unknown** | Other unexpected errors | Same as transient (capped) | Yes until max, then `failed` + `sync_runs` error |

Env knobs: `PE_SYNC_MAX_RETRIES`, `PE_SYNC_RETRY_BASE_MS`, `PE_SYNC_RETRY_CAP_MS`.

Successful chunks reset `retry_count` / `next_retry_at` / `last_error*`.

## Scheduling (`peSyncCron.js`)

`node-cron` (same family as `autoSyncCron`, **no Redis**). Three jobs:

| Job | Env | Default | Behavior |
|-----|-----|---------|----------|
| **Resume** | `PE_SYNC_CRON_SCHEDULE` | every 2 min | Drain `retryable` / stale `in_progress` (1 chunk each, cap `PE_SYNC_CRON_MAX_CHUNKS_PER_TICK`) |
| **Incremental kickoff** | `PE_SYNC_INCREMENTAL_SCHEDULE` | every 15 min | For each practice with encrypted PAT: if valid (`validated_at`, `!needs_reconnection`) reset all scheduled cursors to `in_progress` with lookback window (`PE_SYNC_INCREMENTAL_LOOKBACK_DAYS`, default 3) on date-chunked resources; resume drains |
| **Full kickoff** | `PE_SYNC_FULL_SCHEDULE` | `0 2 * * *` UTC | Same reset without lookback — date-chunked resources start from `PE_SYNC_*_START` (default 2020-01-01) |

**PAT skip:** missing / needs reconnection / not validated → `sync_runs` row `status=failed`, `error_message=skipped_no_valid_credential:…` (not silent).

**Overlap:** kickoff skips a practice if any scheduled resource has non-stale `in_progress` (`PE_SYNC_IN_PROGRESS_STALE_MS`, default 120s).

**Date-window resources (lookback):** `appointments`, `treatment_plans`, `treatment_items`, `invoices`, `payments`. Others (`acquisition_sources`, `practitioners`, `patients`, `accounts`, `recalls`, `treatment_appointments`) reset to page 1 full list.

**Ops:**
- `GET /api/economics-engine/sync/status?practiceId=`
- `GET /api/economics-engine/sync/dev/overview?practiceId=` — PAT + cursors + counts (eng inspector)
- `GET /api/economics-engine/sync/dev/ticks` — in-memory recent scheduler ticks
- `POST /api/economics-engine/sync/kickoff-incremental` / `kickoff-full` — JWT + `{ practiceId }`, or `x-service-key` (= service role) with optional practiceId (omit → all candidates)
- Frontend (DEV only): `/dev/pe-sync-inspector` — owner/admin gated
- `node backend/scripts/peSyncStatus.js <practice_id>`
- `node backend/scripts/testPeScheduleKickoff.js [practice_id]`

Membership import is **not** scheduled (upload-triggered Edge Function).

Started from `server.js` via `startPeSyncCron()`.

Env knobs:

```
PE_SYNC_CRON_SCHEDULE=*/2 * * * *
PE_SYNC_INCREMENTAL_SCHEDULE=*/15 * * * *
PE_SYNC_FULL_SCHEDULE=0 2 * * *
PE_SYNC_INCREMENTAL_LOOKBACK_DAYS=3
PE_SYNC_CRON_MAX_CHUNKS_PER_TICK=10
PE_SYNC_IN_PROGRESS_STALE_MS=120000
PE_SYNC_KICKOFF_MAX_PRACTICES=20
```

Day 5 remaining (membership) registers into `resourceRegistry` / `SCHEDULED_RESOURCE_TYPES` — do not rebuild scheduling.

## Recalls (no dedicated Dentally endpoint)

Dentally does **not** expose `GET /v1/recalls`. Recall due dates, intervals, and `recall_method` are attributes on `GET /v1/patients`. PE stores them on existing `public.patients` (columns `pt_*_recall_*`, `pt_recall_method`). `syncRecalls` uses `resource_type: recalls` with its own cursor but upserts via the patients entity/transform.

## Acquisition sources

Dentally patients carry `acquisition_source_id` (UUID). Names come from `GET /v1/acquisition_sources`.

**Approach:** reference table `public.acquisition_sources` + denormalized `pt_acquisition_source_id` / `pt_acquisition_source_name` on `patients` at sync time (same pattern as `appointment_cancellation_reasons` → `apmt_cancellation_reason_name`). CLTV-by-source (M6) can filter/group on the patient columns without a join; the catalog remains for name updates and admin listing.

Sync `acquisition_sources` before (or alongside) patients. To backfill Day-3 patients already synced without the columns:

```bash
node backend/scripts/backfillPePatientAcquisitionSources.js <practice_id>
```

That script syncs the catalog, resets the `patients` cursor, and re-pages patients.

## Resource types

- `acquisition_sources` → `public.acquisition_sources` (catalog; resolve patient source names)
- `practitioners` → `public.providers` (Dentally clinicians; `external_id` = practitioner id)
- `patients` → `public.patients`
- `accounts` → `public.dentally_patients_accounts`
- `recalls` → `public.patients` (recall columns, via patients API)
- `appointments` → `public.appointments` (`GET /v1/appointments`; `apmt_patient_id` ↔ `patients.pt_id`). Requires date windows — PE uses monthly `updated_after`/`updated_before` in the cursor (`chunkStart`/`chunkEnd`).
- `treatment_appointments` → `public.treatment_appointments` (`GET /v1/treatment_appointments`; distinct resource — links to patient, optional appointment, treatment plan)
- `treatment_plans` → `public.treatment_plans` (`GET /v1/treatment_plans`; `tp_patient_id` ↔ `patients.pt_id`). Monthly `created_after`/`created_before` windows. Raw Dentally completion fields synced as-is (Economic Journey derivation is M3).
- `treatment_items` → `public.treatment_plan_items` (`GET /v1/treatment_plan_items`; cursor slug `treatment_items`). Links: `tpi_treatment_plan_id` ↔ `tp_id`, `tpi_patient_id` ↔ `pt_id`. Monthly `updated_after`/`updated_before`. Raw `tpi_price` / charged / completed synced as-is (Contribution Engine is M4).
- `invoices` → `platform_integration_invoices` + nested items → `platform_integration_invoice_line_items` (`GET /v1/invoices` + per-id detail). Monthly `dated_on_*` windows. Links: `patient_id`↔`pt_id`, `account_id`↔`da_id`, `treatment_plan_item_id`↔`tpi_id`. Raw fields as-is (leakage = M6). No separate `invoice_items` cursor — `/sync/invoice-items` aliases `/sync/invoices`.
- `payments` → `dentally_payments` + explanations → `dentally_payment_explanations` (`GET /v1/payments`). Monthly `dated_after`/`dated_before`. Invoice link: `dpe_invoice_id` ↔ `platform_integration_invoices.platform_invoice_id`. Raw fields as-is (collection/aged debt = M7).

## Payment webhooks (real-time Paid/Unpaid worklist)

Poll sync for payments does **not** update `platform_integration_invoices.is_paid` / `amount_outstanding`. Post-sync payments therefore leave the PE Invoices worklist stale until invoices are re-synced. Payment webhooks close that gap.

**Endpoint (configure in Dentally → Settings → Developer → Webhooks):**

```
POST https://{API_HOST}/api/dentally-webhook/payments?practice_id={organization_uuid}
```

**Events:** `payment.created`, `payment.updated`, `payment.deleted`

**Signing:** HMAC-SHA256 hex digest of the raw POST body in header `X-Dentally-Signature`. Store the webhook secret in `integrations.webhook_secret` for the Dentally row (or set env `DENTALLY_WEBHOOK_SECRET` as fallback).

**Processing flow:**

1. Verify signature → append `dentally_webhook_logs` row
2. Re-fetch full payment from `GET /v1/payments/{id}` (webhook payload may omit nested `explanations`)
3. Upsert via `upsertPaymentsWithExplanations` + event ledger (`PAYMENT_ALLOCATED`)
4. For each `explanations[].invoice_id` (and prior links on delete): `GET /v1/invoices/{id}` → `upsertInvoicesWithLineItems`
5. **Incremental** facts refresh via RPC `pe_webhook_refresh_contribution_facts(practice_id, platform_invoice_ids[])` — upserts touched invoice facts, re-aggregates affected patient grains, refreshes practice rollup (not full-practice delete/rescan)
6. Invalidate PE invoice read cache

Prior invoice ids on delete: single-query RPC `pe_webhook_payment_invoice_ids(practice_id, dp_id)`.

**Related files:** `routes/dentallyWebhook.js`, `services/patientEconomics/webhooks/*`

## Appointment webhooks (real-time diary + Treatment_* link alignment)

Poll sync for appointments and treatment_appointments runs on a ~15 min incremental schedule. Post-sync diary changes (state, cancelled, DNA, booking) and `ta_appointment_id` link transitions therefore leave `appointments`, `treatment_appointments`, and `event_ledger` stale until the next chunk. Appointment webhooks close that gap.

**Endpoint (configure in Dentally → Settings → Developer → Webhooks):**

```
POST https://{API_HOST}/api/dentally-webhook/appointments?practice_id={organization_uuid}
```

**Events:** `appointment.created`, `appointment.updated`, `appointment.deleted`

**Signing:** same HMAC-SHA256 on raw body (`X-Dentally-Signature`) using `integrations.webhook_secret`.

**Processing flow:**

1. Verify signature → append `dentally_webhook_logs` row
2. Re-fetch full appointment from `GET /v1/appointments/{id}?cancelled=true` (webhook payload may omit fields or contain defaults)
3. Upsert via `upsertAppointments` (UUID-aware split upsert)
4. Discover linked `treatment_appointments` candidates via RPC `pe_webhook_discover_ta_ids` (single indexed query) plus recent API lookback scan
5. Batch-fetch TA details from Dentally (concurrency `APPOINTMENT_WEBHOOK_TA_CONCURRENCY`, default 3)
6. RPC `pe_webhook_ta_ledger_prefetch` + one batch upsert + one ledger write for all touched TAs
7. On delete + API 404: soft-delete local `appointments` row (`deleted_at`)
8. Invalidate PE journey/leakage read caches Dentally does not expose webhooks for `treatment_plans`, `treatment_plan_items`, or direct `treatment_appointments` changes — those remain poll-synced.

**Related files:** `routes/dentallyWebhook.js`, `services/patientEconomics/webhooks/processAppointmentWebhook.js`, `services/patientEconomics/webhooks/webhookAppointmentRefresh.js`

**Migrations:** `20260904140001_pe_webhook_appointment_ta_rpcs.sql` (`pe_webhook_discover_ta_ids`, `pe_webhook_ta_ledger_prefetch`)

Use lowercase slugs in `sync_cursors.resource_type`.

## Related files

- `routes/economicsEngine.js` — PAT CRUD + sync chunk routes + kickoff/status
- `services/patientEconomics/sync/syncAcquisitionSources.js`
- `services/patientEconomics/sync/syncPractitioners.js`
- `services/patientEconomics/sync/syncPatients.js`
- `services/patientEconomics/sync/syncAccounts.js`
- `services/patientEconomics/sync/syncRecalls.js`
- `services/patientEconomics/sync/syncAppointments.js`
- `services/patientEconomics/sync/syncTreatmentAppointments.js`
- `services/patientEconomics/sync/syncTreatmentPlans.js`
- `services/patientEconomics/sync/syncTreatmentItems.js`
- `services/patientEconomics/sync/syncInvoices.js`
- `services/patientEconomics/sync/syncPayments.js`
- `services/patientEconomics/sync/syncHelpers.js` — shared chunk + error/retry handling
- `services/patientEconomics/sync/upsertPePage.js` — per-record skip → `sync_skipped_records`
- `services/patientEconomics/sync/resourceRegistry.js` — resource_type → sync fn
- `services/patientEconomics/sync/peScheduleKickoff.js` — incremental/full cursor reset
- `services/patientEconomics/sync/peSyncCron.js` — resume + kickoff schedules
- `services/patientEconomics/sync/retryPolicy.js` / `dentallyErrors.js` / `credentialsStatus.js`
- `services/patientEconomics/sync/rateLimitBackoff.js`
- `services/patientEconomics/sync/cursorStore.js`
- `scripts/syncPeAcquisitionSources.js`, `syncPePractitioners.js`, `syncPePatients.js`, `syncPeAccounts.js`, `syncPeRecalls.js`, `syncPeAppointments.js`, `syncPeTreatmentAppointments.js`, `syncPeTreatmentPlans.js`, `syncPeTreatmentItems.js`, `syncPeInvoices.js`, `syncPePayments.js`
- `scripts/peSyncStatus.js` — cursor status dump
- `scripts/testPeScheduleKickoff.js` — kickoff smoke test
- `scripts/backfillPePatientAcquisitionSources.js` — catalog sync + patients cursor reset + re-page
- `scripts/testPeRateLimitBackoff.js` — simulated 429 backoff test
- `scripts/testPeSyncRetry.js` — error category + retry decision tests
- `api/dentally/client.js` — shared fetch + rate limit (reuse, do not fork)
- `services/sync/upsert.js` + `services/transformers/dentally.js`

## Migrations

- `20260823150001_patient_economics_sync_cursors.sql`
- `20260823160001_add_patient_recall_columns.sql`
- `20260823170001_acquisition_sources_and_patient_columns.sql`
- `20260824120001_pe_sync_retry_and_scheduling.sql`
