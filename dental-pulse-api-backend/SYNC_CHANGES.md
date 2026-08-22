# Dentally Sync Process - Changes & Improvements

**Date:** 2026-02-18
**Branch:** node-auto-sync

---

## 1. Superadmin Default Sync Date Range Fix

**Problem:** The frontend onboarding (DentallyIntegrationStep.tsx) hardcoded sync date range to "Jan 1 of current year → Today", always overriding the superadmin-configured date range in `syncSettings.json`.

**Root Cause:** The frontend always sent `startDate`/`endDate` to the Node backend. The backend's hierarchy is:
1. Per-request override (from frontend) — always won
2. Global config from `syncSettings.json` — never reached
3. Default 365 days fallback

**Fix:**
- **File:** `dental-pulse-dev/src/components/onboarding/DentallyIntegrationStep.tsx`
- Changed to pass `null, null` for dates so the backend uses `syncSettings.json` config
- Backend now correctly reads superadmin-configured date range (e.g., `2026-02-01` to `2026-02-13`)

---

## 2. Invoices Enabled by Default

**Problem:** Invoices and invoice line items were not synced during onboarding.

**Root Cause:** `dentallyConfig.ts` had `is_sync: 0` for invoices.

**Fix:**
- **File:** `dental-pulse-dev/src/services/integrations/dentallyConfig.ts`
- Changed invoices `is_sync: 0` → `is_sync: 1` (enabled by default)
- Invoice line items are automatically synced when invoices are enabled

---

## 3. Three-Phase Job Processing (Location ID Mapping Fix)

**Problem:** `location_id` was `null` in all synced tables (patients, appointments, invoices, etc.).

**Root Cause:** With `CONCURRENCY_PER_ORG = 3`, date entities (patients, appointments, invoices) started processing before `locations` finished syncing. When they loaded `getLocationMap()`, the `practice_locations` table was empty.

**Fix:**
- **File:** `dental-pulse-api-backend/backend/queue/jobQueue.js`
- Implemented three-phase processing with a phase gate:

```
Phase 1: locations + treatment_category
         (must ALL complete before Phase 2 starts)

Phase 2: payment_plans, treatments, practitioners
         (need locationMap/categoryMap — run in parallel after Phase 1)
         (must ALL complete before Phase 3 starts)

Phase 3: patients, appointments, invoices, treatment_plans, etc.
         (need locationMap — run with concurrency 3 after Phase 2)
```

- Added `activePhase1Workers` and `activePhase2Workers` tracking maps
- `getJobPhase(job)` function determines phase from entity_alias and start_date
- `processQueue()` enforces phase gate: higher phases wait for lower phases to finish

---

## 4. Practitioners Location ID Mapping

**Problem:** `providers` table had no `location_id` mapped from Dentally `site_id`.

**Fix:**
- **File:** `dental-pulse-api-backend/backend/api/dentally/config.js`
  - Added `'practitioners'` to `ENTITIES_NEEDING_LOCATION_MAP`
- **File:** `dental-pulse-api-backend/backend/services/transformers/dentally.js`
  - `transformPractitioner()` now receives `locationMap` and maps `record.site_id` → `location_id`
- Already handled by Phase 2 in the phase gate (runs after locations complete)

---

## 5. Parallel Invoice Detail Fetching

**Problem:** Invoice detail fetching was sequential — 1 API call per invoice + 300ms delay. A page of 100 invoices took ~30 seconds of pure sleep time.

**Fix:**
- **File:** `dental-pulse-api-backend/backend/api/dentally/client.js`
  - Added `fetchInvoiceDetailsBatch()` — fetches N invoice details concurrently using `Promise.allSettled`
  - Default concurrency: 10 (auto-adjusts based on rate limit state)
- **File:** `dental-pulse-api-backend/backend/queue/processor.js`
  - Replaced sequential loop with `fetchInvoiceDetailsBatch()` call

**Impact:** Invoice detail fetching ~15x faster (30s → ~2s per page)

---

## 6. Increased Job Concurrency

**Problem:** Only 1 job ran at a time per organization (`CONCURRENCY_PER_ORG = 1`).

**Fix:**
- **File:** `dental-pulse-api-backend/backend/queue/jobQueue.js`
- Changed `CONCURRENCY_PER_ORG = 1` → `CONCURRENCY_PER_ORG = 3`
- Entities write to different tables so parallel processing is safe
- Phase gate ensures correct ordering (see #3 above)

**Impact:** ~3x faster overall sync

---

## 7. Reduced Inter-Page Delay

**Problem:** 500ms sleep between every page fetch.

**Fix:**
- **File:** `dental-pulse-api-backend/backend/queue/processor.js`
- Changed `await sleep(500)` → `await sleep(150)`

**Impact:** ~3x faster page processing

---

## 8. Increased Batch Upsert Size

**Problem:** Batch upsert size was 50 records, causing 2 Supabase API calls per page of 100 records.

**Fix:**
- **File:** `dental-pulse-api-backend/backend/services/sync/upsert.js`
- Changed `BATCH_SIZE = 50` → `BATCH_SIZE = 200`

**Impact:** Fewer DB round-trips, faster upserts

---

## 9. Smart Date Range Chunking

**Problem:** All date ranges were split into monthly chunks, even small ranges (e.g., Feb 1-13). This created unnecessary jobs and queue overhead.

**Fix:**
- **File:** `dental-pulse-api-backend/backend/queue/jobQueue.js`
- Date ranges ≤ 62 days use a single chunk instead of monthly splitting
- Larger ranges still use monthly chunks (newest first)

---

## 10. Progress Tracking & Retry Resume Fix

**Problem:**
- Progress was only saved every 5 pages → stale page counts in UI
- On retry, jobs restarted from page 1 instead of resuming from last saved page
- `markCompleted` overwrote `total_pages` with `currentPage`

**Fixes:**
- **File:** `dental-pulse-api-backend/backend/queue/processor.js`
  - Progress updates every page (reverted from every 5 pages)
  - On retry, resumes from `job.current_page + 1` (skips already-processed pages)
  - Preserves `totalProcessed` and `totalFailed` from previous run
  - Passes actual `totalPages` to `markCompleted`
  - Initializes `knownTotalPages` from `job.total_pages` (preserved across retries)
- **File:** `dental-pulse-api-backend/backend/services/sync/logger.js`
  - `markCompleted()` now accepts and uses `totalPages` parameter instead of overwriting with `currentPage`

---

## 11. Orphan Job Recovery on Server Restart

**Problem:** On server restart, `initialize()` found jobs with `status: running` and re-enqueued them — even if they had already completed (`completed_at` set, `progress_percentage: 100`). This caused jobs to be re-processed and show stuck "running" status.

**Fix:**
- **File:** `dental-pulse-api-backend/backend/queue/jobQueue.js`
- `initialize()` now checks: if a job has `completed_at` set AND `progress_percentage >= 100`, it fixes the status to `completed` instead of re-enqueuing

---

## 12. Smart Rate Limit Handling

**Problem:** When Dentally API rate limit hit 0:
- 5 retries with exponential backoff (30s → 480s), then job fails permanently
- Rate limit counted as a retry (max 3 retries total)
- No proactive detection — always hit the wall
- 10 concurrent invoice fetches drained the limit fast

**Fixes:**
- **File:** `dental-pulse-api-backend/backend/api/dentally/client.js` (full rewrite)
  - **Reads rate limit headers** (`X-RateLimit-Remaining`, `X-RateLimit-Reset`) from every response
  - **Proactive throttling:**
    - Remaining > 30: full speed (10 concurrent invoice fetches)
    - Remaining 10-30: reduce to 5 concurrent
    - Remaining 3-10: add 500ms delay + reduce to 2 concurrent
    - Remaining ≤ 3: pause until `X-RateLimit-Reset` time
  - **Smart backoff:** uses `X-RateLimit-Reset` header for exact wait time (caps at 2 min)
  - **8 retries** instead of 5
  - Throws `RATE_LIMIT_EXHAUSTED` special error (not a normal failure)
  - `getInvoiceBatchConcurrency()` dynamically adjusts invoice batch size

- **File:** `dental-pulse-api-backend/backend/queue/processor.js`
  - `RATE_LIMIT_EXHAUSTED` errors are NOT counted as retries
  - Returns `'rate_limited'` result to the queue

- **File:** `dental-pulse-api-backend/backend/queue/jobQueue.js`
  - `runWorker()` handles `'rate_limited'` result:
    - Pauses the entire org queue for 60 seconds
    - Re-enqueues the job (resumes from last saved page)
    - Job NEVER permanently fails due to rate limits

---

## Files Changed Summary

### Frontend (`dental-pulse-dev`)

| File | Change |
|------|--------|
| `src/components/onboarding/DentallyIntegrationStep.tsx` | Stop overriding superadmin date range |
| `src/services/integrations/dentallyConfig.ts` | Enable invoices by default |

### Backend (`dental-pulse-api-backend`)

| File | Change |
|------|--------|
| `backend/api/dentally/client.js` | Smart rate limiting, parallel invoice fetch, proactive throttling |
| `backend/api/dentally/config.js` | Added practitioners to ENTITIES_NEEDING_LOCATION_MAP |
| `backend/queue/jobQueue.js` | 3-phase processing, concurrency 3, smart chunking, orphan recovery, rate limit pause |
| `backend/queue/processor.js` | Per-page progress, retry resume, parallel invoices, rate limit handling |
| `backend/services/sync/logger.js` | Fixed markCompleted to preserve totalPages |
| `backend/services/sync/upsert.js` | Batch size 50 → 200 |
| `backend/services/transformers/dentally.js` | Added location_id mapping for practitioners |

---

## Sync Flow Diagram (After Changes)

```
Frontend triggers sync
  → POST /api/sync/trigger/{orgId} (no dates — uses superadmin config)
    → jobQueue.js reads syncSettings.json for date range
    → Creates jobs in 3 phases:

    Phase 1: locations, treatment_category (sequential)
      ↓ (must complete before Phase 2)
    Phase 2: payment_plans, treatments, practitioners (parallel, max 3)
      ↓ (must complete before Phase 3)
    Phase 3: patients, appointments, invoices, etc. (parallel, max 3)

    Each job:
      → processor.js fetches all pages from Dentally API
      → Reads rate limit headers, auto-throttles
      → Invoices: parallel batch detail fetch (auto-adjusts 1-10 concurrent)
      → Transforms records with locationMap/categoryMap
      → Batch upserts to Supabase (200 per batch)
      → Saves progress every page
      → On rate limit: pauses 60s, resumes from last page
      → On error: retries 3x from last saved page
      → On completion: marks job completed with accurate totals
```
