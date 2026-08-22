# EBITDA-to-Value™ Calculation Guide

## Overview

The EBITDA Valuation calculates your dental practice's **Enterprise Value** using a multi-step pipeline that pulls data from Xero, Dentally, and NHS sources.

```
Reported EBITDA
      │
      ▼
± Normalisation Adjustments
      │
      ▼
Adjusted EBITDA
      │
      ▼
± Sustainability Haircuts
      │
      ▼
Sustainable EBITDA ──┬──► Quality Score (0-100)
                     │              │
                     │              ▼
                     ├──► Valuation Multiple (3.0×–8.0×)
                     │
                     ▼
              Enterprise Value = Sustainable EBITDA × Multiple
                     │
                     ▼
              Equity Value = Enterprise Value − Net Debt
```

---

## Step 1: Reported EBITDA

**Formula**: `Revenue − Costs`

| Component | Source | How |
|-----------|--------|-----|
| Revenue | `platform_integration_invoices` | SUM of `subtotal` where `status = 'paid'` within date range |
| Staff Costs | Xero GL or Treatment Setup | P&L staff cost accounts |
| Lab Fees | Xero GL or Treatment Setup | P&L lab fee accounts |
| Operating Leases | Xero GL or Treatment Setup | P&L lease accounts |

- If Xero/Iplicit is connected → source badge shows "Xero / Iplicit"
- If not → falls back to Treatment Setup costs
- Location filter: matches patient's Dentally site UUID to `practice_locations.api_record_unique_id`

**Key files**: `useEbitdaValuation.ts:362-366`, `useCostImpactData.ts`

---

## Step 2: Normalisation Adjustments → Adjusted EBITDA

**Formula**: `Adjusted EBITDA = Reported EBITDA + Net Adjustments`

- Fetches from `ebitda_adjustments` table where `category = 'normalisation'` and `is_active = true`
- Sums all `amount` values
- Examples: owner salary add-back, one-off legal fees, equipment costs
- Managed via the Settings panel on the EBITDA Bridge page (Add/Edit/Delete)

**Key files**: `useEbitdaValuation.ts:368-372`, `useEbitdaAdjustments.ts`

---

## Step 3: Sustainability Haircuts → Sustainable EBITDA

**Formula**: `Sustainable EBITDA = Adjusted EBITDA + Total Haircut Impact`

Six risk-based adjustments:

### 3a. Chair Downtime Loss (negative)

```
IF chairs > 0 AND utilisation < 100%:
  downtimePct = (100 − avgUtilisation) / 100
  revenuePerChair = totalRevenue / totalChairs
  loss = −(downtimePct × revenuePerChair × totalChairs × 0.05)
  Only shown if |loss| > £1,000
```

**Data source**: `useChairMetrics()` → average utilisation % and chair counts

### 3b. Top Associate Departure Risk (negative)

```
risk = −(topProviderRevenue × 0.30)
```

30% probability that the top-earning associate leaves, taking their revenue.

**Data source**: `useAllProvidersNetProduction()` → revenue per provider

### 3c. New Associate Ramp-up (positive, confidence-weighted)

```
IF newAssociateRampUp > 0:
  value = newAssociateRampUp × (confidence / 100)
```

**Data source**: `ebitda_valuation_settings` table — user-configured values

### 3d. Utilisation Improvement (positive, confidence-weighted)

```
IF utilisationImprovement > 0:
  value = utilisationImprovement × (confidence / 100)
```

**Data source**: `ebitda_valuation_settings` table — user-configured values

### 3e. NHS UDA Clawback (negative)

```
IF udaDeliveryPct < 100 AND nhsContractValue > 0:
  shortfallPct = (100 − udaDeliveryPct) / 100
  clawback = −(shortfallPct × nhsContractValue)
```

**Data source**: `useNHSContractPerformance()` + `uda_settings` table

### 3f. Manual Sustainability Items (from DB with confidence)

```
FOR EACH item in ebitda_adjustments WHERE category = 'sustainability_manual':
  displayValue = amount × (confidence_pct / 100)
```

**Key files**: `sustainabilityHaircuts.ts`, `useEbitdaValuation.ts:374-395`

---

## Step 4: EBITDA Quality Score (0–100)

Six sub-scores combined with configurable weights (must total 100%).

### Sub-scores

| Sub-score | Default Weight | Formula | Good Score |
|-----------|---------------|---------|------------|
| Revenue Predictability | 20% | `100 − (CV × 200)` where CV = StdDev/Mean of last 12 months revenue | 80+ (consistent monthly revenue) |
| Associate Dependency | 20% | `100 − (topProviderRevenuePct × 1.5)` | 80+ (top provider < 13% of revenue) |
| Chair Stability | 15% | `avgUtilisationPct` (direct mapping) | 80+ (>80% utilisation) |
| Treatment Mix | 15% | `privateRevenuePct` (direct mapping) | 80+ (>80% private revenue) |
| Cash Conversion | 15% | `paidInvoiceRate × 100` | 80+ (>80% invoices paid) |
| NHS Delivery | 15% | `udaDeliveryPct` or 65 if no NHS contract | 80+ (>80% UDA delivery) |

### Final Score Calculation

```
Final Score = ROUND(
  (RevenuePredictability × weight1) +
  (AssociateDependency × weight2) +
  (ChairStability × weight3) +
  (TreatmentMix × weight4) +
  (CashConversion × weight5) +
  (NHSDelivery × weight6)
)
```

### Quality Labels

| Score Range | Label |
|-------------|-------|
| 85–100 | Strong |
| 75–84 | Good |
| 65–74 | Acceptable |
| 50–64 | Moderate Risk |
| 0–49 | High Risk |

### Configurable Weights

Weights are stored in `ebitda_valuation_settings.quality_weights` (JSONB column). Default:

```json
{
  "revenue_predictability": 0.20,
  "associate_dependency": 0.20,
  "chair_stability": 0.15,
  "treatment_mix": 0.15,
  "cash_conversion": 0.15,
  "nhs_delivery": 0.15
}
```

Editable via the "Adjust weights" button on the Quality Score card. Total must equal 100%.

**When weights change** → Quality Score recalculates → Quality Drag penalty in Multiple recalculates → Enterprise Value recalculates.

**Key files**: `qualityScore.ts`, `useEbitdaSettings.ts`

---

## Step 5: Valuation Multiple (3.0×–8.0×)

Starts at a configurable **Base Market** multiple (default 5.8×), then applies premiums and penalties.

### Premiums (added)

| Factor | Condition | Value |
|--------|-----------|-------|
| Scale | Revenue > £5M | +0.3× |
| | Revenue > £3M | +0.2× |
| | Revenue > £1M | +0.1× |
| Chair | Utilisation > 80% | +0.2× |
| | Utilisation > 70% | +0.1× |
| Reporting | Xero/Iplicit GL connected | +0.1× |
| Debt Mgmt | Net Debt / EBITDA < 1.5 | +0.1× |

### Penalties (subtracted)

| Factor | Condition | Value |
|--------|-----------|-------|
| Assoc. Dep. | Top provider > 40% of revenue | −0.4× |
| | Top provider > 30% | −0.3× |
| | Top provider > 20% | −0.2× |
| Mgmt Depth | Fixed (always applied) | −0.3× |
| NHS Risk | UDA delivery < 92% | −0.3× |
| | UDA delivery < 96% | −0.2× |
| | UDA delivery < 100% | −0.1× |
| | No NHS contract | no penalty |
| Standards | Fixed (always applied) | −0.2× |
| Leverage | Fixed (always applied) | −0.2× |
| Qual. Drag | Quality Score < 65 | −0.3× |
| | Quality Score < 75 | −0.2× |
| | Quality Score < 85 | −0.1× |
| | Quality Score ≥ 85 | no penalty |

### Final Multiple

```
finalMultiple = CLAMP(running, min: 3.0, max: 8.0)
finalMultiple = ROUND(running × 10) / 10   // rounded to 1 decimal
```

### Configurable Base Multiple

Stored in `ebitda_valuation_settings.base_multiple` (default: 5.8). Editable via the pencil icon next to "Base Market" on the Valuation Multiple card (range 3.0–8.0).

**Key files**: `multipleEngine.ts`, `useEbitdaSettings.ts`

---

## Step 6: Enterprise Value & Equity Value

```
Enterprise Value = Sustainable EBITDA × Final Multiple
Equity Value     = Enterprise Value − Net Debt
```

- `Net Debt` is user-configured in `ebitda_valuation_settings.net_debt` (default: £0)

**Key files**: `useEbitdaValuation.ts:424-426`

---

## Step 7: Value Progression (Baseline vs Optimised)

Simulates a best-case scenario by improving all weak sub-scores.

### Baseline

Current values:
- EBITDA = Sustainable EBITDA
- Multiple = Final Multiple
- Value = Enterprise Value

### Optimised Scenario

Simulated improvements:
- Top provider % → clamped to 15%
- Chair utilisation → boosted to 85%
- Private revenue % → boosted to 50%
- Paid invoice rate → boosted to 95%
- UDA delivery → boosted to 97% (if NHS contract exists)

EBITDA improvement calculation:

```
ebitdaImprovementPct = CLAMP(
  (|sustainabilityImpact| / sustainableEBITDA) × 100 + 20,
  min: 20, max: 80
)
optimisedEBITDA = sustainableEBITDA × (1 + ebitdaImprovementPct / 100)
```

**Key files**: `valueProgression.ts`

---

## Step 8: Key Value Drivers

Six traffic-light indicators:

| Driver | Green (Strong) | Amber (Moderate) | Red (Low/Risk) |
|--------|---------------|-------------------|----------------|
| Margin Efficiency | EBITDA margin > 25% | 15–25% | < 15% |
| Chair Utilisation | > 80% | 65–80% | < 65% |
| Associate Dependency | < 25% | 25–35% | > 35% |
| Revenue Quality | > 50% private | 30–50% | < 30% |
| NHS Delivery | ≥ 96% UDA | 90–96% | < 90% |
| Scalability | Revenue > £5M | £2–5M | < £2M |

**Key files**: `keyDrivers.ts`

---

## Data Sources

| Source | Hook/Query | What it provides |
|--------|-----------|------------------|
| Financial (Revenue + Costs) | `useCostImpactData()` + `invoiceStatsQuery` | Reported EBITDA |
| Chair Metrics | `useChairMetrics()` | Utilisation %, chair counts |
| Provider Production | `useAllProvidersNetProduction()` | Revenue per provider, private % |
| NHS Performance | `useNHSContractPerformance()` | UDA delivery stats |
| Cash Conversion | `invoiceStatsQuery` | Paid/total invoice ratio |
| Monthly Revenue | `monthlyRevenueQuery` | 12-month TPI history for predictability |
| Settings | `useEbitdaSettings()` | Base multiple, net debt, weights, ramp-up values |
| Adjustments | `useEbitdaAdjustments()` | Normalisation + sustainability manual items |

---

## Database Tables

### `ebitda_valuation_settings` (one row per org)

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `base_multiple` | NUMERIC | 5.8 | Starting valuation multiple |
| `net_debt` | NUMERIC | 0 | Net debt for equity calculation |
| `quality_weights` | JSONB | see above | Configurable quality score weights |
| `new_associate_ramp_up` | NUMERIC | 0 | £ potential gain from new associate |
| `new_associate_ramp_confidence` | NUMERIC | 50 | Confidence % (0–100) |
| `utilisation_improvement` | NUMERIC | 0 | £ potential gain from utilisation |
| `utilisation_improvement_confidence` | NUMERIC | 70 | Confidence % (0–100) |

### `ebitda_adjustments` (many rows per org)

| Column | Type | Description |
|--------|------|-------------|
| `category` | TEXT | `normalisation` or `sustainability_manual` |
| `label` | TEXT | User-friendly name |
| `amount` | NUMERIC | £ value (+ or −) |
| `confidence_pct` | NUMERIC | For sustainability items (0–100) |
| `is_active` | BOOLEAN | Soft delete flag |

---

## Key Code Files

| File | Purpose |
|------|---------|
| `src/hooks/useEbitdaValuation.ts` | Main orchestration — pulls all data, runs calculations |
| `src/utils/ebitda/qualityScore.ts` | 6-factor quality scoring with configurable weights |
| `src/utils/ebitda/multipleEngine.ts` | 10-factor multiple waterfall (base → final) |
| `src/utils/ebitda/sustainabilityHaircuts.ts` | 6 risk adjustments to EBITDA |
| `src/utils/ebitda/valueProgression.ts` | Baseline vs optimised simulation |
| `src/utils/ebitda/keyDrivers.ts` | 6 traffic-light indicators |
| `src/hooks/useEbitdaSettings.ts` | CRUD for valuation settings |
| `src/hooks/useEbitdaAdjustments.ts` | CRUD for normalisation/sustainability items |
| `src/pages/EbitdaValuation.tsx` | Enterprise Value Overview page |
| `src/pages/EbitdaBridge.tsx` | EBITDA Bridge waterfall page |
