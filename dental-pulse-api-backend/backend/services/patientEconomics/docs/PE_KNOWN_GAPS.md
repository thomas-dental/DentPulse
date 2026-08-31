# Patient Economics — known gaps & assumptions (sprint end)

Last validated: 2026-08-28 against linked Supabase practice `10a0474f-4356-48e1-8586-38326438e9ab`.

## Product / formula assumptions (not Dentally facts)

| Topic | Status | Where documented |
|--------|--------|------------------|
| **Patient Economic Value (PEV)** | Proposed, business-confirmed for sprint | `cltv_projection` when Day 3 modelled row exists; else `contribution` only. Not `contribution + cltv`. See `pePatientEconomicValue.ts`, `patient_economic_value_tier_note` on `v_patient_contribution`. |
| **Recommended action** | Rule table (not ML) | `peRecommendedAction.ts` + SQL CASE on `v_patient_contribution`. Thresholds: opp ≥ £500, quality ≥ 70 / &lt; 40. |
| **Retention status** | Rule-based | 4-tier `pe_retention_status()` on `v_patient_contribution` / `v_pe_retention_segment`. Thresholds in `pe_economic_assumptions` + `peRetentionSegmentation.ts`. |
| **Modelled CLTV / Quality Score** | Heuristic job | `computePatientModelledScores.js` — 5yr run-rate @ 10%, not contractual methodology. |

## Partial / M6-dependent features

| Feature | Tier | Gap |
|---------|------|-----|
| **Weighted opportunity** | Modelled (learned) | Practice Commitment Rate (value within `commitment_rate_window_days`, default 30) × open pipeline gross. `commitmentRateLogic.js`. |
| **Opportunity gross** | Derived | Event ledger `PLAN_CREATED` planned value for plans not currently scheduled and not `PLAN_COMPLETED`. Depends on ledger backfill quality (`plan_id`, `planned_value` in payload). |
| **Membership service cost / CAC** | Modelled at invoice grain | Held at 0 on `v_invoice_contribution` until patient-level allocation. |
| **Lab / materials at patient rollup** | Invoice-level tiers only | `v_patient_financial_record` does not expose aggregate `lab_cost_tier` / `material_cost_tier`; invoice table shows per-line tiers. |

## Data quality / attribution gaps

- **`partial_no_practitioner`**: invoice lines without attributable practitioner → clinician cost 0, `clinician_cost_tier` = External on those lines; patient rollup may show External aggregate clinician tier.
- **`partial_missing_rate`**: practitioner present but no private share rate → rate defaults to 0 until provider remuneration is configured.
- **Event ledger**: older backfill rows may omit `plan_id` / `planned_value` in JSON paths the opportunity view reads; opportunity may under-count until payload normalisation improves.

## RLS

- `v_patient_financial_record` uses `security_invoker` → `v_invoice_contribution` + `patient_economics_modelled_scores` policies (`user_in_org`).
- Regression script: `backend/scripts/testPatientFinancialRecordRls.js` (grain + app-layer `practice_id` filter).

## UI read surfaces

| Screen | Primary query | Notes |
|--------|---------------|--------|
| Economic Pulse heroes / practice table | `GET /api/economics-engine/read/invoice-contribution-summary` | Backend aggregates `v_invoice_contribution` + UDA lens. |
| Patient List | `GET /api/economics-engine/read/patient-contribution-list` | Backend aggregates `v_patient_contribution` + 12mo metrics. |
| Patient Records roster + detail | `GET /api/economics-engine/read/patient-financial-records` + `patient-financial-record` | Treatment lines / invoices via `/read/patient-treatment-lines` and `/read/patient-invoices`. |

## Settings UI (`/patients?tab=settings`)

**Deferred / partial panels:** see **`PE_SETTINGS_NOTES.md`** — Status/Recall/Data Source (mostly superseded by Economic Assumptions + ops sync) and NHS/UDA toggles/clawback/mixed-patient (contract inputs live; remainder mock).


**Douglas Clark** (`patient_id` `e00526e3-1550-420c-b264-674b15bfda9a`, `pt_id` 19014) — 4 invoices, mixed complete/partial, ledger opportunity £85, modelled scores present. Full trace in sprint validation report (2026-08-28).
