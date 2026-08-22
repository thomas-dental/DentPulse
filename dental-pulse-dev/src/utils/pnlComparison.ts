/**
 * Aggregate Profit Benchmark rows into the P&L comparison buckets used by
 * Profitability → P&L Period Comparison / P&L vs Group.
 *
 * Category rules match Setup Categories / Profit Benchmark masters:
 *   Revenue          = Profit Benchmark Production Income
 *                      (Private + Membership + NHS; same client composition
 *                      as the Profit Benchmark tab)
 *   Clinician Costs  = Hygienist + Dentist + Therapist
 *   Staff Costs      = Staff
 *   Lab & Materials  = Materials + Lab fees
 *   Overhead         = Marketing + Operating lease + Other Fixed Costs
 *   Net Profit       = Revenue − (Clinician + Staff + Lab & Materials + Overhead)
 */

import type { ProfitBenchmarkRow } from '@/services/profitBenchmarkService';

export interface PnLBucketAmounts {
  revenue: number;
  clinicianCosts: number;
  staffCosts: number;
  labMaterials: number;
  overhead: number;
  netProfit: number;
}

export interface PnLComparisonRow {
  category: string;
  current: number;
  prior: number;
  variance: number;
  variancePct: number;
  /** True for Revenue / Net Profit (higher is better). */
  isIncomeLike: boolean;
}

export interface PnLEntityVsGroupRow {
  category: string;
  entity: number;
  group: number;
}

const CLINICIAN_NAMES = new Set(['hygienist', 'dentist', 'therapist']);
const LAB_MATERIAL_NAMES = new Set(['materials', 'lab fees', 'labfees']);
const STAFF_NAMES = new Set(['staff']);
const OVERHEAD_NAMES = new Set([
  'marketing',
  'operating lease',
  'operatinglease',
  'other fixed costs',
  'otherfixedcosts',
]);

const CLINICIAN_IDS = new Set([102, 103, 104]);
const LAB_MATERIAL_IDS = new Set([100, 101]);
const STAFF_IDS = new Set([105]);
const OVERHEAD_IDS = new Set([106, 107, 108]);

function normalizeName(metric: string | null | undefined): string {
  return String(metric || '')
    .replace(/%/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function absAmount(row: ProfitBenchmarkRow): number {
  const raw =
    row.actualAmount != null && Number.isFinite(Number(row.actualAmount))
      ? Number(row.actualAmount)
      : Number(row.current) || 0;
  return Math.abs(raw);
}

export function emptyPnLBuckets(): PnLBucketAmounts {
  return {
    revenue: 0,
    clinicianCosts: 0,
    staffCosts: 0,
    labMaterials: 0,
    overhead: 0,
    netProfit: 0,
  };
}

/** Build P&L buckets from a Profit Benchmark response. */
export function aggregatePnLBuckets(
  rows: ProfitBenchmarkRow[],
  productionIncome: number,
): PnLBucketAmounts {
  const out = emptyPnLBuckets();
  // Same Production Income as Profit Benchmark (Private + Membership + NHS).
  out.revenue = Math.abs(Number(productionIncome) || 0);

  for (const row of rows) {
    // Profit row is ignored here — Net Profit is derived below so this view
    // always reconciles: Revenue − Clinician − Staff − Lab&Materials − Overhead.
    if (row.isProfitRow) continue;

    const id = row.groupAccountMasterId ?? null;
    const name = normalizeName(row.metric);
    const amount = absAmount(row);

    if (
      (id != null && CLINICIAN_IDS.has(id)) ||
      CLINICIAN_NAMES.has(name)
    ) {
      out.clinicianCosts += amount;
    } else if (
      (id != null && LAB_MATERIAL_IDS.has(id)) ||
      LAB_MATERIAL_NAMES.has(name)
    ) {
      out.labMaterials += amount;
    } else if ((id != null && STAFF_IDS.has(id)) || STAFF_NAMES.has(name)) {
      out.staffCosts += amount;
    } else if (
      (id != null && OVERHEAD_IDS.has(id)) ||
      OVERHEAD_NAMES.has(name)
    ) {
      out.overhead += amount;
    }
  }

  out.netProfit = Number(
    (
      out.revenue -
      out.clinicianCosts -
      out.staffCosts -
      out.labMaterials -
      out.overhead
    ).toFixed(2),
  );

  return out;
}

function variancePct(current: number, prior: number): number {
  if (prior === 0) return current === 0 ? 0 : 100;
  return Number((((current - prior) / Math.abs(prior)) * 100).toFixed(1));
}

/**
 * Chart/table rows for Current vs Prior.
 * Cost categories are signed negative in the chart (matching the previous UI).
 */
export function buildPeriodComparisonRows(
  current: PnLBucketAmounts,
  prior: PnLBucketAmounts,
): PnLComparisonRow[] {
  const defs: Array<{
    category: string;
    current: number;
    prior: number;
    signed: boolean;
    isIncomeLike: boolean;
  }> = [
    {
      category: 'Revenue',
      current: current.revenue,
      prior: prior.revenue,
      signed: false,
      isIncomeLike: true,
    },
    {
      category: 'Clinician Costs',
      current: current.clinicianCosts,
      prior: prior.clinicianCosts,
      signed: true,
      isIncomeLike: false,
    },
    {
      category: 'Staff Costs',
      current: current.staffCosts,
      prior: prior.staffCosts,
      signed: true,
      isIncomeLike: false,
    },
    {
      category: 'Lab & Materials',
      current: current.labMaterials,
      prior: prior.labMaterials,
      signed: true,
      isIncomeLike: false,
    },
    {
      category: 'Overhead',
      current: current.overhead,
      prior: prior.overhead,
      signed: true,
      isIncomeLike: false,
    },
    {
      category: 'Net Profit',
      current: current.netProfit,
      prior: prior.netProfit,
      signed: false,
      isIncomeLike: true,
    },
  ];

  return defs.map((d) => {
    // Variance always on absolute amounts (cost ↑ = positive variance = worse).
    const variance = d.current - d.prior;
    return {
      category: d.category,
      current: d.signed ? -d.current : d.current,
      prior: d.signed ? -d.prior : d.prior,
      variance,
      variancePct: variancePct(d.current, d.prior),
      isIncomeLike: d.isIncomeLike,
    };
  });
}

function pctOfRevenue(amount: number, revenue: number): number {
  if (revenue <= 0) return 0;
  return Number(((amount / revenue) * 100).toFixed(1));
}

export function buildEntityVsGroupRows(
  entity: PnLBucketAmounts,
  group: PnLBucketAmounts,
  entityEbitda: number,
  groupEbitda: number,
): PnLEntityVsGroupRow[] {
  const revenueShare =
    group.revenue > 0
      ? Number(((entity.revenue / group.revenue) * 100).toFixed(1))
      : 0;

  return [
    { category: 'Revenue %', entity: revenueShare, group: 100 },
    {
      category: 'EBITDA Margin %',
      entity: pctOfRevenue(entityEbitda, entity.revenue),
      group: pctOfRevenue(groupEbitda, group.revenue),
    },
    {
      category: 'Net Profit %',
      entity: pctOfRevenue(entity.netProfit, entity.revenue),
      group: pctOfRevenue(group.netProfit, group.revenue),
    },
    {
      category: 'Clinician Cost %',
      entity: pctOfRevenue(entity.clinicianCosts, entity.revenue),
      group: pctOfRevenue(group.clinicianCosts, group.revenue),
    },
    {
      category: 'Staff Cost %',
      entity: pctOfRevenue(entity.staffCosts, entity.revenue),
      group: pctOfRevenue(group.staffCosts, group.revenue),
    },
  ];
}

export function sharePct(part: number, whole: number): number {
  if (whole === 0) return 0;
  return Number(((part / whole) * 100).toFixed(1));
}

export function ppDelta(entity: number, group: number): number {
  return Number((entity - group).toFixed(1));
}
