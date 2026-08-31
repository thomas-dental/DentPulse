# Patient Economics — secrets & environment variables

**Read this before configuring any environment.** PE uses two **separate** secret surfaces. They are **not interchangeable**.

| Surface | Where configured | Used by |
|---------|------------------|---------|
| **Backend secrets** | `dental-pulse-api-backend/.env` or host env (Railway, etc.) | Express API — PAT, sync, aggregations, cron |
| **Edge Function secrets** | Supabase Dashboard → Edge Functions → secrets, or `supabase secrets set` | `patient-economics-membership-import` only |

Putting the service role key only in the backend does **not** deploy it to Edge Functions. Putting Edge secrets in the backend `.env` does **not** inject them into Edge Functions.

---

## 1. Backend secrets

**File:** `dental-pulse-api-backend/.env` (local) or deployment platform environment variables (production).

**Never** commit real values. **Never** expose `SUPABASE_SERVICE_ROLE_KEY` or `TOKEN_ENCRYPTION_KEY` to the browser.

### Required for PE

| Variable | Purpose |
|----------|---------|
| `VITE_SUPABASE_URL` | Supabase project URL (shared naming with frontend; backend uses it for `supabaseAdmin`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role / secret key — bypasses RLS for sync writes and read aggregations. Alias accepted: `SUPABASE_SECRET_KEY` |
| `TOKEN_ENCRYPTION_KEY` | 32-byte key (base64 or hex) for AES-GCM encryption of Dentally PATs in `integrations.encrypted_pat` |
| `DENTALLY_API_BASE_URL` | Dentally API host (default `https://api.dentally.co`) — PAT validation and all sync fetches |

### Supabase auth (backend)

| Variable | Purpose |
|----------|---------|
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Anon key — used by `supabase` client for `auth.getUser(jwt)` in middleware |

### PE sync scheduler & intervals

These control **node-cron** in `peSyncCron.js`. Planning docs sometimes use informal names; **these are the actual variable names in code**.

| Variable | Default | Role | Informal / planning alias |
|----------|---------|------|---------------------------|
| `PE_SYNC_CRON_ENABLED` | unset (`false`) | Must be `true` to run PE cron on this process | — |
| `PE_SYNC_CRON_SCHEDULE` | `*/2 * * * *` | **Resume tick** — drains retryable/stale cursors (chunks per practice) | Sometimes called “scheduler tick” |
| `PE_SYNC_INCREMENTAL_SCHEDULE` | `*/15 * * * *` | **Incremental kickoff** — lookback window on date-chunked resources | Sometimes called “delta / incremental interval” |
| `PE_SYNC_FULL_SCHEDULE` | `0 2 * * *` (02:00 UTC) | **Full kickoff** — resets date windows to historical start | `SYNC_FULL_CRON_SCHEDULE` in planning notes |
| `PE_SYNC_INCREMENTAL_LOOKBACK_DAYS` | `3` | Days of history for incremental kickoff | — |
| `PE_SYNC_CRON_MAX_CHUNKS_PER_TICK` | `10` | Max resource chunks processed per resume tick | — |
| `PE_SYNC_IN_PROGRESS_STALE_MS` | `120000` | Stale `in_progress` cursor threshold (ms) | — |
| `PE_SYNC_KICKOFF_MAX_PRACTICES` | `20` | Cap practices per kickoff wave | — |
| `PE_MODELLED_COMPUTE_SCHEDULE` | `30 3 * * *` | Nightly modelled CLTV / quality score job | — |
| `PE_MODELLED_MAX_PRACTICES` | `20` | Practices per modelled-score run | — |

> **Note:** `SYNC_DELTA_INTERVAL_MINUTES` and `SCHEDULER_TICK_INTERVAL_MINUTES` do **not** exist as env vars. Map them to cron expressions above (`PE_SYNC_INCREMENTAL_SCHEDULE` and `PE_SYNC_CRON_SCHEDULE`).

### PE sync retry / rate limit

| Variable | Default | Purpose |
|----------|---------|---------|
| `PE_SYNC_MAX_RETRIES` | `5` | Max auto-retries for transient sync failures |
| `PE_SYNC_RETRY_BASE_MS` | `30000` | Retry backoff base |
| `PE_SYNC_RETRY_CAP_MS` | `900000` | Retry backoff cap |
| `PE_SYNC_RATE_LIMIT_MAX_RETRIES` | `5` | In-chunk Dentally 429 retries |
| `PE_SYNC_RATE_LIMIT_BASE_MS` | `2000` | Rate-limit backoff base |
| `PE_SYNC_RATE_LIMIT_CAP_MS` | `60000` | Rate-limit backoff cap |
| `PE_SYNC_TICK_HISTORY_SIZE` | `25` | In-memory scheduler tick log size (dev inspector) |

### PE sync date range

| Variable | Default | Purpose |
|----------|---------|---------|
| `PE_SYNC_DEFAULT_START` | `2020-01-01` | Historical start for date-chunked resources on full kickoff |
| `PE_SYNC_APPOINTMENTS_START` | falls back to default | Optional override for appointments window |

### Dentally client

| Variable | Default | Purpose |
|----------|---------|---------|
| `DENTALLY_VALIDATE_TIMEOUT_MS` | `15000` | PAT validation HTTP timeout |

### General backend (not PE-specific but required to run API)

| Variable | Purpose |
|----------|---------|
| `PORT` | HTTP port (e.g. `4000` local, `5000` in some templates) |
| `NODE_ENV` | `development` / `production` |
| `CORS_ALLOWED_ORIGINS` | Optional comma-separated extra CORS origins |

### Machine / cron authentication

Kickoff and some sync routes accept:

```
x-service-key: <same value as SUPABASE_SERVICE_ROLE_KEY>
```

Used for scheduled kickoff without a user JWT. **Same secret as service role** — still backend-only, never sent to the browser.

### What stays on the backend (never Edge Functions)

- `TOKEN_ENCRYPTION_KEY` — PAT decrypt only in Node process memory during sync  
- Dentally PAT plaintext — never stored; only encrypted blob in Postgres  
- PE sync worker loops and `peSyncCron.js`  
- Read aggregation queries using service role  

---

## 2. Edge Function secrets

**Configure in Supabase only** for the membership import function.

**Function name:** `patient-economics-membership-import`  
**Path:** `dental-pulse-dev/supabase/functions/patient-economics-membership-import/`

### Required Edge Function secrets

Supabase injects some keys automatically when the project is linked. The function **explicitly reads**:

| Secret | Purpose |
|--------|---------|
| `SUPABASE_URL` | Project URL (often auto-injected as `SUPABASE_URL`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role inside the function — Storage download, bulk upsert, `auth.getUser` |

Set via CLI (example):

```bash
supabase secrets set SUPABASE_SERVICE_ROLE_KEY="<your-service-role-key>"
# SUPABASE_URL is usually provided by the platform when deployed
```

Or: Supabase Dashboard → **Project Settings → Edge Functions → Secrets**.

### What this function does **not** need

| Secret | Why not |
|--------|---------|
| `TOKEN_ENCRYPTION_KEY` | No Dentally PAT — CSV membership export only |
| `DENTALLY_API_BASE_URL` | No Dentally HTTP calls |
| `PE_SYNC_*` | Sync runs on backend cron, not this function |

### Frontend invocation (no extra secrets)

The browser calls:

1. `supabase.storage.from('membership-imports').upload(...)` — user JWT + RLS on Storage  
2. `supabase.functions.invoke('patient-economics-membership-import', { body })` — user JWT passed automatically  

The Edge Function validates the user belongs to `organizationId` via `user_roles` before using the **service role** server-side.

### Other Edge Functions in the repo

DentPulse has many Edge Functions (Xero, QuickBooks, `dentally-sync`, etc.). **This section applies only to PE membership import.** Do not assume their secrets match the backend `.env` file unless you explicitly set them in Supabase.

---

## 3. Frontend build-time variables (not backend, not Edge secrets)

Set in `dental-pulse-dev/.env` or Vercel **build** env:

| Variable | Purpose |
|----------|---------|
| `VITE_SUPABASE_URL` | Supabase URL for client SDK |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Anon key — RLS applies to direct reads |
| `VITE_BACKEND_URL` | PE API base (default `http://localhost:4000` on localhost) |
| `VITE_SYNC_BACKEND_URL` | Fallback alias for backend URL |

The frontend **never** receives `SUPABASE_SERVICE_ROLE_KEY` or `TOKEN_ENCRYPTION_KEY`.

---

## 4. Quick checklist

### New developer laptop

- [ ] Backend `.env` with Supabase URL, service role, `TOKEN_ENCRYPTION_KEY`, `DENTALLY_API_BASE_URL`  
- [ ] Frontend `.env` with `VITE_SUPABASE_*` and `VITE_BACKEND_URL`  
- [ ] Migrations applied  
- [ ] Optional: `PE_SYNC_CRON_ENABLED=true` on backend for automatic sync  

### New Supabase project / production

- [ ] Migrations applied  
- [ ] Backend host env: all §1 backend secrets  
- [ ] `supabase functions deploy patient-economics-membership-import`  
- [ ] Edge secrets: `SUPABASE_SERVICE_ROLE_KEY` (and verify `SUPABASE_URL`)  
- [ ] Storage bucket `membership-imports` + RLS policies  
- [ ] Frontend build env: `VITE_*` pointing at prod API and Supabase  

### Debugging “wrong key” issues

| Symptom | Likely cause |
|---------|----------------|
| Backend sync 401 / empty reads | Wrong or missing `SUPABASE_SERVICE_ROLE_KEY` on **backend** |
| Membership import 500 / auth errors | Service role not set on **Edge Function** secrets |
| PAT save works but sync never runs | `PE_SYNC_CRON_ENABLED` not `true` on backend instance |
| Frontend can’t reach API | `VITE_BACKEND_URL` or CORS |

---

## 5. Security reminders

1. Rotate `TOKEN_ENCRYPTION_KEY` only with a planned PAT re-entry migration — existing encrypted PATs cannot be decrypted with a new key.  
2. Service role bypasses RLS — keep it on server runtimes only (backend process + membership Edge Function).  
3. Do not log PATs, service keys, or decrypted tokens.  
4. `x-service-key` on kickoff routes equals service role — treat as highly sensitive.
