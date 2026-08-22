# EBITDA-to-Value™ — How It Works

## What Is It?

EBITDA-to-Value™ converts a dental group's financial and operational data into a defensible **Enterprise Value** — the price a buyer would pay. It answers three questions:

1. **What are we worth today?** (Enterprise Value)
2. **Why aren't we worth more?** (Gap Analysis)
3. **What do we do about it?** (Action Plan + Exit Timing)

**Core formula:**

```
Enterprise Value = Sustainable EBITDA™ × Risk-Adjusted Multiple
Equity Value     = Enterprise Value − Net Debt
```

---

## Where Does the Data Come From?

The system pulls from **four connected sources** automatically — no manual data entry required for the core calculation:

| Source | What It Provides |
|--------|-----------------|
| **Xero / Iplicit** (Accounting) | Revenue, staff costs, lab fees, overhead costs, balance sheet |
| **Dentally** (Practice Management) | Chair utilisation, provider production, treatment mix, patient data |
| **NHS Data** | UDA delivery vs contract target, contract value |
| **DentPulse Settings** (User-configured) | Base multiple, net debt, normalisation add-backs, confidence levels |

---

## The 7-Step Valuation Pipeline

### Step 1 — Reported EBITDA

Starting point: raw earnings from the accounting system.

```
Reported EBITDA = Total Revenue − (Staff Costs + Lab Fees + Operating Leases)
```

Revenue is based on **paid invoices only** — not raised or outstanding.

### Step 2 — Normalisation → Adjusted EBITDA

Add back one-off or owner-specific costs that a buyer wouldn't inherit. These are manually entered by the finance team.

```
Adjusted EBITDA = Reported EBITDA + Normalisation Add-backs
```

**Common add-backs:**
- Owner salary above market rate
- One-off legal fees
- Related party rent adjustments
- Refurbishment write-offs
- Lab cost misallocations

### Step 3 — Sustainability Haircuts → Sustainable EBITDA™

Apply risk-based adjustments that reflect what a buyer would actually underwrite. This is the most important step — it's where "accounting EBITDA" becomes "investable EBITDA."

```
Sustainable EBITDA = Adjusted EBITDA ± Sustainability Haircuts
```

**Six haircut factors:**

| Factor | What It Does |
|--------|-------------|
| Chair Downtime Loss | Deducts lost revenue from empty chairs |
| Top Associate Departure Risk | Deducts a % of revenue tied to the top provider (if they leave) |
| New Associate Ramp-up | Adds projected revenue from a new hire (confidence-weighted) |
| Utilisation Improvement | Adds projected gain from better chair usage (confidence-weighted) |
| NHS UDA Clawback | Deducts the expected NHS penalty for under-delivery |
| Manual Items | Any additional user-entered sustainability adjustments |

Positive items (ramp-up, improvement) are **confidence-weighted** — e.g., a £120k ramp-up at 50% confidence becomes £60k. This mirrors how investors haircut forward assumptions.

### Step 4 — EBITDA Quality Score™ (0–100)

Measures how reliable and sustainable the earnings are. A buyer pays more for predictable, diversified, cash-rich earnings.

**Six sub-scores (weighted):**

| Sub-score | Weight | What It Measures | Good Score |
|-----------|--------|-----------------|------------|
| Revenue Predictability | 20% | How consistent is monthly revenue? (low variation = high score) | 80+ |
| Associate Dependency | 20% | How much revenue depends on one provider? (less = better) | 80+ |
| Chair Stability | 15% | Average chair utilisation across locations | 80+ |
| Treatment Mix | 15% | % of revenue from private treatments (higher = better margins) | 80+ |
| Cash Conversion | 15% | % of invoices actually paid (higher = healthier cash flow) | 80+ |
| NHS Delivery | 15% | UDA delivery rate against contract (higher = less clawback risk) | 80+ |

```
Final Score = Weighted average of all 6 sub-scores (0–100)
```

**Score bands:**
- **80–100**: Premium — attracts top-tier multiples
- **65–79**: Solid — some risk areas to address
- **50–64**: Moderate risk — multiple discount applied
- **Below 50**: High risk — significant multiple penalty

Weights are **configurable** by the user on the Quality Score page.

### Step 5 — Multiple Engine (3.0× – 8.0×)

Calculates the valuation multiple through a waterfall of premiums and penalties applied to a base market multiple.

**Starting point:** Base market multiple (default 5.8× for UK dental groups, configurable).

**Premiums added:**

| Factor | When Applied | Impact |
|--------|-------------|--------|
| Scale | Revenue > £5M / £3M / £1M | +0.3× / +0.2× / +0.1× |
| Chair Utilisation | Utilisation > 80% / > 70% | +0.2× / +0.1× |
| Reporting Quality | Accounting software connected (Xero/Iplicit) | +0.1× |
| Debt Management | Net Debt / EBITDA ratio < 1.5 | +0.1× |

**Penalties subtracted:**

| Factor | When Applied | Impact |
|--------|-------------|--------|
| Associate Dependency | Top provider > 40% / 30% / 20% of revenue | −0.4× / −0.3× / −0.2× |
| Management Depth | Always (assumes limited management beyond principal) | −0.3× |
| NHS Risk | UDA delivery < 92% / < 96% / < 100% | −0.3× / −0.2× / −0.1× |
| Standardisation | Always (no SOPs or compliance framework detected) | −0.2× |
| Leverage | Always (financial leverage risk) | −0.2× |
| Quality Score Drag | Score < 65 / < 75 / < 85 | −0.3× / −0.2× / −0.1× |

```
Final Multiple = Base + Premiums − Penalties (clamped between 3.0× and 8.0×)
```

### Step 6 — Enterprise Value

The final valuation:

```
Enterprise Value = Sustainable EBITDA × Final Multiple
Equity Value     = Enterprise Value − Net Debt
```

Net debt is user-configured (total borrowings minus cash on hand).

### Step 7 — Key Drivers + Value Progression

**Key Drivers** — 6 traffic-light indicators showing where the business is strong or weak:

| Driver | Green | Amber | Red |
|--------|-------|-------|-----|
| Margin Efficiency | > 25% margin | 15–25% | < 15% |
| Chair Utilisation | > 80% | 65–80% | < 65% |
| Associate Dependency | < 25% concentration | 25–35% | > 35% |
| Revenue Quality | > 50% private | 30–50% | < 30% |
| NHS Delivery | ≥ 96% of UDA target | 90–96% | < 90% |
| Scalability | > £5M revenue | £2–5M | < £2M |

**Value Progression** — compares today's value against a fully optimised scenario:

- Simulates improving all weak metrics to target benchmarks
- Recalculates Quality Score and Multiple under optimised conditions
- Shows the **total value opportunity** and breaks it down by EBITDA gain vs multiple gain

---

## The 9 Screens

The module is organised into three sections with nine screens, all accessible from the sidebar under "EBITDA to Value."

### Valuation

| Screen | What It Shows |
|--------|--------------|
| **Enterprise Overview** | At-a-glance dashboard: EBITDA stack (reported → adjusted → sustainable), enterprise value, quality score gauge, multiple mini-waterfall, key value drivers, and baseline vs optimised progression |
| **EBITDA Bridge** | Full waterfall chart showing every line item from Reported EBITDA through normalisation add-backs and sustainability haircuts to Sustainable EBITDA™. Includes a confidence weighting panel for forward assumptions |
| **Quality Score™** | Deep-dive into all 6 quality sub-scores with configurable weights, a component contribution table, and a panel showing how improving the score affects the multiple |
| **Multiple Engine** | Detailed waterfall from base market multiple to final risk-adjusted multiple, showing every premium earned and every penalty applied, with a factor detail table |
| **Gap Analysis** | Side-by-side comparison of the Owner's View (what you think it's worth) vs the Buyer's View (what they'll pay). Shows the gap amount, ranks the top 5 gap drivers by £ impact, splits the gap between EBITDA and multiple compression, and projects what happens if the top 3 issues are resolved |

### Planning

| Screen | What It Shows |
|--------|--------------|
| **Scenario Simulator** | Interactive sliders to adjust key metrics (UDA delivery, associate concentration, chair utilisation, cash conversion, new associates) and see the live impact on EBITDA, Quality Score, Multiple, and Enterprise Value. Includes pre-set "optimised" scenario and value build-up breakdown |
| **Exit Cockpit™** | The exit decision screen. Shows a recommended action (wait or sell) with confidence level, a 24-month value timeline (do nothing vs optimised), an Exit Readiness Score with 6 sub-dimensions, deal structure comparison (cash vs deferred vs earn-out), top 5 value-impact actions, and a sell-now-vs-wait decision grid |

### Compliance

| Screen | What It Shows |
|--------|--------------|
| **Due Diligence Engine™** | Pre-sale risk assessment. Auto-detects critical issues from the data (NHS clawback, lab cost evidence gaps, associate risk, cash conversion). Provides an interactive checklist across Financial, Clinical, and NHS sections. Shows an Associate Stickiness table (revenue, notice period, covenant status, risk score). Generates buyer questions automatically. Includes a document vault for uploading evidence |
| **Group Heatmap** | Portfolio-level view across all practices. Shows total portfolio value, value gap, average readiness, and NHS exposure. Ranks practices in a table by exit readiness. Plots them on a 2×2 quadrant (Crown Jewels / Rescue Missions / Stable Fillers / Divestment Zone). Compares current vs potential value per practice |

---

## How the Screens Connect

Every screen reads from the same underlying valuation calculation. When any input changes — a new normalisation add-back, a settings change, or fresh data from Xero/Dentally — all screens update automatically.

```
    Xero + Dentally + NHS + Settings
                  │
                  ▼
       ┌──────────────────────┐
       │  Valuation Pipeline  │
       │  (7-step calculation)│
       └──────────┬───────────┘
                  │
    ┌─────────────┼─────────────────────────────┐
    │             │                             │
    ▼             ▼                             ▼
 VALUATION     PLANNING                   COMPLIANCE
    │             │                             │
    ├─ Overview   ├─ Scenario Simulator         ├─ Due Diligence
    ├─ Bridge     └─ Exit Cockpit™              └─ Group Heatmap
    ├─ Quality
    ├─ Multiple
    └─ Gap Analysis
```

---

## How Key Numbers Are Calculated on Each Screen

### Gap Analysis

- **Owner's View** = Adjusted EBITDA × Base Multiple (before sustainability and risk adjustments)
- **Buyer's View** = Sustainable EBITDA × Final Multiple (the actual enterprise value)
- **Gap** = Owner's View − Buyer's View
- **Gap Drivers** = the top 5 factors explaining the gap, ranked by £ impact. Each driver is either a multiple penalty (converted to £ by multiplying by EBITDA) or a sustainability haircut (converted to £ by multiplying by the multiple)
- **If Top 3 Resolved** = projects the new EBITDA, multiple, and EV if the three largest drivers are fully addressed

### Exit Cockpit™

- **Recommendation** = based on how large the value gap is relative to current EV. If the gap exceeds 30%, the recommendation is to wait 12–18 months
- **Confidence** = 82% when there's a significant gap with fixable issues; lower when the gap is smaller
- **Exit Readiness Score** = average of 6 sub-dimensions derived from the quality score components:
  - Earnings Quality (= Quality Score)
  - Operational Stability (average of Chair Stability + Treatment Mix scores)
  - Management Depth (Quality Score minus a small offset, floored at 55)
  - Revenue Predictability (from quality sub-score)
  - Scalability (average of Cash Conversion + Treatment Mix scores)
  - Financial Control (Cash Conversion score + 14, capped at 95)
- **Timeline** = 12-month value assumes 55% of the total improvement is achieved; 24-month = full optimised value
- **Top Actions** = the 5 largest multiple penalties, each converted to £ impact
- **Deal Structure** = higher quality earnings → more cash upfront, fewer earn-outs

### Due Diligence Engine™

- **Critical Issues** = auto-detected from the data:
  - NHS clawback flagged if any sustainability item relates to UDA under-delivery
  - Lab cost flagged if any normalisation add-back involves lab costs (evidence needed)
  - Associate risk flagged if the associate dependency penalty is −0.3× or worse
  - Cash conversion flagged if the quality sub-score is below 70
- **Checklist Progress** = checked items ÷ total items × 100%
- **Associate Stickiness** = revenue concentration, notice period, restrictive covenant status → risk score per associate
- **If All Resolved** = Sustainable EBITDA + recovered NHS clawback, multiple + 0.9× uplift (capped at 8.0×)

### Group Heatmap

- **Practice EBITDA** = the total Sustainable EBITDA distributed across practices by percentage split
- **Current Value** = Practice EBITDA × practice-specific multiple
- **Potential Value** = Practice EBITDA × optimised multiple
- **Portfolio Value** = sum of all practice current values
- **Value Gap** = sum of (potential − current) across all practices
- **NHS Exposure** = sum of (EBITDA × 8%) for practices delivering below 96% of UDA target
- **2×2 Quadrant** = practices plotted by readiness (x-axis) vs EBITDA size (y-axis), split at median values into Crown Jewels, Rescue Missions, Stable Fillers, and Divestment Zone

---

## Configurable Settings

Users can adjust these parameters via the Enterprise Overview settings panel:

| Setting | Default | What It Controls |
|---------|---------|-----------------|
| Base Multiple | 5.8× | Starting point for the multiple waterfall |
| Net Debt | £0 | Subtracted from EV to calculate equity value |
| Quality Weights | 20/20/15/15/15/15 | Relative importance of each quality sub-score |
| New Associate Ramp-up | £0 | Expected revenue from a new hire |
| Ramp-up Confidence | 50% | How likely the ramp-up will materialise |
| Utilisation Improvement | £0 | Expected gain from better chair usage |
| Improvement Confidence | 70% | How likely the improvement will materialise |
| Departure Risk Factor | 30% | % of top provider's revenue at risk if they leave |

---

## What Triggers a Recalculation?

| When This Changes... | ...This Recalculates |
|----------------------|---------------------|
| Base multiple | Multiple → Enterprise Value |
| Quality weights | Quality Score → Multiple (quality drag penalty) → Enterprise Value |
| Net debt | Equity Value only (Enterprise Value unchanged) |
| Ramp-up or improvement values | Sustainability haircuts → Sustainable EBITDA → Enterprise Value |
| Departure risk factor | Sustainability haircuts → Sustainable EBITDA → Enterprise Value |
| Normalisation add-backs | Adjusted EBITDA → Sustainable EBITDA → Enterprise Value |
| Manual sustainability items | Sustainability impact → Sustainable EBITDA → Enterprise Value |
| Fresh Xero/Dentally/NHS data sync | Full recalculation from Step 1 through all steps |

Every screen updates automatically when any upstream value changes.
