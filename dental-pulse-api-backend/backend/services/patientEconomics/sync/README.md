# Patient Economics Engine — Dentally sync architecture

Backend-only sync (requires decrypted PAT from `dentally_credentials`). Not an Edge Function: no execution-ceiling constraint; chunking is sized for HTTP timeouts, rate limits, and deploy/crash resilience.

## Tables

| Table | Role |
|-------|------|
| `dentally_credentials` | Encrypted PAT per `practice_id` (one row per practice) |
| `sync_runs` | Append-oriented **run** audit: started/completed, overall status, error |
| `sync_cursors` | **Standing checkpoint** per `(practice_id, resource_type)` — upserted after each chunk |

`sync_runs` answers “what happened on run X?”  
`sync_cursors` answers “where do I resume patients for this practice?”

### Why not `sync_jobs`?

Existing Dentally sync uses `sync_jobs` + in-memory queues keyed by `integrations.id` and `integrations.api_key`. PE uses `dentally_credentials` (PAT per organization/practice). Reusing `sync_jobs` would couple PE to the integrations table and the main Dentally job queue without a clear win. Cursors are intentionally separate and practice-scoped.

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

**Within-chunk backoff** (`sync/rateLimitBackoff.js`): each fetch and enrich step wraps Dentally calls with exponential backoff (default 5 retries, 2s base, 60s cap). If retries are exhausted:

- Cursor **stays at the current page** (no progress lost from a completed prior page)
- `sync_cursors.status` remains **`in_progress`** (not `failed`)
- Response `errorCode: RATE_LIMIT_RETRY` — invoke again later
- `sync_runs.error_message` notes the pause; run stays `running`

Hard `failed` is reserved for PAT auth errors and non-recoverable sync errors.

## Recalls (no dedicated Dentally endpoint)

Dentally does **not** expose `GET /v1/recalls`. Recall due dates, intervals, and `recall_method` are attributes on `GET /v1/patients`. PE stores them on existing `public.patients` (columns `pt_*_recall_*`, `pt_recall_method`). `syncRecalls` uses `resource_type: recalls` with its own cursor but upserts via the patients entity/transform.

## Resource types

- `patients` → `public.patients`
- `accounts` → `public.dentally_patients_accounts`
- `recalls` → `public.patients` (recall columns, via patients API)
- `appointments` → `public.appointments` (`GET /v1/appointments`; `apmt_patient_id` ↔ `patients.pt_id`). Requires date windows — PE uses monthly `updated_after`/`updated_before` in the cursor (`chunkStart`/`chunkEnd`).
- `treatment_appointments` → `public.treatment_appointments` (`GET /v1/treatment_appointments`; distinct resource — links to patient, optional appointment, treatment plan)
- `treatment_plans` → `public.treatment_plans` (`GET /v1/treatment_plans`; `tp_patient_id` ↔ `patients.pt_id`). Monthly `created_after`/`created_before` windows. Raw Dentally completion fields synced as-is (Economic Journey derivation is M3).

Use lowercase slugs in `sync_cursors.resource_type`.

## Related files

- `routes/economicsEngine.js` — PAT CRUD + `POST /sync/{patients,accounts,recalls,appointments,treatment-appointments,treatment-plans}`
- `services/patientEconomics/sync/syncPatients.js`
- `services/patientEconomics/sync/syncAccounts.js`
- `services/patientEconomics/sync/syncRecalls.js`
- `services/patientEconomics/sync/syncAppointments.js`
- `services/patientEconomics/sync/syncTreatmentAppointments.js`
- `services/patientEconomics/sync/syncTreatmentPlans.js`
- `services/patientEconomics/sync/syncHelpers.js` — shared chunk logic + rate-limit handling
- `services/patientEconomics/sync/rateLimitBackoff.js`
- `services/patientEconomics/sync/cursorStore.js`
- `scripts/syncPePatients.js`, `syncPeAccounts.js`, `syncPeRecalls.js`, `syncPeAppointments.js`, `syncPeTreatmentAppointments.js`, `syncPeTreatmentPlans.js`
- `scripts/testPeRateLimitBackoff.js` — simulated 429 backoff test
- `api/dentally/client.js` — shared fetch + rate limit (reuse, do not fork)
- `services/sync/upsert.js` + `services/transformers/dentally.js`

## Migrations

- `20260823150001_patient_economics_sync_cursors.sql`
- `20260823160001_add_patient_recall_columns.sql`
