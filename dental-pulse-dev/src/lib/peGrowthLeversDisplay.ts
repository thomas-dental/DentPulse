import type { GrowthLeversMonthlyRow } from '@/hooks/useGrowthLeversSummary';
import type { GrowthLeversPracticeRow } from '@/hooks/useGrowthLeversByPractice';

/** Mockup-style economic value proxy: annual lever product × projected lifetime. */
export function computePatientEconomicValueGbp(
  visitFrequency: number | null,
  valuePerVisit: number | null,
  projectedLifetimeYears: number | null,
  tenureYears?: number | null,
): number | null {
  const life = projectedLifetimeYears ?? tenureYears;
  if (
    visitFrequency == null ||
    valuePerVisit == null ||
    life == null ||
    !Number.isFinite(visitFrequency) ||
    !Number.isFinite(valuePerVisit) ||
    !Number.isFinite(life)
  ) {
    return null;
  }
  return Math.round(visitFrequency * valuePerVisit * life);
}

export function computePracticeEconomicValueGbp(row: GrowthLeversPracticeRow): number | null {
  return computePatientEconomicValueGbp(
    row.visitFrequency,
    row.valuePerVisit,
    row.projectedLifetimeYears,
    row.tenureYears,
  );
}

/** Admin / non-clinical locations: no visit revenue → headroom ranks are not meaningful. */
export function hasGrowthLeverClinicalData(row: {
  visitFrequency: number | null;
  valuePerVisit: number | null;
}): boolean {
  if (row.visitFrequency == null || row.valuePerVisit == null) return false;
  return row.visitFrequency > 0 && Number.isFinite(row.valuePerVisit);
}

export type LeverYoYMetrics = {
  visitFrequencyDelta: number | null;
  valuePerVisitPctChange: number | null;
};

function sumMonths(
  rows: GrowthLeversMonthlyRow[],
  field: 'completedVisits' | 'revenuePrivatePlan',
): number {
  return rows.reduce((acc, r) => acc + (field === 'completedVisits' ? r.completedVisits : r.revenuePrivatePlan), 0);
}

/** Compare trailing window vs the prior window of equal length (YoY when trailing = 12). */
export function computeLeverYoYMetrics(
  monthly: GrowthLeversMonthlyRow[],
  trailingMonths: number,
  activePatientCount: number,
): LeverYoYMetrics {
  if (activePatientCount <= 0 || monthly.length < trailingMonths * 2) {
    return { visitFrequencyDelta: null, valuePerVisitPctChange: null };
  }

  const sorted = [...monthly].sort((a, b) => a.month.localeCompare(b.month));
  const recent = sorted.slice(-trailingMonths);
  const prior = sorted.slice(-trailingMonths * 2, -trailingMonths);

  const recentVisits = sumMonths(recent, 'completedVisits');
  const priorVisits = sumMonths(prior, 'completedVisits');
  const recentRevenue = sumMonths(recent, 'revenuePrivatePlan');
  const priorRevenue = sumMonths(prior, 'revenuePrivatePlan');

  const recentFreq = recentVisits / activePatientCount;
  const priorFreq = priorVisits / activePatientCount;
  const visitFrequencyDelta =
    priorFreq > 0 ? Math.round((recentFreq - priorFreq) * 10) / 10 : null;

  const recentVpv = recentVisits > 0 ? recentRevenue / recentVisits : null;
  const priorVpv = priorVisits > 0 ? priorRevenue / priorVisits : null;
  const valuePerVisitPctChange =
    recentVpv != null && priorVpv != null && priorVpv > 0
      ? Math.round(((recentVpv - priorVpv) / priorVpv) * 1000) / 10
      : null;

  return { visitFrequencyDelta, valuePerVisitPctChange };
}

export function formatLeverDelta(value: number | null, unit: 'freq' | 'pct'): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (unit === 'freq') {
    const sign = value > 0 ? '▲' : value < 0 ? '▼' : '';
    const abs = Math.abs(value);
    const formatted = abs % 1 === 0 ? String(abs) : abs.toFixed(1);
    return `${sign} ${formatted}`;
  }
  const sign = value > 0 ? '▲' : value < 0 ? '▼' : '';
  return `${sign} ${Math.abs(value).toFixed(1)}%`;
}
