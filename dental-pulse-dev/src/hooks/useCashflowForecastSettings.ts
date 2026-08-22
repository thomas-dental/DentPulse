import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

// ─────────────────────────────────────────────────────────────────────────────
// 13-Week Cash Flow Forecast — per-location GENERATION settings.
//
// These are the assumptions the deterministic forecast engine
// (useCashflowForecast) uses when it projects the trailing pattern forward.
// They used to be hardcoded constants; exposing them lets each practice build
// the forecast to their own expectations. Every default below equals the
// engine's previous hardcoded constant, so an org with no saved settings gets
// exactly the old behaviour.
//
// Persisted in `cashflow_forecast_settings` as a single JSONB blob per
// (organization, location). NULL location = the "all locations" scope.
// ─────────────────────────────────────────────────────────────────────────────

export type ForecastPreset = 'expected' | 'optimistic' | 'pessimistic' | 'custom';

// ── Revenue scenario (Best / Most likely / Worst case) ───────────────────────
// A FLAT % uplift applied to the PROJECTED income cells (NHS + Private + Denplan).
// `active = null` is the base case (no uplift → reconciled figures untouched).
// Each case keeps its own editable %, so a practice can tune what "best" means.
export type ScenarioKey = 'best' | 'likely' | 'worst';
export const SCENARIO_KEYS: ScenarioKey[] = ['best', 'likely', 'worst'];
export const SCENARIO_LABELS: Record<ScenarioKey, string> = {
  best: 'Best case',
  likely: 'Most likely',
  worst: 'Worst case',
};
export interface ForecastScenario {
  active: ScenarioKey | null;  // null = base case (no uplift)
  bestPct: number;             // default +20
  likelyPct: number;           // default +10
  worstPct: number;            // default −5
}
export const DEFAULT_SCENARIO: ForecastScenario = { active: null, bestPct: 20, likelyPct: 10, worstPct: -5 };
/** The active case's % (0 when base case). */
export function scenarioPct(s: ForecastScenario): number {
  if (!s.active) return 0;
  return s.active === 'best' ? s.bestPct : s.active === 'likely' ? s.likelyPct : s.worstPct;
}
/** Multiplier the engine applies to projected income cells (1 = no change). */
export function scenarioFactor(s: ForecastScenario): number {
  return 1 + scenarioPct(s) / 100;
}

// How a projectable line turns its trailing history into the next 13 weeks.
//   auto    — the engine's smart default (private: avg + momentum trend + booked
//             appointments; costs: the cadence/known-bill/appointment waterfall)
//   average — flat: every forecast week = the trailing weekly average
//   repeat  — replay the trailing weeks as-is, slot for slot
//   manual  — the user's own number: a growth % per month, or a fixed £/week
export type ForecastMethod = 'auto' | 'average' | 'repeat' | 'manual';

/** A projection-method choice for one line (global family default or per-line override). */
export interface LineMethodConfig {
  method: ForecastMethod;
  /** Manual growth, % per month (method = 'manual', when not a fixed amount). */
  growthPct?: number;
  /** Manual fixed £ per week (method = 'manual'); per-line only. Overrides growthPct. */
  fixed?: number;
}

// The four lower cash-flow blocks that get their own per-section method default
// (Operations is covered by the Income + Cost methods above).
export type ForecastSectionKey = 'investing' | 'financing' | 'tax' | 'intercompany';
export const FORECAST_SECTION_KEYS: ForecastSectionKey[] = ['investing', 'financing', 'tax', 'intercompany'];
export const FORECAST_SECTION_LABELS: Record<ForecastSectionKey, string> = {
  investing: 'Investing',
  financing: 'Financing',
  tax: 'Tax & Grant',
  intercompany: 'Inter-Company',
};

export interface ForecastSettings {
  /** Bundled scenario; selecting one sets the knobs below. 'custom' = hand-tuned. */
  preset: ForecastPreset;
  /** Default projection method for the Private income line. */
  incomeMethod: ForecastMethod;
  /** Manual income growth, % per month (used when incomeMethod = 'manual'). */
  incomeManualGrowthMonthlyPct: number;
  /** Default projection method for the operating cost lines (Direct Costs + Overheads). */
  costMethod: ForecastMethod;
  /** Manual cost growth, % per month (used when costMethod = 'manual'). */
  costManualGrowthMonthlyPct: number;
  /** Per-section method default for the four lower blocks (Investing/Financing/Tax/Inter-Company). */
  sectionMethods: Record<ForecastSectionKey, LineMethodConfig>;
  /** The projection methods apply ONLY to these forecast weeks (1-based week numbers).
   *  Weeks not listed stay on the default 'Smart' projection. All weeks selected =
   *  methods apply everywhere. */
  methodWeeks: number[];
  /** Uplift applied to projected cost rows, % per MONTH (compounded weekly forward). */
  costInflationWeeklyPct: number;
  /** Max ± per-week drift the trailing-trend projection may apply (private + costs). */
  trendCapWeeklyPct: number;
  /** Denplan membership annual attrition assumption, %. */
  membershipChurnAnnualPct: number;
  /** Day of month (1–28) the Denplan membership cash lands. */
  membershipPayDay: number;
  /** Best / Most-likely / Worst-case revenue scenario (flat income uplift; opt-in). */
  scenario: ForecastScenario;
  /** The full tabbed-module settings (Income / Costs / Distribution / Denplan / Locations). */
  module: ForecastModuleSettings;
}

// ── The rich tabbed Forecast Settings module ──────────────────────────────────
// Note on wiring: fields marked (live) feed the engine today; the rest are SAVED
// and applied as the engine grows to support them.
export interface ForecastModuleSettings {
  income: {
    includeNHS: boolean;            // (live)
    includePrivate: boolean;        // (live)
    includeDenplan: boolean;        // (live)
    baseMethod: 'rolling_4w' | 'rolling_8w' | 'prior_year' | 'manual';
    growthRatePct: number;
    /** Optional cap on the NHS income projection. 0 = no cap. Applied per week or per
     *  month (the NHS lump is clipped so it never projects above this). */
    nhsIncomeCap: number;
    nhsIncomeCapUnit: 'week' | 'month';
    xeroInvoiceLagDays: number;
    paymentTermsDays: number;
    settlementDelayDays: number;
  };
  costs: {
    includeAssociatePay: boolean;
    associatePayRatePct: number;
    includeSupportStaff: boolean;
    supportStaffMonthly: number;
    employerNiPct: number;
    pensionPct: number;
    fixedLabBudgetMonthly: number;
    labFeesSource: 'actual_xero' | 'pct_income' | 'fixed_budget';
    consumablesPctOfIncome: number;
    /** Fixed monthly £ budget per REAL cost account, keyed by the account's row label.
     *  0 / absent = use real data; a value replaces that account's row with a flat budget.
     *  (Replaced the old generic Rent/Utilities/… categories + account-picker dropdowns.) */
    fixedAccountBudgets: Record<string, number>;
    /** Which account the associate-pay and support-staff formulas REPLACE ('' = none). */
    staffAccounts: { associate: string; support: string };
  };
  distribution: {
    workingDays: { mon: number; tue: number; wed: number; thu: number; fri: number; sat: number; sun: number };
    excludeBankHolidays: boolean;
    redistributeBankHoliday: boolean;
    holidayRegion: 'england_wales' | 'scotland' | 'northern_ireland';
    applySeasonality: boolean;
    schoolHolidayReductionPct: number;
    decemberWindDownPct: number;
  };
  denplan: {
    transactionFee: number;
    defaultDiscountPct: number;
    settlementFrequency: 'monthly_1st' | 'monthly_15th' | 'weekly';
    bandA: number; bandB: number; bandC: number; bandD: number; childrens: number; hygieneAddon: number;
    /** Per-plan monthly-fee overrides, keyed by payment-plan id. Empty = use the real Dentally fee. */
    planFees: Record<string, number>;
    monthlyMemberGrowthPct: number;
    monthlyChurnPct: number;       // (live — overrides annual churn when set)
  };
  locations: {
    activeLocations: Record<string, boolean>;  // locationId → included
    forecastView: 'combined' | 'side_by_side' | 'separate';
    costAllocation: 'by_income' | 'equal' | 'manual';
    scopePatientsBySubquery: boolean;
    unscopedFallback: 'exclude' | 'primary' | 'split';
  };
}

export const DEFAULT_MODULE_SETTINGS: ForecastModuleSettings = {
  income: {
    includeNHS: true, includePrivate: true, includeDenplan: true,
    baseMethod: 'rolling_4w', growthRatePct: 2.5, nhsIncomeCap: 0, nhsIncomeCapUnit: 'month',
    xeroInvoiceLagDays: 0, paymentTermsDays: 30, settlementDelayDays: 0,
  },
  costs: {
    // Staff formulas default OFF (opt-in): when enabled they REPLACE the picked account
    // row, so leaving them off keeps your real, reconciled labour costs.
    includeAssociatePay: false, associatePayRatePct: 50, includeSupportStaff: false, supportStaffMonthly: 0, employerNiPct: 13.8, pensionPct: 3,
    // Cost-OVERRIDE fields default to 0 = "blank / use my real data". Under the
    // replace-when-set rule, a 0 leaves the data-driven cost row untouched; a value
    // > 0 replaces that row. (Placeholders removed so defaults never override the
    // reconciled figures.)
    fixedLabBudgetMonthly: 0,
    labFeesSource: 'actual_xero', consumablesPctOfIncome: 0,
    fixedAccountBudgets: {},
    staffAccounts: { associate: '', support: '' },
  },
  distribution: {
    workingDays: { mon: 100, tue: 100, wed: 100, thu: 100, fri: 80, sat: 40, sun: 0 },
    excludeBankHolidays: false, redistributeBankHoliday: false, holidayRegion: 'england_wales',
    // Seasonality defaults OFF (opt-in): when on it scales seasonal weeks, so leaving it
    // off guarantees the reconciled baseline is unchanged until the user enables it.
    applySeasonality: false, schoolHolidayReductionPct: 15, decemberWindDownPct: 25,
  },
  denplan: {
    transactionFee: 1.36, defaultDiscountPct: 0, settlementFrequency: 'monthly_1st',
    bandA: 18.5, bandB: 24, bandC: 31.5, bandD: 42, childrens: 8, hygieneAddon: 9,
    planFees: {},
    monthlyMemberGrowthPct: 0, monthlyChurnPct: 1.2,
  },
  locations: {
    activeLocations: {}, forecastView: 'combined', costAllocation: 'by_income',
    scopePatientsBySubquery: true, unscopedFallback: 'exclude',
  },
};

// Merge a raw module blob over the defaults (shallow-per-section is enough here).
function resolveModule(raw: Partial<ForecastModuleSettings> | null | undefined): ForecastModuleSettings {
  const d = DEFAULT_MODULE_SETTINGS;
  const r = raw ?? {};
  return {
    income: { ...d.income, ...(r.income ?? {}) },
    costs: { ...d.costs, ...(r.costs ?? {}), fixedAccountBudgets: { ...d.costs.fixedAccountBudgets, ...((r.costs ?? {}).fixedAccountBudgets ?? {}) }, staffAccounts: { ...d.costs.staffAccounts, ...((r.costs ?? {}).staffAccounts ?? {}) } },
    distribution: { ...d.distribution, ...(r.distribution ?? {}), workingDays: { ...d.distribution.workingDays, ...((r.distribution ?? {}).workingDays ?? {}) } },
    denplan: { ...d.denplan, ...(r.denplan ?? {}), planFees: { ...((r.denplan ?? {}).planFees ?? {}) } },
    locations: { ...d.locations, ...(r.locations ?? {}), activeLocations: { ...((r.locations ?? {}).activeLocations ?? {}) } },
  };
}

// All 13 forecast weeks (the default scope — methods apply to every week).
export const ALL_FORECAST_WEEKS: number[] = Array.from({ length: 13 }, (_, i) => i + 1);

// Every lower block defaulting to 'auto' (the engine's existing smart baseline).
const allAutoSections = (): Record<ForecastSectionKey, LineMethodConfig> => ({
  investing: { method: 'auto' },
  financing: { method: 'auto' },
  tax: { method: 'auto' },
  intercompany: { method: 'auto' },
});

// Defaults — each equals the engine's old hardcoded behaviour ('auto' methods).
export const DEFAULT_FORECAST_SETTINGS: ForecastSettings = {
  preset: 'expected',
  incomeMethod: 'auto',
  incomeManualGrowthMonthlyPct: 0,
  costMethod: 'auto',
  costManualGrowthMonthlyPct: 0,
  sectionMethods: allAutoSections(),
  methodWeeks: [...ALL_FORECAST_WEEKS],
  costInflationWeeklyPct: 0,
  trendCapWeeklyPct: 2,        // ±2%/week — matches the old clamp
  membershipChurnAnnualPct: 5, // 5% — matches MEMBERSHIP_ANNUAL_CHURN_RATE
  membershipPayDay: 15,        // matches MEMBERSHIP_PAY_DAY
  scenario: { ...DEFAULT_SCENARIO },
  module: DEFAULT_MODULE_SETTINGS,
};

// The knob values each scenario preset applies (everything except `preset`).
export const FORECAST_PRESETS: Record<Exclude<ForecastPreset, 'custom'>, Omit<ForecastSettings, 'preset'>> = {
  expected: {
    incomeMethod: 'auto',
    incomeManualGrowthMonthlyPct: 0,
    costMethod: 'auto',
    costManualGrowthMonthlyPct: 0,
    sectionMethods: allAutoSections(),
    methodWeeks: [...ALL_FORECAST_WEEKS],
    costInflationWeeklyPct: 0,
    trendCapWeeklyPct: 2,
    membershipChurnAnnualPct: 5,
    membershipPayDay: 15,
    scenario: { ...DEFAULT_SCENARIO },
    module: DEFAULT_MODULE_SETTINGS,
  },
  optimistic: {
    incomeMethod: 'manual',
    incomeManualGrowthMonthlyPct: 1.5,
    costMethod: 'auto',
    costManualGrowthMonthlyPct: 0,
    sectionMethods: allAutoSections(),
    methodWeeks: [...ALL_FORECAST_WEEKS],
    costInflationWeeklyPct: 0,
    trendCapWeeklyPct: 3,
    membershipChurnAnnualPct: 0,
    membershipPayDay: 15,
    scenario: { ...DEFAULT_SCENARIO },
    module: DEFAULT_MODULE_SETTINGS,
  },
  pessimistic: {
    incomeMethod: 'manual',
    incomeManualGrowthMonthlyPct: -1,
    costMethod: 'auto',
    costManualGrowthMonthlyPct: 0,
    sectionMethods: allAutoSections(),
    methodWeeks: [...ALL_FORECAST_WEEKS],
    costInflationWeeklyPct: 1,
    trendCapWeeklyPct: 1,
    membershipChurnAnnualPct: 10,
    membershipPayDay: 15,
    scenario: { ...DEFAULT_SCENARIO },
    module: DEFAULT_MODULE_SETTINGS,
  },
};

const METHODS: ForecastMethod[] = ['auto', 'average', 'repeat', 'manual'];
const asMethod = (v: unknown, fallback: ForecastMethod): ForecastMethod =>
  METHODS.includes(v as ForecastMethod) ? (v as ForecastMethod) : fallback;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Merge a raw (possibly partial / null) settings blob over the defaults, clamped to safe ranges. */
export function resolveForecastSettings(raw: Partial<ForecastSettings> | null | undefined): ForecastSettings {
  const r = (raw ?? {}) as Partial<ForecastSettings> & { privateGrowthMode?: string; privateGrowthMonthlyPct?: number };
  const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
  // Back-compat: the first version stored privateGrowthMode/privateGrowthMonthlyPct.
  // Map them onto the new income method when the new key is absent.
  const legacyIncomeManual = r.incomeMethod === undefined && r.privateGrowthMode === 'manual';
  const incomeMethod = r.incomeMethod !== undefined
    ? asMethod(r.incomeMethod, DEFAULT_FORECAST_SETTINGS.incomeMethod)
    : (legacyIncomeManual ? 'manual' : DEFAULT_FORECAST_SETTINGS.incomeMethod);
  const incomeGrowth = r.incomeManualGrowthMonthlyPct !== undefined
    ? r.incomeManualGrowthMonthlyPct
    : (r.privateGrowthMonthlyPct ?? DEFAULT_FORECAST_SETTINGS.incomeManualGrowthMonthlyPct);
  return {
    preset: (['expected', 'optimistic', 'pessimistic', 'custom'] as const).includes(r.preset as ForecastPreset)
      ? (r.preset as ForecastPreset)
      : DEFAULT_FORECAST_SETTINGS.preset,
    incomeMethod,
    incomeManualGrowthMonthlyPct: clamp(num(incomeGrowth, DEFAULT_FORECAST_SETTINGS.incomeManualGrowthMonthlyPct), -50, 50),
    costMethod: asMethod(r.costMethod, DEFAULT_FORECAST_SETTINGS.costMethod),
    costManualGrowthMonthlyPct: clamp(num(r.costManualGrowthMonthlyPct, DEFAULT_FORECAST_SETTINGS.costManualGrowthMonthlyPct), -50, 50),
    sectionMethods: {
      investing: resolveLineMethod(r.sectionMethods?.investing),
      financing: resolveLineMethod(r.sectionMethods?.financing),
      tax: resolveLineMethod(r.sectionMethods?.tax),
      intercompany: resolveLineMethod(r.sectionMethods?.intercompany),
    },
    costInflationWeeklyPct: clamp(num(r.costInflationWeeklyPct, DEFAULT_FORECAST_SETTINGS.costInflationWeeklyPct), -20, 20),
    trendCapWeeklyPct: clamp(num(r.trendCapWeeklyPct, DEFAULT_FORECAST_SETTINGS.trendCapWeeklyPct), 0, 25),
    membershipChurnAnnualPct: clamp(num(r.membershipChurnAnnualPct, DEFAULT_FORECAST_SETTINGS.membershipChurnAnnualPct), 0, 100),
    membershipPayDay: clamp(Math.round(num(r.membershipPayDay, DEFAULT_FORECAST_SETTINGS.membershipPayDay)), 1, 28),
    scenario: resolveScenario(r.scenario),
    methodWeeks: resolveMethodWeeks((r as { methodWeeks?: unknown }).methodWeeks),
    module: resolveModule((r as { module?: Partial<ForecastModuleSettings> }).module),
  };
}

/** Normalise a stored scenario blob: valid active key + %s clamped to a sane range. */
function resolveScenario(raw: Partial<ForecastScenario> | null | undefined): ForecastScenario {
  const r = raw ?? {};
  const active = SCENARIO_KEYS.includes(r.active as ScenarioKey) ? (r.active as ScenarioKey) : null;
  const pct = (v: unknown, fb: number) => clamp(typeof v === 'number' && Number.isFinite(v) ? v : fb, -100, 500);
  return {
    active,
    bestPct: pct(r.bestPct, DEFAULT_SCENARIO.bestPct),
    likelyPct: pct(r.likelyPct, DEFAULT_SCENARIO.likelyPct),
    worstPct: pct(r.worstPct, DEFAULT_SCENARIO.worstPct),
  };
}

/** Sanitise the selected method weeks: integers in [1..13], deduped + sorted.
 *  Missing key → all weeks; an explicit empty array is respected (methods nowhere). */
function resolveMethodWeeks(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [...ALL_FORECAST_WEEKS];
  const set = new Set<number>();
  for (const n of raw) if (Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 13) set.add(n as number);
  return [...set].sort((a, b) => a - b);
}

/** Normalise a per-line method config (from stored JSON) into a safe LineMethodConfig. */
export function resolveLineMethod(raw: Partial<LineMethodConfig> | null | undefined): LineMethodConfig {
  const r = raw ?? {};
  const method = asMethod(r.method, 'auto');
  const cfg: LineMethodConfig = { method };
  if (method === 'manual') {
    if (typeof r.fixed === 'number' && Number.isFinite(r.fixed)) cfg.fixed = Math.max(0, r.fixed);
    else cfg.growthPct = clamp(typeof r.growthPct === 'number' && Number.isFinite(r.growthPct) ? r.growthPct : 0, -50, 50);
  }
  return cfg;
}

/** Equality of two per-line/section method configs (method + the manual params). */
function sameMethod(a: LineMethodConfig, b: LineMethodConfig): boolean {
  return a.method === b.method && (a.growthPct ?? 0) === (b.growthPct ?? 0) && (a.fixed ?? null) === (b.fixed ?? null);
}

/** Does a resolved settings object exactly match a named preset's knobs? (used to keep `preset` honest) */
export function matchesPreset(s: ForecastSettings, preset: Exclude<ForecastPreset, 'custom'>): boolean {
  const p = FORECAST_PRESETS[preset];
  return (
    s.incomeMethod === p.incomeMethod &&
    s.incomeManualGrowthMonthlyPct === p.incomeManualGrowthMonthlyPct &&
    s.costMethod === p.costMethod &&
    s.costManualGrowthMonthlyPct === p.costManualGrowthMonthlyPct &&
    FORECAST_SECTION_KEYS.every((k) => sameMethod(s.sectionMethods[k], p.sectionMethods[k])) &&
    s.methodWeeks.join(',') === p.methodWeeks.join(',') &&
    s.costInflationWeeklyPct === p.costInflationWeeklyPct &&
    s.trendCapWeeklyPct === p.trendCapWeeklyPct &&
    s.membershipChurnAnnualPct === p.membershipChurnAnnualPct &&
    s.membershipPayDay === p.membershipPayDay
  );
}

export interface UseCashflowForecastSettings {
  settings: ForecastSettings;          // resolved (defaults merged) — safe to consume directly
  isLoading: boolean;
  isSaving: boolean;
  /** Persist a full settings object for the current scope (upsert). */
  save: (next: ForecastSettings) => void;
  /** Reset the scope back to the built-in defaults (Expected). */
  reset: () => void;
}

/**
 * Loads / saves the forecast-generation settings for one (organization, location)
 * scope. `locationId` null = the all-locations default row.
 */
export function useCashflowForecastSettings(
  organizationId: string | null | undefined,
  locationId: string | null | undefined,
): UseCashflowForecastSettings {
  const queryClient = useQueryClient();
  const loc = locationId ?? null;
  const queryKey = ['cashflow-forecast-settings', organizationId ?? 'none', loc ?? 'all'];

  const query = useQuery({
    queryKey,
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<Partial<ForecastSettings> | null> => {
      if (!organizationId) return null;
      let q = (supabase as any)
        .from('cashflow_forecast_settings')
        .select('settings')
        .eq('organization_id', organizationId);
      q = loc ? q.eq('location_id', loc) : q.is('location_id', null);
      const { data, error } = await q.maybeSingle();
      if (error) throw error;
      return (data?.settings ?? null) as Partial<ForecastSettings> | null;
    },
  });

  const upsert = useMutation({
    mutationFn: async (next: ForecastSettings) => {
      if (!organizationId) throw new Error('No organization');
      const { error } = await (supabase as any)
        .from('cashflow_forecast_settings')
        .upsert(
          { organization_id: organizationId, location_id: loc, settings: next, updated_at: new Date().toISOString() },
          { onConflict: 'organization_id,location_id' },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast.success('Forecast settings saved');
    },
    onError: (e: any) => toast.error(e?.message ? `Couldn't save settings: ${e.message}` : "Couldn't save forecast settings"),
  });

  const settings = useMemo(() => resolveForecastSettings(query.data), [query.data]);

  return {
    settings,
    isLoading: query.isLoading,
    isSaving: upsert.isPending,
    save: (next: ForecastSettings) => upsert.mutate(next),
    reset: () => upsert.mutate({ ...DEFAULT_FORECAST_SETTINGS }),
  };
}
