/**
 * Growth Levers Simulator — compounded projection math (single source of truth).
 *
 * Product model (Growth Levers screen / mockup v5.1):
 *   Patient Economic Value ∝ Visit Frequency × Value per Visit × Patient Lifetime
 *   Levers multiply; they do not add.
 *
 * Simulator applies fractional % adjustments to each lever as multipliers on a baseline
 * revenue or contribution figure (trailing window from growth levers + practice margin).
 *
 * ---------------------------------------------------------------------------
 * LEVER DEFINITIONS — keep aligned with backend Steps 2–3:
 *   Lever 1 (visitFrequencyPct): matches visitFrequency in growthLeversSummary.js
 *     — completed visits per active patient in trailing window (Derived).
 *   Lever 2 (valuePerVisitPct): matches valuePerVisit
 *     — private/plan revenue per completed visit in trailing window (Derived).
 *   Lever 3 (lifetimePct): matches projectedLifetimeYears economic dimension
 *     — % change models retention / total relationship length (Modelled projected lifetime).
 *     Tenure (elapsed, Derived) is shown for context but is NOT folded into this multiplier.
 *
 * FORMULA (simulation only — does not persist or alter synced data):
 *   projected = baseline × (1 + lever1/100) × (1 + lever2/100) × (1 + lever3/100)
 *
 * If real lever definitions change in growthLeversSummary / patientLifetimeLogic,
 * update this module and the baseline mapping in useGrowthLeversSimulatorBaseline.
 * ---------------------------------------------------------------------------
 */

export type GrowthLeverChangePct = {
  /** Lever 1 — visit frequency % change (e.g. 10 = +10%). */
  visitFrequencyPct: number;
  /** Lever 2 — value per visit % change. */
  valuePerVisitPct: number;
  /** Lever 3 — projected lifetime / retention % change. */
  lifetimePct: number;
};

export const DEFAULT_GROWTH_LEVER_CHANGES: GrowthLeverChangePct = {
  visitFrequencyPct: 0,
  valuePerVisitPct: 0,
  lifetimePct: 0,
};

export type CompoundedProjectionResult = {
  baseline: number;
  projected: number;
  uplift: number;
  multipliers: {
    visitFrequency: number;
    valuePerVisit: number;
    lifetime: number;
    combined: number;
  };
};

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n;
}

/**
 * Core compounded projection — all three levers applied together.
 */
export function computeCompoundedProjection(
  baseline: number,
  changes: GrowthLeverChangePct,
): CompoundedProjectionResult {
  const base = Number.isFinite(baseline) ? baseline : 0;
  const m1 = 1 + clampPct(changes.visitFrequencyPct) / 100;
  const m2 = 1 + clampPct(changes.valuePerVisitPct) / 100;
  const m3 = 1 + clampPct(changes.lifetimePct) / 100;
  const combined = m1 * m2 * m3;
  const projected = base * combined;
  return {
    baseline: base,
    projected,
    uplift: projected - base,
    multipliers: {
      visitFrequency: m1,
      valuePerVisit: m2,
      lifetime: m3,
      combined,
    },
  };
}

/**
 * Single-lever uplift (other levers at 0% change) — for per-card simulator display.
 */
export function computeSingleLeverUplift(
  baseline: number,
  lever: keyof GrowthLeverChangePct,
  pctChange: number,
): number {
  const changes: GrowthLeverChangePct = { ...DEFAULT_GROWTH_LEVER_CHANGES };
  changes[lever] = pctChange;
  return computeCompoundedProjection(baseline, changes).uplift;
}

export type GrowthLeverAbsoluteTargets = {
  visitFrequency: number;
  valuePerVisit: number;
  lifetimeYears: number;
};

function pctChangeFromTargets(baseline: number, target: number): number {
  if (!Number.isFinite(baseline) || baseline <= 0 || !Number.isFinite(target)) return 0;
  const pct = ((target - baseline) / baseline) * 100;
  if (Math.abs(pct) < 0.5) return 0;
  return pct;
}

/** Absolute lever targets (mockup inputs) → compounded contribution projection. */
export function computeCompoundedProjectionFromTargets(
  baselineContribution: number,
  baselineLevers: GrowthLeverAbsoluteTargets,
  targetLevers: GrowthLeverAbsoluteTargets,
): CompoundedProjectionResult {
  return computeCompoundedProjection(baselineContribution, {
    visitFrequencyPct: pctChangeFromTargets(
      baselineLevers.visitFrequency,
      targetLevers.visitFrequency,
    ),
    valuePerVisitPct: pctChangeFromTargets(
      baselineLevers.valuePerVisit,
      targetLevers.valuePerVisit,
    ),
    lifetimePct: pctChangeFromTargets(
      baselineLevers.lifetimeYears,
      targetLevers.lifetimeYears,
    ),
  });
}

export function computeSingleLeverUpliftFromTargets(
  baselineContribution: number,
  baselineLevers: GrowthLeverAbsoluteTargets,
  targetLevers: GrowthLeverAbsoluteTargets,
  lever: keyof GrowthLeverAbsoluteTargets,
): number {
  const changes: GrowthLeverAbsoluteTargets = { ...baselineLevers };
  changes[lever] = targetLevers[lever];
  return computeCompoundedProjectionFromTargets(
    baselineContribution,
    baselineLevers,
    changes,
  ).uplift;
}

/**
 * Trailing-window contribution baseline from private/plan revenue × practice margin.
 * Aligns simulator £ basis with contribution engine margin on trailing revenue.
 */
export function estimateTrailingContribution(
  trailingRevenuePrivatePlan: number,
  marginPct: number | null,
): number | null {
  if (!Number.isFinite(trailingRevenuePrivatePlan) || trailingRevenuePrivatePlan <= 0) {
    return trailingRevenuePrivatePlan === 0 ? 0 : null;
  }
  if (marginPct == null || !Number.isFinite(marginPct)) return null;
  return trailingRevenuePrivatePlan * (marginPct / 100);
}
