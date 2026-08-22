import { useEffect, useState, type ReactNode } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { RotateCcw } from 'lucide-react';
import { useMembershipProviderLabel } from '@/lib/membershipProviderLabel';
import {
  type ForecastSettings,
  type ForecastPreset,
  type ForecastMethod,
  type ForecastSectionKey,
  type LineMethodConfig,
  type ForecastModuleSettings,
  type ForecastScenario,
  type ScenarioKey,
  FORECAST_SECTION_KEYS,
  FORECAST_SECTION_LABELS,
  SCENARIO_KEYS,
  SCENARIO_LABELS,
  DEFAULT_FORECAST_SETTINGS,
  matchesPreset,
} from '@/hooks/useCashflowForecastSettings';

// ─────────────────────────────────────────────────────────────────────────────
// Forecast Settings drawer — lets a practice tune the ASSUMPTIONS the 13-week
// forecast engine uses to project the next weeks (growth, cost inflation, trend
// cap, membership churn / pay-day) and pick a bundled scenario preset. Scoped to
// the selected location.
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: ForecastSettings;
  saving: boolean;
  scopeLabel: string;
  /** The forecast weeks (1-based number, date label "22 Jun", and ISO week-start) for the week picker. */
  weekOptions: { weekNumber: number; label: string; iso: string }[];
  /** Locations available to the org (for the Locations tab toggles). */
  locations?: { id: string; name: string }[];
  /** Real Denplan/membership plans (name + monthly fee) for the Denplan tab. */
  membershipPlans?: { id: string; name: string; fee: number }[];
  /** This location's trailing weekly Private income (fallback for the preview). */
  incomeTrailing?: number[];
  /** The CURRENT forecast Private weekly values (the live table). The preview starts
   *  from these and shows how the selected method reshapes them. */
  incomeForecast?: number[];
  /** Cost/overhead account labels (for the fixed-budget "replaces…" account picker). */
  costAccounts?: string[];
  /** True when viewing a COMBINED forecast (no single location selected) — the only
   *  scope where the "Active locations" toggles apply. */
  groupScope?: boolean;
  onSave: (next: ForecastSettings) => void;
  onReset: () => void;
}

const CHURN_CHIPS = [0, 5, 8, 10];

// The projection-method choices offered for the forecast.
// Hints emphasise the DIFFERENCE between them (moves vs flat vs replays vs manual).
const METHOD_OPTIONS: { id: ForecastMethod; label: string; hint: string }[] = [
  { id: 'auto', label: 'Smart (recommended)', hint: 'Moves week to week — follows your recent up/down trend and booked appointments' },
  { id: 'average', label: 'Flat average', hint: 'The same amount every week — a flat line at the last-13-week average' },
  { id: 'repeat', label: 'Repeat last 13 weeks', hint: 'Replays each of the last 13 weeks exactly — keeps the real ups and downs' },
  { id: 'manual', label: 'Manual growth', hint: 'Starts at the average, then grows or shrinks by a % you set each month' },
];

/** Re-derive the preset name from the knobs so the chips stay honest after edits. */
function withDerivedPreset(s: Omit<ForecastSettings, 'preset'>): ForecastSettings {
  const full = { ...s, preset: 'custom' as ForecastPreset };
  for (const p of ['expected', 'optimistic', 'pessimistic'] as const) {
    if (matchesPreset(full, p)) return { ...s, preset: p };
  }
  return full;
}

type ModuleTab = 'income' | 'costs' | 'distribution' | 'denplan' | 'locations';

export function ForecastSettingsSheet({ open, onOpenChange, settings, saving, scopeLabel, weekOptions, locations = [], membershipPlans = [], incomeTrailing = [], incomeForecast = [], costAccounts = [], groupScope = false, onSave, onReset }: Props) {
  const [draft, setDraft] = useState<ForecastSettings>(settings);
  // Membership provider display name (Denplan for most orgs; e.g. Practice
  // Plan for The Old Surgery) — labels only, keys stay 'denplan'.
  const providerLabel = useMembershipProviderLabel();
  // Which settings tab is showing.
  const [tab, setTab] = useState<ModuleTab>('income');
  // Whether the "Apply to" multi-select week dropdown is open.
  const [weekPickerOpen, setWeekPickerOpen] = useState(false);

  // Snapshot the saved settings into the editable draft each time the drawer opens.
  useEffect(() => {
    if (!open) return;
    setDraft(settings);
  }, [open, settings]);

  // Update one or more knobs and re-derive whether the result is still a named preset.
  const setField = (patch: Partial<Omit<ForecastSettings, 'preset'>>) =>
    setDraft((d) => withDerivedPreset({ ...d, ...patch }));

  const setSectionMethod = (key: ForecastSectionKey, cfg: LineMethodConfig) =>
    setDraft((d) => withDerivedPreset({ ...d, sectionMethods: { ...d.sectionMethods, [key]: cfg } }));

  // ONE method for the whole forecast — sets both the income and cost method (and
  // their manual growth) together. (Per-line tweaks are still available on the table.)
  const unifiedMethod = draft.incomeMethod;
  const setUnifiedMethod = (m: ForecastMethod) => setDraft((d) => withDerivedPreset({ ...d, incomeMethod: m, costMethod: m }));
  const setUnifiedGrowth = (v: number) => setDraft((d) => withDerivedPreset({ ...d, incomeManualGrowthMonthlyPct: v, costManualGrowthMonthlyPct: v }));

  // Revenue scenario (Best / Most likely / Worst case) — a flat income uplift.
  const setScenario = (patch: Partial<ForecastScenario>) =>
    setDraft((d) => withDerivedPreset({ ...d, scenario: { ...d.scenario, ...patch } }));
  const scenarioPctField: Record<ScenarioKey, keyof ForecastScenario> = { best: 'bestPct', likely: 'likelyPct', worst: 'worstPct' };

  // ── Live preview ── starts from your CURRENT forecast Private values (the live
  // table) and shows how the SELECTED method reshapes them. The method applies ONLY to
  // the selected weeks; every other week keeps the current forecast value. Falls back
  // to trailing income if the live forecast isn't available.
  const previewN = weekOptions.length || 13;
  const previewHasForecast = incomeForecast.some((v) => (v || 0) !== 0);
  const previewBase = (previewHasForecast ? incomeForecast : incomeTrailing).slice(0, previewN);
  while (previewBase.length < previewN) previewBase.push(previewBase[previewBase.length - 1] ?? 0);
  // The PAST 13 weeks (actual takings). Repeat / Flat average / Manual are all defined
  // on the last 13 weeks (per the method hints), so they read from HERE — not from the
  // current forecast.
  const previewTrailing = incomeTrailing.slice(0, previewN);
  while (previewTrailing.length < previewN) previewTrailing.push(previewTrailing[previewTrailing.length - 1] ?? 0);
  const previewTrailingAvg = previewTrailing.reduce((s, x) => s + (x || 0), 0) / Math.max(1, previewN);
  const m2w = (pct: number) => Math.pow(1 + pct / 100, 1 / 4.345) - 1;
  // "Keep current" baseline = your existing forecast values (Smart, and the fallback for
  // any week a scoped method doesn't cover).
  const previewSmart = Array.from({ length: previewN }, (_, i) => Math.max(0, previewBase[i] ?? 0));
  // The chosen method's series:
  //   • Smart    → keep the current forecast
  //   • Repeat   → replay the past 13 weeks exactly
  //   • Flat avg → the last-13-week average, every week
  //   • Manual   → that average grown by the monthly %
  const previewMethodRaw = (() => {
    if (unifiedMethod === 'repeat') return Array.from({ length: previewN }, (_, i) => Math.max(0, previewTrailing[i] ?? 0));
    if (unifiedMethod === 'average') return Array.from({ length: previewN }, () => Math.max(0, previewTrailingAvg));
    if (unifiedMethod === 'manual') {
      const g = m2w(draft.incomeManualGrowthMonthlyPct);
      return Array.from({ length: previewN }, (_, i) => Math.max(0, previewTrailingAvg * Math.pow(1 + g, i + 1)));
    }
    return previewSmart; // auto (Smart) keeps the current forecast
  })();
  const previewWeekSet = new Set(draft.methodWeeks);
  const previewFullScope = previewWeekSet.size >= previewN;
  const isPreviewMethodWeek = (i: number) => previewFullScope || previewWeekSet.has(weekOptions[i]?.weekNumber ?? i + 1);
  // Blend: method value on the selected weeks, current forecast on the rest.
  const previewSeries = Array.from({ length: previewN }, (_, i) => (isPreviewMethodWeek(i) ? previewMethodRaw[i] : previewSmart[i]));
  const previewTotal = previewSeries.reduce((s, x) => s + x, 0);
  const gbp0 = (n: number) => '£' + Math.round(n).toLocaleString('en-GB');
  const hasPreview = previewHasForecast || incomeTrailing.some((v) => (v || 0) !== 0);

  const isAllWeeks = weekOptions.length > 0 && draft.methodWeeks.length === weekOptions.length;
  // Methods apply to EVERY week.
  const setAllMethodWeeks = () => {
    setDraft((d) => withDerivedPreset({ ...d, methodWeeks: weekOptions.map((w) => w.weekNumber) }));
  };
  // Multi-select: toggle a single week in/out of the chosen set (any combination).
  const toggleMethodWeek = (wk: number) => {
    setDraft((d) => {
      const has = d.methodWeeks.includes(wk);
      const next = has ? d.methodWeeks.filter((x) => x !== wk) : [...d.methodWeeks, wk].sort((a, b) => a - b);
      return withDerivedPreset({ ...d, methodWeeks: next });
    });
  };
  // Clear the selection (method then applies to no weeks — every week stays on Smart).
  const clearMethodWeeks = () => {
    setDraft((d) => withDerivedPreset({ ...d, methodWeeks: [] }));
  };
  // Summary shown on the collapsed "Apply to" dropdown button.
  const applyToSummary = draft.methodWeeks.length === 0
    ? 'No weeks'
    : isAllWeeks
      ? 'All weeks'
      : draft.methodWeeks.length === 1
        ? `Week of ${weekOptions.find((w) => w.weekNumber === draft.methodWeeks[0])?.label ?? draft.methodWeeks[0]}`
        : `${draft.methodWeeks.length} weeks selected`;
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);
  const isDefault = JSON.stringify({ ...draft }) === JSON.stringify(DEFAULT_FORECAST_SETTINGS);

  const numCls =
    'w-24 rounded-md border border-border bg-background px-2 py-1 text-right text-sm tabular-nums focus:border-primary focus:outline-none';

  // A family (Income / Cost) projection-method picker: a vertical list of methods
  // plus a growth input that appears when "Manual growth" is chosen.
  const methodSection = (
    title: string,
    blurb: string,
    method: ForecastMethod,
    onMethod: (m: ForecastMethod) => void,
    growthPct: number,
    onGrowth: (v: number) => void,
  ) => (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <p className="-mt-1 text-xs text-muted-foreground">{blurb}</p>
      <div className="space-y-1.5">
        {METHOD_OPTIONS.map((opt) => {
          const active = method === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onMethod(opt.id)}
              className={`flex w-full items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors ${
                active ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border hover:border-primary/50 hover:bg-muted/40'
              }`}
            >
              <span
                className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                  active ? 'border-primary' : 'border-muted-foreground/40'
                }`}
              >
                {active && <span className="h-2 w-2 rounded-full bg-primary" />}
              </span>
              <span>
                <span className={`block text-sm font-medium ${active ? 'text-primary' : 'text-foreground'}`}>{opt.label}</span>
                <span className="block text-[11px] leading-tight text-muted-foreground">{opt.hint}</span>
              </span>
            </button>
          );
        })}
      </div>
      {method === 'manual' && (
        <label className="flex items-center justify-between gap-3 pt-1">
          <span className="text-sm text-foreground">Growth per month</span>
          <span className="flex items-center gap-1">
            <input type="number" step={0.5} value={growthPct} onChange={(e) => onGrowth(Number(e.target.value))} className={numCls} />
            <span className="text-sm text-muted-foreground">%</span>
          </span>
        </label>
      )}
    </section>
  );

  // Compact per-section method row (a dropdown + inline growth) for the lower blocks.
  const sectionMethodRow = (key: ForecastSectionKey) => {
    const cfg = draft.sectionMethods[key];
    return (
      <div key={key} className="space-y-1.5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-foreground">{FORECAST_SECTION_LABELS[key]}</span>
          <select
            value={cfg.method}
            onChange={(e) => setSectionMethod(key, { method: e.target.value as ForecastMethod, growthPct: cfg.growthPct })}
            className="w-52 rounded-md border border-border bg-background px-2 py-1 text-sm focus:border-primary focus:outline-none"
          >
            <option value="auto">Smart (recommended)</option>
            <option value="average">Flat average</option>
            <option value="repeat">Repeat last 13 weeks</option>
            <option value="manual">Manual growth</option>
          </select>
        </div>
        {cfg.method === 'manual' && (
          <div className="flex items-center justify-end gap-1">
            <input
              type="number"
              step={0.5}
              value={cfg.growthPct ?? 0}
              onChange={(e) => setSectionMethod(key, { method: 'manual', growthPct: Number(e.target.value) })}
              className={numCls}
            />
            <span className="text-sm text-muted-foreground">% / month</span>
          </div>
        )}
      </div>
    );
  };

  // ── Module (rich tabbed settings) setters + compact render helpers ──
  // NOTE: these are plain functions called inline ({card(...)}), NOT <Component/> —
  // defining components in render and using them as JSX would remount inputs and
  // drop focus on every keystroke.
  const mod = draft.module;
  const setMod = <K extends keyof ForecastModuleSettings>(section: K, patch: Partial<ForecastModuleSettings[K]>) =>
    setDraft((d) => withDerivedPreset({ ...d, module: { ...d.module, [section]: { ...d.module[section], ...patch } } }));

  const sectionTitle = (t: string) => <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t}</div>;
  const card = (children: ReactNode) => <section className="mb-4 rounded-xl border border-border bg-card/40 p-4">{children}</section>;
  const rowCls = 'flex items-center justify-between gap-3 border-b border-border/60 py-2 last:border-0';
  const labelCol = (label: string, hint?: string) => (
    <div className="min-w-0">
      <div className="text-sm text-foreground">{label}</div>
      {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
  const toggleEl = (checked: boolean, onChange: (v: boolean) => void) => (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none ${checked ? 'bg-primary' : 'bg-zinc-300 dark:bg-zinc-600'}`}
    >
      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
    </button>
  );
  const toggleRow = (label: string, hint: string | undefined, checked: boolean, onChange: (v: boolean) => void) => (
    <div className={rowCls} key={label}>{labelCol(label, hint)}{toggleEl(checked, onChange)}</div>
  );
  const numRow = (label: string, hint: string | undefined, value: number, onChange: (v: number) => void, suffix?: string, step = 1, placeholder?: string) => (
    <div className={rowCls} key={label}>{labelCol(label, hint)}<span className="flex shrink-0 items-center gap-1"><input type="number" step={step} value={placeholder !== undefined && value === 0 ? '' : value} placeholder={placeholder} onChange={(e) => onChange(Number(e.target.value))} className={numCls} />{suffix && <span className="text-sm text-muted-foreground">{suffix}</span>}</span></div>
  );
  const selRow = (label: string, hint: string | undefined, value: string, options: { value: string; label: string }[], onChange: (v: string) => void) => (
    <div className={rowCls} key={label}>{labelCol(label, hint)}<select value={value} onChange={(e) => onChange(e.target.value)} className="shrink-0 rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:border-primary focus:outline-none">{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
  );
  const gridCard = (label: string, value: number, onChange: (v: number) => void, step = 1, placeholder?: string) => (
    <div className="rounded-md border border-border bg-background p-2.5" key={label}>
      <label className="mb-1 block text-[11px] text-muted-foreground">{label}</label>
      <input type="number" step={step} value={placeholder !== undefined && value === 0 ? '' : value} placeholder={placeholder} onChange={(e) => onChange(Number(e.target.value))} className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm focus:border-primary focus:outline-none" />
    </div>
  );
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-[860px]">
        <SheetHeader>
          <SheetTitle>Forecast settings</SheetTitle>
          <SheetDescription>
            How the next 13 weeks are projected for <span className="font-medium text-foreground">{scopeLabel}</span>.
            These change the predicted figures only — your actuals and manual edits are untouched.
          </SheetDescription>
        </SheetHeader>

        {/* ── Tabs (boxed) ── */}
        <div className="mt-4 flex flex-wrap gap-2">
          {([
            { id: 'income', label: 'Income logic' },
            { id: 'costs', label: 'Costs & overheads' },
            { id: 'distribution', label: 'Weekly distribution' },
            { id: 'denplan', label: providerLabel },
            { id: 'locations', label: 'Locations' },
          ] as const).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`shrink-0 whitespace-nowrap rounded-md border px-3 py-1.5 text-sm transition-colors ${
                tab === t.id
                  ? 'border-primary bg-primary/5 font-medium text-primary'
                  : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="mt-5">
          {/* ════ INCOME LOGIC ════ */}
          {tab === 'income' && (
            <>
              {card(<>
                {sectionTitle('Income categories to include')}
                {toggleRow('NHS income', 'Pulled from Dentally treatment data', mod.income.includeNHS, (v) => setMod('income', { includeNHS: v }))}
                {toggleRow('Private treatment income', 'Scaled by practitioner chair time', mod.income.includePrivate, (v) => setMod('income', { includePrivate: v }))}
                {toggleRow(`${providerLabel} membership income`, 'Net of £1.36 transaction fee', mod.income.includeDenplan, (v) => setMod('income', { includeDenplan: v }))}
              </>)}

              {card(<>
                {sectionTitle('Income projection method')}
                {methodSection(
                  'Base method',
                  'How future weeks are estimated (applies to income and costs).',
                  unifiedMethod,
                  setUnifiedMethod,
                  draft.incomeManualGrowthMonthlyPct,
                  setUnifiedGrowth,
                )}

                {/* Live preview — the Private income this method would produce. */}
                {hasPreview && (
                  <div className="mt-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-semibold text-foreground">Preview · Private income (next {previewSeries.length} weeks)</span>
                      <span className="text-xs font-semibold text-primary">Total {gbp0(previewTotal)}</span>
                    </div>
                    <div className="flex gap-1 overflow-x-auto pb-1">
                      {previewSeries.map((v, i) => {
                        const changed = !previewFullScope && unifiedMethod !== 'auto' && isPreviewMethodWeek(i);
                        return (
                          <div key={i} className={`flex min-w-[58px] shrink-0 flex-col items-center rounded-md px-1.5 py-1 ${changed ? 'bg-primary text-primary-foreground' : 'bg-background'}`}>
                            <span className={`text-[10px] ${changed ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>{weekOptions[i]?.label ?? `wk ${i + 1}`}</span>
                            <span className={`text-[11px] font-medium tabular-nums ${changed ? '' : 'text-foreground'}`}>{gbp0(v)}</span>
                          </div>
                        );
                      })}
                    </div>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {previewFullScope
                        ? 'Starts from your current forecast and applies the selected method — exact figures finalise after Save.'
                        : unifiedMethod === 'auto'
                          ? 'Smart applies everywhere, so the week selection makes no difference here.'
                          : 'Highlighted weeks use the chosen method; the rest keep the current forecast.'}
                    </p>
                  </div>
                )}
                <div className="mt-3 space-y-2">
                  <div className="text-xs font-medium text-foreground">Apply to</div>
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setWeekPickerOpen((o) => !o)}
                      className="flex w-full items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
                    >
                      <span>{applyToSummary}</span>
                      <span className={`text-muted-foreground transition-transform ${weekPickerOpen ? 'rotate-180' : ''}`}>▾</span>
                    </button>
                    {weekPickerOpen && (
                      <div className="absolute z-50 mt-1 max-h-72 w-full overflow-auto rounded-md border border-border bg-background p-1 shadow-lg">
                        <div className="flex items-center justify-between border-b border-border px-2 py-1">
                          <button type="button" onClick={setAllMethodWeeks} className="text-[11px] font-medium text-primary hover:underline">All weeks</button>
                          <button type="button" onClick={clearMethodWeeks} className="text-[11px] text-muted-foreground hover:underline">Clear</button>
                        </div>
                        {weekOptions.map((w) => {
                          const on = draft.methodWeeks.includes(w.weekNumber);
                          return (
                            <button
                              key={w.weekNumber}
                              type="button"
                              onClick={() => toggleMethodWeek(w.weekNumber)}
                              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted/50"
                            >
                              <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${on ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40 text-transparent'}`}>✓</span>
                              <span className={on ? 'font-medium text-foreground' : 'text-muted-foreground'}>Week of {w.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  {numRow('NHS income cap', 'Blank = no cap; clips the NHS projection', mod.income.nhsIncomeCap, (v) => setMod('income', { nhsIncomeCap: v }), '£', 1, 'no cap')}
                  {selRow('Cap applies per', undefined, mod.income.nhsIncomeCapUnit, [{ value: 'month', label: 'Per month' }, { value: 'week', label: 'Per week' }], (v) => setMod('income', { nhsIncomeCapUnit: v as 'week' | 'month' }))}
                </div>
              </>)}

              {card(<>
                {sectionTitle('Revenue scenario')}
                <p className="-mt-1 mb-2.5 text-xs text-muted-foreground">
                  A quick what-if on the whole forecast. Pick a case to lift (or lower) every projected income week by a flat %.
                  Base case leaves your figures unchanged. The same three sit as buttons on top of the forecast.
                </p>
                <div className="space-y-1.5">
                  <button
                    type="button"
                    onClick={() => setScenario({ active: null })}
                    className={`flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors ${
                      draft.scenario.active === null ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border hover:border-primary/50 hover:bg-muted/40'
                    }`}
                  >
                    <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${draft.scenario.active === null ? 'border-primary' : 'border-muted-foreground/40'}`}>
                      {draft.scenario.active === null && <span className="h-2 w-2 rounded-full bg-primary" />}
                    </span>
                    <span className="text-sm font-medium text-foreground">Base case</span>
                    <span className="ml-auto text-[11px] text-muted-foreground">no change</span>
                  </button>
                  {SCENARIO_KEYS.map((k) => {
                    const active = draft.scenario.active === k;
                    const field = scenarioPctField[k];
                    const val = draft.scenario[field] as number;
                    return (
                      <div
                        key={k}
                        className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 transition-colors ${
                          active ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border hover:border-primary/50'
                        }`}
                      >
                        <button type="button" onClick={() => setScenario({ active: k })} className="flex flex-1 items-center gap-2.5 text-left">
                          <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${active ? 'border-primary' : 'border-muted-foreground/40'}`}>
                            {active && <span className="h-2 w-2 rounded-full bg-primary" />}
                          </span>
                          <span className={`text-sm font-medium ${active ? 'text-primary' : 'text-foreground'}`}>{SCENARIO_LABELS[k]}</span>
                        </button>
                        <span className="flex shrink-0 items-center gap-1">
                          <input
                            type="number"
                            step={1}
                            value={val}
                            onChange={(e) => setScenario({ [field]: Number(e.target.value) } as Partial<ForecastScenario>)}
                            className={numCls}
                          />
                          <span className="text-sm text-muted-foreground">%</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </>)}

              {card(<>
                {sectionTitle('Invoice timing')}
                {numRow('Xero invoice lag (days)', 'Days between treatment and invoice creation', mod.income.xeroInvoiceLagDays, (v) => setMod('income', { xeroInvoiceLagDays: v }))}
                {numRow(`Insurance / ${providerLabel} settlement delay (days)`, undefined, mod.income.settlementDelayDays, (v) => setMod('income', { settlementDelayDays: v }))}
              </>)}
            </>
          )}

          {/* ════ COSTS & OVERHEADS ════ */}
          {tab === 'costs' && (
            <>
              {card(<>
                {sectionTitle('Cost projection')}
                {numRow('Cost inflation', 'Flat % added to every projected cost figure (e.g. 3% → costs ×1.03)', draft.costInflationWeeklyPct, (v) => setField({ costInflationWeeklyPct: v }), '%', 0.5)}
                {numRow('Trend sensitivity', 'Max change per week the trend may apply', draft.trendCapWeeklyPct, (v) => setField({ trendCapWeeklyPct: v }), '%', 0.5)}
                <div className="pt-3">
                  <div className="mb-2 text-xs font-medium text-foreground">Other sections (lower blocks)</div>
                  <div className="space-y-3">{FORECAST_SECTION_KEYS.map((k) => sectionMethodRow(k))}</div>
                </div>
              </>)}

              {card(<>
                {sectionTitle('Staff cost allocation')}
                {toggleRow('Include associate pay', 'On → replaces the picked account with a % of projected income', mod.costs.includeAssociatePay, (v) => setMod('costs', { includeAssociatePay: v }))}
                {numRow('Associate pay rate', '% of projected income', mod.costs.associatePayRatePct, (v) => setMod('costs', { associatePayRatePct: v }), '%')}
                {selRow('Associate pay account', 'Which cost row this replaces', mod.costs.staffAccounts.associate, [{ value: '', label: 'Replaces… (pick account)' }, ...costAccounts.map((a) => ({ value: a, label: a }))], (v) => setMod('costs', { staffAccounts: { ...mod.costs.staffAccounts, associate: v } }))}
                {toggleRow('Include support staff salaries', 'On → replaces the picked account with the salary below + on-costs', mod.costs.includeSupportStaff, (v) => setMod('costs', { includeSupportStaff: v }))}
                {numRow('Support staff salary', 'Total monthly, before NI/pension', mod.costs.supportStaffMonthly, (v) => setMod('costs', { supportStaffMonthly: v }), '£/month', 1, 'off')}
                {selRow('Support staff account', 'Which cost row this replaces', mod.costs.staffAccounts.support, [{ value: '', label: 'Replaces… (pick account)' }, ...costAccounts.map((a) => ({ value: a, label: a }))], (v) => setMod('costs', { staffAccounts: { ...mod.costs.staffAccounts, support: v } }))}
                {numRow('Employer NI rate', 'Added to support staff salary', mod.costs.employerNiPct, (v) => setMod('costs', { employerNiPct: v }), '%', 0.1)}
                {numRow('Pension contribution (employer)', 'Added to support staff salary', mod.costs.pensionPct, (v) => setMod('costs', { pensionPct: v }), '%', 0.5)}
              </>)}

              {card(<>
                {sectionTitle('Fixed monthly budgets')}
                <p className="mb-2 text-[11px] text-muted-foreground">Set a fixed £/month on any of your cost lines. Blank = use your real data; a value replaces that line with a flat monthly budget.</p>
                {costAccounts.length === 0 ? (
                  <p className="text-[12px] italic text-muted-foreground">No cost accounts found for this location yet.</p>
                ) : (
                  <div className="max-h-72 space-y-1 overflow-auto pr-1">
                    {costAccounts.map((acct) => {
                      const val = mod.costs.fixedAccountBudgets[acct] ?? 0;
                      return (
                        <div className="flex items-center gap-2" key={acct}>
                          <span className="min-w-0 flex-1 truncate text-[12px] text-foreground" title={acct}>{acct}</span>
                          <span className="flex shrink-0 items-center gap-1">
                            <span className="text-xs text-muted-foreground">£</span>
                            <input
                              type="number"
                              value={val === 0 ? '' : val}
                              placeholder="real data"
                              onChange={(e) => setMod('costs', { fixedAccountBudgets: { ...mod.costs.fixedAccountBudgets, [acct]: Number(e.target.value) } })}
                              className="w-24 rounded-md border border-border bg-background px-2 py-1 text-right text-sm focus:border-primary focus:outline-none"
                            />
                            <span className="text-xs text-muted-foreground">/mo</span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>)}

              {card(<>
                {sectionTitle('Variable cost logic')}
                {selRow('Lab fees: source', 'How lab costs are pulled into the forecast', mod.costs.labFeesSource, [
                  { value: 'actual_xero', label: 'Actual Xero invoices (paid)' },
                  { value: 'pct_income', label: '% of treatment income' },
                  { value: 'fixed_budget', label: 'Fixed monthly budget' },
                ], (v) => setMod('costs', { labFeesSource: v as ForecastModuleSettings['costs']['labFeesSource'] }))}
                {mod.costs.labFeesSource === 'fixed_budget' && numRow('Lab fees budget', 'Used when source = Fixed monthly budget', mod.costs.fixedLabBudgetMonthly, (v) => setMod('costs', { fixedLabBudgetMonthly: v }), '£/month', 1, 'off')}
                {numRow('Consumables / sundries estimate', 'Blank = use real data; set a % to replace the materials row', mod.costs.consumablesPctOfIncome, (v) => setMod('costs', { consumablesPctOfIncome: v }), '% of income', 0.1, 'off')}
              </>)}
            </>
          )}

          {/* ════ WEEKLY DISTRIBUTION ════ */}
          {tab === 'distribution' && (
            <>
              {card(<>
                {sectionTitle('Working days pattern')}
                <p className="-mt-2 mb-2 text-[11px] text-muted-foreground">Enter % of a full day's capacity (0–100) used to weight daily income.</p>
                <div className="flex gap-1.5">
                  {(['mon','tue','wed','thu','fri','sat','sun'] as const).map((d) => (
                    <div key={d} className="flex flex-1 flex-col items-center gap-1">
                      <span className="text-[11px] capitalize text-muted-foreground">{d}</span>
                      <input type="number" min={0} max={100} value={mod.distribution.workingDays[d]} onChange={(e) => setMod('distribution', { workingDays: { ...mod.distribution.workingDays, [d]: Number(e.target.value) } })} className="w-full rounded-md border border-border bg-background px-1 py-1 text-center text-xs focus:border-primary focus:outline-none" />
                    </div>
                  ))}
                </div>
              </>)}

              {card(<>
                {sectionTitle('Bank holiday handling')}
                {toggleRow('Exclude bank holidays from income', 'Reduce a week that contains a public holiday', mod.distribution.excludeBankHolidays, (v) => setMod('distribution', { excludeBankHolidays: v }))}
                {toggleRow('Carry bank-holiday income to the next week', 'On → the reduced income moves into the following week instead of being lost', mod.distribution.redistributeBankHoliday, (v) => setMod('distribution', { redistributeBankHoliday: v }))}
                {selRow('Calendar region for public holidays', undefined, mod.distribution.holidayRegion, [
                  { value: 'england_wales', label: 'England & Wales' },
                  { value: 'scotland', label: 'Scotland' },
                  { value: 'northern_ireland', label: 'Northern Ireland' },
                ], (v) => setMod('distribution', { holidayRegion: v as ForecastModuleSettings['distribution']['holidayRegion'] }))}
              </>)}

              {card(<>
                {sectionTitle('Seasonality adjustments')}
                {toggleRow('Apply seasonal multipliers', 'Scale weekly income based on historical patterns', mod.distribution.applySeasonality, (v) => setMod('distribution', { applySeasonality: v }))}
                {numRow('School holiday reduction', undefined, mod.distribution.schoolHolidayReductionPct, (v) => setMod('distribution', { schoolHolidayReductionPct: v }), '%')}
                {numRow('December wind-down factor (weeks 50–52)', undefined, mod.distribution.decemberWindDownPct, (v) => setMod('distribution', { decemberWindDownPct: v }), '%')}
              </>)}
            </>
          )}

          {/* ════ DENPLAN ════ */}
          {tab === 'denplan' && (
            <>
              {card(<>
                {sectionTitle(`${providerLabel} pricing formula`)}
                {numRow('Transaction fee per member (£)', 'Net Due = (Gross − fee) × (1 − Discount%÷100)', mod.denplan.transactionFee, (v) => setMod('denplan', { transactionFee: v }), undefined, 0.01)}
                {numRow('Default discount rate', undefined, mod.denplan.defaultDiscountPct, (v) => setMod('denplan', { defaultDiscountPct: v }), '%')}
                {selRow('Settlement frequency', undefined, mod.denplan.settlementFrequency, [
                  { value: 'monthly_1st', label: 'Monthly (1st of month)' },
                  { value: 'monthly_15th', label: 'Monthly (15th of month)' },
                  { value: 'weekly', label: 'Weekly' },
                ], (v) => {
                  setMod('denplan', { settlementFrequency: v as ForecastModuleSettings['denplan']['settlementFrequency'] });
                  if (v === 'monthly_1st') setField({ membershipPayDay: 1 });
                  if (v === 'monthly_15th') setField({ membershipPayDay: 15 });
                })}
              </>)}

              {card(<>
                {sectionTitle('Member count projection')}
                {numRow('Expected monthly member growth', undefined, mod.denplan.monthlyMemberGrowthPct, (v) => setMod('denplan', { monthlyMemberGrowthPct: v }), '%', 0.1)}
                {numRow('Churn rate (monthly)', 'Also sets the engine churn assumption', mod.denplan.monthlyChurnPct, (v) => { setMod('denplan', { monthlyChurnPct: v }); setField({ membershipChurnAnnualPct: Math.round(v * 12 * 10) / 10 }); }, '%', 0.1)}
                {numRow('Pay day of month', 'Income lands in the week containing this day', draft.membershipPayDay, (v) => setField({ membershipPayDay: v }))}
              </>)}
            </>
          )}

          {/* ════ LOCATIONS ════ */}
          {tab === 'locations' && (
            <>
              {card(<>
                {sectionTitle('Active locations in forecast')}
                {!groupScope ? (
                  <p className="text-xs text-muted-foreground">You're viewing a <span className="font-medium text-foreground">single location</span>, so there's nothing to include or exclude. To choose which practices feed a <span className="font-medium text-foreground">combined</span> forecast, clear the location in the top bar (view a Region or All Regions), then open these settings.</p>
                ) : (
                  <>
                    <p className="-mt-2 mb-2 text-[11px] text-muted-foreground">Switch a location <span className="font-medium text-foreground">off</span> to drop its takings and costs from the combined totals. At least one must stay on.</p>
                    {locations.length === 0
                      ? <p className="text-xs text-muted-foreground">No locations available for this organization.</p>
                      : (() => {
                          const activeCount = locations.filter((l) => mod.locations.activeLocations[l.id] !== false).length;
                          return locations.map((l) => {
                            const on = mod.locations.activeLocations[l.id] !== false;
                            const isLastOn = on && activeCount <= 1;
                            return toggleRow(l.name, isLastOn ? 'Required — at least one location must stay on' : undefined, on, (v) => {
                              if (!v && isLastOn) return; // can't switch off the last active location
                              setMod('locations', { activeLocations: { ...mod.locations.activeLocations, [l.id]: v } });
                            });
                          });
                        })()}
                  </>
                )}
              </>)}

              {card(<>
                {sectionTitle('Aggregation method')}
                {selRow('Forecast view', 'How multi-location data is combined', mod.locations.forecastView, [
                  { value: 'combined', label: 'Combined (group total)' },
                  { value: 'side_by_side', label: 'Per location, side by side' },
                  { value: 'separate', label: 'Per location, separate rows' },
                ], (v) => setMod('locations', { forecastView: v as ForecastModuleSettings['locations']['forecastView'] }))}
                {selRow('Inter-practice cost allocation', 'Spread shared overheads across locations', mod.locations.costAllocation, [
                  { value: 'by_income', label: 'By income %' },
                  { value: 'equal', label: 'Equal split' },
                  { value: 'manual', label: 'Manual weights' },
                ], (v) => setMod('locations', { costAllocation: v as ForecastModuleSettings['locations']['costAllocation'] }))}
              </>)}

              {card(<>
                {sectionTitle('Patient scoping (Dentally data)')}
                {toggleRow('Scope patients by location', 'Avoids NULL location_id sync issues — recommended', mod.locations.scopePatientsBySubquery, (v) => setMod('locations', { scopePatientsBySubquery: v }))}
                {selRow('Fallback for unscoped patients', undefined, mod.locations.unscopedFallback, [
                  { value: 'exclude', label: 'Exclude from forecast' },
                  { value: 'primary', label: 'Assign to primary location' },
                  { value: 'split', label: 'Split equally' },
                ], (v) => setMod('locations', { unscopedFallback: v as ForecastModuleSettings['locations']['unscopedFallback'] }))}
              </>)}
            </>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="sticky bottom-0 mt-8 flex items-center justify-between gap-3 border-t border-border bg-background py-3">
          <button
            type="button"
            onClick={onReset}
            disabled={saving || isDefault}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset to default
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onSave(draft)}
              disabled={saving || !dirty}
              className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
