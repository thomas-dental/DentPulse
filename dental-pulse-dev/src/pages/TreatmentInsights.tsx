import { useState, useMemo } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { MainLayout } from '@/components/layout/MainLayout';
import { MetricHelp } from '@/components/dashboard/MetricHelp';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Line, Area, ComposedChart } from 'recharts';
import { TrendingUp, AlertTriangle, Target, Lightbulb, Loader2, Info, ExternalLink, Banknote, Stethoscope, Users } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useTreatmentInsights } from '@/hooks/useTreatmentInsights';
import type { InsightAlert } from '@/hooks/useTreatmentInsights';
import { DateBasisToggle } from '@/components/treatments/DateBasisToggle';
import type { TreatmentDateBasis } from '@/lib/paidDateBasis';
import { useFilters } from '@/contexts/FilterContext';
import { Calendar } from 'lucide-react';
import { useProfitMetrics } from '@/hooks/useProfitMetrics';
import { useAllProvidersNetProduction } from '@/hooks/useAllProvidersNetProduction';
import { useAllProvidersWorkingHours } from '@/hooks/useAllProvidersWorkingHours';
import { useTreatmentProfitPlanning } from '@/hooks/useTreatmentProfitPlanning';
import { useAssociatePerformanceMetrics } from '@/hooks/useAssociatePerformanceMetrics';
import { useOrganization } from '@/hooks/useOrganization';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { resolveBusinessInfoLocationId } from '@/lib/businessInfoLocation';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { DatePicker, ConfigProvider } from 'antd';
import dayjs from 'dayjs';
import { format, startOfMonth, endOfMonth, startOfQuarter, endOfQuarter, startOfYear, endOfYear, subMonths, subQuarters, subYears } from 'date-fns';
import { useOrganizationSettings } from '@/hooks/useOrganizationSettings';
import { formatCurrency as formatCurrencyBase } from '@/lib/currency';

type ProfitDateFilterOption = 'this-month' | 'this-quarter' | 'this-year' | 'last-month' | 'last-quarter' | 'last-year' | 'custom';

// Plain whole-pound formatter used only as formatCompact's fallback for sub-£1k amounts.
function formatCurrencyPlain(amount: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatCompact(amount: number): string {
  if (amount >= 1_000_000) return `£${(amount / 1_000_000).toFixed(2)}M`;
  if (amount >= 1_000) return `£${(amount / 1_000).toFixed(2)}k`;
  return formatCurrencyPlain(amount);
}

// Short category code for vertical-chart x-axis labels (pro style: "Exam &
// Diagnosis" → ED). Falls back to the first three letters for single words.
function abbreviateCategory(name: string): string {
  const words = String(name)
    .split(/[\s/&-]+/)
    .filter((w) => w && !/^(and|of|the)$/i.test(w));
  const abbr = words.map((w) => w[0]?.toUpperCase() ?? '').join('');
  return abbr.length > 1 ? abbr.slice(0, 4) : String(name).slice(0, 3).toUpperCase();
}

// Donut chart colors: Private=teal, NHS=amber
const DONUT_COLORS = ['#14b8a6', '#f59e0b'];

const RANK_COLORS: Record<number, string> = {
  1: 'bg-amber-500',
  2: 'bg-emerald-500',
  3: 'bg-red-500',
};

const RANK_SUFFIXES: Record<number, string> = {
  1: 'st',
  2: 'nd',
  3: 'rd',
};

function RankBadge({ rank }: { rank: number }) {
  const bg = RANK_COLORS[rank] || 'bg-gray-400';
  const suffix = RANK_SUFFIXES[rank] || 'th';
  return (
    <span className={cn('inline-flex items-center justify-center w-8 h-8 rounded-full text-white text-xs font-bold', bg)}>
      {rank}<sup className="text-[8px] ml-px">{suffix}</sup>
    </span>
  );
}

function AlertBanner({ alert }: { alert: InsightAlert }) {
  const config = {
    warning: {
      badgeBg: 'bg-amber-500',
      badgeText: 'text-white',
    },
    positive: {
      badgeBg: 'bg-emerald-500',
      badgeText: 'text-white',
    },
    info: {
      badgeBg: 'bg-gray-200 dark:bg-gray-700',
      badgeText: 'text-gray-700 dark:text-gray-300',
    },
  };

  const c = config[alert.type];

  return (
    <Card className="flex-1">
      <CardContent className="py-4 px-5">
        <div className="flex items-center gap-3">
          <span className={cn('inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap', c.badgeBg, c.badgeText)}>
            {alert.title}
          </span>
          <span className="text-sm text-muted-foreground truncate">{alert.message}</span>
          {alert.actionLabel && (
            <button className="text-sm font-medium text-foreground underline underline-offset-2 whitespace-nowrap ml-auto hover:text-primary">
              {alert.actionLabel}
            </button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function TrendIndicator({ value, label, help }: { value: number; label?: string; help?: string }) {
  if (!value || value === 0) return <span className="text-sm text-muted-foreground">--</span>;
  const isUp = value > 0;
  return (
    <span className={cn('inline-flex items-center gap-1 text-sm', isUp ? 'text-emerald-600' : 'text-red-500')}>
      <span className="text-base">{isUp ? '↗' : '↘'}</span>
      <span className="font-medium">{isUp ? '+' : ''}{Math.round(value)}%</span>
      {label && <span className="text-muted-foreground font-normal">{label}</span>}
      {help && (
        <span onClick={(e) => e.stopPropagation()}>
          <MetricHelp title="vs prev period">{help}</MetricHelp>
        </span>
      )}
    </span>
  );
}

// Custom legend for the donut chart matching the screenshot
function DonutLegend({ data }: { data: { name: string; value: number; color: string }[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 mt-4">
      {data.map((entry) => {
        const pct = total > 0 ? ((entry.value / total) * 100).toFixed(2) : '0.00';
        return (
          <div key={entry.name} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: entry.color }} />
            <span className="text-xs text-muted-foreground truncate max-w-[100px]" title={entry.name}>{entry.name}</span>
            <span className="text-xs font-semibold">{pct}%</span>
          </div>
        );
      })}
    </div>
  );
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function getProfitDateRange(
  filter: ProfitDateFilterOption,
  customRange: { from: Date | null; to: Date | null },
) {
  const now = new Date();
  if (filter === 'custom' && customRange.from && customRange.to) {
    return { startDate: customRange.from, endDate: customRange.to };
  }
  switch (filter) {
    case 'this-month':
      return { startDate: startOfMonth(now), endDate: endOfMonth(now) };
    case 'this-quarter':
      return { startDate: startOfQuarter(now), endDate: endOfQuarter(now) };
    case 'this-year':
      return { startDate: startOfYear(now), endDate: endOfYear(now) };
    case 'last-month': {
      const d = subMonths(now, 1);
      return { startDate: startOfMonth(d), endDate: endOfMonth(d) };
    }
    case 'last-quarter': {
      const d = subQuarters(now, 1);
      return { startDate: startOfQuarter(d), endDate: endOfQuarter(d) };
    }
    case 'last-year': {
      const d = subYears(now, 1);
      return { startDate: startOfYear(d), endDate: endOfYear(d) };
    }
    default:
      return { startDate: startOfMonth(now), endDate: endOfMonth(now) };
  }
}

export default function TreatmentInsights() {
  const { showDecimals } = useOrganizationSettings();
  const formatCurrency = (amount: number) => formatCurrencyBase(amount, showDecimals);
  // Overview tile numbers always show whole pounds, regardless of the Show Decimals setting.
  const formatCurrencyWhole = (amount: number) => formatCurrencyBase(amount, false);
  // Monthly Revenue Trend datepicker — when set, only that chart re-windows;
  // everything else stays on the page's global filter range.
  const [trendCustomRange, setTrendCustomRange] = useState<{ from: Date | null; to: Date | null }>({ from: null, to: null });
  // Completed on / Paid on — mirrors the Date dropdown on Dentally's
  // Practitioner Activity report. On the paid basis every TPI-derived figure
  // (tiles + charts) is dated by its invoice's paid day instead of the
  // completion day.
  const [dateBasis, setDateBasis] = useState<TreatmentDateBasis>('completed');
  const paidBasis = dateBasis === 'paid';
  const {
    summary,
    revenueByCategory,
    treatmentMix,
    monthlyTrend,
    topTreatments,
    alerts,
    isLoading,
    isPipelineLoading: chartsLoading,
    isTrendLoading,
    currentItems,
  } = useTreatmentInsights(
    trendCustomRange.from && trendCustomRange.to
      ? { start: trendCustomRange.from, end: trendCustomRange.to }
      : null,
    dateBasis,
  );
  const { dateRange, selectedLocationId } = useFilters();
  const { organizationId } = useOrganization();

  // ── Total Revenue tile + Income-by-payer boxes source ────────────────────
  // ONE Net Production fetch per period (get_provider_net_production_monthly,
  // the same source as the Provider Insights "Provider History" tab) serves
  // both:
  //  - The Total Revenue TILE sums each provider's RAW `totalRaw` (the RPC's
  //    own total_amount = unconditional SUM(tpi_price)) — reconciles to the
  //    penny with Dentally's Practitioner Activity export. Do NOT switch this
  //    back to `totalPrivate + totalMembership + totalNhsRaw`: that recomposed
  //    sum UNDERCOUNTS whenever revenue isn't on a payment plan in the org's
  //    configured private vocabulary AND isn't backed by an NHS/membership
  //    accounting mapping — found 2026-08-11 on Hilton Dental Practice (no
  //    NHS/membership accounts configured at all): tile read £162,512.15 vs
  //    Dentally's £180,397.98, a £17,885.83 shortfall exactly equal to the
  //    unclassified TPI revenue. (Old Surgery, verified 2026-08-04, happened
  //    to have 100% of its revenue classified as private, which is why the
  //    old recomposed sum looked correct there: £1,687,868.69 vs export
  //    £1,687,868.68.)
  //  - The Private / NHS / Membership BOXES use the overlay-applied figures —
  //    identical logic to the Provider Insights revenue-breakdown popover
  //    (NHS becomes UDA rate × delivered counts when the practice's NHS
  //    income source is DentPulse). When that overlay is active, the three
  //    boxes intentionally sum ABOVE the Dentally-matched tile — and even at
  //    baseline they need not sum to the tile if some revenue is unclassified.
  const periodMsForProduction = dateRange.endDate.getTime() - dateRange.startDate.getTime();
  const prevProductionStart = new Date(dateRange.startDate.getTime() - periodMsForProduction);
  const prevProductionEnd = new Date(dateRange.startDate.getTime() - 1);
  const { data: allNetProduction, isLoading: netProductionLoading } = useAllProvidersNetProduction(
    null,
    dateRange.startDate,
    dateRange.endDate,
    selectedLocationId,
  );
  const { data: prevAllNetProduction } = useAllProvidersNetProduction(
    null,
    prevProductionStart,
    prevProductionEnd,
    selectedLocationId,
    null,
    true,
    allNetProduction != null, // serialize: don't stack both RPC sweeps at once
  );
  const sumRaw = (rows: typeof allNetProduction) =>
    (rows?.providers ?? []).reduce((s, p) => s + p.totalRaw, 0);
  const netProductionTotal = useMemo(() => sumRaw(allNetProduction), [allNetProduction]);
  const prevNetProductionTotal = useMemo(() => sumRaw(prevAllNetProduction), [prevAllNetProduction]);
  const netProductionTrend =
    prevNetProductionTotal > 0
      ? Math.round(((netProductionTotal - prevNetProductionTotal) / prevNetProductionTotal) * 1000) / 10
      : 0;

  // ── Income by payer type — IDENTICAL logic to the Provider Insights
  // revenue-breakdown popover ("By treatment" view): Private = treatment
  // revenue on mapped private plans; Membership / NHS = the provider's mapped
  // accounting income accounts, with NHS replaced by the DentPulse UDA
  // overlay when configured. totalNhs here is the overlay-applied figure. ──
  const incomeByPayorCards = useMemo(() => {
    const sum = (
      rows: typeof allNetProduction,
      sel: (p: { totalPrivate: number; totalMembership: number; totalNhs: number }) => number,
    ) => (rows?.providers ?? []).reduce((s, p) => s + sel(p), 0);
    const pct = (c: number, p: number) => (p > 0 ? Math.round(((c - p) / p) * 1000) / 10 : 0);
    const mk = (
      title: string,
      sel: (p: { totalPrivate: number; totalMembership: number; totalNhs: number }) => number,
      icon: any,
      iconBg: string,
      iconColor: string,
    ) => {
      const curr = sum(allNetProduction, sel);
      const prev = sum(prevAllNetProduction, sel);
      return { title, amount: curr, value: formatCurrencyWhole(curr), trend: pct(curr, prev), icon, iconBg, iconColor };
    };
    return [
      mk('Private Income', (p) => p.totalPrivate, Banknote, 'bg-indigo-100 dark:bg-indigo-900/40', 'text-indigo-600 dark:text-indigo-400'),
      mk('NHS Income', (p) => p.totalNhs, Stethoscope, 'bg-sky-100 dark:bg-sky-900/40', 'text-sky-600 dark:text-sky-400'),
      mk('Membership Plan Income', (p) => p.totalMembership, Users, 'bg-rose-100 dark:bg-rose-900/40', 'text-rose-600 dark:text-rose-400'),
    ];
  }, [allNetProduction, prevAllNetProduction]);

  // ── Monthly Revenue Trend: NHS series from the Providers module ──────────
  // The TPI pipeline prices NHS items at £0, so the chart's NHS line is fed
  // from Net Production's monthly NHS instead (provider's mapped NHS accounts
  // / DentPulse UDA overlay — the same figures as the Providers module and
  // the NHS Income box). When the chart's own datepicker is set, a dedicated
  // Net Production fetch covers that window.
  const { data: trendNetProduction } = useAllProvidersNetProduction(
    null,
    trendCustomRange.from ?? dateRange.startDate,
    trendCustomRange.to ?? dateRange.endDate,
    selectedLocationId,
    null,
    true,
    !!(trendCustomRange.from && trendCustomRange.to), // only fetched while the picker is active
  );
  const nhsByMonthKey = useMemo(() => {
    const MONTH_NUM: Record<string, string> = {
      jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
      jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
    };
    const src = trendCustomRange.from && trendCustomRange.to ? trendNetProduction : allNetProduction;
    const map = new Map<string, number>();
    for (const p of src?.providers ?? []) {
      for (const [label, cell] of Object.entries(p.monthlyData)) {
        // labels are 'Mon-YY' (e.g. 'Jul-26') → '2026-07'
        const mm = MONTH_NUM[label.slice(0, 3).toLowerCase()];
        const yy = label.slice(4, 6);
        if (!mm || yy.length !== 2) continue;
        const key = `20${yy}-${mm}`;
        map.set(key, (map.get(key) || 0) + (cell.nhs || 0));
      }
    }
    return map;
  }, [allNetProduction, trendNetProduction, trendCustomRange]);
  const monthlyTrendDisplay = useMemo(
    () => monthlyTrend.map((r) => ({ ...r, nhs: nhsByMonthKey.get(r.monthKey) ?? 0 })),
    [monthlyTrend, nhsByMonthKey],
  );

  // ── Total Hours tile source ────────────────────────────────────────────
  // Appointment-based working hours (appointment_summary org-wide /
  // get_provider_working_hours_by_location per site) — the same source as the
  // Provider Insights "Total Hours" card, i.e. hours as per the Appointments
  // report, NOT TPI treatment durations. providerType null = all providers in
  // a single query.
  const { data: allWorkingHours, isLoading: workingHoursLoading } = useAllProvidersWorkingHours(
    null,
    dateRange.startDate,
    dateRange.endDate,
    selectedLocationId,
  );
  const { data: prevAllWorkingHours } = useAllProvidersWorkingHours(
    null,
    prevProductionStart,
    prevProductionEnd,
    selectedLocationId,
  );
  const workingHoursTotal = useMemo(
    () =>
      Math.round(
        (allWorkingHours?.providers ?? []).reduce((s, p) => s + p.total, 0) * 10,
      ) / 10,
    [allWorkingHours],
  );
  const prevWorkingHoursTotal = useMemo(
    () => (prevAllWorkingHours?.providers ?? []).reduce((s, p) => s + p.total, 0),
    [prevAllWorkingHours],
  );
  const workingHoursTrend =
    prevWorkingHoursTotal > 0
      ? Math.round(((workingHoursTotal - prevWorkingHoursTotal) / prevWorkingHoursTotal) * 1000) / 10
      : 0;

  // Deep link into Dentally's Practitioner Activity report. Sent without
  // query params per product decision — Dentally's web UI ignores
  // start_date/end_date params anyway and a bare URL keeps the address bar
  // clean. The user applies the date range / site filter inside Dentally.
  const dentallyPractitionerActivityUrl = 'https://app.dentally.co/reports/practitioner_activity';

  const openDentallyPractitionerActivity = () => {
    window.open(dentallyPractitionerActivityUrl, '_blank', 'noopener,noreferrer');
  };

  // Profit chart state
  const [profitDateFilter, setProfitDateFilter] = useState<ProfitDateFilterOption>('this-month');
  const [profitCustomRange, setProfitCustomRange] = useState<{ from: Date | null; to: Date | null }>({ from: null, to: null });
  const [showProfitModal, setShowProfitModal] = useState(false);
  const [profitDropdownOpen, setProfitDropdownOpen] = useState(false);
  const [profitPage, setProfitPage] = useState(1);
  const [profitPageSize, setProfitPageSize] = useState(5);

  const profitDateRange = useMemo(
    () => getProfitDateRange(profitDateFilter, profitCustomRange),
    [profitDateFilter, profitCustomRange],
  );

  const { data: rawProfitMetrics, isLoading: isLoadingProfit } = useProfitMetrics({
    startDate: profitDateRange.startDate,
    endDate: profitDateRange.endDate,
    organizationId: organizationId || '',
    locationId: selectedLocationId,
  });

  // Production for the Profit section = the SAME figure as Providers → Dentist Net
  // Production (get_provider_net_production_monthly): charting excluded, Europe/London
  // dates, per the provider's Income Settings. The profit RPC already computes profit
  // from this net production, so displaying it here makes the popover reconcile and
  // the two screens agree. Keyed by provider name to match profitMetrics rows.
  const { data: netProduction } = useAllProvidersNetProduction(
    null,
    profitDateRange.startDate,
    profitDateRange.endDate,
    selectedLocationId,
  );
  const netProdByName = useMemo(
    () => new Map((netProduction?.providers ?? []).map((p) => [p.providerName, p.total])),
    [netProduction],
  );

  // Fetch location cost settings used in the profit formula (shown in the info popover too).
  // Business Settings live per-location — scope by the top-bar location filter,
  // falling back to the org's primary location when "All Locations" is selected.
  const { data: orgSettings } = useQuery({
    queryKey: ['org-lab-cost-settings', organizationId, selectedLocationId],
    queryFn: async () => {
      if (!organizationId) return null;
      const locationId = await resolveBusinessInfoLocationId(organizationId, selectedLocationId);
      if (!locationId) return null;
      const { data } = await (supabase as any)
        .from('practice_locations')
        .select('associate_cost_labs_percent, practice_cost_materials_percent, number_of_surgeries')
        .eq('id', locationId)
        .single();
      return data as {
        associate_cost_labs_percent: number | null;
        practice_cost_materials_percent: number | null;
        number_of_surgeries: number | null;
      } | null;
    },
    enabled: !!organizationId,
    staleTime: 1000 * 60 * 10,
  });

  // Fetch provider split percentages + location_id so we can filter out providers
  // that belong to a different location when the top-bar location filter is active.
  // The RPCs scope production/hours by location but not the provider list itself,
  // which lets cross-location providers leak in.
  // NOTE: previously also selected `pt_id`, which does NOT exist on `providers` — that
  // made the whole query error, leaving splits empty so every provider fell back to the
  // 30% default (Associate Net Pay was wrong for everyone). Removed.
  const { data: providerSplits } = useQuery({
    queryKey: ['provider-splits', organizationId],
    queryFn: async () => {
      if (!organizationId) return [];
      const { data } = await (supabase as any)
        .from('providers')
        .select('id, location_id, associate_split_percentage, lab_split_percentage, split_source_method, lab_split_percentage_sliding')
        .eq('organization_id', organizationId)
        .is('deleted_at', null);
      return (data ?? []) as Array<{
        id: string;
        location_id: string | null;
        associate_split_percentage: number | null;
        lab_split_percentage: number | null;
        split_source_method: string | null;
        lab_split_percentage_sliding: number | null;
      }>;
    },
    enabled: !!organizationId,
    staleTime: 1000 * 60 * 10,
  });

  // providerId → location_id lookup for client-side scoping.
  const providerLocationById = useMemo(
    () => new Map((providerSplits ?? []).map((p) => [p.id, p.location_id])),
    [providerSplits],
  );

  // Client-side provider location filter (matches the one on assocPerfMetrics
  // below). The RPC only scopes production/hours by location, not the
  // provider list, so cross-location practitioners can otherwise leak in.
  // Exposed as `profitMetrics` so every downstream consumer inherits the
  // filter automatically.
  const profitMetrics = useMemo(() => {
    if (!selectedLocationId || !rawProfitMetrics) return rawProfitMetrics ?? [];
    return rawProfitMetrics.filter((m) => {
      const loc = providerLocationById.get(m.provider_id);
      return !loc || loc === selectedLocationId;
    });
  }, [rawProfitMetrics, selectedLocationId, providerLocationById]);

  // Calculate Associate Net Pay per provider
  // Formula: (Production × Assoc Split %) - (Production × Lab Cost % × Lab Split %)
  const associateNetPayMap = useMemo(() => {
    const map = new Map<string, number>();
    if (!profitMetrics || !orgSettings || !providerSplits) return map;

    const labCostPct = orgSettings.associate_cost_labs_percent ?? 0;
    const splitById = new Map(providerSplits.map(p => [p.id, p]));

    for (const pm of profitMetrics) {
      const production = netProdByName.get(pm.provider_name) ?? 0;
      const splits = splitById.get(pm.provider_id);
      // Mirror the Providers module's Associate Net Pay exactly (ProvidersManagement.tsx
      // ~L1276-1288): same net production, same split fields, plain lab_split_percentage
      // (NOT the sliding-scale variant), and `|| default` so a 0 falls back like there.
      const assocSplitPct = splits?.associate_split_percentage || 30;
      const labSplitPct = splits?.lab_split_percentage || 50;

      const assocGross = production * (assocSplitPct / 100);
      const labDeduction = production * (labCostPct / 100) * (labSplitPct / 100);
      const netPay = assocGross - labDeduction;
      map.set(pm.provider_id, Math.round(netPay * 100) / 100);
    }
    return map;
  }, [profitMetrics, netProdByName, orgSettings, providerSplits]);

  const totalPeriodicProfit = (profitMetrics || []).reduce((s, m) => s + m.periodic_profit, 0);
  const totalPlPerDay = (profitMetrics || []).reduce((s, m) => s + m.pl_per_day, 0);

  // Per-practitioner breakdown for the info popover. Each row applies the
  // profit formula (Production − AssocNetPay − Lab − Materials − OCPSPD = Profit).
  // OCPSPD is now computed per-practitioner from the Treatment Setup values
  // (treatments.hourly_rate × duration_minutes / 60) summed across completed
  // TPIs — so it reflects the rates the user sets per treatment, not a flat
  // org-wide allocation. Profit is recomputed here from those inputs; this
  // may differ from the chart's RPC profit until the RPC is updated to use
  // the same per-treatment OCPSPD.
  const profitBreakdown = useMemo(() => {
    const labCostPct = orgSettings?.associate_cost_labs_percent ?? 0;
    const materialsPct = orgSettings?.practice_cost_materials_percent ?? 0;

    const rows = (profitMetrics || []).map((pm) => {
      const production = netProdByName.get(pm.provider_name) ?? 0;
      const assocNetPay = associateNetPayMap.get(pm.provider_id) ?? 0;
      const labCosts = production * (labCostPct / 100);
      const materials = production * (materialsPct / 100);
      // Profit is the RPC's periodic_profit — the exact value the chart plots, and the
      // source of truth. OCPSPD is derived as the RESIDUAL so every breakdown row always
      // reconciles: Production − AssocNetPay − Lab − Materials − OCPSPD = Profit.
      //
      // Previously OCPSPD came from a per-treatment query that returned 0 for every
      // practitioner, so the popover showed OCPSPD £0.00 while the RPC profit had already
      // subtracted a real OCPSPD — the columns didn't sum to the profit shown. Deriving
      // OCPSPD from the profit (like the Provider page keeps its OCPSPD self-consistent)
      // makes the cell honest without changing any profit figure.
      const profit = pm.periodic_profit;
      const ocpspd = production - assocNetPay - labCosts - materials - profit;
      return {
        providerId: pm.provider_id,
        providerName: pm.provider_name,
        production,
        assocNetPay,
        labCosts,
        materials,
        ocpspd,
        profit,
      };
    });

    const totalProduction = rows.reduce((s, r) => s + r.production, 0);
    const totalAssocNetPay = rows.reduce((s, r) => s + r.assocNetPay, 0);
    const totalLabCosts = rows.reduce((s, r) => s + r.labCosts, 0);
    const totalMaterials = rows.reduce((s, r) => s + r.materials, 0);
    const totalOCPSPD = rows.reduce((s, r) => s + r.ocpspd, 0);
    const totalProfit = rows.reduce((s, r) => s + r.profit, 0);

    return {
      rows,
      totalProduction,
      totalAssocNetPay,
      totalLabCosts,
      totalMaterials,
      totalOCPSPD,
      totalProfit,
      totalRpcProfit: totalPeriodicProfit,
      labCostPct,
      materialsPct,
    };
  }, [profitMetrics, netProdByName, associateNetPayMap, orgSettings, totalPeriodicProfit]);
  const profitTotalPages = Math.ceil((profitMetrics || []).length / profitPageSize);
  const profitPagedData = (profitMetrics || []).slice((profitPage - 1) * profitPageSize, profitPage * profitPageSize);

  // Associate Performance chart state
  const [perfDateFilter, setPerfDateFilter] = useState<ProfitDateFilterOption>('this-month');
  const [perfCustomRange, setPerfCustomRange] = useState<{ from: Date | null; to: Date | null }>({ from: null, to: null });
  const [showPerfModal, setShowPerfModal] = useState(false);
  const [perfDropdownOpen, setPerfDropdownOpen] = useState(false);
  const [perfPage, setPerfPage] = useState(1);
  const [perfPageSize, setPerfPageSize] = useState(5);

  const perfDateRange = useMemo(
    () => getProfitDateRange(perfDateFilter, perfCustomRange),
    [perfDateFilter, perfCustomRange],
  );

  const { data: rawAssocPerfMetrics, isLoading: isLoadingPerf } = useAssociatePerformanceMetrics({
    startDate: perfDateRange.startDate,
    endDate: perfDateRange.endDate,
    organizationId: organizationId || '',
    locationId: selectedLocationId,
  });

  // Client-side cleanup for the Associate Performance chart:
  //   1. Drop cross-location practitioners (the RPC only scopes production &
  //      hours by location, not the provider list — so a Wigmore dentist
  //      with one stray SS appointment leaks in otherwise).
  //   2. Drop rows with actual daily production = 0. Those were landing
  //      randomly at the top of the chart because every practitioner has
  //      target = £0 (no planning entries yet), which makes performance_percent
  //      NULL and the RPC's ORDER BY collapse to 0 for everyone.
  //   3. Sort by performance % first, then by actual daily production as a
  //      stable fallback so the chart is always a meaningful ranking even
  //      when targets aren't populated.
  const assocPerfMetrics = useMemo(() => {
    const base = rawAssocPerfMetrics ?? [];
    const locFiltered = selectedLocationId
      ? base.filter((m) => {
          const loc = providerLocationById.get(m.provider_id);
          return !loc || loc === selectedLocationId;
        })
      : base;
    return locFiltered
      .filter((m) => (Number(m.daily_production) || 0) > 0)
      .slice()
      .sort((a, b) => {
        const ap = a.performance_percent ?? -Infinity;
        const bp = b.performance_percent ?? -Infinity;
        if (ap !== bp) return bp - ap;
        return (Number(b.daily_production) || 0) - (Number(a.daily_production) || 0);
      })
      .map((m, i) => ({ ...m, rank: i + 1 }));
  }, [rawAssocPerfMetrics, selectedLocationId, providerLocationById]);

  const perfTotalPages = Math.ceil((assocPerfMetrics || []).length / perfPageSize);
  const perfPagedData = (assocPerfMetrics || []).slice((perfPage - 1) * perfPageSize, perfPage * perfPageSize);

  // ── Treatment-level profit + actual-vs-target (pro-style charts) ─────────
  // Same engine as the Profit by Treatments page (useTreatmentProfitPlanning
  // follows the page's global filters), so the two screens reconcile.
  const {
    planningData: treatmentPlanningData,
    isLoading: isLoadingPlanningEngine,
  } = useTreatmentProfitPlanning();
  // Charts draw volume/revenue from the page pipeline (currentItems) and
  // costs/targets from the planning engine — wait for both.
  const isLoadingTreatmentProfit = isLoadingPlanningEngine || chartsLoading;

  // The two pro-style charts must follow the page's Completed on / Paid on
  // toggle and reconcile with the tiles above them — so volume/revenue come
  // from the SAME basis-aware item set as the rest of the page
  // (currentItems: London-date windowed, treatment-appointment-linked,
  // basis-dated). The planning engine supplies only per-unit costs and
  // budget targets; its own volume/revenue date by invoice data, ignore the
  // basis toggle, and drift from the page's figures.
  const basisPlanningData = useMemo(() => {
    const planById = new Map(treatmentPlanningData.map((t) => [t.treatmentId, t]));
    const planByName = new Map(treatmentPlanningData.map((t) => [t.treatmentName.toLowerCase(), t]));
    const agg = new Map<string, { name: string; category: string | null; volume: number; revenue: number }>();
    for (const item of currentItems) {
      if (item.treatmentAppointmentId <= 0) continue; // same gate as the page's tiles
      if (item.price < 0) continue; // refunds excluded; £0 still counts as a unit
      const key = item.treatmentId || item.treatmentName;
      const e = agg.get(key);
      if (e) {
        e.volume += 1;
        e.revenue += item.price;
      } else {
        agg.set(key, {
          name: item.treatmentName,
          category: item.categoryName || null,
          volume: 1,
          revenue: item.price,
        });
      }
    }
    const rows = [...agg.entries()].map(([key, a]) => {
      const plan = planById.get(key) ?? planByName.get(a.name.toLowerCase());
      const avg = a.volume > 0 ? a.revenue / a.volume : 0;
      const assocPay = avg * ((plan?.associatePercent ?? 0) / 100);
      const finFee = avg * ((plan?.financePercent ?? 0) / 100);
      const expUnit =
        (plan?.materialCost ?? 0) +
        (plan?.labBill ?? 0) +
        (plan?.therapistPayRate ?? 0) +
        (plan?.opCostPerTreatment ?? 0) +
        assocPay +
        finFee;
      return {
        treatmentId: key,
        treatmentName: a.name,
        categoryName: plan?.categoryName ?? a.category,
        currentVolume: a.volume,
        currentRevenue: a.revenue,
        totalProfitLoss: a.revenue - expUnit * a.volume,
        plannedRevenue: plan?.plannedRevenue ?? 0,
      };
    });
    // Keep target-only rows (a plan was set but nothing delivered in the
    // period) so Actual vs Target still shows the miss.
    const seen = new Set(rows.map((r) => r.treatmentId));
    for (const t of treatmentPlanningData) {
      if (t.plannedRevenue > 0 && !seen.has(t.treatmentId)) {
        rows.push({
          treatmentId: t.treatmentId,
          treatmentName: t.treatmentName,
          categoryName: t.categoryName,
          currentVolume: 0,
          currentRevenue: 0,
          totalProfitLoss: 0,
          plannedRevenue: t.plannedRevenue,
        });
      }
    }
    return rows;
  }, [currentItems, treatmentPlanningData]);

  const treatmentCategoryProfit = useMemo(() => {
    const totals = new Map<string, { profit: number; units: number }>();
    for (const t of basisPlanningData) {
      if (t.currentVolume <= 0) continue;
      const cat = t.categoryName || 'Uncategorized';
      const e = totals.get(cat) ?? { profit: 0, units: 0 };
      e.profit += t.totalProfitLoss;
      e.units += t.currentVolume;
      totals.set(cat, e);
    }
    return [...totals.entries()]
      .map(([category, v]) => ({ category, profit: v.profit, units: v.units }))
      .sort((a, b) => b.profit - a.profit);
  }, [basisPlanningData]);
  const totalCategoryProfit = useMemo(
    () => treatmentCategoryProfit.reduce((s, c) => s + c.profit, 0),
    [treatmentCategoryProfit],
  );
  const categoryProfitTotalPages = Math.ceil(treatmentCategoryProfit.length / profitPageSize) || 1;
  const categoryProfitPaged = treatmentCategoryProfit
    .map((c, i) => ({ ...c, rank: i + 1 }))
    .slice((profitPage - 1) * profitPageSize, profitPage * profitPageSize);

  const treatmentActualVsTarget = useMemo(
    () =>
      [...basisPlanningData]
        .filter((t) => t.currentRevenue > 0 || t.plannedRevenue > 0)
        .sort((a, b) => b.currentRevenue - a.currentRevenue)
        .map((t, i) => ({
          name:
            t.treatmentName.length > 22
              ? t.treatmentName.slice(0, 22) + '…'
              : t.treatmentName,
          fullName: t.treatmentName,
          actual: t.currentRevenue,
          target: t.plannedRevenue,
          gap: t.currentRevenue - t.plannedRevenue,
          achievedPercent:
            t.plannedRevenue > 0 ? (t.currentRevenue / t.plannedRevenue) * 100 : null,
          rank: i + 1,
        })),
    [basisPlanningData],
  );
  const targetTotalPages = Math.ceil(treatmentActualVsTarget.length / perfPageSize) || 1;
  const targetPagedData = treatmentActualVsTarget.slice(
    (perfPage - 1) * perfPageSize,
    perfPage * perfPageSize,
  );

  // Shared plain-language explanation of every "vs prev period" badge.
  const trendHelp =
    `The change compares the selected period with the period of the same length immediately before it ` +
    `(${format(prevProductionStart, 'dd MMM yyyy')} — ${format(prevProductionEnd, 'dd MMM yyyy')}). ` +
    `Change % = (this period − previous period) ÷ previous period. ` +
    `"--" means there is nothing in the previous period to compare against.`;

  const summaryCards: Array<{
    title: string;
    value: string;
    trend: number;
    icon: any;
    iconBg: string;
    iconColor: string;
    help: string;
    /** When set, the tile is clickable and opens this URL in a new tab. */
    dentallyUrl?: string;
  }> = [
    {
      title: 'Total Revenue',
      // Completed basis: Net Production sweep ('—' when it failed — a £0.00
      // would be indistinguishable from a genuine zero-revenue period).
      // Paid basis: the invoice-paid mirror of Dentally's Practitioner
      // Activity export, dated by when each treatment's invoice was paid.
      value: paidBasis
        ? formatCurrencyWhole(summary.totalRevenue)
        : allNetProduction ? formatCurrencyWhole(netProductionTotal) : '—',
      trend: paidBasis ? summary.totalRevenueTrend : netProductionTrend,
      icon: TrendingUp,
      iconBg: 'bg-teal-100 dark:bg-teal-900/40',
      iconColor: 'text-teal-600 dark:text-teal-400',
      help: paidBasis
        ? `Income from treatments whose invoice was PAID in the selected period, dated by the ` +
          `payment day — the same total as Dentally's Practitioner Activity report with its Date ` +
          `filter set to "Paid on". ${trendHelp}`
        : `Income from treatments completed in the selected period — the same total as Dentally's ` +
          `Practitioner Activity report for the same dates and location. ${trendHelp}`,
      dentallyUrl: dentallyPractitionerActivityUrl,
    },
    {
      title: 'Patients',
      value: summary.uniquePatients.toLocaleString(),
      trend: summary.uniquePatientsTrend,
      icon: Target,
      iconBg: 'bg-emerald-100 dark:bg-emerald-900/40',
      iconColor: 'text-emerald-600 dark:text-emerald-400',
      help: paidBasis
        ? `How many different patients had a treatment paid for in the period — matches the patient ` +
          `count on Dentally's Practitioner Activity report with its Date filter set to "Paid on". ${trendHelp}`
        : `How many different patients had a completed treatment in the period — matches the patient ` +
          `count on Dentally's Practitioner Activity report. ${trendHelp}`,
      dentallyUrl: dentallyPractitionerActivityUrl,
    },
    {
      title: 'Total Hours',
      // Completed basis: appointment-report working hours ('—' when the fetch
      // failed). Paid basis: summed treatment durations of the rows paid in
      // the period — the Duration total on Dentally's "Paid on" export.
      value: paidBasis
        ? `${summary.totalHours.toLocaleString()} hrs`
        : allWorkingHours ? `${workingHoursTotal.toLocaleString()} hrs` : '—',
      trend: paidBasis ? summary.totalHoursTrend : workingHoursTrend,
      icon: AlertTriangle,
      iconBg: 'bg-amber-100 dark:bg-amber-900/40',
      iconColor: 'text-amber-600 dark:text-amber-400',
      help: paidBasis
        ? `Total treatment time of the items whose invoice was paid in the period — the hours total ` +
          `on Dentally's Practitioner Activity report with its Date filter set to "Paid on". ${trendHelp}`
        : `Hours of booked appointments with patients in the period — the same figure as the ` +
          `Providers page and Dentally's Appointments per Month report. ${trendHelp}`,
    },
    {
      title: 'Treatment Volume',
      value: `${summary.treatmentVolume.toLocaleString()} items`,
      trend: summary.treatmentVolumeTrend,
      icon: Lightbulb,
      iconBg: 'bg-teal-100 dark:bg-teal-900/40',
      iconColor: 'text-teal-600 dark:text-teal-400',
      help: paidBasis
        ? `Number of treatment items whose invoice was paid in the period — matches the row count on ` +
          `Dentally's Practitioner Activity report with its Date filter set to "Paid on". ${trendHelp}`
        : `Number of treatment items completed in the period — matches the row count on Dentally's ` +
          `Practitioner Activity report. ${trendHelp}`,
      dentallyUrl: dentallyPractitionerActivityUrl,
    },
  ];

  // Plain-language help for the income-by-payer boxes (same trend note).
  // These boxes come from accounting / Net Production sources that have no
  // invoice-paid date, so the Completed on / Paid on switch does not re-date
  // them — called out in the help text while the paid basis is active.
  const incomeBasisNote = paidBasis
    ? ` Note: this box always follows the completion/accounting period — the "Paid on" setting ` +
      `above does not change it.`
    : '';
  const incomeHelp: Record<string, string> = {
    'Private Income':
      `Income from completed treatments paid on your private payment plans, as mapped in Income ` +
      `Settings — the same Private figure as the Providers page revenue breakdown. ${trendHelp}${incomeBasisNote}`,
    'NHS Income':
      `NHS income for the period. When the practice's NHS income source is set to DentPulse, this is ` +
      `the UDA rate × UDAs delivered; otherwise it comes from the NHS income accounts mapped in your ` +
      `accounting software. ${trendHelp}${incomeBasisNote}`,
    'Membership Plan Income':
      `Membership plan income posted to the membership accounts mapped in your accounting software. ${trendHelp}${incomeBasisNote}`,
  };

  const round2 = (n: number | null | undefined) =>
    n === null || n === undefined ? null : Math.round((Number(n) || 0) * 100) / 100;
  const compactAssocPerf = (assocPerfMetrics || []).map(m => ({
    name: m.provider_name,
    actualDailyProduction: round2(Number(m.daily_production) || 0),
    // Was m.target_daily_production — a field that doesn't exist on the metric, so the
    // target always serialised as 0. The real target is planning_avg_daily_production.
    targetDailyProduction: round2(Number(m.planning_avg_daily_production) || 0),
    performancePercent: round2(m.performance_percent),
    rank: m.rank,
  }));
  const totalPlanMixRevenue = treatmentMix.reduce((s, p) => s + (p.value || 0), 0);
  const planMix = treatmentMix.map(p => ({
    plan: p.name,
    revenue: round2(p.value),
    sharePercent: totalPlanMixRevenue > 0 ? round2((p.value / totalPlanMixRevenue) * 100) : 0,
  }));

  const aiContextData = {
    page: 'treatment-insights',
    selectedLocationId: selectedLocationId || null,
    // 'completed' dates figures by the treatment's completion day; 'paid'
    // dates them by the invoice's paid day (Dentally report Date filter).
    dateBasis,
    summary: {
      // Mirrors the VISIBLE Total Revenue tile: Net Production on the
      // completed basis (same as Provider Insights), the invoice-paid mirror
      // on the paid basis — never the chart pipeline.
      totalRevenue: round2(paidBasis ? summary.totalRevenue : netProductionTotal),
      totalRevenueTrendPercent: round2(paidBasis ? summary.totalRevenueTrend : netProductionTrend),
      uniquePatients: summary.uniquePatients,
      uniquePatientsTrendPercent: round2(summary.uniquePatientsTrend),
      // Mirrors the VISIBLE Total Hours tile: appointment-report working hours
      // on the completed basis, summed treatment durations on the paid basis.
      totalHours: round2(paidBasis ? summary.totalHours : workingHoursTotal),
      totalHoursTrendPercent: round2(paidBasis ? summary.totalHoursTrend : workingHoursTrend),
      treatmentVolume: summary.treatmentVolume,
      treatmentVolumeTrendPercent: round2(summary.treatmentVolumeTrend),
    },
    // Income by payer type boxes — same raw Net Production split as the tiles.
    incomeByPayorType: {
      privateIncome: round2(incomeByPayorCards[0]?.amount ?? 0),
      nhsIncome: round2(incomeByPayorCards[1]?.amount ?? 0),
      membershipPlanIncome: round2(incomeByPayorCards[2]?.amount ?? 0),
    },
    planMix,
    planMixTotalRevenue: round2(totalPlanMixRevenue),
    practitioners: compactAssocPerf.slice(0, 60),
    topPractitionersByPerformance: compactAssocPerf.slice(0, 10),
    bottomPractitionersByPerformance: [...compactAssocPerf].reverse().slice(0, 10),
    underperformingPractitioners: compactAssocPerf.filter(p => (p.performancePercent ?? 0) < 100),
  };

  return (
    <MainLayout userRole="admin" aiContext={aiContextData}>
      <Helmet><title>Treatment Insights | DentPulse</title></Helmet>

      <div className="space-y-6 pt-6">
        {/* Breadcrumb + Header */}
        <div>
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground mb-1">
            <Link to="/treatments" className="hover:text-foreground">Treatment</Link>
            <span>/</span>
            <span className="text-foreground">Insights</span>
          </div>
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold">Treatment Insights</h1>
              <p className="text-muted-foreground">Executive overview of treatment performance across all service types</p>
            </div>
            <div className="flex items-center gap-3 flex-wrap justify-end">
              <DateBasisToggle value={dateBasis} onChange={setDateBasis} />
              <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 border border-border rounded-md px-3 py-1.5">
                <Calendar className="w-4 h-4" />
                <span className="font-medium text-foreground">{formatDate(dateRange.startDate)} — {formatDate(dateRange.endDate)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Summary Cards */}
        <h2 className="text-xs font-semibold tracking-wider uppercase text-primary">Overview</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {summaryCards.map((card) => {
            const Icon = card.icon;
            const clickable = !!card.dentallyUrl;
            return (
              <Card
                key={card.title}
                className={cn(
                  clickable && 'cursor-pointer group hover:border-primary/40 hover:shadow-md transition-all',
                )}
                role={clickable ? 'button' : undefined}
                tabIndex={clickable ? 0 : undefined}
                onClick={clickable ? () => window.open(card.dentallyUrl, '_blank', 'noopener,noreferrer') : undefined}
                onKeyDown={clickable ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    window.open(card.dentallyUrl, '_blank', 'noopener,noreferrer');
                  }
                } : undefined}
                title={clickable ? 'Open in Dentally Practitioner Activity' : undefined}
              >
                <CardContent className="pt-6 pb-5">
                  <div className="flex items-start justify-between mb-4">
                    <span className="text-sm text-muted-foreground flex items-center gap-1.5">
                      {card.title}
                      <span onClick={(e) => e.stopPropagation()}>
                        <MetricHelp title={card.title}>{card.help}</MetricHelp>
                      </span>
                      {clickable && (
                        <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-70 transition-opacity" />
                      )}
                    </span>
                    <div className={cn('w-9 h-9 rounded-full flex items-center justify-center', card.iconBg)}>
                      <Icon className={cn('w-4.5 h-4.5', card.iconColor)} />
                    </div>
                  </div>
                  {isLoading || (!paidBasis && (netProductionLoading || workingHoursLoading)) ? (
                    <div className="space-y-2">
                      <div className="h-8 w-32 bg-muted animate-pulse rounded" />
                      <div className="h-4 w-24 bg-muted animate-pulse rounded" />
                    </div>
                  ) : (
                    <>
                      <div className="text-3xl font-bold mb-1">{card.value}</div>
                      <TrendIndicator value={card.trend} label="vs prev period" help={trendHelp} />
                    </>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Income by payer type */}
        <h2 className="text-xs font-semibold tracking-wider uppercase text-primary">By Payor Type</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {incomeByPayorCards.map((card) => {
            const Icon = card.icon;
            return (
              <Card key={card.title}>
                <CardContent className="pt-6 pb-5">
                  <div className="flex items-start justify-between mb-4">
                    <span className="text-sm text-muted-foreground flex items-center gap-1.5">
                      {card.title}
                      <MetricHelp title={card.title}>{incomeHelp[card.title]}</MetricHelp>
                    </span>
                    <div className={cn('w-9 h-9 rounded-full flex items-center justify-center', card.iconBg)}>
                      <Icon className={cn('w-4.5 h-4.5', card.iconColor)} />
                    </div>
                  </div>
                  {netProductionLoading ? (
                    <div className="space-y-2">
                      <div className="h-8 w-32 bg-muted animate-pulse rounded" />
                      <div className="h-4 w-24 bg-muted animate-pulse rounded" />
                    </div>
                  ) : (
                    <>
                      <div className="text-3xl font-bold mb-1">{allNetProduction ? card.value : '—'}</div>
                      <TrendIndicator value={card.trend} label="vs prev period" help={trendHelp} />
                    </>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Charts Row: Revenue by Category (wider) + Treatment Mix */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Revenue by Category — takes 3/5 */}
          <Card className="lg:col-span-3">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg font-semibold">Revenue by Category</CardTitle>
              <p className="text-sm text-muted-foreground">Top performing treatment categories</p>
            </CardHeader>
            <CardContent>
              {chartsLoading ? (
                <div className="h-[320px] bg-muted animate-pulse rounded" />
              ) : revenueByCategory.length > 0 ? (
                <ResponsiveContainer width="100%" height={Math.max(320, revenueByCategory.slice(0, 8).length * 48)}>
                  <BarChart
                    data={revenueByCategory.slice(0, 8)}
                    layout="vertical"
                    margin={{ top: 5, right: 30, left: 10, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                    <XAxis
                      type="number"
                      tickFormatter={(v: number) => formatCompact(v)}
                      axisLine={false}
                      tickLine={false}
                      fontSize={12}
                    />
                    <YAxis
                      type="category"
                      dataKey="category"
                      width={140}
                      tick={{ fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(value: string) => value.length > 20 ? value.slice(0, 18) + '…' : value}
                    />
                    <Tooltip
                      formatter={(value: number) => [formatCurrency(value), 'Revenue']}
                      contentStyle={{ borderRadius: '8px', border: '1px solid hsl(var(--border))' }}
                    />
                    <Bar dataKey="revenue" fill="#14b8a6" radius={[0, 4, 4, 0]} barSize={24} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-[320px] text-muted-foreground text-sm">
                  No category data available
                </div>
              )}
            </CardContent>
          </Card>

          {/* Plan Mix Donut — takes 2/5 */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg font-semibold">Plan Mix</CardTitle>
              <p className="text-sm text-muted-foreground">Revenue distribution by plan</p>
            </CardHeader>
            <CardContent>
              {chartsLoading ? (
                <div className="h-[320px] bg-muted animate-pulse rounded" />
              ) : treatmentMix.length > 0 ? (
                <div>
                  <ResponsiveContainer width="100%" height={260}>
                    <PieChart>
                      <Pie
                        data={treatmentMix}
                        cx="50%"
                        cy="50%"
                        innerRadius={65}
                        outerRadius={100}
                        paddingAngle={3}
                        dataKey="value"
                        nameKey="name"
                        stroke="none"
                      >
                        {treatmentMix.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value: number) => formatCurrency(value)} />
                    </PieChart>
                  </ResponsiveContainer>
                  <DonutLegend data={treatmentMix} />
                </div>
              ) : (
                <div className="flex items-center justify-center h-[320px] text-muted-foreground text-sm">
                  No plan data available
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Bottom Row: Monthly Trend + Top Treatments side by side */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Monthly Revenue Trend */}
          <Card>
            <CardHeader className="pb-2 flex flex-row flex-wrap items-start justify-between space-y-0 gap-2">
              <div>
                <CardTitle className="text-lg font-semibold">Monthly Revenue Trend</CardTitle>
                <p className="text-sm text-muted-foreground">By treatment type over selected period</p>
              </div>
              <ConfigProvider
                theme={{
                  token: {
                    colorPrimary: 'hsl(244, 48%, 25%)',
                    colorPrimaryBg: '#e6f4ff',
                    colorPrimaryBgHover: '#bae0ff',
                  },
                }}
              >
                <DatePicker.RangePicker
                  value={[
                    trendCustomRange.from ? dayjs(trendCustomRange.from) : null,
                    trendCustomRange.to ? dayjs(trendCustomRange.to) : null,
                  ]}
                  onChange={(dates) => {
                    if (dates && dates[0] && dates[1]) {
                      setTrendCustomRange({ from: dates[0].toDate(), to: dates[1].toDate() });
                    } else {
                      // Cleared — fall back to the page's global date filter.
                      setTrendCustomRange({ from: null, to: null });
                    }
                  }}
                  format="DD-MM-YYYY"
                  placeholder={['Start date', 'End date']}
                  allowClear
                  size="small"
                  className="h-8"
                  getPopupContainer={(trigger) => trigger.parentElement || document.body}
                />
              </ConfigProvider>
            </CardHeader>
            <CardContent>
              {isTrendLoading ? (
                <div className="h-[300px] bg-muted animate-pulse rounded" />
              ) : monthlyTrend.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <ComposedChart data={monthlyTrendDisplay} margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
                    <defs>
                      <linearGradient id="totalAreaGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#14b8a6" stopOpacity={0.15} />
                        <stop offset="95%" stopColor="#14b8a6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="month" axisLine={false} tickLine={false} fontSize={12} />
                    <YAxis tickFormatter={(v: number) => formatCompact(v)} axisLine={false} tickLine={false} fontSize={12} />
                    <Tooltip
                      formatter={(value: number, name: string) => [formatCurrency(value), name]}
                      contentStyle={{ borderRadius: '8px', border: '1px solid hsl(var(--border))' }}
                    />
                    <Area
                      type="monotone"
                      dataKey="total"
                      name="Total"
                      stroke="#14b8a6"
                      strokeWidth={2}
                      fill="url(#totalAreaGradient)"
                    />
                    <Line
                      type="monotone"
                      dataKey="private"
                      name="Private"
                      stroke="#14b8a6"
                      strokeWidth={2}
                      dot={{ r: 3, fill: '#14b8a6' }}
                    />
                    <Line
                      type="monotone"
                      dataKey="nhs"
                      name="NHS"
                      stroke="#94a3b8"
                      strokeWidth={1.5}
                      strokeDasharray="4 4"
                      dot={{ r: 2, fill: '#94a3b8' }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-[300px] text-muted-foreground text-sm">
                  No monthly trend data available
                </div>
              )}
            </CardContent>
          </Card>

          {/* Top Performing Treatments */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg font-semibold">Top Performing Treatments</CardTitle>
              <p className="text-sm text-muted-foreground">By revenue with volume and avg value per unit</p>
            </CardHeader>
            <CardContent className="px-0">
              {chartsLoading ? (
                <div className="px-6 space-y-3">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="h-10 bg-muted animate-pulse rounded" />
                  ))}
                </div>
              ) : topTreatments.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16 pl-6 uppercase text-xs tracking-wider font-semibold text-muted-foreground">Rank</TableHead>
                      <TableHead className="uppercase text-xs tracking-wider font-semibold text-muted-foreground">Treatment</TableHead>
                      <TableHead className="text-right uppercase text-xs tracking-wider font-semibold text-muted-foreground">Revenue</TableHead>
                      <TableHead className="text-right uppercase text-xs tracking-wider font-semibold text-muted-foreground">Volume</TableHead>
                      <TableHead className="text-right uppercase text-xs tracking-wider font-semibold text-muted-foreground">Avg Value</TableHead>
                      <TableHead className="text-right pr-6 uppercase text-xs tracking-wider font-semibold text-muted-foreground">Trend</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {topTreatments.slice(0, 5).map((treatment) => (
                        <TableRow key={treatment.rank} className="h-14">
                          <TableCell className="pl-6">
                            <RankBadge rank={treatment.rank} />
                          </TableCell>
                          <TableCell className="font-medium">{treatment.name}</TableCell>
                          <TableCell className="text-right font-medium">
                            {formatCurrency(treatment.revenue)}
                          </TableCell>
                          <TableCell className="text-right text-sm text-muted-foreground">
                            {treatment.volume.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {formatCurrency(treatment.margin)}
                          </TableCell>
                          <TableCell className="text-right pr-6">
                            {treatment.trend === 0 ? (
                              <span className="text-sm text-muted-foreground">--</span>
                            ) : (
                              <span className={cn(
                                'text-sm font-medium',
                                treatment.trend > 0 ? 'text-emerald-600' : 'text-red-500'
                              )}>
                                {treatment.trend > 0 ? '+' : ''}{treatment.trend}%
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
                  No treatment data available
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Profit Chart */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <div>
              <div className="flex items-center gap-1.5">
                <CardTitle className="text-lg">Profit By Treatment Category</CardTitle>
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      aria-label="How is profit calculated?"
                      className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Info className="w-4 h-4" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[min(92vw,480px)] text-sm" align="start">
                    <p className="font-semibold mb-1">How profit is calculated — per treatment</p>
                    <p className="mb-2 text-muted-foreground text-xs">
                      Selected range: {format(dateRange.startDate, 'dd MMM yyyy')} — {format(dateRange.endDate, 'dd MMM yyyy')}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      For every completed treatment, profit is its income minus
                      the costs set up for that treatment — materials, lab bill,
                      pay rates, finance fee and operating cost — from the
                      Treatment Setup page. Bars group treatments into their
                      categories. The figures match the Profit by Treatments
                      page for the same period and location.
                    </p>
                  </PopoverContent>
                </Popover>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                <Calendar className="w-3.5 h-3.5 inline mr-1" />
                (From: {format(dateRange.startDate, 'dd-MM-yyyy')} To: {format(dateRange.endDate, 'dd-MM-yyyy')})
              </p>
              <p className="text-xs font-semibold tracking-wider uppercase text-primary mt-2">Profit Snapshot</p>
              <p className="text-sm text-muted-foreground">Switch views depending on whether you want trend context or rank detail.</p>
            </div>
          </CardHeader>
          <CardContent>
            {isLoadingTreatmentProfit ? (
              <div className="flex items-center justify-center h-[300px]">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
              </div>
            ) : treatmentCategoryProfit.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={Math.max(250, treatmentCategoryProfit.slice(0, 5).length * 50)}>
                  <BarChart
                    data={treatmentCategoryProfit.slice(0, 5).map((c) => ({
                      name: c.category,
                      profit: c.profit,
                    }))}
                    layout="vertical"
                    margin={{ top: 5, right: 30, left: 10, bottom: 20 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                    <XAxis
                      type="number"
                      tickFormatter={(v: number) => `£${v.toLocaleString()}`}
                      axisLine={false}
                      tickLine={false}
                      fontSize={12}
                      label={{ value: 'Profit', position: 'insideBottom', offset: -10, style: { fontSize: 12, fill: 'hsl(var(--muted-foreground))' } }}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={140}
                      tick={{ fontSize: 12, fill: '#b45309' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const data = payload[0]?.payload;
                        return (
                          <div className="bg-white dark:bg-gray-800 border border-border rounded-lg p-3 shadow-lg">
                            <p className="font-semibold text-sm mb-1">{data?.name}</p>
                            <p className="text-sm">
                              <span className="text-emerald-600">Profit : {formatCurrency(data?.profit || 0)}</span>
                            </p>
                          </div>
                        );
                      }}
                    />
                    <Bar dataKey="profit" fill="#14b8a6" radius={[0, 6, 6, 0]} barSize={28} />
                  </BarChart>
                </ResponsiveContainer>
                <div className="flex justify-end mt-3">
                  <button
                    className="text-sm font-medium text-primary underline underline-offset-2 hover:text-primary/80"
                    onClick={() => { setShowProfitModal(true); setProfitPage(1); }}
                  >
                    See full chart and ranking
                  </button>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center h-[250px] text-muted-foreground text-sm">
                No profit data available
              </div>
            )}
          </CardContent>
        </Card>

        {/* Profit Ranking Modal */}
        <Dialog open={showProfitModal} onOpenChange={setShowProfitModal}>
          <DialogContent className="max-w-5xl w-[95vw] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Treatment Profit Ranking</DialogTitle>
            </DialogHeader>

            {/* Full horizontal bar chart */}
            {treatmentCategoryProfit.length > 0 && (
              // Pro-style: vertical columns with short category codes on the
              // x-axis; the chart scrolls sideways when there are many
              // categories. Hover a bar for the full category name.
              <div className="overflow-x-auto pb-2 min-w-0 max-w-full">
                <div style={{ minWidth: Math.max(640, treatmentCategoryProfit.length * 90) }}>
                  <ResponsiveContainer width="100%" height={360}>
                    <BarChart
                      data={treatmentCategoryProfit.map((c) => ({
                        name: abbreviateCategory(c.category),
                        fullName: c.category,
                        profit: c.profit,
                      }))}
                      margin={{ top: 10, right: 20, left: 10, bottom: 10 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                      <XAxis
                        dataKey="name"
                        tick={{ fontSize: 12 }}
                        axisLine={false}
                        tickLine={false}
                        interval={0}
                      />
                      <YAxis
                        tickFormatter={(v: number) => `£${v.toLocaleString()}`}
                        tick={{ fontSize: 12 }}
                        axisLine={false}
                        tickLine={false}
                        label={{ value: 'Profit', angle: -90, position: 'insideLeft', style: { fontSize: 12, fill: 'hsl(var(--muted-foreground))' } }}
                      />
                      <Tooltip
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          const data = payload[0]?.payload;
                          return (
                            <div className="bg-white dark:bg-gray-800 border border-border rounded-lg p-3 shadow-lg">
                              <p className="font-semibold text-sm mb-1">{data?.fullName}</p>
                              <p className="text-sm">
                                <span className="text-emerald-600">Profit : {formatCurrency(data?.profit || 0)}</span>
                              </p>
                            </div>
                          );
                        }}
                      />
                      <Bar dataKey="profit" fill="#14b8a6" radius={[6, 6, 0, 0]} barSize={44} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Ranking Table */}
            <div className="mt-4 overflow-x-auto min-w-0 max-w-full">
              <table className="w-full text-sm min-w-[560px]">
                <thead className="sticky top-0 bg-background z-10">
                  <tr className="border-b">
                    <th className="text-left py-3 px-3 font-bold">Treatment Category</th>
                    <th className="text-right py-3 px-3 font-bold">Profit</th>
                    <th className="text-right py-3 px-3 font-bold">Unit</th>
                    <th className="text-right py-3 px-3 font-bold">Rank</th>
                  </tr>
                </thead>
                <tbody>
                  {categoryProfitPaged.map((row) => {
                    const suffix = RANK_SUFFIXES[row.rank] || 'th';
                    return (
                      <tr key={row.category} className="border-b hover:bg-muted/50">
                        <td className="py-3 px-3">{row.category}</td>
                        <td className={cn('py-3 px-3 text-right font-semibold', row.profit < 0 ? 'text-destructive' : 'text-emerald-600')}>
                          {formatCurrency(row.profit)}
                        </td>
                        <td className="py-3 px-3 text-right font-semibold text-amber-500">
                          {row.units.toLocaleString()}
                        </td>
                        <td className="py-3 px-3 text-right">
                          <span className="font-semibold">{row.rank}</span>
                          <sup className="text-xs">{suffix}</sup>
                        </td>
                      </tr>
                    );
                  })}
                  {treatmentCategoryProfit.length > 0 && (
                    <tr className="border-t-2 font-semibold">
                      <td className="py-3 px-3">Total</td>
                      <td className={cn('py-3 px-3 text-right', totalCategoryProfit < 0 ? 'text-destructive' : 'text-emerald-600')}>
                        {formatCurrency(totalCategoryProfit)}
                      </td>
                      <td className="py-3 px-3 text-right text-amber-500">
                        {treatmentCategoryProfit.reduce((s, c) => s + c.units, 0).toLocaleString()}
                      </td>
                      <td className="py-3 px-3"></td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {categoryProfitTotalPages > 1 && (
              <div className="flex flex-wrap items-center justify-between gap-2 mt-4 min-w-0 max-w-full">
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={profitPage === 1}
                    onClick={() => setProfitPage((p) => Math.max(1, p - 1))}
                  >
                    Prev
                  </Button>
                  {/* Windowed page numbers — see the Actual vs Target modal. */}
                  {Array.from({ length: Math.min(5, categoryProfitTotalPages) }, (_, i) => {
                    let pageNum: number;
                    if (categoryProfitTotalPages <= 5) pageNum = i + 1;
                    else if (profitPage <= 3) pageNum = i + 1;
                    else if (profitPage >= categoryProfitTotalPages - 2) pageNum = categoryProfitTotalPages - 4 + i;
                    else pageNum = profitPage - 2 + i;
                    return (
                    <Button
                      key={pageNum}
                      variant={pageNum === profitPage ? 'default' : 'outline'}
                      size="sm"
                      className="w-8"
                      onClick={() => setProfitPage(pageNum)}
                    >
                      {pageNum}
                    </Button>
                    );
                  })}
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={profitPage === categoryProfitTotalPages}
                    onClick={() => setProfitPage((p) => Math.min(categoryProfitTotalPages, p + 1))}
                  >
                    Next
                  </Button>
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span>Showing {(profitPage - 1) * profitPageSize + 1} - {Math.min(profitPage * profitPageSize, treatmentCategoryProfit.length)} of {treatmentCategoryProfit.length}</span>
                  <input
                    type="number"
                    className="w-14 h-8 text-center border rounded text-sm"
                    value={profitPageSize}
                    min={1}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      if (val > 0) {
                        setProfitPageSize(val);
                        setProfitPage(1);
                      }
                    }}
                  />
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Associate Profit Performance (Actual vs Target) */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <div>
              <div className="flex items-center gap-1.5">
                <CardTitle className="text-lg">Actual Vs Target Chart</CardTitle>
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      aria-label="How is associate performance calculated?"
                      className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Info className="w-4 h-4" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[min(92vw,480px)] text-sm" align="start">
                    <p className="font-semibold mb-1">Target snapshot — per treatment</p>
                    <p className="mb-2 text-muted-foreground text-xs">
                      Selected range: {format(dateRange.startDate, 'dd MMM yyyy')} — {format(dateRange.endDate, 'dd MMM yyyy')}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Actual is the revenue earned from each treatment in the
                      selected period; Target is the planned revenue set for
                      that treatment on the Profit by Treatments → Planning
                      tab. Use the ranking view for quick top performers and
                      the chart for target context. A treatment with no bar
                      for Target has no plan configured yet.
                    </p>
                  </PopoverContent>
                </Popover>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                <Calendar className="w-3.5 h-3.5 inline mr-1" />
                (From: {format(dateRange.startDate, 'dd-MM-yyyy')} To: {format(dateRange.endDate, 'dd-MM-yyyy')})
              </p>
              <p className="text-xs font-semibold tracking-wider uppercase text-primary mt-2">Target Snapshot</p>
              <p className="text-sm text-muted-foreground">Use the ranking view for quick top performers and the chart for target context.</p>
            </div>
          </CardHeader>
          <CardContent>
            {isLoadingTreatmentProfit ? (
              <div className="flex items-center justify-center h-[300px]">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
              </div>
            ) : treatmentActualVsTarget.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={Math.max(250, treatmentActualVsTarget.slice(0, 5).length * 50)}>
                  <BarChart
                    data={treatmentActualVsTarget.slice(0, 5)}
                    layout="vertical"
                    margin={{ top: 5, right: 30, left: 10, bottom: 20 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                    <XAxis
                      type="number"
                      tickFormatter={(v: number) => formatCurrency(v)}
                      axisLine={false}
                      tickLine={false}
                      fontSize={12}
                      label={{ value: 'Actual Revenue vs Target', position: 'insideBottom', offset: -10, style: { fontSize: 12, fill: 'hsl(var(--muted-foreground))' } }}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={150}
                      tick={{ fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const data = payload[0]?.payload;
                        return (
                          <div className="bg-white dark:bg-gray-800 border border-border rounded-lg p-3 shadow-lg">
                            <p className="text-sm mb-1">
                              <span className="inline-block w-2.5 h-2.5 rounded-full bg-blue-500 mr-2" />
                              Actual Revenue: <span className="font-semibold">{formatCurrency(data?.actual || 0)}</span>
                            </p>
                            <p className="text-sm">
                              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-amber-400 mr-2" />
                              Target <span className="font-semibold">{formatCurrency(data?.target || 0)}</span>
                            </p>
                          </div>
                        );
                      }}
                    />
                    <Bar dataKey="actual" fill="#3b82f6" radius={[0, 4, 4, 0]} barSize={20} />
                    <Bar dataKey="target" fill="#f59e0b" radius={[0, 4, 4, 0]} barSize={4} />
                  </BarChart>
                </ResponsiveContainer>
                <div className="flex justify-end mt-3">
                  <button
                    className="text-sm font-medium text-primary underline underline-offset-2 hover:text-primary/80"
                    onClick={() => { setShowPerfModal(true); setPerfPage(1); }}
                  >
                    See full chart and ranking
                  </button>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center h-[250px] text-muted-foreground text-sm">
                No performance data available
              </div>
            )}
          </CardContent>
        </Card>

        {/* Associate Performance Ranking Modal */}
        <Dialog open={showPerfModal} onOpenChange={setShowPerfModal}>
          <DialogContent className="max-w-5xl w-[95vw] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Treatment Actual vs Target Ranking</DialogTitle>
            </DialogHeader>

            {treatmentActualVsTarget.length > 0 && (
              // Pro-style: vertical columns with short treatment codes on the
              // x-axis; scrolls sideways for long treatment lists. Hover a
              // column for the full treatment name and both figures.
              <div className="overflow-x-auto pb-2 min-w-0 max-w-full">
                <div style={{ minWidth: Math.max(640, treatmentActualVsTarget.length * 70) }}>
                  <ResponsiveContainer width="100%" height={360}>
                    <BarChart
                      data={treatmentActualVsTarget.map((t) => ({
                        ...t,
                        name: abbreviateCategory(t.fullName),
                      }))}
                      margin={{ top: 10, right: 20, left: 10, bottom: 10 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                      <XAxis
                        dataKey="name"
                        tick={{ fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                        interval={0}
                      />
                      <YAxis
                        tickFormatter={(v: number) => formatCurrency(v)}
                        tick={{ fontSize: 12 }}
                        axisLine={false}
                        tickLine={false}
                        label={{ value: 'Actual Revenue vs Target', angle: -90, position: 'insideLeft', style: { fontSize: 12, fill: 'hsl(var(--muted-foreground))' } }}
                      />
                      <Tooltip
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          const data = payload[0]?.payload;
                          return (
                            <div className="bg-white dark:bg-gray-800 border border-border rounded-lg p-3 shadow-lg">
                              <p className="font-semibold text-sm mb-1">{data?.fullName}</p>
                              <p className="text-sm mb-1">
                                <span className="inline-block w-2.5 h-2.5 rounded-full bg-blue-500 mr-2" />
                                Actual Revenue: <span className="font-semibold">{formatCurrency(data?.actual || 0)}</span>
                              </p>
                              <p className="text-sm">
                                <span className="inline-block w-2.5 h-2.5 rounded-sm bg-amber-400 mr-2" />
                                Target <span className="font-semibold">{formatCurrency(data?.target || 0)}</span>
                              </p>
                            </div>
                          );
                        }}
                      />
                      <Bar dataKey="actual" fill="#3b82f6" radius={[4, 4, 0, 0]} barSize={26} />
                      <Bar dataKey="target" fill="#f59e0b" radius={[4, 4, 0, 0]} barSize={8} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Ranking Table */}
            <div className="mt-4 overflow-x-auto min-w-0 max-w-full">
              <table className="w-full text-sm min-w-[560px]">
                <thead className="sticky top-0 bg-background z-10">
                  <tr className="border-b">
                    <th className="text-left py-3 px-3 font-bold">Treatment</th>
                    <th className="text-right py-3 px-3 font-bold">Actual</th>
                    <th className="text-right py-3 px-3 font-bold">Target</th>
                    <th className="text-right py-3 px-3 font-bold">Gap</th>
                    <th className="text-right py-3 px-3 font-bold">Achieved %</th>
                    <th className="text-center py-3 px-3 font-bold">Rank</th>
                  </tr>
                </thead>
                <tbody>
                  {targetPagedData.map((row) => {
                    const suffix = RANK_SUFFIXES[row.rank] || 'th';
                    return (
                      <tr key={row.fullName} className="border-b hover:bg-muted/50">
                        <td className="py-3 px-3">{row.fullName}</td>
                        <td className="py-3 px-3 text-right font-semibold">{formatCurrency(row.actual)}</td>
                        <td className="py-3 px-3 text-right text-muted-foreground">
                          {row.target > 0 ? formatCurrency(row.target) : '—'}
                        </td>
                        <td className={cn('py-3 px-3 text-right font-semibold', row.gap < 0 ? 'text-destructive' : 'text-emerald-600')}>
                          {row.target > 0
                            ? row.gap < 0
                              ? `(${formatCurrency(Math.abs(row.gap))})`
                              : formatCurrency(row.gap)
                            : '—'}
                        </td>
                        <td className="py-3 px-3 text-right">
                          {row.achievedPercent != null ? `${row.achievedPercent.toFixed(1)}%` : '—'}
                        </td>
                        <td className="py-3 px-3 text-center">
                          <span className="font-semibold">{row.rank}</span>
                          <sup className="text-xs">{suffix}</sup>
                        </td>
                      </tr>
                    );
                  })}
                  {treatmentActualVsTarget.length > 0 && (
                    <tr className="border-t-2 font-semibold">
                      <td className="py-3 px-3">Total</td>
                      <td className="py-3 px-3 text-right">
                        {formatCurrency(treatmentActualVsTarget.reduce((s, t) => s + t.actual, 0))}
                      </td>
                      <td className="py-3 px-3 text-right">
                        {formatCurrency(treatmentActualVsTarget.reduce((s, t) => s + t.target, 0))}
                      </td>
                      <td className="py-3 px-3"></td>
                      <td className="py-3 px-3"></td>
                      <td className="py-3 px-3"></td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {targetTotalPages > 1 && (
              <div className="flex flex-wrap items-center justify-between gap-2 mt-4 min-w-0 max-w-full">
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={perfPage === 1}
                    onClick={() => setPerfPage((p) => Math.max(1, p - 1))}
                  >
                    Prev
                  </Button>
                  {/* Windowed page numbers — rendering every page (60+ treatments
                      ÷ 5/page) forced the dialog wider than the screen. */}
                  {Array.from({ length: Math.min(5, targetTotalPages) }, (_, i) => {
                    let pageNum: number;
                    if (targetTotalPages <= 5) pageNum = i + 1;
                    else if (perfPage <= 3) pageNum = i + 1;
                    else if (perfPage >= targetTotalPages - 2) pageNum = targetTotalPages - 4 + i;
                    else pageNum = perfPage - 2 + i;
                    return (
                    <Button
                      key={pageNum}
                      variant={pageNum === perfPage ? 'default' : 'outline'}
                      size="sm"
                      className="w-8"
                      onClick={() => setPerfPage(pageNum)}
                    >
                      {pageNum}
                    </Button>
                    );
                  })}
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={perfPage === targetTotalPages}
                    onClick={() => setPerfPage((p) => Math.min(targetTotalPages, p + 1))}
                  >
                    Next
                  </Button>
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span>Showing {(perfPage - 1) * perfPageSize + 1} - {Math.min(perfPage * perfPageSize, treatmentActualVsTarget.length)} of {treatmentActualVsTarget.length}</span>
                  <input
                    type="number"
                    className="w-14 h-8 text-center border rounded text-sm"
                    value={perfPageSize}
                    min={1}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      if (val > 0) {
                        setPerfPageSize(val);
                        setPerfPage(1);
                      }
                    }}
                  />
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  );
}
