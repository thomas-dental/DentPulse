# Forecast Settings Module — Complete Reference

Per-setting reference for the **13-Week Cash Flow Forecast** settings drawer (the ⚙️ on
the forecast page). Covers every control across the 5 tabs **plus** the engine-level
controls, what each does, **where it shows up in the forecast**, and its **current
status**.

- **Scope:** per **location** — each practice has its own settings.
- **Effect:** settings change **predicted figures only**. Your actuals, known unpaid
  bills, and manual cell edits are never touched.
- **Apply:** nothing changes until you press **Save**.

### Status legend
- 🟢 **Live** — the forecast reads it; changing it (and Saving) re-projects the table.
- ⚪ **Not wired** — stored & saved, but the forecast does **not** read it yet, so it
  currently changes **no number**. (These are the build-out backlog.)

### Precedence (how any one forecast cell is decided)
`manual cell edit → row rule (+ editor) → projection method (these settings) → known unpaid bill → smart data-driven baseline`

> ⚠️ **Persistence:** the per-location settings table must be applied for any of this to
> **persist in production**. Until then, settings work in-session but reset on reload.
> Per-line method overrides already persist.

---

## Engine-level controls (the always-live core)

These are the original forecast knobs. They are **all 🟢 Live**.

| Control | Where in the UI | What it does | Where it shows up | Status |
|---|---|---|---|---|
| **Base method** (Smart / Flat average / Repeat last 13 / Manual growth) | Income logic tab | How future weeks are estimated. Sets **both** income & cost method. | Private income line **and** operating cost lines | 🟢 Live |
| **Growth %** (Manual only) | Income logic tab | Grows/shrinks the projected weeks by a set % per month | The weeks the method covers | 🟢 Live |
| **Apply to** (all weeks / one week / custom range) | Income logic tab | Which forecast weeks the method covers; the rest stay on Smart | Selected weeks use the method | 🟢 Live |
| **Cost inflation (% / month)** | Costs tab → Cost projection | Steady uplift to projected costs, compounded weekly | Projected cost rows (not known bills) | 🟢 Live |
| **Trend sensitivity (% / week)** | Costs tab → Cost projection | Caps how fast a rising/falling trend may move | Income & cost trend bound | 🟢 Live |
| **Per-section methods** (Investing / Financing / Tax / Inter-Company) | Costs tab | Projection method per lower block | Those block rows | 🟢 Live |
| **Churn rate (monthly)** | Denplan tab | Share of members assumed to leave; the input also sets the engine's annual churn | Tapers future Membership rows | 🟢 Live |
| **Pay day of month** | Denplan tab | Day the Denplan cash lands | The membership lump lands in the week containing that day | 🟢 Live |

---

## Tab 1 — Income logic

| Setting | What it does | Where it shows up | Status |
|---|---|---|---|
| **Include NHS** | Show/hide the NHS inflow stream | When off, the **NHS** row is removed and stops contributing to inflow total | 🟢 Live |
| **Include Private** | Show/hide the Private inflow stream | When off, the **Private** row is removed from the forecast | 🟢 Live |
| **Include Denplan** | Show/hide the membership inflow stream | When off, **all Membership** rows are removed | 🟢 Live |
| **Include Other / sundry income** | Splits the Dentally **Sundries** takings onto their own row and subtracts them from Private (total unchanged) | Adds an "Other / Sundry income" row | 🟢 Live |
| **Include Lab recoveries** | Splits the Dentally **"Lab Bills"** takings (lab fees recharged to patients) onto their own row and subtracts them from Private (total unchanged) | Adds a "Lab fee recoveries" row | 🟢 Live |
| **NHS income cap (£) + per week/month** | Clips the NHS projection so it never exceeds the cap (default 0 = no cap) | NHS row | 🟢 Live |
| **Xero invoice lag (days)** | Shifts Private cash **later** by whole weeks (opt-in; default 0) | Private row timing | 🟢 Live |
| **Insurance / Denplan settlement delay (days)** | Pushes the Denplan cash landing **later** by N days (opt-in; default 0 = lands on the pay day) | Membership landing week | 🟢 Live |

---

## Tab 2 — Costs & overheads

### Cost projection
See the engine-level table — **Cost inflation**, **Trend sensitivity**, and the
**per-section methods** live here and are 🟢 Live.

### Staff cost allocation  *(opt-in — both toggles default OFF)*
| Setting | Effect | Status |
|---|---|---|
| Include associate pay + Associate pay rate % + **Associate pay account** | On → replaces the picked account row with `rate % × projected income` (self-employed; no on-costs added) | 🟢 Live |
| Include support staff + **Support staff salary** + Employer NI % + Pension % + **Support staff account** | On → replaces the picked account row with `salary + NI + pension`, spread flat | 🟢 Live |

### Fixed cost categories  *(blank = use real data; a value REPLACES the picked account)*
| Setting | Effect | Status |
|---|---|---|
| Rent / rates + **"Replaces…" account** | Sets that account's row to £/month (flat) | 🟢 Live |
| Utilities + account | Sets that account's row to £/month | 🟢 Live |
| Insurance + account | Sets that account's row to £/month | 🟢 Live |
| Software & subs + account | Sets that account's row to £/month | 🟢 Live |
| **Lab fees budget** | Used by **Lab fees: source = Fixed monthly budget** (below) | 🟢 Live *(via lab source)* |
| Marketing spend + account | Sets that account's row to £/month | 🟢 Live |

> **Defaults are blank, and each budget is mapped to an account you pick** ("Replaces…"
> dropdown). A blank box or unpicked account keeps your real data-driven cost row; a
> value + a chosen account replaces exactly that one row. Auto name-matching was
> deliberately **not** used — it mis-fired on real charts of accounts (e.g. "Employers
> National Insurance" matching Insurance).

### Variable cost logic
| Setting | What it does | Where it shows up | Status |
|---|---|---|---|
| **Lab fees: source** | `Actual Xero invoices` = current appointment-driven/real-invoice behaviour (default) · `% of treatment income` = *deferred, needs a lab-% field* · **`Fixed monthly budget`** = Lab Fees row set to the £/month budget spread evenly across the weeks, held flat | **Lab Fees** cost row | 🟢 Live (budget + actual) ·  ⚪ `% of income` not wired |
| **Consumables / sundries estimate** | Blank = data-driven; a % **replaces** the Materials row with `% × projected weekly income` | **Materials / Consumables** cost row | 🟢 Live |

---

## Tab 3 — Weekly distribution  *(opt-in — defaults leave the forecast unchanged)*

| Setting | Effect | Status |
|---|---|---|
| **Exclude bank holidays** + **Working-days %** + **Region** | A week with a bank holiday loses that day's working-day weight, scaling that week's income down. Built-in UK 2026–27 calendar (England/Wales, Scotland, NI). Default off | 🟢 Live |
| **Seasonality** + School-holiday % + December wind-down % | Scales Private down in December and August weeks. Default off | 🟢 Live |
| **Carry bank-holiday income to next week** | With Exclude on, the reduced income moves into the following week instead of being lost | 🟢 Live |

---

## Tab 4 — Denplan

| Setting | What it does / intended | Where it shows up | Status |
|---|---|---|---|
| **Churn rate (monthly)** | Tapers future membership (also sets engine annual churn) | Membership rows | 🟢 Live |
| **Pay day** | When the Denplan lump lands | The week containing that day | 🟢 Live |
| Settlement frequency | `Monthly 1st`/`Monthly 15th` set the pay day (live); `Weekly` not handled | Membership timing | 🟢 Live (1st/15th) · ⚪ weekly |
| Transaction fee, Discount % | Recompute membership **net** due | Would adjust membership £ | ⚪ Not wired |
| Plan configurations / fees | Value members by plan fee | Membership rows | ⚪ Not wired |
| **Member growth %** | Grows the member base forward each month (opt-in; default 0 = off) | Membership rows | 🟢 Live |
| Use live member count | Project the member base forward | Membership rows | ⚪ Not wired |

> Membership income currently comes from your uploaded membership data (net due grouped
> by clinician — the same source as the Membership Performance page), so the plan
> fees/bands are saved but don't yet drive the numbers.

---

## Tab 5 — Locations  *(all ⚪ Not wired)*

| Setting | Intended effect | Status |
|---|---|---|
| Active locations | Include/exclude each practice in a group forecast | ⚪ Not wired |
| Aggregation / view (combined / side-by-side / separate) | How multi-location data is laid out | ⚪ Not wired |
| Inter-practice cost allocation (by income / equal / manual) | Spread shared overheads across sites | ⚪ Not wired |
| Patient scoping, Unscoped fallback | How records with a missing location are attributed | ⚪ Not wired |

---

## What changed in the wiring passes

Newly made 🟢 **Live** (all opt-in — a default/blank setting changes nothing):
1. **Income include-toggles** — NHS / Private / Denplan rows are dropped (and excluded from totals) when toggled off.
2. **Lab fees: source → Fixed monthly budget** — Lab Fees row = the £/month budget spread evenly across the weeks.
3. **Consumables %** — Materials row = `% × weekly income` when the % is set.
4. **Fixed overhead budgets** — rent/utilities/insurance/software/marketing each set the account you pick to £/month.
5. **Staff costs** — associate pay (% of income) and support staff (salary + NI + pension) each replace a picked account.
6. **Denplan member growth %** — grows the member base forward.
7. **Settlement delay** — shifts the Denplan cash landing later by N days.
8. **Seasonality** — scales Private down in December / August weeks.
9. **NHS income cap (£)** — clips the NHS projection, applied per week or per month.
10. **Other / Sundry income** — splits the Dentally Sundries takings onto their own row (subtracted from Private; total unchanged).
11. **Invoice lag** — shifts Private cash later by whole weeks.
12. **Bank holidays + working-days %** — a per-week capacity factor with a built-in UK 2026–27 calendar.
13. **Override fields default to blank / off** — so defaults never override reconciled figures (**replace-when-set**).

---

## The few remaining ⚪ Not-wired — blocked by data/model, not effort

| Item | Why it isn't wired | What it would need |
|---|---|---|
| **Multi-location view** (active locations / side-by-side / separate / cost allocation) | The forecast engine is single-location; this is a page-level rebuild | Structural work to render several locations at once |
| **Denplan** transaction fee / discount / plan fees / bands / use-live-count | Membership comes from your uploaded **net-due** (already net) — applying fees again double-counts; no separate "live count" source | Re-source membership from plan-fee × member count |
| **Payment-terms days** | A variant of the already-wired invoice-lag control | Small follow-up if wanted |

**Go-live note:** the per-location settings table is applied, so all live settings persist.
**Every wired setting is opt-in** — its default (blank / off / 0) leaves your reconciled
forecast unchanged, so nothing moves until you deliberately set a control.
