# Sage — Multiple Account Connections Plan (Xero / QuickBooks parity)

> **Status:** ✅ IMPLEMENTED 2026-06-02 (uncommitted) — backend + frontend done, dedup = Xero-style, `/status`+`/disconnect` now per-`integration_id`. Pending: live test with a 2nd Sage account.
> **Created:** 2026-06-02
> **Principle:** Mirror the existing **Xero** multi-connection flow exactly (the Xero card in `AccountingIntegrationsHub.tsx` + `xero-auth` / `xero-callback` edge functions).
> **Goal:** Let a user connect **multiple separate Sage accounts (logins)** under one DentPulse org — each connection = its own `platform_integrations` row — exactly like Xero & QuickBooks already do.

---

## What this is (and is NOT)

| | Description |
|---|---|
| ✅ **THIS task — multi-CONNECTION** | Many *separate Sage logins*, each a separate `platform_integrations` row. After connecting one, the card still shows **"+ Connect my Sage account"** + an **ACTIVE CONNECTIONS** list with per-connection Sync / Disconnect / Reconnect / Delete. |
| ❌ **NOT this — multi-BUSINESS (already built, Feature 2)** | ONE Sage login → many businesses via the `X-Business` header, mapped 1:1 to locations. That is separate and already done (uncommitted). |

Both coexist: each connection can itself hold N businesses.

---

## How Xero does it today (the template we copy)

### Frontend — `dental-pulse-dev/src/components/settings/AccountingIntegrationsHub.tsx`
- **Connect button persists after connecting** (~L1808-1814). Label toggles on `hasXeroIntegration`:
  ```tsx
  {isXeroConnecting ? 'Connecting...' : hasXeroIntegration ? 'Connect my Xero account' : 'Connect to Xero'}
  ```
  onClick → `initiateXeroOAuth(undefined, false)` — **undefined connectionId = NEW connection**.
- **ACTIVE CONNECTIONS list** (~L1817-1856): iterates the `xeroIntegrations` array. Per connection:
  - tenants = `platformOrganizations.filter(o => o.platform_integration_id === xero.id && o.platform_name === 'xero')`
  - connected → **Sync** (`handleXeroSync(xero.id)`) + **Disconnect** (`disconnectPlatform('xero', xero.id)`)
  - disconnected → **Reconnect** (`initiateXeroOAuth(xero.id)`) + **Delete** (`deleteConnection(xero.id)`)
  - per-connection spinners: `isSyncing === xero.id`, `isDisconnecting === xero.id`, `oauthInProgress === xero.id`
  - display: first tenant name + tenant count (`1 tenant` / `N tenants`)
- **Data fetch** (~L538): `xeroIntegrations` comes straight from the table —
  ```ts
  supabase.from('platform_integrations').select('*')
    .eq('organization_id', currentOrgId).eq('platform_name', 'xero')
    .order('created_at', { ascending: false });
  ```

### OAuth (edge functions)
- `xero-auth/index.ts` (~L99-133): state encoding — NEW connect → `state = "new:<org>:<user>:<nonce>"` (deferred, no row yet); reconnect → `state = existing integration UUID`.
- `xero-callback/index.ts` (~L232-280): dedups by tenant, then **INSERTs a fresh `platform_integrations` row** for `"new:"` state, or UPDATEs the existing row for reconnect.

---

## Why Sage is single-connection today (3 blockers)

| # | Layer | File:line | Current behaviour |
|---|---|---|---|
| (a) | **Frontend** | `AccountingIntegrationsHub.tsx` ~L1961-1999 | Sage branch shows only `Connect` **or** `Sync + Disconnect`. No "connect another" button, no active-connections list (footer ~L2001-2039 shows a single "Connection"). Uses single `sageStatus` / `isSageConnected`. |
| (b) | **Backend** | `backend/api/sage/client.js` `saveTokens()` ~L179-224 | `.maybeSingle()` → at most ONE row per org+platform. Exists → **UPDATE (overwrite)**; else INSERT. A second Sage connect **overwrites the first**. |
| (c) | **OAuth state** | `backend/routes/sageSync.js` `/connect` ~L78-120, `/callback` ~L124-221 | In-memory `state → {orgId,userId,redirectTo}`. No `connectionId` / "new:" concept → can't distinguish new-vs-reconnect. |

> ✅ No DB schema change needed: `platform_integrations` has **no unique(org, platform) constraint** (Xero/QB already store multiple rows there).

---

## Architecture note (must respect)

- Xero/QB OAuth runs in **Supabase edge functions**. Sage OAuth runs in **backend Express routes** (`/api/sage/connect` + `/callback`).
- **Keep Sage on backend routes** — only add multi-connection support. Do **NOT** rewrite Sage OAuth as an edge function (out of scope + risky).

---

## Implementation plan

### A. Backend — `dental-pulse-api-backend`

**A1.** `api/sage/client.js → saveTokens(organizationId, userId, tokens, integrationId = null)`
- Remove the `.maybeSingle()` single-row enforcement.
- `integrationId` provided (reconnect) → **UPDATE** that row.
- Not provided (new connect) → **INSERT** a new row (multiple rows per org allowed).

**A2.** `routes/sageSync.js → GET /connect`
- Accept optional `integration_id` query param; store it in the `oauthStates` map entry (reconnect intent).

**A3.** `routes/sageSync.js → GET /callback`
- Read `integrationId` from the state entry; pass to `saveTokens(...)`.
- After token exchange + `fetchBusinesses`, add **Xero-style dedup**: if a returned business already belongs to another Sage integration, reuse that row (avoid duplicate when the same login is connected twice).

**A4.** `POST /disconnect` — accept `integration_id` and disconnect **that specific** connection (drop the maybeSingle assumption).

**A5.** `POST /sync` (dev-sync) — accept `integration_id` and sync **that** connection only.

**A6.** `GET /status` — make list-aware (or rely on the frontend querying the table directly, per B1).

### B. Frontend — `AccountingIntegrationsHub.tsx` (mirror the Xero branch)

**B1.** New `sageIntegrations` state array, fetched from `platform_integrations` where `platform_name='sage'` (same query shape as Xero ~L538).

**B2.** Sage connect button **persists** (like ~L1808): label `hasSageIntegration ? 'Connect my Sage account' : 'Connect to Sage'`; onClick `connectSage(undefined)`.

**B3.** Add **ACTIVE CONNECTIONS** footer (copy Xero ~L1817-1856): `sageIntegrations.map(...)`; per row businesses = `platformOrganizations.filter(o => o.platform_integration_id === sage.id && o.platform_name === 'sage')`; connected → Sync + Disconnect; disconnected → Reconnect + Delete.

**B4.** `connectSage(integrationId?)` → pass `integration_id` to backend `/connect` (reconnect).

**B5.** Per-connection handlers: `handleSageSync(id)`, `disconnectSage(id)`, reuse `deleteConnection(id)`, reconnect = `connectSage(id)`.

**B6.** Per-connection spinner state: `isSageSyncing === id`, `isDisconnecting === id`, `oauthInProgress === id` (replacing the single `sageStatus` / `isSageConnected` rendering).

### C. Interaction with Feature 2 (multi-business)
- Coexist cleanly: each connection can hold N businesses (`saveSageTenant` already saves all). The mapping UI keys on the PIO row (business), so businesses across multiple connections map naturally.

### D. Existing-connection safety
- The current single Sage connection (DentPulse Limited) stays as one row — nothing to migrate. The new model only **adds more rows**.

---

## Files touched

| Layer | File | Change |
|---|---|---|
| Backend | `backend/api/sage/client.js` | `saveTokens` multi-row + dedup helper |
| Backend | `backend/routes/sageSync.js` | `/connect`, `/callback`, `/disconnect`, `/sync` accept `integration_id` |
| Frontend | `src/components/settings/AccountingIntegrationsHub.tsx` | `sageIntegrations` array + persistent connect button + ACTIVE CONNECTIONS list + per-connection handlers |
| Migration | — | **None** (table already supports multiple rows) |

---

## Open decisions (confirm before/while building)

1. **Same login connected twice** → dedup (Xero-style, **recommended**) or allow duplicate rows?
2. **`/status` + `/disconnect`** → change to per-`integration_id` (list-aware). Feature 2 left these untouched (`.maybeSingle()`); they must change now. Confirm.

---

## Build & test sequence

1. Backend A1–A5.
2. Frontend B1–B6.
3. Restart backend + frontend.
4. Test: connect 1st Sage account → button becomes **"Connect my Sage account"** → connect a 2nd (different) Sage login → **ACTIVE CONNECTIONS** shows 2 rows → verify per-connection Sync / Disconnect / Reconnect / Delete each act on the right row only.
5. Confirm Feature 2 still works (each connection's businesses appear in Practice Location Mapping).
