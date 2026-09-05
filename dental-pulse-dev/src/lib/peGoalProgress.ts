/**
 * Goal progress = actual ÷ goal for higher-is-better metrics; ceiling ÷ actual for attrition.
 */

export type PeGoalProgressFormat = 'pct' | 'gbp' | 'pctCeiling';

export function parseGoalInputValue(raw: string): number | null {
  const t = raw.trim().replace(/[£,]/g, '');
  if (!t) return null;
  const normalized = t.toLowerCase().endsWith('k') ? Number(t.slice(0, -1)) * 1000 : Number(t);
  if (!Number.isFinite(normalized) || normalized <= 0) return null;
  return normalized;
}

/** Normalized goal for comparison (rate for % metrics, GBP for money). */
export function resolveGoalValue(
  goalInput: string,
  format: PeGoalProgressFormat,
  savedTarget: number | null,
): number | null {
  const parsed = parseGoalInputValue(goalInput);
  if (parsed != null) {
    if (format === 'pct' || format === 'pctCeiling') return parsed / 100;
    return parsed;
  }
  return savedTarget;
}

export function computeGoalProgressRatio(
  actual: number | null,
  goalInput: string,
  format: PeGoalProgressFormat,
  savedTarget: number | null,
): number | null {
  if (actual == null) return null;
  const goal = resolveGoalValue(goalInput, format, savedTarget);
  if (goal == null || goal <= 0) return null;

  if (format === 'pctCeiling') {
    // Attrition ceiling — lower actual is better: progress = ceiling ÷ actual.
    // e.g. 1% ceiling, 6% actual → 0.17 (~17% bar); 1% ceiling, 0.5% actual → 2 (cap 100%).
    if (actual <= 0) return 1;
    return goal / actual;
  }

  // Higher-is-better metrics: actual ÷ goal (e.g. 49% actual, 70% goal → 0.7).
  return actual / goal;
}

/** Bar fill 0–100: (actual ÷ goal) × 100, capped at 100%. */
export function computeGoalBarWidthPct(
  actual: number | null,
  goalInput: string,
  format: PeGoalProgressFormat,
  savedTarget: number | null,
): number {
  const ratio = computeGoalProgressRatio(actual, goalInput, format, savedTarget);
  if (ratio == null) return 0;
  return Math.min(Math.max(ratio * 100, 0), 100);
}

export function computeGoalOnTrack(
  actual: number | null,
  goalInput: string,
  format: PeGoalProgressFormat,
  savedTarget: number | null,
): boolean | null {
  if (actual == null) return null;
  const goal = resolveGoalValue(goalInput, format, savedTarget);
  if (goal == null) return null;
  if (format === 'pctCeiling') return actual <= goal;
  return actual >= goal;
}

export function formatGoalProgressFooter(
  actual: number | null,
  goalInput: string,
  format: PeGoalProgressFormat,
  savedTarget: number | null,
): string | null {
  const ratio = computeGoalProgressRatio(actual, goalInput, format, savedTarget);
  if (ratio == null) return null;
  if (format === 'pctCeiling') {
    if (ratio >= 1) return 'Within ceiling';
    return `${Math.round(ratio * 100)}% of ceiling headroom`;
  }
  const pct = Math.round(ratio * 100);
  return `${pct}% to ${format === 'gbp' ? 'target' : 'plan'}`;
}

export function formatCommitmentPointsGap(
  actual: number | null,
  goalInput: string,
  savedTarget: number | null,
): string | null {
  if (actual == null) return null;
  const goal = resolveGoalValue(goalInput, 'pct', savedTarget);
  if (goal == null) return null;
  const gapPts = Math.round(goal * 100 - actual * 100);
  if (gapPts <= 0) return null;
  return `+${gapPts}pt to target`;
}
