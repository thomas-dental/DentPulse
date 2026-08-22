import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from './useOrganization';
import { useAuth } from './useAuth';
import { useFilters } from '@/contexts/FilterContext';
import { useLocations } from './useLocations';
import { getProfitBenchmark } from '@/services/profitBenchmarkService';
import { getCashflowReport, getStatementReport } from '@/services/cashflowService';
import { useSetupCategories } from './useSetupCategories';
import { useLocationAccountingScope } from './useLocationAccountingScope';
import { useAppointmentForecast } from './useAppointmentForecast';
import { useCashflowForecastSettings, resolveLineMethod, scenarioFactor as computeScenarioFactor, type LineMethodConfig, type ForecastMethod } from './useCashflowForecastSettings';
import { CATEGORY_RANGE_IDS, type CategoryRangeVM } from '@/types/setup-categories';

// ─────────────────────────────────────────────────────────────────────────────
// 13-Week Cash Flow Forecast — CASH INFLOW
//
// Methodology (confirmed with the client):
//  • "Repeat the pattern forward" — the next 13 weeks are predicted from the
//    trailing period's actual records.
//  • NHS and Membership come from monthly accounting P&L (no true weekly
//    granularity) and the project forbids pro-rating monthly figures into weeks
//    (feedback_no_prorating). So each category's whole monthly amount is placed
//    as a SINGLE weekly lump in one payment-week per month — never spread. This
//    mirrors how these land as lumps in the client's spreadsheet (e.g. NHS in
//    weeks 4 & 8).
//  • Categories reuse the proven definitions from useAllProvidersNetProduction
//    (the same NHS / Private / Membership split used across the app), so the
//    forecast reconciles with the rest of DentPulse.
//  • Every cell is editable; saved overrides (cashflow_forecast_overrides) take
//    precedence over the computed baseline. Custom rows capture one-off receipts
//    (e.g. a £375k client payment) the data can't infer.
//
// Weeks start Monday. The forecast anchors to the upcoming Monday and rolls 13
// weeks forward; the baseline window is the 13 Monday-weeks immediately before.
// ─────────────────────────────────────────────────────────────────────────────

export const FORECAST_WEEKS = 13;

// UK bank holidays (2026–2027) by region, for the optional "exclude bank holidays"
// weekly-distribution setting. A week containing one loses that day's working-day
// capacity. Dates are the observed (substitute) days.
export const BANK_HOLIDAYS: Record<'england_wales' | 'scotland' | 'northern_ireland', Set<string>> = {
  england_wales: new Set([
    '2026-01-01', '2026-04-03', '2026-04-06', '2026-05-04', '2026-05-25', '2026-08-31', '2026-12-25', '2026-12-28',
    '2027-01-01', '2027-03-26', '2027-03-29', '2027-05-03', '2027-05-31', '2027-08-30', '2027-12-27', '2027-12-28',
  ]),
  scotland: new Set([
    '2026-01-01', '2026-01-02', '2026-04-03', '2026-05-04', '2026-05-25', '2026-08-03', '2026-11-30', '2026-12-25', '2026-12-28',
    '2027-01-01', '2027-01-04', '2027-03-26', '2027-05-03', '2027-05-31', '2027-08-02', '2027-11-30', '2027-12-27', '2027-12-28',
  ]),
  northern_ireland: new Set([
    '2026-01-01', '2026-03-17', '2026-04-03', '2026-04-06', '2026-05-04', '2026-05-25', '2026-07-13', '2026-08-31', '2026-12-25', '2026-12-28',
    '2027-01-01', '2027-03-17', '2027-03-26', '2027-03-29', '2027-05-03', '2027-05-31', '2027-07-12', '2027-08-30', '2027-12-27', '2027-12-28',
  ]),
};

// Appointment-driven Lab Fees / Materials forecasting. The LEVEL is calibrated to
// real lab/material invoices (an average real-cash cost per appointment), and the
// per-week SHAPE comes from each practitioner's booked appointments. This avoids
// the unreliable per-treatment lab_bill (set on ~all treatments incl. exams) that
// would otherwise overstate lab cost ~40×.
export const APPOINTMENT_DRIVEN_COSTS_ENABLED = true;

// CASH OUTFLOW rows are sourced from the "Profit (Expenses)" group mapping
// (Setup Categories → Profit (Expenses)). These ids are the seeded
// group_account_master rows (group_type 2 = Costs, 3 = Expenses); see migration
// 20260724000001_split_group_account_master_costs_expenses.sql.
export const EXPENSE_GROUP = {
  MATERIALS: 100,
  LAB_FEES: 101,
  HYGIENIST: 102,
  DENTIST: 103,
  THERAPIST: 104,
  STAFF: 105,
  MARKETING: 106,
  OPERATING_LEASE: 107,
  OTHER_FIXED: 108,
} as const;

// The Setup Categories → "Category Range" COA mapping drives, per account:
//   • the four lower blocks (Investing / Financing / Tax & Grant / Inter Company), and
//   • the operating outflow (Direct Costs, Over Heads) when those Category Range
//     buckets are mapped — otherwise operating falls back to the Profit (Expenses)
//     grouped rows.
// Each account is bucketed into a `dataKey` (the accumulation/override namespace);
// `op-direct`/`op-expense` both render under the operating 'outflow' section.
// Intra-Account transfers are excluded (bank-to-bank movement, not a forecast line).
export const CATEGORY_ROW_TARGET: Record<number, { dataKey: string; section: ForecastSection }> = {
  [CATEGORY_RANGE_IDS.DirectCost]:          { dataKey: 'op-direct',  section: 'outflow' },
  [CATEGORY_RANGE_IDS.Overhead]:            { dataKey: 'op-expense', section: 'outflow' },
  [CATEGORY_RANGE_IDS.CFI]:                 { dataKey: 'inv-in',  section: 'inv-in' },
  [CATEGORY_RANGE_IDS.CFIPayment]:          { dataKey: 'inv-out', section: 'inv-out' },
  [CATEGORY_RANGE_IDS.CFF]:                 { dataKey: 'fin-in',  section: 'fin-in' },
  [CATEGORY_RANGE_IDS.CFFPayment]:          { dataKey: 'fin-out', section: 'fin-out' },
  [CATEGORY_RANGE_IDS.TAXRefund]:           { dataKey: 'tax-in',  section: 'tax-in' },
  [CATEGORY_RANGE_IDS.Compliance]:          { dataKey: 'tax-out', section: 'tax-out' },
  [CATEGORY_RANGE_IDS.IntraCompanyReceipt]: { dataKey: 'ic-in',   section: 'ic-in' },
  [CATEGORY_RANGE_IDS.IntraCompanyPayment]: { dataKey: 'ic-out',  section: 'ic-out' },
};
// CategoryRangeVM key → dataKey, for classifying forward unpaid invoices/bills.
export const CATEGORY_VMKEY_DATAKEY: Partial<Record<keyof CategoryRangeVM, string>> = {
  DirectCost: 'op-direct',
  Overhead: 'op-expense',
  CFI: 'inv-in',
  CFIPayment: 'inv-out',
  CFF: 'fin-in',
  CFFPayment: 'fin-out',
  TAXRefund: 'tax-in',
  Compliance: 'tax-out',
  IntraCompanyReceipt: 'ic-in',
  IntraCompanyPayment: 'ic-out',
};
// Bucket for included ACCPAY bills whose chart of account isn't in any Category
// Range mapping. They still forecast — one row per their own COA — rendered with
// the operating Expenses block. Kept separate from 'op-expense' so it never
// suppresses the Profit-Expenses fallback when no overheads are mapped.
export const UNMAPPED_BILL_DATAKEY = 'op-unmapped';

// Membership (DenPlan) cashflow logic — mirrors the agreed Denplan forecast:
//  • Denplan pays the practice monthly on a fixed day → the cash lands in the
//    week that contains that day (not spread, not "first week of month").
//  • Each associate's monthly net is tapered by an annual churn/attrition rate:
//    retention = (1 − churn/12)^monthsElapsed.
export const MEMBERSHIP_PAY_DAY = 15;          // day of month Denplan pays
export const MEMBERSHIP_ANNUAL_CHURN_RATE = 0.05; // 5% annual attrition (default)

// Churn scenarios the user can model the Denplan membership base against.
// This is a PREDICTION control: it projects the CURRENT base forward under an
// assumed annual attrition, it does not re-query historical actuals.
export const CHURN_SCENARIOS = [0, 0.05, 0.08, 0.10] as const;

export interface ChurnScenario {
  rate: number;        // 0 | 0.05 | 0.08 | 0.10
  annual: number;      // projected annual membership net at this churn
  atRisk: number;      // annualBase − annual (revenue lost to attrition)
  selected: boolean;   // matches the active churnRate
}

// ── Patient-driver signals (deterministic model, AI-refined) ──
// Per treating dentist, the OBSERVED membership dynamics derived by diffing the
// uploaded months on member identity. These drive the forward projection
// (members roll forward by churn + joiners; revenue = members × avg/member),
// replacing the old flat 5% churn assumption.
// One observed month-to-month transition, derived by diffing consecutive upload
// months on member identity — the real "members added / removed" activity.
export interface MembershipMonthlyActivity {
  ym: number;        // (year*12+month) of this month
  members: number;   // distinct members at this month
  joiners: number;   // members present this month but not the previous (added)
  leavers: number;   // members present the previous month but not this one (removed)
  revenue: number;   // net_due billed this month
}
export interface MembershipDentistStats {
  dentist: string;
  latestMembers: number;        // distinct members at the latest uploaded month
  latestRevenue: number;        // monthly net_due at the latest uploaded month
  avgRevenuePerMember: number;  // latestRevenue ÷ latestMembers
  monthlyChurn: number;         // observed avg fraction lost per month (0..1)
  monthlyJoiners: number;       // observed avg new members per month (added)
  avgMonthlyLeavers: number;    // observed avg members lost per month (removed)
  monthsObserved: number;       // number of month-pairs the averages came from
  activity: MembershipMonthlyActivity[]; // per-month add/remove history (oldest→newest)
  hasHistory: boolean;          // ≥1 month-pair available to observe dynamics
  monthlyRevenue: Record<number, number>; // ym (year*12+month) → actual net_due (for the Previous view)
}
export interface MembershipHistory {
  latestYm: number;             // (year*12 + month) of the latest upload
  dentists: MembershipDentistStats[];
}

// A read-only row in the "Previous 13 weeks" (actuals) view.
export interface PreviousRow {
  key: string;
  label: string;
  values: number[];   // length 13 — actuals over the trailing Monday-weeks
}

export interface ForecastWeek {
  index: number;       // 0..12
  weekNumber: number;  // 1..13
  weekStart: Date;     // Monday
  iso: string;         // 'yyyy-MM-dd' (the override key)
  label: string;       // 'Jun 15'
  monthKey: string;    // 'yyyy-MM'
}

// Operating uses 'inflow'/'outflow'. The lower blocks mirrored from the client's
// spreadsheet each get their own inflow/outflow section keys (≤20 chars — the DB
// column is VARCHAR(20)). 'balance' holds the opening cash; 'note' holds the
// per-week "Decisions Made" text.
export type ForecastSection =
  | 'inflow' | 'outflow'           // operating
  | 'inv-in' | 'inv-out'           // investing
  | 'fin-in' | 'fin-out'           // financing
  | 'tax-in' | 'tax-out'           // tax & grant
  | 'ic-in'  | 'ic-out'            // inter company
  | 'balance' | 'note' | 'threshold' | 'rule';

// An Auto or Repeating automation attached to a row. Persisted once per scope
// (section 'rule', JSON in line_label) and turned into a 13-week series that
// replaces the row's computed baseline.
export type RepeatEvery =
  | 'week' | '2week' | 'month' | '2month' | '3month' | '6month' | 'year' | 'none';
export interface LinkedInput {
  pct: number;                   // percentage of the source row
  source: string;                // source row line_key
}
export interface ForecastRule {
  type: 'auto' | 'repeating' | 'linked';
  name?: string;                 // optional display name the user typed
  category?: string;             // optional accounting category label
  // Auto (monthly): which trailing figure to repeat + which day of the month it lands.
  basis?: 'prev_month' | 'avg_3m';
  day?: number;                  // day-of-month the auto amount occurs (1–28)
  addon?: number;                // extra £ added on top of the basis each month
  // Repeating:
  amount?: number;               // £ per occurrence (incl. tax)
  start?: string;                // first payment date, YYYY-MM-DD
  every?: RepeatEvery;
  ends?: string | null;          // last date, YYYY-MM-DD, or null = never
  // Per-occurrence escalation: how the amount changes each time it repeats.
  stepKind?: 'inc_amt' | 'dec_amt' | 'inc_pct' | 'dec_pct';
  stepValue?: number;            // magnitude (£ or %), always positive
  // Linked: this line = Σ (pct% of another line), optionally date-offset. The
  // value is resolved on the page (cross-row) — the hook leaves the baseline at 0.
  inputs?: LinkedInput[];
  offsetEnabled?: boolean;
  offsetValue?: number;
  offsetUnit?: 'days' | 'weeks' | 'months';
  offsetDir?: 'after' | 'before';
}

// Per-cell, worked breakdown of how a membership forecast figure was generated,
// surfaced so the tooltip can show the actual numbers behind the projection.
// Filled only on a clinician's Denplan pay-week cell; undefined elsewhere.
export interface MembershipCalc {
  prevMonthRevenue: number;    // the month-before figure the projection rolls from
  members: number;             // projected members at this month
  avgRevenuePerMember: number; // £ per member
  churnPct: number;            // monthly attrition applied, as a percentage
  joiners: number;             // new members added per month
  leavers: number;             // members removed per month (avg, from history)
  monthsAhead: number;         // months projected past the latest uploaded month
  baseAmount: number;          // resulting projected monthly revenue (pre-AI)
  observed: boolean;           // churn/joiners observed from history vs. fallback
}

export interface ForecastRow {
  key: string;                 // line_key: 'nhs' | 'private' | 'membership:<id>' | 'materials' | 'custom:<uuid>' …
  label: string;
  // 'cost'/'expense' are the two operating outflow groups; 'manual' is a fixed
  // editable sheet row with no data baseline (Investing/Financing/Tax/etc.);
  // 'coa' is a data-driven Investing/Financing/Tax/Inter-Company row sourced from
  // a Chart-of-Accounts → Category Range mapping.
  kind: 'nhs' | 'private' | 'membership' | 'custom' | 'cost' | 'expense' | 'manual' | 'coa';
  section: ForecastSection;
  values: number[];            // length 13 — resolved (override ?? baseline)
  baseline: number[];          // length 13 — the calculated figure BEFORE any override
  overridden: boolean[];       // length 13 — true where a manual override applies
  editable: boolean;
  // Set when this cost row is driven by a FIXED monthly budget from Forecast Settings
  // (the £/month figure) — so the tooltip explains the budget, not a data forecast.
  fixedBudget?: number;
  // Membership-only: per-cell projection breakdown for the tooltip (length 13).
  membershipCalc?: (MembershipCalc | undefined)[];
  // Membership-only: the observed add/remove dynamics behind this row, sent to
  // Claude as grounding context and surfaced in the tooltip.
  membershipMeta?: {
    currentMembers: number;
    avgRevenuePerMember: number;
    avgMonthlyJoiners: number;
    avgMonthlyLeavers: number;
    monthlyChurnPct: number;
    monthsObserved: number;
    activity: MembershipMonthlyActivity[];
  };
  // Block (coa) rows only: true where the cell is a known invoice/bill due that
  // week (a cash fact) rather than a trailing-pattern estimate — treated like an
  // override for the AI (fixed, never overwritten) and labelled differently.
  fixed?: boolean[];
  // Auto/Repeating automation driving this row's baseline, if any.
  rule?: ForecastRule;
  // Preview £ for the Auto panel's two bases (previous month / last-3-month avg).
  autoPreview?: { prevMonth: number; avg3m: number };
  // Set when a clinical line (Private revenue / Lab Fees / Materials / Consumables)
  // is forecast from booked-appointment volume (level calibrated to real
  // invoices/income, shape from each practitioner's appointments) rather than a flat
  // run-rate — powers the cell tooltip's "how this is forecast" justification.
  tdMeta?: { kind: 'lab' | 'mat' | 'revenue'; providers: string[]; avgPerAppt: number; trailingAppts: number; futureAppts: number[]; realTotal: number };
}

// One comment in a forecast cell's discussion thread (cashflow_forecast_comments).
// A cost account's billing rhythm, detected from its real ACCPAY invoice history.
export interface CadenceInfo {
  cadence: 'weekly' | 'monthly' | 'irregular';
  billDay: number; // typical day-of-month it bills (where the monthly lump lands)
  amount: number;  // typical per-occurrence amount (median) — projected forward
}

export interface ForecastComment {
  id: string;
  text: string;
  authorName: string;   // denormalized at insert (full name, else email, else 'Unknown')
  createdAt: string;    // ISO timestamp
  isOwn: boolean;       // true when authored by the current user (can delete it)
}

// ── Manual (non-data) blocks, mirrored from the client's 13-week sheet ──
// Every row here is editable and override-only (no data baseline, never sent to
// the AI). line_key is unique within its section. These render below the
// Operating section in the order listed.
export interface ManualRowDef { key: string; label: string; }
export interface ManualSubsection {
  section: ForecastSection;
  title: string;               // colored section bar label
  rows: ManualRowDef[];
}
export interface ManualBlock {
  id: string;
  inflow: ManualSubsection;
  outflow: ManualSubsection;
  netLabel: string;            // the block's net subtotal row label
}

// The four lower blocks keep their section scaffolding (titles, sections, net
// labels) but carry NO hardcoded placeholder rows — every row is data-driven from
// the Category Range COA mapping (plus any user-added custom rows).
export const MANUAL_BLOCKS: ManualBlock[] = [
  {
    id: 'investing',
    inflow:  { section: 'inv-in',  title: 'Cash Inflow (Investing)',    rows: [] },
    outflow: { section: 'inv-out', title: 'Cash Outflow (Investments)', rows: [] },
    netLabel: 'Weekly Net Cash Flow (Investing)',
  },
  {
    id: 'financing',
    inflow:  { section: 'fin-in',  title: 'Cash Inflow (Financing)',  rows: [] },
    outflow: { section: 'fin-out', title: 'Cash Outflow (Financing)', rows: [] },
    netLabel: 'Net Cashflow (Financing)',
  },
  {
    id: 'tax',
    inflow:  { section: 'tax-in',  title: 'Cash Inflow (Tax and Grant)',  rows: [] },
    outflow: { section: 'tax-out', title: 'Cash Outflow (Tax and Grant)', rows: [] },
    netLabel: 'Net Cashflow (Taxes)',
  },
  {
    id: 'intercompany',
    inflow:  { section: 'ic-in',  title: 'Cash Inflow (Inter Company)',  rows: [] },
    outflow: { section: 'ic-out', title: 'Cash Outflow (Inter Company)', rows: [] },
    netLabel: 'Net Inter Company',
  },
];

// Operating extras — no hardcoded placeholder rows; the operating sections are
// data-driven (Category Range / Profit-Expenses) plus user-added custom rows.
export const OPERATING_INFLOW_EXTRA: ManualRowDef[] = [];
export const OPERATING_DIRECT_EXTRA: ManualRowDef[] = [];
export const OPERATING_EXPENSE_EXTRA: ManualRowDef[] = [];

interface OverrideRow {
  week_start: string;
  section: string;
  line_key: string;
  line_label: string | null;
  amount: number | string | null;
}

function startOfWeekMonday(d: Date): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = r.getDay();
  const diff = (day + 6) % 7; // Monday => 0
  r.setDate(r.getDate() - diff);
  r.setHours(0, 0, 0, 0);
  return r;
}

function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

function toDateOnly(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function num(v: number | string | null | undefined): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? 0));
  return Number.isFinite(n) ? n : 0;
}


export function useCashflowForecast(weekOffset = 0, opts: { includeCurrentWindow?: boolean } = {}) {
  // The "current window" actuals only power the Combined tab. Defer those three
  // (heavier) twin queries until that tab is opened so the default Forecast/Actual
  // views load noticeably faster.
  const includeCurrentWindow = opts.includeCurrentWindow ?? false;
  const { organizationId } = useOrganization();
  const { user, profile } = useAuth();
  const { selectedLocationId, selectedRegionId } = useFilters();
  const { allAvailableLocations } = useLocations();
  const queryClient = useQueryClient();

  // Per-location forecast-GENERATION settings (the Settings drawer). These are the
  // assumptions the projection below uses — membership churn/pay-day, the trend
  // cap, private growth mode, and cost inflation. Every field is defaulted to the
  // engine's old hardcoded constant, so an org with no saved settings is unchanged.
  const forecastSettingsApi = useCashflowForecastSettings(organizationId, selectedLocationId ?? null);
  const forecastSettings = forecastSettingsApi.settings;

  // Resolve which accounting integration the Category Range mapping was saved
  // under — MUST match the Setup Categories page, or the read finds no mapping.
  // Setup uses: location's connection when a location is picked, else the
  // integration that owns the most category_range_map rows.
  const { scope: coaLocationScope } = useLocationAccountingScope(organizationId, selectedLocationId);
  const mappedIntegrationQuery = useQuery({
    queryKey: ['cashflow-forecast-mapped-integration', organizationId],
    enabled: !!organizationId,
    staleTime: 10 * 60 * 1000,
    queryFn: async (): Promise<string | null> => {
      if (!organizationId) return null;
      const { data } = await (supabase as any)
        .from('category_range_map')
        .select('platform_integration_id')
        .eq('organization_id', organizationId)
        .not('platform_integration_id', 'is', null);
      const ids = ((data ?? []) as Array<{ platform_integration_id?: string | null }>)
        .map((r) => r.platform_integration_id)
        .filter((id): id is string => !!id);
      if (!ids.length) return null;
      const counts = new Map<string, number>();
      ids.forEach((id) => counts.set(id, (counts.get(id) || 0) + 1));
      return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    },
  });
  const coaPlatformIntegrationId = coaLocationScope.platformIntegrationId ?? mappedIntegrationQuery.data ?? null;

  // COA → Category Range mapping (now under the SAME integration Setup saved it),
  // used to list/forecast every section's accounts.
  const { categoryRange } = useSetupCategories(coaPlatformIntegrationId, selectedLocationId ?? null);

  // When an operating outflow group is mapped under Category Range (Direct Costs /
  // Over Heads), the forecast sources it from there. The Profit (Expenses)
  // benchmark query only needs to run when EITHER group lacks a Category Range
  // mapping (i.e. still needs the grouped fallback) — skipping it otherwise (perf).
  const directCatMapped = (categoryRange?.DirectCost?.length ?? 0) > 0;
  const expenseCatMapped = (categoryRange?.Overhead?.length ?? 0) > 0;

  // Membership churn assumption (annual). Sourced from the per-location forecast
  // settings so it's persisted and shared with the Settings drawer; tapers the
  // projected Denplan base forward and never touches actual data. Derived (not
  // local state) so editing settings re-projects immediately. `setChurnRate`
  // persists a new churn (flipping the preset to Custom) for back-compat callers.
  const churnRate = forecastSettings.membershipChurnAnnualPct / 100;
  const setChurnRate = (rate: number) =>
    forecastSettingsApi.save({ ...forecastSettings, preset: 'custom', membershipChurnAnnualPct: rate * 100 });

  // ── Anchor: THIS week's Monday; 13 forecast weeks roll forward from it, so week 1
  // is the current (in-progress) week — a standard 13-week cash flow starts "now". ──
  // `trailingWeeks` are the 13 Monday-weeks BEFORE the anchor — the actual history the
  // forecast is built from (the 13 fully-completed prior weeks; shown on the Actual tab).
  const { anchorMonday, weeks, trailingWeeks, trailingStart, trailingEnd } = useMemo(() => {
    const thisMonday = startOfWeekMonday(new Date());
    // This week's Monday, shifted by the user's window navigation (± whole weeks).
    const anchor = addDays(thisMonday, weekOffset * 7);
    const mkWeek = (weekStart: Date, i: number): ForecastWeek => ({
      index: i,
      weekNumber: i + 1,
      weekStart,
      iso: toDateOnly(weekStart),
      label: weekStart.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
      monthKey: `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, '0')}`,
    });
    const ws: ForecastWeek[] = [];
    for (let i = 0; i < FORECAST_WEEKS; i++) ws.push(mkWeek(addDays(anchor, i * 7), i));
    // Trailing baseline window: 13 Monday-weeks before the anchor.
    const tStart = addDays(anchor, -7 * FORECAST_WEEKS);
    const tEnd = addDays(anchor, -1);
    const tws: ForecastWeek[] = [];
    for (let i = 0; i < FORECAST_WEEKS; i++) tws.push(mkWeek(addDays(tStart, i * 7), i));
    return { anchorMonday: anchor, weeks: ws, trailingWeeks: tws, trailingStart: tStart, trailingEnd: tEnd };
  }, [weekOffset]);

  // Booked-appointment volume per practitioner (future per forecast week + trailing
  // total), used to shape the Lab Fees-<NAME> / Materials cost rows by clinical
  // workload while their LEVEL stays anchored to real lab/material invoices.
  const apptForecast = useAppointmentForecast(organizationId, selectedLocationId, anchorMonday, FORECAST_WEEKS, trailingStart);

  // NHS payment-week placement: weeks whose Monday is the first Monday of its
  // month (date 1–7). NHS claims for a month are paid in the first full week of
  // the NEXT month, so a forecast starting mid-June shows June's NHS on the first
  // July week (Jul 6), not in the partial June weeks.
  const firstFullWeekIndex = useMemo(() => {
    const firstFull = new Set<number>();
    weeks.forEach(w => {
      if (w.weekStart.getDate() <= 7) firstFull.add(w.index);
    });
    return firstFull;
  }, [weeks]);
  // Same placement rule for the trailing window (used by the Previous view).
  const trailingFirstFullWeekIndex = useMemo(() => {
    const firstFull = new Set<number>();
    trailingWeeks.forEach(w => { if (w.weekStart.getDate() <= 7) firstFull.add(w.index); });
    return firstFull;
  }, [trailingWeeks]);

  // Region scope (mirrors useEbitdaValuation): only when a region is selected
  // without a specific location.
  const regionLocationIds = useMemo(() => {
    if (selectedLocationId) return null; // single location selected → nothing to group
    // The group's location set: the chosen region's locations, else every org location
    // ("All Regions"). Active locations (Forecast Settings → Locations) then drop any the
    // user switched off. Default (none excluded) preserves the original behaviour: a
    // specific region keeps its list; All Regions stays unfiltered (null).
    const active = forecastSettingsApi.settings.module.locations.activeLocations;
    const all = allAvailableLocations ?? [];
    const base = selectedRegionId ? all.filter(l => l.region_id === selectedRegionId) : all;
    const anyExcluded = base.some(l => active[l.id] === false);
    if (!selectedRegionId && !anyExcluded) return null;
    const kept = base.filter(l => active[l.id] !== false).map(l => l.id);
    // ALL locations switched off → the group has no members. Return a sentinel id that
    // matches no location so the forecast shows nothing (rather than an empty list being
    // mis-read as "no filter → everything").
    return kept.length > 0 ? kept : ['00000000-0000-0000-0000-000000000000'];
  }, [allAvailableLocations, selectedRegionId, selectedLocationId, forecastSettingsApi.settings]);

  // ── CASH OUTFLOW baseline: WEEKLY expense actuals per "Profit (Expenses)"
  // group (Setup Categories → Profit (Expenses) → group_account mapping for the
  // scoped location). The profit-benchmark edge function does all the
  // platform-specific account resolution + P&L matching and returns the spend
  // per expense group for a date range — so we call it once PER trailing
  // Monday-week to get the real week-by-week cost pattern (not a monthly lump).
  // Returns group_account_master_id → number[13] (trailing week i actual). The
  // forward forecast repeats this weekly pattern, then Claude predicts week-wise. ──
  const outflowWeeklyQuery = useQuery({
    queryKey: [
      'cashflow-forecast-outflow-weekly',
      organizationId,
      selectedLocationId ?? 'all',
      regionLocationIds ? regionLocationIds.slice().sort().join(',') : 'none',
      toDateOnly(trailingStart),
      toDateOnly(trailingEnd),
    ],
    // Skip the ~14 benchmark calls when BOTH operating groups come from Category
    // Range; still run if either group needs the grouped fallback.
    enabled: !!organizationId && !(directCatMapped && expenseCatMapped),
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<{ weekly: Record<number, number[]>; totals: Record<number, number> }> => {
      if (!organizationId) return { weekly: {}, totals: {} };
      // The 13 trailing Monday-weeks [start, start+6 days].
      const weekRanges = Array.from({ length: FORECAST_WEEKS }, (_, i) => {
        const ws = addDays(trailingStart, i * 7);
        return { index: i, fromDate: toDateOnly(ws), toDate: toDateOnly(addDays(ws, 6)) };
      });
      // One call per (location × week), plus one window-total call per location;
      // region = sum of its locations, a single null locationId = all-locations.
      const locIds: (string | null)[] = selectedLocationId
        ? [selectedLocationId]
        : regionLocationIds && regionLocationIds.length > 0
          ? regionLocationIds
          : [null];

      const weekly: Record<number, number[]> = {};
      const totals: Record<number, number> = {};
      const ensure = (gid: number) => (weekly[gid] ??= new Array(FORECAST_WEEKS).fill(0));

      const calls: Array<Promise<void>> = [];
      // Per-week calls → the real week-by-week pattern (exact for invoice-dated
      // platforms like Xero/Sage).
      for (const wk of weekRanges) {
        for (const locId of locIds) {
          calls.push(
            getProfitBenchmark(organizationId, { fromDate: wk.fromDate, toDate: wk.toDate, locationId: locId })
              .then(res => {
                for (const r of res.rows ?? []) {
                  if (r.isProfitRow || r.groupAccountMasterId == null) continue;
                  const amt = Number(r.actualAmount ?? 0);
                  if (!Number.isFinite(amt) || amt === 0) continue;
                  ensure(r.groupAccountMasterId)[wk.index] += Math.abs(amt);
                }
              })
              .catch(() => { /* a single week/location failure → 0 for that cell */ }),
          );
        }
      }
      // Window-total calls → used to detect/repair monthly-P&L over-count (a
      // monthly platform returns the whole month for every week in it).
      const fromDate = toDateOnly(trailingStart);
      const toDate = toDateOnly(trailingEnd);
      for (const locId of locIds) {
        calls.push(
          getProfitBenchmark(organizationId, { fromDate, toDate, locationId: locId })
            .then(res => {
              for (const r of res.rows ?? []) {
                if (r.isProfitRow || r.groupAccountMasterId == null) continue;
                const amt = Number(r.actualAmount ?? 0);
                if (!Number.isFinite(amt)) continue;
                totals[r.groupAccountMasterId] = (totals[r.groupAccountMasterId] ?? 0) + Math.abs(amt);
              }
            })
            .catch(() => { /* total stays 0 */ }),
        );
      }
      await Promise.all(calls);
      return { weekly, totals };
    },
  });

  // ── DISPLAYED-WINDOW twin of outflowWeeklyQuery: the operating expense actuals
  // over the 13 weeks currently shown (`weeks`), so the Combined tab can show each
  // week's OWN actual (for weeks that have already ended) rather than the trailing
  // figure. Same shape/logic; only the date ranges differ. ──
  const currentOutflowWeeklyQuery = useQuery({
    queryKey: [
      'cashflow-forecast-outflow-weekly-current',
      organizationId,
      selectedLocationId ?? 'all',
      regionLocationIds ? regionLocationIds.slice().sort().join(',') : 'none',
      weeks[0]?.iso ?? '',
      weeks[weeks.length - 1]?.iso ?? '',
    ],
    enabled: includeCurrentWindow && !!organizationId && weeks.length > 0 && !(directCatMapped && expenseCatMapped),
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<{ weekly: Record<number, number[]>; totals: Record<number, number> }> => {
      if (!organizationId) return { weekly: {}, totals: {} };
      // The 13 displayed Monday-weeks [start, start+6 days].
      const weekRanges = weeks.map((w, i) => ({
        index: i, fromDate: toDateOnly(w.weekStart), toDate: toDateOnly(addDays(w.weekStart, 6)),
      }));
      const locIds: (string | null)[] = selectedLocationId
        ? [selectedLocationId]
        : regionLocationIds && regionLocationIds.length > 0
          ? regionLocationIds
          : [null];

      const weekly: Record<number, number[]> = {};
      const totals: Record<number, number> = {};
      const ensure = (gid: number) => (weekly[gid] ??= new Array(FORECAST_WEEKS).fill(0));

      const calls: Array<Promise<void>> = [];
      for (const wk of weekRanges) {
        for (const locId of locIds) {
          calls.push(
            getProfitBenchmark(organizationId, { fromDate: wk.fromDate, toDate: wk.toDate, locationId: locId })
              .then(res => {
                for (const r of res.rows ?? []) {
                  if (r.isProfitRow || r.groupAccountMasterId == null) continue;
                  const amt = Number(r.actualAmount ?? 0);
                  if (!Number.isFinite(amt) || amt === 0) continue;
                  ensure(r.groupAccountMasterId)[wk.index] += Math.abs(amt);
                }
              })
              .catch(() => { /* a single week/location failure → 0 for that cell */ }),
          );
        }
      }
      // Window-total calls over the displayed window.
      const fromDate = toDateOnly(weeks[0].weekStart);
      const toDate = toDateOnly(addDays(weeks[weeks.length - 1].weekStart, 6));
      for (const locId of locIds) {
        calls.push(
          getProfitBenchmark(organizationId, { fromDate, toDate, locationId: locId })
            .then(res => {
              for (const r of res.rows ?? []) {
                if (r.isProfitRow || r.groupAccountMasterId == null) continue;
                const amt = Number(r.actualAmount ?? 0);
                if (!Number.isFinite(amt)) continue;
                totals[r.groupAccountMasterId] = (totals[r.groupAccountMasterId] ?? 0) + Math.abs(amt);
              }
            })
            .catch(() => { /* total stays 0 */ }),
        );
      }
      await Promise.all(calls);
      return { weekly, totals };
    },
  });

  // ── BLOCK baselines: trailing actuals per COA account, classified by Category
  // Range. Reuses the same engine the Cashflow Statement page uses
  // (getCashflowReport → cashflow-report edge fn), which already groups GL by
  // category per account, platform-agnostically (Xero via finance_journal_lines,
  // iplicit fallback). We call it once PER trailing Monday-week so we get the real
  // WEEK-BY-WEEK pattern per account (not a monthly lump); that pattern is then
  // repeated forward and AI-refined. Keyed by dataKey + COA account id → week[13]. ──
  type BlockAccount = { name: string; weekly: number[] };
  const blockActualsQuery = useQuery({
    queryKey: [
      'cashflow-forecast-block-actuals',
      organizationId,
      selectedLocationId ?? 'all',
      regionLocationIds ? regionLocationIds.slice().sort().join(',') : 'none',
      toDateOnly(trailingStart),
      toDateOnly(trailingEnd),
    ],
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<Record<string, Record<string, BlockAccount>>> => {
      const out: Record<string, Record<string, BlockAccount>> = {};
      if (!organizationId) return out;

      // category_range_master.name → dataKey (names are stable seed data; mapped
      // via the master id so display-name wording never matters).
      const { data: masters } = await supabase
        .from('category_range_master' as any)
        .select('id, name');
      const nameToDataKey = new Map<string, string>();
      for (const m of (masters ?? []) as unknown as { id: number; name: string }[]) {
        const target = CATEGORY_ROW_TARGET[m.id];
        if (target) nameToDataKey.set(m.name, target.dataKey);
      }
      if (nameToDataKey.size === 0) return out;

      const locIds: (string | null)[] = selectedLocationId
        ? [selectedLocationId]
        : regionLocationIds && regionLocationIds.length > 0
          ? regionLocationIds
          : [null];

      // The 13 trailing Monday-weeks [start, start+6 days].
      const weekRanges = Array.from({ length: FORECAST_WEEKS }, (_, i) => {
        const ws = addDays(trailingStart, i * 7);
        return { index: i, fromDate: toDateOnly(ws), toDate: toDateOnly(addDays(ws, 6)) };
      });

      const addWeek = (dataKey: string, accountId: string, name: string, weekIdx: number, amount: number) => {
        const bucket = (out[dataKey] ??= {});
        const acc = (bucket[accountId] ??= { name, weekly: new Array(FORECAST_WEEKS).fill(0) });
        acc.weekly[weekIdx] += amount;
        if (!acc.name && name) acc.name = name;
      };

      // One report call per (trailing week × location) → the real weekly pattern.
      const calls: Array<Promise<void>> = [];
      for (const wk of weekRanges) {
        for (const locId of locIds) {
          calls.push(
            getCashflowReport(organizationId, { fromDate: wk.fromDate, toDate: wk.toDate, locationId: locId })
              .then((report) => {
                if (!report) return;
                for (const group of report.tableGroupDataSet ?? []) {
                  for (const sub of group.subGroupDataSet ?? []) {
                    for (const rowSet of sub.rowDataSet ?? []) {
                      const dataKey = nameToDataKey.get(rowSet.header);
                      if (!dataKey) continue;
                      for (const row of rowSet.rowData ?? []) {
                        const accountId = String(row.id ?? row.name ?? '').trim();
                        if (!accountId) continue;
                        const amount = (row.colData ?? []).reduce(
                          (s, c) => s + (String(c.column).toLowerCase() === 'total' ? 0 : (Number(c.value) || 0)), 0);
                        if (amount === 0) continue;
                        addWeek(dataKey, accountId.toLowerCase(), row.name || accountId, wk.index, Math.abs(amount));
                      }
                    }
                  }
                }
              })
              .catch(() => { /* a single week/location failure → 0 for that cell */ }),
          );
        }
      }
      await Promise.all(calls);
      return out;
    },
  });

  // ── DISPLAYED-WINDOW twin of blockActualsQuery: per-COA-account actuals over the
  // 13 weeks currently shown (`weeks`), classified by Category Range. Powers each
  // week's OWN actual + variance in the Combined tab. Same shape/logic; only the
  // per-week date ranges differ. ──
  const currentBlockActualsQuery = useQuery({
    queryKey: [
      'cashflow-forecast-block-actuals-current',
      organizationId,
      selectedLocationId ?? 'all',
      regionLocationIds ? regionLocationIds.slice().sort().join(',') : 'none',
      weeks[0]?.iso ?? '',
      weeks[weeks.length - 1]?.iso ?? '',
    ],
    enabled: includeCurrentWindow && !!organizationId && weeks.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<Record<string, Record<string, BlockAccount>>> => {
      const out: Record<string, Record<string, BlockAccount>> = {};
      if (!organizationId) return out;

      const { data: masters } = await supabase
        .from('category_range_master' as any)
        .select('id, name');
      const nameToDataKey = new Map<string, string>();
      for (const m of (masters ?? []) as unknown as { id: number; name: string }[]) {
        const target = CATEGORY_ROW_TARGET[m.id];
        if (target) nameToDataKey.set(m.name, target.dataKey);
      }
      if (nameToDataKey.size === 0) return out;

      const locIds: (string | null)[] = selectedLocationId
        ? [selectedLocationId]
        : regionLocationIds && regionLocationIds.length > 0
          ? regionLocationIds
          : [null];

      // The 13 displayed Monday-weeks [start, start+6 days].
      const weekRanges = weeks.map((w, i) => ({
        index: i, fromDate: toDateOnly(w.weekStart), toDate: toDateOnly(addDays(w.weekStart, 6)),
      }));

      const addWeek = (dataKey: string, accountId: string, name: string, weekIdx: number, amount: number) => {
        const bucket = (out[dataKey] ??= {});
        const acc = (bucket[accountId] ??= { name, weekly: new Array(FORECAST_WEEKS).fill(0) });
        acc.weekly[weekIdx] += amount;
        if (!acc.name && name) acc.name = name;
      };

      const calls: Array<Promise<void>> = [];
      for (const wk of weekRanges) {
        for (const locId of locIds) {
          calls.push(
            getCashflowReport(organizationId, { fromDate: wk.fromDate, toDate: wk.toDate, locationId: locId })
              .then((report) => {
                if (!report) return;
                for (const group of report.tableGroupDataSet ?? []) {
                  for (const sub of group.subGroupDataSet ?? []) {
                    for (const rowSet of sub.rowDataSet ?? []) {
                      const dataKey = nameToDataKey.get(rowSet.header);
                      if (!dataKey) continue;
                      for (const row of rowSet.rowData ?? []) {
                        const accountId = String(row.id ?? row.name ?? '').trim();
                        if (!accountId) continue;
                        const amount = (row.colData ?? []).reduce(
                          (s, c) => s + (String(c.column).toLowerCase() === 'total' ? 0 : (Number(c.value) || 0)), 0);
                        if (amount === 0) continue;
                        addWeek(dataKey, accountId.toLowerCase(), row.name || accountId, wk.index, Math.abs(amount));
                      }
                    }
                  }
                }
              })
              .catch(() => { /* a single week/location failure → 0 for that cell */ }),
          );
        }
      }
      await Promise.all(calls);
      return out;
    },
  });

  // Per-bill settings the user set on the "Bills to Pay" page:
  //   • excluded — these invoices are dropped from the pipeline overlay below.
  //   • expectedById — Planned Date override (line_label). Placement is:
  //       Planned Date → else Due Date → if that date is already past,
  //       fold into this week (payable by this week's end).
  // Stored in cashflow_forecast_overrides (section 'bill', amount 1 = excluded,
  // line_label = planned/expected date YYYY-MM-DD).
  const billSettingsQuery = useQuery({
    queryKey: ['cashflow-forecast-bill-settings-v2', organizationId, selectedLocationId ?? 'all'],
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<{ excluded: string[]; expectedById: Record<string, string> }> => {
      const empty = { excluded: [] as string[], expectedById: {} as Record<string, string> };
      if (!organizationId) return empty;
      let q = (supabase as any)
        .from('cashflow_forecast_overrides')
        .select('line_key, amount, line_label')
        .eq('organization_id', organizationId)
        .eq('section', 'bill');
      q = selectedLocationId ? q.eq('location_id', selectedLocationId) : q.is('location_id', null);
      const { data, error } = await q;
      if (error) return empty; // never let the overlay break the core forecast
      const excluded: string[] = [];
      const expectedById: Record<string, string> = {};
      for (const r of (data ?? []) as Array<{ line_key: string; amount: number | string; line_label: string | null }>) {
        if (Number(r.amount) > 0) excluded.push(r.line_key);
        if (r.line_label) expectedById[r.line_key] = String(r.line_label).slice(0, 10);
      }
      return { excluded, expectedById };
    },
  });

  // ── BLOCK forward "known pipeline": already-issued, unpaid Xero invoices/bills
  // whose due/planned date falls inside the forecast window, attributed to a block
  // subsection via their line-item account → Category Range mapping, and bucketed
  // into the week containing the effective payment date. ACCPAY bills follow
  // Bills to Pay (AUTHORISED + amount_due > 0 + In Forecast). Xero-first (the
  // active platform); other platforms can be added behind the same shape.
  // Defensive — any failure yields an empty overlay so the trailing baseline
  // always stands. ──
  type ForwardAccount = { name: string; due: number[] };
  const blockPipelineQuery = useQuery({
    queryKey: [
      'cashflow-forecast-block-pipeline-v2',
      organizationId,
      selectedLocationId ?? 'all',
      weeks[0]?.iso ?? '',
      // re-key when the COA mapping changes
      JSON.stringify(categoryRange ?? {}),
      // re-key when excluded bills OR planned-date overrides change
      (billSettingsQuery.data?.excluded ?? []).slice().sort().join(','),
      JSON.stringify(billSettingsQuery.data?.expectedById ?? {}),
    ],
    enabled: !!organizationId && weeks.length > 0 && !billSettingsQuery.isLoading,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<Record<string, Record<string, ForwardAccount>>> => {
      const out: Record<string, Record<string, ForwardAccount>> = {};
      const excludedBills = new Set(billSettingsQuery.data?.excluded ?? []);
      const expectedById = billSettingsQuery.data?.expectedById ?? {};
      if (!organizationId || weeks.length === 0) return out;

      // Map each mapped COA account (lower-cased id/code) → dataKey bucket.
      const accountToDataKey = new Map<string, string>();
      for (const [vmKey, dataKey] of Object.entries(CATEGORY_VMKEY_DATAKEY)) {
        const ids = (categoryRange?.[vmKey as keyof CategoryRangeVM] ?? []) as string[];
        for (const id of ids) accountToDataKey.set(String(id).trim().toLowerCase(), dataKey!);
      }
      // We intentionally do NOT bail when nothing is mapped: an included ACCPAY
      // bill on an unmapped COA must still forecast, under its own account name
      // (the UNMAPPED_BILL_DATAKEY bucket below), grouped with operating Expenses.

      // Which forecast week (0..12) contains a given date, or -1 if outside.
      const windowStart = weeks[0].weekStart;
      const windowEnd = addDays(weeks[weeks.length - 1].weekStart, 6);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const weekIndexFor = (d: Date): number => {
        if (d < windowStart || d > windowEnd) return -1;
        const days = Math.floor((d.getTime() - windowStart.getTime()) / (24 * 60 * 60 * 1000));
        return Math.min(FORECAST_WEEKS - 1, Math.floor(days / 7));
      };
      // Bills (ACCPAY): Planned Date (override) → else Due Date. If that date is
      // already in the past, fold into week 0 (this week / payable by week end)
      // — but ONLY in the live window (weekOffset === 0). Income invoices keep
      // due-date placement with NO overdue fold.
      const placementWeekFor = (inv: {
        id: string;
        due_date: string | null;
        invoice_type: string | null;
      }): number => {
        const isBill = String(inv.invoice_type ?? '').toUpperCase() === 'ACCPAY';
        if (!isBill) {
          if (!inv.due_date) return -1;
          return weekIndexFor(new Date(`${inv.due_date}T00:00:00`));
        }
        const planned = expectedById[inv.id] || null;
        const due = inv.due_date || null;
        const eff = planned || due;
        if (!eff) return -1;
        const d = new Date(`${eff}T00:00:00`);
        if (Number.isNaN(d.getTime())) return -1;
        if (d < today) return weekOffset === 0 ? 0 : -1;
        return weekIndexFor(d);
      };

      try {
        // Tenant → practice location (same resolve as Bills to Pay). Sync often
        // leaves location_id null; without this, selected-location forecasts
        // either miss bills or pull in the wrong Xero org.
        const [{ data: tenants }, { data: maps }, { data: locs }] = await Promise.all([
          (supabase as any)
            .from('platform_integration_organizations')
            .select('id, platform_org_id')
            .eq('organization_id', organizationId),
          (supabase as any)
            .from('platform_integration_organization_mapping')
            .select('platform_integration_organizations_id, location_id')
            .eq('organization_id', organizationId),
          (supabase as any)
            .from('practice_locations')
            .select('id')
            .eq('organization_id', organizationId)
            .is('deleted_at', null),
        ]);
        const locById = new Set(
          ((locs ?? []) as Array<{ id: string }>).map((r) => String(r.id)),
        );
        const pioIdToTenant = new Map<string, string>();
        for (const r of (tenants ?? []) as Array<{ id: string; platform_org_id: string | null }>) {
          if (r.platform_org_id) pioIdToTenant.set(String(r.id), String(r.platform_org_id));
        }
        const tenantLocById = new Map<string, string>();
        for (const r of (maps ?? []) as Array<{
          platform_integration_organizations_id: string;
          location_id: string | null;
        }>) {
          const tenant = pioIdToTenant.get(String(r.platform_integration_organizations_id));
          const loc = r.location_id ? String(r.location_id) : null;
          if (tenant && loc && locById.has(loc)) tenantLocById.set(tenant, loc);
        }

        // Unpaid invoices/bills through the forecast horizon. No lower due_date
        // bound — overdue ACCPAY must still fold into this week. Income rows with
        // due dates beyond the window are dropped by placementWeekFor.
        let invQ = (supabase as any)
          .from('xero_invoices')
          .select('id, due_date, amount_due, is_paid, location_id, invoice_type, status, xero_tenant_id')
          .eq('organization_id', organizationId)
          .eq('is_paid', false)
          .neq('invoice_type', 'PL_SYNTHETIC')
          .or(`due_date.lte.${toDateOnly(windowEnd)},due_date.is.null`);
        if (selectedLocationId) {
          invQ = invQ.or(`location_id.eq.${selectedLocationId},location_id.is.null`);
        }
        const { data: invoices } = await invQ;

        type InvRow = {
          id: string;
          due_date: string | null;
          amount_due: number | string;
          invoice_type: string | null;
          status: string | null;
          location_id: string | null;
          xero_tenant_id: string | null;
        };

        const invRows = ((invoices ?? []) as InvRow[]).filter((r) => {
          if (excludedBills.has(r.id)) return false;
          const type = String(r.invoice_type ?? '').toUpperCase();
          const tenant = r.xero_tenant_id ? String(r.xero_tenant_id) : null;
          const stamped = r.location_id && locById.has(String(r.location_id))
            ? String(r.location_id)
            : null;
          const resolvedLoc = stamped ?? (tenant ? (tenantLocById.get(tenant) ?? null) : null);

          if (selectedLocationId) {
            if (resolvedLoc !== selectedLocationId) return false;
          } else if (!resolvedLoc) {
            // All-locations: drop unmapped tenants (same as Bills to Pay).
            return false;
          }

          if (type === 'ACCPAY') {
            // Match Bills to Pay source list: AUTHORISED + outstanding amount.
            if (String(r.status ?? '').toUpperCase() !== 'AUTHORISED') return false;
            if (!(Number(r.amount_due) > 0)) return false;
            return true;
          }
          // Income (ACCREC etc.): need a due date inside/near the window.
          return !!r.due_date;
        });
        if (invRows.length === 0) return out;

        const byId = new Map(invRows.map((r) => [r.id, r]));
        const { data: lines } = await (supabase as any)
          .from('xero_invoice_line_items')
          .select('invoice_id, account_id, account_code, line_amount')
          .in('invoice_id', invRows.map((r) => r.id));

        // Group line items per invoice so we can split amount_due proportionally
        // across the (possibly several) accounts on the invoice.
        const linesByInvoice = new Map<string, { key: string; dataKey: string; amount: number }[]>();
        for (const l of (lines ?? []) as {
          invoice_id: string;
          account_id: string | null;
          account_code: string | null;
          line_amount: number | string;
        }[]) {
          const key = String(l.account_id ?? l.account_code ?? '').trim().toLowerCase();
          let dataKey = accountToDataKey.get(key)
            ?? accountToDataKey.get(String(l.account_code ?? '').trim().toLowerCase());
          if (!dataKey) {
            // Account isn't in any Category Range bucket. If this is an included
            // ACCPAY bill, still forecast it under its own COA (grouped with
            // operating Expenses). Unmapped non-bill (e.g. ACCREC) lines are
            // dropped — we won't guess them into an outflow row.
            const inv = byId.get(l.invoice_id);
            if (String(inv?.invoice_type ?? '').toUpperCase() !== 'ACCPAY') continue;
            dataKey = UNMAPPED_BILL_DATAKEY;
          }
          const arr = linesByInvoice.get(l.invoice_id) ?? [];
          arr.push({
            key: key || String(l.account_code ?? ''),
            dataKey,
            amount: Math.abs(Number(l.line_amount) || 0),
          });
          linesByInvoice.set(l.invoice_id, arr);
        }

        const add = (dataKey: string, accountKey: string, weekIdx: number, amount: number) => {
          const bucket = (out[dataKey] ??= {});
          const acc = (bucket[accountKey] ??= {
            name: accountKey,
            due: new Array(FORECAST_WEEKS).fill(0),
          });
          acc.due[weekIdx] += amount;
        };

        for (const [invoiceId, invLines] of linesByInvoice) {
          const inv = byId.get(invoiceId);
          if (!inv) continue;
          const wi = placementWeekFor(inv);
          if (wi < 0) continue;
          const amountDue = Math.abs(Number(inv.amount_due) || 0);
          if (amountDue === 0) continue;
          const lineTotal = invLines.reduce((s, l) => s + l.amount, 0);
          for (const l of invLines) {
            // Split the outstanding amount across mapped lines by line proportion;
            // if line amounts are missing, share equally.
            const share = lineTotal > 0 ? (l.amount / lineTotal) : (1 / invLines.length);
            add(l.dataKey, l.key, wi, amountDue * share);
          }
        }
      } catch {
        return out; // never let the overlay break the core forecast
      }
      return out;
    },
  });

  // ── Cost-account billing CADENCE — from the real ACCPAY supplier-invoice rhythm
  // over the SAME trailing 13-week (~3-month) window the rest of the forecast uses,
  // so it stays consistent and the projected amount reflects RECENT pricing. ~3
  // months is enough to spot the cadences that matter inside a 13-week horizon:
  // weekly (~13 invoices) and monthly (~3 invoices, ~30-day gaps). A quarterly/
  // annual bill (e.g. Audit) has too few invoices here → 'irregular' → it stays a
  // one-off known bill, which is correct since it barely recurs within 13 weeks.
  // Per account: cadence (median gap), typical per-occurrence amount (median), and
  // billing day-of-month. Keyed by lower-cased account id AND code. ──
  const costCadenceQuery = useQuery({
    queryKey: ['cashflow-forecast-cost-cadence', organizationId, selectedLocationId ?? 'all', toDateOnly(trailingStart), toDateOnly(trailingEnd)],
    enabled: !!organizationId,
    staleTime: 10 * 60 * 1000,
    queryFn: async (): Promise<Record<string, CadenceInfo>> => {
      const out: Record<string, CadenceInfo> = {};
      if (!organizationId) return out;
      try {
        const since = toDateOnly(trailingStart);
        let q = (supabase as any)
          .from('xero_invoices')
          .select('id, invoice_date, location_id')
          .eq('organization_id', organizationId)
          .eq('invoice_type', 'ACCPAY')
          .not('invoice_date', 'is', null)
          .gte('invoice_date', since)
          .lte('invoice_date', toDateOnly(trailingEnd));
        if (selectedLocationId) q = q.or(`location_id.eq.${selectedLocationId},location_id.is.null`);
        const { data: inv } = await q;
        const rows = (inv ?? []) as Array<{ id: string; invoice_date: string }>;
        if (!rows.length) return out;
        const dateById = new Map(rows.map(r => [r.id, String(r.invoice_date).slice(0, 10)]));
        const ids = rows.map(r => r.id);
        // Per account: one (date, amount) per invoice (sum that account's lines).
        const perAcct = new Map<string, Map<string, number>>(); // acct → invoiceId → amount
        for (let i = 0; i < ids.length; i += 200) {
          const { data: li } = await (supabase as any)
            .from('xero_invoice_line_items')
            .select('invoice_id, account_id, account_code, line_amount')
            .in('invoice_id', ids.slice(i, i + 200));
          for (const l of (li ?? []) as Array<{ invoice_id: string; account_id: string | null; account_code: string | null; line_amount: number | string }>) {
            if (!dateById.has(l.invoice_id)) continue;
            const amt = Math.abs(Number(l.line_amount) || 0);
            for (const raw of [l.account_id, l.account_code]) {
              if (!raw) continue;
              const k = String(raw).trim().toLowerCase();
              const m = perAcct.get(k) ?? new Map<string, number>();
              m.set(l.invoice_id, (m.get(l.invoice_id) ?? 0) + amt);
              perAcct.set(k, m);
            }
          }
        }
        const median = (arr: number[]) => { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
        for (const [k, byInv] of perAcct) {
          const entries = [...byInv.entries()].map(([id, amt]) => ({ d: dateById.get(id)!, amt })).filter(e => e.d);
          const uniqDates = [...new Set(entries.map(e => e.d))].sort();
          const days = uniqDates.map(d => Number(d.slice(8, 10))).filter(n => n >= 1 && n <= 31).sort((a, b) => a - b);
          const billDay = days.length ? days[Math.floor(days.length / 2)] : 1;
          const amount = median(entries.map(e => e.amt));
          if (uniqDates.length < 2) { out[k] = { cadence: 'irregular', billDay, amount }; continue; }
          const gaps: number[] = [];
          for (let i = 1; i < uniqDates.length; i++) gaps.push((Date.parse(uniqDates[i]) - Date.parse(uniqDates[i - 1])) / 86400000);
          gaps.sort((a, b) => a - b);
          const med = gaps[Math.floor(gaps.length / 2)];
          out[k] = { cadence: med <= 10 ? 'weekly' : med <= 45 ? 'monthly' : 'irregular', billDay, amount };
        }
      } catch { /* never let cadence detection break the forecast */ }
      return out;
    },
  });

  // ── COA account names (org-wide) — so EVERY mapped account can be listed as a
  // row even when it has no trailing cash / no invoice (the report only names the
  // active ones). Keyed by lower-cased account id AND code, across the platforms
  // an org may use, so a Category Range mapping value always resolves to a name. ──
  const coaNamesQuery = useQuery({
    queryKey: ['cashflow-forecast-coa-names', organizationId],
    enabled: !!organizationId,
    staleTime: 10 * 60 * 1000,
    queryFn: async (): Promise<Record<string, string>> => {
      const map: Record<string, string> = {};
      if (!organizationId) return map;
      const put = (k: unknown, name: unknown) => {
        const key = String(k ?? '').trim().toLowerCase();
        const nm = String(name ?? '').trim();
        if (key && nm && !map[key]) map[key] = nm;
      };
      const [xero, generic, qb, sage] = await Promise.all([
        (supabase as any).from('xero_chart_of_accounts').select('xero_account_id, account_code, account_name').eq('organization_id', organizationId),
        (supabase as any).from('platform_integration_chart_of_accounts').select('coa_account_id, coa_account_code, coa_account_name').eq('organization_id', organizationId),
        (supabase as any).from('quickbooks_chart_of_accounts').select('qb_account_id, account_number, account_name').eq('organization_id', organizationId),
        (supabase as any).from('sage_chart_of_accounts').select('sage_account_id, account_code, account_name').eq('organization_id', organizationId),
      ].map(p => p.then((r: any) => r).catch(() => ({ data: [] }))));
      for (const r of (xero.data ?? [])) { put(r.xero_account_id, r.account_name); put(r.account_code, r.account_name); }
      for (const r of (generic.data ?? [])) { put(r.coa_account_id, r.coa_account_name); put(r.coa_account_code, r.coa_account_name); }
      for (const r of (qb.data ?? [])) { put(r.qb_account_id, r.account_name); put(r.account_number, r.account_name); }
      for (const r of (sage.data ?? [])) { put(r.sage_account_id, r.account_name); put(r.account_code, r.account_name); }
      return map;
    },
  });

  // ── Mapped Private payment-plan IDs (PMS source) ──
  // Location Settings → Income Type Mapping → Private (PMS App) maps the Private row
  // to specific Dentally payment plans (practice_locations.private_income_accounts,
  // a JSONB array of pp_ids). The PMS takings path must honour that mapping so the
  // Private row is ONLY the mapped plans (e.g. "Private"), not every plan taken at the
  // location (which would wrongly fold in Denplan / NHS / sundries takings). Returns
  // the numeric pp_ids to restrict to, or null = no PMS mapping in scope → all plans
  // (preserves behaviour for unmapped locations). Accounting-source locations are
  // skipped here (their Private row is driven by the ledger path instead).
  const getMappedPrivatePlanIds = async (locIds: string[] | null): Promise<number[] | null> => {
    if (!organizationId) return null;
    let q = (supabase as any)
      .from('practice_locations')
      .select('private_income_source, private_income_accounts')
      .eq('organization_id', organizationId).is('deleted_at', null);
    if (locIds) q = q.in('id', locIds);
    const { data } = await q;
    const ids = new Set<number>();
    for (const l of (data ?? []) as Array<{ private_income_source: string | null; private_income_accounts: unknown }>) {
      if ((l.private_income_source || 'pms') === 'accounting') continue;
      const arr = Array.isArray(l.private_income_accounts) ? l.private_income_accounts : [];
      for (const a of arr) { const n = Number(a); if (Number.isFinite(n)) ids.add(n); }
    }
    return ids.size > 0 ? [...ids] : null;
  };

  // NHS payment-plan ids for the scoped locations (Income Type Mapping → NHS). Used to
  // EXCLUDE NHS takings from the Private row: NHS has its own forecast row, so counting
  // NHS payments as Private both overstates Private and double-counts NHS. Unlike the
  // private lookup this ignores nhs_income_source — an NHS plan identifies NHS money
  // whichever source the NHS row itself is driven from.
  const getMappedNhsPlanIds = async (locIds: string[] | null): Promise<number[]> => {
    if (!organizationId) return [];
    let q = (supabase as any)
      .from('practice_locations')
      .select('nhs_income_accounts')
      .eq('organization_id', organizationId).is('deleted_at', null);
    if (locIds) q = q.in('id', locIds);
    const { data } = await q;
    const ids = new Set<number>();
    for (const l of (data ?? []) as Array<{ nhs_income_accounts: unknown }>) {
      const arr = Array.isArray(l.nhs_income_accounts) ? l.nhs_income_accounts : [];
      for (const a of arr) { const n = Number(a); if (Number.isFinite(n)) ids.add(n); }
    }
    return [...ids];
  };

  // ── Private baseline: the Dentally "Takings" logic — actual PAYMENTS received
  // (dentally_payments.dp_amount), filtered to the MAPPED private payment plans and
  // bucketed by payment date (dp_dated_on) into the trailing Monday-weeks. This is
  // CASH actually taken (what a cash flow forecast should repeat forward), not
  // completed-treatment accrual revenue. It mirrors the Dentally Takings report:
  // Payment Plan = mapped Private plan(s), by dated_on, scoped to the selected
  // Location. Private plan IDs come from practice_locations.private_income_accounts.
  const privateQuery = useQuery({
    queryKey: [
      'cashflow-forecast-private',
      organizationId,
      selectedLocationId ?? 'all',
      regionLocationIds ? regionLocationIds.slice().sort().join(',') : 'none',
      toDateOnly(trailingStart),
      toDateOnly(trailingEnd),
    ],
    enabled: !!organizationId,
    // Returns the trailing-13-week Private revenue bucketed by Monday-week
    // (index 0..12) AND the distinct patient count per week, so the forecast can
    // both repeat the pattern forward and apply a patient-volume trend.
    queryFn: async (): Promise<{ revenue: number[]; patients: number[] }> => {
      const emptyWeeks = () => new Array(FORECAST_WEEKS).fill(0) as number[];
      const emptyResult = () => ({ revenue: emptyWeeks(), patients: emptyWeeks() });
      if (!organizationId) return emptyResult();

      // Location scope. Payments carry a real location_id (mapped from Dentally
      // site_id), so the Takings figure is scoped by location exactly like the
      // Dentally Takings report's Location filter — no provider chain needed.
      const locIds = selectedLocationId
        ? [selectedLocationId]
        : regionLocationIds && regionLocationIds.length > 0 ? regionLocationIds : null;

      // Bucket non-deleted location payments into the 13 trailing Monday-weeks by
      // dp_dated_on; track distinct payers per week for the volume trend.
      // Restrict to the location's mapped Private payment plans (Income Type Mapping →
      // Private = PMS App). null = no Private mapping in scope → keep all plans EXCEPT
      // NHS: NHS has its own forecast row, so NHS takings must never land on Private
      // (that would overstate Private and double-count NHS in total inflow).
      const [planIds, nhsPlanIds] = await Promise.all([
        getMappedPrivatePlanIds(locIds),
        getMappedNhsPlanIds(locIds),
      ]);

      const weekly = emptyWeeks();
      const patientsPerWeek: Array<Set<string>> = Array.from({ length: FORECAST_WEEKS }, () => new Set<string>());
      const trailingStartMs = trailingStart.getTime();
      const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
      const upperExclusive = toDateOnly(addDays(trailingEnd, 1)); // dp_dated_on < end+1 (inclusive of end, date- or timestamp-safe)
      const PAGE = 1000;
      let from = 0;
      while (true) {
        let q = (supabase as any)
          .from('dentally_payments')
          .select('dp_amount, dp_dated_on, dp_patient_id')
          .eq('organization_id', organizationId)
          .eq('dp_deleted', false)
          .not('dp_dated_on', 'is', null)
          .gte('dp_dated_on', toDateOnly(trailingStart))
          .lt('dp_dated_on', upperExclusive);
        if (locIds) q = q.in('location_id', locIds);
        if (planIds) q = q.in('dp_payment_plan_id', planIds);
        else if (nhsPlanIds.length) q = q.not('dp_payment_plan_id', 'in', `(${nhsPlanIds.join(',')})`);
        const { data, error } = await q.range(from, from + PAGE - 1);
        if (error) throw error;
        const rows = (data ?? []) as Array<{ dp_amount: number | string | null; dp_dated_on: string | null; dp_patient_id: number | string | null }>;
        for (const p of rows) {
          const d = (p.dp_dated_on || '').substring(0, 10);
          if (!d) continue;
          const [yy, mm, dd] = d.split('-').map(Number);
          const ms = new Date(yy, (mm || 1) - 1, dd || 1).getTime();
          let idx = Math.floor((ms - trailingStartMs) / WEEK_MS);
          if (idx < 0) idx = 0;
          if (idx > FORECAST_WEEKS - 1) idx = FORECAST_WEEKS - 1;
          weekly[idx] += num(p.dp_amount);
          if (p.dp_patient_id != null) patientsPerWeek[idx].add(String(p.dp_patient_id));
        }
        if (rows.length < PAGE) break;
        from += PAGE;
      }
      return { revenue: weekly, patients: patientsPerWeek.map(s => s.size) };
    },
  });

  // ── DISPLAYED-WINDOW twin of privateQuery: Private Takings (payments) bucketed by
  // the 13 weeks currently shown (`weeks`), so the Combined tab can show each shown
  // week's OWN actual. Same logic; only the date window differs. ──
  const currentPrivateQuery = useQuery({
    queryKey: [
      'cashflow-forecast-private-current',
      organizationId,
      selectedLocationId ?? 'all',
      regionLocationIds ? regionLocationIds.slice().sort().join(',') : 'none',
      weeks[0]?.iso ?? '',
      weeks[weeks.length - 1]?.iso ?? '',
    ],
    enabled: includeCurrentWindow && !!organizationId && weeks.length > 0,
    queryFn: async (): Promise<{ revenue: number[]; patients: number[] }> => {
      const emptyWeeks = () => new Array(FORECAST_WEEKS).fill(0) as number[];
      const emptyResult = () => ({ revenue: emptyWeeks(), patients: emptyWeeks() });
      if (!organizationId) return emptyResult();

      // Displayed-window bounds (in place of trailingStart/trailingEnd).
      const windowStart = weeks[0].weekStart;
      const windowEnd = addDays(weeks[weeks.length - 1].weekStart, 6);

      const locIds = selectedLocationId
        ? [selectedLocationId]
        : regionLocationIds && regionLocationIds.length > 0 ? regionLocationIds : null;

      // Mapped-Private-plan takings bucketed into the 13 displayed Monday-weeks by
      // dp_dated_on — the shown week's OWN actual for the mapped Private plan(s).
      // NHS plans are excluded when there's no explicit Private mapping (see privateQuery).
      const [planIds, nhsPlanIds] = await Promise.all([
        getMappedPrivatePlanIds(locIds),
        getMappedNhsPlanIds(locIds),
      ]);
      const weekly = emptyWeeks();
      const patientsPerWeek: Array<Set<string>> = Array.from({ length: FORECAST_WEEKS }, () => new Set<string>());
      const windowStartMs = windowStart.getTime();
      const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
      const upperExclusive = toDateOnly(addDays(windowEnd, 1));
      const PAGE = 1000;
      let from = 0;
      while (true) {
        let q = (supabase as any)
          .from('dentally_payments')
          .select('dp_amount, dp_dated_on, dp_patient_id')
          .eq('organization_id', organizationId)
          .eq('dp_deleted', false)
          .not('dp_dated_on', 'is', null)
          .gte('dp_dated_on', toDateOnly(windowStart))
          .lt('dp_dated_on', upperExclusive);
        if (locIds) q = q.in('location_id', locIds);
        if (planIds) q = q.in('dp_payment_plan_id', planIds);
        else if (nhsPlanIds.length) q = q.not('dp_payment_plan_id', 'in', `(${nhsPlanIds.join(',')})`);
        const { data, error } = await q.range(from, from + PAGE - 1);
        if (error) throw error;
        const rows = (data ?? []) as Array<{ dp_amount: number | string | null; dp_dated_on: string | null; dp_patient_id: number | string | null }>;
        for (const p of rows) {
          const d = (p.dp_dated_on || '').substring(0, 10);
          if (!d) continue;
          const [yy, mm, dd] = d.split('-').map(Number);
          const ms = new Date(yy, (mm || 1) - 1, dd || 1).getTime();
          let idx = Math.floor((ms - windowStartMs) / WEEK_MS);
          if (idx < 0) idx = 0;
          if (idx > FORECAST_WEEKS - 1) idx = FORECAST_WEEKS - 1;
          weekly[idx] += num(p.dp_amount);
          if (p.dp_patient_id != null) patientsPerWeek[idx].add(String(p.dp_patient_id));
        }
        if (rows.length < PAGE) break;
        from += PAGE;
      }
      return { revenue: weekly, patients: patientsPerWeek.map(s => s.size) };
    },
  });

  // ── Private (ACCOUNTING source): when a scoped location's private_income_source
  // = 'accounting', the Private row is sourced from the connected ledger instead of
  // Dentally takings — the weekly sum of the location's private_income_coa_accounts
  // (Chart-of-Account UUIDs) from xero_journal_details, date-exact per Monday-week
  // (no pro-rating). Returns { active, weekly[13] }; active=false when no scoped
  // location uses the accounting source (the Dentally takings path then stands).
  // Xero is wired here (the active platform); other ledgers follow the same shape. ──
  // Generic ledger-actuals reader shared by the Private and NHS income rows. `sourceCol`
  // is the per-location source toggle ('pms'/'accounting'); `coaCol` is the JSONB array
  // of Chart-of-Account UUIDs mapped for that income type. Same date-exact Monday-week
  // bucketing, same "active with zeros rather than silent PMS fallback" contract.
  // `opts.unmappedIsInactive` — when the accounting source is selected but NO accounts
  // are mapped, fall back to the PMS/CSV path instead of reporting £0. Needed for
  // Membership, whose source column DEFAULTS to 'accounting': without this, every
  // location that never configured a mapping would silently drop to £0.
  // `opts.excludeCoaCols` — other income types' CoA mapping columns whose accounts this
  // row must NOT claim. A location can map the same ledger account to two income types
  // (e.g. a Denplan sales account mapped to BOTH Private and Membership); without this
  // the same money is summed on both rows and Weekly Cash Inflow double-counts it.
  // Mirrors the NHS-vs-Private exclusion already applied on the PMS/takings path.
  const fetchIncomeAccountingWeekly = async (
    sourceCol: string,
    coaCol: string,
    start: Date,
    end: Date,
    opts?: { unmappedIsInactive?: boolean; excludeCoaCols?: string[] },
  ): Promise<{ active: boolean; weekly: number[] }> => {
    const emptyWeeks = () => new Array(FORECAST_WEEKS).fill(0) as number[];
    const inactive = { active: false, weekly: emptyWeeks() };
    if (!organizationId) return inactive;
    const locIds = selectedLocationId
      ? [selectedLocationId]
      : regionLocationIds && regionLocationIds.length > 0 ? regionLocationIds : null;
    const excludeCols = (opts?.excludeCoaCols ?? []).filter((c) => c && c !== coaCol);
    const selectCols = ['id', sourceCol, coaCol, ...excludeCols].join(', ');
    let locQ = (supabase as any)
      .from('practice_locations')
      .select(selectCols)
      .eq('organization_id', organizationId).is('deleted_at', null);
    if (locIds) locQ = locQ.in('id', locIds);
    const { data: locs } = await locQ;
    const coaUuids = new Set<string>();
    let anyAccounting = false;
    for (const l of (locs ?? []) as Array<Record<string, unknown>>) {
      if ((((l[sourceCol] as string) || 'pms')) !== 'accounting') continue;
      anyAccounting = true;
      // Accounts THIS SAME location assigns to another income row belong to that row.
      // Scoped per location so one site's mapping can't strip another site's account.
      const ownedByOtherRow = new Set<string>();
      for (const col of excludeCols) {
        const other = Array.isArray(l[col]) ? (l[col] as unknown[]) : [];
        for (const a of other) if (a) ownedByOtherRow.add(String(a));
      }
      const arr = Array.isArray(l[coaCol]) ? (l[coaCol] as unknown[]) : [];
      for (const a of arr) if (a && !ownedByOtherRow.has(String(a))) coaUuids.add(String(a));
    }
    // Not on the accounting source at all → genuinely PMS-sourced (Dentally takings).
    if (!anyAccounting) return inactive;
    // Accounting IS chosen, but NO income accounts are mapped for it. Stay
    // ACTIVE with zeros so the row shows £0 + the "No data" notice — never silently
    // fall back to PMS (that makes Acct look identical to PMS). Map accounts in
    // Location Settings → Income Type Mapping → (Accounting App).
    // Exception: callers whose source column defaults to 'accounting' (Membership) pass
    // unmappedIsInactive so an unconfigured location keeps its PMS/CSV figures.
    if (coaUuids.size === 0) return opts?.unmappedIsInactive ? inactive : { active: true, weekly: emptyWeeks() };

    // Resolve CoA UUIDs → Xero account GUIDs (xero_journal_details.account_id).
    const { data: coaRows } = await (supabase as any)
      .from('xero_chart_of_accounts')
      .select('id, xero_account_id')
      .eq('organization_id', organizationId)
      .in('id', [...coaUuids]);
    const xeroIds = new Set<string>();
    for (const c of (coaRows ?? []) as Array<{ id: string; xero_account_id: string | null }>) {
      if (c.xero_account_id) xeroIds.add(c.xero_account_id);
    }
    // Accounting source IS set but the accounts don't resolve to Xero (non-Xero
    // ledger / unmapped) — stay active with zeros rather than silently reverting.
    if (xeroIds.size === 0) return { active: true, weekly: emptyWeeks() };

    const weekly = emptyWeeks();
    const startMs = start.getTime();
    const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    const upperExclusive = toDateOnly(addDays(end, 1));
    const xeroIdArr = [...xeroIds];
    const PAGE = 1000;
    let from = 0;
    // NOTE: no tenant filter. A Xero account_id (GUID) is unique to its tenant, so the
    // mapped accounts already pin the right org. Do NOT filter by
    // platform_integration_organization_id here: useLocationAccountingScope.tenantOrgIds
    // is the EXTERNAL Xero org id (platform_org_id), not the INTERNAL
    // platform_integration_organization_id stored on xero_journal_details — comparing
    // them excludes every row (the bug that returned £0 with a mapping present).
    type JdRow = { net_amount: number | string | null; journal_date: string | null; source_id: string | null };
    const allRows: JdRow[] = [];
    while (true) {
      const q = (supabase as any)
        .from('xero_journal_details')
        .select('account_id, net_amount, journal_date, source_id')
        .eq('organization_id', organizationId)
        .in('account_id', xeroIdArr)
        .gte('journal_date', toDateOnly(start))
        .lt('journal_date', upperExclusive);
      const { data, error } = await q.range(from, from + PAGE - 1);
      if (error) break;
      const rows = (data ?? []) as JdRow[];
      allRows.push(...rows);
      if (rows.length < PAGE) break;
      from += PAGE;
    }

    // ── DO NOT filter on "the journal nets to zero" ──────────────────────────────
    // That was tried on 2026-07-20 and is WRONG: EVERY double-entry journal nets to
    // zero, so the test excluded real income. It threw away the practice's monthly
    // private fees journal (Dr Accounts Receivable £34,515.25 / Cr Private Fees - Magor
    // £19,809.75 / Cr Private Fees - Caldicot £14,705.50, net £0.00) — a genuine £14.7k
    // of Caldicot income — while trying to suppress a year-end reclassification.
    // If reclassification journals need excluding, the discriminator must be that the
    // journal has NO Accounts Receivable / Bank leg (a purely internal move between
    // nominal codes), NOT that it balances.
    for (const r of allRows) {
      const d = (r.journal_date || '').substring(0, 10);
      if (!d) continue;
      const [yy, mm, dd] = d.split('-').map(Number);
      const ms = new Date(yy, (mm || 1) - 1, dd || 1).getTime();
      let idx = Math.floor((ms - startMs) / WEEK_MS);
      if (idx < 0) idx = 0;
      if (idx > FORECAST_WEEKS - 1) idx = FORECAST_WEEKS - 1;
      weekly[idx] += num(r.net_amount);
    }
    // Xero revenue NetAmount is credit-positive/debit-negative; abs each week so the
    // income reads positive (refunds within a week still net correctly first).
    return { active: true, weekly: weekly.map((v) => Math.abs(v)) };
  };

  // Private is the CATCH-ALL income row, so it must give up any account that NHS or
  // Membership already claims — otherwise a ledger account mapped to two income types
  // (seen live: one Denplan account on both Private and Membership) is summed on both
  // rows and Weekly Cash Inflow double-counts it.
  const fetchPrivateAccountingWeekly = (start: Date, end: Date) =>
    fetchIncomeAccountingWeekly('private_income_source', 'private_income_coa_accounts', start, end, {
      excludeCoaCols: ['membership_income_coa_accounts', 'nhs_income_coa_accounts'],
    });
  // NHS row can likewise be sourced from the connected ledger (nhs_income_coa_accounts)
  // when the location's nhs_income_source = 'accounting'. This surfaces the REAL NHS
  // receipts as the actual/variance series instead of the flat contract ÷ 12 estimate.
  const fetchNhsAccountingWeekly = (start: Date, end: Date) =>
    fetchIncomeAccountingWeekly('nhs_income_source', 'nhs_income_coa_accounts', start, end);
  // Membership ACTUALS follow the same Income Type Mapping toggle: 'accounting' →
  // the mapped ledger accounts (e.g. "201 Sales - Denplan"); 'pms' (or accounting with
  // nothing mapped) → the Denplan CSV upload, which also always drives the FORECAST.
  const fetchMembershipAccountingWeekly = (start: Date, end: Date) =>
    fetchIncomeAccountingWeekly('membership_income_source', 'membership_income_coa_accounts', start, end, {
      unmappedIsInactive: true,
    });

  const privateAccountingQuery = useQuery({
    queryKey: [
      'cashflow-forecast-private-accounting',
      organizationId,
      selectedLocationId ?? 'all',
      regionLocationIds ? regionLocationIds.slice().sort().join(',') : 'none',
      (coaLocationScope.tenantOrgIds ?? []).slice().sort().join(','),
      toDateOnly(trailingStart),
      toDateOnly(trailingEnd),
    ],
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000,
    queryFn: () => fetchPrivateAccountingWeekly(trailingStart, trailingEnd),
  });

  const currentPrivateAccountingQuery = useQuery({
    queryKey: [
      'cashflow-forecast-private-accounting-current',
      organizationId,
      selectedLocationId ?? 'all',
      regionLocationIds ? regionLocationIds.slice().sort().join(',') : 'none',
      (coaLocationScope.tenantOrgIds ?? []).slice().sort().join(','),
      weeks[0]?.iso ?? '',
      weeks[weeks.length - 1]?.iso ?? '',
    ],
    enabled: includeCurrentWindow && !!organizationId && weeks.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: () => fetchPrivateAccountingWeekly(weeks[0].weekStart, addDays(weeks[weeks.length - 1].weekStart, 6)),
  });

  const nhsAccountingQuery = useQuery({
    queryKey: [
      'cashflow-forecast-nhs-accounting',
      organizationId,
      selectedLocationId ?? 'all',
      regionLocationIds ? regionLocationIds.slice().sort().join(',') : 'none',
      (coaLocationScope.tenantOrgIds ?? []).slice().sort().join(','),
      toDateOnly(trailingStart),
      toDateOnly(trailingEnd),
    ],
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000,
    queryFn: () => fetchNhsAccountingWeekly(trailingStart, trailingEnd),
  });

  const currentNhsAccountingQuery = useQuery({
    queryKey: [
      'cashflow-forecast-nhs-accounting-current',
      organizationId,
      selectedLocationId ?? 'all',
      regionLocationIds ? regionLocationIds.slice().sort().join(',') : 'none',
      (coaLocationScope.tenantOrgIds ?? []).slice().sort().join(','),
      weeks[0]?.iso ?? '',
      weeks[weeks.length - 1]?.iso ?? '',
    ],
    enabled: includeCurrentWindow && !!organizationId && weeks.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: () => fetchNhsAccountingWeekly(weeks[0].weekStart, addDays(weeks[weeks.length - 1].weekStart, 6)),
  });

  const membershipAccountingQuery = useQuery({
    queryKey: [
      'cashflow-forecast-membership-accounting',
      organizationId,
      selectedLocationId ?? 'all',
      regionLocationIds ? regionLocationIds.slice().sort().join(',') : 'none',
      (coaLocationScope.tenantOrgIds ?? []).slice().sort().join(','),
      toDateOnly(trailingStart),
      toDateOnly(trailingEnd),
    ],
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000,
    queryFn: () => fetchMembershipAccountingWeekly(trailingStart, trailingEnd),
  });

  const currentMembershipAccountingQuery = useQuery({
    queryKey: [
      'cashflow-forecast-membership-accounting-current',
      organizationId,
      selectedLocationId ?? 'all',
      regionLocationIds ? regionLocationIds.slice().sort().join(',') : 'none',
      (coaLocationScope.tenantOrgIds ?? []).slice().sort().join(','),
      weeks[0]?.iso ?? '',
      weeks[weeks.length - 1]?.iso ?? '',
    ],
    enabled: includeCurrentWindow && !!organizationId && weeks.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: () => fetchMembershipAccountingWeekly(weeks[0].weekStart, addDays(weeks[weeks.length - 1].weekStart, 6)),
  });


  // ── Private row data SOURCE (per selected location, read-only) ──
  // 'pms' = Dentally takings; 'accounting' = connected ledger (private_income_coa_accounts).
  // Decided centrally now via Revenue Settings (Settings → Setup Categories), which
  // cascades into practice_locations.private_income_source — this just reads it so the
  // Private row sources from whichever the org's policy currently says.
  const privateSourceQuery = useQuery({
    queryKey: ['cashflow-forecast-private-source', organizationId, selectedLocationId ?? 'all'],
    enabled: !!organizationId && !!selectedLocationId,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<'pms' | 'accounting'> => {
      if (!selectedLocationId) return 'pms';
      const { data } = await (supabase as any)
        .from('practice_locations').select('private_income_source').eq('id', selectedLocationId).single();
      return ((data as any)?.private_income_source === 'accounting') ? 'accounting' : 'pms';
    },
  });

  // ── Membership (DenPlan) baseline: from the UPLOADED membership data
  // (membership_upload_members) — the exact source the Membership Performance
  // page displays. Scoped by location, grouped by treating dentist.
  //
  // net_due is ALREADY a monthly figure, so we use the LATEST uploaded month
  // only — NOT a sum across every uploaded month. (When several months are
  // uploaded, summing them inflates each clinician ~N×; e.g. 12 months of a
  // ~£31k base shows as ~£375k.) Members are de-duplicated within that month
  // (a family shares a pay_grp_id but each member is a separate row), mirroring
  // the Membership Performance page. A location with no uploaded data correctly
  // shows no membership rows. ──
  const membershipQuery = useQuery({
    queryKey: [
      'cashflow-forecast-membership',
      organizationId,
      selectedLocationId ?? 'all',
      regionLocationIds ? regionLocationIds.slice().sort().join(',') : 'none',
    ],
    enabled: !!organizationId,
    queryFn: async (): Promise<MembershipHistory> => {
      const empty: MembershipHistory = { latestYm: 0, dentists: [] };
      if (!organizationId) return empty;
      const PAGE = 1000;
      type MRow = {
        treating_dentist: string | null; net_due: number | string | null;
        upload_month: number | null; upload_year: number | null;
        patient_id: string | null; pay_grp_id: string | null;
        surname: string | null; initial: string | null; dob: string | null;
      };
      const allRows: MRow[] = [];
      let from = 0;
      while (true) {
        let q = (supabase as any)
          .from('membership_upload_members')
          .select('treating_dentist, net_due, upload_month, upload_year, patient_id, pay_grp_id, surname, initial, dob, location_id')
          .eq('organization_id', organizationId)
          .is('deleted_at', null);
        // Scope by the PATIENT's own registered location (location_id), resolved
        // per-patient during the upload's location separation — NOT the whole-file
        // upload_location_id. A treating dentist works across multiple locations,
        // so membership revenue must follow each patient's location. This mirrors
        // the Membership Performance page (useMembershipUploadData), which filters
        // and groups by location_id.
        if (selectedLocationId) {
          q = q.eq('location_id', selectedLocationId);
        } else if (regionLocationIds && regionLocationIds.length > 0) {
          q = q.in('location_id', regionLocationIds);
        }
        const { data, error } = await q.range(from, from + PAGE - 1);
        if (error) throw error;
        const rows = (data ?? []) as MRow[];
        allRows.push(...rows);
        if (rows.length < PAGE) break;
        from += PAGE;
      }
      if (allRows.length === 0) return empty;

      const ym = (r: MRow) => (Number(r.upload_year) || 0) * 12 + (Number(r.upload_month) || 0);
      const memberKey = (r: MRow) => r.patient_id
        ? `pid:${r.patient_id}`
        : `k:${r.pay_grp_id ?? ''}|${(r.surname ?? '').toLowerCase()}|${(r.initial ?? '').toLowerCase()}|${r.dob ?? ''}`;

      // Build, per uploaded month, the de-duplicated set of members + revenue for
      // each treating dentist. Within-month dedupe mirrors the Membership page.
      // byMonth: ym → dentist → { keys, revenue }
      const byMonth = new Map<number, Map<string, { keys: Set<string>; revenue: number }>>();
      const monthsSet = new Set<number>();
      const seenByMonth = new Map<number, Set<string>>();
      for (const r of allRows) {
        const m = ym(r);
        monthsSet.add(m);
        let seen = seenByMonth.get(m);
        if (!seen) { seen = new Set(); seenByMonth.set(m, seen); }
        const key = memberKey(r);
        if (seen.has(key)) continue; // one row per member per month
        seen.add(key);
        const dentist = (r.treating_dentist || '').trim() || 'Unassigned';
        let perDentist = byMonth.get(m);
        if (!perDentist) { perDentist = new Map(); byMonth.set(m, perDentist); }
        let bucket = perDentist.get(dentist);
        if (!bucket) { bucket = { keys: new Set(), revenue: 0 }; perDentist.set(dentist, bucket); }
        bucket.keys.add(key);
        bucket.revenue += num(r.net_due);
      }

      const months = [...monthsSet].sort((a, b) => a - b);
      const latestYm = months[months.length - 1] ?? 0;
      const dentistNames = new Set<string>();
      for (const perDentist of byMonth.values()) for (const d of perDentist.keys()) dentistNames.add(d);

      // For each dentist, derive observed monthly dynamics from the upload history:
      // average churn (leavers ÷ prior members) and average joiners over the most
      // recent month-pairs. These DRIVE the forward projection.
      const PAIR_WINDOW = 6; // look back at most ~6 month-transitions
      const dentists: MembershipDentistStats[] = [];
      for (const dentist of dentistNames) {
        const latestBucket = byMonth.get(latestYm)?.get(dentist);
        const latestMembers = latestBucket?.keys.size ?? 0;
        const latestRevenue = latestBucket?.revenue ?? 0;
        if (latestMembers === 0 && latestRevenue === 0) continue; // gone at latest month

        const pairMonths = months.slice(-(PAIR_WINDOW + 1)); // need N+1 months for N pairs
        let churnSum = 0, joinSum = 0, leaveSum = 0, pairs = 0;
        // Per-month add/remove activity (the real numbers behind the averages),
        // captured so it can be sent to Claude and shown in the tooltip.
        const activity: MembershipMonthlyActivity[] = [];
        for (let i = 1; i < pairMonths.length; i++) {
          const prev = byMonth.get(pairMonths[i - 1])?.get(dentist)?.keys;
          const curBucket = byMonth.get(pairMonths[i])?.get(dentist);
          const cur = curBucket?.keys;
          if (!prev || prev.size === 0) continue;
          let leavers = 0; for (const k of prev) if (!cur || !cur.has(k)) leavers++;
          let joiners = 0; if (cur) for (const k of cur) if (!prev.has(k)) joiners++;
          churnSum += leavers / prev.size;
          joinSum += joiners;
          leaveSum += leavers;
          pairs++;
          activity.push({
            ym: pairMonths[i],
            members: cur?.size ?? 0,
            joiners,
            leavers,
            revenue: curBucket?.revenue ?? 0,
          });
        }
        const monthlyRevenue: Record<number, number> = {};
        for (const m of months) {
          const b = byMonth.get(m)?.get(dentist);
          if (b) monthlyRevenue[m] = b.revenue;
        }
        dentists.push({
          dentist,
          latestMembers,
          latestRevenue,
          avgRevenuePerMember: latestMembers > 0 ? latestRevenue / latestMembers : 0,
          monthlyChurn: pairs > 0 ? churnSum / pairs : 0,
          monthlyJoiners: pairs > 0 ? joinSum / pairs : 0,
          avgMonthlyLeavers: pairs > 0 ? leaveSum / pairs : 0,
          monthsObserved: pairs,
          activity,
          hasHistory: pairs > 0,
          monthlyRevenue,
        });
      }
      dentists.sort((a, b) => b.latestRevenue - a.latestRevenue);
      return { latestYm, dentists };
    },
  });

  // ── NHS baseline: from the per-location UDA goal settings (Providers module →
  // UDA Goals → UDA Settings). NHS GDS contracts pay 1/12 of the annual contract
  // value each month, so monthly NHS = the location's nhs_contract_value ÷ 12.
  // `uda_settings` is now stored per location (location_id); the query sums the
  // contract value for the scoped location(s): a specific location → its own row;
  // region → its locations; all-locations → every per-location row (falling back
  // to the legacy org-level NULL-location row when no per-location rows exist). ──
  const udaSettingsQuery = useQuery({
    queryKey: [
      'cashflow-forecast-uda',
      organizationId,
      anchorMonday.getFullYear(),
      selectedLocationId ?? 'all',
      regionLocationIds ? regionLocationIds.slice().sort().join(',') : 'none',
    ],
    enabled: !!organizationId,
    queryFn: async (): Promise<number> => {
      if (!organizationId) return 0;

      const { data, error } = await (supabase as any)
        .from('uda_settings')
        .select('nhs_contract_value, financial_year, location_id')
        .eq('organization_id', organizationId);
      if (error) throw error;
      const allRows = (data ?? []) as Array<{ nhs_contract_value: number | string | null; financial_year: number; location_id: string | null }>;
      if (allRows.length === 0) return 0;

      // Use the forecast financial year; fall back to the latest configured FY.
      const fy = anchorMonday.getFullYear();
      let rows = allRows.filter(r => r.financial_year === fy);
      if (rows.length === 0) {
        const maxFy = Math.max(...allRows.map(r => r.financial_year));
        rows = allRows.filter(r => r.financial_year === maxFy);
      }

      const scopeIds = selectedLocationId
        ? [selectedLocationId]
        : regionLocationIds && regionLocationIds.length > 0 ? regionLocationIds : null;

      let annual = 0;
      if (scopeIds) {
        // Specific location / region → sum those locations' own contract values.
        annual = rows
          .filter(r => r.location_id && scopeIds.includes(r.location_id))
          .reduce((s, r) => s + num(r.nhs_contract_value), 0);
      } else {
        // All locations → sum per-location rows; if none exist yet, fall back to
        // the legacy org-level (NULL location) row.
        const locRows = rows.filter(r => r.location_id);
        annual = (locRows.length > 0 ? locRows : rows.filter(r => !r.location_id))
          .reduce((s, r) => s + num(r.nhs_contract_value), 0);
      }
      return annual / 12;
    },
  });

  // ── Saved overrides + custom rows for this scope ──
  const locationScopeKey = selectedLocationId ?? 'all';
  const overridesQuery = useQuery({
    queryKey: ['cashflow-forecast-overrides', organizationId, locationScopeKey, weeks[0]?.iso],
    enabled: !!organizationId,
    queryFn: async (): Promise<OverrideRow[]> => {
      if (!organizationId) return [];
      // Both sections (inflow + outflow) for this scope/window in one query;
      // the memo partitions them by `section`.
      let q = (supabase as any)
        .from('cashflow_forecast_overrides')
        .select('week_start, section, line_key, line_label, amount')
        .eq('organization_id', organizationId)
        .gte('week_start', weeks[0].iso)
        .lte('week_start', weeks[weeks.length - 1].iso);
      q = selectedLocationId ? q.eq('location_id', selectedLocationId) : q.is('location_id', null);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as OverrideRow[];
    },
  });

  // ── Opening-cash fallback ──
  // Opening Cash is a manual override on week 1 (`balance|<week>|start_cash`). When the
  // user hasn't entered one, auto-fill it from the connected accounting software's
  // Statement of Cash Flows CLOSING balance as of the forecast's first week (the same
  // figure the Cashflow Statement footer shows), scoped to the selected location. Only
  // fetched when no manual opening cash is set, so it never overrides a real entry.
  const manualStartCashSet = (overridesQuery.data ?? []).some(
    (o) => o.section === 'balance' && o.line_key === 'start_cash' && o.week_start === weeks[0]?.iso,
  );
  const openingBalanceQuery = useQuery({
    queryKey: ['cashflow-forecast-opening-balance', organizationId, selectedLocationId ?? 'all', weeks[0]?.iso],
    enabled: !!organizationId && weeks.length > 0 && !manualStartCashSet,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<number> => {
      if (!organizationId || weeks.length === 0) return 0;
      try {
        const res = await getStatementReport(organizationId, {
          fromDate: toDateOnly(addDays(weeks[0].weekStart, -210)),
          toDate: weeks[0].iso,
          locationId: selectedLocationId ?? null,
        });
        return Number.isFinite(res.closingBalance) ? res.closingBalance : 0;
      } catch {
        // No accounting connection / statement unavailable → no fallback (stays £0).
        return 0;
      }
    },
  });

  // ── Compute the resolved forecast (baseline merged with overrides) ──
  const forecast = useMemo(() => {
    // NHS = monthly NHS from UDA goal settings, allocated to the location
    // (option B). The query already returns the per-location monthly value.
    const nhsMonthly = udaSettingsQuery.data ?? 0;
    // ── Private DRIVER model: trailing weekly TAKINGS pattern + payer-volume trend ──
    // The trailing 13-week private takings (dentally_payments) are repeated forward,
    // then nudged by the OBSERVED payer-volume momentum (distinct private payers/week,
    // first half vs second half of the trailing window). Growth is clamped to ±2%/week
    // so it stays grounded; the AI then refines around this. avg takings/payer
    // is held implicitly constant (volume drives the change).
    const privateData = privateQuery.data ?? { revenue: weeks.map(() => 0), patients: weeks.map(() => 0) };
    // When the location's private_income_source = 'accounting', the Private row is
    // driven by the connected ledger (private_income_coa_accounts) instead of
    // Dentally takings. `privateUsingAccounting` swaps the trailing series; the rest
    // of the trend/forecast machinery is source-agnostic.
    const privateUsingAccounting = privateAccountingQuery.data?.active ?? false;
    const privateTrailing = privateUsingAccounting
      ? (privateAccountingQuery.data?.weekly ?? privateData.revenue)
      : privateData.revenue;
    const privatePatients = privateData.patients;
    // When the location's nhs_income_source = 'accounting', the NHS actual/variance
    // series is sourced from the connected ledger (nhs_income_coa_accounts) instead of
    // the flat contract ÷ 12 estimate. `nhsAccountingTrailing` holds that weekly series.
    const nhsUsingAccounting = nhsAccountingQuery.data?.active ?? false;
    const nhsAccountingTrailing = nhsAccountingQuery.data?.weekly ?? [];
    const nhsAccountingCurrent = (includeCurrentWindow ? currentNhsAccountingQuery.data?.weekly : undefined) ?? [];
    // ── Private REVENUE trend over the trailing 13 weeks ──
    // Earlier each forecast week just repeated the "matching week 13 weeks ago",
    // which swung with whatever happened to land in that single historic week.
    // Instead we fit the TREND of the whole 13-week revenue series:
    //   • LEVEL  = the period's average private revenue per week (smooth, robust).
    //   • GROWTH = observed revenue momentum (first-half vs second-half average),
    //              as a per-week rate clamped to ±2%/week so it stays grounded.
    // The base for forecast week i is LEVEL grown by GROWTH; the upcoming-appointments
    // add-on is layered on top below, and the AI overlay can refine around it.
    // Trend cap (± per-week drift) comes from the per-location forecast settings.
    // This is the 'auto' income method: average level grown by the trailing
    // momentum, clamped to the cap. Other methods (average/repeat/manual) replace
    // this baseline wholesale via the projection-method layer below.
    const trendCap = forecastSettings.trendCapWeeklyPct / 100;

    // ── Cost inflation ── a FLAT % uplift (forecast settings) applied to the £ value
    // of every PROJECTED cost cell — the SAME multiplier for all weeks, NOT compounded
    // by week number. e.g. 3% → every projected cost ×1.03. Known unpaid bills (cash
    // facts) and appointment-driven calibrated rows are not inflated. The week index is
    // accepted but ignored so all existing call sites stay unchanged.
    const costInflFlat = 1 + forecastSettings.costInflationWeeklyPct / 100;
    const inflateCostWeek = (_i: number): number => costInflFlat;

    // ── Projection-method layer ── A line's effective method is its per-line
    // override (methodMap) if set, else the global family default from settings:
    //   • Private income line          → incomeMethod
    //   • operating cost lines (outflow)→ costMethod
    //   • everything else (NHS, membership, lower blocks) → 'auto' unless overridden.
    // 'auto' keeps the engine's own baseline (returns null here). The other methods
    // rebuild the line from its trailing series, replacing the baseline below rules.
    const monthlyToWeeklyRate = (pct: number): number => Math.pow(1 + pct / 100, 1 / 4.345) - 1;
    const lineMethodFor = (key: string, section: ForecastSection): LineMethodConfig => {
      const perLine = methodMap.get(key);
      if (perLine) return perLine;
      if (key === 'private') return { method: forecastSettings.incomeMethod, growthPct: forecastSettings.incomeManualGrowthMonthlyPct };
      if (section === 'outflow') return { method: forecastSettings.costMethod, growthPct: forecastSettings.costManualGrowthMonthlyPct };
      // Per-section default for the four lower blocks (Investing/Financing/Tax/Inter-Company).
      const sm = forecastSettings.sectionMethods;
      if (section.startsWith('inv-')) return sm.investing;
      if (section.startsWith('fin-')) return sm.financing;
      if (section.startsWith('tax-')) return sm.tax;
      if (section.startsWith('ic-')) return sm.intercompany;
      return { method: 'auto' };
    };
    // Build a method's 13-week series from a trailing series. Returns null when the
    // method is 'auto' (caller keeps its own, smarter baseline). `isCost` applies
    // cost inflation to the flat/repeat shapes (not to manual — the user owns that).
    const projectByMethod = (cfg: LineMethodConfig, trailing: number[], isCost: boolean): number[] | null => {
      const method: ForecastMethod = cfg.method;
      if (method === 'auto') return null;
      const series = Array.isArray(trailing) ? trailing : [];
      const total = series.reduce((s, x) => s + (x || 0), 0);
      const avg = total / Math.max(1, weeks.length);
      const usableWeekly = series.length === weeks.length && total > 0;
      if (method === 'manual') {
        if (cfg.fixed != null && Number.isFinite(cfg.fixed)) return weeks.map(() => Math.max(0, cfg.fixed as number));
        const g = monthlyToWeeklyRate(cfg.growthPct ?? 0);
        return weeks.map((_w, i) => Math.max(0, avg * Math.pow(1 + g, i + 1)));
      }
      let shape: number[];
      if (method === 'repeat') shape = usableWeekly ? weeks.map((_w, i) => Math.max(0, series[i] ?? 0)) : weeks.map(() => Math.max(0, avg));
      else /* average */ shape = weeks.map(() => Math.max(0, avg));
      return isCost ? shape.map((v, i) => v * inflateCostWeek(i)) : shape;
    };
    // The chosen methods apply ONLY to the selected forecast weeks; weeks not selected
    // fall back to the Smart/auto baseline. All weeks selected = method everywhere.
    const methodWeekSet = new Set(forecastSettings.methodWeeks);
    const methodWeekScoped = methodWeekSet.size < weeks.length;
    // Resolve a line's baseline through its method: 'auto' keeps `autoBaseline`,
    // any explicit method rebuilds from `trailing`. Used at every projectable line.
    const applyMethod = (key: string, section: ForecastSection, autoBaseline: number[], trailing: number[]): number[] => {
      const projected = projectByMethod(lineMethodFor(key, section), trailing, section === 'outflow');
      if (!projected) return autoBaseline; // 'auto' line → default everywhere
      if (!methodWeekScoped) return projected; // all weeks selected → method everywhere
      // Blend: method value in the selected weeks, Smart baseline in the rest.
      return weeks.map((_w, i) => (methodWeekSet.has(i + 1) ? (projected[i] ?? 0) : (autoBaseline[i] ?? 0)));
    };

    const privateRevenueGrowth = (() => {
      const rev = privateTrailing;
      const n = rev.length;
      if (n < 4) return 0;
      const half = Math.floor(n / 2);
      const firstAvg = rev.slice(0, half).reduce((a, b) => a + (b || 0), 0) / half;
      const secondAvg = rev.slice(n - half).reduce((a, b) => a + (b || 0), 0) / half;
      if (firstAvg <= 0) return 0;                 // no revenue signal → flat
      const span = n - half;                       // ~6–7 weeks between half-centres
      return Math.max(-trendCap, Math.min(trendCap, ((secondAvg - firstAvg) / firstAvg) / span));
    })();
    const privateAvgWeekly = privateTrailing.reduce((a, b) => a + (b || 0), 0) / Math.max(1, weeks.length);
    const privateWeekly = weeks.map((_, i) => Math.round(privateAvgWeekly * Math.pow(1 + privateRevenueGrowth, i + 1)));

    // ── Membership DRIVER model: observed churn + joiners per clinician ──
    // Instead of a flat 5% churn guess, each clinician's monthly members roll
    // forward by their OWN observed monthly churn (leavers ÷ members) and joiners,
    // derived from diffing the uploaded months. Monthly revenue = projected
    // members × avg revenue per member. The AI then refines each monthly lump.
    const membershipHistory = membershipQuery.data ?? { latestYm: 0, dentists: [] };
    const membershipProviders = membershipHistory.dentists.map(d => ({ id: d.dentist, name: d.dentist, stats: d }));

    // Place a monthly lump into one payment-week of each month, 0 elsewhere.
    const lumpSeries = (monthlyAmount: number, placement: Set<number>): number[] =>
      weeks.map(w => (placement.has(w.index) ? monthlyAmount : 0));

    const MS_DAY = 24 * 60 * 60 * 1000;
    // Project a clinician's monthly net revenue `monthsAhead` months past the
    // latest upload, via members[k] = members[k-1]×(1−churn) + joiners. Falls
    // back to the UI churn control when there's no observed history yet.
    // Optional monthly member growth (Forecast Settings → Denplan). Default 0 = off, so
    // the base projection (churn + observed joiners) is unchanged unless enabled.
    const memberGrowth = (forecastSettings.module.denplan.monthlyMemberGrowthPct || 0) / 100;
    const projectMonthlyRevenue = (stats: MembershipDentistStats, monthsAhead: number): number => {
      if (stats.avgRevenuePerMember <= 0) return stats.latestRevenue;
      const churn = stats.hasHistory ? stats.monthlyChurn : churnRate / 12;
      const joiners = stats.hasHistory ? stats.monthlyJoiners : 0;
      let members = stats.latestMembers;
      for (let k = 0; k < Math.max(0, monthsAhead); k++) {
        members = members * (1 - churn) + joiners;
        if (memberGrowth) members *= (1 + memberGrowth);
      }
      return Math.max(0, members) * stats.avgRevenuePerMember;
    };
    // Is this week the one the Denplan lump lands in? It lands on the pay day, pushed
    // later by the optional settlement delay (Forecast Settings → Invoice timing; default
    // 0 = lands on the pay day, so nothing shifts unless enabled).
    const settlementDelayDays = forecastSettings.module.income.settlementDelayDays || 0;
    const isPayWeek = (w: ForecastWeek): boolean => {
      const payDate = new Date(w.weekStart.getFullYear(), w.weekStart.getMonth(), forecastSettings.membershipPayDay);
      if (settlementDelayDays) payDate.setDate(payDate.getDate() + settlementDelayDays);
      const weekEnd = new Date(w.weekStart.getTime() + 6 * MS_DAY);
      return !(payDate < w.weekStart || payDate > weekEnd);
    };
    const monthsAheadFor = (w: ForecastWeek): number => {
      const wYm = w.weekStart.getFullYear() * 12 + (w.weekStart.getMonth() + 1);
      return membershipHistory.latestYm > 0 ? Math.max(0, wYm - membershipHistory.latestYm) : 0;
    };
    // Membership series — the projected monthly revenue lands in the week that
    // contains the Denplan pay day; £0 in every other week.
    const membershipSeries = (stats: MembershipDentistStats): number[] =>
      weeks.map(w => (isPayWeek(w) ? projectMonthlyRevenue(stats, monthsAheadFor(w)) : 0));

    // Per-cell worked breakdown that mirrors the series above, so the tooltip can
    // show the real numbers behind each projected membership lump.
    const membershipCalcSeries = (stats: MembershipDentistStats): (MembershipCalc | undefined)[] =>
      weeks.map(w => {
        if (!isPayWeek(w)) return undefined;
        const monthsAhead = monthsAheadFor(w);
        const baseAmount = projectMonthlyRevenue(stats, monthsAhead);
        const prevMonthRevenue = monthsAhead <= 0
          ? stats.latestRevenue
          : projectMonthlyRevenue(stats, monthsAhead - 1);
        const churn = stats.hasHistory ? stats.monthlyChurn : churnRate / 12;
        const joiners = stats.hasHistory ? stats.monthlyJoiners : 0;
        const leavers = stats.hasHistory ? stats.avgMonthlyLeavers : 0;
        const members = stats.avgRevenuePerMember > 0
          ? baseAmount / stats.avgRevenuePerMember
          : stats.latestMembers;
        return {
          prevMonthRevenue,
          members,
          avgRevenuePerMember: stats.avgRevenuePerMember,
          churnPct: churn * 100,
          joiners,
          leavers,
          monthsAhead,
          baseAmount,
          observed: stats.hasHistory,
        };
      });

    // Override lookup: `${section}|${iso}|${line_key}` -> amount. Custom rows are
    // discovered here, kept per-section. Notes (section 'note') carry text in
    // line_label, not amount, so they are read separately below.
    const ovrMap = new Map<string, number>();
    // Auto / Repeating rules per row (line_key → parsed config). Stored as a
    // single row per scope (section 'rule', JSON in line_label) and applied to
    // the row's baseline below; per-cell numeric overrides still win.
    const ruleMap = new Map<string, ForecastRule>();
    // Per-line projection-method OVERRIDES (section 'method', JSON in line_label).
    // line_key → {method, growthPct?, fixed?}. Overrides the global family default
    // from forecastSettings for that one line; sits below rules in precedence.
    const methodMap = new Map<string, LineMethodConfig>();
    // Per-cell comments (section 'comment', text in line_label), keyed `${lineKey}|${weekIso}`.
    const commentMap = new Map<string, string>();
    const customMeta = new Map<string, Map<string, string>>();
    const customFor = (section: string): Map<string, string> => {
      let m = customMeta.get(section);
      if (!m) { m = new Map(); customMeta.set(section, m); }
      return m;
    };
    for (const o of overridesQuery.data ?? []) {
      const section = String(o.section || 'inflow');
      if (section === 'note') continue; // handled via line_label, not amount
      if (section === 'rule') {
        // Config lives in line_label as JSON; amount is unused.
        try { const cfg = JSON.parse(String(o.line_label ?? '')); if (cfg && cfg.type) ruleMap.set(o.line_key, cfg as ForecastRule); } catch { /* ignore malformed */ }
        continue;
      }
      if (section === 'method') {
        // Per-line projection method; config JSON in line_label, amount unused.
        try {
          const cfg = JSON.parse(String(o.line_label ?? ''));
          if (cfg && cfg.method && cfg.method !== 'auto') methodMap.set(o.line_key, resolveLineMethod(cfg));
          else if (cfg && cfg.method === 'auto') methodMap.set(o.line_key, { method: 'auto' });
        } catch { /* ignore malformed */ }
        continue;
      }
      if (section === 'comment') {
        if (o.line_label) commentMap.set(`${o.line_key}|${o.week_start}`, String(o.line_label));
        continue;
      }
      if (section === 'bill') continue; // Bills-to-Pay settings, not a forecast cell
      ovrMap.set(`${section}|${o.week_start}|${o.line_key}`, num(o.amount));
      if (o.line_key.startsWith('custom:')) {
        const isOutflowish = section.endsWith('out') || section === 'outflow';
        customFor(section).set(
          o.line_key,
          o.line_label || (isOutflowish ? 'Other expense' : 'One-off receipt'),
        );
      }
    }

    // ── Auto / Repeating rule → 13-week series ──
    // Auto repeats a trailing MONTHLY figure (previous month's total or the last
    // 3 months' average) once per month on a chosen day; Repeating drops a
    // (optionally escalating) amount into each week a payment lands in.
    // Bucket a trailing weekly series (index i ↔ trailingWeeks[i]) into calendar
    // months, oldest → newest.
    const monthlyTotals = (series: number[]): number[] => {
      const m = new Map<number, number>();
      trailingWeeks.forEach((w, i) => {
        const ym = w.weekStart.getFullYear() * 12 + w.weekStart.getMonth();
        m.set(ym, (m.get(ym) ?? 0) + (series[i] ?? 0));
      });
      return [...m.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]);
    };
    const autoMonthlyFigure = (src: number[], basis: ForecastRule['basis']): number => {
      const months = monthlyTotals(src);
      if (!months.length) return 0;
      if (basis === 'avg_3m') {
        const last3 = months.slice(-3);
        return last3.reduce((a, b) => a + b, 0) / last3.length;
      }
      return months[months.length - 1]; // prev_month
    };
    const ruleSeries = (rule: ForecastRule, baseline: number[], trailing: number[]): number[] => {
      // Linked rows are resolved on the page (they depend on other rows), so the
      // hook keeps their baseline at 0 here.
      if (rule.type === 'linked') return weeks.map(() => 0);
      if (rule.type === 'auto') {
        const src = trailing.length ? trailing : baseline;
        // Basis figure + the user's optional add-on amount.
        const monthly = Math.round(autoMonthlyFigure(src, rule.basis) + (Number(rule.addon) || 0));
        const day = Math.min(28, Math.max(1, rule.day ?? 1));
        // Place the monthly amount in the week containing day-N of each month.
        return weeks.map((w) => {
          for (let d = 0; d < 7; d++) {
            if (new Date(w.weekStart.getTime() + d * MS_DAY).getDate() === day) return monthly;
          }
          return 0;
        });
      }
      // Repeating: generate occurrence dates from the start, stepping by interval,
      // and bucket each into its Monday-week (amount can escalate per occurrence).
      const series = weeks.map(() => 0);
      const amount = Number(rule.amount) || 0;
      if (!amount || !rule.start) return series;
      const start = new Date(`${rule.start}T00:00:00`);
      const endsAt = rule.ends ? new Date(`${rule.ends}T23:59:59`) : null;
      const horizonEnd = new Date(weeks[weeks.length - 1].weekStart.getTime() + 6 * MS_DAY);
      // The amount at occurrence n, after the per-occurrence step (£ or %).
      const step = Number(rule.stepValue) || 0;
      const amountAt = (n: number): number => {
        switch (rule.stepKind) {
          case 'inc_pct': return amount * Math.pow(1 + step / 100, n);
          case 'dec_pct': return amount * Math.pow(1 - step / 100, n);
          case 'inc_amt': return amount + step * n;
          case 'dec_amt': return amount - step * n;
          default: return amount;
        }
      };
      const advance = (d: Date, n: number): Date => {
        const r = new Date(d);
        switch (rule.every) {
          case 'week': r.setDate(r.getDate() + 7 * n); break;
          case '2week': r.setDate(r.getDate() + 14 * n); break;
          case 'month': r.setMonth(r.getMonth() + n); break;
          case '2month': r.setMonth(r.getMonth() + 2 * n); break;
          case '3month': r.setMonth(r.getMonth() + 3 * n); break;
          case '6month': r.setMonth(r.getMonth() + 6 * n); break;
          case 'year': r.setFullYear(r.getFullYear() + n); break;
          default: break; // 'none' → no advance
        }
        return r;
      };
      const maxOcc = rule.every === 'none' ? 1 : 200; // safety cap
      for (let n = 0; n < maxOcc; n++) {
        const occ = advance(start, n);
        if (occ > horizonEnd) break;
        if (endsAt && occ > endsAt) break;
        if (occ >= weeks[0].weekStart) {
          const wi = weeks.findIndex((w) => {
            const wEnd = new Date(w.weekStart.getTime() + 6 * MS_DAY);
            return occ >= w.weekStart && occ <= wEnd;
          });
          if (wi >= 0) series[wi] += Math.max(0, Math.round(amountAt(n)));
        }
        if (rule.every === 'none') break;
      }
      return series;
    };

    // Trailing actuals for the inflow rows that support an Auto basis.
    const nhsTrailing = nhsUsingAccounting
      ? trailingWeeks.map((_, i) => nhsAccountingTrailing[i] ?? 0)
      : trailingWeeks.map(w => (trailingFirstFullWeekIndex.has(w.index) ? nhsMonthly : 0));
    const membershipTrailing = (stats: MembershipDentistStats): number[] =>
      trailingWeeks.map(w => {
        const payDate = new Date(w.weekStart.getFullYear(), w.weekStart.getMonth(), forecastSettings.membershipPayDay);
        const weekEnd = new Date(w.weekStart.getTime() + 6 * MS_DAY);
        if (payDate < w.weekStart || payDate > weekEnd) return 0;
        const wYm = w.weekStart.getFullYear() * 12 + (w.weekStart.getMonth() + 1);
        return stats.monthlyRevenue[wYm] ?? 0;
      });
    const trailingForKey = (key: string): number[] => {
      if (key === 'nhs') return nhsTrailing;
      if (key === 'private') return privateData.revenue;
      if (key.startsWith('membership:')) {
        const mp = membershipProviders.find(m => `membership:${m.id}` === key);
        return mp ? membershipTrailing(mp.stats) : [];
      }
      return [];
    };

    const resolveRow = (
      key: string,
      label: string,
      kind: ForecastRow['kind'],
      section: ForecastSection,
      rawBaseline: number[],
    ): ForecastRow => {
      // An Auto/Repeating rule replaces the computed baseline for this row; a
      // per-cell numeric override still wins over the rule, cell by cell.
      const rule = ruleMap.get(key);
      const baseline = rule
        ? ruleSeries(rule, weeks.map((_, i) => rawBaseline[i] ?? 0), trailingForKey(key))
        : rawBaseline;
      const values: number[] = [];
      const overridden: boolean[] = [];
      weeks.forEach((w, i) => {
        const ov = ovrMap.get(`${section}|${w.iso}|${key}`);
        if (ov !== undefined) {
          values.push(ov);
          overridden.push(true);
        } else {
          values.push(baseline[i] ?? 0);
          overridden.push(false);
        }
      });
      // Keep the pre-override baseline so a tooltip can show "would otherwise be …".
      // A rule-driven row is treated as a fact, so the AI overlay won't overwrite it.
      const fixed = rule ? weeks.map(() => true) : undefined;
      // Preview figures for the Auto panel's two bases (previous month's total and
      // the last 3 months' average), from real trailing actuals where available.
      const trail = trailingForKey(key);
      const previewSrc = trail.length ? trail : weeks.map((_, i) => rawBaseline[i] ?? 0);
      const autoPreview = {
        prevMonth: Math.round(autoMonthlyFigure(previewSrc, 'prev_month')),
        avg3m: Math.round(autoMonthlyFigure(previewSrc, 'avg_3m')),
      };
      return { key, label, kind, section, values, baseline: weeks.map((_, i) => baseline[i] ?? 0), overridden, editable: true, rule, fixed, autoPreview };
    };

    const zero = weeks.map(() => 0);

    // Per-week column sum across a set of rows (used for every subtotal).
    const sumCols = (rows: ForecastRow[]): number[] =>
      weeks.map((_, i) => rows.reduce((s, r) => s + (r.values[i] ?? 0), 0));
    // Custom (user-added) rows for a given section — override-only.
    const customRowsFor = (section: ForecastSection): ForecastRow[] =>
      [...(customMeta.get(section)?.entries() ?? [])]
        .map(([key, label]) => resolveRow(key, label, 'custom', section, zero))
        .sort((a, b) => a.label.localeCompare(b.label));
    // Fixed manual sheet rows for a section — editable, override-only, no baseline.
    const manualRows = (section: ForecastSection, defs: ManualRowDef[]): ForecastRow[] =>
      defs.map(d => resolveRow(d.key, d.label, 'manual', section, zero));

    // ── Appointment-driven clinical lines (Private revenue · Lab Fees · Materials · Consumables) ──
    // VARIABLE clinical economics scale with patient visits, so each such line's real
    // cash LEVEL (from real invoices/income — NOT the unreliable per-treatment
    // lab_bill) is distributed across the forecast weeks by BOOKED appointments:
    //   avg per appointment = real trailing total ÷ trailing booked appointments
    //   week i             = appointments booked that week × that average
    // Fixed/contract lines (NHS, membership, overheads, labour) are never touched.
    const apptProviders = [...apptForecast.nameByExt.entries()].map(([ext, name]) => ({
      ext, name, tokens: name.toLowerCase().split(/[^a-z]+/).filter((t) => t.length >= 3),
    }));
    // The trailing name token on an account label, e.g. "Lab Fees- DAVID" → "david"
    // (cost-type words are stripped so a generic "Consumables" yields no token).
    const accountNameToken = (label: string): string | null => {
      const s = label.toLowerCase()
        .replace(/lab(oratory)?\s*(fees?|bills?)?/g, ' ')
        .replace(/materials?|consumables?|clinical|supplies|waste|sundries|disposables?/g, ' ')
        .replace(/cost\s*of\s*goods\s*sold|\bcogs\b/g, ' ')
        .replace(/costs?|expense|bills?/g, ' ')
        .replace(/[^a-z]+/g, ' ').trim();
      const toks = s.split(' ').filter(Boolean);
      return toks.length ? toks[toks.length - 1] : null;
    };
    // "jen" matches "jennifer" and vice-versa (short forms used in account names).
    const tokenMatches = (a: string, b: string) => a.startsWith(b) || b.startsWith(a);
    type TdResult = { series: number[]; meta: ForecastRow['tdMeta'] };
    // Pick the appointment basis for this row kind:
    //   • 'revenue' (Private)     → ALL booked appointments (patient visits drive income).
    //   • 'lab' / 'mat' (costs)   → ONLY the appointments whose booked treatment
    //     generates that cost — lab-type for Lab Fees, material-relevant clinical for
    //     Materials — so a crown-heavy week carries lab cost and an exam-heavy week
    //     doesn't, instead of every appointment counting equally.
    // When the treatment-type signal is too thin (sparse booking descriptions, so the
    // trailing relevant count is below the floor) it falls back to the all-appointment
    // basis — i.e. the previous behaviour — so the forecast degrades gracefully.
    const TYPE_BASIS_FLOOR = 3;
    const apptBasisFor = (kind: 'lab' | 'mat' | 'revenue', exts: Set<string> | null): { trailing: number; future: number[] } => {
      const allBasis = (): { trailing: number; future: number[] } => {
        const trailKeys = exts ?? new Set(apptForecast.trailingByProvider.keys());
        const futureKeys = exts ?? new Set(apptForecast.futureByProvider.keys());
        let trailing = 0;
        for (const ext of trailKeys) trailing += apptForecast.trailingByProvider.get(ext) ?? 0;
        const future = weeks.map(() => 0);
        for (const ext of futureKeys) { const f = apptForecast.futureByProvider.get(ext); if (f) f.forEach((n, i) => { if (i < future.length) future[i] += n; }); }
        return { trailing, future };
      };
      if (kind === 'revenue') return allBasis();
      const sel: 'lab' | 'mat' = kind === 'lab' ? 'lab' : 'mat';
      const trailKeys = exts ?? new Set(apptForecast.trailingKindByProvider.keys());
      const futureKeys = exts ?? new Set(apptForecast.futureKindByProvider.keys());
      let trailing = 0;
      for (const ext of trailKeys) trailing += apptForecast.trailingKindByProvider.get(ext)?.[sel] ?? 0;
      if (trailing < TYPE_BASIS_FLOOR) return allBasis(); // signal too thin → previous behaviour
      const future = weeks.map(() => 0);
      for (const ext of futureKeys) { const f = apptForecast.futureKindByProvider.get(ext); if (f) f[sel].forEach((n, i) => { if (i < future.length) future[i] += n; }); }
      return { trailing, future };
    };
    // Core distributor: spread `realTotal` across the weeks by the RELEVANT booked-
    // appointment volume of `exts` (practitioner external_ids, or null = everyone).
    const apptSeriesFromTotal = (realTotal: number, exts: Set<string> | null, kind: 'lab' | 'mat' | 'revenue', providerNames: string[]): TdResult | null => {
      if (!APPOINTMENT_DRIVEN_COSTS_ENABLED || !apptForecast.ready || realTotal <= 0) return null;
      const { trailing: trailingAppts, future: futureAppts } = apptBasisFor(kind, exts);
      if (trailingAppts <= 0) return null;
      const avgPerAppt = realTotal / trailingAppts;
      const fallbackWeekly = realTotal / Math.max(1, weeks.length);
      // Week i = relevant booked appointments × avg real £/appointment; a week with
      // nothing booked yet holds at the flat run-rate so it never collapses to £0.
      const series = futureAppts.map((n) => (n > 0 ? n * avgPerAppt : fallbackWeekly));
      return { series, meta: { kind, providers: providerNames, avgPerAppt, trailingAppts, futureAppts, realTotal } };
    };
    // Lab Fees / Materials / clinical-consumable COST rows. `trailing` is the account's
    // own real invoice weekly series; its sum is the level we distribute.
    const appointmentDrivenFor = (label: string, trailing: number[]): TdResult | null => {
      if (!APPOINTMENT_DRIVEN_COSTS_ENABLED || !apptForecast.ready) return null;
      const isLab = /lab(oratory)?\s*fees?/i.test(label);
      const isVar = !isLab && /(materials?|consumables?|clinical\s*(supplies|waste)|cost\s*of\s*goods\s*sold|\bcogs\b|sundries|disposables?)/i.test(label);
      if (!isLab && !isVar) return null;
      const realTotal = trailing.reduce((s, x) => s + (x || 0), 0);
      const token = accountNameToken(label);
      const matched = token ? apptProviders.filter((p) => p.tokens.some((t) => tokenMatches(t, token))) : [];
      if (token && matched.length) {
        return apptSeriesFromTotal(realTotal, new Set(matched.map((m) => m.ext)), isLab ? 'lab' : 'mat', matched.map((m) => m.name));
      }
      // Generic LAB stays invoice-based (avoid double-counting per-name lab rows); a
      // generic Materials/Consumables line uses every practitioner's appointments.
      if (isLab) return null;
      return apptSeriesFromTotal(realTotal, null, 'mat', ['all practitioners']);
    };

    // ── CASH INFLOW ──
    // NHS lands in the first full week of each month (claims paid early the next
    // month) — FIXED contract, never appointment-driven. Membership lands in the
    // Denplan pay-day week, churn-tapered. Private is appointment-driven below.
    // Optional NHS income cap (Forecast Settings → Income): clip the monthly lump so it
    // never projects above the cap. The cap can be set per month or per week (× 4.345).
    // 0 = no cap, so the contract value is used unchanged.
    const nhsCap = forecastSettings.module.income.nhsIncomeCap || 0;
    const nhsCapMonthly = nhsCap > 0
      ? (forecastSettings.module.income.nhsIncomeCapUnit === 'week' ? nhsCap * 4.345 : nhsCap)
      : Infinity;
    const nhsMonthlyForForecast = Math.min(nhsMonthly, nhsCapMonthly);

    // ── Revenue scenario (Forecast Settings → Income logic): Best / Most-likely /
    // Worst case applies a FLAT % uplift to the PROJECTED income cells (base case =
    // null → factor 1 → reconciled figures untouched). Manual cell edits (overridden)
    // and known cash facts (fixed) are preserved — the scenario flexes the forecast,
    // not the facts. Applied to NHS + Denplan + Private inflow rows only, AT CREATION,
    // so the rows the hook returns (and the table renders) already reflect the case.
    const scnFactor = computeScenarioFactor(forecastSettings.scenario);
    const applyScenario = <R extends ForecastRow>(row: R): R => {
      if (scnFactor === 1) return row;
      const scale = (arr: number[]): number[] =>
        arr.map((v, i) => (row.overridden?.[i] || row.fixed?.[i]) ? v : v * scnFactor);
      return { ...row, values: scale(row.values), baseline: scale(row.baseline) };
    };

    // ── NHS lump placement: follow the OBSERVED pattern, not the assumption ──
    // `firstFullWeekIndex` assumes NHS lands in the first full week of the next month.
    // That is not universal: this practice's ledger posts NHS at MONTH-END (seen live —
    // 31 Jan, 28 Feb, 31 Mar, each ~£18.5k+). With the assumed placement the forecast
    // sat one week away from the actual EVERY month, so both weeks read ±100% variance
    // (actual £22,125.52 in the 30-Mar week vs a £25,000 forecast in the 6-Apr week)
    // even though nothing was wrong with either number.
    // So when the NHS actuals come from the ledger and show a clear repeating week-of-
    // month, place the forecast lump in that same week. Falls back to the original
    // first-full-week rule when there is no observable pattern (<2 posting weeks).
    // Does this Monday-week's 7-day span contain the last calendar day of a month?
    // Exactly one week per month satisfies this, so it yields one lump per month.
    const weekHoldsMonthEnd = (weekStart: Date): boolean => {
      const weekEnd = new Date(weekStart.getTime() + 6 * 24 * 60 * 60 * 1000);
      const lastOfMonth = new Date(weekStart.getFullYear(), weekStart.getMonth() + 1, 0);
      return lastOfMonth >= weekStart && lastOfMonth <= weekEnd;
    };
    const nhsPlacement = (() => {
      if (!nhsUsingAccounting) return firstFullWeekIndex;
      const postingWeeks = trailingWeeks.filter((_, i) => (nhsTrailing[i] || 0) !== 0);
      if (postingWeeks.length < 2) return firstFullWeekIndex;
      // Month-end pattern? (This practice: 31 Jan, 28 Feb, 31 Mar — every posting week
      // holds its month's final day.) Matching on the CONTAINED month-end is what makes
      // the forecast land in the same week as the actual; an earlier attempt matched the
      // nearest Monday-date instead and put the lump in the 23-Mar week while the actual
      // sat in 30-Mar — still a week apart, just the other way.
      const monthEndHits = postingWeeks.filter((w) => weekHoldsMonthEnd(w.weekStart)).length;
      if (monthEndHits < Math.ceil(postingWeeks.length / 2)) return firstFullWeekIndex;
      const placement = new Set<number>();
      weeks.forEach((w) => { if (weekHoldsMonthEnd(w.weekStart)) placement.add(w.index); });
      return placement.size > 0 ? placement : firstFullWeekIndex;
    })();
    const nhsRow = applyScenario(resolveRow('nhs', 'NHS', 'nhs', 'inflow', lumpSeries(nhsMonthlyForForecast, nhsPlacement)));
    const membershipRows = membershipProviders.map(mp => applyScenario({
      ...resolveRow(`membership:${mp.id}`, mp.name, 'membership', 'inflow', membershipSeries(mp.stats)),
      membershipCalc: membershipCalcSeries(mp.stats),
      membershipMeta: {
        currentMembers: mp.stats.latestMembers,
        avgRevenuePerMember: mp.stats.avgRevenuePerMember,
        avgMonthlyJoiners: mp.stats.monthlyJoiners,
        avgMonthlyLeavers: mp.stats.avgMonthlyLeavers,
        monthlyChurnPct: mp.stats.monthlyChurn * 100,
        monthsObserved: mp.stats.monthsObserved,
        activity: mp.stats.activity,
      },
    }));
    // ── Private = the trailing weekly TAKINGS pattern, trended forward ──
    // Each forecast week mirrors the actual private cash TAKEN in the matching week
    // 13 weeks ago (dentally_payments — the Dentally "Takings" logic), trended by
    // the observed patient-volume momentum. A quiet trailing week (no takings
    // recorded) falls back to the trended weekly average so the row never collapses
    // to £0. Private is NOT redistributed by booked-appointment volume: takings are
    // cash actually received, which doesn't track a given week's appointment count
    // (deposits, card payments and plan instalments land independently of the diary).
    const privateBaseline = weeks.map((_, i) => {
      const matching = privateTrailing[i] || 0;
      const trended = Math.round(matching * Math.pow(1 + privateRevenueGrowth, i + 1));
      return matching > 0 ? trended : privateWeekly[i];
    });
    // Booked appointments per forecast week — retained ONLY as data for the AI payload
    // and the row tooltip. It does NOT drive the deterministic baseline above.
    const futureApptsPerWeek = weeks.map((_, i) => {
      let total = 0;
      apptForecast.futureByProvider.forEach((arr) => { total += arr[i] || 0; });
      return total;
    });
    const DIARY_RELIABLE_AHEAD_MS = 14 * 24 * 60 * 60 * 1000;
    const nowMs = Date.now();
    const shapeableIdx = weeks
      .map((w, i) => ((w.weekStart.getTime() <= nowMs + DIARY_RELIABLE_AHEAD_MS && (futureApptsPerWeek[i] || 0) > 0) ? i : -1))
      .filter((i) => i >= 0);
    // ── ACCOUNTING SOURCE ONLY: show it MONTHLY, not weekly ──────────────────────
    // Xero holds this as MONTHLY data — one summary invoice per location per month,
    // posted month-end (invoice date, paid date and journal date are all month-end).
    // Spreading that across weeks is false precision: 3 weeks in every 4 show a forecast
    // against no actual and read −100%. So the SAME total is relocated into the month's
    // posting week, where the actual lands. Nothing else about the figure changes.
    // PMS is deliberately untouched — Dentally payments carry real per-payment dates,
    // so weekly is genuine there.
    const privateBaselineBySource = (() => {
      if (!privateUsingAccounting) return privateBaseline;
      const placement = new Set<number>();
      weeks.forEach((w) => { if (weekHoldsMonthEnd(w.weekStart)) placement.add(w.index); });
      if (placement.size === 0) return privateBaseline;
      // Work from the REAL monthly postings, NOT privateBaseline's total. The weekly
      // baseline fills every empty week with the 13-week average (so a weekly PMS row
      // never collapses to £0) — on monthly ledger data that is ~10 weeks of phantom
      // income, which inflated the lump to £23,703 against a £14,705.50 actual.
      const monthlyPostings = trailingWeeks
        .map((w, i) => (weekHoldsMonthEnd(w.weekStart) ? Math.abs(privateTrailing[i] || 0) : 0))
        .filter((v) => v > 0);
      if (monthlyPostings.length === 0) return privateBaseline;
      // Each forecast MONTH gets its own figure rather than one number repeated. Base on
      // the MOST RECENT month (the best read of the current level) and carry the observed
      // month-over-month momentum forward. Capped at ±3%/month: this practice's postings
      // rose ~14%/month, and extrapolating that unchecked would run away within a quarter.
      const MONTH_TREND_CAP = 0.03;
      const first = monthlyPostings[0];
      const last = monthlyPostings[monthlyPostings.length - 1];
      let monthTrend = 0;
      if (monthlyPostings.length >= 2 && first > 0) {
        const steps = monthlyPostings.length - 1;
        const raw = Math.pow(last / first, 1 / steps) - 1;
        monthTrend = Math.max(-MONTH_TREND_CAP, Math.min(MONTH_TREND_CAP, raw));
      }
      const orderedPlacement = [...placement].sort((a, b) => a - b);
      const amountByWeek = new Map<number, number>();
      orderedPlacement.forEach((idx, k) => {
        amountByWeek.set(idx, Math.round(last * Math.pow(1 + monthTrend, k + 1)));
      });
      return weeks.map((w) => amountByWeek.get(w.index) ?? 0);
    })();
    const privateBaselineByMethod = applyMethod('private', 'inflow', privateBaselineBySource, privateTrailing);
    // Seasonality (Forecast Settings → Weekly distribution). OPT-IN: default off, so the
    // baseline is unchanged until enabled. When on, it scales the patient-driven Private
    // income down in the quiet seasonal weeks — December (wind-down) and the August
    // summer school-holiday weeks. NHS and membership are contractual, so they are not
    // seasonalised. (August is used as the summer-holiday proxy; a full bank-holiday /
    // half-term calendar is a later refinement.)
    const dist = forecastSettings.module.distribution;
    const privateSeasonal = dist.applySeasonality
      ? privateBaselineByMethod.map((v, i) => {
          const month = weeks[i].weekStart.getMonth(); // 0 = Jan … 11 = Dec
          let factor = 1;
          if (month === 11) factor *= 1 - (dist.decemberWindDownPct || 0) / 100;
          if (month === 7) factor *= 1 - (dist.schoolHolidayReductionPct || 0) / 100;
          return v * Math.max(0, factor);
        })
      : privateBaselineByMethod;
    // Bank-holiday + working-day capacity (Forecast Settings → Weekly distribution).
    // When "exclude bank holidays" is on, each week's income is scaled by the working-day
    // capacity remaining after removing any bank-holiday days that week (weighted by the
    // working-days % pattern). Default off = factor 1 everywhere, so nothing changes.
    const capacityFactor: number[] = (() => {
      if (!dist.excludeBankHolidays) return weeks.map(() => 1);
      const wd = dist.workingDays;
      const dayW = [wd.sun, wd.mon, wd.tue, wd.wed, wd.thu, wd.fri, wd.sat]; // JS getDay(): 0=Sun
      const normal = dayW.reduce((s, x) => s + (x || 0), 0) || 1;
      const hol = BANK_HOLIDAYS[dist.holidayRegion] ?? BANK_HOLIDAYS.england_wales;
      return weeks.map((w) => {
        let lost = 0;
        for (let d = 0; d < 7; d++) {
          const day = new Date(w.weekStart.getTime() + d * MS_DAY);
          const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
          if (hol.has(iso)) lost += dayW[day.getDay()] || 0;
        }
        return Math.max(0, (normal - lost) / normal);
      });
    })();
    // "Redistribute" (only relevant with Exclude on): the income lost to a bank holiday
    // isn't dropped — it carries into the FOLLOWING week (this week dips, the next bumps;
    // the two-week total is unchanged). Off = the holiday week's income is simply reduced.
    // (Redistributing within the SAME week is a no-op at weekly granularity, so it moves
    // forward a week instead.)
    const redistributeBankHol = dist.excludeBankHolidays && dist.redistributeBankHoliday;
    const privateAfterHolidays = (() => {
      const out = privateSeasonal.map((v, i) => v * capacityFactor[i]);
      if (redistributeBankHol) {
        for (let i = 0; i < privateSeasonal.length; i++) {
          const lost = privateSeasonal[i] * (1 - capacityFactor[i]);
          if (lost > 0 && i + 1 < out.length) out[i + 1] += lost;
        }
      }
      return out;
    })();

    // Xero invoice lag (Forecast Settings → Invoice timing): shift Private cash later by
    // the lag, rounded to whole weeks (default 0 = no shift). Weeks pushed past the
    // window fall off the end.
    const invoiceLagWeeks = Math.round((forecastSettings.module.income.xeroInvoiceLagDays || 0) / 7);
    const privateLagged = invoiceLagWeeks > 0
      ? [...new Array(invoiceLagWeeks).fill(0), ...privateAfterHolidays].slice(0, privateAfterHolidays.length)
      : privateAfterHolidays;
    const privateRow: ForecastRow = applyScenario(resolveRow('private', 'Private', 'private', 'inflow', privateLagged));

    // Per-week percentage adjustment applied to the Private row (stored under
    // line_key 'private_pct'). e.g. -5 means that week's Private is reduced 5%.
    const privatePct = weeks.map(w => ovrMap.get(`inflow|${w.iso}|private_pct`) ?? 0);
    const privatePctSet = weeks.map(w => ovrMap.has(`inflow|${w.iso}|private_pct`));

    // Operating inflow extras ("Others") + custom inflow rows (override-only).
    const operatingInflowExtraRows = manualRows('inflow', OPERATING_INFLOW_EXTRA);
    const customRows = customRowsFor('inflow');

    // Income include-toggles (Forecast Settings → Income logic). When a stream is
    // switched off it is removed from the forecast entirely — its row disappears and
    // it stops contributing to the inflow total. NHS = nhsRow, Denplan = membership
    // rows, Private = privateRow. (Lab recoveries / Other have no dedicated row yet,
    // so those two toggles are inert until such rows exist.)
    const incCfg = forecastSettings.module.income;

    // NHS + Denplan + Private rows are already scenario-scaled at creation (see
    // applyScenario above), so the RETURNED rows the table renders reflect the case.
    const inflowRows = [
      ...(incCfg.includeNHS ? [nhsRow] : []),
      ...(incCfg.includeDenplan ? membershipRows : []),
      ...(incCfg.includePrivate ? [privateRow] : []),
      ...operatingInflowExtraRows,
      ...customRows,
    ];
    const weeklyTotals = sumCols(inflowRows);

    // ── CASH OUTFLOW ──
    // Each "Profit (Expenses)" group's REAL week-by-week trailing-13-week spend,
    // repeated forward (future week i = trailing week i) so Claude can then
    // predict it week-wise. The rows map 1:1 to the configured expense groups
    // (Setup Categories → Profit (Expenses)).
    const groupWeekly = outflowWeeklyQuery.data?.weekly ?? {};
    const groupTotals = outflowWeeklyQuery.data?.totals ?? {};
    const TRAILING_MONTHS = (FORECAST_WEEKS * 7) / 30.44; // ≈ 2.99
    // ── 13-week TREND ── Observed momentum of a weekly series: first-half vs
    // second-half average, converted to a per-week growth rate and clamped to the
    // forecast settings' trend cap (default ±2%/week) so the trend stays grounded
    // (mirrors the Private volume trend). Used to project run-rates forward ALONG
    // their trend rather than flat-repeating — a falling cost keeps falling, a
    // rising one keeps rising, within bounds.
    const weeklyTrendRate = (series: number[]): number => {
      const n = series.length;
      if (n < 4) return 0;
      const half = Math.floor(n / 2);
      const firstAvg = series.slice(0, half).reduce((a, b) => a + b, 0) / half;
      const secondAvg = series.slice(n - half).reduce((a, b) => a + b, 0) / half;
      if (firstAvg <= 0) return 0;             // no signal to trend from
      const span = n - half;                   // weeks between the two half-centres (~6–7)
      return Math.max(-trendCap, Math.min(trendCap, ((secondAvg - firstAvg) / firstAvg) / span));
    };
    // Project a weekly series forward along its 13-week trend (compounding the
    // clamped growth rate week by week), never below zero, then apply cost inflation.
    const trendForward = (series: number[]): number[] => {
      const g = weeklyTrendRate(series);
      return series.map((v, i) => Math.max(0, v * Math.pow(1 + g, i + 1) * inflateCostWeek(i)));
    };
    // Groups whose FORECAST is placed as a monthly lump (their source is monthly
    // P&L, not invoice-dated weekly). The ACTUAL for these groups must be lumped the
    // SAME way (curGroupSeries) so the Combined view compares like-for-like — else a
    // monthly-lump forecast sits next to invoice-dated actuals in different weeks and
    // produces false −100% variances / blank cells.
    const lumpedGroups = new Set<number>();
    const groupSeries = (groupId: number): number[] => {
      const wk = groupWeekly[groupId];
      const total = groupTotals[groupId] ?? 0;
      if (wk && wk.length === FORECAST_WEEKS) {
        const wkSum = wk.reduce((a, b) => a + b, 0);
        // Trust the real weekly split only when it reconciles with the window
        // total (invoice-dated sources). If it over-counts (monthly P&L returns
        // the whole month for each week), fall back to a monthly lump. The trusted
        // weekly pattern is projected forward along its 13-week trend.
        if (total <= 0 || (wkSum >= total * 0.8 && wkSum <= total * 1.2)) return trendForward(wk);
      }
      // Monthly-lump fallback — inflate the placed lumps by the cost-inflation curve.
      lumpedGroups.add(groupId);
      return lumpSeries(total / TRAILING_MONTHS, firstFullWeekIndex).map((v, i) => v * inflateCostWeek(i));
    };
    // The trailing weekly series for a group (real split if present, else the
    // window total spread evenly) — the input for the average/repeat/manual methods.
    const groupTrailing = (groupId: number): number[] => {
      const wk = groupWeekly[groupId];
      if (wk && wk.length === FORECAST_WEEKS) return wk;
      const perWeek = (groupTotals[groupId] ?? 0) / Math.max(1, weeks.length);
      return weeks.map(() => perWeek);
    };
    // A grouped cost row's baseline, with the cost projection method applied
    // (auto = the smart groupSeries above; average/repeat/manual rebuild it).
    const groupBaseline = (key: string, groupId: number): number[] =>
      applyMethod(key, 'outflow', groupSeries(groupId), groupTrailing(groupId));

    // ── Category-Range COA rows (one per mapped account) ──
    // Hybrid: a cell shows the KNOWN amount of any unpaid invoice/bill due that
    // week (a cash fact, `fixed`), otherwise the trailing actuals repeated forward
    // as a monthly lump (AI-refinable). Manual overrides always win. Used for both
    // the operating outflow (op-direct / op-expense) and the four lower blocks.
    const blockActuals = blockActualsQuery.data ?? {};
    const blockPipeline = blockPipelineQuery.data ?? {};
    const coaNames = coaNamesQuery.data ?? {};

    // Every account mapped to each dataKey (from Category Range), named via the
    // org COA lookup — this is the FULL row list, independent of whether the
    // account has any trailing cash or invoice this period.
    const mappedByDataKey: Record<string, { id: string; name: string }[]> = {};
    for (const [vmKey, dataKey] of Object.entries(CATEGORY_VMKEY_DATAKEY)) {
      const ids = (categoryRange?.[vmKey as keyof CategoryRangeVM] ?? []) as string[];
      if (!ids.length) continue;
      const arr = (mappedByDataKey[dataKey] ??= []);
      for (const raw of ids) {
        const id = String(raw).trim();
        if (!id) continue;
        arr.push({ id, name: coaNames[id.toLowerCase()] || id });
      }
    }

    const norm = (s: string) => s.trim().toLowerCase();


    const buildCategoryRows = (dataKey: string, section: ForecastSection): ForecastRow[] => {
      const actuals = blockActuals[dataKey] ?? {};   // {reportId → {name, weekly}}
      const pipeline = blockPipeline[dataKey] ?? {}; // {accountId(lower) → {name, due}}

      // Trailing actuals attach BY NAME (report account name == COA account name),
      // sidestepping ledger-id vs mapping-id format differences. Invoice due-dates
      // attach BY ID (the pipeline is keyed by the line-item account id, which is
      // the same id space as the Category Range mapping).
      const trailingByName = new Map<string, number[]>();
      for (const a of Object.values(actuals)) {
        if (a.weekly.some((v) => v !== 0)) trailingByName.set(norm(a.name), a.weekly);
      }
      const dueById = new Map<string, number[]>();
      for (const [id, p] of Object.entries(pipeline)) dueById.set(id, p.due);

      // Project a recurring fixed cost forward at its detected cadence:
      //  • weekly  → a REAL RUN-RATE: the account's actual trailing total spread
      //    evenly across the forecast weeks, so the 13-week forecast equals what was
      //    really spent. (The old "median single invoice every week" over/under-stated
      //    the total whenever invoices weren't truly every week or varied in size.)
      //  • monthly → its typical amount in the forecast week containing its billing
      //    day-of-month (kept invoice-level, never pro-rated across weeks).
      const costCad = costCadenceQuery.data ?? {};
      const recurringSeries = (info: CadenceInfo, trailing: number[]): number[] => {
        if (info.cadence === 'weekly') {
          const trailingTotal = trailing.reduce((s, x) => s + (x || 0), 0);
          const perWeek = trailingTotal / Math.max(1, weeks.length);
          // Project the run-rate forward along the trailing series' 13-week trend
          // instead of flat: a falling/rising cost keeps moving that way (±2%/wk).
          const g = weeklyTrendRate(trailing);
          return weeks.map((_, i) => Math.max(0, perWeek * Math.pow(1 + g, i + 1) * inflateCostWeek(i)));
        }
        const day = Math.min(28, Math.max(1, Math.round(info.billDay) || 1));
        return weeks.map((w, i) => {
          for (let dd = 0; dd < 7; dd++) if (new Date(w.weekStart.getTime() + dd * MS_DAY).getDate() === day) return info.amount * inflateCostWeek(i);
          return 0;
        });
      };

      const makeRow = (key: string, label: string, trailing: number[], due: number[]): ForecastRow => {
        // A cost account with a detected weekly/monthly rhythm is a RECURRING fixed
        // cost: project its typical amount forward at that cadence. A known unpaid
        // bill in a given week supersedes the projection (it's the actual, no
        // double-count). Non-recurring accounts keep the trailing estimate + any
        // uncleared invoices layered on (the additive model).
        const info = (section === 'outflow' && key.startsWith('coa:')) ? costCad[key.slice(4).trim().toLowerCase()] : undefined;
        const recurring = !!info && (info.cadence === 'weekly' || info.cadence === 'monthly') && info.amount > 0;
        const projection = recurring ? recurringSeries(info!, trailing) : null;
        // A Lab Fees / Materials account whose real invoice level is redistributed
        // across the weeks by booked-appointment volume. Replaces the invoice-based
        // projection for the forward weeks; a known unpaid bill in a week still
        // supersedes it (the real cash fact wins, no double-count).
        const td = (section === 'outflow') ? appointmentDrivenFor(label, trailing) : null;
        // Forecast Settings → Costs → Variable cost logic. When "Lab fees: source" is
        // explicitly set to "Fixed monthly budget", the Lab Fees row is REPLACED by the
        // £/month budget spread evenly across the weeks (≈4.345 wks/month), held flat
        // (a fixed budget, so cost-inflation does not compound it). The default source
        // ('actual_xero') leaves the existing appointment-driven/real-invoice behaviour
        // untouched — so this only changes anything when the user picks the budget mode.
        const costCfg = forecastSettings.module.costs;
        const isLabRow = section === 'outflow' && /lab(oratory)?\s*fees?/i.test(label);
        const fixedLabSeries: number[] | null =
          (isLabRow && costCfg.labFeesSource === 'fixed_budget' && costCfg.fixedLabBudgetMonthly > 0)
            ? weeks.map(() => costCfg.fixedLabBudgetMonthly / 4.345)
            : null;
        // Consumables / sundries estimate: when set ( > 0 ), a Materials / consumables
        // row is REPLACED by that % of projected weekly income (weeklyTotals = inflow
        // total). Default 0 leaves the appointment-driven materials row untouched.
        const isMatRow = section === 'outflow' && !isLabRow
          && /(materials?|consumables?|clinical\s*(supplies|waste)|cost\s*of\s*goods\s*sold|\bcogs\b|sundries|disposables?)/i.test(label);
        const consumablesSeries: number[] | null =
          (isMatRow && costCfg.consumablesPctOfIncome > 0)
            ? weeks.map((_w, i) => (weeklyTotals[i] ?? 0) * (costCfg.consumablesPctOfIncome / 100))
            : null;
        // Fixed overhead budget via EXPLICIT account mapping (Forecast Settings → Costs →
        // Fixed cost categories, the "replaces" dropdown). When a budget is set AND this
        // row's label is the exact account the user mapped it to, the row is REPLACED by
        // that £/month spread evenly across the weeks (held flat). Exact label match only
        // — no fuzzy matching, which mis-fired on real charts of accounts.
        const fixedOverheadMonthly: number | null = (() => {
          if (section !== 'outflow') return null;
          const amt = costCfg.fixedAccountBudgets[label];
          return (typeof amt === 'number' && amt > 0) ? amt : null;
        })();
        const fixedOverheadSeries: number[] | null =
          fixedOverheadMonthly != null ? weeks.map(() => fixedOverheadMonthly / 4.345) : null;
        // Staff-cost formulas (Forecast Settings → Costs → Staff cost allocation), each
        // opt-in (default off) and REPLACING only the account it's mapped to:
        //   • Associate pay = rate % × projected weekly income (self-employed → no
        //     employer NI/pension added).
        //   • Support staff = monthly salary + employer NI + pension, spread flat.
        const associateSeries: number[] | null =
          (section === 'outflow' && costCfg.includeAssociatePay
            && !!costCfg.staffAccounts.associate && costCfg.staffAccounts.associate === label)
            ? weeks.map((_w, i) => (weeklyTotals[i] ?? 0) * (costCfg.associatePayRatePct / 100))
            : null;
        const supportSeries: number[] | null =
          (section === 'outflow' && costCfg.includeSupportStaff
            && !!costCfg.staffAccounts.support && costCfg.staffAccounts.support === label
            && costCfg.supportStaffMonthly > 0)
            ? weeks.map(() => (costCfg.supportStaffMonthly * (1 + (costCfg.employerNiPct + costCfg.pensionPct) / 100)) / 4.345)
            : null;
        // Raw (pre-rule) baseline: a settings override (fixed lab budget / consumables % /
        // mapped fixed-overhead budget / staff formula) when set wins outright; else the
        // treatment-driven series if present, else the recurring projection (a known bill
        // that week beats it), else the trailing estimate + any uncleared invoices.
        // Cost inflation (Forecast Settings → Costs) lifts every PROJECTED cost week —
        // appointment-driven (Lab/Materials) and trailing-based alike — not just the
        // recurring-cadence rows (whose projection is already inflated). It never touches
        // known unpaid bills (real cash) or the fixed-budget/staff overrides above. For
        // non-cost (inflow / lower-block) rows the multiplier is 1 (no effect). At 0%/mo
        // the multiplier is 1, so the default is unchanged.
        const inflate = (i: number) => (section === 'outflow' ? inflateCostWeek(i) : 1);
        const rawBaseline = weeks.map((_w, i) => {
          if (fixedLabSeries) return fixedLabSeries[i];
          if (consumablesSeries) return consumablesSeries[i];
          if (fixedOverheadSeries) return fixedOverheadSeries[i];
          if (associateSeries) return associateSeries[i];
          if (supportSeries) return supportSeries[i];
          const dueAmt = due[i] ?? 0;
          if (td) return dueAmt > 0 ? dueAmt : (td.series[i] ?? 0) * inflate(i);
          return recurring ? (dueAmt > 0 ? dueAmt : (projection![i] ?? 0)) : ((trailing[i] ?? 0) * inflate(i) + dueAmt);
        });
        // The projection method (global cost default or a per-line override) can
        // replace the smart waterfall baseline with a flat-average / repeat / manual
        // series built from this account's trailing actuals. 'auto' keeps the waterfall.
        const methodBaseline = applyMethod(key, section, rawBaseline, trailing);
        // An Auto / Repeating / Linked rule the user set on this cost line (via the
        // row's "+" editor) REPLACES the computed baseline — exactly like resolveRow
        // does for inflow rows. Without this, rules on per-account COST rows were
        // saved but silently ignored. Linked is resolved on the page (ruleSeries
        // returns 0 for it) but still needs `.rule` attached so dispVal routes there.
        const rule = ruleMap.get(key);
        const baseline = rule ? ruleSeries(rule, methodBaseline, trailing) : methodBaseline;
        const values: number[] = [];
        const overridden: boolean[] = [];
        const fixed: boolean[] = [];
        weeks.forEach((w, i) => {
          const dueAmt = due[i] ?? 0;
          const ov = ovrMap.get(`${section}|${w.iso}|${key}`);
          if (ov !== undefined) { values.push(ov); overridden.push(true); fixed.push(false); return; }
          values.push(baseline[i] ?? 0);
          overridden.push(false);
          // A rule-driven cell is a fact (AI must not overwrite it); otherwise a
          // known unpaid-invoice amount is the fixed cash fact for that week.
          fixed.push(rule ? true : dueAmt > 0);
        });
        // Auto-panel preview figures from this account's own trailing actuals.
        const autoPreview = {
          prevMonth: Math.round(autoMonthlyFigure(trailing, 'prev_month')),
          avg3m: Math.round(autoMonthlyFigure(trailing, 'avg_3m')),
        };
        return { key, label, kind: 'coa', section, values, baseline, overridden, fixed, editable: true, rule, autoPreview, tdMeta: td?.meta, fixedBudget: fixedOverheadMonthly ?? undefined };
      };

      const rows: ForecastRow[] = [];
      const usedNames = new Set<string>();
      const usedIds = new Set<string>();
      // 1) One row per mapped account (the FULL list): trailing by name, due by id.
      for (const m of (mappedByDataKey[dataKey] ?? [])) {
        const idl = m.id.toLowerCase();
        usedNames.add(norm(m.name));
        usedIds.add(idl);
        rows.push(makeRow(`coa:${m.id}`, m.name, trailingByName.get(norm(m.name)) ?? zero, dueById.get(idl) ?? zero));
      }
      // 2) Trailing accounts not covered by the mapping (report had cash for them).
      for (const [id, a] of Object.entries(actuals)) {
        if (usedNames.has(norm(a.name)) || !a.weekly.some((v) => v !== 0)) continue;
        usedIds.add(id);
        rows.push(makeRow(`coa:${id}`, a.name, a.weekly, dueById.get(id) ?? zero));
      }
      // 3) Invoice-due accounts not covered above (a bill due, no trailing/mapping).
      for (const [id, p] of Object.entries(pipeline)) {
        if (usedIds.has(id)) continue;
        rows.push(makeRow(`coa:${id}`, coaNames[id] || p.name || id, zero, p.due));
      }
      return rows.sort((a, b) => a.label.localeCompare(b.label));
    };

    // COST (Direct Costs) — one row per account mapped to Category Range
    // "Direct Costs". Falls back to the Profit (Expenses) grouped rows (Materials,
    // Lab Fees, Associates, Hygienists, Therapist) when nothing is mapped there.
    const directCatRows = buildCategoryRows('op-direct', 'outflow');
    const outflowCostRows: ForecastRow[] = directCatRows.length > 0 ? directCatRows : [
      resolveRow('materials', 'Materials', 'cost', 'outflow', groupBaseline('materials', EXPENSE_GROUP.MATERIALS)),
      resolveRow('lab_fees', 'Lab Fees', 'cost', 'outflow', groupBaseline('lab_fees', EXPENSE_GROUP.LAB_FEES)),
      resolveRow('associates', 'Associates', 'cost', 'outflow', groupBaseline('associates', EXPENSE_GROUP.DENTIST)),
      resolveRow('hygienists', 'Hygienists', 'cost', 'outflow', groupBaseline('hygienists', EXPENSE_GROUP.HYGIENIST)),
      resolveRow('therapist', 'Therapist', 'cost', 'outflow', groupBaseline('therapist', EXPENSE_GROUP.THERAPIST)),
    ];

    // EXPENSES (Over Heads) — one row per account mapped to Category Range
    // "Over Heads". Falls back to the Profit (Expenses) grouped rows (Payroll,
    // Premises, Overheads, Advertising) when nothing is mapped there.
    const expenseCatRows = buildCategoryRows('op-expense', 'outflow');
    const outflowExpenseRows: ForecastRow[] = expenseCatRows.length > 0 ? expenseCatRows : [
      resolveRow('payroll', 'Payroll', 'expense', 'outflow', groupBaseline('payroll', EXPENSE_GROUP.STAFF)),
      resolveRow('premises', 'Premises', 'expense', 'outflow', groupBaseline('premises', EXPENSE_GROUP.OPERATING_LEASE)),
      resolveRow('overheads', 'Overheads', 'expense', 'outflow', groupBaseline('overheads', EXPENSE_GROUP.OTHER_FIXED)),
      resolveRow('advertising', 'Advertising & Promotion', 'expense', 'outflow', groupBaseline('advertising', EXPENSE_GROUP.MARKETING)),
    ];

    // Included bills whose COA isn't mapped in Category Range — one row per their
    // own chart of account (invoice-due amounts only), grouped under Expenses so
    // the included bill is always reflected in the forecast outflow.
    const unmappedBillRows = buildCategoryRows(UNMAPPED_BILL_DATAKEY, 'outflow');

    // Manual extras added to match the sheet's row list (alongside data rows).
    const operatingDirectExtraRows = manualRows('outflow', OPERATING_DIRECT_EXTRA);
    const operatingExpenseExtraRows = manualRows('outflow', OPERATING_EXPENSE_EXTRA);
    // Custom outflow rows (one-off bills, etc.) — grouped under Expenses.
    const outflowCustomRows = customRowsFor('outflow');

    // Direct Costs subtotal (data cost rows + manual cost extras) and Expenses
    // subtotal (data expense rows + manual expense extras + custom), mirroring
    // the sheet's two-part operating outflow.
    const directCostRows = [...outflowCostRows, ...operatingDirectExtraRows];
    const expenseRows = [...outflowExpenseRows, ...operatingExpenseExtraRows, ...outflowCustomRows, ...unmappedBillRows];
    const directCostsTotals = sumCols(directCostRows);
    const expensesTotals = sumCols(expenseRows);

    const outflowRows = [...directCostRows, ...expenseRows];
    const weeklyOutflowTotals = sumCols(outflowRows);

    // Net cash flow = inflow − outflow for the week.
    const netCashFlow = weeks.map((_, i) => weeklyTotals[i] - weeklyOutflowTotals[i]);
    // Sheet intermediate subtotals: Contribution (inflow − direct costs) and the
    // Operating net (contribution − expenses, == netCashFlow).
    const contribution = weeks.map((_, i) => weeklyTotals[i] - directCostsTotals[i]);
    const operatingNet = weeks.map((_, i) => contribution[i] - expensesTotals[i]);

    // ── Lower blocks (Investing / Financing / Tax & Grant / Inter Company) ──
    // One row per mapped account (same hybrid logic as the operating rows above),
    // plus any user-added custom rows. No hardcoded placeholder rows.
    const buildSubsection = (sub: ManualSubsection) => {
      const rows = [...buildCategoryRows(sub.section, sub.section), ...customRowsFor(sub.section)];
      return { section: sub.section, title: sub.title, rows, totals: sumCols(rows) };
    };
    const manualBlocks = MANUAL_BLOCKS.map(b => {
      const inflow = buildSubsection(b.inflow);
      const outflow = buildSubsection(b.outflow);
      const net = weeks.map((_, i) => inflow.totals[i] - outflow.totals[i]);
      return { id: b.id, netLabel: b.netLabel, inflow, outflow, net };
    });

    // ── Running cash balance ──
    // Total weekly net = operating + every block net. End cash rolls forward from
    // the editable opening balance (Start Cash, stored once on week 1).
    const totalWeeklyNet = weeks.map((_, i) =>
      operatingNet[i] + manualBlocks.reduce((s, b) => s + b.net[i], 0));
    const manualStartCash = ovrMap.get(`balance|${weeks[0]?.iso}|start_cash`);
    const startCashManual = ovrMap.has(`balance|${weeks[0]?.iso}|start_cash`);
    // Fall back to the accounting closing balance when there's no manual opening cash.
    const autoStartCash = openingBalanceQuery.data ?? 0;
    const startCash = startCashManual ? (manualStartCash ?? 0) : autoStartCash;
    const startCashAutofilled = !startCashManual && autoStartCash !== 0;
    // startCashSet = we have a meaningful opening balance (manual OR auto-filled).
    const startCashSet = startCashManual || startCashAutofilled;
    // ── Per-row thresholds (section 'threshold', line_key = the row's key) ──
    // Each threshold is stored per week and CARRIES FORWARD from the last set week.
    // The client restricts thresholds to three rows:
    //   • Total Weekly Net Cash Flow → line_key 'cash_threshold' — a MINIMUM (alert
    //     if net cash flow drops below it).
    //   • Lab cost / Clinician cost rows → their own line_key — a MAXIMUM (alert if
    //     the cost goes above it).
    // Returned as a map keyed by line_key so the page can resolve any row's line.
    const thrKeys = new Set<string>();
    for (const k of ovrMap.keys()) {
      if (k.startsWith('threshold|')) { const lk = k.split('|')[2]; if (lk) thrKeys.add(lk); }
    }
    const thresholdsByKey: Record<string, (number | null)[]> = {};
    for (const lk of thrKeys) {
      const arr: (number | null)[] = [];
      let last: number | null = null;
      weeks.forEach((w) => {
        const key = `threshold|${w.iso}|${lk}`;
        if (ovrMap.has(key)) last = ovrMap.get(key) ?? null;
        arr.push(last);
      });
      thresholdsByKey[lk] = arr;
    }
    // Net-cash-flow threshold series kept under the legacy names for the graph/alert.
    const thresholds: (number | null)[] = thresholdsByKey['cash_threshold'] ?? weeks.map(() => null);
    const thresholdSet = !!thresholdsByKey['cash_threshold'];
    let running = startCash;
    const endCash = weeks.map((_, i) => { running += totalWeeklyNet[i]; return running; });

    // ── Per-week "Decisions Made" notes (section 'note', line_label = text) ──
    const notes = weeks.map(w => {
      const o = (overridesQuery.data ?? []).find(
        r => r.section === 'note' && r.week_start === w.iso && r.line_key === 'decision');
      return (o?.line_label as string) || '';
    });

    const allRows = [...inflowRows, ...outflowRows, ...manualBlocks.flatMap(b => [...b.inflow.rows, ...b.outflow.rows])];

    // ── Denplan membership prediction summary ──
    // Project the CURRENT base forward across 12 months at each churn scenario.
    // The scenario table uses a flat annual haircut (annual = base×12×(1−churn),
    // at-risk = base×12×churn) — matches the client's scenario figures.
    const membershipMonthlyTotal = membershipProviders.reduce((s, mp) => s + mp.stats.latestRevenue, 0);
    const membershipAnnualBase = membershipMonthlyTotal * 12;
    const churnScenarios: ChurnScenario[] = CHURN_SCENARIOS.map(rate => ({
      rate,
      annual: membershipAnnualBase * (1 - rate),
      atRisk: membershipAnnualBase * rate,
      selected: Math.abs(rate - churnRate) < 1e-9,
    }));

    // ── PREVIOUS 13 weeks (actuals) — the real history the forecast is built
    // from, laid over the trailing Monday-weeks. Read-only: no AI, no overrides,
    // no manual blocks (those are forecast-only). Same data the baselines use,
    // just placed on the past weeks instead of repeated forward. ──
    const prevLump = (monthly: number, placement: Set<number>): number[] =>
      trailingWeeks.map(w => (placement.has(w.index) ? monthly : 0));
    const prevGroupSeries = (groupId: number): number[] => {
      const wk = groupWeekly[groupId];
      const total = groupTotals[groupId] ?? 0;
      if (wk && wk.length === FORECAST_WEEKS) {
        const s = wk.reduce((a, b) => a + b, 0);
        if (total <= 0 || (s >= total * 0.8 && s <= total * 1.2)) return wk; // real weekly split
      }
      return prevLump(total / TRAILING_MONTHS, trailingFirstFullWeekIndex);
    };
    const prevMembershipSeries = (stats: MembershipDentistStats): number[] =>
      trailingWeeks.map(w => {
        const payDate = new Date(w.weekStart.getFullYear(), w.weekStart.getMonth(), forecastSettings.membershipPayDay);
        const weekEnd = new Date(w.weekStart.getTime() + 6 * MS_DAY);
        if (payDate < w.weekStart || payDate > weekEnd) return 0; // not a pay week
        const wYm = w.weekStart.getFullYear() * 12 + (w.weekStart.getMonth() + 1);
        return stats.monthlyRevenue[wYm] ?? 0; // actual uploaded net for that month
      });
    const prevRow = (key: string, label: string, values: number[]): PreviousRow => ({ key, label, values });
    const prevSum = (rows: PreviousRow[]): number[] =>
      trailingWeeks.map((_, i) => rows.reduce((s, r) => s + (r.values[i] ?? 0), 0));

    // ── Membership ACTUALS source (Income Type Mapping → Membership) ──
    // 'accounting' + accounts mapped → the ledger total for the mapped accounts (e.g.
    // "201 Sales - Denplan"); otherwise the Denplan CSV. The ledger gives ONE total with
    // no dentist dimension, while membership rows are per treating dentist — so the
    // total is apportioned across dentists by each one's share of the CSV, keeping the
    // actual rows aligned with the per-dentist forecast rows (variance matches by key).
    // The FORECAST always stays CSV-driven; only the actual series switches.
    const membershipUsingAccounting = membershipAccountingQuery.data?.active ?? false;
    // `fallbackWeights` = each dentist's OWN membership book (net_due at the latest
    // uploaded month). It is needed because the CSV slice for a window is only non-zero
    // on that window's pay-weeks AND only for months that have actually been uploaded —
    // so for the CURRENT/forward window the CSV sums to 0 for every dentist. That used
    // to collapse to an equal 1/N split, which showed every practitioner the SAME
    // number (the ledger total ÷ N) instead of their own share of the membership book.
    const apportionByCsvShare = (
      ledgerWeekly: number[],
      csvSeries: number[][],
      fallbackWeights?: number[],
    ): number[][] => {
      const totals = csvSeries.map((s) => s.reduce((a, b) => a + b, 0));
      let weights = totals;
      let grand = totals.reduce((a, b) => a + b, 0);
      if (grand <= 0 && fallbackWeights && fallbackWeights.length === csvSeries.length) {
        weights = fallbackWeights;
        grand = weights.reduce((a, b) => a + (b > 0 ? b : 0), 0);
      }
      return csvSeries.map((_, i) => {
        const w = weights[i] > 0 ? weights[i] : 0;
        // Only an entirely unknown split (no CSV, no book) falls back to an even share.
        const share = grand > 0 ? w / grand : (csvSeries.length ? 1 / csvSeries.length : 0);
        return ledgerWeekly.map((v) => v * share);
      });
    };
    // Per-dentist membership book, used as the apportionment basis whenever the
    // window's CSV slice is empty.
    const membershipBookWeights = membershipProviders.map((mp) => mp.stats.latestRevenue || 0);

    const prevMembershipCsv = membershipProviders.map((mp) => prevMembershipSeries(mp.stats));
    const prevMembershipSeriesByProvider = membershipUsingAccounting
      ? apportionByCsvShare(
          trailingWeeks.map((_, i) => (membershipAccountingQuery.data?.weekly ?? [])[i] ?? 0),
          prevMembershipCsv,
          membershipBookWeights,
        )
      : prevMembershipCsv;

    const previousInflow: PreviousRow[] = [
      prevRow('nhs', 'NHS', nhsUsingAccounting ? nhsTrailing : prevLump(nhsMonthly, trailingFirstFullWeekIndex)),
      ...membershipProviders.map((mp, i) => prevRow(`membership:${mp.id}`, mp.name, prevMembershipSeriesByProvider[i])),
      prevRow('private', 'Private', privateTrailing),
    ];
    // Previous-13-weeks actuals for the operating outflow: from Category Range
    // per-account (the same weekly data the forecast repeats forward) when mapped,
    // else the Profit (Expenses) grouped rows.
    // Mirror the Forecast tab's account list: one row per MAPPED account (the full
    // Category Range list), independent of whether it had trailing cash — so the two
    // tabs line up. Trailing actuals attach BY NAME (report name == COA name); a
    // mapped account with no history shows zeros. Then append any account that DID
    // have trailing cash but isn't in the mapping (so no real activity is dropped).
    const prevCatRows = (dataKey: string): PreviousRow[] => {
      const actuals = blockActuals[dataKey] ?? {}; // {reportId → {name, weekly}}
      const trailingByName = new Map<string, number[]>();
      for (const a of Object.values(actuals)) {
        if (a.weekly.some((v) => v !== 0)) trailingByName.set(norm(a.name), a.weekly);
      }
      const rows: PreviousRow[] = [];
      const usedNames = new Set<string>();
      // 1) One row per mapped account (FULL list) — actuals by name, else zeros.
      for (const m of (mappedByDataKey[dataKey] ?? [])) {
        usedNames.add(norm(m.name));
        rows.push(prevRow(`coa:${m.id}`, m.name, trailingByName.get(norm(m.name)) ?? zero));
      }
      // 2) Trailing accounts with real cash that aren't covered by the mapping.
      for (const [id, a] of Object.entries(actuals)) {
        if (usedNames.has(norm(a.name)) || !a.weekly.some((v) => v !== 0)) continue;
        rows.push(prevRow(`coa:${id}`, a.name, a.weekly));
      }
      return rows.sort((a, b) => a.label.localeCompare(b.label));
    };
    const previousDirect: PreviousRow[] = directCatMapped ? prevCatRows('op-direct') : [
      prevRow('materials', 'Materials', prevGroupSeries(EXPENSE_GROUP.MATERIALS)),
      prevRow('lab_fees', 'Lab Fees', prevGroupSeries(EXPENSE_GROUP.LAB_FEES)),
      prevRow('associates', 'Associates', prevGroupSeries(EXPENSE_GROUP.DENTIST)),
      prevRow('hygienists', 'Hygienists', prevGroupSeries(EXPENSE_GROUP.HYGIENIST)),
      prevRow('therapist', 'Therapist', prevGroupSeries(EXPENSE_GROUP.THERAPIST)),
    ];
    const previousExpense: PreviousRow[] = expenseCatMapped ? prevCatRows('op-expense') : [
      prevRow('payroll', 'Payroll', prevGroupSeries(EXPENSE_GROUP.STAFF)),
      prevRow('premises', 'Premises', prevGroupSeries(EXPENSE_GROUP.OPERATING_LEASE)),
      prevRow('overheads', 'Overheads', prevGroupSeries(EXPENSE_GROUP.OTHER_FIXED)),
      prevRow('advertising', 'Advertising & Promotion', prevGroupSeries(EXPENSE_GROUP.MARKETING)),
    ];
    const previousInflowTotals = prevSum(previousInflow);
    const previousDirectTotals = prevSum(previousDirect);
    const previousExpenseTotals = prevSum(previousExpense);
    const previousOutflowTotals = trailingWeeks.map((_, i) => previousDirectTotals[i] + previousExpenseTotals[i]);
    const previousContribution = trailingWeeks.map((_, i) => previousInflowTotals[i] - previousDirectTotals[i]);
    const previousOperatingNet = trailingWeeks.map((_, i) => previousInflowTotals[i] - previousOutflowTotals[i]);

    // Lower blocks (Investing / Financing / Tax & Grant / Inter Company) for the
    // Previous view: every mapped Category Range account per block section (zeros
    // where there's no trailing cash), mirroring the forecast block structure.
    // Manual-only rows have no historical actuals; the headers/totals/net always show.
    const previousBlocks = MANUAL_BLOCKS.map(b => {
      const inflowRows = prevCatRows(b.inflow.section);
      const outflowRows = prevCatRows(b.outflow.section);
      const inflowTotals = prevSum(inflowRows);
      const outflowTotals = prevSum(outflowRows);
      return {
        id: b.id,
        netLabel: b.netLabel,
        inflow: { title: b.inflow.title, rows: inflowRows, totals: inflowTotals },
        outflow: { title: b.outflow.title, rows: outflowRows, totals: outflowTotals },
        net: trailingWeeks.map((_, i) => inflowTotals[i] - outflowTotals[i]),
      };
    });
    const previousTotalNet = trailingWeeks.map((_, i) =>
      previousOperatingNet[i] + previousBlocks.reduce((s, blk) => s + blk.net[i], 0));
    // No saved opening balance for the past, so End Cash rolls from £0 — it reads
    // as the cumulative net cash generated across the trailing 13 weeks.
    let prevRunning = 0;
    const previousEndCash = trailingWeeks.map((_, i) => { prevRunning += previousTotalNet[i]; return prevRunning; });

    const previous = {
      weeks: trailingWeeks,
      inflow: previousInflow, direct: previousDirect, expense: previousExpense,
      inflowTotals: previousInflowTotals,
      directTotals: previousDirectTotals,
      expenseTotals: previousExpenseTotals,
      outflowTotals: previousOutflowTotals,
      contribution: previousContribution,
      operatingNet: previousOperatingNet,
      net: previousOperatingNet,
      blocks: previousBlocks,
      totalNet: previousTotalNet,
      endCash: previousEndCash,
    };

    // ── CURRENT (displayed-window) ACTUALS — each shown week's OWN actual, used by
    // the Combined tab so a week that has already ended compares its forecast to its
    // real result (not the trailing-week figure). Mirrors the `previous` builders but
    // laid over `weeks`, fed by the displayed-window twin queries. ──
    const curGroupWeekly = currentOutflowWeeklyQuery.data?.weekly ?? {};
    const curGroupTotals = currentOutflowWeeklyQuery.data?.totals ?? {};
    const curBlockActuals = currentBlockActualsQuery.data ?? {};
    const currentPrivateData = currentPrivateQuery.data ?? { revenue: weeks.map(() => 0), patients: weeks.map(() => 0) };
    // Combined-tab ACTUAL for Private follows the same source as the baseline.
    const currentPrivateUsingAccounting = currentPrivateAccountingQuery.data?.active ?? false;
    const currentPrivateRevenue = currentPrivateUsingAccounting
      ? (currentPrivateAccountingQuery.data?.weekly ?? currentPrivateData.revenue)
      : currentPrivateData.revenue;
    // Combined-tab ACTUAL for NHS: real ledger receipts when accounting-sourced, else
    // the contract lump. (nhsAccountingCurrent falls back to trailing if the current
    // window query hasn't populated, keeping the row non-empty.)
    const currentNhsUsingAccounting = currentNhsAccountingQuery.data?.active ?? nhsUsingAccounting;
    const currentNhsSeries = currentNhsUsingAccounting
      ? weeks.map((_, i) => nhsAccountingCurrent[i] ?? 0)
      : lumpSeries(nhsMonthly, firstFullWeekIndex);

    const curGroupSeries = (groupId: number): number[] => {
      const wk = curGroupWeekly[groupId];
      const total = curGroupTotals[groupId] ?? 0;
      // If the FORECAST lumps this group (monthly source), lump the ACTUAL into the
      // same payment-weeks so the two line up in the Combined view (no false −100%
      // from a lumped forecast sitting beside invoice-dated weekly actuals).
      if (lumpedGroups.has(groupId)) return lumpSeries(total / TRAILING_MONTHS, firstFullWeekIndex);
      if (wk && wk.length === FORECAST_WEEKS) {
        const s = wk.reduce((a, b) => a + b, 0);
        if (total <= 0 || (s >= total * 0.8 && s <= total * 1.2)) return wk; // real weekly split
      }
      return lumpSeries(total / TRAILING_MONTHS, firstFullWeekIndex);
    };
    const curMembershipSeries = (stats: MembershipDentistStats): number[] =>
      weeks.map(w => {
        if (!isPayWeek(w)) return 0;
        const wYm = w.weekStart.getFullYear() * 12 + (w.weekStart.getMonth() + 1);
        return stats.monthlyRevenue[wYm] ?? 0; // actual uploaded net for that month
      });
    const curSum = (rows: PreviousRow[]): number[] =>
      weeks.map((_, i) => rows.reduce((s, r) => s + (r.values[i] ?? 0), 0));
    const curCatRows = (dataKey: string): PreviousRow[] => {
      const actuals = curBlockActuals[dataKey] ?? {};
      const byName = new Map<string, number[]>();
      for (const a of Object.values(actuals)) {
        if (a.weekly.some((v) => v !== 0)) byName.set(norm(a.name), a.weekly);
      }
      const rows: PreviousRow[] = [];
      const usedNames = new Set<string>();
      for (const m of (mappedByDataKey[dataKey] ?? [])) {
        usedNames.add(norm(m.name));
        rows.push(prevRow(`coa:${m.id}`, m.name, byName.get(norm(m.name)) ?? zero));
      }
      for (const [id, a] of Object.entries(actuals)) {
        if (usedNames.has(norm(a.name)) || !a.weekly.some((v) => v !== 0)) continue;
        rows.push(prevRow(`coa:${id}`, a.name, a.weekly));
      }
      return rows.sort((a, b) => a.label.localeCompare(b.label));
    };

    // Combined-tab ACTUAL for Membership follows the same mapping as the trailing side.
    const currentMembershipUsingAccounting = currentMembershipAccountingQuery.data?.active ?? membershipUsingAccounting;
    const curMembershipCsv = membershipProviders.map((mp) => curMembershipSeries(mp.stats));
    const curMembershipSeriesByProvider = currentMembershipUsingAccounting
      ? apportionByCsvShare(
          weeks.map((_, i) => ((includeCurrentWindow ? currentMembershipAccountingQuery.data?.weekly : undefined) ?? [])[i] ?? 0),
          curMembershipCsv,
          membershipBookWeights,
        )
      : curMembershipCsv;

    const currentInflow: PreviousRow[] = [
      prevRow('nhs', 'NHS', currentNhsSeries),
      ...membershipProviders.map((mp, i) => prevRow(`membership:${mp.id}`, mp.name, curMembershipSeriesByProvider[i])),
      prevRow('private', 'Private', currentPrivateRevenue),
    ];
    const currentDirect: PreviousRow[] = directCatMapped ? curCatRows('op-direct') : [
      prevRow('materials', 'Materials', curGroupSeries(EXPENSE_GROUP.MATERIALS)),
      prevRow('lab_fees', 'Lab Fees', curGroupSeries(EXPENSE_GROUP.LAB_FEES)),
      prevRow('associates', 'Associates', curGroupSeries(EXPENSE_GROUP.DENTIST)),
      prevRow('hygienists', 'Hygienists', curGroupSeries(EXPENSE_GROUP.HYGIENIST)),
      prevRow('therapist', 'Therapist', curGroupSeries(EXPENSE_GROUP.THERAPIST)),
    ];
    const currentExpense: PreviousRow[] = expenseCatMapped ? curCatRows('op-expense') : [
      prevRow('payroll', 'Payroll', curGroupSeries(EXPENSE_GROUP.STAFF)),
      prevRow('premises', 'Premises', curGroupSeries(EXPENSE_GROUP.OPERATING_LEASE)),
      prevRow('overheads', 'Overheads', curGroupSeries(EXPENSE_GROUP.OTHER_FIXED)),
      prevRow('advertising', 'Advertising & Promotion', curGroupSeries(EXPENSE_GROUP.MARKETING)),
    ];
    const currentInflowTotals = curSum(currentInflow);
    const currentDirectTotals = curSum(currentDirect);
    const currentExpenseTotals = curSum(currentExpense);
    const currentOutflowTotals = weeks.map((_, i) => currentDirectTotals[i] + currentExpenseTotals[i]);
    const currentContribution = weeks.map((_, i) => currentInflowTotals[i] - currentDirectTotals[i]);
    const currentOperatingNet = weeks.map((_, i) => currentInflowTotals[i] - currentOutflowTotals[i]);
    const currentBlocks = MANUAL_BLOCKS.map(b => {
      const inflowRows = curCatRows(b.inflow.section);
      const outflowRows = curCatRows(b.outflow.section);
      const inflowTotals = curSum(inflowRows);
      const outflowTotals = curSum(outflowRows);
      return {
        id: b.id,
        netLabel: b.netLabel,
        inflow: { title: b.inflow.title, rows: inflowRows, totals: inflowTotals },
        outflow: { title: b.outflow.title, rows: outflowRows, totals: outflowTotals },
        net: weeks.map((_, i) => inflowTotals[i] - outflowTotals[i]),
      };
    });
    const currentTotalNet = weeks.map((_, i) =>
      currentOperatingNet[i] + currentBlocks.reduce((s, blk) => s + blk.net[i], 0));
    let curRunning = 0;
    const currentEndCash = weeks.map((_, i) => { curRunning += currentTotalNet[i]; return curRunning; });

    const current = {
      weeks,
      inflow: currentInflow, direct: currentDirect, expense: currentExpense,
      inflowTotals: currentInflowTotals,
      directTotals: currentDirectTotals,
      expenseTotals: currentExpenseTotals,
      outflowTotals: currentOutflowTotals,
      contribution: currentContribution,
      operatingNet: currentOperatingNet,
      net: currentOperatingNet,
      blocks: currentBlocks,
      totalNet: currentTotalNet,
      endCash: currentEndCash,
    };

    return {
      // Per-line projection-method overrides (explicit; absent = inherit the global
      // family default) + a resolver giving the EFFECTIVE method for any (key, section).
      lineMethods: Object.fromEntries(methodMap) as Record<string, LineMethodConfig>,
      resolveRowMethod: lineMethodFor,
      nhsRow, membershipRows, privateRow, privateUsingAccounting,
      // NHS row is sourced from the connected ledger (real receipts) when the location's
      // nhs_income_source = 'accounting'; else from the UDA contract value ÷ 12.
      nhsUsingAccounting,
      nhsAccountingEmpty: nhsUsingAccounting && nhsTrailing.every((v) => (v || 0) === 0),
      // Membership ACTUALS came from the mapped ledger accounts (forecast is always CSV).
      membershipUsingAccounting,
      // True when the Private row is on the Accounting source but the connected
      // ledger resolved to NO income for the mapped accounts in the trailing window
      // (unmapped / non-resolving accounts / no journals). Lets the page show a
      // visible reason instead of a silently blank row.
      privateAccountingEmpty: privateUsingAccounting && privateTrailing.every((v) => (v || 0) === 0),
      customRows, operatingInflowExtraRows,
      privatePct, privatePctSet,
      // The raw trailing weekly Private revenue + patient counts + the per-week
      // volume trend that turns them into a forecast (surfaced for the cell
      // tooltip and sent to Claude as grounding).
      privateTrailing, privatePatients, privateTrendPct: Math.round(privateRevenueGrowth * 1000) / 10, privateAvgWeekly: Math.round(privateAvgWeekly),
      // Booked appointments per FORECAST week (the diary). This is the only genuine
      // forward signal available — measured r = 0.588 against weekly takings — so it is
      // sent to Claude, which forecasts the Private row from real history + booked
      // volume rather than nudging a calculated baseline. `diaryReliableWeeks` says how
      // many of those weeks are actually filled: beyond that a week reads empty because
      // nobody has booked yet, NOT because it will be quiet, and Claude is told to ignore
      // the count there instead of forecasting a collapse.
      privateBookedAppointments: futureApptsPerWeek,
      diaryReliableWeeks: shapeableIdx.length ? Math.max(...shapeableIdx) + 1 : 0,
      outflowCostRows, outflowExpenseRows, outflowCustomRows,
      operatingDirectExtraRows, operatingExpenseExtraRows,
      directCostRows, expenseRows, directCostsTotals, expensesTotals,
      contribution, operatingNet,
      manualBlocks, totalWeeklyNet, startCash, startCashSet, startCashAutofilled, thresholds, thresholdSet, thresholdsByKey, endCash, notes, comments: commentMap,
      allRows, weeklyTotals, weeklyOutflowTotals, netCashFlow,
      membershipMonthlyTotal, membershipAnnualBase, churnScenarios,
      previous,
      current,
    };
  }, [privateQuery.data, privateAccountingQuery.data, nhsAccountingQuery.data, currentNhsAccountingQuery.data, membershipAccountingQuery.data, currentMembershipAccountingQuery.data, openingBalanceQuery.data, membershipQuery.data, udaSettingsQuery.data, outflowWeeklyQuery.data, blockActualsQuery.data, blockPipelineQuery.data, costCadenceQuery.data, coaNamesQuery.data, categoryRange, overridesQuery.data, weeks, trailingWeeks, anchorMonday, firstFullWeekIndex, trailingFirstFullWeekIndex, churnRate, forecastSettings, currentPrivateQuery.data, currentPrivateAccountingQuery.data, currentOutflowWeeklyQuery.data, currentBlockActualsQuery.data, apptForecast]);

  // ── Mutations ──
  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: ['cashflow-forecast-overrides', organizationId, locationScopeKey, weeks[0]?.iso],
    });

  // Upsert one cell. amount === null clears the override (falls back to baseline).
  // `section` defaults to 'inflow' so existing inflow callers are unaffected.
  const setCell = useMutation({
    mutationFn: async (args: { weekStart: string; lineKey: string; lineLabel?: string | null; amount: number | null; section?: ForecastSection }) => {
      if (!organizationId) throw new Error('No organization');
      const section = args.section ?? 'inflow';
      if (args.amount === null) {
        let dq = (supabase as any)
          .from('cashflow_forecast_overrides')
          .delete()
          .eq('organization_id', organizationId)
          .eq('section', section)
          .eq('week_start', args.weekStart)
          .eq('line_key', args.lineKey);
        dq = selectedLocationId ? dq.eq('location_id', selectedLocationId) : dq.is('location_id', null);
        const { error } = await dq;
        if (error) throw error;
        return;
      }
      const { error } = await (supabase as any)
        .from('cashflow_forecast_overrides')
        .upsert(
          {
            organization_id: organizationId,
            location_id: selectedLocationId ?? null,
            section,
            week_start: args.weekStart,
            line_key: args.lineKey,
            line_label: args.lineLabel ?? null,
            amount: args.amount,
            created_by: user?.id ?? null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'organization_id,location_id,week_start,section,line_key' },
        );
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e: unknown) => toast.error(`Couldn't save that amount: ${e instanceof Error ? e.message : 'unknown error'}`),
  });

  // Add a custom row (seeded with a zero cell so it persists). Defaults to the
  // inflow section ("one-off receipt"); pass section 'outflow' for an expense.
  const addCustomRow = useMutation({
    mutationFn: async (args: string | { label: string; section?: ForecastSection }) => {
      if (!organizationId) throw new Error('No organization');
      const label = typeof args === 'string' ? args : args.label;
      const section: ForecastSection = (typeof args === 'string' ? 'inflow' : args.section) ?? 'inflow';
      const isOutflowish = section === 'outflow' || section.endsWith('out');
      const fallbackLabel = isOutflowish ? 'Other expense' : 'One-off receipt';
      const lineKey = `custom:${crypto.randomUUID()}`;
      const { error } = await (supabase as any)
        .from('cashflow_forecast_overrides')
        .insert({
          organization_id: organizationId,
          location_id: selectedLocationId ?? null,
          section,
          week_start: weeks[0].iso,
          line_key: lineKey,
          line_label: label || fallbackLabel,
          amount: 0,
          created_by: user?.id ?? null,
        });
      if (error) throw error;
      return lineKey;
    },
    onSuccess: invalidate,
  });

  // Remove a custom row entirely (all its cells across the horizon).
  const removeCustomRow = useMutation({
    mutationFn: async (args: string | { lineKey: string; section?: ForecastSection }) => {
      if (!organizationId) throw new Error('No organization');
      const lineKey = typeof args === 'string' ? args : args.lineKey;
      const section: ForecastSection = (typeof args === 'string' ? 'inflow' : args.section) ?? 'inflow';
      let q = (supabase as any)
        .from('cashflow_forecast_overrides')
        .delete()
        .eq('organization_id', organizationId)
        .eq('section', section)
        .eq('line_key', lineKey);
      q = selectedLocationId ? q.eq('location_id', selectedLocationId) : q.is('location_id', null);
      const { error } = await q;
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  // Rename a custom row (updates label on all its cells).
  const renameCustomRow = useMutation({
    mutationFn: async (args: { lineKey: string; label: string; section?: ForecastSection }) => {
      if (!organizationId) throw new Error('No organization');
      const section = args.section ?? 'inflow';
      let q = (supabase as any)
        .from('cashflow_forecast_overrides')
        .update({ line_label: args.label, updated_at: new Date().toISOString() })
        .eq('organization_id', organizationId)
        .eq('section', section)
        .eq('line_key', args.lineKey);
      q = selectedLocationId ? q.eq('location_id', selectedLocationId) : q.is('location_id', null);
      const { error } = await q;
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  // Upsert/clear a per-week "Decisions Made" note. Stored as section 'note',
  // line_key 'decision', text in line_label (amount unused, kept 0). Empty text
  // deletes the note row.
  const setNote = useMutation({
    mutationFn: async (args: { weekStart: string; text: string }) => {
      if (!organizationId) throw new Error('No organization');
      const text = args.text.trim();
      if (!text) {
        let dq = (supabase as any)
          .from('cashflow_forecast_overrides')
          .delete()
          .eq('organization_id', organizationId)
          .eq('section', 'note')
          .eq('week_start', args.weekStart)
          .eq('line_key', 'decision');
        dq = selectedLocationId ? dq.eq('location_id', selectedLocationId) : dq.is('location_id', null);
        const { error } = await dq;
        if (error) throw error;
        return;
      }
      const { error } = await (supabase as any)
        .from('cashflow_forecast_overrides')
        .upsert(
          {
            organization_id: organizationId,
            location_id: selectedLocationId ?? null,
            section: 'note',
            week_start: args.weekStart,
            line_key: 'decision',
            line_label: text.slice(0, 255),
            amount: 0,
            created_by: user?.id ?? null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'organization_id,location_id,week_start,section,line_key' },
        );
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  // Upsert/clear an Auto or Repeating rule for a row. Stored once per scope as
  // section 'rule' with the config JSON in line_label (amount unused, kept 0),
  // pinned to the anchor week. Passing rule === null removes the automation.
  const setRule = useMutation({
    mutationFn: async (args: { lineKey: string; rule: ForecastRule | null }) => {
      if (!organizationId) throw new Error('No organization');
      const anchor = weeks[0]?.iso;
      if (args.rule === null) {
        let dq = (supabase as any)
          .from('cashflow_forecast_overrides')
          .delete()
          .eq('organization_id', organizationId)
          .eq('section', 'rule')
          .eq('line_key', args.lineKey);
        dq = selectedLocationId ? dq.eq('location_id', selectedLocationId) : dq.is('location_id', null);
        const { error } = await dq;
        if (error) throw error;
        return;
      }
      // Drop default/empty top-level fields so the JSON stays compact (readers
      // re-apply defaults via ??). Keeps multi-input Linked rules within the
      // line_label budget. Cap is generous for TEXT columns post-migration.
      const compact: Record<string, unknown> = {};
      Object.entries(args.rule).forEach(([k, v]) => {
        if (v === undefined || v === null || v === '' || v === false) return;
        if (Array.isArray(v) && v.length === 0) return;
        compact[k] = v;
      });
      const { error } = await (supabase as any)
        .from('cashflow_forecast_overrides')
        .upsert(
          {
            organization_id: organizationId,
            location_id: selectedLocationId ?? null,
            section: 'rule',
            week_start: anchor,
            line_key: args.lineKey,
            line_label: JSON.stringify(compact).slice(0, 2000),
            amount: 0,
            created_by: user?.id ?? null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'organization_id,location_id,week_start,section,line_key' },
        );
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  // Upsert/clear a per-line PROJECTION METHOD for a row. Stored once per scope as
  // section 'method' with the config JSON in line_label (amount unused), pinned to
  // the anchor week. Passing cfg === null clears the override (the row goes back to
  // inheriting the global income/cost method default).
  const setMethod = useMutation({
    mutationFn: async (args: { lineKey: string; cfg: LineMethodConfig | null }) => {
      if (!organizationId) throw new Error('No organization');
      const anchor = weeks[0]?.iso;
      if (args.cfg === null) {
        let dq = (supabase as any)
          .from('cashflow_forecast_overrides')
          .delete()
          .eq('organization_id', organizationId)
          .eq('section', 'method')
          .eq('line_key', args.lineKey);
        dq = selectedLocationId ? dq.eq('location_id', selectedLocationId) : dq.is('location_id', null);
        const { error } = await dq;
        if (error) throw error;
        return;
      }
      const { error } = await (supabase as any)
        .from('cashflow_forecast_overrides')
        .upsert(
          {
            organization_id: organizationId,
            location_id: selectedLocationId ?? null,
            section: 'method',
            week_start: anchor,
            line_key: args.lineKey,
            line_label: JSON.stringify(args.cfg).slice(0, 2000),
            amount: 0,
            created_by: user?.id ?? null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'organization_id,location_id,week_start,section,line_key' },
        );
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  // Clear EVERY per-line projection-method override for this scope (used by
  // "Reset to default" so the table returns to the original Smart logic, not just
  // the global settings). Per-cell edits / rules / thresholds are left untouched.
  const clearLineMethods = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error('No organization');
      let dq = (supabase as any)
        .from('cashflow_forecast_overrides')
        .delete()
        .eq('organization_id', organizationId)
        .eq('section', 'method');
      dq = selectedLocationId ? dq.eq('location_id', selectedLocationId) : dq.is('location_id', null);
      const { error } = await dq;
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  // ── Per-cell comment THREADS (cashflow_forecast_comments) ──
  // Many comments per cell from multiple users, scoped to the org+location.
  // Keyed `${lineKey}|${weekIso}` to match the page's commentKey().
  const commentsQuery = useQuery({
    queryKey: ['cashflow-forecast-comments', organizationId, selectedLocationId ?? 'all'],
    enabled: !!organizationId,
    staleTime: 60 * 1000,
    queryFn: async (): Promise<Map<string, ForecastComment[]>> => {
      const map = new Map<string, ForecastComment[]>();
      if (!organizationId) return map;
      let q = (supabase as any)
        .from('cashflow_forecast_comments')
        .select('id, week_start, line_key, comment, author_name, author_email, created_by, created_at')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: true });
      q = selectedLocationId ? q.eq('location_id', selectedLocationId) : q.is('location_id', null);
      const { data, error } = await q;
      if (error) return map; // never let comments break the forecast
      for (const r of (data ?? []) as Array<Record<string, unknown>>) {
        const key = `${String(r.line_key)}|${String(r.week_start)}`;
        const arr = map.get(key) ?? [];
        arr.push({
          id: String(r.id),
          text: String(r.comment ?? ''),
          authorName: String(r.author_name || r.author_email || 'Unknown'),
          createdAt: String(r.created_at),
          isOwn: !!user?.id && r.created_by === user.id,
        });
        map.set(key, arr);
      }
      return map;
    },
  });
  const invalidateComments = () =>
    queryClient.invalidateQueries({ queryKey: ['cashflow-forecast-comments', organizationId] });

  // Append a comment to a cell's thread (one row per comment — never an upsert).
  const addComment = useMutation({
    mutationFn: async (args: { weekStart: string; lineKey: string; text: string }) => {
      if (!organizationId) throw new Error('No organization');
      const text = args.text.trim();
      if (!text) return;
      const { error } = await (supabase as any)
        .from('cashflow_forecast_comments')
        .insert({
          organization_id: organizationId,
          location_id: selectedLocationId ?? null,
          week_start: args.weekStart,
          line_key: args.lineKey,
          comment: text.slice(0, 4000),
          author_name: profile?.full_name ?? null,
          author_email: profile?.email ?? user?.email ?? null,
          created_by: user?.id ?? null,
        });
      if (error) throw error;
    },
    onSuccess: invalidateComments,
  });

  // Delete one comment (RLS enforces delete-own-only).
  const deleteComment = useMutation({
    mutationFn: async (args: { id: string }) => {
      const { error } = await (supabase as any)
        .from('cashflow_forecast_comments')
        .delete()
        .eq('id', args.id);
      if (error) throw error;
    },
    onSuccess: invalidateComments,
  });

  return {
    weeks,
    anchorMonday,
    churnRate,
    setChurnRate,
    // Per-location forecast-generation settings (the Settings drawer): the resolved
    // assumptions, plus save/reset and load/save flags. Scoped to the selected
    // location (null = all locations).
    forecastSettings,
    forecastSettingsEditable: !!selectedLocationId,
    saveForecastSettings: forecastSettingsApi.save,
    // Reset BOTH the global settings AND every per-line method override, so the
    // forecast table returns to the original Smart logic (not just the global knobs).
    resetForecastSettings: () => { forecastSettingsApi.reset(); clearLineMethods.mutate(); },
    forecastSettingsSaving: forecastSettingsApi.isSaving || clearLineMethods.isPending,
    ...forecast,
    // Private row data source (per selected location), read-only — reactive, so
    // kept out of the forecast memo. Set centrally via Revenue Settings.
    privateSource: (privateSourceQuery.data ?? 'pms') as 'pms' | 'accounting',
    isLoading: privateQuery.isLoading || membershipQuery.isLoading || udaSettingsQuery.isLoading || overridesQuery.isLoading,
    // The outflow (weekly cost) query is intentionally not part of isLoading so
    // the table renders before it; the AI prediction waits on this flag instead.
    outflowLoading: outflowWeeklyQuery.isLoading,
    // Block (Investing/Financing/Tax/Inter-Company) data also feeds the AI run,
    // so the prediction waits for these too.
    blockLoading: blockActualsQuery.isLoading || blockPipelineQuery.isLoading,
    error: privateQuery.error || membershipQuery.error || udaSettingsQuery.error || overridesQuery.error,
    setCell,
    addCustomRow,
    removeCustomRow,
    renameCustomRow,
    setNote,
    setRule,
    // Per-line projection-method override (null clears → inherit global default).
    setMethod: (lineKey: string, cfg: LineMethodConfig | null) => setMethod.mutate({ lineKey, cfg }),
    // Per-cell comment threads (multi-user, org+location scoped). Overrides the
    // single-comment map that the forecast memo still builds from old data.
    comments: commentsQuery.data ?? new Map<string, ForecastComment[]>(),
    addComment,
    deleteComment,
    // Per-account billing cadence (keyed by lower-cased CoA id/code), detected from
    // real ACCPAY invoices. Drives cost-row AI cadence + tooltip.
    costCadence: costCadenceQuery.data ?? ({} as Record<string, CadenceInfo>),
  };
}
