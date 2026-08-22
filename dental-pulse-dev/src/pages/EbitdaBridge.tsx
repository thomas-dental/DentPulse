import { useMemo } from 'react';
import { Helmet } from 'react-helmet-async';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useEbitdaValuation } from '@/hooks/useEbitdaValuation';
import { useFilters } from '@/contexts/FilterContext';
import { useLocations } from '@/hooks/useLocations';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
} from 'recharts';

const r2 = (n: number) => Math.round((n ?? 0) * 100) / 100;

// ─── HELPERS ───
const formatCurrency = (value: number): string =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);

// ─── MAIN PAGE ───
export default function EbitdaBridge() {
  const { valuation: d, isLoading } = useEbitdaValuation();
  const { selectedLocationId, dateRange } = useFilters();
  const { allAvailableLocations } = useLocations();
  const selectedLocationName = selectedLocationId
    ? (allAvailableLocations?.find(l => l.id === selectedLocationId)?.location_name ?? 'Selected location')
    : 'All locations';

  // Build waterfall chart data
  const waterfallData = useMemo(() => {
    if (!d) return [];

    const items: Array<{
      name: string;
      value: number;
      base: number;
      bar: number;
      color: string;
      type: 'anchor' | 'positive' | 'negative';
    }> = [];

    let running = 0;

    items.push({ name: 'Reported', value: d.reportedEBITDA, base: 0, bar: d.reportedEBITDA, color: 'hsl(var(--foreground))', type: 'anchor' });
    running = d.reportedEBITDA;

    for (const item of d.normalisationItems) {
      if (item.value > 0) {
        items.push({ name: '+ ' + item.label.split(' ').slice(0, 2).join(' '), value: item.value, base: running, bar: item.value, color: 'hsl(var(--success))', type: 'positive' });
      } else {
        items.push({ name: '- ' + item.label.split(' ').slice(0, 2).join(' '), value: item.value, base: running + item.value, bar: Math.abs(item.value), color: 'hsl(var(--danger))', type: 'negative' });
      }
      running += item.value;
    }

    if (d.netAdjustments !== 0) {
      items.push({ name: '= Adjusted', value: d.adjustedEBITDA, base: 0, bar: d.adjustedEBITDA, color: 'hsl(var(--foreground) / 0.7)', type: 'anchor' });
      running = d.adjustedEBITDA;
    }

    for (const item of d.sustainability.items) {
      if (item.value > 0) {
        items.push({ name: '+ ' + item.label.split(' ').slice(0, 2).join(' '), value: item.value, base: running, bar: item.value, color: 'hsl(var(--warning))', type: 'positive' });
      } else {
        items.push({ name: '- ' + item.label.split(' ').slice(0, 2).join(' '), value: item.value, base: running + item.value, bar: Math.abs(item.value), color: 'hsl(var(--danger))', type: 'negative' });
      }
      running += item.value;
    }

    items.push({ name: '= Sustainable', value: d.sustainableEBITDA, base: 0, bar: d.sustainableEBITDA, color: 'hsl(var(--primary))', type: 'anchor' });
    return items;
  }, [d]);

  const confidenceItems = useMemo(() => {
    if (!d) return [];
    return d.sustainability.items
      .filter(item => item.confidence)
      .map(item => ({
        label: item.label,
        rawValue: item.confidence ? Math.round(item.value / (parseInt(item.confidence) / 100)) : item.value,
        confidence: item.confidence!,
        appliedValue: item.value,
      }));
  }, [d]);

  const aiContextData = useMemo(() => {
    if (!d) return { page: 'ebitda-bridge', selectedLocationName };
    return {
      page: 'ebitda-bridge',
      selectedLocationName,
      period: { startDate: dateRange.startDate.toISOString().slice(0, 10), endDate: dateRange.endDate.toISOString().slice(0, 10) },
      dataSource: d.dataSource,
      reportedEBITDA: r2(d.reportedEBITDA),
      netAdjustments: r2(d.netAdjustments),
      adjustedEBITDA: r2(d.adjustedEBITDA),
      sustainabilityImpact: r2(d.sustainability.totalImpact),
      sustainableEBITDA: r2(d.sustainableEBITDA),
      normalisationItems: d.normalisationItems.slice(0, 30).map(i => ({ label: i.label, value: r2(i.value) })),
      sustainabilityItems: d.sustainability.items.slice(0, 30).map(i => ({
        label: i.label, value: r2(i.value), confidence: i.confidence ?? null,
      })),
      confidenceItems: confidenceItems.slice(0, 20).map(i => ({
        label: i.label, rawValue: r2(i.rawValue), confidence: i.confidence, appliedValue: r2(i.appliedValue),
      })),
    };
  }, [d, selectedLocationName, dateRange, confidenceItems]);

  if (isLoading || !d) {
    return (
      <MainLayout>
        <Helmet><title>EBITDA Bridge | DentPulse</title></Helmet>
        <div className="space-y-4">
          {/* Header */}
          <div>
            <Skeleton className="h-6 w-40 mb-2" />
            <Skeleton className="h-4 w-72" />
          </div>

          {/* 3 Summary Cards */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3.5">
            {[1, 2, 3].map(i => (
              <Card key={i} className="p-4 border-t-[3px] border-t-muted">
                <Skeleton className="h-3 w-28 mb-3" />
                <Skeleton className="h-8 w-36 mb-2" />
                <Skeleton className="h-3 w-32" />
              </Card>
            ))}
          </div>

          {/* Waterfall Chart */}
          <Card className="p-4">
            <Skeleton className="h-3 w-48 mb-4" />
            <Skeleton className="h-[260px] w-full rounded-lg" />
          </Card>

          {/* Two Detail Cards */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
            {[1, 2].map(i => (
              <Card key={i} className="p-4">
                <Skeleton className="h-3 w-40 mb-4" />
                <div className="space-y-3">
                  {[1, 2, 3].map(j => (
                    <div key={j} className="flex justify-between py-1.5 border-b border-border">
                      <Skeleton className="h-3 w-32" />
                      <Skeleton className="h-3 w-20" />
                    </div>
                  ))}
                </div>
              </Card>
            ))}
          </div>

          {/* Confidence Panel */}
          <Card className="p-4">
            <Skeleton className="h-3 w-44 mb-4" />
            <div className="space-y-2">
              <div className="flex gap-4 border-b-2 border-border pb-2">
                {['w-24', 'w-20', 'w-20', 'w-20'].map((w, i) => (
                  <Skeleton key={i} className={`h-3 ${w}`} />
                ))}
              </div>
              {[1, 2, 3].map(j => (
                <div key={j} className="flex gap-4 py-1.5 border-b border-border">
                  {['w-28', 'w-16', 'w-16', 'w-16'].map((w, i) => (
                    <Skeleton key={i} className={`h-3 ${w}`} />
                  ))}
                </div>
              ))}
            </div>
          </Card>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout userRole="admin" aiContext={aiContextData}>
      <Helmet>
        <title>EBITDA Bridge | DentPulse</title>
        <meta name="description" content="Full EBITDA waterfall bridge from reported to sustainable earnings" />
      </Helmet>

      <div className="space-y-4">
        {/* Header */}
        <div>
          <h1 className="text-xl font-bold text-foreground">EBITDA Bridge</h1>
          <p className="text-sm text-muted-foreground mt-0.5">From reported earnings to sustainable operating performance</p>
        </div>

        {/* 3 Summary Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3.5">
          <Card className="p-4 border-t-[3px] border-t-foreground">
            <span className="text-[9.5px] font-bold tracking-wider uppercase text-muted-foreground">Reported EBITDA</span>
            <div className="text-[28px] font-bold text-foreground tabular-nums mt-1">{formatCurrency(d.reportedEBITDA)}</div>
            <p className="text-[11px] text-muted-foreground mt-1">Pre-normalisation baseline</p>
          </Card>
          <Card className="p-4 border-t-[3px] border-t-success">
            <span className="text-[9.5px] font-bold tracking-wider uppercase text-muted-foreground">Adjusted EBITDA</span>
            <div className="text-[28px] font-bold text-success tabular-nums mt-1">{formatCurrency(d.adjustedEBITDA)}</div>
            <p className="text-[11px] text-muted-foreground mt-1">
              {d.netAdjustments >= 0 ? '+' : ''}{formatCurrency(d.netAdjustments)} normalisation
            </p>
          </Card>
          <Card className="p-4 border-t-[3px] border-t-primary">
            <span className="text-[9.5px] font-bold tracking-wider uppercase text-muted-foreground">Sustainable EBITDA™</span>
            <div className="text-[28px] font-bold text-primary tabular-nums mt-1">{formatCurrency(d.sustainableEBITDA)}</div>
            <p className="text-[11px] text-muted-foreground mt-1">
              {d.sustainability.totalImpact >= 0 ? '+' : ''}{formatCurrency(d.sustainability.totalImpact)} sustainability
            </p>
          </Card>
        </div>

        {/* Waterfall Chart */}
        {waterfallData.length > 0 && (
          <Card className="p-4">
            <div className="flex items-center gap-1.5 mb-3">
              <span className="text-[9.5px] font-bold tracking-wider uppercase text-muted-foreground">EBITDA Waterfall — Full Bridge</span>
              <span className="text-[9px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded font-semibold font-mono">{d.dataSource}</span>
            </div>
            <div style={{ height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={waterfallData} barCategoryGap="20%">
                  <XAxis dataKey="name" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} angle={-35} textAnchor="end" height={60} />
                  <YAxis tick={{ fontSize: 9 }} tickLine={false} axisLine={false} tickFormatter={(v: number) => formatCurrency(v)} />
                  <Tooltip
                    formatter={(value: number, name: string) => {
                      if (name === 'base') return [null, null];
                      return [formatCurrency(value), 'Amount'];
                    }}
                    labelStyle={{ fontSize: 11, fontWeight: 600 }}
                    contentStyle={{ fontSize: 11, borderRadius: 6 }}
                  />
                  <Bar dataKey="base" stackId="stack" fill="transparent" radius={0} />
                  <Bar dataKey="bar" stackId="stack" radius={[3, 3, 0, 0]}>
                    {waterfallData.map((entry, index) => (
                      <Cell key={index} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        )}

        {/* Normalisation + Sustainability Detail */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
          <Card className="p-4">
            <span className="text-[9.5px] font-bold tracking-wider uppercase text-muted-foreground mb-3 block">
              Normalisation Detail ({d.netAdjustments >= 0 ? '+' : ''}{formatCurrency(d.netAdjustments)})
            </span>
            {d.normalisationItems.length > 0 ? (
              d.normalisationItems.map((item, i) => (
                <div key={i} className="flex justify-between py-1.5 border-b border-border last:border-b-0">
                  <span className="text-xs text-muted-foreground">{item.label}</span>
                  <span className={cn('text-xs font-semibold tabular-nums', item.value > 0 ? 'text-success' : 'text-danger')}>
                    {item.value > 0 ? '+' : ''}{formatCurrency(item.value)}
                  </span>
                </div>
              ))
            ) : (
              <div className="text-center py-6">
                <p className="text-xs text-muted-foreground italic">No normalisation adjustments configured.</p>
              </div>
            )}
          </Card>

          <Card className="p-4">
            <span className="text-[9.5px] font-bold tracking-wider uppercase text-muted-foreground mb-3 block">
              Sustainability Detail ({d.sustainability.totalImpact >= 0 ? '+' : ''}{formatCurrency(d.sustainability.totalImpact)})
            </span>
            {d.sustainability.items.length > 0 ? (
              d.sustainability.items.map((item, i) => (
                <div key={i} className="flex justify-between py-1.5 border-b border-border last:border-b-0">
                  <span className="text-xs text-muted-foreground">
                    {item.label}
                    {item.confidence && (
                      <span className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-warning-muted text-warning">
                        {item.confidence}
                      </span>
                    )}
                  </span>
                  <span className={cn('text-xs font-semibold tabular-nums', item.value > 0 ? 'text-success' : 'text-danger')}>
                    {item.value > 0 ? '+' : ''}{formatCurrency(item.value)}
                  </span>
                </div>
              ))
            ) : (
              <p className="text-xs text-muted-foreground italic">No sustainability haircuts calculated for this period.</p>
            )}
          </Card>
        </div>

        {/* Confidence Weighting Panel */}
        {confidenceItems.length > 0 && (
          <Card className="p-4">
            <span className="text-[9.5px] font-bold tracking-wider uppercase text-muted-foreground mb-1 block">Confidence Weighting Panel</span>
            <p className="text-[10px] text-muted-foreground mb-3 leading-relaxed">
              Forward-looking assumptions are discounted by a confidence percentage. <strong>Applied = Raw Value × Confidence %</strong>.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b-2 border-border">
                    <th className="text-left py-1.5 px-2 font-semibold text-muted-foreground">Item</th>
                    <th className="text-right py-1.5 px-2 font-semibold text-muted-foreground">Raw Value <span className="font-normal text-[8px]">(full amount)</span></th>
                    <th className="text-center py-1.5 px-2 font-semibold text-muted-foreground">Confidence</th>
                    <th className="text-right py-1.5 px-2 font-semibold text-muted-foreground">Applied <span className="font-normal text-[8px]">(used in EBITDA)</span></th>
                    <th className="text-right py-1.5 px-2 font-semibold text-muted-foreground">Formula</th>
                  </tr>
                </thead>
                <tbody>
                  {confidenceItems.map((item, i) => (
                    <tr key={i} className="border-b border-border">
                      <td className="py-2 px-2">{item.label}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{formatCurrency(item.rawValue)}</td>
                      <td className="py-2 px-2 text-center">
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-warning-muted text-warning">
                          {item.confidence}
                        </span>
                      </td>
                      <td className="py-2 px-2 text-right font-semibold text-success tabular-nums">{formatCurrency(item.appliedValue)}</td>
                      <td className="py-2 px-2 text-right text-[9px] font-mono text-muted-foreground">
                        {formatCurrency(item.rawValue)} × {item.confidence}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-muted-foreground italic mt-2.5">"We apply investor-style haircuts to forward assumptions — only the confidence-weighted portion flows into Sustainable EBITDA."</p>
          </Card>
        )}
      </div>
    </MainLayout>
  );
}
