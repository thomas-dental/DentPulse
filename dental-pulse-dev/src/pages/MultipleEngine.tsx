import { useState, useEffect, useMemo } from 'react';
import { Helmet } from 'react-helmet-async';
import { useSearchParams } from 'react-router-dom';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { Info, Pencil, Check, X } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as RTooltip,
  Cell,
} from 'recharts';
import { useEbitdaValuation } from '@/hooks/useEbitdaValuation';
import { useTabPermissions } from '@/hooks/useTabPermissions';
import { QualityScoreContent } from './QualityScore';

// ─── HELPERS ───

const formatCurrency = (value: number): string =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);

// ─── FACTOR METADATA ───
// Maps waterfall label -> source description & status info

interface FactorMeta {
  displayLabel: string;
  source: string;
  status: 'auto' | 'calc' | 'manual' | 'action' | 'high-risk';
}

const FACTOR_META: Record<string, FactorMeta> = {
  'Base Market': { displayLabel: 'Base Market', source: 'UK DSO benchmark', status: 'manual' },
  '+ Scale': { displayLabel: 'Scale', source: 'Financial data', status: 'auto' },
  '+ Chair': { displayLabel: 'Chair Utilisation', source: 'PMS Dentally', status: 'auto' },
  '+ Reporting': { displayLabel: 'Reporting Quality', source: 'Finance maturity', status: 'manual' },
  '+ Debt Mgmt': { displayLabel: 'Debt Reduction Trend', source: 'Balance sheet', status: 'auto' },
  '− Assoc. Dep.': { displayLabel: 'Associate Dependency', source: 'PMS Dentally', status: 'action' },
  '− Mgmt Depth': { displayLabel: 'Management Depth', source: 'Configurable', status: 'manual' },
  '− NHS Risk': { displayLabel: 'NHS Clawback Risk', source: 'NHS Sentinel', status: 'high-risk' },
  '− Standards': { displayLabel: 'Standardisation', source: 'Configurable', status: 'manual' },
  '− Leverage': { displayLabel: 'Leverage Risk', source: 'Configurable', status: 'manual' },
  '− Qual. Drag': { displayLabel: 'Quality Score Drag', source: 'DentPulse model', status: 'calc' },
};

const STATUS_CONFIG = {
  auto: { label: '\u2713 Auto', className: 'bg-success-muted text-success' },
  calc: { label: '\u2713 Calc', className: 'bg-success-muted text-success' },
  manual: { label: 'Manual', className: 'bg-primary/10 text-primary' },
  action: { label: '\u26A0 Action', className: 'bg-warning-muted text-warning' },
  'high-risk': { label: 'High Risk', className: 'bg-danger-muted text-danger' },
};

const MULTIPLE_INFO: Record<string, { description: string; calculation: string }> = {
  'Base Market': {
    description: 'Starting valuation multiple for UK dental practices.',
    calculation: 'Default: 5.8x (configurable in settings)',
  },
  '+ Scale': {
    description: 'Premium for larger practices - higher revenue = more attractive to buyers.',
    calculation: 'Revenue > 5M -> +0.3x | > 3M -> +0.2x | > 1M -> +0.1x',
  },
  '+ Chair': {
    description: 'Premium for high chair utilisation - busy chairs = efficient practice.',
    calculation: 'Utilisation > 80% -> +0.2x | > 70% -> +0.1x',
  },
  '+ Reporting': {
    description: 'Premium for having accounting software (Xero/Iplicit) connected.',
    calculation: 'GL data connected -> +0.1x',
  },
  '+ Debt Mgmt': {
    description: 'Premium for low debt relative to earnings.',
    calculation: 'Net Debt / EBITDA < 1.5 -> +0.1x',
  },
  '- Assoc. Dep.': {
    displayLabel: 'Associate Dependency',
    description: 'Penalty when too much revenue depends on one associate.',
    calculation: 'Top provider > 40% -> -0.4x | > 30% -> -0.3x | > 20% -> -0.2x',
  },
  '- Mgmt Depth': {
    description: 'Penalty for limited management team beyond the principal.',
    calculation: 'Configurable in settings: default -0.3x. Set to 0 to disable.',
  },
  '- NHS Risk': {
    description: 'Penalty for under-delivering on NHS UDA contract - risk of clawback.',
    calculation: 'UDA < 92% -> -0.3x | < 96% -> -0.2x | < 100% -> -0.1x',
  },
  '- Standards': {
    description: 'Penalty for standardisation risk across the practice.',
    calculation: 'Configurable in settings: default -0.2x. Set to 0 to disable.',
  },
  '- Leverage': {
    description: 'Penalty for financial leverage risk.',
    calculation: 'Configurable in settings: default -0.2x. Set to 0 to disable.',
  },
  '- Qual. Drag': {
    description: 'Penalty based on EBITDA Quality Score.',
    calculation: 'Score < 65 -> -0.3x | < 75 -> -0.2x | < 85 -> -0.1x | 85+ -> no penalty',
  },
};

function InfoButton({ info }: { description: string; calculation: string }) {
  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>
        <button className="flex-shrink-0 text-muted-foreground/50 hover:text-primary transition-colors" type="button">
          <Info className="w-3 h-3" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" align="start" className="w-[300px] p-3 shadow-lg border bg-popover z-[100]">
        <p className="text-[11px] font-medium text-popover-foreground mb-1.5 whitespace-normal break-words">{info.description}</p>
        <p className="text-[10px] text-muted-foreground font-mono leading-relaxed whitespace-normal break-words">{info.calculation}</p>
      </TooltipContent>
    </Tooltip>
  );
}

// ─── MAIN PAGE ───

export function MultipleEngineContent() {
  const { valuation: d, isLoading, settingsApi } = useEbitdaValuation();
  const [editingBase, setEditingBase] = useState(false);
  const [baseInput, setBaseInput] = useState('');

  if (isLoading || !d) {
    return (
      <div className="space-y-4">
          {/* Header */}
          <div>
            <Skeleton className="h-6 w-40 mb-2" />
            <Skeleton className="h-4 w-64" />
          </div>

          {/* Main Layout: Left + Right sidebar */}
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-3.5">
            {/* Left Column */}
            <div className="space-y-3.5">
              {/* 3 Summary Cards */}
              <div className="grid grid-cols-3 gap-3">
                {[1, 2, 3].map(i => (
                  <Card key={i} className="p-4 text-center">
                    <Skeleton className="h-3 w-24 mx-auto mb-3" />
                    <Skeleton className="h-9 w-16 mx-auto mb-2" />
                    <Skeleton className="h-3 w-20 mx-auto" />
                  </Card>
                ))}
              </div>

              {/* Waterfall Chart */}
              <Card className="p-4">
                <Skeleton className="h-3 w-52 mb-4" />
                <Skeleton className="h-[240px] w-full rounded-lg" />
              </Card>

              {/* Factor Detail Table */}
              <Card className="p-4">
                <Skeleton className="h-3 w-36 mb-4" />
                <div className="space-y-0">
                  <div className="flex gap-4 border-b-2 border-border pb-2">
                    {['w-32', 'w-16', 'w-20', 'w-24'].map((w, i) => (
                      <Skeleton key={i} className={`h-3 ${w}`} />
                    ))}
                  </div>
                  {[1, 2, 3, 4, 5].map(j => (
                    <div key={j} className="flex gap-4 py-2.5 border-b border-border">
                      <Skeleton className="h-3 w-32" />
                      <Skeleton className="h-3 w-16" />
                      <Skeleton className="h-4 w-20 rounded-full" />
                      <Skeleton className="h-3 w-24" />
                    </div>
                  ))}
                </div>
              </Card>
            </div>

            {/* Right Sidebar */}
            <div className="space-y-3.5">
              <Card className="p-4">
                <Skeleton className="h-3 w-28 mb-3" />
                <Skeleton className="h-6 w-20 mb-2" />
                <Skeleton className="h-3 w-full mb-1" />
                <Skeleton className="h-3 w-3/4" />
              </Card>
              <Card className="p-4">
                <Skeleton className="h-3 w-28 mb-3" />
                <div className="space-y-2">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="flex justify-between">
                      <Skeleton className="h-3 w-24" />
                      <Skeleton className="h-3 w-12" />
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </div>
        </div>
    );
  }

  const { waterfall, finalMultiple } = d.multiple;
  const baseMultipleValue = waterfall.length > 0 ? waterfall[0].value : 5.8;

  // Net adjustment = final - base
  const netAdjustment = Math.round((finalMultiple - baseMultipleValue) * 10) / 10;

  // Optimised multiple from value progression
  const optimisedMultiple = d.valueProgression.optimised.multiple;

  // Multiple range position description
  const rangeDesc = finalMultiple < 4.5 ? 'low end' : finalMultiple < 5.5 ? 'lower-mid range' : finalMultiple < 6.5 ? 'mid range' : 'upper range';

  // Identify top negative factors for blockers
  const negativeFactors = waterfall
    .filter(w => w.type === 'negative')
    .sort((a, b) => a.value - b.value); // most negative first

  const topBlockers = negativeFactors.slice(0, 2);

  // Uplift potential: negative factors that can be fixed
  const upliftItems = negativeFactors
    .filter(w => w.value < 0)
    .map(w => {
      const meta = FACTOR_META[w.label];
      return {
        label: meta?.displayLabel || w.label,
        value: Math.abs(w.value),
        fixable: meta?.status === 'action' || meta?.status === 'high-risk',
      };
    })
    .filter(item => item.fixable)
    .slice(0, 3);

  const potentialMultiple = Math.min(8.0, Math.round((finalMultiple + upliftItems.reduce((s, i) => s + i.value, 0)) * 10) / 10);

  // Build chart data for waterfall bar chart
  const chartData = waterfall.map(w => ({
    name: w.label.replace(/^[+−] /, '').replace(/\. /, '.'),
    value: w.value,
    color: w.type === 'base' ? 'hsl(var(--foreground))' : w.type === 'positive' ? 'hsl(var(--success))' : 'hsl(var(--danger))',
  }));

  return (
    <TooltipProvider>
      <div className="space-y-4">
        {/* Page Header */}
        <div>
          <h1 className="text-xl font-bold text-foreground">Multiple Engine</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Step-by-step valuation multiple decomposition</p>
        </div>

        {/* Main Layout: Left content + Right sidebar */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-3.5">

          {/* Left Column */}
          <div className="space-y-3.5">

            {/* Top 3 Summary Cards */}
            <div className="grid grid-cols-3 gap-3">
              {/* Base Multiple */}
              <Card className="p-4 text-center">
                <span className="text-[9.5px] font-bold tracking-wider uppercase text-muted-foreground block mb-2">Base Multiple</span>
                <div className="flex items-center justify-center gap-1">
                  <span className="text-[34px] font-bold text-foreground tabular-nums leading-none">{baseMultipleValue}x</span>
                  {!editingBase && (
                    <button
                      onClick={() => { setBaseInput(String(baseMultipleValue)); setEditingBase(true); }}
                      className="text-muted-foreground/40 hover:text-primary transition-colors mt-1"
                      type="button"
                      title="Edit base multiple"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                  )}
                </div>
                {editingBase ? (
                  <div className="mt-2">
                    <div className="flex items-center justify-center gap-1">
                      <input
                        type="number"
                        step="0.1"
                        min="3.0"
                        max="8.0"
                        value={baseInput}
                        onChange={(e) => setBaseInput(e.target.value)}
                        className="w-16 h-6 text-[12px] font-bold text-center tabular-nums border border-border rounded px-1 bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            const val = parseFloat(baseInput);
                            if (!isNaN(val) && val >= 3.0 && val <= 8.0) {
                              settingsApi.update({ base_multiple: Math.round(val * 10) / 10 });
                            }
                            setEditingBase(false);
                          } else if (e.key === 'Escape') {
                            setEditingBase(false);
                          }
                        }}
                      />
                      <button
                        onClick={() => {
                          const val = parseFloat(baseInput);
                          if (!isNaN(val) && val >= 3.0 && val <= 8.0) {
                            settingsApi.update({ base_multiple: Math.round(val * 10) / 10 });
                          }
                          setEditingBase(false);
                        }}
                        className="text-success hover:text-success/80" type="button"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => setEditingBase(false)} className="text-danger hover:text-danger/80" type="button">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="mt-2 p-2 bg-muted/50 rounded-md border border-border/50 text-left">
                      <div className="text-[8px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Changing this will also update</div>
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1 text-[9px]">
                          <span className="w-1 h-1 rounded-full bg-primary flex-shrink-0" />
                          <span className="text-muted-foreground">This page</span>
                          <span className="text-muted-foreground/40">&rarr;</span>
                          <span className="font-medium text-foreground">Net Adjustment &amp; Final Multiple</span>
                        </div>
                        <div className="flex items-center gap-1 text-[9px]">
                          <span className="w-1 h-1 rounded-full bg-primary flex-shrink-0" />
                          <span className="text-muted-foreground">This page</span>
                          <span className="text-muted-foreground/40">&rarr;</span>
                          <span className="font-medium text-foreground">Waterfall Chart &amp; Factor Table</span>
                        </div>
                        <div className="flex items-center gap-1 text-[9px]">
                          <span className="w-1 h-1 rounded-full bg-primary flex-shrink-0" />
                          <span className="text-muted-foreground">Enterprise Overview</span>
                          <span className="text-muted-foreground/40">&rarr;</span>
                          <span className="font-medium text-foreground">Enterprise Value &amp; Equity Value</span>
                        </div>
                        <div className="flex items-center gap-1 text-[9px]">
                          <span className="w-1 h-1 rounded-full bg-primary flex-shrink-0" />
                          <span className="text-muted-foreground">Enterprise Overview</span>
                          <span className="text-muted-foreground/40">&rarr;</span>
                          <span className="font-medium text-foreground">Value Progression</span>
                        </div>
                        <div className="flex items-center gap-1 text-[9px]">
                          <span className="w-1 h-1 rounded-full bg-primary flex-shrink-0" />
                          <span className="text-muted-foreground">EBITDA Bridge</span>
                          <span className="text-muted-foreground/40">&rarr;</span>
                          <span className="font-medium text-foreground">Anchor Bar (multiple &amp; EV)</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-[11px] text-muted-foreground mt-1">UK DSO benchmark</p>
                )}
              </Card>

              {/* Net Adjustment */}
              <Card className="p-4 text-center">
                <span className="text-[9.5px] font-bold tracking-wider uppercase text-muted-foreground block mb-2">Net Adjustment</span>
                <span className={cn('text-[34px] font-bold tabular-nums leading-none', netAdjustment >= 0 ? 'text-success' : 'text-danger')}>
                  {netAdjustment >= 0 ? '+' : ''}{netAdjustment}x
                </span>
                <p className="text-[11px] text-muted-foreground mt-1">
                  {netAdjustment >= 0 ? 'Positives outweigh risks' : 'Risk factors outweigh positives'}
                </p>
              </Card>

              {/* Final Multiple */}
              <Card className="p-4 text-center border-2 border-primary">
                <span className="text-[9.5px] font-bold tracking-wider uppercase text-primary block mb-2">Final Multiple</span>
                <span className="text-[34px] font-bold text-primary tabular-nums leading-none">{finalMultiple}x</span>
                <p className="text-[11px] text-primary/70 mt-1">Risk-adjusted buyer view</p>
              </Card>
            </div>

            {/* Waterfall Chart */}
            <Card className="p-4">
              <div className="flex items-center gap-1.5 mb-3">
                <span className="text-[9.5px] font-bold tracking-wider uppercase text-muted-foreground">
                  Multiple Walk &mdash; Step-by-Step Decomposition
                </span>
                <span className="text-[9px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded font-semibold font-mono">DentPulse model</span>
              </div>
              <div style={{ height: 220 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} barCategoryGap="20%">
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 9 }}
                      tickLine={false}
                      axisLine={false}
                      angle={-35}
                      textAnchor="end"
                      height={55}
                    />
                    <YAxis
                      tick={{ fontSize: 9 }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v: number) => `${v}x`}
                    />
                    <RTooltip
                      formatter={(value: number) => [`${value > 0 ? '+' : ''}${value}x`, 'Impact']}
                      contentStyle={{ fontSize: 11, borderRadius: 6 }}
                    />
                    <Bar dataKey="value" radius={[3, 3, 0, 0]}>
                      {chartData.map((entry, index) => (
                        <Cell key={index} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            {/* Factor Detail Table */}
            <Card className="p-4">
              <div className="flex items-center gap-1.5 mb-3">
                <span className="text-[9.5px] font-bold tracking-wider uppercase text-muted-foreground">Factor Detail Table</span>
                <span className="text-[9px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded font-semibold font-mono">Auto-calculated</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-[12px] border-collapse">
                  <thead>
                    <tr className="border-b-2 border-border">
                      <th className="text-left py-2 px-2.5 text-[11px] text-muted-foreground font-semibold">Factor</th>
                      <th className="text-left py-2 px-2.5 text-[11px] text-muted-foreground font-semibold">Impact</th>
                      <th className="text-left py-2 px-2.5 text-[11px] text-muted-foreground font-semibold">Source</th>
                      <th className="text-left py-2 px-2.5 text-[11px] text-muted-foreground font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      // Fixed set of factors to always display in the table
                      const FIXED_FACTORS = [
                        '+ Reporting', '+ Debt Mgmt', '− Assoc. Dep.',
                        '− Mgmt Depth', '− Standards', '− Leverage', '− Qual. Drag',
                      ];
                      const waterfallMap = new Map(waterfall.map(w => [w.label, w]));
                      return FIXED_FACTORS.map((label) => {
                        const w = waterfallMap.get(label);
                        const value = w?.value ?? 0;
                        const meta = FACTOR_META[label];
                        const info = MULTIPLE_INFO[label];
                        const statusCfg = meta ? STATUS_CONFIG[meta.status] : STATUS_CONFIG.auto;
                        return (
                          <tr key={label} className="border-b border-border hover:bg-muted/50 transition-colors">
                            <td className="py-2 px-2.5 text-muted-foreground">
                              <span className="flex items-center gap-1">
                                {meta?.displayLabel || label}
                                {info && <InfoButton info={info} />}
                              </span>
                            </td>
                            <td className={cn('py-2 px-2.5 font-semibold tabular-nums', value > 0 ? 'text-success' : value < 0 ? 'text-danger' : 'text-muted-foreground')}>
                              {value > 0 ? '+' : ''}{value}x
                            </td>
                            <td className="py-2 px-2.5 text-[11px] text-muted-foreground/70">
                              {meta?.source || 'Auto'}
                            </td>
                            <td className="py-2 px-2.5">
                              <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded', statusCfg.className)}>
                                {statusCfg.label}
                              </span>
                            </td>
                          </tr>
                        );
                      });
                    })()}
                    {/* Final row */}
                    <tr className="border-t-2 border-border bg-muted">
                      <td className="py-2.5 px-2.5 font-bold">Final Multiple</td>
                      <td className="py-2.5 px-2.5 font-bold text-[16px] tabular-nums text-foreground">{finalMultiple}x</td>
                      <td colSpan={2}></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          {/* Right Sidebar */}
          <div className="space-y-3.5">

            {/* Multiple Range */}
            <Card className="p-4 border-2 border-foreground/20">
              <span className="text-[9.5px] font-bold tracking-wider uppercase text-foreground block mb-3">Multiple Range</span>
              <div className="space-y-0 mb-3">
                <div className="flex justify-between items-baseline py-1.5 border-b border-border">
                  <span className="text-xs text-muted-foreground">Current</span>
                  <span className="text-xs font-semibold tabular-nums text-warning">{finalMultiple}x</span>
                </div>
                <div className="flex justify-between items-baseline py-1.5 border-b border-border">
                  <span className="text-xs text-muted-foreground">If optimised</span>
                  <span className="text-xs font-semibold tabular-nums text-primary">{optimisedMultiple}x</span>
                </div>
                <div className="flex justify-between items-baseline py-1.5">
                  <span className="text-xs text-muted-foreground">Market range</span>
                  <span className="text-xs font-semibold tabular-nums">4.0x &ndash; 8.0x</span>
                </div>
              </div>

              {/* Position insight */}
              <div className="bg-muted rounded-lg p-2.5 text-[11px] text-muted-foreground leading-relaxed">
                You are in the <strong className="text-foreground">{rangeDesc}</strong>.
                {topBlockers.length > 0 && (
                  <>
                    <br />
                    {topBlockers.length === 1 ? 'Main blocker: ' : 'Two main blockers: '}
                    {topBlockers.map((b, i) => {
                      const meta = FACTOR_META[b.label];
                      return (
                        <span key={b.label}>
                          {i > 0 && ' and '}
                          <strong className="text-danger">{meta?.displayLabel || b.label}</strong>
                        </span>
                      );
                    })}.
                  </>
                )}
              </div>
            </Card>

            {/* Uplift Potential */}
            <Card className="p-4">
              <span className="text-[9.5px] font-bold tracking-wider uppercase text-muted-foreground block mb-3">Uplift Potential</span>
              <div className="space-y-0">
                {upliftItems.map((item) => (
                  <div key={item.label} className="flex justify-between items-baseline py-1.5 border-b border-border">
                    <span className="text-xs text-muted-foreground">Fix {item.label.toLowerCase()}</span>
                    <span className="text-xs font-semibold tabular-nums text-success">+{item.value}x</span>
                  </div>
                ))}
                {/* Potential multiple */}
                <div className="flex justify-between items-baseline py-1.5">
                  <span className="text-xs font-semibold">Potential multiple</span>
                  <span className="text-[16px] font-bold tabular-nums text-primary">{potentialMultiple}x</span>
                </div>
              </div>
              <p className="text-[10.5px] text-muted-foreground italic mt-2.5">Assumes market conditions hold</p>
            </Card>

            {/* Value Impact */}
            <Card className="p-4 bg-foreground text-background">
              <span className="text-[9.5px] font-bold tracking-wider uppercase text-background/50 block mb-2">Value Impact</span>
              <div className="space-y-1.5 text-[11.5px]">
                <div className="flex justify-between">
                  <span className="text-background/60">Current EV</span>
                  <span className="font-semibold tabular-nums">{formatCurrency(d.enterpriseValue)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-background/60">If optimised</span>
                  <span className="font-semibold tabular-nums text-primary">{formatCurrency(d.valueProgression.optimised.value)}</span>
                </div>
                <div className="flex justify-between pt-1.5 border-t border-background/10">
                  <span className="text-background/60">Uplift</span>
                  <span className="font-bold tabular-nums text-primary text-[14px]">+{formatCurrency(d.valueProgression.opportunity)}</span>
                </div>
              </div>
            </Card>
          </div>
        </div>

        {/* Data Traceability Strip */}
        <div className="flex flex-wrap gap-4 p-2.5 px-3.5 bg-muted/50 rounded-lg border border-border text-[10.5px] text-muted-foreground">
          <span><strong className="text-foreground/70">Base Multiple</strong> &rarr; UK DSO benchmark (editable)</span>
          <span><strong className="text-foreground/70">Scale</strong> &rarr; {d.dataSource}</span>
          <span><strong className="text-foreground/70">Chair / Assoc.</strong> &rarr; PMS Dentally</span>
          <span><strong className="text-foreground/70">NHS Risk</strong> &rarr; UDA delivery data</span>
          <span><strong className="text-foreground/70">Quality Drag</strong> &rarr; DentPulse Quality Score</span>
        </div>
      </div>
    </TooltipProvider>
  );
}

// ─── HOST PAGE: Multiples (Quality Score + Multiple Engine tabs) ───

const MULTIPLES_TABS = ['quality-score', 'multiple-engine'] as const;
type MultiplesTab = typeof MULTIPLES_TABS[number];

export default function MultipleEngine() {
  const { canViewTab, tabs: ebitdaTabs } = useTabPermissions('ebitda_to_value');
  const [searchParams, setSearchParams] = useSearchParams();
  const tabFromUrl = searchParams.get('tab');

  const multiplesDefaultTab = useMemo<MultiplesTab | undefined>(
    () => MULTIPLES_TABS.find(t => ebitdaTabs.find(et => et.key === t)?.visible),
    [ebitdaTabs],
  );

  const resolveInitialTab = (): MultiplesTab => {
    if (tabFromUrl && (MULTIPLES_TABS as readonly string[]).includes(tabFromUrl) && canViewTab(tabFromUrl)) {
      return tabFromUrl as MultiplesTab;
    }
    return multiplesDefaultTab ?? 'quality-score';
  };
  const [activeTab, setActiveTab] = useState<MultiplesTab>(resolveInitialTab);

  useEffect(() => {
    if (tabFromUrl && tabFromUrl !== activeTab && (MULTIPLES_TABS as readonly string[]).includes(tabFromUrl) && canViewTab(tabFromUrl)) {
      setActiveTab(tabFromUrl as MultiplesTab);
    }
  }, [tabFromUrl]);

  useEffect(() => {
    if (multiplesDefaultTab && !canViewTab(activeTab)) {
      setActiveTab(multiplesDefaultTab);
    }
  }, [multiplesDefaultTab]);

  const handleTabChange = (tab: string) => {
    setActiveTab(tab as MultiplesTab);
    setSearchParams({ tab }, { replace: true });
  };

  return (
    <MainLayout userRole="admin">
      <Helmet>
        <title>Multiples | DentPulse</title>
        <meta name="description" content="EBITDA quality scoring and valuation multiple analysis" />
      </Helmet>

      <div className="space-y-4">
        <div>
          <h1 className="text-xl font-bold text-foreground">Multiples</h1>
          <p className="text-sm text-muted-foreground mt-0.5">EBITDA quality scoring and valuation multiple analysis</p>
        </div>

        <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
          <TabsList>
            {canViewTab('quality-score') && <TabsTrigger value="quality-score">Quality Score</TabsTrigger>}
            {canViewTab('multiple-engine') && <TabsTrigger value="multiple-engine">Multiple Engine</TabsTrigger>}
          </TabsList>

          <TabsContent value="quality-score" className="space-y-4">
            <QualityScoreContent />
          </TabsContent>

          <TabsContent value="multiple-engine" className="space-y-4">
            <MultipleEngineContent />
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}
