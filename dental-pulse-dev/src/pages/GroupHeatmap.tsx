import React, { useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip as UITooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Input } from '@/components/ui/input';
import { Info, ChevronUp, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useChairMetrics } from '@/hooks/useChairMetrics';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useFilters } from '@/contexts/FilterContext';
import { useLocations } from '@/hooks/useLocations';
import { useOrganization } from '@/hooks/useOrganization';
import { useEbitdaSettings } from '@/hooks/useEbitdaSettings';
import { ukDayStartInstant, ukDayEndInstant } from '@/utils/dateRangeUtils';
import {
  calculateQualityScore,
  calculateMultiple,
  calculateValueProgression,
  type QualityScoreInputs,
  type MultipleInputs,
} from '@/utils/ebitda';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from 'recharts';

function InfoTip({ description, calculation }: { description: string; calculation: string }) {
  return (
    <UITooltip delayDuration={200}>
      <TooltipTrigger asChild>
        <button className="flex-shrink-0 text-muted-foreground/50 hover:text-primary transition-colors ml-1 align-middle" type="button">
          <Info className="w-3 h-3" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" align="start" className="max-w-[450px] p-4 shadow-lg border bg-popover z-[100] text-left">
        <p className="text-xs font-medium text-popover-foreground mb-2 whitespace-normal break-words">{description}</p>
        <p className="text-[11px] text-muted-foreground font-mono leading-relaxed whitespace-pre-line break-words">{calculation}</p>
      </TooltipContent>
    </UITooltip>
  );
}

function CalcBreakdown({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2 border-t pt-1.5">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-primary transition-colors"
      >
        {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        Calculations
      </button>
      {open && (
        <div className="mt-2 text-[11px] font-mono text-muted-foreground bg-muted/40 rounded-md p-3 leading-normal">
          {children}
        </div>
      )}
    </div>
  );
}

function CRow({ l, r, bold, dim }: { l: string; r: string | number; bold?: boolean; dim?: boolean }) {
  return (
    <div className={cn('flex justify-between gap-2', bold && 'font-semibold text-foreground', dim && 'text-muted-foreground/50')}>
      <span className="truncate">{l}</span>
      <span className="text-right shrink-0 tabular-nums">{r}</span>
    </div>
  );
}

const formatCurrency = (value: number): string =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);

const formatCompact = formatCurrency;

interface PracticeDriver {
  label: string;
  from: string;
  to: string;
  impact: string;
}

interface Practice {
  name: string;
  ebitda: number;
  quality: number;
  readiness: number;
  nhsRisk: string;
  nhsPct: number;
  action: string;
  actionColor: string;
  currentValue: number;
  potentialValue: number;
  utilisation: number;
  currentMultiple: number;
  optimisedMultiple: number;
  optimisedEbitda: number;
  drivers: PracticeDriver[];
  chairRevenue: number;
}

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const PAGE_SIZE = 1000;
async function fetchAll<T>(buildQuery: () => any, pageSize = PAGE_SIZE): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const { data, error } = await buildQuery().range(offset, offset + pageSize - 1);
    if (error) { console.error('[fetchAll] error:', error); break; }
    const rows = (data ?? []) as T[];
    all.push(...rows);
    hasMore = rows.length === pageSize;
    offset += pageSize;
  }
  return all;
}

export function GroupHeatmapContent() {
  const { dateRange } = useFilters();
  const { organizationId } = useOrganization();
  // Valuation multiple comes from the org's EBITDA Valuation Settings (same
  // source as Enterprise Overview) — never hardcode the base/penalties.
  const { settings: ebitdaSettings } = useEbitdaSettings();
  const { isLoading: locationsLoading } = useLocations();
  const chairMetrics = useChairMetrics({
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
  });

  const [ebitdaMarginPct, setEbitdaMarginPct] = useState(25);

  const startDate = toDateStr(dateRange.startDate);
  const endDate = toDateStr(dateRange.endDate);

  // Per-location revenue matching treatment insights logic exactly:
  // completed TPIs with payment plan, grouped by PRACTITIONER location (not TPI location_id)
  const locationRevenueQuery = useQuery({
    queryKey: ['group-heatmap-location-revenue', organizationId, startDate, endDate],
    queryFn: async () => {
      if (!organizationId) return { byLocation: new Map<string, number>(), total: 0 };

      // Step 1: Fetch all providers with their location mapping
      const { data: provData } = await (supabase as any)
        .from('providers')
        .select('external_id, location_id')
        .eq('organization_id', organizationId)
        .eq('is_active', true)
        .is('deleted_at', null);

      const practitionerLocMap = new Map<string, string>();
      for (const p of (provData ?? []) as Array<{ external_id: number | null; location_id: string | null }>) {
        if (p.external_id != null && p.location_id) {
          practitionerLocMap.set(String(p.external_id), p.location_id);
        }
      }

      // Step 2: Fetch completed TPIs with payment plan (same as treatment insights)
      const rows = await fetchAll<{
        tpi_price: number | null;
        tpi_practitioner_id: number | null;
      }>(() =>
        (supabase as any)
          .from('treatment_plan_items')
          .select('tpi_price, tpi_practitioner_id')
          .eq('organization_id', organizationId)
          .eq('tpi_completed', true)
          .not('tpi_completed_at', 'is', null)
          .not('tpi_payment_plan_id', 'is', null)
          // London day-boundary instants — bare 'YYYY-MM-DD' strings are cast
          // as UTC by the DB, one hour late during BST.
          .gte('tpi_completed_at', ukDayStartInstant(dateRange.startDate))
          .lte('tpi_completed_at', ukDayEndInstant(dateRange.endDate))
      );

      // Step 3: Group revenue by practitioner's location (matches treatment insights)
      let total = 0;
      const byLocation = new Map<string, number>();
      for (const r of rows) {
        const price = r.tpi_price ?? 0;
        total += price;
        const locId = r.tpi_practitioner_id != null
          ? practitionerLocMap.get(String(r.tpi_practitioner_id))
          : undefined;
        if (locId) {
          byLocation.set(locId, (byLocation.get(locId) ?? 0) + price);
        }
      }
      return { byLocation, total };
    },
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000,
  });

  const isLoading = locationsLoading || chairMetrics.isLoading || locationRevenueQuery.isLoading;

  const heatmapData = useMemo(() => {

    // Chair metrics always returns ALL locations (not filtered by location dropdown)
    const allChairs = chairMetrics.data ?? [];
    if (allChairs.length === 0) return null;

    const revenueByLocation = locationRevenueQuery.data?.byLocation ?? new Map<string, number>();
    // Total revenue matching treatment insights (sum of all TPIs with payment plan)
    const totalRevenue = locationRevenueQuery.data?.total ?? 0;
    if (totalRevenue === 0) return null;

    const orgAvgUtilisation = allChairs.length > 0
      ? allChairs.reduce((s, c) => s + (c.utilisation_pct ?? 0), 0) / allChairs.length : 70;

    // EBITDA margin set by user (default 25%)
    const ebitdaMargin = ebitdaMarginPct / 100;
    const totalEbitda = totalRevenue * ebitdaMargin;

    // Stable org-level quality inputs derived from chair metrics (not from filtered valuation)
    const orgQualityBase = {
      topProviderRevenuePct: 20,       // conservative default
      privateRevenuePct: 50,           // neutral default
      paidInvoiceRate: 0.85,           // conservative default
      udaDeliveryPct: null as number | null,  // no NHS assumption at portfolio level
    };

    // Build practices from real locations
    const practices: Practice[] = allChairs
      .filter(c => c.location_name && (revenueByLocation.get(c.location_id) ?? 0) > 0)
      .map(chair => {
        const locRevenue = revenueByLocation.get(chair.location_id) ?? 0;
        // Allocate EBITDA proportionally by revenue share
        const revenueShare = totalRevenue > 0 ? locRevenue / totalRevenue : 0;
        const locEbitda = totalEbitda * revenueShare;

        // Per-location utilisation (stable from chair metrics RPC)
        const utilisation = chair.utilisation_pct ?? 0;

        // Quality score — per-location utilisation, stable defaults for other inputs
        const qualityInputs: QualityScoreInputs = {
          monthlyRevenues: [],
          topProviderRevenuePct: orgQualityBase.topProviderRevenuePct,
          avgUtilisationPct: utilisation,
          privateRevenuePct: orgQualityBase.privateRevenuePct,
          paidInvoiceRate: orgQualityBase.paidInvoiceRate,
          udaDeliveryPct: orgQualityBase.udaDeliveryPct,
        };
        const quality = calculateQualityScore(qualityInputs);

        // Multiple — per location
        const multipleInputs: MultipleInputs = {
          baseMultiple: ebitdaSettings.base_multiple,
          totalRevenue: locRevenue,
          avgUtilisationPct: utilisation,
          qualityScore: quality.finalScore,
          topProviderRevenuePct: orgQualityBase.topProviderRevenuePct,
          udaDeliveryPct: orgQualityBase.udaDeliveryPct,
          hasGLData: false,
          netDebtToEbitdaRatio: 0,
          mgmtDepthPenalty: ebitdaSettings.mgmt_depth_penalty,
          standardisationPenalty: ebitdaSettings.standardisation_penalty,
          leveragePenalty: ebitdaSettings.leverage_penalty,
          customPenalties: ebitdaSettings.custom_penalties,
        };
        const multiple = calculateMultiple(multipleInputs);

        const currentValue = locEbitda * multiple.finalMultiple;

        // Optimised value
        const progression = calculateValueProgression({
          sustainableEBITDA: locEbitda,
          currentMultiple: multiple.finalMultiple,
          currentEV: currentValue,
          qualityInputs,
          multipleInputs,
          ebitdaImprovementPct: 30,
        });
        const potentialValue = progression.optimised.value;
        const optimisedEbitda = progression.optimised.ebitda;
        const optimisedMultipleVal = progression.optimised.multiple;

        // Per-location drivers
        const locDrivers: PracticeDriver[] = [];
        if (utilisation < 85) {
          locDrivers.push({ label: 'Chair Utilisation', from: `${Math.round(utilisation)}%`, to: '85%', impact: 'Fills empty chair time, lifts revenue per chair' });
        }
        if (orgQualityBase.topProviderRevenuePct > 15) {
          locDrivers.push({ label: 'Associate Dependency', from: `${orgQualityBase.topProviderRevenuePct}%`, to: '15%', impact: 'Spread revenue across more clinicians' });
        }
        if (orgQualityBase.paidInvoiceRate < 0.95) {
          locDrivers.push({ label: 'Cash Conversion', from: `${Math.round(orgQualityBase.paidInvoiceRate * 100)}%`, to: '95%+', impact: 'Fewer unpaid invoices, better cash flow' });
        }
        if (potentialValue > currentValue) {
          locDrivers.push({ label: 'EBITDA Uplift', from: formatCurrency(locEbitda), to: formatCurrency(optimisedEbitda), impact: `+${formatCurrency(optimisedEbitda - locEbitda)} from improvements` });
        }

        // Readiness: blend of quality + utilisation performance
        const readiness = Math.round(quality.finalScore * 0.7 + utilisation * 0.3);

        // NHS risk — no per-location UDA data available yet
        const nhsPct = orgQualityBase.udaDeliveryPct ?? 100;
        let nhsRisk: string;
        if (nhsPct >= 96) nhsRisk = `✓ ${Math.round(nhsPct)}%`;
        else if (nhsPct >= 92) nhsRisk = `⚠ ${Math.round(nhsPct)}%`;
        else nhsRisk = `🔴 ${Math.round(nhsPct)}%`;

        // Action based on readiness + EBITDA share
        let action: string;
        let actionColor: string;
        if (readiness >= 80 && revenueShare >= 0.18) {
          action = 'Prepare for sale';
          actionColor = 'bg-success/10 text-success';
        } else if (readiness >= 80) {
          action = 'Premium asset';
          actionColor = 'bg-success/10 text-success';
        } else if (readiness >= 65 && revenueShare >= 0.18) {
          action = 'Hold & grow';
          actionColor = 'bg-foreground/10 text-foreground';
        } else if (readiness >= 65) {
          action = 'Hold & grow';
          actionColor = 'bg-foreground/10 text-foreground';
        } else if (nhsPct < 96) {
          action = 'Fix UDA output';
          actionColor = 'bg-danger/10 text-danger';
        } else {
          action = 'Improve operations';
          actionColor = 'bg-warning/10 text-warning';
        }

        return {
          name: chair.location_name,
          ebitda: locEbitda,
          quality: quality.finalScore,
          readiness,
          nhsRisk,
          nhsPct,
          action,
          actionColor,
          currentValue,
          potentialValue,
          utilisation,
          currentMultiple: multiple.finalMultiple,
          optimisedMultiple: optimisedMultipleVal,
          optimisedEbitda,
          drivers: locDrivers,
          chairRevenue: locRevenue,
        };
      })
      .sort((a, b) => b.readiness - a.readiness);

    if (practices.length === 0) return null;

    const totalPortfolioValue = practices.reduce((s, p) => s + p.currentValue, 0);
    const totalPotentialValue = practices.reduce((s, p) => s + p.potentialValue, 0);
    const totalGap = totalPotentialValue - totalPortfolioValue;
    const avgReadiness = Math.round(practices.reduce((s, p) => s + p.readiness, 0) / practices.length);
    const nhsExposure = practices.filter(p => p.nhsPct < 96).reduce((s, p) => s + p.ebitda * 0.08, 0);

    const chartData = practices.map(p => ({
      name: p.name,
      current: Math.round(p.currentValue / 1000),
      potential: Math.round(p.potentialValue / 1000),
    }));

    // Quadrant classification
    const medianReadiness = 75;
    const medianEbitda = totalEbitda > 0 ? totalEbitda / practices.length : 0;
    const quadrants = {
      crownJewels: practices.filter(p => p.readiness >= medianReadiness && p.ebitda >= medianEbitda),
      rescueMissions: practices.filter(p => p.readiness < medianReadiness && p.ebitda >= medianEbitda),
      stableFillers: practices.filter(p => p.readiness >= medianReadiness && p.ebitda < medianEbitda),
      divestmentZone: practices.filter(p => p.readiness < medianReadiness && p.ebitda < medianEbitda),
    };

    // Table totals
    const totalTableEbitda = practices.reduce((s, p) => s + p.ebitda, 0);
    const avgQuality = Math.round(practices.reduce((s, p) => s + p.quality, 0) / practices.length);

    return {
      practices, totalPortfolioValue, totalGap, avgReadiness, nhsExposure, chartData, quadrants,
      totalTableEbitda, avgQuality, practiceCount: practices.length, totalPotentialValue,
    };
  }, [chairMetrics.data, locationRevenueQuery.data, ebitdaMarginPct, ebitdaSettings]);

  if (isLoading || !heatmapData) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-48 mb-2" />
        <div className="grid grid-cols-4 gap-3"><Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
        <Skeleton className="h-60 rounded-lg" />
      </div>
    );
  }

  return (
      <div className="space-y-3.5">

        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold text-foreground">Group Heatmap</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Multi-practice portfolio view — value, risk and EBITDA comparison</p>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-muted-foreground whitespace-nowrap">EBITDA Margin %</label>
            <Input
              type="number"
              min={1}
              max={100}
              value={ebitdaMarginPct}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (v >= 1 && v <= 100) setEbitdaMarginPct(v);
              }}
              className="w-20 h-8 text-sm text-center tabular-nums"
            />
          </div>
        </div>

        {/* Portfolio Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Card className="p-3 text-center">
            <div className="text-[10px] text-muted-foreground mb-1">
              Total Portfolio Value
              <InfoTip
                description="Sum of enterprise values across all practices. Each practice value = EBITDA × Multiple."
                calculation={heatmapData.practices.map(p =>
                  `${p.name}:\n  Revenue: ${formatCompact(p.chairRevenue)}\n  EBITDA (${ebitdaMarginPct}% margin): ${formatCompact(p.ebitda)}\n  Multiple: ${p.currentMultiple.toFixed(1)}x\n  Value: ${formatCompact(p.ebitda)} × ${p.currentMultiple.toFixed(1)}x = ${formatCompact(p.currentValue)}`
                ).join('\n\n') + `\n\nTotal Portfolio Value: ${formatCompact(heatmapData.totalPortfolioValue)}`}
              />
            </div>
            <div className="text-xl font-bold tabular-nums">{formatCompact(heatmapData.totalPortfolioValue)}</div>
          </Card>
          <Card className="p-3 text-center">
            <div className="text-[10px] text-muted-foreground mb-1">
              Value Gap
              <InfoTip
                description="Total unrealised value — difference between potential (optimised) and current enterprise value per practice."
                calculation={heatmapData.practices.map(p =>
                  `${p.name}:\n  Current EV: ${formatCompact(p.currentValue)}\n  Potential EV: ${formatCompact(p.potentialValue)}\n  Gap: ${formatCompact(p.potentialValue)} − ${formatCompact(p.currentValue)} = ${formatCompact(p.potentialValue - p.currentValue)}`
                ).join('\n\n') + `\n\nTotal Value Gap: ${formatCompact(heatmapData.totalGap)}`}
              />
            </div>
            <div className="text-xl font-bold text-danger tabular-nums">{formatCompact(heatmapData.totalGap)}</div>
          </Card>
          <Card className="p-3 text-center">
            <div className="text-[10px] text-muted-foreground mb-1">
              Avg Readiness Score
              <InfoTip
                description="Average exit readiness across all practices. Readiness = 70% Quality + 30% Utilisation."
                calculation={heatmapData.practices.map(p =>
                  `${p.name}:\n  Quality: ${p.quality}/100, Utilisation: ${Math.round(p.utilisation)}%\n  Readiness: (${p.quality} × 70%) + (${Math.round(p.utilisation)} × 30%) = ${p.readiness}`
                ).join('\n\n') + `\n\nAvg: (${heatmapData.practices.map(p => p.readiness).join(' + ')}) / ${heatmapData.practiceCount} = ${heatmapData.avgReadiness}`}
              />
            </div>
            <div className={cn('text-xl font-bold tabular-nums', heatmapData.avgReadiness >= 75 ? 'text-success' : 'text-warning')}>{heatmapData.avgReadiness}</div>
          </Card>
          <Card className="p-3 text-center">
            <div className="text-[10px] text-muted-foreground mb-1">
              NHS Clawback Exposure
              <InfoTip
                description="Total potential NHS clawback. Practices with UDA delivery < 96% face 8% EBITDA haircut."
                calculation={heatmapData.nhsExposure > 0
                  ? heatmapData.practices.filter(p => p.nhsPct < 96).map(p =>
                    `${p.name}: ${formatCompact(p.ebitda)} × 8% = ${formatCompact(p.ebitda * 0.08)}`
                  ).join('\n') + `\nTotal: ${formatCompact(heatmapData.nhsExposure)}`
                  : `All ${heatmapData.practiceCount} practices at ≥96% UDA delivery.\nNo clawback risk — exposure = ${formatCompact(0)}.`}
              />
            </div>
            <div className="text-xl font-bold text-danger tabular-nums">{formatCompact(heatmapData.nhsExposure)}</div>
          </Card>
        </div>

        {/* Practice Table */}
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground">
              Practice Portfolio — Ranked by Exit Readiness
              <InfoTip
                description="Each practice ranked by exit readiness score. Quality = EBITDA Quality Score. Readiness = composite of quality and operations."
                calculation={`${heatmapData.practiceCount} practices | Total EBITDA: ${formatCompact(heatmapData.totalTableEbitda)} | Portfolio Value: ${formatCompact(heatmapData.totalPortfolioValue)} | Avg Readiness: ${heatmapData.avgReadiness}/100.`}
              />
            </div>
            <span className="text-[9px] font-mono bg-muted px-1.5 py-0.5 rounded text-muted-foreground">DentPulse</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b-2">
                  <th className="py-1.5 px-2 text-left text-muted-foreground font-semibold">Practice</th>
                  <th className="py-1.5 px-2 text-right text-muted-foreground font-semibold">
                    EBITDA
                    <InfoTip
                      description="Sustainable EBITDA allocated to each practice by its revenue share."
                      calculation={`Total EBITDA ${formatCompact(heatmapData.totalTableEbitda)} allocated across ${heatmapData.practiceCount} practices by chair revenue share.`}
                    />
                  </th>
                  <th className="py-1.5 px-2 text-center text-muted-foreground font-semibold">
                    Quality
                    <InfoTip
                      description="EBITDA Quality Score (0–100). Green 80+ = premium, Amber 60–79 = solid, Red <60 = high risk."
                      calculation={`Weighted average of 6 sub-scores: Revenue Predictability (20%), Associate Dependency (20%), Chair Stability (15%), Treatment Mix (15%), Cash Conversion (15%), NHS Delivery (15%). Portfolio avg: ${heatmapData.avgQuality}/100.`}
                    />
                  </th>
                  <th className="py-1.5 px-2 text-center text-muted-foreground font-semibold">
                    Readiness
                    <InfoTip
                      description="Exit Readiness Score (0–100). How prepared this practice is for a sale or due diligence process."
                      calculation={`Readiness = 70% × Quality + 30% × Chair Utilisation. Portfolio avg: ${heatmapData.avgReadiness}/100. Range: ${Math.min(...heatmapData.practices.map(p => p.readiness))} – ${Math.max(...heatmapData.practices.map(p => p.readiness))}.`}
                    />
                  </th>
                  <th className="py-1.5 px-2 text-center text-muted-foreground font-semibold">
                    NHS Risk
                    <InfoTip
                      description="UDA delivery rate vs NHS contract target. Below 96% triggers clawback risk."
                      calculation={`✓ 96%+ = safe. ⚠ 92–95% = at risk. 🔴 <92% = critical. ${heatmapData.practices.filter(p => p.nhsPct < 96).length} of ${heatmapData.practiceCount} practices at risk.`}
                    />
                  </th>
                  <th className="py-1.5 px-2 text-center text-muted-foreground font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {heatmapData.practices.map((p, i) => (
                  <tr key={i} className="border-b hover:bg-muted/50 cursor-pointer transition-colors">
                    <td className="py-2 px-2 font-medium">{p.name}</td>
                    <td className="py-2 px-2 text-right tabular-nums">{formatCompact(p.ebitda)}</td>
                    <td className="py-2 px-2 text-center">
                      <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded',
                        p.quality >= 80 ? 'bg-success/10 text-success' : p.quality >= 60 ? 'bg-warning/10 text-warning' : 'bg-danger/10 text-danger'
                      )}>{p.quality}</span>
                    </td>
                    <td className="py-2 px-2 text-center">
                      <span className="mr-1">{p.readiness >= 80 ? '🟢' : p.readiness >= 65 ? '🟡' : '🔴'}</span>
                      <strong className={cn(p.readiness >= 80 ? 'text-success' : p.readiness >= 65 ? 'text-warning' : 'text-danger')}>{p.readiness}</strong>
                    </td>
                    <td className={cn('py-2 px-2 text-center', p.nhsPct >= 96 ? 'text-success' : p.nhsPct >= 92 ? 'text-warning' : 'text-danger')}>{p.nhsRisk}</td>
                    <td className="py-2 px-2 text-center">
                      <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded', p.actionColor)}>{p.action}</span>
                    </td>
                  </tr>
                ))}
                {/* Totals row */}
                <tr className="border-t-2 font-semibold bg-muted/30">
                  <td className="py-2 px-2">{heatmapData.practiceCount} Practices</td>
                  <td className="py-2 px-2 text-right tabular-nums">{formatCompact(heatmapData.totalTableEbitda)}</td>
                  <td className="py-2 px-2 text-center">
                    <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded',
                      heatmapData.avgQuality >= 80 ? 'bg-success/10 text-success' : heatmapData.avgQuality >= 60 ? 'bg-warning/10 text-warning' : 'bg-danger/10 text-danger'
                    )}>Avg {heatmapData.avgQuality}</span>
                  </td>
                  <td className="py-2 px-2 text-center">
                    <span className="mr-1">{heatmapData.avgReadiness >= 80 ? '🟢' : heatmapData.avgReadiness >= 65 ? '🟡' : '🔴'}</span>
                    <strong className={cn(heatmapData.avgReadiness >= 80 ? 'text-success' : heatmapData.avgReadiness >= 65 ? 'text-warning' : 'text-danger')}>Avg {heatmapData.avgReadiness}</strong>
                  </td>
                  <td className="py-2 px-2 text-center text-muted-foreground">—</td>
                  <td className="py-2 px-2 text-center text-muted-foreground">—</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Calculations — how the table data is derived */}
          <CalcBreakdown>
            {/* Portfolio summary */}
            <CRow l={`${heatmapData.practiceCount} Practices | Total Revenue`} r={formatCompact(heatmapData.practices.reduce((s, p) => s + p.chairRevenue, 0))} bold />
            <CRow l="EBITDA Margin (user-defined)" r={`${ebitdaMarginPct}%`} dim />
            <CRow l="Total EBITDA" r={formatCompact(heatmapData.totalTableEbitda)} bold />
            <CRow l="Avg Quality" r={`${heatmapData.avgQuality}/100`} />
            <CRow l="Avg Readiness" r={`${heatmapData.avgReadiness}/100`} />

            {/* Per-location breakdown */}
            {heatmapData.practices.map((p, idx) => (
              <div key={idx} className={cn('pt-3 mt-3 border-t')}>
                <CRow l={p.name} r="" bold />

                <div className="mt-1 space-y-0.5">
                  <div className="text-[10px] font-semibold text-foreground mt-2 mb-1">EBITDA</div>
                  <CRow l="Revenue (completed TPIs with payment plan)" r={formatCompact(p.chairRevenue)} />
                  <CRow l={`EBITDA = Revenue × ${ebitdaMarginPct}% margin`} r={formatCompact(p.ebitda)} />

                  <div className="text-[10px] font-semibold text-foreground mt-2 mb-1">Quality Score: {p.quality}/100</div>
                  <CRow l="Revenue Predictability (20%)" r="100" dim />
                  <CRow l={`Associate Dependency (20%) — top provider 20%`} r={`${Math.round(100 - 20 * 1.5)}`} dim />
                  <CRow l={`Chair Stability (15%) — utilisation ${Math.round(p.utilisation)}%`} r={`${Math.round(p.utilisation)}`} dim />
                  <CRow l="Treatment Mix (15%) — private 50%" r="50" dim />
                  <CRow l="Cash Conversion (15%) — rate 85%" r="85" dim />
                  <CRow l="NHS Delivery (15%) — no NHS contract" r="65" dim />
                  <CRow l="Weighted average" r={`${p.quality}`} />

                  <div className="text-[10px] font-semibold text-foreground mt-2 mb-1">Readiness: {p.readiness}/100</div>
                  <CRow l={`Quality ${p.quality} × 70% = ${Math.round(p.quality * 0.7)}`} r="" dim />
                  <CRow l={`Utilisation ${Math.round(p.utilisation)}% × 30% = ${Math.round(p.utilisation * 0.3)}`} r="" dim />
                  <CRow l={`${Math.round(p.quality * 0.7)} + ${Math.round(p.utilisation * 0.3)}`} r={`${p.readiness}`} />

                  <div className="text-[10px] font-semibold text-foreground mt-2 mb-1">NHS Risk</div>
                  <CRow l={`UDA delivery: ${p.nhsRisk}`} r={p.nhsPct >= 96 ? 'Safe' : p.nhsPct >= 92 ? 'At risk' : 'Critical'} />

                  <div className="text-[10px] font-semibold text-foreground mt-2 mb-1">Action: {p.action}</div>
                  <CRow l={`Readiness ${p.readiness} ${p.readiness >= 80 ? '≥ 80 (premium)' : p.readiness >= 65 ? '≥ 65 (solid)' : '< 65 (needs work)'}`} r="" dim />
                </div>
              </div>
            ))}
          </CalcBreakdown>
        </Card>

        {/* Quadrant + Value Chart */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
          {/* 2x2 Quadrant */}
          <Card className="p-4">
            <div className="text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
              2×2 Portfolio Quadrant
              <InfoTip
                description="Plots practices by exit readiness (X) vs EBITDA size (Y). Top-right = Crown Jewels (sell first). Bottom-left = Divestment Zone (sell or fix)."
                calculation={`Readiness threshold: 75. EBITDA threshold: ${formatCompact(heatmapData.totalTableEbitda / heatmapData.practiceCount)} (avg). Crown Jewels: ${heatmapData.quadrants.crownJewels.length} | Rescue: ${heatmapData.quadrants.rescueMissions.length} | Stable: ${heatmapData.quadrants.stableFillers.length} | Divest: ${heatmapData.quadrants.divestmentZone.length}.`}
              />
            </div>
            <div className="text-[10.5px] text-muted-foreground mb-2">X: Exit Readiness Score / Y: EBITDA</div>
            <div className="grid grid-cols-2 grid-rows-2 gap-px bg-border rounded-lg overflow-hidden" style={{ height: 220 }}>
              {/* Top-left: Rescue Missions */}
              <div className="bg-warning/5 p-3 flex flex-col gap-1.5 overflow-y-auto">
                <div className="text-[11px] font-bold uppercase tracking-wider text-info flex items-center gap-1">🚀 Rescue Missions</div>
                <div className="text-[10.5px] text-amber-700 leading-tight">High value, low readiness → biggest alpha</div>
                {heatmapData.quadrants.rescueMissions.map((p, i) => (
                  <div key={i} className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-warning inline-block flex-shrink-0" /><span className="truncate">{p.name} {formatCompact(p.ebitda)}</span>
                  </div>
                ))}
                {heatmapData.quadrants.rescueMissions.length === 0 && (
                  <div className="text-[10px] text-muted-foreground/50 italic">None</div>
                )}
              </div>
              {/* Top-right: Crown Jewels */}
              <div className="bg-success/5 p-3 flex flex-col gap-1.5 overflow-y-auto">
                <div className="text-[11px] font-bold uppercase tracking-wider text-success flex items-center gap-1">👑 Crown Jewels</div>
                <div className="text-[10.5px] text-emerald-700 leading-tight">High value + high readiness → exit pipeline</div>
                {heatmapData.quadrants.crownJewels.map((p, i) => (
                  <div key={i} className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-success inline-block flex-shrink-0" /><span className="truncate">{p.name} {formatCompact(p.ebitda)}</span>
                  </div>
                ))}
                {heatmapData.quadrants.crownJewels.length === 0 && (
                  <div className="text-[10px] text-muted-foreground/50 italic">None</div>
                )}
              </div>
              {/* Bottom-left: Divestment */}
              <div className="bg-danger/5 p-3 flex flex-col gap-1.5 overflow-y-auto">
                <div className="text-[11px] font-bold uppercase tracking-wider text-danger flex items-center gap-1">⚠ Divestment Zone</div>
                <div className="text-[10.5px] text-red-700 leading-tight">Low value + low readiness → sell</div>
                {heatmapData.quadrants.divestmentZone.map((p, i) => (
                  <div key={i} className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-danger inline-block flex-shrink-0" /><span className="truncate">{p.name} {formatCompact(p.ebitda)}</span>
                  </div>
                ))}
                {heatmapData.quadrants.divestmentZone.length === 0 && (
                  <div className="text-[10px] text-muted-foreground/50 italic">None</div>
                )}
              </div>
              {/* Bottom-right: Stable Fillers */}
              <div className="bg-blue-50 dark:bg-blue-950/20 p-3 flex flex-col gap-1.5 overflow-y-auto">
                <div className="text-[11px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 flex items-center gap-1">🏦 Stable Fillers</div>
                <div className="text-[10.5px] text-blue-700 leading-tight">Low value + high readiness → hold</div>
                {heatmapData.quadrants.stableFillers.map((p, i) => (
                  <div key={i} className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-blue-500 inline-block flex-shrink-0" /><span className="truncate">{p.name} {formatCompact(p.ebitda)}</span>
                  </div>
                ))}
                {heatmapData.quadrants.stableFillers.length === 0 && (
                  <div className="text-[10px] text-muted-foreground/50 italic">None</div>
                )}
              </div>
            </div>
          </Card>

          {/* Value Chart */}
          <Card className="p-4">
            <div className="text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground mb-3">
              Current vs Potential Value per Practice
              <InfoTip
                description="Bar chart comparing each practice's current enterprise value against its potential value if all improvements are made."
                calculation={`Current portfolio: ${formatCompact(heatmapData.totalPortfolioValue)}. Potential: ${formatCompact(heatmapData.totalPotentialValue)}. Value gap: +${formatCompact(heatmapData.totalGap)} (+${heatmapData.totalPortfolioValue > 0 ? Math.round(heatmapData.totalGap / heatmapData.totalPortfolioValue * 100) : 0}%).`}
              />
            </div>
            <div className="h-[400px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={heatmapData.chartData} margin={{ bottom: 80 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 8, angle: -45, textAnchor: 'end', dy: 5, width: 200 }} interval={0} height={150} />
                  <YAxis tick={{ fontSize: 9 }} tickFormatter={(v) => '£' + v + 'k'} />
                  <Tooltip formatter={(v: number) => '£' + v + 'k'} />
                  <Legend iconSize={10} wrapperStyle={{ fontSize: '10px' }} />
                  <Bar dataKey="current" fill="hsl(var(--foreground))" name="Current Value" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="potential" fill="hsl(var(--primary))" name="Potential Value" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
      </div>
  );
}

export default function GroupHeatmap() {
  return (
    <MainLayout userRole="admin">
      <Helmet><title>Group Heatmap | DentPulse</title></Helmet>
      <GroupHeatmapContent />
    </MainLayout>
  );
}
