# Patient Economics — Settings panels (known incomplete)

Last updated: 2026-08-30. Tracks Settings sub-panels that appear in the v5.1 mockup and Step 1 audit but are **not fully implemented** as configurable surfaces. This is intentional deferral — not silent omission.

**Route:** `/patients?tab=settings` → `PatientEconomicsSettingsTab.tsx`

**Implemented in this sprint (live):**

| Panel | Status |
|-------|--------|
| Economic Assumptions (+ clinician remuneration) | Live — `PeEconomicAssumptionsPanel`, practitioner rates API |
| Conversion Probabilities | Live read-only — `PeConversionProbabilitiesPanel` |
| Data Provenance & Confidence | Live documentation — `PeProvenanceConfidencePanel` |
| NHS contract (subset of NHS/UDA) | Live — `PeNhsUdaContractSettings` → `uda_settings` |

---

## 1. Status, Recall & Data Source — **deferred**

### What the original spec / mockup intended

From `patient-economics-engine-mockup-v5.1.html` §Settings:

| Control | Spec intent |
|---------|-------------|
| **Active window** | “Seen within N months = Active” (mock default **18 months**). Simple active vs inactive definition for roster/analytics. |
| **Scheduling window** | Days after plan creation within which a linked appointment must appear — drives **Commitment Rate™** (mock **30 days**). |
| **Primary source** | Which PMS integration feeds PE (mock: **Dentally · Connected** badge). |
| **Sync frequency** | How often patient base / sync runs refresh (mock: Every 15 min / Hourly dropdown). |

### What exists today

| Control | Current behaviour |
|---------|-------------------|
| Active window | **Disabled placeholder** (18 mo). Not wired. **Superseded in product** by 4-tier retention (`active / drifting / lapsed / effectively_lost`) using recall + visit-gap thresholds — now editable under **Economic Assumptions → Retention thresholds**. |
| Scheduling window | **Not shown** in this card. Implemented as `commitment_rate_window_days` — editable in **Economic Assumptions → Commitment rate window**. |
| Primary source | **Static** “Dentally · Connected” badge — no live credential/sync health. |
| Sync frequency | **Not shown**. Sync schedules are **ops env vars** (`PE_SYNC_*` in `patientEconomics/sync/README.md`) — intentionally not exposed in PE Settings UI yet. |
| Dentally PAT | **Link only** to app `/settings` — PAT management lives outside PE tab (by design). |

### Why deferred (2026-08-30)

- Retention “active” is no longer a single N-month window; building the mockup’s Active window without product sign-off would **duplicate or contradict** 4-tier segmentation.
- Scheduling window and sync interval were consolidated into **Economic Assumptions** or ops config this sprint.
- A useful v2 panel would be **read-only integration health** (PAT valid, last sync, cursor status) — estimated **3–5 hours** (API wiring + UI), not a quick afternoon add-on after the assumptions consolidation.

### Acceptance criteria when picked up

- [ ] Live Dentally connection state (PAT present/valid, optional last successful sync tick).
- [ ] Clear cross-links: commitment window → Economic Assumptions; retention rules → Economic Assumptions retention section.
- [ ] Either drop “Active window (months)” or redefine with product (e.g. legacy hero metric only, not `retention_status`).
- [ ] Sync frequency: read-only ops summary or admin-only surface — not user-editable unless product requests.

---

## 2. NHS / UDA treatment — **partially implemented; remainder deferred**

### What the original spec / mockup intended

From mockup v5.1 and `PE_UDA_JOURNEY_AND_SETTINGS.md`:

| Control | Spec intent |
|---------|-------------|
| **Exclude UDA income from contribution** | Keep NHS/UDA contract-value income out of private **contribution** math (toggle on in mockup). |
| **Track UDA delivery separately** | Delivered vs contracted UDAs, clawback exposure in its own Economic Pulse lens (toggle on). |
| **Clawback alert threshold** | Warn when projected delivery falls below contract (mock **96%**). |
| **Mixed-patient handling** | How to treat patients with both NHS and private courses (mock: “Split by course type” vs “Flag as mixed”). |
| **NHS contract (this practice)** | Annual **contract value (£)** + **total UDA obligation** → derived `uda_rate`. Documented in §3.2 of `PE_UDA_JOURNEY_AND_SETTINGS.md`. |

### What exists today

| Control | Current behaviour |
|---------|-------------------|
| Exclude UDA from contribution | **Disabled toggle** (always on). **Already enforced** in `v_invoice_contribution` (`is_nhs` lines → `revenue_nhs` only; contribution uses private/plan lines). No Settings flag — not needed for correctness. |
| Track UDA separately | **Disabled toggle** (always on). **Already enforced** — NHS/UDA lens on Economic Pulse; never blended into contribution heroes. |
| Clawback alert threshold | **Not in UI**. Clawback/delivery logic uses existing UDA performance elsewhere in app (e.g. group dashboards, EBITDA tools) — no PE Settings key yet. |
| Mixed-patient handling | **Not in UI**. Invoice view already splits by line `is_nhs`; no practice-level “mixed patient” policy toggle. |
| NHS contract inputs | **Live** — `PeNhsUdaContractSettings` saves `uda_settings.nhs_contract_value` + `total_uda_obligation` for current UK financial year. |

### Why remainder deferred (2026-08-30)

- The two toggles are **cosmetic**; behaviour is hard-coded correctly in SQL/UI. Making them editable would add config surface with **no behaviour change** unless we weaken view guarantees.
- Clawback threshold and mixed-patient policy need **product rules** not present in backend today — not a Settings-only task.
- Contract entry is done; remaining mockup rows are **new features**, not missing wiring.

### Acceptance criteria when picked up

- [ ] Replace disabled toggles with read-only “Always enforced” chips + link to `PE_UDA_JOURNEY_AND_SETTINGS.md` §1.
- [ ] Clawback threshold: define storage (`pe_economic_assumptions` or `uda_settings`) and wire Economic Pulse UDA warnings — **~4–6 hours**.
- [ ] Mixed-patient handling: spec + implementation across views — **~1–2 days** (cross-cutting).
- [ ] Optional: per-location NHS contract rows in PE Settings (provider app already has `UdaContractGoalsPanel`).

---

## 3. Related docs

| Doc | Purpose |
|-----|---------|
| `PE_UDA_JOURNEY_AND_SETTINGS.md` | NHS/UDA formulas, Plan split, Journey, Settings inventory |
| `PE_KNOWN_GAPS.md` | Formula gaps, partial features, RLS |
| `patientEconomics/sync/README.md` | Sync env vars (ops-only) |

---

## 4. Sprint decision log

| Date | Decision |
|------|----------|
| 2026-08-30 | **Defer** full Status/Recall/Data Source and NHS/UDA mockup controls after Economic Assumptions consolidation. Document here; do not remove placeholder cards until v2 panel or read-only health ship. |
