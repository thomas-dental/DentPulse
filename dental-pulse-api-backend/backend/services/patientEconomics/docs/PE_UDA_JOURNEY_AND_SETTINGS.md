# Patient Economics — UDA/NHS, Treatment Economic Journey™ & Settings

This document explains how **NHS/UDA**, **Plan vs Private revenue mix**, the **Treatment Economic Journey™**, and **Settings** work in DentPulse Patient Economics: formulas, UI surfaces, what must be filled manually (and why), and the meaning of each **new** table/field introduced for this work.

---

## 1. Concepts at a glance

| Lens | Question it answers | Primary data |
|------|---------------------|--------------|
| **Contribution (private/plan)** | How much margin did we keep after direct cost? | `v_invoice_contribution` |
| **Revenue mix (Private / Plan / NHS)** | How is engine £ split across streams? | View + membership attribution |
| **NHS / UDA** | Are we delivering the NHS contract? What’s clawback risk? | `uda_settings` + `nhs_claims` |
| **Treatment Economic Journey™** | How does money move Planned → Collected? | `event_ledger` |

**Hard rule:** private/plan **contribution** and **NHS/UDA contract delivery** are never blended. NHS invoice £ may appear on the Revenue Mix bar for transparency; contribution math uses only private/plan revenue.

---

## 2. Plan vs Private revenue-mix logic

Economic Pulse **Revenue mix** shows three streams: **Private**, **Plan**, and **NHS/UDA**.

The contribution view stores **combined** private+plan invoice £ as `revenue_private_plan` (all `is_nhs = false` lines). Plan vs Private is **split at read time** in `usePatientContributionSummary.ts` — there is no separate Plan column on `v_invoice_contribution` today.

### 2.1 Attribution rule

```text
For each invoice row with revenue_private_plan > 0:
  if patient pt_id is on a membership payment plan
    → count £ toward Plan (revenuePlan)
  else
    → count £ toward Private (revenuePrivate)

revenueNhs = SUM(revenue_nhs)   // never mixed into contribution
engineRevenue = revenuePrivate + revenuePlan
```

**“In contribution engine (private + plan)”** on the card = `engineRevenue` (same total either way; only the Private/Plan split changes).

### 2.2 Which patients count as Plan members?

1. **Preferred — Setup Categories / location config**  
   Read `practice_locations.membership_income_accounts` (and provider variant) when  
   `membership_income_source` is **`pms`** or **`dentally`**.  
   Those values must be Dentally **payment-plan ids** (`pp_id`), not accounting COA UUIDs.

2. **Fallback — Dentally `payment_plans`**  
   If no PMS/Dentally plan ids are configured (common when source is **`accounting`** or accounts are empty), infer membership plans as rows where:
   - `pp_monthly_memberhsip_fee > 0`, **or**
   - friendly name matches  
     `practice plan` / `denplan` / `membership` / `member plan` / `capitation` / `subscription`

3. **Member patients**  
   `patients.pt_payment_plan_id IN (membership pp_ids)` → that patient’s private/plan invoice £ is attributed to **Plan**.

If fallback also finds **zero** membership plans → Plan stays **£0** and all engine £ shows as Private (honest empty Plan, not invented %).

### 2.3 UI: bar, legend, short-slice letters

| Surface | Behaviour |
|---------|-----------|
| **Stacked bar** | Draws only slices with £ &gt; 0 (flex width by value) |
| **Legend** | Always lists **Private · Plan · NHS/UDA** (Plan can be £0 · 0%) so the Plan “side” never disappears |
| **In-bar labels** | Wide: full `Label £ · %` · Medium: `£ · %` · Short (&lt;10%): letter flow **P** / **Pl** / **N** with min width so letters remain readable |

Hover title on each slice still shows the full label, £, and %.

### 2.4 Why Plan was missing before

Practices with `membership_income_source = accounting` skipped plan-id loading → `revenuePlan = 0` → Plan was **filtered out** of the bar/legend.  
Fix: Dentally `payment_plans` fallback + legend always includes Plan.

### 2.5 Manual vs automatic for Plan

| Input | Manual? | Notes |
|-------|---------|--------|
| Membership plan ids in Setup Categories | Optional but best | Source must be `pms`/`dentally` with real `pp_id`s |
| Dentally payment plans + patient `pt_payment_plan_id` | Automatic (sync) | Used by fallback |
| Plan £ on the mix | Derived | From invoice view + member set — not typed in PE Settings |

### 2.6 Code map (Plan)

| Concern | Location |
|---------|----------|
| Plan/Private split + membership load | `dental-pulse-dev/src/hooks/usePatientContributionSummary.ts` |
| Mix bar / legend / short letters | `EconomicPulse.tsx` → `RevenueMixCard` |
| Combined private+plan £ | `v_invoice_contribution.revenue_private_plan` |
| Dentally plans / patients | `payment_plans`, `patients.pt_payment_plan_id` |

---

## 3. UDA / NHS logic

### 3.1 What a UDA is

A **Unit of Dental Activity** is NHS England’s measure of contracted dental work. Courses of treatment are banded; Dentally records claimed/awarded UDAs on NHS claims.

Dentally → DentPulse mapping (sync):

| Dentally field | Column | Meaning |
|----------------|--------|---------|
| `expected_uda` | `nhs_claims.nc_expected_uda` | UDAs **claimed** |
| `awarded_uda` | `nhs_claims.nc_awarded_uda` | UDAs **accepted** by NHS |
| `uda_band` | `nhs_claims.nc_uda_band` | Band classification |

### 3.2 Contract inputs (Settings)

Stored in **`uda_settings`** (per organisation, financial year, contract type `NHS`, optional `location_id`):

| You enter | Field | Meaning |
|-----------|--------|---------|
| NHS contract value (£) | `nhs_contract_value` | Annual £ NHS will pay for the contracted UDA target |
| Total UDA obligation | `total_uda_obligation` | Annual UDA target |

**Auto-calculated (not typed):**

```text
uda_rate = nhs_contract_value ÷ total_uda_obligation
```

Example: £308,463 ÷ 9,620 ≈ **£32.06 / UDA**.

UK dental financial year runs **1 April → 31 March**. `financial_year` is the **start** calendar year (e.g. 2026 = 1 Apr 2026 – 31 Mar 2027).

**UI:** `/patients?tab=settings` → **NHS / UDA treatment** → *NHS contract (this practice)*.  
Also available on Treatments → NHS Contract Performance for full goals UI.

### 3.3 Delivery % and clawback (Economic Pulse)

Implemented in `loadUdaLens` (`usePatientContributionSummary.ts`):

```text
delivered   = SUM(nhs_claims.nc_expected_uda)
              WHERE status = 'completed'
                AND submitted_date in FY YTD (1 Apr → today)
                AND deleted_at IS NULL

delivery%   = (delivered ÷ total_uda_obligation) × 100

on target   = delivery% ≥ 96

clawback    = (100 − delivery%) × nhs_contract_value
              when delivery% < 100; else £0
```

If `uda_settings` has no usable contract for the current FY → UI shows **“— · no NHS contract”** (no invented %).

**Important distinctions:**

| Metric | ≈ meaning | Not the same as |
|--------|-----------|-----------------|
| NHS slice on Revenue Mix bar | Invoice NHS £ from `v_invoice_contribution.revenue_nhs` | Contract delivery |
| UDA delivery % | Claims vs obligation | Invoice mix % |
| UDA clawback £ | Simplified exposure on **annual contract value** | NHS invoice revenue on the bar |

### 3.4 Clinician table “UDA rate” column

In **Clinician remuneration profiles**, **UDA rate** shows the **practice** `uda_rate` (£/UDA) from `uda_settings`, not a per-clinician Dentally field.  
Until a contract is saved → **—**.

### 3.5 Lab treatment column (related Settings)

**Lab treatment** is **not** UDA. It displays `providers.lab_split_percentage` (DentPulse associate setting):

| Value | Display |
|-------|---------|
| `null` | — |
| `0` | Lab pre-split |
| `50` | 50/50 split |
| other | e.g. `40% split` |

This is **manual** on the Provider page — not synced from Dentally.

---

## 4. Treatment Economic Journey™ logic

### 4.1 Purpose

Reconstruct the practice’s commercial path:

```text
Planned → Scheduled → Started → Completed → Charged → Collected
```

Built from the append-only **`event_ledger`**, written during Dentally PE sync (resume-safe / idempotent).

### 4.2 Stage → event mapping

| UI stage | `event_type` | Count | £ (payload) |
|----------|--------------|-------|-------------|
| Planned | `PLAN_CREATED` | events | `planned_value` / `tp_private_treatment_value` |
| Scheduled | `APPOINTMENT_LINKED` | events | `planned_value` copied from the plan at write/backfill; chart **dedupes by plan_id** |
| Started | `TREATMENT_STARTED` | events | plan value on payload when present |
| Completed | `PLAN_COMPLETED` | events | plan-level completion |
| Charged | `INVOICE_RAISED` | events | `amount` / `total` |
| Collected | `PAYMENT_ALLOCATED` | events | `amount` |

Other ledger types (`RECALL_*`, `PATIENT_REACTIVATED`, `ITEM_COMPLETED`, `APPOINTMENT_UNLINKED`) support ops/journey completeness but are **not** funnel bars on Economic Pulse today.

### 4.3 Aggregation rules (API → UI)

**Backend:** `GET /api/economics-engine/journey/treatment-economic?practiceId=`  
Service: `treatmentEconomicJourney.js` (reads `event_ledger` via `supabaseAdmin`).  
**Frontend:** `fetchTreatmentEconomicJourney` → `useTreatmentEconomicJourney` (no direct Supabase ledger query).

1. Page `event_ledger` for the practice and the six funnel types (server-side).
2. **Event count** = number of rows of that type.
3. **£** = sum of payload monetary fields (`planned_value`, `tp_private_treatment_value`, `value`, `amount`, `total` — first present wins).
4. **Scheduled £ special case:** many links can exist for one plan. Chart takes **max planned_value per `plan_id`**, then sums those — so re-links don’t inflate £.
5. **Backfilling empty state:** if too few `PLAN_CREATED` / total funnel events → “Ledger data still backfilling” (no fake funnel).

**Not a single-patient cohort funnel:** stages are independent rollups. Started £ can exceed Planned £ when more start events carry value than create events.

### 4.4 Sync write path

| Piece | Path |
|-------|------|
| Diff (pure) | `eventLedgerDiff.js` |
| Prefetch + upsert | `eventLedgerWriter.js` |
| Schema / payload contract | `20260826130001_event_ledger_append_only.sql` |
| Scheduled £ enrichment | Writer loads `treatment_plans.tp_private_treatment_value` onto `APPOINTMENT_LINKED`; backfill migration `20260827180001_…` |

Ledger is **append-only** (no UPDATE/DELETE in normal operation). Idempotency: unique `(practice_id, idempotency_key)`.

### 4.5 Contribution vs Revenue (same section)

Beside the Journey chart:

```text
margin% = contribution ÷ private/plan revenue × 100
```

from `v_invoice_contribution` aggregates (`totalContribution`, `totalRevenue`).  
Shows why “spend” ≠ economics after clinician/lab/materials cost.

### 4.6 UI location

Economic Pulse (`/patients`) → **Where the value sits**:

- Treatment Economic Journey™ (ledger via backend API)
- Contribution vs Revenue (contribution view)

Chips: **Dentally** (events from PMS sync) · **Derived** (server rollups).

---

## 5. Settings (Patient Economics)

**Route:** `/patients?tab=settings`

| Panel | What you configure | Used by |
|-------|--------------------|---------|
| Clinician remuneration | Private share % (append-only history) | Clinician cost in contribution view |
| Lab treatment (display) | From `providers.lab_split_percentage` | Remuneration table only (today) |
| UDA rate (display) | From `uda_settings.uda_rate` | Remuneration table + Pulse UDA lens |
| NHS / UDA contract | Contract £ + obligation | Delivery %, clawback, UDA rate |
| Economic assumptions (table ready) | Membership annual cost, default CAC | Reserved; invoice grain still 0 |
| Toggles (mock) | Exclude UDA from contribution / track separately | Behaviour already enforced in view/UI — see **`PE_SETTINGS_NOTES.md`** for deferred mockup controls (clawback %, mixed-patient). |

**Partial-data banner** on Economic Pulse distinguishes:

- **Missing practitioner** — no clinician to attribute → contribution excluded for that invoice £  
- **Missing rate** — clinician known, no private-share row → rate treated as **0%** for cost (full private £ as contribution) but flagged until set in Settings  

---

## 6. Manual fill vs automatic data

### 6.1 Must fill manually (and why)

| Data | Where | Why manual |
|------|--------|------------|
| **NHS contract value (£)** | PE Settings → NHS/UDA | Dentally does not sync the practice’s annual GDS/PDS contract £ into PE |
| **Total UDA obligation** | PE Settings → NHS/UDA | Annual UDA target is a contract fact, not a claim field |
| **Private share %** | PE Settings → clinician profiles | Commercial associate deals live in DentPulse; not on Dentally practitioner API for PE |
| **Lab split %** | Provider / associate settings | DentPulse remuneration model; not Dentally-sourced |
| **Membership plan ids (optional)** | Setup Categories · `pms`/`dentally` source | Best Plan split; else Dentally `payment_plans` fallback |
| **Membership service cost / CAC** (when used) | `pe_economic_assumptions` | Practice assumptions; reserved for patient-level allocation |

**Derived after manual inputs (do not type):**

```text
uda_rate = contract ÷ obligation
```

### 6.2 Automatic from Dentally / sync

| Data | Source |
|------|--------|
| Clinician identity (name, role, ids) | Practitioners → `providers` |
| Private / plan / NHS invoice £ | Invoices / line items → `v_invoice_contribution` |
| Plan vs Private split | Member `pt_payment_plan_id` + membership plan ids (Settings or `payment_plans` fallback) |
| Delivered UDAs | `nhs_claims.nc_expected_uda` |
| Journey events & payload £ | Sync hooks → `event_ledger` |
| Plan private treatment value on Scheduled | Copied onto `APPOINTMENT_LINKED` from `treatment_plans` |

---

## 7. New tables & field meanings

### 7.1 `event_ledger`

Append-only patient economic journey events.

| Column | Meaning |
|--------|---------|
| `id` | Row UUID |
| `practice_id` | Tenant = `organizations.id` |
| `patient_id` | DentPulse `patients.id` (UUID), not Dentally `pt_id` |
| `event_type` | Enum `pe_economic_event_type` (see §4.2) |
| `payload` | JSONB event body (plan/appointment/invoice ids, amounts, source_table, …) |
| `created_at` | When the economic event occurred (prefer Dentally timestamp) |
| `idempotency_key` | Unique per practice; e.g. `plan_created:{tp_id}`, `appointment_linked:{ta_id}:{appt_id}` |

**Payload keys (minimum contract)** — see migration header `20260826130001_event_ledger_append_only.sql`. Extra keys allowed.

---

### 7.2 `practitioner_private_share_rates`

Append-only clinician private-share history.

| Column | Meaning |
|--------|---------|
| `id` | Row UUID |
| `practitioner_id` | `providers.id` |
| `practice_id` | `organizations.id` |
| `rate` | Private-share **%** (0–100) retained by clinician on attributed private/plan £ |
| `effective_from` | First date this rate applies (inclusive). Never edit in place — insert a new row |
| `created_at` | When the row was recorded |
| `created_by` | Auth user who saved (nullable for system seed) |

**Resolve for an invoice:** latest row with `effective_from <= invoice_date`.

---

### 7.3 `pe_economic_assumptions`

Practice-level PE assumptions (Settings-ready).

| Column | Meaning |
|--------|---------|
| `practice_id` | PK / FK → `organizations.id` |
| `membership_service_cost_annual` | Expected annual delivery cost per member (£) |
| `default_cac` | Default customer acquisition cost (£) |
| `updated_at` | Last update |

At **invoice grain**, `v_invoice_contribution` still sets membership/CAC cost to **0** until patient-level allocation lands.

---

### 7.4 `uda_settings` (existing DentPulse table, used heavily by PE)

Not invented only for PE, but required for Pulse UDA cards.

| Column | Meaning |
|--------|---------|
| `id` | Row UUID |
| `organization_id` | Practice / org |
| `location_id` | Optional site scope; `NULL` = org-wide default |
| `financial_year` | FY start year (Apr–Mar) |
| `contract_type` | `NHS` or `MOS` |
| `nhs_contract_value` | Annual contract £ (also used as MOS contract £ column historically) |
| `total_uda_obligation` | Annual UDA (or MOS case) obligation |
| `uda_rate` | **Generated:** contract ÷ obligation |
| `created_at` / `updated_at` | Audit |

---

### 7.5 `v_invoice_contribution` (view — key output columns)

Not a table; grain = one row per invoice (+ patient join). Important fields:

| Column | Meaning |
|--------|---------|
| `revenue_private_plan` | Private/plan £ (`is_nhs = false` lines only) |
| `revenue_nhs` / `nhs_excluded_amount` | NHS £ (informational; not in contribution) |
| `is_private_or_plan` / `is_nhs` | Flags for mix |
| `dominant_practitioner_id` | Invoice-level clinician for rate attribution |
| `private_share_rate` | Effective % from rate history (0 if missing rate but practitioner known) |
| `has_missing_practitioner` | No clinician to attribute |
| `has_missing_rate` | Practitioner known, no configured rate |
| `revenue_no_practitioner` | Private £ excluded from contribution |
| `revenue_missing_rate` | Private £ with rate defaulted to 0% |
| `clinician_cost` | private £ × rate/100 (0 if missing practitioner) |
| `lab_cost` / `materials_cost` | From treatments catalog joins when available |
| `membership_service_cost` / `allocated_cac` | Reserved (0 at invoice grain) |
| `direct_cost` | Sum of cost components |
| `contribution` | `revenue_private_plan − direct_cost` |
| `contribution_provenance_status` | e.g. complete / partial_no_practitioner / … |
| `revenue_tier` | Provenance chip: always `Dentally` |
| `clinician_cost_tier` | `Derived` when practitioner+rate known; else `External` |
| `lab_cost_tier` / `material_cost_tier` / `membership_service_cost_tier` / `allocated_cac_tier` | `Modelled` (assumptions / catalog) |
| `contribution_tier` | `Derived` |
| `confidence_score` | 0–100 composite heuristic (complete≈85; missing rate 55; no practitioner 40) |
| `confidence` | Legacy stub (`derived`); prefer `contribution_tier` |

---

## 8. Code map (quick reference)

| Concern | Location |
|---------|----------|
| Plan/Private mix + membership | `usePatientContributionSummary.ts` |
| Mix bar / legend / short letters | `EconomicPulse.tsx` → `RevenueMixCard` |
| UDA delivery / clawback | `usePatientContributionSummary.ts` → `loadUdaLens` |
| Journey chart data (API) | `treatmentEconomicJourney.js` → `GET …/journey/treatment-economic` |
| Journey chart UI | `useTreatmentEconomicJourney.ts` → `EconomicPulse.tsx` |
| Per-practice rollup | `v_practice_contribution` → `usePracticeContributionRollup.ts` |
| Economic Pulse UI | `EconomicPulse.tsx` |
| PE Settings | `PatientEconomicsSettingsTab.tsx`, `PeNhsUdaContractSettings.tsx`, `ClinicianRemunerationProfiles.tsx` |
| Ledger write | `eventLedgerDiff.js`, `eventLedgerWriter.js` |
| Contribution view | `20260827160001_v_invoice_contribution_full_cost_nhs_split.sql` |

---

## 9. End-to-end checklist for a practice

1. Sync Dentally (practitioners, plans, appointments, invoices, payments, NHS claims).  
2. **Manually** set NHS contract value + UDA obligation (Settings).  
3. **Manually** set private-share % for clinicians who appear on invoices.  
4. Optionally set membership plan ids (`pms`/`dentally`) for accurate Plan mix; otherwise rely on `payment_plans` fallback.  
5. Open Economic Pulse: contribution, mix (Private/Plan/NHS), UDA delivery/clawback, Journey, margin chart.  
6. Fix partial-data gaps (practitioners in Dentally / rates in Settings) until provenance is complete.

---

*Document aligned with PE work through Treatment Economic Journey™, Contribution vs Revenue, Plan/Private mix (+ Dentally payment_plans fallback), UDA-from-claims delivery, Settings contract UI, and `APPOINTMENT_LINKED` planned_value enrichment (2026-08).*
