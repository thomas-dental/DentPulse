/**
 * Shared 13-week forecast DISPLAY layer.
 *
 * The forecast hook (`useCashflowForecast`) produces baseline rows; what the
 * 13-Week Forecast page actually SHOWS layers three things on top of them:
 *   1. AI-predicted values per row (the twice-daily stored forecast, or a live
 *      run) — never over a manual override or an invoice-fixed cell;
 *   2. Linked-rule rows (a % of other lines, with optional week offset);
 *   3. The Private row's per-week % adjustment;
 * plus the Income include-toggles and manual blocks when totalling.
 *
 * The Group Dashboard's Cash Runway must plot the SAME End Cash line as the
 * page's "End Cash — Forecast vs Actual" chart, so this factory holds the one
 * copy of that logic and both consume it. If you change how a displayed value
 * is computed, change it HERE — not in the page.
 */
import type { ForecastRow } from '@/hooks/useCashflowForecast';
import { SCENARIO_KEYS, type ScenarioKey } from '@/hooks/useCashflowForecastSettings';

export interface ForecastDisplayInputs {
  /** number of forecast weeks (weeks.length) */
  weekCount: number;
  /** every row (inflow + outflow + block rows) for linked-rule lookups */
  allRows: ForecastRow[];
  /** AI values per row key (stored or live run); null/empty = AI inactive */
  aiValuesByKey: Map<string, number[]> | null;
  /** the Private row (its % adjustment is applied on top of AI/baseline) */
  privateRow: ForecastRow;
  /** per-week Private % adjustment (scenario-aware, from the hook) */
  privatePct: number[];
}

export interface ForecastDisplay {
  aiFor: (row: ForecastRow, i: number) => number | null;
  privateEffective: (i: number) => number;
  dispVal: (row: ForecastRow, i: number, depth?: number) => number;
  sumDisp: (rows: ForecastRow[]) => number[];
}

export function makeForecastDisplay(inputs: ForecastDisplayInputs): ForecastDisplay {
  const { weekCount, allRows, aiValuesByKey, privateRow, privatePct } = inputs;
  const aiActive = !!aiValuesByKey && aiValuesByKey.size > 0;

  const rowsByKey = new Map<string, ForecastRow>();
  for (const r of allRows ?? []) rowsByKey.set(r.key, r);

  // Per-row predicted values. Overridden cells always keep the user's saved
  // number (the AI never overwrites a manual edit); invoice-fixed cells are
  // facts, not predictions.
  const aiFor = (row: ForecastRow, i: number): number | null => {
    if (!aiActive) return null;
    if (row.overridden[i]) return null;
    if (row.fixed?.[i]) return null;
    const vals = aiValuesByKey!.get(row.key);
    return vals ? (vals[i] ?? null) : null;
  };

  // Private, after the per-week % adjustment. A manual £ override on the
  // Private cell wins outright; otherwise (AI/calculated value) × (1 + %/100).
  const privateEffective = (i: number): number => {
    if (privateRow.overridden[i]) return privateRow.values[i] ?? 0;
    const base = aiFor(privateRow, i) ?? privateRow.values[i] ?? 0;
    const pct = privatePct[i] ?? 0;
    return base * (1 + pct / 100);
  };

  // A Linked row's value for week i: Σ (pct% of each source row), with an
  // optional date offset (shift the contributing week). Depth-guarded against
  // link cycles.
  const linkedVal = (row: ForecastRow, i: number, depth = 0): number => {
    const rule = row.rule;
    if (!rule || rule.type !== 'linked' || depth > 4) return 0;
    const unit = rule.offsetUnit ?? 'days';
    const raw = rule.offsetEnabled ? (rule.offsetValue ?? 0) : 0;
    const offWeeks = Math.round(unit === 'weeks' ? raw : unit === 'months' ? raw * 4.345 : raw / 7);
    const srcIdx = i - (rule.offsetDir === 'before' ? -offWeeks : offWeeks);
    if (srcIdx < 0 || srcIdx >= weekCount) return 0;
    return (rule.inputs ?? []).reduce((sum, inp) => {
      const src = rowsByKey.get(inp.source);
      if (!src) return sum;
      return sum + (dispVal(src, srcIdx, depth + 1) * (Number(inp.pct) || 0)) / 100;
    }, 0);
  };

  // The number actually shown for a cell (AI prediction or calculated value).
  const dispVal = (row: ForecastRow, i: number, depth = 0): number => {
    if (row.rule?.type === 'linked') return linkedVal(row, i, depth);
    if (row.key === 'private') return privateEffective(i);
    const ai = aiFor(row, i);
    return ai != null ? ai : (row.values[i] ?? 0);
  };

  const sumDisp = (rows: ForecastRow[]) =>
    Array.from({ length: weekCount }, (_, i) => rows.reduce((s, r) => s + dispVal(r, i), 0));

  return { aiFor, privateEffective, dispVal, sumDisp };
}

/** Income include-toggle shape from Forecast Settings (module.income). */
export interface IncomeIncludeToggles {
  includeNHS: boolean;
  includeDenplan: boolean;
  includePrivate: boolean;
}

export interface DisplayEndCashInputs extends ForecastDisplayInputs {
  startCash: number;
  incomeInclude: IncomeIncludeToggles;
  nhsRow: ForecastRow;
  membershipRows: ForecastRow[];
  operatingInflowExtraRows: ForecastRow[];
  customRows: ForecastRow[];
  outflowCostRows: ForecastRow[];
  operatingDirectExtraRows: ForecastRow[];
  outflowExpenseRows: ForecastRow[];
  operatingExpenseExtraRows: ForecastRow[];
  outflowCustomRows: ForecastRow[];
  manualBlocks: Array<{ net: number[] }>;
}

/**
 * The page's End Cash line: startCash rolled forward by each week's displayed
 * operating net (income toggles applied) plus manual-block nets. This is the
 * series the "End Cash — Forecast vs Actual" chart plots as Forecast, and the
 * one the Cash Runway must match.
 */
/* ── CFO Summary "Closing cash — base vs scenarios" series ─────────────────
   Shared by the CFO Summary tab/page AND the Group Dashboard's Cash Runway so
   both draw identical lines. Income rows carry the ACTIVE scenario factor;
   inverting it per cell (skipping overridden / known-fact cells, which the
   engine never scaled) recovers the exact base income; each scenario option's
   curve is then base net + that option's % of base income, rolled from the
   opening balance. */

export interface ScenarioClosingCashInputs {
  weekCount: number;
  /** hook `weeklyTotals` — weekly inflow totals under the active scenario */
  weeklyTotals: number[];
  /** hook `totalWeeklyNet` — weekly net under the active scenario */
  totalWeeklyNet: number[];
  /** hook `endCash` (used verbatim for the active-scenario line when present) */
  endCash: number[] | null;
  startCash: number;
  /** income rows the scenario scales: NHS + membership + Private */
  incomeRows: ForecastRow[];
  /** scenarioFactor(settings.scenario): 1 + activePct/100 (0-safe) */
  factor: number;
  bestPct: number;
  likelyPct: number;
  worstPct: number;
}

export interface ScenarioClosingCashSeries {
  /** engine's current (active-scenario) closing-cash line */
  scnEnd: number[];
  /** base-case closing-cash line (scenario uplift removed) */
  baseEnd: number[];
  /** per-option closing-cash lines (best / likely / worst) */
  scnEndByKey: Record<ScenarioKey, number[]>;
  baseNet: number[];
  baseInflow: number[];
  upliftRemoved: number[];
}

export function computeScenarioClosingCash(inputs: ScenarioClosingCashInputs): ScenarioClosingCashSeries {
  const {
    weekCount, weeklyTotals, totalWeeklyNet, endCash, startCash,
    incomeRows, factor, bestPct, likelyPct, worstPct,
  } = inputs;
  const idx = Array.from({ length: weekCount }, (_, i) => i);
  const wt = weeklyTotals ?? [];
  const upliftRemoved = idx.map((i) =>
    incomeRows.reduce((s, r) => {
      const v = r.values?.[i] ?? 0;
      const base = (r.overridden?.[i] || r.fixed?.[i]) ? v : (factor === 0 ? v : v / factor);
      return s + (v - base);
    }, 0));
  const scnNet = totalWeeklyNet ?? [];
  const baseNet = idx.map((i) => (scnNet[i] ?? 0) - upliftRemoved[i]);
  const roll = (net: number[]) => { let r = startCash; return idx.map((i) => { r += net[i] ?? 0; return r; }); };
  const scnEnd = endCash ?? roll(scnNet);
  const baseEnd = roll(baseNet);
  const baseInflow = idx.map((i) => (wt[i] ?? 0) - upliftRemoved[i]);
  const pctFor = (k: ScenarioKey) => (k === 'best' ? bestPct : k === 'likely' ? likelyPct : worstPct);
  const scnEndByKey = Object.fromEntries(
    SCENARIO_KEYS.map((k) => {
      const p = pctFor(k) / 100;
      const net = idx.map((i) => (baseNet[i] ?? 0) + (baseInflow[i] ?? 0) * p);
      return [k, roll(net)];
    }),
  ) as Record<ScenarioKey, number[]>;
  return { scnEnd, baseEnd, scnEndByKey, baseNet, baseInflow, upliftRemoved };
}

export function computeDisplayEndCash(inputs: DisplayEndCashInputs): number[] {
  const display = makeForecastDisplay(inputs);
  const {
    weekCount, startCash, incomeInclude, nhsRow, membershipRows,
    operatingInflowExtraRows, customRows, outflowCostRows,
    operatingDirectExtraRows, outflowExpenseRows, operatingExpenseExtraRows,
    outflowCustomRows, manualBlocks, privateRow,
  } = inputs;

  const inflowRowList = [
    ...(incomeInclude.includeNHS ? [nhsRow] : []),
    ...(incomeInclude.includeDenplan ? membershipRows : []),
    ...(incomeInclude.includePrivate ? [privateRow] : []),
    ...operatingInflowExtraRows,
    ...customRows,
  ];
  const directRowList = [...outflowCostRows, ...operatingDirectExtraRows];
  const expenseRowList = [...outflowExpenseRows, ...operatingExpenseExtraRows, ...outflowCustomRows];

  const inflow = display.sumDisp(inflowRowList);
  const direct = display.sumDisp(directRowList);
  const expense = display.sumDisp(expenseRowList);

  let run = startCash;
  return Array.from({ length: weekCount }, (_, i) => {
    const operatingNet = (inflow[i] - direct[i]) - expense[i];
    const blocksNet = manualBlocks.reduce((s, b) => s + (b.net[i] ?? 0), 0);
    run += operatingNet + blocksNet;
    return run;
  });
}
