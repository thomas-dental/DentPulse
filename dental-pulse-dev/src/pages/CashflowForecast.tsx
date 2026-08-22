import { Component, Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Helmet } from 'react-helmet-async';
import { useMembershipProviderLabel } from '@/lib/membershipProviderLabel';
import { Trash2, Info, Plus, ArrowLeft, ArrowRight, CalendarDays, Settings, Download, FileSpreadsheet, FileText } from 'lucide-react';
import { ResponsiveContainer, ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend } from 'recharts';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Sparkles, Repeat, Hash, Link2, Gauge, ChevronLeft, Filter, ChevronDown, ArrowDownUp, LineChart as LineChartIcon } from 'lucide-react';
import { useFilters } from '@/contexts/FilterContext';
import { useLocations } from '@/hooks/useLocations';
import { usePaymentPlans } from '@/hooks/usePaymentPlans';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useCashflowForecast, type ForecastRow, type ForecastWeek, type ForecastSection, type ForecastRule, type RepeatEvery, type LinkedInput } from '@/hooks/useCashflowForecast';
import { ForecastSettingsSheet } from '@/components/cashflow/ForecastSettingsSheet';
import CfoSummaryContent from '@/components/cashflow/CfoSummaryContent';
import { useCashflowForecastAI, type AIForecastRowInput } from '@/hooks/useCashflowForecastAI';
import { makeForecastDisplay } from '@/lib/forecastDisplay';
import { useAiForecastSnapshotSync, useStoredAiForecast } from '@/hooks/useAiForecastSchedule';
import { useChartOfAccounts } from '@/hooks/useChartOfAccounts';
import { useCashflowBreakdown } from '@/hooks/useCashflowBreakdown';
import { useCashflowRealtimeRefresh } from '@/hooks/useCashflowRealtimeRefresh';
import { useThresholdStatusSync } from '@/hooks/useThresholdBreachNotification';
import { exportForecastXlsx, exportForecastPdf, type ForecastExportData, type ForecastExportRow, type ForecastExportSection } from '@/lib/forecastExport';
import { SCENARIO_KEYS, SCENARIO_LABELS, scenarioPct, type ScenarioKey } from '@/hooks/useCashflowForecastSettings';
import { formatGbp, formatPercentDisplay } from '@/utils/formatMoney';

// Whole-pound display with £ and parentheses for negatives (e.g. £32,520
// and (£15,609)). `blankZero` blanks empty cells; totals show £0.
const gbp = (v: number, blankZero = false): string => {
  const n = Math.round(v);
  if (n === 0) return blankZero ? '' : '£0';
  return formatGbp(n);
};
// Pence-precise £ — used in the "how this was calculated" tooltips and the cell
// editor so an exact figure like £9,089.92 is visible (the dense table cells keep
// the whole-pound `gbp`).
const gbpPence = (v: number, blankZero = false): string => {
  if (Math.abs(v) < 0.005) return blankZero ? '' : '£0.00';
  return formatGbp(v, { decimals: 2 });
};
// A value as a plain 2-dp string for an editable input (no symbol; whole numbers
// stay clean, pence preserved): 8800 → "8800", 9089.92 → "9089.92".
const editAmount = (v: number): string => String(Math.round(v * 100) / 100);
// Editable cells: blank when zero. Pence-precise so the table shows exact figures
// (e.g. £9,089.92), matching the "how this was calculated" tooltips.
const fmt = (v: number): string => gbpPence(v, true);

// Cash-flow group navigation tabs (mirror the Cashflow Statement groups). Each
// scrolls to the matching section of the sheet. "Uncategorized" is omitted — the
// forecast has no such section (it's only for unmapped accounts in the report).
const FORECAST_TABS: { id: string; label: string }[] = [
  { id: 'cf-operations', label: 'Cash Flow from Operations' },
  { id: 'cf-investing', label: 'Cash Flow from Investing Activities' },
  { id: 'cf-financing', label: 'Cash Flow from Financing Activities' },
  { id: 'cf-tax', label: 'Tax Paid' },
  { id: 'cf-intercompany', label: 'Intra Company Transfers' },
];

// Two-part hover help, mirroring the EBITDA Valuation tooltip: a plain-language
// description, plus a monospace worked-calculation line showing the real numbers.
type CellHelp = { description: string; calculation: string };

// Tree connectors for an indented child row: a vertical rail down the left of the
// group's children plus a short horizontal tick into each label, so children
// visibly "hang" off their parent (file-tree style). The LAST child stops the
// rail at the tick (an "└" corner) instead of running it full height ("├").
// Positioned against the sticky first cell (itself a positioned containing block).
// Module-scoped so its component identity is stable across renders (React
// reconciles instead of remounting → no flicker, faster table render).
const TreeBranch = ({ last }: { last?: boolean }) => (
  <>
    <span aria-hidden className={`pointer-events-none absolute left-[18px] top-0 w-px bg-border ${last ? 'h-1/2' : 'bottom-0'}`} />
    <span aria-hidden className="pointer-events-none absolute left-[18px] top-1/2 h-px w-2.5 bg-border" />
  </>
);

// A read-only value cell. Clicking it opens the comment drawer; a small dot marks
// cells that already have a comment. Keeps the hover help tooltip. Module-scoped so
// its component identity is stable across renders — the previous in-component
// definition got a NEW identity every render, so React remounted every cell's DOM
// on each parent render (e.g. as each data query streamed in), which showed as the
// table data flickering/fluctuating and made rendering slow. A stable identity lets
// React reconcile (update text in place) instead.
const ValueCell = ({ value, overridden, help, onClick, hasComment, breach }: {
  value: number; overridden: boolean; help?: CellHelp; onClick?: () => void; hasComment?: boolean; breach?: boolean;
}) => {
  const btn = (
    <button
      type="button"
      onClick={onClick}
      title={breach ? 'Over the threshold you set for this row' : undefined}
      className={[
        'relative w-full h-full text-right tabular-nums px-2 py-1.5 text-[13px] rounded-sm transition-colors',
        onClick ? 'hover:bg-primary/5 cursor-pointer' : '',
        breach ? 'bg-destructive/10 text-destructive font-semibold' : overridden ? 'font-semibold text-primary' : 'text-foreground',
        value < 0 && !breach ? 'text-destructive' : '',
      ].join(' ')}
    >
      {fmt(value) || '–'}
      {hasComment && <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-amber-500" aria-label="Has comment" />}
    </button>
  );
  if (!help) return btn;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{btn}</TooltipTrigger>
      <TooltipContent side="bottom" align="end" collisionPadding={12} className="w-[280px] p-3 shadow-lg border bg-popover z-50">
        <p className="text-[11px] font-medium text-popover-foreground mb-1.5 whitespace-normal break-words">{help.description}</p>
        <p className="text-[10px] text-primary/90 font-mono leading-relaxed whitespace-pre-line break-words">{help.calculation}</p>
      </TooltipContent>
    </Tooltip>
  );
};

// ── A single editable forecast cell ──
function EditableCell({
  value,
  overridden,
  onCommit,
  title,
}: {
  value: number;
  overridden: boolean;
  onCommit: (v: number | null) => void;
  // "How this number was calculated" hover help: prose + worked calculation.
  title?: CellHelp;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  // Hover-only tooltip: the calculation help shows on pointer hover but never
  // while the cell is being edited, so it can't cover what you're typing.
  const [hover, setHover] = useState(false);

  const commit = () => {
    setEditing(false);
    const raw = draft.replace(/[£,\s]/g, '').trim();
    if (raw === '') return onCommit(null);
    const n = Number(raw);
    onCommit(Number.isFinite(n) ? n : null);
  };

  const input = (
    <input
      inputMode="numeric"
      className={[
        'w-full h-full text-right tabular-nums bg-transparent px-2 py-1.5 text-[13px] rounded-sm',
        'focus:outline-none focus:ring-2 focus:ring-primary/40 focus:bg-background',
        overridden ? 'font-semibold text-primary' : 'text-foreground',
        value < 0 ? 'text-destructive' : '',
      ].join(' ')}
      value={editing ? draft : fmt(value)}
      placeholder="–"
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      onFocus={() => {
        setEditing(true);
        setDraft(value === 0 ? '' : editAmount(value));
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setEditing(false);
          setDraft('');
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );

  if (!title) return input;

  return (
    <Tooltip open={hover && !editing}>
      <TooltipTrigger asChild>{input}</TooltipTrigger>
      <TooltipContent side="bottom" align="end" collisionPadding={12} className="w-[280px] p-3 shadow-lg border bg-popover z-50">
        <p className="text-[11px] font-medium text-popover-foreground mb-1.5 whitespace-normal break-words">{title.description}</p>
        <p className="text-[10px] text-primary/90 font-mono leading-relaxed whitespace-pre-line break-words">{title.calculation}</p>
      </TooltipContent>
    </Tooltip>
  );
}

// One "Decisions Made" week row. When the note is empty, the AI "suggested focus"
// shows AS the input's ghost placeholder (tinted), with an inline "Use" pill and
// Tab-to-accept — no separate line outside the field. The note saves on blur and
// remains the source of truth. Suggestions only appear for weeks that warrant one.
function WeekDecisionNote({ weekNumber, label, initialNote, suggestion, onSave }: {
  weekNumber: number;
  label: string;
  initialNote: string;
  suggestion: string | null;
  onSave: (text: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [empty, setEmpty] = useState(!initialNote.trim());
  const showGhost = empty && !!suggestion;
  const accept = () => {
    if (!suggestion || !ref.current) return;
    ref.current.value = suggestion;
    setEmpty(false);
    onSave(suggestion);
    ref.current.focus();
  };
  return (
    <div className="flex items-start gap-3">
      <span className="w-28 shrink-0 pt-1.5 text-xs text-muted-foreground tabular-nums">
        Week {weekNumber} · {label}
      </span>
      <div className="relative flex-1">
        <textarea
          ref={ref}
          defaultValue={initialNote}
          rows={1}
          placeholder={suggestion || 'Add a note for this week…'}
          title={showGhost ? suggestion! : undefined}
          className={`w-full resize-y rounded-md border border-border bg-background py-1.5 pl-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-primary/40 ${showGhost ? 'pr-12 placeholder:italic placeholder:text-primary/60' : 'pr-2'}`}
          onChange={(e) => setEmpty(!e.target.value.trim())}
          onKeyDown={(e) => { if (e.key === 'Tab' && !e.shiftKey && showGhost) { e.preventDefault(); accept(); } }}
          onBlur={(e) => { if (e.target.value.trim() !== initialNote.trim()) onSave(e.target.value); }}
        />
        {showGhost && (
          <button
            type="button"
            title="Use this suggestion (Tab)"
            className="absolute right-1.5 top-1.5 inline-flex items-center gap-0.5 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary hover:bg-primary/20"
            onClick={accept}
          >
            <Sparkles className="h-2.5 w-2.5" /> Use
          </button>
        )}
      </div>
    </div>
  );
}

// Keeps a render error in one section (e.g. the chart) from blanking the whole
// page, and surfaces the message so it can be diagnosed.
class SectionErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          Something went wrong rendering this view: {this.state.error.message}
        </div>
      );
    }
    return this.props.children;
  }
}

export default function CashflowForecast() {
  // Membership provider display name (Denplan for most orgs; e.g. Practice
  // Plan for The Old Surgery). Labels/help text only — row keys stay 'membership'.
  const membershipProvider = useMembershipProviderLabel();
  // Window navigation: shift the 13-week forecast back/forward by whole weeks
  // (← / →); the calendar button resets to today's upcoming Monday.
  const [weekOffset, setWeekOffset] = useState(0);
  // Top-level Overview ↔ Breakdown tab. The Breakdown always shows the current
  // week (which folds in overdue bills) — the week navigator was removed.
  const [tab, setTab] = useState<'overview' | 'breakdown' | 'cfo'>('overview');
  const breakdownWeek = 0;
  // Breakdown list controls: Type filter (real docs / budget) + show-excluded,
  // applied via a draft-then-Apply popover, plus a sort dropdown.
  const bdFilterDefaults = { real: true, budget: true, showExcluded: false };
  const [bdFilters, setBdFilters] = useState(bdFilterDefaults);
  const [bdFiltersDraft, setBdFiltersDraft] = useState(bdFilterDefaults);
  const [bdFiltersOpen, setBdFiltersOpen] = useState(false);
  const [bdSort, setBdSort] = useState<'date' | 'highest' | 'lowest'>('date');
  // View tab — declared before the data hook so we can defer the Combined-only
  // "current window" actual queries until that tab is actually opened (faster load).
  //  • 'actual'   — the real previous 13 weeks (read-only history)
  //  • 'forecast' — the forward 13-week forecast (editable)
  //  • 'combined' — actual + forecast + variance (£ and %) side by side
  const [view, setView] = useState<'actual' | 'forecast' | 'combined'>('forecast');
  const {
    weeks,
    nhsRow,
    membershipRows,
    privateRow,
    privateUsingAccounting,
    privateAccountingEmpty,
    privateSource,
    privatePct,
    privatePctSet,
    privateTrailing,
    privatePatients,
    privateTrendPct,
    privateBookedAppointments,
    diaryReliableWeeks,
    privateAvgWeekly,
    customRows,
    allRows,
    operatingInflowExtraRows,
    outflowCostRows,
    outflowExpenseRows,
    outflowCustomRows,
    operatingDirectExtraRows,
    operatingExpenseExtraRows,
    manualBlocks,
    startCash,
    startCashSet,
    thresholdsByKey,
    previous,
    current,
    isLoading,
    outflowLoading,
    blockLoading,
    setCell,
    addCustomRow,
    removeCustomRow,
    renameCustomRow,
    setNote,
    setRule,
    addComment,
    deleteComment,
    notes,
    comments,
    costCadence,
    forecastSettings,
    saveForecastSettings,
    resetForecastSettings,
    forecastSettingsSaving,
  } = useCashflowForecast(weekOffset, { includeCurrentWindow: view === 'combined' });
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Detected billing cadence of a cost row (mapped CoA rows keyed `coa:<id>`).
  const detectedCadenceFor = (row: ForecastRow): 'weekly' | 'monthly' | 'irregular' | undefined => {
    if (!row.key.startsWith('coa:')) return undefined;
    return costCadence[row.key.slice(4).trim().toLowerCase()]?.cadence;
  };
  // AI cadence hint: a monthly/weekly account keeps that rhythm; otherwise infer
  // from the row's own baseline shape (lands in ≲45% of weeks ⇒ monthly-lump).
  const inferCadenceFromShape = (vals: number[]): 'weekly' | 'monthly-lump' => {
    const nz = vals.filter((v) => Math.abs(v) > 0.005).length;
    if (nz === 0) return 'weekly';
    return nz <= Math.ceil(vals.length * 0.45) ? 'monthly-lump' : 'weekly';
  };
  const aiCadenceFor = (row: ForecastRow): 'weekly' | 'monthly-lump' => {
    const d = detectedCadenceFor(row);
    if (d === 'monthly') return 'monthly-lump';
    if (d === 'weekly') return 'weekly';
    return inferCadenceFromShape(row.values);
  };

  // Breakdown tab: real ledger transactions due in the selected forecast week.
  const bdWeek = weeks[Math.min(breakdownWeek, weeks.length - 1)];
  const bdEnd = bdWeek ? new Date(bdWeek.weekStart.getTime() + 6 * 86400000) : undefined;
  const toLocalIso = (d?: Date) => (d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : undefined);
  // The first visible week (no navigation) is "now" — it sweeps up overdue bills.
  const { transactions: bdTxns, isLoading: bdLoading } = useCashflowBreakdown(bdWeek?.iso, toLocalIso(bdEnd), breakdownWeek === 0 && weekOffset === 0);

  // Live-refresh actuals (and thus the Variance £/% + graph) the moment a Xero /
  // Dentally / Denplan sync completes — no manual reload needed.
  useCashflowRealtimeRefresh();

  // Toggle: spreadsheet (table) vs the End-Cash balance line chart.
  const [chartMode, setChartMode] = useState<'table' | 'graph'>('table');

  // ── Cell editor drawer ──
  // Clicking any forecast value cell opens a right-side drawer with edit modes
  // (Auto / Repeating / One-off / Linked) plus a Threshold option. Replaces the
  // old inline-input editing. `editorCell` holds the row + week being edited.
  const [editorCell, setEditorCell] = useState<{ row: ForecastRow; weekIndex: number } | null>(null);
  const [editorMode, setEditorMode] = useState<'menu' | 'auto' | 'oneoff' | 'repeating' | 'linked' | 'threshold'>('menu');
  const [editorDraft, setEditorDraft] = useState('');
  // Multi-entry: one or more editable form blocks open at once. "Add & add another"
  // appends a fresh blank block of the same type; the primary button saves them all.
  // Each draft is a working rule + the forecast LINE it saves to (key into rowsByKey).
  const [drafts, setDrafts] = useState<{ rule: ForecastRule; targetKey: string }[]>([]);
  // Which draft block's "Suggested amounts" popover is open (index), or null.
  const [amtSuggest, setAmtSuggest] = useState<number | null>(null);
  const openEditor = (row: ForecastRow, weekIndex: number, mode: 'menu' | 'threshold' = 'menu') => {
    let wi = weekIndex;
    if (mode === 'threshold') {
      // Open on the requested week; but if it has no threshold yet and one IS set
      // elsewhere, jump to the first week that has one so the input is pre-filled
      // with the current value instead of opening blank.
      const series = thrSeriesFor(thresholdKeyFor(row));
      if (series[wi] == null) {
        const firstSet = series.findIndex((v) => v != null);
        if (firstSet >= 0) wi = firstSet;
      }
      const t = series[wi];
      setEditorDraft(t != null ? String(Math.round(t)) : '');
    } else {
      setEditorDraft('');
    }
    setEditorCell({ row, weekIndex: wi });
    setEditorMode(mode);
    setDrafts([]);
    setAmtSuggest(null);
  };
  const closeEditor = () => { setEditorCell(null); setDrafts([]); };

  // ── Threshold: minimum closing bank balance (End Cash) — the only one ──
  // Net Cash Flow uses the legacy 'cash_threshold' key and is a MINIMUM; Lab and
  // Clinician cost rows use their own key and are a MAXIMUM. The "Set threshold"
  // option only appears on these rows; a breach colours the offending cell red.
  // The ONLY threshold: the minimum CLOSING BANK BALANCE (End Cash) the practice must
  // keep to cover its bills. Stored per week under 'end_cash_threshold', carried
  // forward. Always a MINIMUM (alert when the running balance drops below it).
  const END_CASH_THRESHOLD_KEY = 'end_cash_threshold';
  const thrSeriesFor = (key: string): (number | null)[] => thresholdsByKey?.[key] ?? weeks.map(() => null);
  const thresholdKeyFor = (row: ForecastRow) => row.key;
  // Cost (outflow) rows carry a MAXIMUM threshold (alert when the weekly cost goes
  // above it); everything else (End Cash, inflow) is a MINIMUM.
  const thresholdKindFor = (row: ForecastRow): 'min' | 'max' => (row.section === 'outflow' ? 'max' : 'min');
  // Synthetic row used to open the threshold editor for the End Cash balance line.
  const endCashThresholdRow = (): ForecastRow => ({
    key: END_CASH_THRESHOLD_KEY, label: 'End Cash', kind: 'manual', section: 'threshold',
    values: dispEndCash, baseline: dispEndCash, overridden: weeks.map(() => false), editable: true,
  });
  // Draft mutators — patch one block's rule, retarget it, add/remove a block.
  const updateDraft = (i: number, patch: Partial<ForecastRule>) =>
    setDrafts((ds) => ds.map((d, k) => (k === i ? { ...d, rule: { ...d.rule, ...patch } as ForecastRule } : d)));
  const setDraftTarget = (i: number, key: string) =>
    setDrafts((ds) => ds.map((d, k) => (k === i ? { ...d, targetKey: key } : d)));
  const removeDraft = (i: number) =>
    setDrafts((ds) => (ds.length > 1 ? ds.filter((_, k) => k !== i) : ds));

  // ── Per-cell comment drawer ── clicking a forecast amount opens this.
  const [commentCell, setCommentCell] = useState<{ row: ForecastRow; weekIndex: number } | null>(null);
  const [commentDraft, setCommentDraft] = useState('');
  // Editable amount for the cell (string while typing); seeded with the current
  // displayed value so the user can overwrite it with a manual override.
  const [amountDraft, setAmountDraft] = useState('');
  const commentKey = (rowKey: string, i: number) => `${rowKey}|${weeks[i]?.iso}`;
  const openComment = (row: ForecastRow, weekIndex: number) => {
    setCommentCell({ row, weekIndex });
    setCommentDraft(''); // the box is for a NEW comment; the thread renders below
    const cur = row.key === 'private' ? privateEffective(weekIndex) : dispVal(row, weekIndex);
    setAmountDraft(editAmount(cur)); // keep pence (e.g. 9089.92), don't round to whole £
  };
  const closeComment = () => setCommentCell(null);

  // Income/revenue accounting categories (from the connected ledger) for the
  // Auto/Repeating panels' "Accounting category (from Xero)" dropdown.
  const { accounts: coaAccounts } = useChartOfAccounts();
  const { incomeCategories, costCategories } = useMemo(() => {
    const inc = new Set<string>();
    const cost = new Set<string>();
    for (const a of coaAccounts) {
      const t = (a.coa_account_type || '').toLowerCase();
      const name = a.coa_account_name;
      if (!name) continue;
      if (/revenue|income|sales/.test(t)) inc.add(name);
      else if (/expense|cost|overhead|direct/.test(t)) cost.add(name);
    }
    const sort = (s: Set<string>) => [...s].sort((a, b) => a.localeCompare(b));
    return { incomeCategories: sort(inc), costCategories: sort(cost) };
  }, [coaAccounts]);

  // Collapsible groups — a set of collapsed section ids, shared by both views so
  // the two stay in sync. Collapsing a section hides its detail rows but keeps the
  // colored header + the section's weekly total/subtotal visible (like the sheet).
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const isCollapsed = (id: string) => collapsed.has(id);
  const toggleCollapse = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  // A small FILLED triangle that reflects a group's collapsed/expanded state:
  // points right when collapsed, rotates down when expanded.
  const CollapseChevron = ({ id }: { id: string }) => (
    <svg
      viewBox="0 0 10 10"
      className={`h-2.5 w-2.5 shrink-0 fill-current transition-transform duration-150 ${isCollapsed(id) ? '' : 'rotate-90'}`}
      aria-hidden
    >
      <path d="M2 1 L8 5 L2 9 Z" />
    </svg>
  );


  // ── Per-block color coding (restrained / "world-class" treatment) ──
  // Each of the five blocks owns a distinct hue, expressed as SOFT tints + a
  // colored left rail rather than saturated full-width bands: a section header is
  // a light wash with a colored left border; inflow is the lighter wash, outflow a
  // half-step deeper; the total row is a slightly stronger wash; the net row is the
  // faintest. Classes are full literal strings so Tailwind's JIT keeps them.
  type BlockKey = 'operating' | 'investing' | 'financing' | 'tax' | 'intercompany';
  const BLOCK_COLORS: Record<BlockKey, {
    inBg: string; outBg: string; text: string; rail: string; totalBg: string; totalText: string; netBg: string;
  }> = {
    operating:    { inBg: 'bg-sky-50',    outBg: 'bg-sky-100/70',    text: 'text-sky-900',    rail: 'border-l-sky-400',    totalBg: 'bg-sky-100',    totalText: 'text-sky-950',    netBg: 'bg-sky-50/50' },
    investing:    { inBg: 'bg-violet-50', outBg: 'bg-violet-100/70', text: 'text-violet-900', rail: 'border-l-violet-400', totalBg: 'bg-violet-100', totalText: 'text-violet-950', netBg: 'bg-violet-50/50' },
    financing:    { inBg: 'bg-amber-50',  outBg: 'bg-amber-100/70',  text: 'text-amber-900',  rail: 'border-l-amber-400',  totalBg: 'bg-amber-100',  totalText: 'text-amber-950',  netBg: 'bg-amber-50/50' },
    tax:          { inBg: 'bg-teal-50',   outBg: 'bg-teal-100/70',   text: 'text-teal-900',   rail: 'border-l-teal-400',   totalBg: 'bg-teal-100',   totalText: 'text-teal-950',   netBg: 'bg-teal-50/50' },
    intercompany: { inBg: 'bg-rose-50',   outBg: 'bg-rose-100/70',   text: 'text-rose-900',   rail: 'border-l-rose-400',   totalBg: 'bg-rose-100',   totalText: 'text-rose-950',   netBg: 'bg-rose-50/50' },
  };
  // Map a manual block id → its theme key (operating is the default for the top section).
  const blockKeyFor = (id: string): BlockKey =>
    id === 'investing' || id === 'financing' || id === 'tax' || id === 'intercompany' ? id : 'operating';
  // Section-bar cell classes for a tone within a block (soft wash + rail + text).
  const barClasses = (tone: 'inflow' | 'outflow', blockKey: BlockKey) => {
    const c = BLOCK_COLORS[blockKey];
    return { bg: tone === 'inflow' ? c.inBg : c.outBg, text: c.text, rail: c.rail };
  };

  // Cash-flow group nav tabs — scroll the sheet to the chosen section.
  const [activeSection, setActiveSection] = useState<string>('cf-operations');
  const scrollToSection = (id: string) => {
    setActiveSection(id);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const rangeLabel = (ws: ForecastWeek[]) =>
    ws.length
      ? `${ws[0].weekStart.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} – ${new Date(
          ws[ws.length - 1].weekStart.getTime() + 6 * 86400000,
        ).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
      : '';
  const periodLabel = rangeLabel(weeks);

  // Commit a cell edit, respecting per-row-kind semantics.
  const commitCell = (row: ForecastRow, week: ForecastWeek, v: number | null) => {
    if (v === null) {
      // Empty: custom rows fall to 0 (keep the row); standard rows clear the
      // override so the computed baseline shows again.
      if (row.kind === 'custom') setCell.mutate({ weekStart: week.iso, lineKey: row.key, amount: 0, section: row.section });
      else setCell.mutate({ weekStart: week.iso, lineKey: row.key, amount: null, section: row.section });
      return;
    }
    setCell.mutate({
      weekStart: week.iso,
      lineKey: row.key,
      lineLabel: row.kind === 'custom' ? row.label : null,
      amount: v,
      section: row.section,
    });
  };

  // ── AI (grounded) prediction — auto-renders week-wise into the sheet ──
  const { selectedLocationId, selectedRegionId } = useFilters();
  // Human-readable name for the current scope, used so the breach notification
  // names WHICH practice/region the alert is for (not just the week).
  const { allAvailableLocations, regions } = useLocations();
  const scopeLabel = useMemo(() => {
    if (selectedLocationId) return allAvailableLocations.find((l) => l.id === selectedLocationId)?.location_name ?? 'this location';
    if (selectedRegionId) { const r = regions.find((x) => x.id === selectedRegionId); return r ? `${r.name} (region)` : 'this region'; }
    return 'all locations';
  }, [selectedLocationId, selectedRegionId, allAvailableLocations, regions]);
  // Real membership plans (name + monthly fee) for the Denplan settings tab.
  const { paymentPlans } = usePaymentPlans(selectedLocationId);
  const membershipPlans = useMemo(
    () => (paymentPlans ?? [])
      .filter((p) => (Number(p.pp_monthly_memberhsip_fee) || 0) > 0)
      .map((p) => ({
        id: p.id,
        name: p.pp_is_active === false
          ? `${p.pp_patient_friendly_name || p.pp_name || 'Plan'} (Inactive)`
          : (p.pp_patient_friendly_name || p.pp_name || 'Plan'),
        fee: Number(p.pp_monthly_memberhsip_fee) || 0,
      })),
    [paymentPlans],
  );
  const { predict, aiData, aiValuesByKey, clear: clearAi } = useCashflowForecastAI();
  // The SCHEDULED forecast (regenerated twice daily by aiForecastCron) is the primary
  // source: it gives the practice ONE stable set of numbers all day instead of a fresh,
  // slightly different Claude answer on every page reload. A live prediction is only
  // run when nothing is stored yet for this scope/anchor (see the auto-run effect).
  const { data: storedAi } = useStoredAiForecast(selectedLocationId ?? null, weeks[0]?.iso);
  const storedAiValuesByKey = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const r of storedAi?.predictedRows ?? []) map.set(r.key, r.values);
    return map;
  }, [storedAi]);
  // A live run (this session) wins over the stored one — the user explicitly asked for
  // fresh numbers, or there was nothing stored to begin with.
  const effectiveAiValues = aiData ? aiValuesByKey : storedAiValuesByKey;
  const aiActive = !!aiData || !!storedAi;

  // Display layer (AI values, Linked rules, Private %) — SHARED with the Group
  // Dashboard's Cash Runway via makeForecastDisplay so both plot the same
  // numbers. Change the computation in src/lib/forecastDisplay.ts, not here.
  const display = useMemo(() => makeForecastDisplay({
    weekCount: weeks.length,
    allRows: allRows ?? [],
    aiValuesByKey: aiActive ? effectiveAiValues : null,
    privateRow,
    privatePct,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [weeks.length, allRows, aiActive, effectiveAiValues, privateRow, privatePct]);
  const aiFor = display.aiFor;
  const privateEffective = display.privateEffective;
  const dispVal = display.dispVal;

  // Row lookup by key, for resolving Linked rows (a % of other lines).
  const rowsByKey = useMemo(() => {
    const m = new Map<string, ForecastRow>();
    for (const r of allRows ?? []) m.set(r.key, r);
    return m;
  }, [allRows]);

  // ── Per-number "how this was calculated" help text ──
  // One plain-language sentence per cell, tailored to the row type, so hovering
  // any figure explains where it came from. Blank cells (nothing expected that
  // week) get no tooltip. Uses business language only — never DB terms.
  const monthLong = (i: number) => weeks[i].weekStart.toLocaleDateString('en-GB', { month: 'long' });

  // The pre-override forecast value for a cell (what it would show if you hadn't
  // typed over it) — so the full forecast calculation can be kept even on an edit.
  const forecastValueFor = (row: ForecastRow, i: number): number => {
    if (row.key === 'private') {
      const pct = privatePct[i] ?? 0;
      return Math.round((privateRow.baseline?.[i] ?? 0) * (1 + pct / 100));
    }
    return row.baseline?.[i] ?? 0;
  };

  const explainCell = (row: ForecastRow, i: number): CellHelp | undefined => {
    // Tooltips show pence-precise figures (e.g. £9,089.92). Shadowing `gbp` here
    // routes every £ in this function's calculation strings through gbpPence,
    // without affecting the whole-pound table cells elsewhere.
    const gbp = gbpPence;
    const overriding = row.overridden[i];
    const entry = row.values[i] ?? 0;
    const week = weeks[i].label;
    // AI never applies to an overridden cell. The figure we EXPLAIN is the
    // underlying forecast when overridden (so its full calculation is kept),
    // otherwise the displayed value.
    const isAi = !overriding && aiFor(row, i) != null;
    const v = overriding
      ? forecastValueFor(row, i)
      : (row.key === 'private' ? privateEffective(i) : dispVal(row, i));

    // A fixed monthly budget from Forecast Settings drives this row — explain the
    // budget, not a data-driven forecast (a manual cell edit or row rule still wins).
    if (!overriding && !row.rule && row.fixedBudget != null && row.fixedBudget > 0) {
      const perWk = row.fixedBudget / 4.345;
      return {
        description: `Your ${row.label} is set to a fixed monthly budget in Forecast Settings, so it isn't forecast from your data — the same amount lands every week.`,
        calculation: `Fixed budget ${gbp(row.fixedBudget)}/month ÷ 4.345 weeks = ${gbp(perWk)}/week (flat).`,
      };
    }

    // Auto/Repeating automation drives this row — explain the rule, not the
    // trailing forecast (an explicit per-cell override still shows its own note).
    if (!overriding && row.rule) {
      const r = row.rule;
      if (Math.round(v) === 0) return undefined; // no occurrence/landing this week
      if (r.type === 'auto') {
        // Justify the figure: basis label + the actual basis amount (+ any add-on).
        const basisLabel = r.basis === 'avg_3m' ? "last 3 months' average" : "previous month's total";
        const basisAmt = r.basis === 'avg_3m' ? (row.autoPreview?.avg3m ?? 0) : (row.autoPreview?.prevMonth ?? 0);
        const ord = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;
        const addon = r.addon ?? 0;
        return {
          description: `Auto-updating ${row.label} from your ${basisLabel}, landing on the ${ord(r.day ?? 1)} of each month and refreshed as your actuals change.`,
          calculation: `${basisLabel[0].toUpperCase()}${basisLabel.slice(1)} ${gbp(basisAmt)}${addon ? ` + extra ${gbp(addon)}` : ''} = ${gbp(v)} this month (week of ${week}).`,
        };
      }
      if (r.type === 'linked') {
        // Show the full weighted sum: each source's value (at the offset week) × its %.
        const unit = r.offsetUnit ?? 'days';
        const raw = r.offsetEnabled ? (r.offsetValue ?? 0) : 0;
        const offWeeks = Math.round(unit === 'weeks' ? raw : unit === 'months' ? raw * 4.345 : raw / 7);
        const srcIdx = i - (r.offsetDir === 'before' ? -offWeeks : offWeeks);
        const inWindow = srcIdx >= 0 && srcIdx < weeks.length;
        const sources = (r.inputs ?? []).filter((inp) => inp.source);
        const parts = sources.map((inp) => {
          const src = rowsByKey.get(inp.source);
          const srcVal = src && inWindow ? dispVal(src, srcIdx, 1) : 0;
          return `${inp.pct}% × ${src?.label ?? inp.source} ${gbp(srcVal)} = ${gbp((srcVal * (Number(inp.pct) || 0)) / 100)}`;
        });
        const offsetNote = r.offsetEnabled && offWeeks !== 0 ? ` Uses each source's value from ${offWeeks} week${offWeeks === 1 ? '' : 's'} ${r.offsetDir}.` : '';
        return {
          description: `${row.label} = ${sources.map((inp) => `${inp.pct}% of ${rowsByKey.get(inp.source)?.label ?? inp.source}`).join(' + ') || 'a percentage of other lines'}${r.offsetEnabled ? `, offset ${r.offsetValue} ${r.offsetUnit} ${r.offsetDir}` : ''}.`,
          calculation: `${parts.join(' + ') || 'No sources selected'} = ${gbp(v)} (week of ${week}).${offsetNote}`,
        };
      }
      // Repeating: show base amount, interval, escalation, and this occurrence.
      const everyLabel = ({ week: 'week', '2week': '2 weeks', month: 'month', '2month': '2 months', '3month': '3 months', '6month': '6 months', year: 'year', none: '' } as Record<string, string>)[r.every ?? 'month'];
      const stepNote = r.stepKind
        ? (() => {
            const isPct = r.stepKind === 'inc_pct' || r.stepKind === 'dec_pct';
            const dir = r.stepKind.startsWith('inc') ? 'increasing' : 'decreasing';
            return ` ${dir} by ${isPct ? `${r.stepValue ?? 0}%` : gbp(r.stepValue ?? 0)} each time`;
          })()
        : '';
      const base = r.amount ?? 0;
      const endNote = r.ends ? `, until ${new Date(`${r.ends}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : '';
      return {
        description: `A repeating ${row.label} of ${gbp(base)}${everyLabel ? ` every ${everyLabel}` : ''}${stepNote ? `,${stepNote}` : ''}${endNote}, landing in the week of ${week}.`,
        calculation: stepNote && Math.round(v) !== Math.round(base)
          ? `Base ${gbp(base)},${stepNote} → this occurrence = ${gbp(v)} (week of ${week}).`
          : `This occurrence = ${gbp(v)} (week of ${week}).`,
      };
    }

    // Custom/manual rows have no underlying forecast — just confirm the entry.
    if (row.kind === 'custom' || row.kind === 'manual') {
      if (!overriding && Math.round(entry) === 0) return undefined;
      return {
        description: `A one-off amount you added for the week of ${week}.`,
        calculation: `Amount = ${gbp(entry)}.`,
      };
    }
    // Nothing expected this week and no entry → no tooltip.
    if (!overriding && Math.round(v) === 0) return undefined;

    // The full per-row forecast calculation, built the same way whether or not the
    // cell is overridden — so an edit keeps the rich tooltip (with a note added).
    const help: CellHelp | undefined = (() => {
    switch (row.kind) {
      case 'nhs':
        return {
          description: `Your annual NHS contract ÷ 12 — NHS pays a fixed amount each month, shown in the first full week of ${monthLong(i)} when the payment lands.`,
          calculation: `Monthly NHS = Annual contract (${gbp(v * 12)}) ÷ 12 = ${gbp(v)}.`,
        };
      case 'membership': {
        const calc = row.membershipCalc?.[i];
        const meta = row.membershipMeta;
        // No breakdown available (e.g. no upload history) → plain note.
        if (!calc) {
          return {
            description: `${row.label}'s monthly ${membershipProvider} income, paid in the week of the 15th. Reduced slightly each month for members leaving (about 5% a year).`,
            calculation: `${membershipProvider} income = ${gbp(v)} for ${monthLong(i)}.`,
          };
        }
        const members = Math.round(calc.members);
        const memberWord = members === 1 ? 'member' : 'members';
        const est = calc.observed ? '' : ' (estimated — not enough membership uploads yet)';
        // One-decimal, trailing-zero-trimmed (e.g. 6.2, 4) for the add/remove counts.
        const n1 = (x: number) => (Math.round(x * 10) / 10).toString();
        // Prose: where it comes from, and the AI hand-off when AI is on.
        const description = isAi
          ? `${row.label}'s monthly ${membershipProvider} income, paid in the week of the 15th. We send Claude your month-by-month joiners and leavers from the membership sheet, and it trends those add/remove numbers forward to this figure.`
          : `${row.label}'s monthly ${membershipProvider} income, paid in the week of the 15th. Projected forward from your uploaded membership sheet using the members joining and leaving each month.`;
        // Named, multi-step worked formula: net member change → members rolled
        // forward → monthly income → AI forecast.
        const cur = meta ? Math.round(meta.currentMembers) : members;
        const net = calc.joiners - calc.leavers;
        const netLine = calc.observed
          ? `Net change = ${n1(calc.joiners)} joining − ${n1(calc.leavers)} leaving = ${net >= 0 ? '+' : '−'}${n1(Math.abs(net))}/month${meta ? ` (over ${meta.monthsObserved} mo)` : ''}. `
          : '';
        // Projected members is fractional (an expected value, e.g. 596.3). Show it
        // to 1 dp here so the breakdown reconciles: baseAmount = members ×
        // avgRevenuePerMember is computed from this UNrounded count, so printing the
        // whole-number 596 made "596 × £27.29" fall short of the shown total.
        const membersPrecise = n1(calc.members);
        const membersLine = calc.monthsAhead > 0
          ? `Members = ${cur} now → ${membersPrecise} (${calc.monthsAhead} mo on). `
          : '';
        const incomeLine = `${membershipProvider} income = ${gbp(calc.baseAmount)} for ${monthLong(i)} (≈ ${membersPrecise} ${memberWord} × £${calc.avgRevenuePerMember.toFixed(2)}/member)${est}.`;
        const aiLine = isAi ? ` AI forecast = ${gbp(v)}.` : '';
        return { description, calculation: `${netLine}${membersLine}${incomeLine}${aiLine}` };
      }
      case 'private': {
        const pct = privatePct[i] ?? 0;
        // Appointment-driven private revenue: real projected income redistributed
        // across the weeks by booked appointments. Spell out the full derivation.
        if (row.tdMeta && !overriding) {
          const m = row.tdMeta;
          const booked = m.futureAppts[i] ?? 0;
          const appts = m.trailingAppts.toLocaleString('en-GB');
          const rateLine = `${gbp(m.realTotal)} ÷ ${appts} completed appts = ${gbp(m.avgPerAppt)}/appt`;
          if (booked > 0) {
            // This week is driven by its booked appointments × the per-appointment rate.
            const det = Math.round(booked * m.avgPerAppt * 100) / 100;
            const lines = [rateLine, `${booked} booked × ${gbp(m.avgPerAppt)} = ${gbp(det)}`];
            const aiv = isAi ? aiFor(privateRow, i) : null;
            if (aiv != null && Math.round(aiv) !== Math.round(det)) lines.push(`AI forecast = ${gbp(Math.round(aiv))}`);
            if (pct) lines.push(`adjust ${pct > 0 ? '+' : '−'}${Math.abs(pct)}% = ${gbp(v)}`);
            return {
              description: `Forecast from this week's booked appointments: your 13-week private revenue ÷ completed appointments sets the rate (${gbp(m.avgPerAppt)}/appt), times the ${booked} appointments booked this week${pct ? `, then your adjustment % applied` : ''}.`,
              calculation: lines.join('\n'),
            };
          }
          // No appointments booked for this week yet → follow the revenue trend
          // (the figure shown matches the cell: avg weekly revenue grown by momentum).
          const trendVal = privateRow.baseline?.[i] ?? 0;
          const lines = [rateLine, `no appointments booked yet → revenue trend = ${gbp(trendVal)}`];
          if (pct) lines.push(`adjust ${pct > 0 ? '+' : '−'}${Math.abs(pct)}% = ${gbp(v)}`);
          return {
            description: `No appointments are booked for this week yet, so it follows your 13-week private revenue trend until the diary fills in${pct ? `, then your adjustment % applied` : ''}. As bookings come in it switches to those appointments × the per-appointment rate.`,
            calculation: lines.join('\n'),
          };
        }
        // Pre-% figure: the AI forecast when AI is on, otherwise the deterministic
        // forecast (the 13-week revenue TREND + the week's booked-appointment add-on).
        // Use baseline (not values) so an override doesn't replace the forecast base.
        const preAdj = (isAi ? aiFor(privateRow, i) : null) ?? privateRow.baseline?.[i] ?? 0;
        const avgWk = privateAvgWeekly ?? 0;
        const trend = privateTrendPct ?? 0;
        const trendNote = trend ? `${trend > 0 ? '+' : '−'}${Math.abs(trend)}%/wk` : 'flat';
        // Stacked calc: the 13-week average weekly revenue (the trend's level), then
        // the trend + this week's booking add-on, then any manual adjustment %.
        const baseLine = `13-wk avg = ${gbp(avgWk)}/wk`;

        if (isAi) {
          const description = `AI's forecast of your private treatment income for this week — it learned the TREND of your weekly private revenue (across your mapped private plans) over the last 13 weeks and projected it forward${pct ? `, then your adjustment % is applied` : ''}.`;
          const lines = [baseLine, `AI forecast = ${gbp(preAdj)}`];
          if (pct) lines.push(`adjust ${pct > 0 ? '+' : '−'}${Math.abs(pct)}% = ${gbp(v)}`);
          return { description, calculation: lines.join('\n') };
        }

        // Deterministic forecast: the 13-week revenue trend (average weekly revenue
        // grown by the observed momentum), plus an add-on for that week's booked
        // appointments, then any manual adjustment %.
        const description = `Forecast of your private treatment income: your average weekly private revenue over the last 13 weeks, projected forward by the revenue trend, then adjusted up or down for how many appointments are booked that week versus a typical week${pct ? `, then nudged by this week's adjustment %` : ''}.`;
        const lines = [baseLine, `trend ${trendNote} + bookings → wk ${i + 1} = ${gbp(preAdj)}`];
        if (pct) lines.push(`adjust ${pct > 0 ? '+' : '−'}${Math.abs(pct)}% = ${gbp(v)}`);
        return { description, calculation: lines.join('\n') };
      }
      case 'cost':
      case 'expense': {
        // Base = the matching trailing week's actual spend, repeated forward;
        // with AI on it is refined to the figure shown.
        const base = row.baseline?.[i] ?? row.values[i] ?? 0;
        // 13-week run-rate from the trailing pattern (the baseline IS the trailing
        // weekly actuals). Shown as the basis — the cell value is unchanged.
        const trailing = row.baseline ?? [];
        const trTotal = trailing.reduce((s, x) => s + (x || 0), 0);
        // Precise (not rounded) so "13-wk total £X (avg £Y/wk)" reconciles: Y × 13 ≈ X.
        const avgWk = trTotal / Math.max(1, trailing.length);
        const runRate = `Basis: 13-wk total ${gbp(trTotal)} (avg ${gbp(avgWk)}/wk).`;
        const description = isAi
          ? `Your ${row.label} spend, forecast from your last 13 weeks: AI learned your week-by-week ${row.label} spend and projected that run-rate into this week.`
          : `Your ${row.label} spend, forecast from your last 13 weeks: this week mirrors the same week of the trailing period, with your 13-week run-rate shown as the basis.`;
        // £ the AI moved this week away from the matching trailing week.
        const aiDelta = Math.round((v - base) * 100) / 100;
        const aiDeltaNote = base ? ` (${gbp(aiDelta)} vs base)` : '';
        // Billing cadence detected from this account's real supplier invoices.
        const cad = detectedCadenceFor(row);
        const cadNote = cad === 'monthly' ? ' Billed ~monthly (from supplier invoices) — projected forward.' : cad === 'weekly' ? ' Billed ~weekly (from supplier invoices) — projected forward.' : '';
        const calculation = (isAi
          ? `Base = Matching week 13 weeks ago (${gbp(base)}). AI forecast = ${gbp(v)}${aiDeltaNote}. ${runRate}`
          : `Forecast = Matching week 13 weeks ago = ${gbp(v)}. ${runRate}`) + cadNote;
        return { description, calculation };
      }
      case 'coa': {
        // Lower-block rows (Investing/Financing/Tax/Inter-Company) from your
        // Chart-of-Accounts mapping. A fixed cell is a known invoice/bill due
        // that week; otherwise it's the trailing-13-week pattern repeated forward.
        if (row.fixed?.[i]) {
          return {
            description: `A known ${row.label} invoice due the week of ${week}, placed from its due date.`,
            calculation: `Due = ${gbp(v)} (week of ${week}).`,
          };
        }
        // Appointment-driven Lab Fees / Materials / Consumables: the account's real
        // invoice level spread across the weeks by booked-appointment volume. Spell
        // out the full derivation so the figure is fully justified.
        if (row.tdMeta && !overriding) {
          const m = row.tdMeta;
          const who = m.providers.slice(0, 3).join(', ') + (m.providers.length > 3 ? ` +${m.providers.length - 3} more` : '');
          const noun = m.kind === 'lab' ? 'lab fee' : 'material/consumable cost';
          // Only the relevant appointments form the denominator: lab-type for lab,
          // material-relevant (clinical, non-exam) for materials.
          const apptWord = m.kind === 'lab' ? 'lab appts' : 'clinical appts';
          const booked = m.futureAppts[i] ?? 0;
          const appts = m.trailingAppts.toLocaleString('en-GB');
          const det = Math.round((booked > 0 ? booked * m.avgPerAppt : m.realTotal / weeks.length) * 100) / 100;
          const lines = [
            `${gbp(m.realTotal)} ÷ ${appts} ${apptWord} = ${gbp(m.avgPerAppt)}/appt`,
            booked > 0
              ? `${booked} booked × ${gbp(m.avgPerAppt)} = ${gbp(det)}`
              : `0 booked → run-rate = ${gbp(det)}`,
          ];
          // AI (or anything) moved the deterministic figure → show the final value,
          // labelled so the gap from the appointment-driven basis isn't a mystery.
          if (Math.round(v) !== Math.round(det)) lines.push(`${isAi ? 'AI-adjusted forecast' : 'forecast'} = ${gbp(v)}`);
          return {
            description: `${who}'s ${noun}, forecast from booked appointments — not supplier invoices guessed forward. Real spend ${gbp(m.realTotal)} over the last 13 weeks ÷ ${appts} ${apptWord} = ${gbp(m.avgPerAppt)} each; every week scales by how many are booked.${isAi ? ' The AI then refined this week from your wider spending pattern, so the final figure differs from the raw appointment maths.' : ''}`,
            calculation: lines.join('\n'),
          };
        }
        const base = row.baseline?.[i] ?? row.values[i] ?? 0;
        // 13-week run-rate basis from the row's own series (display only — the
        // cell value is unchanged).
        const trailing = row.baseline ?? [];
        const trTotal = trailing.reduce((s, x) => s + (x || 0), 0);
        // Precise (not rounded) so "13-wk total £X (avg £Y/wk)" reconciles: Y × 13 ≈ X.
        const avgWk = trTotal / Math.max(1, trailing.length);
        const runRate = `Basis: 13-wk total ${gbp(trTotal)} (avg ${gbp(avgWk)}/wk).`;
        // Billing cadence detected from this account's real supplier invoices.
        const cad = detectedCadenceFor(row);
        // A weekly-recurring cost is forecast as an EVEN run-rate (its real trailing
        // total spread across the 13 weeks), so its explanation differs from the
        // non-recurring "same week, 13 weeks ago" mirror.
        const weeklyRunRate = cad === 'weekly';
        const description = isAi
          ? `Your ${row.label} cash, forecast from your last 13 weeks: AI refined this from your actual ${row.label} activity over the period.`
          : weeklyRunRate
            ? `Your ${row.label} cash, forecast from your real 13-week run-rate and then trended forward — if your spend has been rising or falling, the forecast keeps moving that way (capped so it stays grounded).`
            : `Your ${row.label} cash, forecast from your last 13 weeks: this week mirrors the same week of the trailing period, with your 13-week run-rate shown as the basis.`;
        // £ the AI moved this week away from the matching trailing week.
        const aiDelta = Math.round((v - base) * 100) / 100;
        const aiDeltaNote = base ? ` (${gbp(aiDelta)} vs base)` : '';
        const cadNote = cad === 'monthly' ? ' Billed ~monthly (from supplier invoices) — projected forward.' : '';
        const calculation = (isAi
          ? `Base = Matching week 13 weeks ago (${gbp(base)}). AI forecast = ${gbp(v)}${aiDeltaNote}. ${runRate}`
          : weeklyRunRate
            ? `Trended run-rate = ${gbp(v)} this week. ${runRate}`
            : `Forecast = Matching week 13 weeks ago = ${gbp(v)}. ${runRate}`) + cadNote;
        return { description, calculation };
      }
      default:
        return undefined;
    }
    })();

    if (!help) {
      // No forecast detail available — fall back to a plain note on an edit.
      return overriding
        ? { description: `You entered this amount for the week of ${week}, overriding the forecast.`, calculation: `Your entry = ${gbp(entry)}.` }
        : undefined;
    }
    // On an edit, keep the full forecast calculation and note the manual entry.
    if (overriding) {
      return {
        description: `${help.description} (You entered ${gbp(entry)} for this week, which overrides this forecast.)`,
        calculation: help.calculation,
      };
    }
    return help;
  };

  // Per-week column sum using the DISPLAYED value (AI-aware via dispVal), so every
  // total/subtotal reconciles with the numbers shown in the cells.
  const sumDisp = (rows: ForecastRow[]) => weeks.map((_, i) => rows.reduce((s, r) => s + dispVal(r, i), 0));

  // Operating row groups (data rows + manual extras), mirroring the sheet.
  // Income include-toggles: an off stream drops out of the displayed inflow totals
  // (its rows are hidden in renderRow), so totals and rows stay consistent.
  const incomeInclude = forecastSettings.module.income;
  const inflowRowList = [
    ...(incomeInclude.includeNHS ? [nhsRow] : []),
    ...(incomeInclude.includeDenplan ? membershipRows : []),
    ...(incomeInclude.includePrivate ? [privateRow] : []),
    ...operatingInflowExtraRows,
    ...customRows,
  ];
  const directRowList = [...outflowCostRows, ...operatingDirectExtraRows];
  const expenseRowList = [...outflowExpenseRows, ...operatingExpenseExtraRows, ...outflowCustomRows];

  const dispInflowTotals = sumDisp(inflowRowList);
  const dispDirectTotals = sumDisp(directRowList);
  const dispExpenseTotals = sumDisp(expenseRowList);
  const dispOutflowTotals = weeks.map((_, i) => dispDirectTotals[i] + dispExpenseTotals[i]);
  const dispContribution = weeks.map((_, i) => dispInflowTotals[i] - dispDirectTotals[i]);
  const dispOperatingNet = weeks.map((_, i) => dispContribution[i] - dispExpenseTotals[i]);

  // Manual blocks carry no AI, so their hook totals/nets are already the displayed
  // values. Total weekly net = operating + every block; end cash rolls forward
  // from the editable opening balance.
  const totalWeeklyNet = weeks.map((_, i) =>
    dispOperatingNet[i] + manualBlocks.reduce((s, b) => s + b.net[i], 0));
  const dispEndCash = (() => {
    let run = startCash;
    return weeks.map((_, i) => { run += totalWeeklyNet[i]; return run; });
  })();

  // ── Revenue scenario (Best / Most likely / Worst) ──
  // The top-of-page quick buttons persist the active case to Forecast Settings, which
  // re-projects income by the flat scenario %. Base case (null) = reconciled figures.
  const scenario = forecastSettings.scenario;
  const setScenarioActive = (active: ScenarioKey | null) =>
    saveForecastSettings({ ...forecastSettings, preset: 'custom', scenario: { ...forecastSettings.scenario, active } });

  // ── Export snapshot ── built from the SAME displayed values as the table (scenario-
  // and override-aware) so Excel / PDF always match the screen.
  const buildExportData = (): ForecastExportData => {
    const rowVals = (row: ForecastRow) => weeks.map((_, i) => Math.round(row.key === 'private' ? privateEffective(i) : dispVal(row, i)));
    const toRows = (rows: ForecastRow[]): ForecastExportRow[] => rows.map((r) => ({ label: r.label, values: rowVals(r), indent: true }));
    const sections: ForecastExportSection[] = [
      { title: 'Cash Inflow', rows: [...toRows(inflowRowList), { label: 'Weekly Cash Inflow', values: dispInflowTotals, strong: true }] },
      { title: 'Cash Outflow — Direct Costs', rows: [...toRows(directRowList), { label: 'Weekly Direct Costs Outflow', values: dispDirectTotals, strong: true }] },
      { title: 'Cash Outflow — Expenses', rows: [...toRows(expenseRowList), { label: 'Weekly Expenses Outflow', values: dispExpenseTotals, strong: true }] },
    ];
    // Lower blocks (Investing / Financing / Tax / Inter-Company) — only when they carry data.
    for (const b of manualBlocks) {
      const brows = [...b.inflow.rows, ...b.outflow.rows];
      if (!brows.some((r) => rowVals(r).some((v) => v !== 0))) continue;
      sections.push({ title: b.netLabel.replace('Weekly Net Cash Flow', 'Cash Flow'), rows: [...toRows(brows), { label: b.netLabel, values: b.net, strong: true }] });
    }
    sections.push({
      title: 'Summary',
      rows: [
        { label: 'Weekly Net Cash Flow Contribution', values: dispContribution, strong: true },
        { label: 'Weekly Net Cash Flow (Operating)', values: dispOperatingNet, strong: true },
        { label: 'Total Weekly Net Cash Flow', values: totalWeeklyNet, strong: true },
        { label: 'End Cash', values: dispEndCash, strong: true },
      ],
    });
    return {
      title: '13-Week Cash Flow Forecast',
      scope: scopeLabel,
      period: periodLabel,
      scenario: scenario.active ? `${SCENARIO_LABELS[scenario.active]} (${scenarioPct(scenario) >= 0 ? '+' : ''}${scenarioPct(scenario)}%)` : undefined,
      generatedOn: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
      weekLabels: weeks.map((w) => w.weekStart.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })),
      sections,
    };
  };

  // ── "Decisions Made" — AI-assisted suggested focus per week ──
  // A smart, plain-language prompt derived from the SAME displayed numbers (net,
  // End Cash, threshold) so it always reconciles with the table. We only surface a
  // suggestion for weeks that actually warrant a decision (breach / thin buffer /
  // negative net), so it reads as signal, not noise. The user clicks "Use" to seed
  // the note, then edits — the human note stays the source of truth.
  const topOutflowFor = (i: number): { label: string; amount: number } | null => {
    const rows = [...directRowList, ...expenseRowList, ...manualBlocks.flatMap((b) => b.outflow.rows)];
    let best: { label: string; amount: number } | null = null;
    for (const r of rows) {
      const v = Math.abs(dispVal(r, i));
      if (v > 0 && (!best || v > best.amount)) best = { label: r.label, amount: v };
    }
    return best;
  };
  const weekSuggestion = (i: number): string | null => {
    const thr = thrSeriesFor(END_CASH_THRESHOLD_KEY)[i]; // min closing balance (carried forward)
    const endCash = dispEndCash[i] ?? 0;
    const net = totalWeeklyNet[i] ?? 0;
    const top = topOutflowFor(i);
    const deferHint = top ? `deferring “${top.label}” (${gbp(top.amount)})` : 'deferring a large payment';
    if (thr != null && endCash < thr) {
      return `End Cash falls to ${gbp(endCash)} — below your ${gbp(thr)} minimum to cover bills. Consider ${deferHint} or pulling income forward this week.`;
    }
    if (net < 0) {
      return `Net cash is −${gbp(Math.abs(net))} this week${top ? ` — the biggest outflow is “${top.label}” (${gbp(top.amount)})` : ''}. Note why, or plan to offset it.`;
    }
    if (thr != null && endCash <= thr * 1.15) {
      return `End Cash ${gbp(endCash)} is close to your ${gbp(thr)} minimum — thin buffer, keep new spend tight.`;
    }
    return null;
  };

  // ── Closing-bank-balance breach → single persisted status for the daily cron ──
  // The threshold is the minimum End Cash (running closing balance) the practice must
  // keep to cover bills. Any week whose End Cash drops below it is a breach; we persist
  // ONE status (first breach) so the backend cron raises a single 08:00 alert.
  const anyThresholdSet = !!thresholdsByKey?.[END_CASH_THRESHOLD_KEY];
  const firstBreach = (() => {
    const ecThr = thrSeriesFor(END_CASH_THRESHOLD_KEY);
    for (let i = 0; i < weeks.length; i++) {
      const t = ecThr[i]; const v = dispEndCash[i] ?? 0;
      if (t != null && v < t) return { i, value: v, limit: t, title: `Closing balance below minimum — ${scopeLabel}`, message: `${scopeLabel}: End Cash ${gbp(v)} is below your ${gbp(t)} minimum to cover bills in the week of ${weeks[i].label}.` };
    }
    return null;
  })();
  // ── EVERY threshold → persisted status list for the daily cron ──
  // Beyond End Cash, the user can cap any cost row (Lab Fees, Materials, a clinician,
  // …) or floor any income row from that row's threshold panel. We detect EVERY set
  // threshold and persist each one's verdict, so the cron raises/resolves an alert
  // per (location, threshold) — not just for the closing balance.
  const valueAtForThreshold = (key: string, i: number): number => {
    if (key === END_CASH_THRESHOLD_KEY) return dispEndCash[i] ?? 0;
    const row = rowsByKey.get(key);
    if (!row) return 0;
    return row.key === 'private' ? privateEffective(i) : dispVal(row, i);
  };
  const thresholdKindForKey = (key: string): 'min' | 'max' => {
    if (key === END_CASH_THRESHOLD_KEY) return 'min';
    const row = rowsByKey.get(key);
    return row ? thresholdKindFor(row) : 'min';
  };
  const thresholdLabelForKey = (key: string): string =>
    key === END_CASH_THRESHOLD_KEY ? 'End Cash' : (rowsByKey.get(key)?.label ?? key);

  // Keys that actually have a value set (a key can exist with an all-null series).
  const setThresholdKeys = thresholdsByKey
    ? Object.keys(thresholdsByKey).filter((k) => (thresholdsByKey[k] ?? []).some((t) => t != null))
    : [];
  const thresholdBreaches = setThresholdKeys.map((key) => {
    const series = thrSeriesFor(key);
    const kind = thresholdKindForKey(key);
    const label = thresholdLabelForKey(key);
    let hit: { i: number; value: number; limit: number } | null = null;
    for (let i = 0; i < weeks.length; i++) {
      const t = series[i];
      if (t == null) continue;
      const v = valueAtForThreshold(key, i);
      if (kind === 'min' ? v < t : v > t) { hit = { i, value: v, limit: t }; break; }
    }
    const title = hit
      ? (kind === 'min' ? `${label} below minimum — ${scopeLabel}` : `${label} above maximum — ${scopeLabel}`)
      : `${label} threshold`;
    const message = hit
      ? (kind === 'min'
          ? `${scopeLabel}: ${label} ${gbp(hit.value)} is below your ${gbp(hit.limit)} minimum in the week of ${weeks[hit.i].label}.`
          : `${scopeLabel}: ${label} ${gbp(hit.value)} is above your ${gbp(hit.limit)} maximum in the week of ${weeks[hit.i].label}.`)
      : '';
    return {
      key, label, kind,
      inBreach: !!hit,
      breachWeekIso: hit ? (weeks[hit.i]?.iso ?? null) : null,
      weekLabel: hit ? (weeks[hit.i]?.label ?? null) : null,
      weekIndex: hit ? hit.i : null,
      value: hit ? hit.value : null,
      limit: hit ? hit.limit : null,
      title, message,
    };
  });
  const thresholdStatus = thresholdBreaches.length
    ? {
        locationId: selectedLocationId ?? null,
        locationName: scopeLabel,
        anchorIso: weeks[0]?.iso ?? '',
        thresholds: thresholdBreaches,
      }
    : null;
  useThresholdStatusSync(thresholdStatus, !isLoading);

  // ── Actual (previous 13 weeks) values per row KEY — powers the variance view
  // and the per-line graph. Rows are keyed identically across forecast and the
  // `previous` actuals (nhs / membership:* / private / coa:* / materials …), so a
  // forecast line maps to its trailing actual by key. Missing key → no history. ──
  const prevValuesByKey = useMemo(() => {
    const m = new Map<string, number[]>();
    const add = (rows?: { key: string; values: number[] }[]) => rows?.forEach((r) => m.set(r.key, r.values));
    add(previous?.inflow); add(previous?.direct); add(previous?.expense);
    previous?.blocks?.forEach((b) => { add(b.inflow.rows); add(b.outflow.rows); });
    return m;
  }, [previous]);
  const prevSeriesFor = (key: string): number[] => prevValuesByKey.get(key) ?? [];
  const prevTotalFor = (key: string): number => prevSeriesFor(key).reduce((s, v) => s + (v ?? 0), 0);
  // Displayed-window actuals (each shown week's OWN actual) — powers the Combined tab.
  const currentValuesByKey = useMemo(() => {
    const m = new Map<string, number[]>();
    const add = (rows?: { key: string; values: number[] }[]) => rows?.forEach((r) => m.set(r.key, r.values));
    add(current?.inflow); add(current?.direct); add(current?.expense);
    current?.blocks?.forEach((b) => { add(b.inflow.rows); add(b.outflow.rows); });
    return m;
  }, [current]);
  const currentSeriesFor = (key: string): number[] => currentValuesByKey.get(key) ?? [];
  const rowForecastTotal = (row: ForecastRow): number => weeks.reduce((s, _w, i) => s + dispVal(row, i), 0);

  // Variance colour BY REVENUE TYPE (single source of truth for every variance
  // shown — Combined table + per-line graph). Income up or cost down = favourable
  // (green); income down or cost up = unfavourable (red); a net line is favourable
  // when higher. ~£0 variance stays neutral grey.
  const varianceColorClass = (variance: number, opts: { isOutflow?: boolean; net?: boolean }): string => {
    const favourable = Math.abs(variance) < 1 ? null
      : opts.net ? variance > 0
      : opts.isOutflow ? variance < 0
      : variance > 0;
    return favourable == null ? 'text-muted-foreground' : favourable ? 'text-emerald-600' : 'text-rose-600';
  };

  // Build the payload Claude predicts from. Membership, Private, and the outflow
  // cost rows are AI-forecast from their real trailing-13-week data. NHS keeps
  // its deterministic forecast (a fixed contract ÷ 12) and is NOT sent. Empty
  // rows are skipped — nothing is forecast without a past record.
  const buildAIPayload = () => {
    const rowsForAI: AIForecastRowInput[] = [];
    // ym (year*12+month) → 'yyyy-MM' for the membership activity Claude receives.
    const ymToMonth = (ym: number): string => {
      const month = ((ym - 1) % 12) + 1;
      const year = Math.floor((ym - 1) / 12);
      return `${year}-${String(month).padStart(2, '0')}`;
    };
    const add = (row: ForecastRow, cadence: 'monthly-lump' | 'weekly') => {
      if (row.values.some((v) => v !== 0)) {
        const aiSection: 'inflow' | 'outflow' = row.section === 'outflow' || row.section.endsWith('out') ? 'outflow' : 'inflow';
        const input: AIForecastRowInput = { key: row.key, label: row.label, section: aiSection, cadence, baseline: row.values };
        // Ground membership lumps in the real month-by-month add/remove activity
        // so Claude trends the base on joiners vs leavers, not just the flat line.
        const m = row.membershipMeta;
        if (m) {
          input.membership = {
            currentMembers: Math.round(m.currentMembers),
            avgRevenuePerMember: Math.round(m.avgRevenuePerMember),
            avgMonthlyJoiners: Math.round(m.avgMonthlyJoiners * 10) / 10,
            avgMonthlyLeavers: Math.round(m.avgMonthlyLeavers * 10) / 10,
            monthlyChurnPct: Math.round(m.monthlyChurnPct * 10) / 10,
            monthsObserved: m.monthsObserved,
            monthlyActivity: m.activity.map((a) => ({
              month: ymToMonth(a.ym),
              members: a.members,
              joiners: a.joiners,
              leavers: a.leavers,
              revenue: Math.round(a.revenue),
            })),
          };
        }
        // Ground the Private forecast in real volume × value: the trailing
        // week-by-week patient counts AND revenue, so Claude forecasts from
        // "N patients at £X" rather than just the revenue line.
        if (row.key === 'private' && privateTrailing) {
          const weeklyActivity = weeks.map((_, idx) => ({
            week: idx + 1,
            patients: Math.round(privatePatients?.[idx] ?? 0),
            revenue: Math.round(privateTrailing[idx] ?? 0),
          }));
          const totPatients = weeklyActivity.reduce((s, a) => s + a.patients, 0);
          const totRevenue = weeklyActivity.reduce((s, a) => s + a.revenue, 0);
          input.private = {
            avgPatientsPerWeek: Math.round((totPatients / Math.max(1, weeklyActivity.length)) * 10) / 10,
            avgRevenuePerPatient: totPatients > 0 ? Math.round(totRevenue / totPatients) : 0,
            weeklyTrendPct: privateTrendPct ?? 0,
            weeklyActivity,
            // The diary — booked appointments per forecast week. Claude forecasts the
            // Private row FROM this + the trailing history, instead of nudging our number.
            bookedAppointments: (privateBookedAppointments ?? []).map((v) => Math.round(v || 0)),
            diaryReliableWeeks: diaryReliableWeeks ?? 0,
          };
        }
        rowsForAI.push(input);
      }
    };
    // Membership keeps its monthly cadence (Denplan pays monthly) — AI adjusts
    // the per-clinician monthly amounts, it doesn't spread them across weeks.
    membershipRows.forEach((r) => add(r, 'monthly-lump'));
    // Private income has a real week-by-week pattern → AI forecasts it weekly.
    add(privateRow, 'weekly');
    // Outflow costs/expenses: Profit-Expenses grouped rows are weekly run-rates;
    // Category-Range per-account rows ('coa') are monthly lumps.
    // Cadence follows each account's real invoice rhythm (detected from its ACCPAY
    // bills), so a monthly fixed cost is sent as a monthly lump and the AI keeps it
    // monthly instead of smoothing it into a weekly run-rate.
    outflowCostRows.forEach((r) => add(r, aiCadenceFor(r)));
    outflowExpenseRows.forEach((r) => add(r, aiCadenceFor(r)));
    // Lower-block COA rows (Investing/Financing/Tax/Inter-Company) are lumpy, so
    // AI refines them as monthly lumps. Cells fixed by a known invoice due date
    // are facts and are skipped by aiFor, so the AI can't overwrite them.
    manualBlocks
      .flatMap((b) => [...b.inflow.rows, ...b.outflow.rows])
      .filter((r) => r.kind === 'coa')
      .forEach((r) => add(r, 'monthly-lump'));
    return {
      period: periodLabel,
      weeks: weeks.map((w) => ({ weekNumber: w.weekNumber, date: w.iso })),
      rows: rowsForAI,
    };
  };

  // Run the prediction, auto-retrying transient failures (e.g. the backend
  // bouncing under `node --watch`, which surfaces as BACKEND_UNREACHABLE).
  const runPrediction = (attempt = 0) => {
    const payload = buildAIPayload();
    if (payload.rows.length === 0) return;
    predict(payload, {
      onError: () => {
        if (attempt < 2) window.setTimeout(() => runPrediction(attempt + 1), 3000);
      },
    });
  };

  // Persist this scope's computed baseline so the twice-daily backend cron
  // (aiForecastCron) has something to regenerate from — it cannot recompute the
  // baseline itself without a second copy of this engine. Gated on the same
  // "everything settled" condition as the live run below, so a half-loaded payload
  // is never stored.
  const forecastSettled = !isLoading && !outflowLoading && !blockLoading && weeks.length > 0;
  const aiSnapshotPayload = useMemo(() => {
    if (!forecastSettled) return null;
    const p = buildAIPayload();
    if (!p.rows.length) return null;
    return {
      ...p,
      locationLabel: scopeLabel,
      anchorIso: weeks[0]?.iso ?? '',
      locationId: selectedLocationId ?? null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forecastSettled, selectedLocationId, selectedRegionId, weeks[0]?.iso]);
  useAiForecastSnapshotSync(aiSnapshotPayload, forecastSettled);

  // Auto-run the prediction once the baseline is ready, and re-run whenever the
  // scope (location/region) or the forecast anchor changes — so the sheet shows
  // AI numbers week-wise without the user pressing anything. Keyed on a cheap
  // signature so manual cell edits don't re-trigger it.
  // The AI predicts membership + outflow, but the outflow (weekly cost) query
  // loads AFTER the inflow. Fire the prediction once everything has SETTLED
  // (inflow ready and the outflow query no longer loading) so the payload
  // contains both membership and cost rows together, in one call.
  // On a scope/anchor change, immediately drop the PREVIOUS location's AI overlay
  // so the table + tooltips never mix the new baseline with stale AI numbers. The
  // new prediction re-runs below once the new scope's data has settled; until then
  // cells/tooltips show the deterministic value (correct for the new location).
  const scopeSig = `${selectedRegionId ?? ''}|${selectedLocationId ?? ''}|${weeks[0]?.iso ?? ''}`;
  const lastScopeRef = useRef<string>(scopeSig);
  useEffect(() => {
    if (lastScopeRef.current === scopeSig) return;
    lastScopeRef.current = scopeSig;
    clearAi();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeSig]);

  // Only run a LIVE prediction when the cron has nothing stored for this scope/anchor
  // (a brand-new scope, or the anchor has rolled to a new week before the cron's next
  // pass). Otherwise the stored twice-daily forecast is used as-is, so the practice sees
  // the SAME numbers all day instead of a slightly different Claude answer per reload —
  // and we don't spend a Claude call on every page open.
  const aiSignature = `${selectedRegionId ?? ''}|${selectedLocationId ?? ''}|${weeks[0]?.iso ?? ''}|${outflowLoading ? 'loading' : 'ready'}|${blockLoading ? 'b-loading' : 'b-ready'}`;
  const lastSigRef = useRef<string>('');
  useEffect(() => {
    if (isLoading || outflowLoading || blockLoading || weeks.length === 0) return;
    if (storedAi) return;                       // scheduled forecast already covers this scope
    if (lastSigRef.current === aiSignature) return;
    lastSigRef.current = aiSignature;
    runPrediction();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiSignature, isLoading, outflowLoading, blockLoading, weeks.length, storedAi]);

  // Per-line graph (popover): this row's 13 forecast weeks (solid blue) overlaid
  // with its 13 trailing-actual weeks (dashed grey), a per-week variance line
  // (amber), and the business-wide cash threshold (faint dashed) — aligned by week
  // position, plus the forecast/actual totals and the £/% variance between them.
  const RowMiniChart = ({ row }: { row: ForecastRow }) => {
    const actual = prevSeriesFor(row.key);
    const hasActual = actual.some((v) => (v ?? 0) !== 0);
    // Threshold (adjustable here) — only the End Cash closing-balance line carries one.
    const tKey = thresholdKeyFor(row);
    const isThrRow = row.key === END_CASH_THRESHOLD_KEY;
    const thrKind = thresholdKindFor(row);
    const rowHasThr = !!thresholdsByKey?.[tKey];
    const curThr = thrSeriesFor(tKey).find((t) => t != null) ?? null;
    const commitThr = (raw: string) => {
      const s = raw.replace(/[^0-9.\-]/g, '').trim();
      const amount = s === '' ? null : Number(s);
      setCell.mutate({ weekStart: weeks[0].iso, lineKey: tKey, amount: amount != null && Number.isFinite(amount) ? amount : null, section: 'threshold' });
    };
    const data = weeks.map((w, i) => {
      const fc = Math.round(row.key === 'private' ? privateEffective(i) : row.key === END_CASH_THRESHOLD_KEY ? (dispEndCash[i] ?? 0) : dispVal(row, i));
      const ac = Math.round(actual[i] ?? 0);
      // This row's OWN threshold (Lab/Clinician max), if it has one; else none.
      const thr = thresholdsByKey?.[row.key]?.[i] ?? null;
      return {
        label: w.label,
        forecast: fc,
        actual: ac,
        // Per-week variance, same sign as the header chips below (Forecast − Actual).
        variance: hasActual ? fc - ac : null,
        threshold: thr != null ? Math.round(thr) : null,
      };
    });
    const fcTotal = rowForecastTotal(row);
    const acTotal = prevTotalFor(row.key);
    const variance = fcTotal - acTotal;
    const isOutflow = row.section === 'outflow' || row.section.endsWith('out');
    const vColor = varianceColorClass(variance, { isOutflow });
    const pct = acTotal !== 0 ? (variance / Math.abs(acTotal)) * 100 : null;
    return (
      <div>
        <div className="mb-1 text-sm font-medium text-foreground">{row.label}</div>
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
          <span className="font-medium text-[#2563eb]">Forecast {gbp(fcTotal)}</span>
          {hasActual && <span className="text-muted-foreground">Actual {gbp(acTotal)}</span>}
          {hasActual && (
            <span className={vColor}>
              {gbp(variance)}{pct != null ? ` (${formatPercentDisplay(pct, 0)})` : ''}
            </span>
          )}
        </div>
        <ResponsiveContainer width="100%" height={150}>
          <ComposedChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 9 }} interval={2} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 9 }} width={42} tickFormatter={(v) => gbp(v)} tickLine={false} axisLine={false} />
            <RechartsTooltip
              formatter={(v: number, n: string) => [gbp(v), n === 'forecast' ? 'Forecast' : n === 'actual' ? 'Actual (prev)' : n === 'variance' ? 'Variance' : 'Threshold']}
              contentStyle={{ fontSize: 11 }}
            />
            {rowHasThr && <Line type="stepAfter" dataKey="threshold" name="threshold" stroke="hsl(var(--destructive))" strokeWidth={1.2} strokeDasharray="5 4" dot={false} connectNulls={false} />}
            {hasActual && <Line type="monotone" dataKey="actual" name="actual" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="4 3" dot={false} />}
            {hasActual && <Line type="monotone" dataKey="variance" name="variance" stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="2 3" dot={false} connectNulls={false} />}
            <Line type="monotone" dataKey="forecast" name="forecast" stroke="#2563eb" strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
        {/* Adjustable threshold (Net Cash Flow / Lab / Clinician) — type a value and the
            dashed line moves; carries forward from this week. */}
        {isThrRow && (
          <div className="mt-2 flex items-center gap-2 rounded-md border border-border bg-muted/30 px-2 py-1.5">
            <span className="text-[11px] font-medium text-foreground">{thrKind === 'min' ? 'Minimum' : 'Maximum'} threshold</span>
            <div className="ml-auto flex items-center gap-1">
              <span className="text-[12px] text-muted-foreground">£</span>
              <input
                type="text"
                inputMode="decimal"
                defaultValue={curThr != null ? String(Math.round(curThr)) : ''}
                placeholder={thrKind === 'min' ? 'e.g. 5,000' : 'e.g. 7,000'}
                className="w-24 rounded border border-border bg-background px-2 py-1 text-right text-[12px] tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/40"
                onKeyDown={(e) => { if (e.key === 'Enter') { commitThr((e.target as HTMLInputElement).value); (e.target as HTMLInputElement).blur(); } }}
                onBlur={(e) => commitThr(e.target.value)}
              />
              {curThr != null && (
                <button type="button" className="text-[11px] text-muted-foreground hover:text-destructive" onClick={() => commitThr('')}>Clear</button>
              )}
            </div>
          </div>
        )}
        <p className="mt-1 text-[10px] text-muted-foreground">
          {hasActual
            ? `Blue = forecast (next 13 wks) · grey dashed = actual (prev 13 wks) · amber dotted = variance (forecast − actual)${rowHasThr ? ` · red dashed = ${thrKind} threshold` : ''}, aligned by week position.`
            : `Blue = forecast (next 13 wks)${rowHasThr ? ` · red dashed = ${thrKind} threshold` : ''}.`}
        </p>
      </div>
    );
  };

  // Read-only PMS / Accounting source badge shown on the Private inflow row.
  // The source is decided centrally now (Settings → Setup Categories → Revenue
  // Settings) and cascades into practice_locations.private_income_source — this
  // just reflects that, it's no longer editable from here. Shared across the
  // Forecast, Actual and Combined tabs so the badge is available wherever the
  // Private row appears.
  const privateSourceToggle = (): ReactNode => (
    <>
      <span
        className="ml-1 inline-flex shrink-0 items-center overflow-hidden rounded border border-border text-[9px] font-semibold uppercase leading-none"
        title={
          privateSource === 'accounting'
            ? 'Source: connected accounting software (Xero/QB) — set in Revenue Settings'
            : 'Source: PMS (Dentally takings) — set in Revenue Settings'
        }
      >
        <span className="px-1 py-0.5 bg-primary text-primary-foreground">
          {privateSource === 'accounting' ? 'Acct' : 'PMS'}
        </span>
      </span>
      {/* Accounting selected but the connected ledger has no income for the mapped
          Private accounts in this window → say so, instead of a silently blank row. */}
      {privateAccountingEmpty && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="ml-1 inline-flex shrink-0 items-center gap-0.5 rounded bg-amber-100 px-1 py-0.5 text-[9px] font-semibold uppercase leading-none text-amber-700">
              <Info className="h-2.5 w-2.5" /> No data
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="start" collisionPadding={12} className="max-w-[280px] text-xs leading-relaxed z-50">
            Private is set to your connected accounting software, but no Private income accounts are mapped for this location (or no income was found for them in this period) — so this row shows £0, not your PMS takings. Map the right accounts in Location Settings → Income Type Mapping → Private (Accounting App), or switch back to PMS.
          </TooltipContent>
        </Tooltip>
      )}
    </>
  );

  const renderRow = (row: ForecastRow, opts?: { indent?: boolean; lastChild?: boolean; removable?: boolean; editableLabel?: boolean; tooltip?: string; valueFor?: (i: number) => number; labelExtra?: ReactNode; thresholdable?: boolean }) => {
    // Income include-toggles (Forecast Settings → Income logic): hide a stream's row(s)
    // when its toggle is off. Totals exclude them too (see inflowRowList below).
    const inc = forecastSettings.module.income;
    if (row.key === 'nhs' && !inc.includeNHS) return null;
    if (row.key === 'private' && !inc.includePrivate) return null;
    if (row.key.startsWith('membership:') && !inc.includeDenplan) return null;
    // Per-row threshold (carried forward) — only when the row opts in. Cost rows use
    // a MAX (alert over), so a breaching week's cell turns red and a badge shows the cap.
    const thrKind = thresholdKindFor(row);
    const thrSeries = opts?.thresholdable ? thrSeriesFor(thresholdKeyFor(row)) : null;
    const thrVal = thrSeries?.find((t) => t != null) ?? null;
    return (
    <tr key={row.key} className="group border-b border-border/60 hover:bg-muted/30">
      <td
        className="sticky left-0 z-10 bg-background hover:bg-muted/30 border-r border-border px-3 py-1.5 text-[13px] text-foreground"
        style={{ minWidth: 220, width: 220 }}
      >
        {opts?.indent && <TreeBranch last={opts.lastChild} />}
        <div className={`flex items-center gap-1.5 ${opts?.indent ? 'pl-5' : ''}`}>
          {opts?.editableLabel ? (
            <input
              defaultValue={row.label}
              className="flex-1 bg-transparent text-[13px] italic focus:outline-none focus:ring-1 focus:ring-primary/40 rounded px-1"
              onBlur={(e) => {
                const label = e.target.value.trim();
                if (label && label !== row.label) renameCustomRow.mutate({ lineKey: row.key, label, section: row.section });
              }}
            />
          ) : (
            <span className={opts?.indent ? 'italic' : 'font-medium'}>{row.label}</span>
          )}
          {opts?.thresholdable && thrVal != null && (
            <span
              className="shrink-0 rounded bg-destructive/10 px-1 text-[10px] font-medium text-destructive"
              title={thrKind === 'max' ? 'Maximum allowed per week' : 'Minimum allowed per week'}
            >
              {thrKind === 'max' ? 'max' : 'min'} {gbp(thrVal)}
            </span>
          )}
          {opts?.tooltip && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" aria-label="How this is calculated" className="text-muted-foreground/60 hover:text-foreground shrink-0">
                  <Info className="h-3 w-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="start" collisionPadding={12} className="max-w-[280px] text-xs leading-relaxed z-50">{opts.tooltip}</TooltipContent>
            </Tooltip>
          )}
          {opts?.labelExtra}
          {opts?.removable && (
            <button
              type="button"
              aria-label="Remove row"
              className="text-muted-foreground hover:text-destructive shrink-0"
              onClick={() => removeCustomRow.mutate({ lineKey: row.key, section: row.section })}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
          {/* Per-line graph: forecast vs trailing-actual line chart in a popover. */}
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={`Graph ${row.label}`}
                className="ml-auto shrink-0 rounded text-muted-foreground opacity-0 transition-opacity hover:text-primary focus:opacity-100 group-hover:opacity-100"
              >
                <LineChartIcon className="h-3.5 w-3.5" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" side="right" className="w-[380px]">
              <RowMiniChart row={row} />
            </PopoverContent>
          </Popover>
          {/* Set a per-week cost cap (carried forward). Breaching weeks turn red. */}
          {opts?.thresholdable && (
            <button
              type="button"
              aria-label={`Set ${row.label} threshold`}
              className={`shrink-0 rounded transition-opacity hover:text-primary focus:opacity-100 group-hover:opacity-100 ${thrVal != null ? 'text-destructive opacity-100' : 'text-muted-foreground opacity-0'}`}
              onClick={() => openEditor(row, 0, 'threshold')}
            >
              <Gauge className="h-3.5 w-3.5" />
            </button>
          )}
          {/* Open the edit drawer (Auto / Repeating / One-off / …) for this row. */}
          <button
            type="button"
            aria-label={`Edit ${row.label}`}
            className="shrink-0 rounded text-muted-foreground opacity-0 transition-opacity hover:text-primary focus:opacity-100 group-hover:opacity-100"
            onClick={() => openEditor(row, 0)}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </td>
      {weeks.map((w, i) => {
        const cellVal = opts?.valueFor ? opts.valueFor(i) : dispVal(row, i);
        const t = thrSeries?.[i] ?? null;
        const breach = t != null && (thrKind === 'max' ? cellVal > t : cellVal < t);
        return (
        <td key={w.iso} className="border-r border-border/40 p-0" style={{ minWidth: 92 }}>
          <ValueCell
            value={cellVal}
            overridden={row.overridden[i] ?? false}
            help={explainCell(row, i)}
            onClick={() => openComment(row, i)}
            hasComment={comments.has(commentKey(row.key, i))}
            breach={breach}
          />
        </td>
        );
      })}
    </tr>
    );
  };

  // A full-width colored section bar. Colour comes from the block theme: inflow =
  // the block's light shade, outflow = its dark shade. Pass `collapseId` to make
  // the whole bar a collapse toggle for that group.
  const renderSectionBar = (label: string, tone: 'inflow' | 'outflow', anchorId?: string, collapseId?: string, blockKey: BlockKey = 'operating') => {
    const { bg, text, rail } = barClasses(tone, blockKey);
    return (
    <tr id={anchorId} className={anchorId ? 'scroll-mt-24' : undefined}>
      <td
        className={`sticky left-0 z-10 border-l-[3px] ${rail} px-3 py-2 text-[11px] font-semibold uppercase tracking-wide ${bg} ${text} ${collapseId ? 'cursor-pointer select-none' : ''}`}
        style={{ minWidth: 220, width: 220 }}
        onClick={collapseId ? () => toggleCollapse(collapseId) : undefined}
      >
        <span className="inline-flex items-center gap-1.5">
          {collapseId && <CollapseChevron id={collapseId} />}
          {label}
        </span>
      </td>
      <td
        colSpan={weeks.length}
        className={`${bg} ${collapseId ? 'cursor-pointer' : ''}`}
        onClick={collapseId ? () => toggleCollapse(collapseId) : undefined}
      />
    </tr>
    );
  };

  // A weekly-total row, tinted with the block's stronger wash + colored left rail
  // so each block's totals read as part of that block (without a saturated band).
  const renderTotalRow = (label: string, totals: number[], _tone: 'inflow' | 'outflow', blockKey: BlockKey = 'operating') => {
    const c = BLOCK_COLORS[blockKey];
    return (
    <tr className={`${c.totalBg} ${c.totalText} font-semibold`}>
      <td
        className={`sticky left-0 z-10 border-l-[3px] ${c.rail} px-3 py-2 text-[11px] uppercase tracking-wide ${c.totalBg}`}
        style={{ minWidth: 220 }}
      >
        {label}
      </td>
      {totals.map((t, i) => (
        <td
          key={weeks[i].iso}
          className="border-r border-black/5 px-2 py-2 text-right tabular-nums text-[13px]"
          style={{ minWidth: 92 }}
        >
          {gbpPence(t)}
        </td>
      ))}
    </tr>
    );
  };

  // A net-subtotal row; values colored by sign. Faint block wash + colored left
  // rail so it reads as the close of that block; defaults to neutral muted.
  const renderNetRow = (label: string, values: number[], blockKey?: BlockKey) => {
    const bg = blockKey ? BLOCK_COLORS[blockKey].netBg : 'bg-muted/60';
    const rail = blockKey ? BLOCK_COLORS[blockKey].rail : 'border-l-border';
    return (
    <tr className={`${bg} font-semibold border-y border-border/70`}>
      <td className={`sticky left-0 z-10 border-l-[3px] ${rail} ${bg} px-3 py-1.5 text-[11px] italic uppercase tracking-wide text-foreground`} style={{ minWidth: 220 }}>
        {label}
      </td>
      {values.map((t, i) => (
        <td
          key={weeks[i].iso}
          className={`border-r border-border/30 px-2 py-1.5 text-right tabular-nums text-[13px] ${t < 0 ? 'text-destructive' : 'text-foreground'}`}
          style={{ minWidth: 92 }}
        >
          {gbpPence(t)}
        </td>
      ))}
    </tr>
    );
  };

  // "+ Add row" affordance for a section (creates an editable, renamable row).
  const renderAddRow = (section: ForecastSection, label: string) => (
    <tr className="border-b border-border/60">
      <td className="sticky left-0 z-10 bg-background border-r border-border px-3 py-1" style={{ minWidth: 220 }}>
        <button
          type="button"
          onClick={() => addCustomRow.mutate({ label: '', section })}
          className="inline-flex items-center gap-1 pl-4 text-[12px] text-primary hover:underline"
        >
          <Plus className="h-3 w-3" /> {label}
        </button>
      </td>
      {weeks.map((w) => (
        <td key={w.iso} className="border-r border-border/40" style={{ minWidth: 92 }} />
      ))}
    </tr>
  );

  // The label inside the parentheses of a block title (e.g. "Investing").
  const blockSuffix = (title: string) => title.replace(/.*\(/, '').replace(/\).*/, '');

  // One manual lower block: inflow subsection + total, outflow subsection + total,
  // then the block net. Rows are editable; custom rows are removable/renamable.
  const renderManualBlock = (block: (typeof manualBlocks)[number]) => {
    const inId = `blk-${block.id}-in`;
    const outId = `blk-${block.id}-out`;
    const bk = blockKeyFor(block.id);
    return (
    <Fragment key={block.id}>
      {/* Block separator so the five blocks read as distinct units. */}
      <tr aria-hidden><td colSpan={weeks.length + 1} className="h-3 bg-background" /></tr>
      {renderSectionBar(block.inflow.title, 'inflow', `cf-${block.id}`, inId, bk)}
      {!isCollapsed(inId) && block.inflow.rows.map((r, idx) => renderRow(r, { indent: true, removable: r.kind === 'custom', editableLabel: r.kind === 'custom', lastChild: idx === block.inflow.rows.length - 1 }))}
      {!isCollapsed(inId) && renderAddRow(block.inflow.section, 'Add inflow row')}
      {renderTotalRow(`Weekly Cash Inflow (${blockSuffix(block.inflow.title)})`, block.inflow.totals, 'inflow', bk)}

      {renderSectionBar(block.outflow.title, 'outflow', undefined, outId, bk)}
      {!isCollapsed(outId) && block.outflow.rows.map((r, idx) => renderRow(r, { indent: true, removable: r.kind === 'custom', editableLabel: r.kind === 'custom', lastChild: idx === block.outflow.rows.length - 1 }))}
      {!isCollapsed(outId) && renderAddRow(block.outflow.section, 'Add outflow row')}
      {renderTotalRow(`Weekly Cash Outflow (${blockSuffix(block.outflow.title)})`, block.outflow.totals, 'outflow', bk)}

      {renderNetRow(block.netLabel, block.net, bk)}
    </Fragment>
    );
  };

  // Hover help for the read-only "Previous 13 weeks" actuals — mirrors the
  // forecast tooltips (same two-part style) so the two views align: each cell
  // shows the actual figure and how the forecast carries it forward.
  const prevExplain = (row: { key: string; label: string; values: number[] }, i: number): CellHelp | undefined => {
    const val = row.values[i] ?? 0;
    if (Math.round(val) === 0) return undefined;
    const wk = previous?.weeks?.[i]?.label ?? '';
    if (row.key === 'nhs') {
      return {
        description: `Your actual NHS receipt for the week of ${wk}. The forecast repeats this monthly amount forward.`,
        calculation: `Actual = ${gbp(val)}.`,
      };
    }
    if (row.key.startsWith('membership:')) {
      return {
        description: `${row.label}'s actual ${membershipProvider} income for the week of ${wk}. The forecast projects this forward by members joining and leaving.`,
        calculation: `Actual = ${gbp(val)}.`,
      };
    }
    if (row.key === 'private') {
      const pat = Math.round(privatePatients?.[i] ?? 0);
      const basis = pat > 0 ? ` (${pat} ${pat === 1 ? 'patient' : 'patients'} × £${(val / pat).toFixed(2)})` : '';
      return {
        description: `Your actual private treatment income for the week of ${wk}. The forecast trends this forward by your patient-volume momentum.`,
        calculation: `Actual = ${gbp(val)}${basis}.`,
      };
    }
    // Cost / expense / CoA actuals.
    return {
      description: `Your actual ${row.label} spend for the week of ${wk}. The forecast carries this forward as part of your 13-week run-rate.`,
      calculation: `Actual = ${gbp(val)}.`,
    };
  };

  // ── Read-only "Previous 13 weeks" table (actuals the forecast is built from) ──
  const renderPreviousTable = () => {
    const pw = previous?.weeks ?? [];
    const bar = (label: string, tone: 'inflow' | 'outflow', collapseId?: string, blockKey: BlockKey = 'operating') => {
      const { bg, text, rail } = barClasses(tone, blockKey);
      return (
      <tr>
        <td
          className={`sticky left-0 z-10 border-l-[3px] ${rail} px-3 py-2 text-[11px] font-semibold uppercase tracking-wide ${bg} ${text} ${collapseId ? 'cursor-pointer select-none' : ''}`}
          style={{ minWidth: 220, width: 220 }}
          onClick={collapseId ? () => toggleCollapse(collapseId) : undefined}
        >
          <span className="inline-flex items-center gap-1.5">
            {collapseId && <CollapseChevron id={collapseId} />}
            {label}
          </span>
        </td>
        <td colSpan={pw.length} className={`${bg} ${collapseId ? 'cursor-pointer' : ''}`} onClick={collapseId ? () => toggleCollapse(collapseId) : undefined} />
      </tr>
      );
    };
    const separator = () => <tr aria-hidden><td colSpan={pw.length + 1} className="h-3 bg-background" /></tr>;
    const dataRow = (r: { key: string; label: string; values: number[] }, indent: boolean, last?: boolean) => (
      <tr key={r.key} className="border-b border-border/60 hover:bg-muted/30">
        <td className="sticky left-0 z-10 bg-background hover:bg-muted/30 border-r border-border px-3 py-1.5 text-[13px] text-foreground" style={{ minWidth: 220, width: 220 }}>
          {indent && <TreeBranch last={last} />}
          <span className={indent ? 'pl-5 italic inline-block' : 'font-medium'}>{r.label}</span>
          {r.key === 'private' && privateSourceToggle()}
        </td>
        {pw.map((w, i) => {
          const help = prevExplain(r, i);
          const text = gbpPence(r.values[i] ?? 0, true) || '–';
          return (
            <td key={w.iso} className="border-r border-border/40 px-2 py-1.5 text-right tabular-nums text-[13px] text-foreground" style={{ minWidth: 92 }}>
              {help ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-block w-full cursor-default">{text}</span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" align="end" collisionPadding={12} className="w-[280px] p-3 shadow-lg border bg-popover z-50">
                    <p className="text-[11px] font-medium text-popover-foreground mb-1.5 whitespace-normal break-words">{help.description}</p>
                    <p className="text-[10px] text-primary/90 font-mono leading-relaxed whitespace-pre-line break-words">{help.calculation}</p>
                  </TooltipContent>
                </Tooltip>
              ) : text}
            </td>
          );
        })}
      </tr>
    );
    const totalRow = (label: string, totals: number[], _tone: 'inflow' | 'outflow', blockKey: BlockKey = 'operating') => {
      const c = BLOCK_COLORS[blockKey];
      return (
      <tr className={`${c.totalBg} ${c.totalText} font-semibold`}>
        <td className={`sticky left-0 z-10 border-l-[3px] ${c.rail} px-3 py-2 text-[11px] uppercase tracking-wide ${c.totalBg}`} style={{ minWidth: 220 }}>{label}</td>
        {totals.map((t, i) => (
          <td key={pw[i].iso} className="border-r border-black/5 px-2 py-2 text-right tabular-nums text-[13px]" style={{ minWidth: 92 }}>{gbpPence(t)}</td>
        ))}
      </tr>
      );
    };
    // Net-subtotal row (Contribution / Operating net / per-block net), keyed on the
    // trailing weeks — mirrors the forecast's renderNetRow, tinted per block.
    const netRow = (label: string, values: number[], blockKey?: BlockKey) => {
      const bg = blockKey ? BLOCK_COLORS[blockKey].netBg : 'bg-muted/60';
      const rail = blockKey ? BLOCK_COLORS[blockKey].rail : 'border-l-border';
      return (
      <tr className={`${bg} font-semibold border-y border-border/70`}>
        <td className={`sticky left-0 z-10 border-l-[3px] ${rail} ${bg} px-3 py-1.5 text-[11px] italic uppercase tracking-wide text-foreground`} style={{ minWidth: 220 }}>{label}</td>
        {values.map((t, i) => (
          <td key={pw[i].iso} className={`border-r border-border/30 px-2 py-1.5 text-right tabular-nums text-[13px] ${t < 0 ? 'text-destructive' : 'text-foreground'}`} style={{ minWidth: 92 }}>{gbpPence(t)}</td>
        ))}
      </tr>
      );
    };
    // A plain (non-colored) group header row, e.g. the Membership parent.
    const groupHeader = (label: string) => (
      <tr className="border-b border-border/60">
        <td className="sticky left-0 z-10 bg-background border-r border-border px-3 py-1.5 text-[13px] font-medium text-foreground" style={{ minWidth: 220 }}>{label}</td>
        {pw.map((w) => <td key={w.iso} className="border-r border-border/40" style={{ minWidth: 92 }} />)}
      </tr>
    );
    // Cash Inflow rows with a "Membership (DenPlan)" group header injected before
    // the first clinician row, mirroring the forecast layout.
    const inflowRowEls = (() => {
      const rows = previous?.inflow ?? [];
      // Index of the last membership clinician → gets the "└" tree corner.
      let lastMemberIdx = -1;
      rows.forEach((r, i) => { if (r.key.startsWith('membership:')) lastMemberIdx = i; });
      const els: JSX.Element[] = [];
      let memberHeaderShown = false;
      rows.forEach((r, i) => {
        const isMembership = r.key.startsWith('membership:');
        if (isMembership && !memberHeaderShown) {
          memberHeaderShown = true;
          els.push(groupHeader(`Membership (${membershipProvider})`));
        }
        els.push(dataRow(r, isMembership, isMembership && i === lastMemberIdx));
      });
      return els;
    })();
    return (
      <TooltipProvider delayDuration={150}>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr className="bg-muted/60">
                  <th className="sticky left-0 z-20 bg-muted/60 border-r border-border px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground" style={{ minWidth: 220, width: 220 }}>Week commencing</th>
                  {pw.map((w) => (
                    <th key={w.iso} className="border-r border-border/40 px-2 py-2 text-center text-[12px] font-semibold text-foreground" style={{ minWidth: 92 }}>{w.label}</th>
                  ))}
                </tr>
                <tr className="bg-muted/40">
                  <th className="sticky left-0 z-20 bg-muted/40 border-r border-border px-3 py-1 text-left text-[11px] font-medium text-muted-foreground" style={{ minWidth: 220 }}>Week #</th>
                  {pw.map((w) => (
                    <th key={w.iso} className="border-r border-border/40 px-2 py-1 text-center text-[11px] font-medium text-muted-foreground tabular-nums" style={{ minWidth: 92 }}>{w.weekNumber}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {/* CASH INFLOW */}
                {bar('Cash Inflow', 'inflow', 'inflow', 'operating')}
                {!isCollapsed('inflow') && inflowRowEls}
                {totalRow('Weekly Cash Inflow', previous?.inflowTotals ?? [], 'inflow', 'operating')}

                {/* CASH OUTFLOW (Direct Costs) → Contribution */}
                {bar('Cash Outflow (Direct Costs)', 'outflow', 'direct', 'operating')}
                {!isCollapsed('direct') && (previous?.direct ?? []).map((r, idx, arr) => dataRow(r, true, idx === arr.length - 1))}
                {totalRow('Weekly Cash Direct Costs Outflow', previous?.directTotals ?? [], 'outflow', 'operating')}
                {netRow('Weekly Net Cash Flow Contribution', previous?.contribution ?? [], 'operating')}

                {/* CASH OUTFLOW (Expenses) → Operating net */}
                {bar('Cash Outflow (Expenses)', 'outflow', 'expense', 'operating')}
                {!isCollapsed('expense') && (previous?.expense ?? []).map((r, idx, arr) => dataRow(r, true, idx === arr.length - 1))}
                {totalRow('Weekly Cash Outflow (Expenses)', previous?.expenseTotals ?? [], 'outflow', 'operating')}
                {netRow('Weekly Net Cash Flow (Operating)', previous?.operatingNet ?? [], 'operating')}

                {/* Lower blocks: Investing / Financing / Tax & Grant / Inter Company.
                    Manual-only rows have no historical actuals, so only data-driven
                    (Category Range) rows appear; headers/totals/net always show. */}
                {(previous?.blocks ?? []).map((blk) => {
                  const inId = `blk-${blk.id}-in`;
                  const outId = `blk-${blk.id}-out`;
                  const bk = blockKeyFor(blk.id);
                  return (
                  <Fragment key={blk.id}>
                    {separator()}
                    {bar(blk.inflow.title, 'inflow', inId, bk)}
                    {!isCollapsed(inId) && blk.inflow.rows.map((r, idx, arr) => dataRow(r, true, idx === arr.length - 1))}
                    {totalRow(`Weekly Cash Inflow (${blockSuffix(blk.inflow.title)})`, blk.inflow.totals, 'inflow', bk)}
                    {bar(blk.outflow.title, 'outflow', outId, bk)}
                    {!isCollapsed(outId) && blk.outflow.rows.map((r, idx, arr) => dataRow(r, true, idx === arr.length - 1))}
                    {totalRow(`Weekly Cash Outflow (${blockSuffix(blk.outflow.title)})`, blk.outflow.totals, 'outflow', bk)}
                    {netRow(blk.netLabel, blk.net, bk)}
                  </Fragment>
                  );
                })}

                {/* Running cash balance. The past has no saved opening balance, so
                    End Cash rolls from £0 — i.e. the cumulative net cash generated. */}
                <tr className="border-y border-border bg-muted/50 font-semibold">
                  <td className="sticky left-0 z-10 bg-muted/50 border-r border-border px-3 py-1.5 text-[12px] uppercase tracking-wide text-foreground" style={{ minWidth: 220 }}>Start Cash (incl. all bank accounts)</td>
                  {pw.map((w, i) => (
                    <td key={w.iso} className="border-r border-border/40 px-2 py-1.5 text-right tabular-nums text-[13px] text-muted-foreground" style={{ minWidth: 92 }}>{i === 0 ? gbpPence(0) : ''}</td>
                  ))}
                </tr>
                <tr className="font-bold border-y border-border">
                  <td className="sticky left-0 z-10 bg-background border-r border-border px-3 py-2 text-[12px] uppercase tracking-wide text-foreground" style={{ minWidth: 220 }}>End Cash</td>
                  {(previous?.endCash ?? []).map((t, i) => (
                    <td key={pw[i].iso} className={`border-r border-border/40 px-2 py-2 text-right tabular-nums text-[13px] ${t < 0 ? 'bg-destructive/10 text-destructive' : 'bg-muted/40 text-foreground'}`} style={{ minWidth: 92 }}>{gbpPence(t)}</td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
      </TooltipProvider>
    );
  };

  // ── Variance view — forecast (next 13 wks) vs actual (prev 13 wks), £ + % ──
  // Compares each forecast line £-for-£ with its trailing actual (matched by row
  // key), per section, with subtotals + net. Variance is coloured by CASH impact:
  // more inflow / less outflow = favourable (green); the reverse = red. Actuals
  // come from the same trailing-13-week data the forecast is built on, so as Xero
  // (and Dentally/Denplan) actuals refresh, these numbers move with them.
  // ── Combined view — WEEK BY WEEK: every cell stacks Forecast / Actual /
  // Variance for that week. Forecast = projected (AI-aware dispVal); Actual = the
  // trailing-actual for the same week position; Variance = forecast − actual,
  // coloured by cash impact (inflow up / outflow down = green favourable). ──
  const renderCombinedTable = () => {
    // Week timing vs today:
    //  • started  = weekStart ≤ today → show the Actual (partial "so far" for the
    //    current in-progress week; nothing for upcoming weeks you can't have yet).
    //  • ended    = the Monday AFTER it is ≤ today → only then show the Variance,
    //    since comparing a full-week forecast to a part-week actual is misleading.
    const todayMid = (() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); })();
    const weekStarted = weeks.map((w) => w.weekStart <= todayMid);
    const weekPast = weeks.map((w) => new Date(w.weekStart.getTime() + 7 * 86400000) <= todayMid);
    // Wrap a cell's figure in the same two-part hover help used by the Forecast /
    // Actual tabs (plain sentence + pence-precise calculation). No help → bare node.
    const withHelp = (node: JSX.Element, help?: CellHelp) =>
      help ? (
        <Tooltip>
          <TooltipTrigger asChild>{node}</TooltipTrigger>
          <TooltipContent side="bottom" align="end" collisionPadding={12} className="w-[280px] p-3 shadow-lg border bg-popover z-50">
            <p className="text-[11px] font-medium text-popover-foreground mb-1.5 whitespace-normal break-words">{help.description}</p>
            <p className="text-[10px] text-primary/90 font-mono leading-relaxed whitespace-pre-line break-words">{help.calculation}</p>
          </TooltipContent>
        </Tooltip>
      ) : node;
    // One week = three side-by-side sub-columns: Actual | Forecast | Variance (£ over %).
    // `row` (when given) drives the rich per-line Forecast explanation; total / net
    // rows pass none and fall back to a generic "this is the figure" note.
    const cell = (k: string, i: number, fc: number, ac: number, isOutflow: boolean, net = false, strong = false, row?: ForecastRow) => {
      const started = weekStarted[i];
      const ended = weekPast[i];
      // Variance = Actual − Forecast (did the real result beat the plan?). +ve means
      // actual came in above forecast; varianceColorClass then colours by cash impact
      // (inflow above / outflow below forecast = favourable green). % is vs forecast.
      const variance = ac - fc;
      const vColor = varianceColorClass(variance, { isOutflow, net });
      const pct = fc !== 0 ? (variance / Math.abs(fc)) * 100 : null;
      // Actual + Variance show once the week has started. The current in-progress
      // week's variance is a RUNNING figure (part-week actual vs full-week forecast),
      // rendered italic so it reads as provisional until the week closes.
      const running = started && !ended;
      const showVar = started && Math.abs(variance) >= 1;
      const tdCls = `px-2 py-1 text-right tabular-nums whitespace-nowrap align-top text-[13px] leading-tight ${strong ? 'font-semibold' : ''}`;
      // ── Hover help (business language only — never DB terms) ──
      const label = row?.label ?? k;
      const week = weeks[i].label;
      const actualHelp: CellHelp | undefined = (started && Math.abs(ac) >= 1) ? {
        description: `Your actual ${label} for the week of ${week}${running ? ' so far — the week is still in progress, so this can still grow' : ''}.`,
        calculation: `Actual = ${gbpPence(ac)}.`,
      } : undefined;
      // Rich per-line forecast help for data rows; a plain confirm for total/net rows.
      const forecastHelp: CellHelp | undefined = row
        ? explainCell(row, i)
        : (Math.abs(fc) >= 1 ? { description: `Forecast ${label} for the week of ${week}.`, calculation: `Forecast = ${gbpPence(fc)}.` } : undefined);
      // Favourable mirrors varianceColorClass: income up / cost down / net up = good.
      const favourable = Math.abs(variance) < 1 ? null : (net ? variance > 0 : isOutflow ? variance < 0 : variance > 0);
      const varianceHelp: CellHelp | undefined = showVar ? {
        description: `${label} ${favourable == null ? 'came in right on plan' : favourable ? 'is tracking better for cash than planned' : 'is tracking worse for cash than planned'} in the week of ${week}.${running ? ' This is a running figure — it stays provisional until the week closes.' : ''}`,
        calculation: `Actual ${gbpPence(ac)} − Forecast ${gbpPence(fc)} = ${gbpPence(variance)}${pct != null ? ` (${formatPercentDisplay(pct, 0)} vs forecast)` : ''}.`,
      } : undefined;
      return (
        <Fragment key={`${k}-${i}`}>
          <td className={`${tdCls} border-r border-border/20 text-muted-foreground`} style={{ minWidth: 64 }}>
            {started ? withHelp(<span className="inline-block w-full cursor-default">{gbpPence(ac, true) || '·'}</span>, actualHelp) : '·'}
          </td>
          <td className={`${tdCls} border-r border-border/20 text-foreground`} style={{ minWidth: 64 }}>
            {withHelp(<span className="inline-block w-full cursor-default">{gbpPence(fc, true) || '·'}</span>, forecastHelp)}
          </td>
          <td className={`${tdCls} border-r border-border/40 ${running ? 'italic' : ''}`} style={{ minWidth: 64 }}>
            {withHelp(
              <div className="cursor-default">
                <div className={vColor}>{showVar ? gbpPence(variance, true) : ''}</div>
                <div className={`text-[11px] ${vColor}`}>{showVar && pct != null ? formatPercentDisplay(pct, 0) : ''}</div>
              </div>,
              varianceHelp,
            )}
          </td>
        </Fragment>
      );
    };
    // First-column (label) cells mirror the Forecast/Actual tabs exactly: a 220-wide
    // sticky column, coloured section bars with a left rail, tree-branch indented
    // child rows, a Membership group header, and rail-tinted total / net rows.
    const sectionBar = (label: string, tone: 'inflow' | 'outflow', collapseId?: string, blockKey: BlockKey = 'operating') => {
      const { bg, text, rail } = barClasses(tone, blockKey);
      return (
        <tr>
          <td
            className={`sticky left-0 z-10 border-l-[3px] ${rail} px-3 py-2 text-[11px] font-semibold uppercase tracking-wide ${bg} ${text} ${collapseId ? 'cursor-pointer select-none' : ''}`}
            style={{ minWidth: 220, width: 220 }}
            onClick={collapseId ? () => toggleCollapse(collapseId) : undefined}
          >
            <span className="inline-flex items-center gap-1.5">
              {collapseId && <CollapseChevron id={collapseId} />}
              {label}
            </span>
          </td>
          <td colSpan={weeks.length * 3} className={`${bg} ${collapseId ? 'cursor-pointer' : ''}`} onClick={collapseId ? () => toggleCollapse(collapseId) : undefined} />
        </tr>
      );
    };
    const groupHeader = (label: string, collapseId?: string) => (
      <tr className="border-b border-border/60">
        <td className="sticky left-0 z-10 bg-background border-r border-border px-3 py-1.5 text-[13px] font-medium text-foreground" style={{ minWidth: 220, width: 220 }}>
          <span className="inline-flex items-center gap-1.5">
            {collapseId && (
              <button type="button" aria-label={`Collapse ${label}`} className="text-foreground/70 hover:text-foreground" onClick={() => toggleCollapse(collapseId)}>
                <CollapseChevron id={collapseId} />
              </button>
            )}
            {label}
          </span>
        </td>
        <td colSpan={weeks.length * 3} className="bg-background" />
      </tr>
    );
    const dataRow = (r: ForecastRow, isOutflow: boolean, indent: boolean, last?: boolean) => {
      const actual = currentSeriesFor(r.key);
      return (
        <tr key={r.key} className="border-b border-border/60 hover:bg-muted/30">
          <td className="sticky left-0 z-10 bg-background hover:bg-muted/30 border-r border-border px-3 py-1.5 text-[13px] text-foreground" style={{ minWidth: 220, width: 220 }}>
            {indent && <TreeBranch last={last} />}
            <span className={indent ? 'pl-5 italic inline-block' : 'font-medium'}>{r.label}</span>
            {r.key === 'private' && privateSourceToggle()}
          </td>
          {weeks.map((_w, i) => cell(r.key, i, (r.key === 'private' ? privateEffective(i) : dispVal(r, i)), (actual[i] ?? 0), isOutflow, false, false, r))}
        </tr>
      );
    };
    // Cash Inflow rows with the "Membership (DenPlan)" group header injected before
    // the first clinician row — mirrors the Forecast/Actual layout.
    const inflowRowEls = (() => {
      let lastMemberIdx = -1;
      inflowRowList.forEach((r, i) => { if (r.key.startsWith('membership:')) lastMemberIdx = i; });
      const els: JSX.Element[] = [];
      let memberHeaderShown = false;
      inflowRowList.forEach((r, i) => {
        const isMembership = r.key.startsWith('membership:');
        if (isMembership && !memberHeaderShown) {
          memberHeaderShown = true;
          els.push(groupHeader(`Membership (${membershipProvider})`, 'membership'));
        }
        // Membership clinician rows hide when the Membership group is collapsed.
        if (isMembership && isCollapsed('membership')) return;
        els.push(dataRow(r, false, isMembership, isMembership && i === lastMemberIdx));
      });
      return els;
    })();
    const totalRow = (label: string, fcTotals: number[], acTotals: number[], isOutflow: boolean, blockKey: BlockKey = 'operating') => {
      const c = BLOCK_COLORS[blockKey];
      return (
        <tr key={label} className={`${c.totalBg} ${c.totalText} font-semibold`}>
          <td className={`sticky left-0 z-10 border-l-[3px] ${c.rail} px-3 py-2 text-[11px] uppercase tracking-wide ${c.totalBg}`} style={{ minWidth: 220 }}>{label}</td>
          {weeks.map((_w, i) => cell(label, i, (fcTotals[i] ?? 0), ((acTotals ?? [])[i] ?? 0), isOutflow, false, true))}
        </tr>
      );
    };
    const netRow = (label: string, fcTotals: number[], acTotals: number[], blockKey?: BlockKey) => {
      const bg = blockKey ? BLOCK_COLORS[blockKey].netBg : 'bg-muted/60';
      const rail = blockKey ? BLOCK_COLORS[blockKey].rail : 'border-l-border';
      return (
        <tr key={label} className={`${bg} font-semibold border-y border-border/70`}>
          <td className={`sticky left-0 z-10 border-l-[3px] ${rail} ${bg} px-3 py-1.5 text-[11px] italic uppercase tracking-wide text-foreground`} style={{ minWidth: 220 }}>{label}</td>
          {weeks.map((_w, i) => cell(label, i, (fcTotals[i] ?? 0), ((acTotals ?? [])[i] ?? 0), false, true, true))}
        </tr>
      );
    };
    return (
      <TooltipProvider delayDuration={150}>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border/40 bg-background">
                  <th rowSpan={2} className="sticky left-0 z-10 bg-background border-r border-border px-3 py-2 text-left text-[11px] uppercase tracking-wide text-muted-foreground align-middle" style={{ minWidth: 220, width: 220 }}>Line</th>
                  {weeks.map((w, i) => (
                    <th key={w.iso} colSpan={3} className="border-l border-r border-border/40 px-2 py-1 text-center text-[11px] font-semibold text-muted-foreground">
                      {w.label}
                      {/* ended → "past"; current in-progress week → "in progress"
                          (Actual shows the total so far); future → "upcoming". */}
                      <div className="text-[10px] font-medium normal-case text-muted-foreground">
                        {weekPast[i] ? 'past' : weekStarted[i] ? 'in progress' : 'upcoming'}
                      </div>
                    </th>
                  ))}
                </tr>
                <tr className="border-b border-border bg-background">
                  {weeks.map((w) => (
                    <Fragment key={`${w.iso}-sub`}>
                      <th className="border-r border-border/20 px-2 py-1 text-right text-[10px] font-medium uppercase tracking-wide text-muted-foreground" style={{ minWidth: 64 }}>Actual</th>
                      <th className="border-r border-border/20 px-2 py-1 text-right text-[10px] font-medium uppercase tracking-wide text-muted-foreground" style={{ minWidth: 64 }}>Forecast</th>
                      <th className="border-r border-border/40 px-2 py-1 text-right text-[10px] font-medium uppercase tracking-wide text-muted-foreground" style={{ minWidth: 64 }}>Var £/%</th>
                    </Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sectionBar('Cash Inflow', 'inflow', 'inflow', 'operating')}
                {!isCollapsed('inflow') && inflowRowEls}
                {totalRow('Weekly Cash Inflow', dispInflowTotals, current?.inflowTotals ?? [], false, 'operating')}

                {sectionBar('Cash Outflow (Direct Costs)', 'outflow', 'direct', 'operating')}
                {!isCollapsed('direct') && directRowList.map((r, idx, arr) => dataRow(r, true, true, idx === arr.length - 1))}
                {totalRow('Weekly Cash Direct Costs Outflow', dispDirectTotals, current?.directTotals ?? [], true, 'operating')}
                {netRow('Weekly Net Cash Flow Contribution', dispContribution, current?.contribution ?? [], 'operating')}

                {sectionBar('Cash Outflow (Expenses)', 'outflow', 'expense', 'operating')}
                {!isCollapsed('expense') && expenseRowList.map((r, idx, arr) => dataRow(r, true, true, idx === arr.length - 1))}
                {totalRow('Weekly Cash Outflow (Expenses)', dispExpenseTotals, current?.expenseTotals ?? [], true, 'operating')}
                {netRow('Weekly Net Cash Flow (Operating)', dispOperatingNet, current?.operatingNet ?? [], 'operating')}

                {manualBlocks.map((b, bi) => {
                  const pb = current?.blocks?.[bi];
                  const bk = blockKeyFor(b.id);
                  const inId = `blk-${b.id}-in`;
                  const outId = `blk-${b.id}-out`;
                  return (
                    <Fragment key={b.id}>
                      {sectionBar(b.inflow.title, 'inflow', inId, bk)}
                      {!isCollapsed(inId) && b.inflow.rows.map((r, idx, arr) => dataRow(r, false, true, idx === arr.length - 1))}
                      {b.outflow.rows.length > 0 && sectionBar(b.outflow.title, 'outflow', outId, bk)}
                      {!isCollapsed(outId) && b.outflow.rows.map((r, idx, arr) => dataRow(r, true, true, idx === arr.length - 1))}
                      {netRow(b.netLabel, b.net, pb?.net ?? [], bk)}
                    </Fragment>
                  );
                })}

                {netRow('Total Weekly Net Cash Flow', totalWeeklyNet, current?.totalNet ?? [], 'operating')}
              </tbody>
            </table>
          </div>
          <p className="px-3 py-2 text-[11px] text-muted-foreground">
            Each week has three columns: <span className="text-muted-foreground">Actual</span> · <span className="text-foreground">Forecast</span> · <span className="font-medium">Variance £ over %</span> (Actual − Forecast). Actual is that week's own real result — it appears as soon as the week starts (the current week shows the total so far). The current week's Variance is a <span className="italic">running</span> figure (part-week actual vs full-week forecast) and reads negative until the week closes; once the week ends it becomes final. Upcoming weeks are forecast-only. Green = favourable to cash, red = unfavourable.
          </p>
        </CardContent>
      </Card>
      </TooltipProvider>
    );
  };

  // ── End-Cash balance line chart (Table ↔ Graph toggle) ──
  // Plots FOUR series across the 13 weeks, always (independent of the Actual/
  // Forecast/Combined toggle, which only drives the tables): Forecast End Cash,
  // Actual End Cash (trailing 13 weeks, by week index), Variance (Actual − Forecast,
  // same convention as the Combined table), and a per-week Threshold line. A shaded
  // danger band sits below the threshold and follows it week by week. Each week's
  // threshold carries forward from the last value you set.
  const renderGraph = () => {
    // The graph always plots all four series regardless of the Actual/Forecast/
    // Combined toggle (that toggle drives the tables). Variance = Actual − Forecast
    // end cash, the same sign convention as the Combined table.
    const ecThrSeries = thrSeriesFor(END_CASH_THRESHOLD_KEY);
    const data = weeks.map((w, i) => {
      const thr = ecThrSeries[i];
      const forecast = Math.round(dispEndCash[i] ?? 0);
      const actual = Math.round(previous?.endCash?.[i] ?? 0);
      return {
        label: w.label,
        // The full "week commencing – ending" range for the tooltip.
        range: `${w.weekStart.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${new Date(w.weekStart.getTime() + 6 * 86400000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`,
        forecast,
        actual,
        // Minimum closing-balance threshold (carried forward) — sits directly on the
        // End Cash lines (same axis).
        threshold: thr != null ? Math.round(thr) : null,
        variance: actual - forecast,
      };
    });
    const setThresholds = data.map((d) => d.threshold).filter((v): v is number => v != null);
    const variances = data.map((d) => d.variance);
    const values = data.flatMap((d) => [d.forecast, d.actual]).concat(...setThresholds, ...variances, 0);
    const endCashThrSet = !!thresholdsByKey?.[END_CASH_THRESHOLD_KEY];
    const minY = Math.min(...values);
    const maxY = Math.max(...values);
    // Pad the domain a little so the lines/threshold don't kiss the edges.
    const pad = Math.max(1000, Math.round((maxY - minY) * 0.1));
    const domainMin = minY - pad;
    const domainMax = maxY + pad;
    // Header summary: a single value if the threshold is flat, else its range.
    const minThr = setThresholds.length ? Math.min(...setThresholds) : 0;
    const maxThr = setThresholds.length ? Math.max(...setThresholds) : 0;
    const thrLabel = minThr === maxThr ? gbp(minThr) : `${gbp(minThr)}–${gbp(maxThr)}`;

    return (
      <Card>
        <CardContent className="p-4 sm:p-6">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 className="text-sm font-semibold text-foreground">End Cash — Forecast vs Actual</h2>
            <div className="flex items-baseline gap-3 text-xs">
              {anyThresholdSet && (
                firstBreach
                  ? <span className="font-medium text-destructive">{firstBreach.message}</span>
                  : <span className="font-medium text-emerald-600">All thresholds OK</span>
              )}
            </div>
          </div>
          <div className="h-[440px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border/60" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} tickMargin={8} stroke="hsl(var(--muted-foreground))" />
                <YAxis
                  domain={[domainMin, domainMax]}
                  width={64}
                  tick={{ fontSize: 12 }}
                  stroke="hsl(var(--muted-foreground))"
                  tickFormatter={(v: number) => (Math.abs(v) >= 1000 ? `£${Math.round(v / 1000)}k` : `£${Math.round(v)}`)}
                />
                <RechartsTooltip
                  contentStyle={{ borderRadius: 8, border: '1px solid hsl(var(--border))', fontSize: 12 }}
                  formatter={(v: number, name: string) => [gbp(Number(v)), name]}
                  labelFormatter={(_l, p) => (p && p[0] ? `Week of ${(p[0].payload as { range: string }).range}` : '')}
                />
                {/* Explicit payload so the danger-band Area isn't listed as a 2nd "threshold". */}
                <Legend verticalAlign="top" align="right" iconType="plainline" wrapperStyle={{ fontSize: 12, paddingBottom: 8 }} payload={[
                  { value: 'Forecast', type: 'plainline' as const, id: 'forecast', color: '#2563eb', payload: { strokeDasharray: 'none' } },
                  { value: 'Actual', type: 'plainline' as const, id: 'actual', color: '#10b981', payload: { strokeDasharray: 'none' } },
                  { value: 'Variance', type: 'plainline' as const, id: 'variance', color: '#f59e0b', payload: { strokeDasharray: '2 3' } },
                  ...(endCashThrSet ? [{ value: 'Threshold (min balance)', type: 'plainline' as const, id: 'threshold', color: 'hsl(var(--destructive))', payload: { strokeDasharray: '5 4' } }] : []),
                ]} />
                <Line type="monotone" dataKey="forecast" name="Forecast" stroke="#2563eb" strokeWidth={2.5} dot={{ r: 3, strokeWidth: 0, fill: '#2563eb' }} activeDot={{ r: 5 }} />
                <Line type="monotone" dataKey="actual" name="Actual" stroke="#10b981" strokeWidth={2.5} dot={{ r: 3, strokeWidth: 0, fill: '#10b981' }} activeDot={{ r: 5 }} />
                {/* Minimum closing-balance threshold (red dashed, carried forward) —
                    the line behind the "below your minimum to cover bills" alert. */}
                {endCashThrSet && (
                  <Line type="stepAfter" dataKey="threshold" name="Threshold (min balance)" stroke="hsl(var(--destructive))" strokeWidth={1.5} strokeDasharray="5 4" dot={false} activeDot={false} connectNulls={false} />
                )}
                {/* Variance = Actual − Forecast end cash. Dotted amber so it reads as a
                    derived gap, distinct from the dashed grey Threshold. */}
                <Line type="monotone" dataKey="variance" name="Variance" stroke="#f59e0b" strokeWidth={2} strokeDasharray="2 3" dot={{ r: 2.5, strokeWidth: 0, fill: '#f59e0b' }} activeDot={{ r: 4 }} connectNulls={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    );
  };

  // ── Breakdown view: the end-cash chart + the current week's transaction list. ──
  const renderBreakdown = () => {
    const i = Math.min(breakdownWeek, weeks.length - 1);
    const wk = weeks[i];
    // "Remaining budget" rows = each forecast line's expected amount for the week
    // that ISN'T already a real invoice (coa cells flagged `fixed` are the
    // invoice-due overlay → represented by the Xero docs, so excluded here).
    type Item = { id: string; type: 'Invoice' | 'Bill' | 'Credit note' | 'Remaining budget'; date: string; description: string; amount: number; excluded?: boolean };
    const budgetItems: Item[] = wk ? (allRows ?? [])
      .filter((r) => !(r.kind === 'coa' && r.fixed?.[i]) && Math.round(dispVal(r, i)) !== 0)
      .map((r) => {
        const isOut = r.section === 'outflow' || r.section.endsWith('out');
        const v = Math.abs(dispVal(r, i));
        return { id: `budget:${r.key}`, type: 'Remaining budget', date: wk.iso, description: r.label, amount: isOut ? -v : v };
      }) : [];
    const allItems: Item[] = [...(bdTxns as Item[]), ...budgetItems];
    const isReal = (t: Item) => t.type === 'Invoice' || t.type === 'Bill' || t.type === 'Credit note';
    const filtered = allItems.filter((t) =>
      (bdFilters.showExcluded || !t.excluded) &&
      ((isReal(t) && bdFilters.real) || (t.type === 'Remaining budget' && bdFilters.budget)));
    const items = [...filtered].sort((a, b) =>
      bdSort === 'highest' ? b.amount - a.amount
        : bdSort === 'lowest' ? a.amount - b.amount
          : a.date.localeCompare(b.date));
    const net = items.reduce((s, t) => s + t.amount, 0);
    const sortLabel = bdSort === 'highest' ? 'Highest amount' : bdSort === 'lowest' ? 'Lowest amount' : 'Date';
    return (
      <div className="space-y-4">
        {renderGraph()}
        <Card>
          <CardContent className="p-0">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-3">
              <span className="text-sm font-medium text-foreground">Due this week &amp; overdue</span>
              <div className="flex items-center gap-2">
                {/* Filters popover */}
                <Popover open={bdFiltersOpen} onOpenChange={(o) => { if (o) setBdFiltersDraft(bdFilters); setBdFiltersOpen(o); }}>
                  <PopoverTrigger asChild>
                    <button type="button" className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-foreground hover:bg-muted/50"><Filter className="h-3.5 w-3.5" /> Filters</button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-72">
                    <p className="text-sm font-semibold text-foreground">Type</p>
                    <div className="mt-2 space-y-2 text-sm">
                      <label className="flex items-start gap-2">
                        <Checkbox checked={bdFiltersDraft.real} onCheckedChange={(v) => setBdFiltersDraft((f) => ({ ...f, real: !!v }))} className="mt-0.5" />
                        Invoices, bills and bank transactions
                      </label>
                      <label className="flex items-start gap-2">
                        <Checkbox checked={bdFiltersDraft.budget} onCheckedChange={(v) => setBdFiltersDraft((f) => ({ ...f, budget: !!v }))} className="mt-0.5" />
                        Budgets, projects and new hires
                      </label>
                    </div>
                    <div className="my-3 border-t border-border" />
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Display excluded transactions:</span>
                      <Switch checked={bdFiltersDraft.showExcluded} onCheckedChange={(v) => setBdFiltersDraft((f) => ({ ...f, showExcluded: v }))} />
                    </div>
                    <div className="mt-4 flex items-center justify-between">
                      <button type="button" className="text-sm text-destructive hover:underline" onClick={() => setBdFiltersDraft(bdFilterDefaults)}>Reset</button>
                      <div className="flex gap-2">
                        <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted" onClick={() => setBdFiltersOpen(false)}>Cancel</button>
                        <button type="button" className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90" onClick={() => { setBdFilters(bdFiltersDraft); setBdFiltersOpen(false); }}>Apply</button>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
                {/* Sort dropdown */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button type="button" className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-foreground hover:bg-muted/50"><ArrowDownUp className="h-3.5 w-3.5" /> {sortLabel} <ChevronDown className="h-3.5 w-3.5" /></button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setBdSort('date')}>Date</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setBdSort('highest')}>Highest amount</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setBdSort('lowest')}>Lowest amount</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
            <div className="flex items-center justify-end px-4 py-1.5 text-xs text-muted-foreground">{items.length} {items.length === 1 ? 'item' : 'items'} · net {gbp(net)}</div>
            {bdLoading ? (
              <div className="space-y-2 p-4"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div>
            ) : items.length === 0 ? (
              <p className="p-8 text-center text-sm text-muted-foreground">Nothing expected in the week of {wk?.label}.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2">Type</th>
                    <th className="px-4 py-2">Date</th>
                    <th className="px-4 py-2">Description</th>
                    <th className="px-4 py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((t) => (
                    <tr key={t.id} className={`border-b border-border/60 hover:bg-muted/30 ${t.excluded ? 'opacity-50 line-through' : ''}`}>
                      <td className="px-4 py-2"><span className={`rounded px-1.5 py-0.5 text-xs ${t.type === 'Remaining budget' ? 'bg-violet-100 text-violet-700' : t.amount < 0 ? 'bg-destructive/10 text-destructive' : 'bg-emerald-100 text-emerald-700'}`}>{t.type}</span></td>
                      <td className="px-4 py-2 text-muted-foreground">{new Date(`${t.date}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })}</td>
                      <td className="px-4 py-2 text-foreground">{t.description}</td>
                      <td className={`px-4 py-2 text-right tabular-nums ${t.amount < 0 ? 'text-destructive' : 'text-foreground'}`}>{t.amount < 0 ? `-${gbp(Math.abs(t.amount))}` : `+${gbp(t.amount)}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>
    );
  };

  return (
    <MainLayout userRole="admin">
      <Helmet>
        <title>13-Week Cash Flow Forecast - DentPulse</title>
        <meta name="description" content="Rolling 13-week cash flow forecast, predicted from the trailing period and editable per week." />
      </Helmet>

      <div className="space-y-5 animate-fade-in">
        {/* Header */}
        <div className="space-y-3">
          <h1 className="text-2xl font-semibold text-foreground">13-Week Cash Flow Forecast</h1>
          {/* Tabs (left) + view / display controls (right) share one row below the title */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Overview / Breakdown / CFO Summary tabs — segmented pill */}
            <div className="inline-flex rounded-full border border-border p-0.5 text-xs">
              {([
                { id: 'overview', label: 'Overview' },
                { id: 'breakdown', label: 'Breakdown' },
                { id: 'cfo', label: 'CFO Summary' },
              ] as const).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`px-3 py-1 rounded-full transition-colors ${tab === t.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          <div className={`flex items-center gap-3 ${tab === 'breakdown' || tab === 'cfo' ? 'hidden' : ''}`}>
            {/* Actual / Forecast / Combined tabs */}
            <div className="inline-flex rounded-full border border-border p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setView('actual')}
                className={`px-3 py-1 rounded-full transition-colors ${view === 'actual' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                Actual
              </button>
              <button
                type="button"
                onClick={() => setView('forecast')}
                className={`px-3 py-1 rounded-full transition-colors ${view === 'forecast' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                Forecast
              </button>
              <button
                type="button"
                onClick={() => setView('combined')}
                className={`px-3 py-1 rounded-full transition-colors ${view === 'combined' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                Combined
              </button>
            </div>
            {/* Table ↔ Graph toggle — available for all three tabs. */}
            <div className="inline-flex rounded-full border border-border p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setChartMode('table')}
                className={`px-3 py-1 rounded-full transition-colors ${chartMode === 'table' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                Table
              </button>
              <button
                type="button"
                onClick={() => setChartMode('graph')}
                className={`px-3 py-1 rounded-full transition-colors ${chartMode === 'graph' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                Graph
              </button>
            </div>
            {/* Window navigation — shift the 13-week window ±1 week; calendar = today.
                Available on all tabs; the Actual (trailing) window is anchored to
                weekOffset too, so paging works there as well. */}
            <div className="inline-flex items-center rounded-md border border-border">
              <button type="button" aria-label="Previous week" onClick={() => setWeekOffset((o) => o - 1)} className="px-2 py-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-l-md">
                <ArrowLeft className="h-4 w-4" />
              </button>
              <button type="button" aria-label="Reset to today" onClick={() => setWeekOffset(0)} className={`border-x border-border px-2 py-1.5 hover:bg-muted/50 ${weekOffset === 0 ? 'text-muted-foreground' : 'text-primary'}`}>
                <CalendarDays className="h-4 w-4" />
              </button>
              <button type="button" aria-label="Next week" onClick={() => setWeekOffset((o) => o + 1)} className="px-2 py-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-r-md">
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
            {/* Download — Excel / PDF of the current forecast (matches the on-screen figures). */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Download forecast"
                  title="Download forecast"
                  className="inline-flex items-center justify-center rounded-md border border-border px-2 py-1.5 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                >
                  <Download className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => exportForecastXlsx(buildExportData())}>
                  <FileSpreadsheet className="mr-2 h-4 w-4" /> Export to Excel
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportForecastPdf(buildExportData())}>
                  <FileText className="mr-2 h-4 w-4" /> Export to PDF
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {/* Forecast settings — tune the assumptions used to project the next 13 weeks. */}
            <button
              type="button"
              aria-label="Forecast settings"
              title="Forecast settings"
              onClick={() => setSettingsOpen(true)}
              className="inline-flex items-center justify-center rounded-md border border-border px-2 py-1.5 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            >
              <Settings className="h-4 w-4" />
            </button>
          </div>
          </div>
        </div>

        {/* Revenue scenario — Best / Most likely / Worst case quick-switch (persists to
            Forecast Settings; a flat % uplift on projected income). Base = reconciled.
            Shown on the whole Overview tab, including the Actual view. */}
        {tab === 'overview' && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Scenario:</span>
            <div className="inline-flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setScenarioActive(null)}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${scenario.active === null ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:border-primary/50 hover:text-foreground'}`}
              >
                Base case
              </button>
              {SCENARIO_KEYS.map((k) => {
                const active = scenario.active === k;
                const pct = k === 'best' ? scenario.bestPct : k === 'likely' ? scenario.likelyPct : scenario.worstPct;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setScenarioActive(k)}
                    className={`rounded-full border px-3 py-1 text-xs transition-colors ${active ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:border-primary/50 hover:text-foreground'}`}
                  >
                    {SCENARIO_LABELS[k]} <span className="tabular-nums opacity-80">({pct >= 0 ? '+' : ''}{pct}%)</span>
                  </button>
                );
              })}
            </div>
            {scenario.active && (
              <span className="text-[11px] text-muted-foreground">Projected income {scenarioPct(scenario) >= 0 ? 'lifted' : 'lowered'} {Math.abs(scenarioPct(scenario))}% — edit each case in Settings → Income logic.</span>
            )}
          </div>
        )}

        {/* Cash-flow group tabs — jump to each section of the sheet. */}
        {tab === 'overview' && view === 'forecast' && chartMode === 'table' && (
          <div className="flex flex-wrap gap-2">
            {FORECAST_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => scrollToSection(t.id)}
                className={`rounded-md border px-3 py-1.5 text-xs font-medium uppercase tracking-wide transition-colors ${
                  activeSection === t.id
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-primary/40 bg-background text-primary hover:border-primary hover:bg-primary/5'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        <SectionErrorBoundary>
        {tab === 'cfo' ? (
          <CfoSummaryContent />
        ) : tab === 'breakdown' ? (
          renderBreakdown()
        ) : isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : chartMode === 'graph' ? (
          renderGraph()
        ) : view === 'combined' ? (
          renderCombinedTable()
        ) : view === 'actual' ? (
          renderPreviousTable()
        ) : (
          <TooltipProvider delayDuration={150}>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                {/* border-separate (not collapse) so the sticky first column
                    holds reliably across browsers. */}
                <table className="w-full border-separate border-spacing-0 text-sm">
                  {/* Week headers */}
                  <thead>
                    <tr className="bg-muted/60">
                      <th
                        className="sticky left-0 z-20 bg-muted/60 border-r border-border px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                        style={{ minWidth: 220, width: 220 }}
                      >
                        Week commencing
                      </th>
                      {weeks.map((w) => (
                        <th key={w.iso} className="border-r border-border/40 px-2 py-2 text-center text-[12px] font-semibold text-foreground" style={{ minWidth: 92 }}>
                          {w.label}
                        </th>
                      ))}
                    </tr>
                    <tr className="bg-muted/40">
                      <th className="sticky left-0 z-20 bg-muted/40 border-r border-border px-3 py-1 text-left text-[11px] font-medium text-muted-foreground" style={{ minWidth: 220 }}>
                        Week #
                      </th>
                      {weeks.map((w) => (
                        <th key={w.iso} className="border-r border-border/40 px-2 py-1 text-center text-[11px] font-medium text-muted-foreground tabular-nums" style={{ minWidth: 92 }}>
                          {w.weekNumber}
                        </th>
                      ))}
                    </tr>
                  </thead>

                  <tbody>
                    {/* CASH INFLOW section header — frozen label + colored bar
                        across the scrolling area (mirrors the data rows). Click to
                        collapse/expand the whole inflow section. */}
                    <tr id="cf-operations" className="scroll-mt-24">
                      <td
                        className={`sticky left-0 z-10 border-l-[3px] ${BLOCK_COLORS.operating.rail} ${BLOCK_COLORS.operating.inBg} ${BLOCK_COLORS.operating.text} px-3 py-2 text-[11px] font-semibold uppercase tracking-wide cursor-pointer select-none`}
                        style={{ minWidth: 220, width: 220 }}
                        onClick={() => toggleCollapse('inflow')}
                      >
                        <span className="inline-flex items-center gap-1.5">
                          <CollapseChevron id="inflow" />
                          Cash Inflow
                        </span>
                      </td>
                      <td colSpan={weeks.length} className={`${BLOCK_COLORS.operating.inBg} cursor-pointer`} onClick={() => toggleCollapse('inflow')} />
                    </tr>

                    {!isCollapsed('inflow') && (
                    <Fragment>
                    {renderRow(nhsRow, {
                      tooltip: "Your practice's annual NHS contract value divided by 12, since NHS pays a fixed amount each month. It's shown in the first full week of the month the payment arrives. Set the contract value under Providers → UDA Goals for this location.",
                    })}

                    {/* Membership group — click to collapse/expand clinician rows. */}
                    {incomeInclude.includeDenplan && (
                    <tr className="border-b border-border/60">
                      <td
                        className="sticky left-0 z-10 bg-background border-r border-border px-3 py-1.5 text-[13px] font-medium text-foreground"
                        style={{ minWidth: 220 }}
                      >
                        <span className="inline-flex items-center gap-1.5">
                          <button type="button" aria-label="Collapse membership" className="text-foreground/70 hover:text-foreground" onClick={() => toggleCollapse('membership')}>
                            <CollapseChevron id="membership" />
                          </button>
                          Membership ({membershipProvider})
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button type="button" aria-label="How this is calculated" className="text-muted-foreground/60 hover:text-foreground">
                                <Info className="h-3 w-3" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" align="start" collisionPadding={12} className="max-w-[280px] text-xs leading-relaxed z-50">
                              Each clinician's monthly {membershipProvider} income, taken from your uploaded membership data for this location. It's shown in the week the {membershipProvider} payment lands (the 15th), with a small reduction over time to allow for members leaving (about 5% a year).
                            </TooltipContent>
                          </Tooltip>
                        </span>
                      </td>
                      {weeks.map((w) => (
                        <td key={w.iso} className="border-r border-border/40" style={{ minWidth: 92 }} />
                      ))}
                    </tr>
                    )}
                    {incomeInclude.includeDenplan && !isCollapsed('membership') && (membershipRows.length > 0 ? (
                      membershipRows.map((r, idx) => renderRow(r, { indent: true, lastChild: idx === membershipRows.length - 1 }))
                    ) : (
                      <tr className="border-b border-border/60">
                        <td className="sticky left-0 bg-background border-r border-border px-3 py-1.5 pl-7 text-[12px] italic text-muted-foreground" style={{ minWidth: 220 }}>
                          No membership clinicians in the trailing period
                        </td>
                        {weeks.map((w) => (
                          <td key={w.iso} className="border-r border-border/40" style={{ minWidth: 92 }} />
                        ))}
                      </tr>
                    ))}

                    {renderRow(privateRow, {
                      valueFor: privateEffective,
                      // Functional source switch: PMS (Dentally takings) ↔ Accounting
                      // (connected ledger). Shared helper, also shown on the Actual /
                      // Combined tabs' Private row.
                      labelExtra: privateSourceToggle(),
                      tooltip: privateUsingAccounting
                        ? 'Sourced from your connected accounting software (the Private income accounts mapped in Location Settings → Income Type Mapping = Accounting App), summed weekly from the ledger and projected forward. Switch that setting to PMS App to use Dentally takings instead.'
                        : `Your weekly Dentally Takings — all money taken at the practice (every payment plan: private, NHS, ${membershipProvider}/membership and sundries), by payment date — projected forward from your last 13 weeks. Switch Location Settings → Income Type Mapping (Private) to Accounting App to source it from Xero/QuickBooks instead.`,
                    })}

                    {/* Private adjustment % — pick a preset to scale that week's
                        Private figure (e.g. 2,000 at -5% → 1,900). */}
                    {incomeInclude.includePrivate && (
                    <tr className="border-b border-border/60 hover:bg-muted/30">
                      <td
                        className="sticky left-0 z-10 bg-background hover:bg-muted/30 border-r border-border px-3 py-1.5 text-[12px] italic text-muted-foreground"
                        style={{ minWidth: 220, width: 220 }}
                      >
                        <span className="pl-4">Adjustment %</span>
                      </td>
                      {weeks.map((w, i) => (
                        <td key={w.iso} className="border-r border-border/40 p-0" style={{ minWidth: 92 }}>
                          <select
                            className={[
                              'w-full h-full bg-transparent px-1.5 py-1.5 text-[12px] cursor-pointer rounded-sm',
                              'focus:outline-none focus:ring-2 focus:ring-primary/40',
                              privatePctSet[i] ? 'font-semibold text-primary' : 'text-muted-foreground italic',
                            ].join(' ')}
                            value={String(privatePct[i] ?? 0)}
                            onChange={(e) =>
                              setCell.mutate({
                                weekStart: w.iso,
                                lineKey: 'private_pct',
                                amount: e.target.value === '0' ? null : Number(e.target.value),
                                section: 'inflow',
                              })
                            }
                          >
                            <option value="0">–</option>
                            <option value="-20">-20%</option>
                            <option value="-10">-10%</option>
                            <option value="-5">-5%</option>
                            <option value="5">+5%</option>
                            <option value="10">+10%</option>
                            <option value="20">+20%</option>
                          </select>
                        </td>
                      ))}
                    </tr>
                    )}

                    {/* Operating inflow extras ("Others") + custom one-off receipts */}
                    {operatingInflowExtraRows.map((r, idx) => renderRow(r, { indent: true, lastChild: customRows.length === 0 && idx === operatingInflowExtraRows.length - 1 }))}
                    {customRows.map((r, idx) => renderRow(r, { indent: true, removable: true, editableLabel: true, lastChild: idx === customRows.length - 1 }))}
                    {renderAddRow('inflow', 'Add inflow row')}
                    </Fragment>
                    )}

                    {/* WEEKLY CASH INFLOW total */}
                    <tr className={`${BLOCK_COLORS.operating.totalBg} ${BLOCK_COLORS.operating.totalText} font-semibold`}>
                      <td className={`sticky left-0 z-10 border-l-[3px] ${BLOCK_COLORS.operating.rail} ${BLOCK_COLORS.operating.totalBg} px-3 py-2 text-[11px] uppercase tracking-wide`} style={{ minWidth: 220 }}>
                        Weekly Cash Inflow
                      </td>
                      {dispInflowTotals.map((t, i) => (
                        <td key={weeks[i].iso} className="border-r border-black/5 px-2 py-2 text-right tabular-nums text-[13px]" style={{ minWidth: 92 }}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-block w-full cursor-default">{gbpPence(t)}</span>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" align="end" collisionPadding={12} className="max-w-[280px] text-xs leading-relaxed z-50">
                              All cash coming in for the week of {weeks[i].label}: NHS + Membership + Private + any one-offs = {gbpPence(t)}.
                            </TooltipContent>
                          </Tooltip>
                        </td>
                      ))}
                    </tr>

                    {/* CASH OUTFLOW (Direct Costs) — one row per mapped account
                        (Category Range "Direct Costs"), or the Profit-Expenses
                        grouped rows when nothing is mapped there. */}
                    {renderSectionBar('Cash Outflow (Direct Costs)', 'outflow', undefined, 'direct')}
                    {!isCollapsed('direct') && outflowCostRows.map((r, idx) => renderRow(r, { indent: true, thresholdable: true, lastChild: operatingDirectExtraRows.length === 0 && idx === outflowCostRows.length - 1 }))}
                    {!isCollapsed('direct') && operatingDirectExtraRows.map((r, idx) => renderRow(r, { indent: true, thresholdable: true, lastChild: idx === operatingDirectExtraRows.length - 1 }))}
                    {renderTotalRow('Weekly Cash Direct Costs Outflow', dispDirectTotals, 'outflow', 'operating')}

                    {/* Contribution = inflow − direct costs */}
                    {renderNetRow('Weekly Net Cash Flow Contribution', dispContribution, 'operating')}

                    {/* CASH OUTFLOW (Expenses) — one row per mapped account
                        (Category Range "Over Heads"), or the Profit-Expenses
                        grouped rows when nothing is mapped there. */}
                    {renderSectionBar('Cash Outflow (Expenses)', 'outflow', undefined, 'expense')}
                    {!isCollapsed('expense') && outflowExpenseRows.map((r, idx) => renderRow(r, { indent: true, lastChild: operatingExpenseExtraRows.length === 0 && outflowCustomRows.length === 0 && idx === outflowExpenseRows.length - 1 }))}
                    {!isCollapsed('expense') && operatingExpenseExtraRows.map((r, idx) => renderRow(r, { indent: true, lastChild: outflowCustomRows.length === 0 && idx === operatingExpenseExtraRows.length - 1 }))}
                    {!isCollapsed('expense') && outflowCustomRows.map((r, idx) => renderRow(r, { indent: true, removable: true, editableLabel: true, lastChild: idx === outflowCustomRows.length - 1 }))}
                    {!isCollapsed('expense') && renderAddRow('outflow', 'Add expense row')}
                    {renderTotalRow('Weekly Cash Outflow (Expenses)', dispExpenseTotals, 'outflow', 'operating')}

                    {/* Operating net = contribution − expenses */}
                    {renderNetRow('Weekly Net Cash Flow (Operating)', dispOperatingNet, 'operating')}

                    {/* ── Manual lower blocks: Investing / Financing / Tax & Grant / Inter Company ── */}
                    {manualBlocks.map((b) => renderManualBlock(b))}

                    {/* ── Running cash balance ── */}
                    {/* Start Cash: a single editable opening balance (week 1). */}
                    <tr className="border-y border-border bg-muted/50 font-semibold">
                      <td className="sticky left-0 z-10 bg-muted/50 border-r border-border px-3 py-1.5 text-[12px] uppercase tracking-wide text-foreground" style={{ minWidth: 220 }}>
                        Start Cash (incl. all bank accounts)
                      </td>
                      {weeks.map((w, i) => (
                        <td key={w.iso} className="border-r border-border/40 p-0" style={{ minWidth: 92 }}>
                          {i === 0 ? (
                            <EditableCell
                              value={startCash}
                              overridden={startCashSet}
                              title={{
                                description: "Your opening cash across all bank accounts at the start of the forecast. Every week's End Cash rolls forward from here.",
                                calculation: `Opening balance = ${gbpPence(startCash)}.`,
                              }}
                              onCommit={(v) => setCell.mutate({ weekStart: weeks[0].iso, lineKey: 'start_cash', amount: v, section: 'balance' })}
                            />
                          ) : null}
                        </td>
                      ))}
                    </tr>

                    {/* End Cash: running balance, colored red when negative. Carries a
                        per-row MINIMUM-cash threshold (gauge icon); below-min weeks alert. */}
                    {(() => {
                    const ecThr = thrSeriesFor(END_CASH_THRESHOLD_KEY);
                    const ecThrVal = ecThr.find((t) => t != null);
                    return (
                    <tr className="group font-bold border-y border-border">
                      <td className="sticky left-0 z-10 bg-background border-r border-border px-3 py-2 text-[12px] uppercase tracking-wide text-foreground" style={{ minWidth: 220 }}>
                        <div className="flex items-center gap-1.5">
                          <span>End Cash</span>
                          {thresholdsByKey?.[END_CASH_THRESHOLD_KEY] && ecThrVal != null && (
                            <span className="rounded bg-destructive/10 px-1 text-[10px] font-medium text-destructive" title="Minimum cash balance">min {gbp(ecThrVal)}</span>
                          )}
                          <div className="ml-auto flex items-center gap-1.5">
                            <Popover>
                              <PopoverTrigger asChild>
                                <button type="button" aria-label="Graph end cash" className="shrink-0 rounded text-muted-foreground opacity-0 transition-opacity hover:text-primary focus:opacity-100 group-hover:opacity-100">
                                  <LineChartIcon className="h-3.5 w-3.5" />
                                </button>
                              </PopoverTrigger>
                              <PopoverContent align="end" side="right" className="w-[380px]">
                                <RowMiniChart row={endCashThresholdRow()} />
                              </PopoverContent>
                            </Popover>
                            <button
                              type="button"
                              aria-label="Set end cash threshold"
                              className="shrink-0 rounded text-muted-foreground opacity-0 transition-opacity hover:text-primary focus:opacity-100 group-hover:opacity-100"
                              onClick={() => openEditor(endCashThresholdRow(), 0, 'threshold')}
                            >
                              <Gauge className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      </td>
                      {dispEndCash.map((t, i) => (
                        <td
                          key={weeks[i].iso}
                          className={`border-r border-border/40 px-2 py-2 text-right tabular-nums text-[13px] ${t < 0 ? 'bg-destructive/10 text-destructive' : 'bg-muted/40 text-foreground'}`}
                          style={{ minWidth: 92 }}
                        >
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-block w-full cursor-default">{gbpPence(t)}</span>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" align="end" collisionPadding={12} className="max-w-[280px] text-xs leading-relaxed z-50">
                              Opening cash {gbpPence(startCash)} plus every week's net cash flow up to the week of {weeks[i].label} = {gbpPence(t)}.
                            </TooltipContent>
                          </Tooltip>
                        </td>
                      ))}
                    </tr>
                    );
                    })()}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          </TooltipProvider>
        )}
        </SectionErrorBoundary>

        <p className="text-xs text-muted-foreground">
          Cash inflow is calculated from your real data — NHS from the UDA contract value, Membership
          from your uploaded membership data, and Private from private treatment income. Cash outflow
          is taken from the accounts mapped under Setup Categories → Profit (Expenses) over the past
          13 weeks and forecast forward. The Investing, Financing, Tax &amp; Grant and Inter Company
          blocks are manual — type the expected amounts and they're saved automatically. End Cash rolls
          your opening balance forward by each week's net cash flow.
        </p>

        {/* Decisions Made — free-text notes per forecast week (mirrors the sheet). */}
        {tab === 'overview' && !isLoading && chartMode === 'table' && view === 'forecast' && weeks.length > 0 && (
          <Card>
            <CardContent className="p-4">
              <div className="mb-3 flex items-center gap-1.5">
                <h2 className="text-sm font-semibold text-foreground">Decisions Made</h2>
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"><Sparkles className="h-2.5 w-2.5" /> AI-assisted</span>
              </div>
              <div className="space-y-2">
                {weeks.map((w, i) => (
                  <WeekDecisionNote
                    key={w.iso}
                    weekNumber={w.weekNumber}
                    label={w.label}
                    initialNote={notes[i] || ''}
                    suggestion={weekSuggestion(i)}
                    onSave={(text) => setNote.mutate({ weekStart: w.iso, text })}
                  />
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* ── Cell editor drawer (replaces inline editing) ── */}
      <Sheet open={!!editorCell} onOpenChange={(o) => { if (!o) closeEditor(); }}>
        <SheetContent side="right" className="w-full sm:max-w-[400px] overflow-y-auto">
          {editorCell && (() => {
            const { row, weekIndex } = editorCell;
            const w = weeks[weekIndex];
            const current = row.key === 'private' ? privateEffective(weekIndex) : dispVal(row, weekIndex);
            // Income vs cost — drives the category list shown and the wording.
            const isOutflow = row.section === 'outflow' || row.section.endsWith('out');
            const noun = isOutflow ? 'cost' : 'income';            // "auto cost" / "auto income"
            const changeVerb = isOutflow ? 'spending' : 'earning'; // "If your spending changes"
            const catList = isOutflow ? costCategories : incomeCategories;
            const parse = (s: string): number | null => {
              const raw = s.replace(/[£,\s]/g, '').trim();
              if (raw === '') return null;
              const n = Number(raw);
              return Number.isFinite(n) ? n : null;
            };
            const back = (
              // The Total Weekly Net Cash Flow threshold opens straight into the
              // threshold panel (it has no rule menu), so its Back simply closes.
              <button type="button" onClick={() => row.section === 'threshold' ? closeEditor() : setEditorMode('menu')} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-3">
                <ChevronLeft className="h-3.5 w-3.5" /> Back
              </button>
            );
            // Append a fresh blank form block of the CURRENT panel's type — this is
            // what "Add & add another" does (it duplicates the form, not the data).
            const addDraft = () => {
              const last = drafts[drafts.length - 1]?.rule;
              let rule: ForecastRule;
              if (editorMode === 'auto') rule = { type: 'auto', basis: 'prev_month', day: 1, addon: 0, name: '' };
              else if (editorMode === 'linked') rule = { type: 'linked', name: '', inputs: [{ pct: 0, source: '' }], offsetEnabled: false, offsetValue: 0, offsetUnit: 'days', offsetDir: 'after' };
              else rule = { type: 'repeating', name: '', amount: undefined, start: w.iso, every: last?.type === 'repeating' ? (last.every ?? 'month') : 'month', ends: null, stepValue: 0 };
              setDrafts((ds) => [...ds, { rule, targetKey: row.key }]);
            };
            // Shared bottom action footer (rendered ONCE, after the stacked blocks):
            // "Add & add another" appends another editable block; the primary button
            // saves EVERY block to its chosen line and closes; Remove (optional) clears
            // an already-saved rule on the opened row (only meaningful for a single block).
            const actionFooter = (o: { label: string; canSave?: boolean; onSave: () => void; onRemove?: () => void; addLabel?: string }) => (
              <div className="mt-6 border-t border-border pt-4">
                <div className="flex items-center gap-2">
                  {o.onRemove && <button type="button" onClick={o.onRemove} className="mr-auto text-sm text-destructive hover:underline">Remove</button>}
                  <button type="button" onClick={addDraft} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">Add &amp; add another</button>
                  <button type="button" disabled={o.canSave === false} onClick={() => { o.onSave(); closeEditor(); }} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">{drafts.length > 1 ? `Add ${drafts.length} ${o.addLabel ?? 'item'}s` : o.label}</button>
                </div>
              </div>
            );
            // Week picker for the week-specific panels (One-off / Threshold), since
            // the drawer now opens from the row's + icon rather than a single cell.
            const weekSelect = (label: string) => (
              <div className="mb-3">
                <label className="mb-1 block text-xs font-medium text-foreground">{label}</label>
                <select
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  value={weekIndex}
                  onChange={(e) => {
                    const wi = Number(e.target.value);
                    setEditorCell((c) => (c ? { ...c, weekIndex: wi } : c));
                    // Threshold editor: re-seed the input with the value in force for
                    // the newly-selected week (carried forward), so picking a week shows
                    // the amount already set for it instead of a stale/blank field.
                    if (editorMode === 'threshold') {
                      const t = thrSeriesFor(thresholdKeyFor(row))[wi];
                      setEditorDraft(t != null ? String(Math.round(t)) : '');
                    }
                  }}
                >
                  {weeks.map((wk, i) => <option key={wk.iso} value={i}>Week of {wk.label}</option>)}
                </select>
              </div>
            );
            // Accounting-category dropdown (income/revenue accounts from the ledger).
            // Falls back to the row's own label when no ledger categories are loaded.
            const categorySelect = (value: string | undefined, onChange: (v: string) => void) => (
              <div>
                <label className="mb-1 block text-xs font-medium text-foreground">Accounting category <span className="text-muted-foreground">(from Xero)</span></label>
                <select
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  value={value ?? row.label}
                  onChange={(e) => onChange(e.target.value)}
                >
                  {!catList.includes(value ?? row.label) && <option value={value ?? row.label}>{value ?? row.label}</option>}
                  {catList.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            );
            // Target-line picker (replaces the category dropdown in the rule panels):
            // which existing forecast LINE this entry saves to, so the saved rule
            // actually attaches to a visible row. Limited to lines of the same
            // inflow/outflow family as the opened row; defaults to the opened row.
            const targetSelect = (di: number) => {
              const family = (s: string) => (s === 'inflow' || s.endsWith('-in') ? 'in' : 'out');
              const fam = family(row.section);
              const opts = [...rowsByKey.values()].filter((r) => family(r.section) === fam);
              const cur = drafts[di]?.targetKey ?? row.key;
              return (
                <div>
                  <label className="mb-1 block text-xs font-medium text-foreground">Apply to line</label>
                  <select
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                    value={cur}
                    onChange={(e) => setDraftTarget(di, e.target.value)}
                  >
                    {!opts.some((r) => r.key === cur) && <option value={cur}>{rowsByKey.get(cur)?.label ?? cur}</option>}
                    {opts.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                  </select>
                </div>
              );
            };
            const field = (placeholder: string, onSave: () => void) => (
              <div className="space-y-3">
                <input
                  autoFocus
                  inputMode="numeric"
                  value={editorDraft}
                  placeholder={placeholder}
                  onChange={(e) => setEditorDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') onSave(); }}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
                <div className="flex gap-2">
                  <button type="button" onClick={onSave} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">Save</button>
                  <button type="button" onClick={closeEditor} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted">Cancel</button>
                </div>
              </div>
            );

            const OPTIONS = [
              { mode: 'auto', icon: <Sparkles className="h-4 w-4 text-primary" />, title: 'Auto', desc: 'Auto-update from last week or a recent average.' },
              { mode: 'repeating', icon: <Repeat className="h-4 w-4 text-primary" />, title: 'Repeating', desc: 'A payment that repeats on a schedule (e.g. retainers).' },
              { mode: 'oneoff', icon: <Hash className="h-4 w-4 text-primary" />, title: 'One-off', desc: 'A one-time amount for just this week.' },
              { mode: 'linked', icon: <Link2 className="h-4 w-4 text-primary" />, title: 'Linked', desc: 'A percentage of another line (e.g. 5% of Private).' },
              // The only threshold (minimum closing balance) is set from the End Cash
              // row's gauge, never from this row menu.
            ] as const;

            return (
              <>
                <SheetHeader>
                  <SheetTitle>{row.label}</SheetTitle>
                  <SheetDescription>
                    {editorMode === 'threshold'
                      ? `${thresholdKindFor(row) === 'min' ? 'Minimum' : 'Maximum'} ${row.label} threshold from the week of ${w.label}`
                      : editorMode === 'auto'
                        ? `Auto-updating ${noun} — forecast it going forward`
                        : editorMode === 'linked'
                          ? `A ${noun} linked to a percentage of other lines`
                        : editorMode === 'repeating'
                          ? (drafts[0]?.rule.type === 'repeating' && drafts[0].rule.every === 'none' ? `A one-off ${noun}` : `A ${noun} that repeats on a schedule`)
                          : editorMode === 'menu'
                            ? 'How would you like to forecast this line?'
                            : `Week of ${w.label} · currently ${gbpPence(current)}`}
                  </SheetDescription>
                </SheetHeader>

                <div className="mt-5">
                  {editorMode === 'menu' && (
                    <div className="space-y-2">
                      {OPTIONS.map((o) => (
                        <button
                          key={o.mode}
                          type="button"
                          onClick={() => {
                            if (o.mode === 'auto') {
                              // Open the Auto panel, prefilled if this row already
                              // has an auto rule (else default to last-week basis).
                              const r = row.rule?.type === 'auto' ? row.rule : null;
                              setDrafts([{ rule: { type: 'auto', basis: r?.basis ?? 'prev_month', day: r?.day ?? 1, addon: r?.addon ?? 0, name: r?.name }, targetKey: row.key }]);
                              setEditorMode('auto');
                            } else if (o.mode === 'repeating' || o.mode === 'oneoff') {
                              // One-off and Repeating share the same form; a one-off
                              // simply defaults "Repeats every" to "Doesn't repeat".
                              const r = row.rule?.type === 'repeating' ? row.rule : null;
                              setDrafts([{ rule: {
                                type: 'repeating',
                                name: r?.name ?? '',
                                // One-off ADDS to the cell's existing amount, so start
                                // blank (the user types only the extra). Repeating fully
                                // defines the cell, so prefill with the current value.
                                amount: o.mode === 'oneoff' ? (r?.amount ?? undefined) : (r?.amount ?? (current ? Math.round(current) : undefined)),
                                start: r?.start ?? w.iso,
                                every: o.mode === 'oneoff' ? 'none' : (r?.every ?? 'month'),
                                ends: r?.ends ?? null,
                                stepKind: r?.stepKind,
                                stepValue: r?.stepValue ?? 0,
                              }, targetKey: row.key }]);
                              setEditorMode('repeating');
                            } else if (o.mode === 'linked') {
                              const r = row.rule?.type === 'linked' ? row.rule : null;
                              setDrafts([{ rule: {
                                type: 'linked',
                                name: r?.name ?? '',
                                inputs: r?.inputs?.length ? r.inputs : [{ pct: 0, source: '' }],
                                offsetEnabled: r?.offsetEnabled ?? false,
                                offsetValue: r?.offsetValue ?? 0,
                                offsetUnit: r?.offsetUnit ?? 'days',
                                offsetDir: r?.offsetDir ?? 'after',
                              }, targetKey: row.key }]);
                              setEditorMode('linked');
                            }
                          }}
                          className="w-full text-left rounded-lg border border-border p-3 hover:border-primary hover:bg-primary/5 transition-colors"
                        >
                          <div className="flex items-center gap-2 text-sm font-medium text-foreground">{o.icon}{o.title}</div>
                          <p className="mt-1 text-xs text-muted-foreground">{o.desc}</p>
                        </button>
                      ))}
                    </div>
                  )}

                  {editorMode === 'threshold' && (() => {
                    const kind = thresholdKindFor(row);
                    const tKey = thresholdKeyFor(row);
                    return (
                    <div>{back}{weekSelect('From which week')}<p className="text-xs text-muted-foreground mb-2">{kind === 'min'
                      ? `Sets the minimum acceptable ${row.label} from the week of ${w.label} onward (it carries forward until you change it in a later week). Any week whose ${row.label} falls below this raises an alert.`
                      : `Sets the maximum acceptable ${row.label} from the week of ${w.label} onward (it carries forward until you change it in a later week). Any week whose ${row.label} goes above this raises an alert.`} Leave blank to clear.</p>
                      {field(kind === 'min' ? 'e.g. 5,000' : 'e.g. 2,000', () => {
                        setCell.mutate({ weekStart: w.iso, lineKey: tKey, amount: parse(editorDraft), section: 'threshold' });
                        closeEditor();
                      })}
                    </div>
                    );
                  })()}

                  {editorMode === 'auto' && drafts.length > 0 && (() => {
                    const inputCls = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40';
                    const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;
                    const saveAll = () => drafts.forEach((d) => {
                      const target = rowsByKey.get(d.targetKey) ?? row;
                      setRule.mutate({ lineKey: target.key, rule: d.rule });
                    });
                    return (
                      <div className="space-y-4">{back}
                        {drafts.map((d, di) => {
                          const rule = d.rule;
                          if (rule.type !== 'auto') return null;
                          const tgt = rowsByKey.get(d.targetKey) ?? row;
                          const BASES: { v: 'prev_month' | 'avg_3m'; label: string; amount: number }[] = [
                            { v: 'prev_month', label: "Previous month's total", amount: tgt.autoPreview?.prevMonth ?? 0 },
                            { v: 'avg_3m', label: "Previous 3 months' average", amount: tgt.autoPreview?.avg3m ?? 0 },
                          ];
                          return (
                          <div key={di} className="relative space-y-4 rounded-lg border border-border p-3">
                            {drafts.length > 1 && <button type="button" aria-label="Remove this entry" onClick={() => removeDraft(di)} className="absolute right-2 top-2 text-muted-foreground hover:text-destructive">✕</button>}
                            <div>
                              <label className="mb-1 block text-xs font-medium text-foreground">Name</label>
                              <input className={inputCls} maxLength={60} value={rule.name ?? ''} placeholder={row.label} onChange={(e) => updateDraft(di, { name: e.target.value })} />
                            </div>
                            {targetSelect(di)}

                            <div className="border-t border-border pt-3">
                              <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground"><Sparkles className="h-4 w-4 text-primary" /> Automation</div>
                              <p className="text-xs text-muted-foreground mb-2">Automatically update this {noun} using the…</p>
                              <div className="space-y-2">
                                {BASES.map((b) => (
                                  <button
                                    key={b.v}
                                    type="button"
                                    onClick={() => updateDraft(di, { basis: b.v })}
                                    className={`flex w-full items-center gap-2 rounded-lg border p-3 text-left text-sm transition-colors ${rule.basis === b.v ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/60'}`}
                                  >
                                    <span className={`flex h-4 w-4 items-center justify-center rounded-full border ${rule.basis === b.v ? 'border-primary' : 'border-muted-foreground'}`}>
                                      {rule.basis === b.v && <span className="h-2 w-2 rounded-full bg-primary" />}
                                    </span>
                                    <span className="flex-1 font-medium text-foreground">{b.label}</span>
                                    <span className="text-muted-foreground tabular-nums">{gbp(b.amount)}</span>
                                  </button>
                                ))}
                              </div>

                              <p className="mt-3 mb-1 text-xs font-medium text-foreground">When does this {noun} occur each month?</p>
                              <div className="flex items-center gap-2">
                                <select
                                  className="rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                                  value={rule.day ?? 1}
                                  onChange={(e) => updateDraft(di, { day: Number(e.target.value) })}
                                >
                                  {Array.from({ length: 28 }, (_, i) => i + 1).map((dd) => <option key={dd} value={dd}>{ordinal(dd)}</option>)}
                                </select>
                                <span className="text-sm text-muted-foreground">of every month</span>
                              </div>

                              <p className="mt-3 mb-1 text-xs font-medium text-foreground">Add an extra amount <span className="font-normal text-muted-foreground">(added on top each month)</span></p>
                              <div className="flex items-center rounded-md border border-border bg-background w-40">
                                <span className="px-3 text-sm text-muted-foreground">£</span>
                                <input inputMode="numeric" className="w-full rounded-r-md bg-transparent px-2 py-2 text-sm focus:outline-none" placeholder="0.00" value={rule.addon ? String(rule.addon) : ''} onChange={(e) => updateDraft(di, { addon: parse(e.target.value) ?? 0 })} />
                              </div>
                              {(rule.addon ?? 0) !== 0 && (
                                <p className="mt-1 text-xs text-muted-foreground">Forecast each month = {gbp((BASES.find((b) => b.v === rule.basis)?.amount ?? 0) + (rule.addon ?? 0))}</p>
                              )}
                            </div>

                            <div className="flex items-start gap-2 rounded-md bg-primary/5 p-3 text-xs text-muted-foreground">
                              <Sparkles className="mt-0.5 h-3.5 w-3.5 text-primary" />
                              <span>If your {changeVerb} changes, the amount will automatically update going forward.</span>
                            </div>
                          </div>
                          );
                        })}
                        {actionFooter({
                          label: `Add auto ${noun}`,
                          addLabel: noun,
                          onSave: saveAll,
                          onRemove: drafts.length === 1 && row.rule?.type === 'auto' ? () => { setRule.mutate({ lineKey: row.key, rule: null }); closeEditor(); } : undefined,
                        })}
                      </div>
                    );
                  })()}

                  {editorMode === 'repeating' && drafts.length > 0 && (() => {
                    const inputCls = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40';
                    // The forecast week a payment date lands in (calendar-date match,
                    // DST-safe). -1 means outside the 13-week window.
                    const wkIdxForStart = (startYmd: string) => weeks.findIndex((wkk) => {
                      const endD = new Date(wkk.weekStart);
                      endD.setDate(endD.getDate() + 6);
                      return startYmd >= wkk.iso && startYmd <= (toLocalIso(endD) ?? wkk.iso);
                    });
                    const validRep = (rule: ForecastRule) => rule.type === 'repeating'
                      && (Number(rule.amount) || 0) > 0 && !!rule.start
                      && (rule.every !== 'none' || wkIdxForStart(rule.start ?? '') >= 0);
                    const isOneOffMode = drafts[0]?.rule.type === 'repeating' && drafts[0].rule.every === 'none';
                    // Save every valid block: one-off ADDS to its target week's existing
                    // amount (single override); a repeat saves a rule to its target line.
                    const saveAll = () => drafts.forEach((d) => {
                      const rule = d.rule;
                      if (rule.type !== 'repeating' || !validRep(rule)) return;
                      const target = rowsByKey.get(d.targetKey) ?? row;
                      if (rule.every === 'none') {
                        const wk = wkIdxForStart(rule.start ?? '');
                        if (wk >= 0) {
                          const existing = Math.round(target.key === 'private' ? privateEffective(wk) : dispVal(target, wk));
                          commitCell(target, weeks[wk], existing + Math.round(Number(rule.amount) || 0));
                        }
                      } else {
                        setRule.mutate({ lineKey: target.key, rule });
                      }
                    });
                    return (
                      <div className="space-y-4">{back}
                        {drafts.map((d, di) => {
                          const rule = d.rule;
                          if (rule.type !== 'repeating') return null;
                          const tgt = rowsByKey.get(d.targetKey) ?? row;
                          const start = rule.start ? new Date(`${rule.start}T00:00:00`) : new Date();
                          const weekday = start.toLocaleDateString('en-GB', { weekday: 'long' });
                          const dom = start.getDate();
                          const ord = dom % 10 === 1 && dom !== 11 ? 'st' : dom % 10 === 2 && dom !== 12 ? 'nd' : dom % 10 === 3 && dom !== 13 ? 'rd' : 'th';
                          const shortD = start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
                          const EVERY: { v: RepeatEvery; label: string }[] = [
                            { v: 'week', label: `Week on ${weekday}` },
                            { v: '2week', label: `2 weeks on ${weekday}` },
                            { v: 'month', label: `Month on the ${dom}${ord}` },
                            { v: '2month', label: `2 months from ${shortD}` },
                            { v: '3month', label: `3 months from ${shortD}` },
                            { v: '6month', label: `6 months from ${shortD}` },
                            { v: 'year', label: `Year from ${shortD}` },
                            { v: 'none', label: "Doesn't repeat" },
                          ];
                          const oneOffWkIdx = wkIdxForStart(rule.start ?? '');
                          return (
                          <div key={di} className="relative space-y-4 rounded-lg border border-border p-3">
                            {drafts.length > 1 && <button type="button" aria-label="Remove this entry" onClick={() => removeDraft(di)} className="absolute right-2 top-2 text-muted-foreground hover:text-destructive">✕</button>}
                            <div>
                              <label className="mb-1 block text-xs font-medium text-foreground">Name</label>
                              <input className={inputCls} maxLength={60} value={rule.name ?? ''} placeholder="e.g. Equipment lease" onChange={(e) => updateDraft(di, { name: e.target.value })} />
                            </div>
                            {targetSelect(di)}
                            <div className="flex gap-3">
                              <div className="relative flex-1">
                                <label className="mb-1 block text-xs font-medium text-foreground">Amount (incl. tax)</label>
                                <div className="flex items-center rounded-md border border-border bg-background">
                                  <span className="px-3 text-sm text-muted-foreground">£</span>
                                  <input
                                    inputMode="numeric"
                                    className="w-full rounded-r-md bg-transparent px-2 py-2 text-sm focus:outline-none"
                                    placeholder="0.00"
                                    value={rule.amount != null ? String(rule.amount) : ''}
                                    onFocus={() => setAmtSuggest(di)}
                                    onBlur={() => setAmtSuggest(null)}
                                    onChange={(e) => updateDraft(di, { amount: parse(e.target.value) ?? undefined })}
                                  />
                                </div>
                                {/* Suggested amounts popover (prevent input blur so a click registers). */}
                                {amtSuggest === di && (tgt.autoPreview?.prevMonth || tgt.autoPreview?.avg3m) ? (
                                  <div className="absolute left-0 top-full z-20 mt-1 w-[260px] rounded-lg border border-border bg-popover p-3 shadow-lg" onMouseDown={(e) => e.preventDefault()}>
                                    <p className="mb-2 text-xs font-medium text-foreground">Suggested amounts</p>
                                    <div className="space-y-1.5 text-sm">
                                      <div className="flex items-center justify-between gap-2">
                                        <span className="text-muted-foreground">Last month's total:</span>
                                        <button type="button" className="rounded px-2 py-0.5 font-medium text-primary hover:bg-primary/5" onClick={() => { updateDraft(di, { amount: tgt.autoPreview?.prevMonth ?? 0 }); setAmtSuggest(null); }}>{gbp(tgt.autoPreview?.prevMonth ?? 0)}</button>
                                      </div>
                                      <div className="flex items-center justify-between gap-2">
                                        <span className="text-muted-foreground">Last 3 months' average:</span>
                                        <button type="button" className="rounded px-2 py-0.5 font-medium text-primary hover:bg-primary/5" onClick={() => { updateDraft(di, { amount: tgt.autoPreview?.avg3m ?? 0 }); setAmtSuggest(null); }}>{gbp(tgt.autoPreview?.avg3m ?? 0)}</button>
                                      </div>
                                    </div>
                                  </div>
                                ) : null}
                              </div>
                              <div className="flex-1">
                                <label className="mb-1 block text-xs font-medium text-foreground">Payment date</label>
                                <input type="date" className={inputCls} value={rule.start ?? ''} onChange={(e) => updateDraft(di, { start: e.target.value })} />
                              </div>
                            </div>

                            <div className="border-t border-border pt-3">
                              <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground"><Repeat className="h-4 w-4 text-primary" /> Repeat schedule</div>
                              <label className="mb-1 block text-xs font-medium text-foreground">Repeats every</label>
                              <select className={inputCls} value={rule.every ?? 'month'} onChange={(e) => updateDraft(di, { every: e.target.value as RepeatEvery })}>
                                {EVERY.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
                              </select>
                            </div>

                            {/* One-off ("Doesn't repeat") adds on top of the target week's
                                existing amount — preview the resulting total. */}
                            {rule.every === 'none' && (() => {
                              if (oneOffWkIdx < 0) return <p className="text-xs text-amber-600">Pick a payment date within the next 13 weeks.</p>;
                              const existing = Math.round(tgt.key === 'private' ? privateEffective(oneOffWkIdx) : dispVal(tgt, oneOffWkIdx));
                              const add = Math.round(Number(rule.amount) || 0);
                              return (
                                <p className="text-xs text-muted-foreground">
                                  Adds to the week of {weeks[oneOffWkIdx].label}: {gbp(existing)} + {gbp(add)} = <span className="font-medium text-foreground">{gbp(existing + add)}</span>
                                </p>
                              );
                            })()}

                            {rule.every !== 'none' && (
                              <div>
                                <label className="mb-1 block text-xs font-medium text-foreground">Ends</label>
                                <div className="space-y-2">
                                  <button type="button" onClick={() => updateDraft(di, { ends: null })} className="flex items-center gap-2 text-sm">
                                    <span className={`flex h-4 w-4 items-center justify-center rounded-full border ${!rule.ends ? 'border-primary' : 'border-muted-foreground'}`}>{!rule.ends && <span className="h-2 w-2 rounded-full bg-primary" />}</span>
                                    <span className={!rule.ends ? 'text-foreground' : 'text-muted-foreground'}>Never</span>
                                  </button>
                                  <div className="flex items-center gap-2">
                                    <button type="button" onClick={() => updateDraft(di, { ends: rule.ends || weeks[weeks.length - 1].iso })} className="flex items-center gap-2 text-sm">
                                      <span className={`flex h-4 w-4 items-center justify-center rounded-full border ${rule.ends ? 'border-primary' : 'border-muted-foreground'}`}>{rule.ends && <span className="h-2 w-2 rounded-full bg-primary" />}</span>
                                      <span className={rule.ends ? 'text-foreground' : 'text-muted-foreground'}>On a specific date</span>
                                    </button>
                                    <input type="date" disabled={!rule.ends} className={`${inputCls} flex-1 disabled:opacity-50`} value={rule.ends ?? ''} onChange={(e) => updateDraft(di, { ends: e.target.value })} />
                                  </div>
                                </div>
                              </div>
                            )}

                            {rule.every !== 'none' && (
                            <div>
                              <label className="flex items-center gap-2 text-sm text-foreground">
                                <input type="checkbox" checked={!!rule.stepKind} onChange={(e) => updateDraft(di, { stepKind: e.target.checked ? (rule.stepKind ?? 'inc_amt') : undefined, stepValue: e.target.checked ? (rule.stepValue ?? 0) : 0 })} />
                                Amount increases/decreases
                              </label>
                              {rule.stepKind && (() => {
                                const isPct = rule.stepKind === 'inc_pct' || rule.stepKind === 'dec_pct';
                                const everyCaption = ({ week: 'Every week', '2week': 'Every 2 weeks', month: 'Every month', '2month': 'Every 2 months', '3month': 'Every 3 months', '6month': 'Every 6 months', year: 'Every year', none: '' } as Record<RepeatEvery, string>)[rule.every ?? 'month'];
                                return (
                                  <div className="mt-2">
                                    <div className="flex items-center gap-2">
                                      <select
                                        className="rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                                        value={rule.stepKind}
                                        onChange={(e) => updateDraft(di, { stepKind: e.target.value as ForecastRule['stepKind'] })}
                                      >
                                        <option value="inc_amt">Increases by £</option>
                                        <option value="dec_amt">Decreases by £</option>
                                        <option value="inc_pct">Increases by %</option>
                                        <option value="dec_pct">Decreases by %</option>
                                      </select>
                                      <div className="flex items-center rounded-md border border-border bg-background">
                                        {!isPct && <span className="px-3 text-sm text-muted-foreground">£</span>}
                                        <input inputMode="numeric" className="w-24 bg-transparent px-2 py-2 text-sm focus:outline-none" placeholder={isPct ? '0' : '0.00'} value={rule.stepValue ? String(rule.stepValue) : ''} onChange={(e) => updateDraft(di, { stepValue: parse(e.target.value) ?? 0 })} />
                                        {isPct && <span className="px-3 text-sm text-muted-foreground">%</span>}
                                      </div>
                                    </div>
                                    {everyCaption && <p className="mt-1 text-xs italic text-muted-foreground">{everyCaption}</p>}
                                  </div>
                                );
                              })()}
                            </div>
                            )}
                          </div>
                          );
                        })}
                        {actionFooter({
                          label: isOneOffMode ? `Add one-off ${noun}` : `Add repeating ${noun}`,
                          addLabel: noun,
                          canSave: drafts.some((d) => validRep(d.rule)),
                          onSave: saveAll,
                          onRemove: drafts.length === 1 && row.rule?.type === 'repeating' ? () => { setRule.mutate({ lineKey: row.key, rule: null }); closeEditor(); } : undefined,
                        })}
                      </div>
                    );
                  })()}

                  {editorMode === 'linked' && drafts.length > 0 && (() => {
                    const inputCls = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40';
                    const validLinked = (rule: ForecastRule) => rule.type === 'linked' && (rule.inputs ?? []).some((i) => i.source && (Number(i.pct) || 0) !== 0);
                    const saveAll = () => drafts.forEach((d) => {
                      if (d.rule.type !== 'linked' || !validLinked(d.rule)) return;
                      const target = rowsByKey.get(d.targetKey) ?? row;
                      setRule.mutate({ lineKey: target.key, rule: d.rule });
                    });
                    return (
                      <div className="space-y-4">{back}
                        {drafts.map((d, di) => {
                          const rule = d.rule;
                          if (rule.type !== 'linked') return null;
                          const inputs = rule.inputs ?? [];
                          const sources = (allRows ?? []).filter((r) => r.key !== d.targetKey);
                          const setInput = (idx: number, patch: Partial<LinkedInput>) =>
                            updateDraft(di, { inputs: inputs.map((inp, k) => (k === idx ? { ...inp, ...patch } : inp)) });
                          // Preview the linked series, bucketed into the first 3 months.
                          const previewWeek = (i: number): number => {
                            const unit = rule.offsetUnit ?? 'days';
                            const raw = rule.offsetEnabled ? (rule.offsetValue ?? 0) : 0;
                            const offW = Math.round(unit === 'weeks' ? raw : unit === 'months' ? raw * 4.345 : raw / 7);
                            const srcIdx = i - (rule.offsetDir === 'before' ? -offW : offW);
                            if (srcIdx < 0 || srcIdx >= weeks.length) return 0;
                            return Math.round(inputs.reduce((s, inp) => {
                              const src = rowsByKey.get(inp.source);
                              return src ? s + (dispVal(src, srcIdx) * (Number(inp.pct) || 0)) / 100 : s;
                            }, 0));
                          };
                          const byMonth = new Map<string, number>();
                          weeks.forEach((wk, i) => {
                            const key = wk.weekStart.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
                            byMonth.set(key, (byMonth.get(key) ?? 0) + previewWeek(i));
                          });
                          const preview3 = [...byMonth.entries()].slice(0, 3);
                          return (
                          <div key={di} className="relative space-y-4 rounded-lg border border-border p-3">
                            {drafts.length > 1 && <button type="button" aria-label="Remove this entry" onClick={() => removeDraft(di)} className="absolute right-2 top-2 text-muted-foreground hover:text-destructive">✕</button>}
                            <div>
                              <label className="mb-1 block text-xs font-medium text-foreground">Name</label>
                              <input className={inputCls} maxLength={60} value={rule.name ?? ''} placeholder={row.label} onChange={(e) => updateDraft(di, { name: e.target.value })} />
                            </div>
                            {targetSelect(di)}

                            <div className="border-t border-border pt-3">
                              <div className="mb-2 flex items-center justify-between">
                                <div className="flex items-center gap-2 text-sm font-medium text-foreground"><Link2 className="h-4 w-4 text-primary" /> Input</div>
                                <button type="button" onClick={() => updateDraft(di, { inputs: [...inputs, { pct: 0, source: '' }] })} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-primary hover:bg-primary/5"><Plus className="h-3 w-3" /> Add input</button>
                              </div>
                              <div className="space-y-2">
                                {inputs.map((inp, idx) => (
                                  <div key={idx} className="flex items-center gap-1.5">
                                    <input inputMode="numeric" className="w-14 rounded-md border border-border bg-background px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" placeholder="0" value={inp.pct ? String(inp.pct) : ''} onChange={(e) => setInput(idx, { pct: parse(e.target.value) ?? 0 })} />
                                    <span className="rounded-md border border-border bg-muted px-2 py-2 text-sm text-muted-foreground">%</span>
                                    <span className="text-xs text-muted-foreground">of</span>
                                    <select className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" value={inp.source} onChange={(e) => setInput(idx, { source: e.target.value })}>
                                      <option value="">Select a line…</option>
                                      {sources.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                                    </select>
                                    <button type="button" aria-label="Remove input" className="shrink-0 text-muted-foreground hover:text-destructive" onClick={() => updateDraft(di, { inputs: inputs.filter((_, k) => k !== idx) })}><Trash2 className="h-4 w-4" /></button>
                                  </div>
                                ))}
                              </div>
                            </div>

                            <div className="border-t border-border pt-3">
                              <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground"><Link2 className="h-4 w-4 text-primary" /> Output</div>
                              <label className="flex items-center gap-2 text-sm text-foreground">
                                <input type="checkbox" checked={!!rule.offsetEnabled} onChange={(e) => updateDraft(di, { offsetEnabled: e.target.checked })} />
                                Offset dates by…
                              </label>
                              {rule.offsetEnabled && (
                                <div className="mt-2 flex items-center gap-2">
                                  <input inputMode="numeric" className="w-16 rounded-md border border-border bg-background px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" placeholder="0" value={rule.offsetValue ? String(rule.offsetValue) : ''} onChange={(e) => updateDraft(di, { offsetValue: parse(e.target.value) ?? 0 })} />
                                  <select className="rounded-md border border-border bg-background px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" value={rule.offsetUnit ?? 'days'} onChange={(e) => updateDraft(di, { offsetUnit: e.target.value as ForecastRule['offsetUnit'] })}>
                                    <option value="days">Days</option>
                                    <option value="weeks">Weeks</option>
                                    <option value="months">Months</option>
                                  </select>
                                  <select className="rounded-md border border-border bg-background px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" value={rule.offsetDir ?? 'after'} onChange={(e) => updateDraft(di, { offsetDir: e.target.value as ForecastRule['offsetDir'] })}>
                                    <option value="after">After</option>
                                    <option value="before">Before</option>
                                  </select>
                                </div>
                              )}
                            </div>

                            <div className="rounded-lg bg-muted/40 p-3">
                              <p className="mb-2 text-sm font-medium text-foreground">Preview of the first 3 months</p>
                              <div className="space-y-1.5 text-sm">
                                {preview3.map(([m, v]) => (
                                  <div key={m} className="flex items-center justify-between">
                                    <span className="text-muted-foreground">{m}</span>
                                    <span className="tabular-nums text-foreground">{gbp(v)}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                          );
                        })}
                        {actionFooter({
                          label: `Add linked ${noun}`,
                          addLabel: noun,
                          canSave: drafts.some((d) => validLinked(d.rule)),
                          onSave: saveAll,
                          onRemove: drafts.length === 1 && row.rule?.type === 'linked' ? () => { setRule.mutate({ lineKey: row.key, rule: null }); closeEditor(); } : undefined,
                        })}
                      </div>
                    );
                  })()}
                </div>
              </>
            );
          })()}
        </SheetContent>
      </Sheet>

      {/* ── Per-cell comment drawer (opens on clicking a forecast amount) ── */}
      <Sheet open={!!commentCell} onOpenChange={(o) => { if (!o) closeComment(); }}>
        <SheetContent side="right" className="w-full sm:max-w-[400px]">
          {commentCell && (() => {
            const { row, weekIndex } = commentCell;
            const w = weeks[weekIndex];
            const thread = comments.get(commentKey(row.key, weekIndex)) ?? [];
            const isOverridden = row.overridden[weekIndex] ?? false;
            const parseAmt = (s: string): number | null => {
              const raw = s.replace(/[£,\s]/g, '').trim();
              if (raw === '') return null;
              const n = Number(raw);
              return Number.isFinite(n) ? n : null;
            };
            const fmtWhen = (iso: string) => {
              const d = new Date(iso);
              return Number.isNaN(d.getTime())
                ? ''
                : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
            };
            const saveAmount = () => {
              // Persist the amount as a per-cell override (null clears it back to
              // the computed forecast), then close.
              const parsed = parseAmt(amountDraft);
              const cur = row.key === 'private' ? privateEffective(weekIndex) : dispVal(row, weekIndex);
              if (parsed === null) {
                if (isOverridden) commitCell(row, w, null); // blanked → revert to computed
              } else if (!isOverridden || parsed !== Math.round(cur * 100) / 100) {
                commitCell(row, w, parsed);
              }
              closeComment();
            };
            const resetAmount = () => {
              commitCell(row, w, null);
              setAmountDraft(editAmount(row.baseline[weekIndex] ?? 0)); // keep pence
            };
            // Append a new comment to the thread; keep the drawer open so it shows.
            const postComment = () => {
              const text = commentDraft.trim();
              if (!text) return;
              addComment.mutate({ weekStart: w.iso, lineKey: row.key, text });
              setCommentDraft('');
            };
            return (
              <>
                <SheetHeader>
                  <SheetTitle>{row.label}</SheetTitle>
                  <SheetDescription>Week of {w.label} · {gbpPence(row.key === 'private' ? privateEffective(weekIndex) : dispVal(row, weekIndex))}{isOverridden ? ' · edited' : ''}</SheetDescription>
                </SheetHeader>
                <div className="mt-5 space-y-5 overflow-y-auto">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Forecast amount</label>
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">£</span>
                        <input
                          autoFocus
                          type="text"
                          inputMode="decimal"
                          value={amountDraft}
                          onChange={(e) => setAmountDraft(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') saveAmount(); }}
                          className="w-full rounded-md border border-border bg-background pl-7 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                        />
                      </div>
                      {isOverridden && (
                        <button type="button" onClick={resetAmount} className="whitespace-nowrap rounded-md border border-border px-3 py-2 text-xs hover:bg-muted">Reset to forecast</button>
                      )}
                      <button type="button" onClick={saveAmount} className="whitespace-nowrap rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90">Save</button>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {isOverridden ? 'Manually overridden.' : 'Computed forecast.'} Saving a number replaces the computed amount for this week.
                    </p>
                  </div>

                  {/* Comment thread — every comment from this organisation's users. */}
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      Comments{thread.length > 0 ? ` (${thread.length})` : ''}
                    </label>
                    <div className="max-h-64 space-y-2 overflow-y-auto">
                      {thread.length === 0 && <p className="text-xs text-muted-foreground">No comments yet.</p>}
                      {thread.map((c) => (
                        <div key={c.id} className="rounded-md border border-border bg-muted/30 px-3 py-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-medium text-foreground">{c.authorName}</span>
                            <span className="text-[11px] text-muted-foreground">{fmtWhen(c.createdAt)}</span>
                          </div>
                          <p className="mt-1 whitespace-pre-wrap break-words text-sm">{c.text}</p>
                          {c.isOwn && (
                            <button type="button" onClick={() => deleteComment.mutate({ id: c.id })} className="mt-1 text-[11px] text-destructive hover:underline">Delete</button>
                          )}
                        </div>
                      ))}
                    </div>
                    <textarea
                      rows={3}
                      value={commentDraft}
                      onChange={(e) => setCommentDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); postComment(); } }}
                      placeholder="Add a comment… (Enter to post, Shift+Enter for a new line)"
                      className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                    />
                    <button type="button" onClick={postComment} disabled={!commentDraft.trim()} className="mt-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">Add comment</button>
                  </div>

                  <div className="flex gap-2 border-t border-border pt-4">
                    <button type="button" onClick={closeComment} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted">Close</button>
                  </div>
                </div>
              </>
            );
          })()}
        </SheetContent>
      </Sheet>

      {/* Forecast generation settings (per-location assumptions + scenario preset). */}
      <ForecastSettingsSheet
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={forecastSettings}
        saving={forecastSettingsSaving}
        scopeLabel={scopeLabel}
        weekOptions={weeks.map((w) => ({ weekNumber: w.weekNumber, label: w.label, iso: w.iso }))}
        locations={(allAvailableLocations ?? []).map((l) => ({ id: l.id, name: l.location_name }))}
        membershipPlans={membershipPlans}
        incomeTrailing={privateTrailing}
        incomeForecast={weeks.map((_, i) => privateEffective(i))}
        costAccounts={Array.from(new Set([...outflowCostRows, ...outflowExpenseRows].map((r) => r.label))).filter(Boolean)}
        groupScope={!selectedLocationId}
        onSave={(next) => { saveForecastSettings(next); setSettingsOpen(false); }}
        onReset={() => { resetForecastSettings(); setSettingsOpen(false); }}
      />
    </MainLayout>
  );
}
