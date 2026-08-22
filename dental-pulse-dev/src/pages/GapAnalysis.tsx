import { useMemo, useState, useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
import { useSearchParams } from 'react-router-dom';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip as UITooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useEbitdaValuation } from '@/hooks/useEbitdaValuation';
import { useTabPermissions } from '@/hooks/useTabPermissions';
import { ScenarioSimulatorContent } from './ScenarioSimulator';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  Tooltip,
} from 'recharts';

const formatCurrency = (value: number): string =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);

const formatCompact = formatCurrency;

function InfoTip({ description, calculation }: { description: string; calculation: string }) {
  return (
    <UITooltip delayDuration={200}>
      <TooltipTrigger asChild>
        <button className="flex-shrink-0 text-muted-foreground/50 hover:text-primary transition-colors ml-1 align-middle" type="button">
          <Info className="w-3 h-3" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" align="start" className="w-[300px] p-3 shadow-lg border bg-popover z-[100]">
        <p className="text-[11px] font-medium text-popover-foreground mb-1.5 whitespace-normal break-words">{description}</p>
        <p className="text-[10px] text-muted-foreground font-mono leading-relaxed whitespace-normal break-words">{calculation}</p>
      </TooltipContent>
    </UITooltip>
  );
}

export function GapAnalysisContent() {
  const { valuation: d, isLoading } = useEbitdaValuation();

  const gapData = useMemo(() => {
    if (!d) return null;

    const baseItem = d.multiple.waterfall.find(w => w.type === 'base');
    const ownerEbitda = d.adjustedEBITDA;
    const ownerMultiple = baseItem?.value ?? d.multiple.finalMultiple;
    const ownerValue = ownerEbitda * ownerMultiple;

    const buyerEbitda = d.sustainableEBITDA;
    const buyerMultiple = d.multiple.finalMultiple;
    const buyerValue = d.enterpriseValue;

    const totalGap = ownerValue - buyerValue;
    const ebitdaGap = (ownerEbitda - buyerEbitda) * buyerMultiple;
    const multipleGap = totalGap - ebitdaGap;

    // Gap drivers — show the formula so users understand how £ impact is derived
    const drivers = [
      ...d.multiple.waterfall
        .filter(f => f.value < 0)
        .map(f => ({
          label: f.label.replace(/^[−\-]\s*/, ''),
          value: Math.abs(f.value) * buyerEbitda,
          type: 'multiple' as const,
          formula: `${Math.abs(f.value).toFixed(1)}× penalty × ${formatCurrency(buyerEbitda)} EBITDA`,
          penaltyRaw: Math.abs(f.value),
        })),
      ...d.sustainability.items
        .filter(i => i.value < 0)
        .map(i => ({
          label: i.label,
          value: Math.abs(i.value) * buyerMultiple,
          type: 'ebitda' as const,
          formula: `${formatCurrency(Math.abs(i.value))} haircut × ${buyerMultiple.toFixed(1)}× multiple`,
          penaltyRaw: Math.abs(i.value),
        })),
    ].sort((a, b) => b.value - a.value).slice(0, 5);

    // If top 3 resolved
    const top3 = drivers.slice(0, 3);
    const top3EbitdaItems = top3.filter(d => d.type === 'ebitda');
    const top3MultipleItems = top3.filter(d => d.type === 'multiple');
    const ebitdaAddBack = top3EbitdaItems.reduce((s, d) => s + d.value / buyerMultiple, 0);
    const multipleAddBack = top3MultipleItems.reduce((s, d) => s + d.value / buyerEbitda, 0);
    const resolvedEbitda = buyerEbitda + ebitdaAddBack;
    const resolvedMultiple = Math.min(8.0, buyerMultiple + multipleAddBack);
    const resolvedEV = resolvedEbitda * resolvedMultiple;

    return {
      ownerEbitda, ownerMultiple, ownerValue,
      buyerEbitda, buyerMultiple, buyerValue,
      totalGap, ebitdaGap, multipleGap,
      drivers,
      resolved: {
        ebitda: resolvedEbitda,
        multiple: resolvedMultiple,
        ev: resolvedEV,
        uplift: resolvedEV - buyerValue,
        top3,
        ebitdaAddBack,
        multipleAddBack,
      },
      donutData: [
        { name: 'Multiple Compression', value: Math.abs(multipleGap) },
        { name: 'EBITDA Gap', value: Math.abs(ebitdaGap) },
      ],
    };
  }, [d]);

  if (isLoading || !d || !gapData) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-48 mb-2" />
        <div className="grid grid-cols-3 gap-3.5">
          {[1, 2, 3].map(i => <Card key={i} className="p-6"><Skeleton className="h-16 w-full" /></Card>)}
        </div>
      </div>
    );
  }

  const multiPct = gapData.totalGap > 0 ? Math.round(Math.abs(gapData.multipleGap) / gapData.totalGap * 100) : 50;
  const ebitdaPct = 100 - multiPct;

  return (
      <div className="space-y-3.5">

        {/* Page Header */}
        <div>
          <h1 className="text-xl font-bold text-foreground">Valuation Gap Analysis</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Owner vs buyer valuation gap breakdown and resolution path</p>
        </div>

        {/* Hero: Owner vs Buyer */}
        <div className="grid grid-cols-[1fr_auto_1fr] gap-2.5 items-center">
          <Card className="border-2 border-success text-center p-5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-success mb-2">
              Owner's View
              <InfoTip description="What the owner believes the business is worth — uses adjusted EBITDA (before sustainability haircuts) and the base market multiple." calculation="Adjusted EBITDA × Base Multiple" />
            </div>
            <div className="text-[44px] font-bold text-success tabular-nums leading-none">{formatCompact(gapData.ownerValue)}</div>
            <div className="mt-2.5 text-xs text-muted-foreground">EBITDA: <strong>{formatCompact(gapData.ownerEbitda)}</strong>
              <InfoTip description="Adjusted EBITDA after normalisation add-backs, before sustainability haircuts." calculation="Reported EBITDA + Net Normalisation Adjustments" />
            </div>
            <div className="text-xs text-muted-foreground">Multiple: <strong>{gapData.ownerMultiple.toFixed(1)}×</strong>
              <InfoTip description="Base market multiple before risk adjustments — the starting point for UK dental group valuations." calculation="Configurable in EBITDA settings (default 5.8×)" />
            </div>
          </Card>

          <div className="text-center px-2">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">
              Gap
              <InfoTip description="The difference between the owner's view and the buyer's view — representing the total value at risk during negotiation." calculation="Owner Value − Buyer Value = EBITDA Gap + Multiple Gap" />
            </div>
            <div className="text-[28px] font-bold text-warning tabular-nums">{formatCompact(gapData.totalGap)}</div>
            <div className="text-[10px] text-muted-foreground mt-1 leading-tight italic">"This is what the<br />market takes today"</div>
          </div>

          <Card className="border-2 border-danger text-center p-5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-danger mb-2">
              Buyer's View
              <InfoTip description="What a buyer would pay — uses Sustainable EBITDA™ (after sustainability haircuts) and the risk-adjusted final multiple." calculation="Sustainable EBITDA™ × Final Multiple" />
            </div>
            <div className="text-[44px] font-bold text-danger tabular-nums leading-none">{formatCompact(gapData.buyerValue)}</div>
            <div className="mt-2.5 text-xs text-muted-foreground">EBITDA: <strong>{formatCompact(gapData.buyerEbitda)}</strong>
              <InfoTip description="Sustainable EBITDA™ after all sustainability haircuts (associate risk, NHS clawback, chair downtime, etc.)." calculation="Adjusted EBITDA − Net Sustainability Haircuts" />
            </div>
            <div className="text-xs text-muted-foreground">Multiple: <strong>{gapData.buyerMultiple.toFixed(1)}×</strong>
              <InfoTip description="Risk-adjusted multiple after all premiums and penalties from the Multiple Engine." calculation="Base Multiple + Premiums − Penalties" />
            </div>
          </Card>
        </div>

        {/* Gap Drivers + Donut */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
          {/* Gap Drivers */}
          <Card className="p-4">
            <div className="text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
              Gap Drivers — Ranked by £ Impact
              <InfoTip description="The biggest factors explaining the gap between what the owner expects and what a buyer will pay — ranked by monetary impact." calculation="Multiple impact = |Penalty| × Sustainable EBITDA. EBITDA impact = |Haircut| × Final Multiple." />
            </div>
            <p className="text-[10px] text-muted-foreground mb-3 leading-relaxed">
              Each driver shows the <strong>raw penalty</strong> and how it converts to a <strong>£ value gap</strong>.
            </p>
            <div className="space-y-0">
              {gapData.drivers.map((driver, i) => (
                <div key={i} className="py-2.5 border-b last:border-b-0">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-5 h-5 rounded-full bg-foreground text-background text-[10px] font-bold flex items-center justify-center flex-shrink-0">{i + 1}</div>
                      <div>
                        <span className="text-[12.5px] font-medium">{driver.label}</span>
                        <span className={cn('ml-1.5 inline-block text-[9px] font-semibold px-1.5 py-0.5 rounded',
                          driver.type === 'multiple' ? 'bg-danger/10 text-danger' : 'bg-warning/10 text-warning'
                        )}>
                          {driver.type === 'multiple' ? 'Multiple penalty' : 'EBITDA haircut'}
                        </span>
                      </div>
                    </div>
                    <div className="text-[13px] font-bold text-danger tabular-nums flex-shrink-0">-{formatCompact(driver.value)}</div>
                  </div>
                  <div className="ml-[30px] mt-1 text-[10px] text-muted-foreground font-mono">{driver.formula} = {formatCurrency(driver.value)}</div>
                </div>
              ))}
              <div className="mt-2.5 p-2 bg-muted rounded-md flex justify-between text-[11.5px] font-semibold">
                <span>Total from top {gapData.drivers.length} drivers</span>
                <span className="text-danger">-{formatCompact(gapData.drivers.reduce((s, d) => s + d.value, 0))}</span>
              </div>
            </div>
          </Card>

          <div className="space-y-3.5">
            {/* Donut */}
            <Card className="p-4">
              <div className="text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
                EBITDA vs Multiple Gap Split
                <InfoTip
                  description="Breaks the total gap into two causes: how much is from lower earnings (sustainability haircuts) vs how much is from a lower valuation multiple (risk penalties)."
                  calculation={`EBITDA Gap = (${formatCurrency(gapData.ownerEbitda)} − ${formatCurrency(gapData.buyerEbitda)}) × ${gapData.buyerMultiple.toFixed(1)}× = ${formatCurrency(Math.abs(gapData.ebitdaGap))}. Multiple Gap = Total Gap − EBITDA Gap = ${formatCurrency(Math.abs(gapData.multipleGap))}.`}
                />
              </div>
              <p className="text-[10px] text-muted-foreground mb-2 leading-relaxed">
                Of the <strong>{formatCurrency(gapData.totalGap)}</strong> total gap, how much comes from <strong>lower earnings</strong> vs a <strong>lower multiple</strong>?
              </p>
              <div className="h-[130px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={gapData.donutData} dataKey="value" innerRadius="55%" outerRadius="80%" paddingAngle={2} strokeWidth={0}>
                      <Cell fill="hsl(var(--danger))" />
                      <Cell fill="hsl(var(--warning))" />
                    </Pie>
                    <Legend iconSize={10} wrapperStyle={{ fontSize: '10px' }} />
                    <Tooltip formatter={(v: number) => formatCompact(v)} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              {/* Breakdown table */}
              <div className="mt-2 space-y-0 text-[11px]">
                <div className="flex justify-between py-1 border-b">
                  <span className="text-muted-foreground flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-danger inline-block" /> Multiple Compression ({multiPct}%)</span>
                  <span className="font-semibold tabular-nums text-danger">{formatCurrency(Math.abs(gapData.multipleGap))}</span>
                </div>
                <div className="flex justify-between py-1 border-b">
                  <span className="text-muted-foreground flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-warning inline-block" /> EBITDA Gap ({ebitdaPct}%)</span>
                  <span className="font-semibold tabular-nums text-warning">{formatCurrency(Math.abs(gapData.ebitdaGap))}</span>
                </div>
                <div className="flex justify-between py-1 font-semibold">
                  <span>Total Gap</span>
                  <span className="tabular-nums">{formatCurrency(gapData.totalGap)}</span>
                </div>
              </div>
              <div className="mt-2.5 p-2.5 bg-foreground rounded-md text-white text-[11.5px] text-center leading-relaxed">
                "Most of your value gap is <strong className="text-emerald-400">{multiPct > ebitdaPct ? 'multiple compression' : 'earnings gap'}</strong> — {multiPct > ebitdaPct
                  ? 'buyers are applying more risk penalties, reducing the valuation multiple.'
                  : 'sustainability haircuts are reducing your EBITDA below what the owner expects.'}"
              </div>
            </Card>

            {/* If top 3 resolved */}
            <Card className="p-4 border-success">
              <div className="text-[9.5px] font-bold uppercase tracking-wider text-success mb-1">
                If Top 3 Issues Resolved
                <InfoTip description="Projected valuation if the three largest gap drivers are fully addressed — shows the maximum near-term uplift." calculation="Top 3 selected by largest £ impact. Multiple penalties add back to the multiple. EBITDA haircuts add back to EBITDA. Multiple capped at 8.0×." />
              </div>
              <p className="text-[10px] text-muted-foreground mb-2.5 leading-relaxed">
                The 3 biggest gap drivers by £ impact — resolving them improves EBITDA and/or the multiple.
              </p>

              {/* Which 3 issues — show type and contribution */}
              <div className="mb-3 space-y-1.5">
                {gapData.resolved.top3.map((item, i) => (
                  <div key={i} className="flex items-start gap-1.5 text-[10px]">
                    <span className="w-3.5 h-3.5 rounded-full bg-success/20 text-success text-[8px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-foreground truncate">{item.label}</span>
                        <span className={cn('text-[8px] font-semibold px-1 py-0.5 rounded flex-shrink-0',
                          item.type === 'multiple' ? 'bg-danger/10 text-danger' : 'bg-warning/10 text-warning'
                        )}>
                          {item.type === 'multiple' ? 'Multiple' : 'EBITDA'}
                        </span>
                      </div>
                      <div className="text-[9px] text-muted-foreground font-mono mt-0.5">
                        {item.type === 'multiple'
                          ? `Removes ${item.penaltyRaw.toFixed(1)}× penalty → multiple improves by +${item.penaltyRaw.toFixed(1)}×`
                          : `Removes ${formatCurrency(item.penaltyRaw)} haircut → EBITDA improves by +${formatCurrency(item.penaltyRaw)}`
                        }
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Step-by-step multiple buildup */}
              {gapData.resolved.multipleAddBack > 0 && (
                <div className="mb-2.5 p-2 bg-muted/50 rounded text-[10px] font-mono text-muted-foreground leading-relaxed">
                  <div className="font-semibold text-foreground mb-1 text-[9px] uppercase tracking-wider">Multiple buildup</div>
                  <div>Current multiple: {gapData.buyerMultiple.toFixed(1)}×</div>
                  {gapData.resolved.top3.filter(d => d.type === 'multiple').map((item, i) => (
                    <div key={i}>+ {item.penaltyRaw.toFixed(1)}× ({item.label})</div>
                  ))}
                  <div className="border-t border-border mt-1 pt-1 font-semibold text-success">
                    = {Math.min(8.0, gapData.buyerMultiple + gapData.resolved.multipleAddBack).toFixed(1)}×{' '}
                    {gapData.buyerMultiple + gapData.resolved.multipleAddBack > 8.0 && <span className="text-warning">(capped at 8.0×)</span>}
                  </div>
                </div>
              )}

              {/* EBITDA buildup */}
              {gapData.resolved.ebitdaAddBack > 0 && (
                <div className="mb-2.5 p-2 bg-muted/50 rounded text-[10px] font-mono text-muted-foreground leading-relaxed">
                  <div className="font-semibold text-foreground mb-1 text-[9px] uppercase tracking-wider">EBITDA buildup</div>
                  <div>Current EBITDA: {formatCurrency(gapData.buyerEbitda)}</div>
                  {gapData.resolved.top3.filter(d => d.type === 'ebitda').map((item, i) => (
                    <div key={i}>+ {formatCurrency(item.penaltyRaw)} ({item.label})</div>
                  ))}
                  <div className="border-t border-border mt-1 pt-1 font-semibold text-success">= {formatCurrency(gapData.resolved.ebitda)}</div>
                </div>
              )}

              {/* Final result */}
              <div className="space-y-0">
                <div className="flex justify-between py-1.5 border-b text-xs">
                  <span className="text-muted-foreground">Resolved EBITDA</span>
                  <span className="font-semibold text-success tabular-nums">{formatCompact(gapData.resolved.ebitda)}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b text-xs">
                  <span className="text-muted-foreground">Resolved Multiple</span>
                  <span className="font-semibold text-success tabular-nums">{gapData.resolved.multiple.toFixed(1)}×</span>
                </div>
                <div className="flex justify-between py-1.5 border-b text-xs">
                  <span className="text-muted-foreground">Resolved Enterprise Value</span>
                  <span className="font-semibold text-success tabular-nums">{formatCompact(gapData.resolved.ev)}</span>
                </div>
                <div className="flex justify-between py-1.5 text-xs">
                  <span className="font-semibold">Uplift vs today</span>
                  <span className="font-bold text-primary text-base tabular-nums">+{formatCompact(gapData.resolved.uplift)}</span>
                </div>
              </div>
              <div className="mt-2 text-[9px] text-muted-foreground font-mono leading-relaxed">
                {formatCurrency(gapData.resolved.ebitda)} × {gapData.resolved.multiple.toFixed(1)}× = {formatCurrency(gapData.resolved.ev)}
              </div>
            </Card>
          </div>
        </div>
        {/* ── HOW IT WORKS ── */}
        <Card className="p-5">
          <div className="text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground mb-4">How Gap Analysis Works — Step by Step</div>

          {/* STEP 1 — Two Valuations */}
          <div className="mb-5">
            <div className="flex items-center gap-2 mb-2.5">
              <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center flex-shrink-0">1</span>
              <span className="text-[12px] font-semibold">Two separate valuations are calculated</span>
            </div>
            <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-stretch ml-7">
              {/* Owner */}
              <div className="border-2 border-success/40 rounded-lg p-3 text-center">
                <div className="text-[9px] font-bold uppercase tracking-wider text-success mb-1.5">Owner's View</div>
                <div className="text-[10px] text-muted-foreground mb-1">Uses <strong>Adjusted EBITDA</strong></div>
                <div className="text-[10px] text-muted-foreground mb-2">(before sustainability haircuts)</div>
                <div className="bg-muted/50 rounded p-2 font-mono text-[10px] leading-relaxed">
                  <div>{formatCurrency(gapData.ownerEbitda)}</div>
                  <div className="text-muted-foreground/60">×</div>
                  <div>{gapData.ownerMultiple.toFixed(1)}× <span className="text-muted-foreground">(base)</span></div>
                  <div className="border-t border-border mt-1.5 pt-1.5 font-bold text-success">{formatCurrency(gapData.ownerValue)}</div>
                </div>
              </div>
              {/* vs */}
              <div className="flex items-center">
                <span className="text-[10px] font-bold text-muted-foreground/50 px-1">vs</span>
              </div>
              {/* Buyer */}
              <div className="border-2 border-danger/40 rounded-lg p-3 text-center">
                <div className="text-[9px] font-bold uppercase tracking-wider text-danger mb-1.5">Buyer's View</div>
                <div className="text-[10px] text-muted-foreground mb-1">Uses <strong>Sustainable EBITDA</strong></div>
                <div className="text-[10px] text-muted-foreground mb-2">(after sustainability haircuts)</div>
                <div className="bg-muted/50 rounded p-2 font-mono text-[10px] leading-relaxed">
                  <div>{formatCurrency(gapData.buyerEbitda)}</div>
                  <div className="text-muted-foreground/60">×</div>
                  <div>{gapData.buyerMultiple.toFixed(1)}× <span className="text-muted-foreground">(risk-adjusted)</span></div>
                  <div className="border-t border-border mt-1.5 pt-1.5 font-bold text-danger">{formatCurrency(gapData.buyerValue)}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Connector arrow */}
          <div className="flex justify-center mb-4">
            <div className="w-px h-6 bg-border relative">
              <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-t-[6px] border-t-border" />
            </div>
          </div>

          {/* STEP 2 — The Gap */}
          <div className="mb-5">
            <div className="flex items-center gap-2 mb-2.5">
              <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center flex-shrink-0">2</span>
              <span className="text-[12px] font-semibold">The difference is the "Gap"</span>
            </div>
            <div className="ml-7 bg-warning/5 border border-warning/30 rounded-lg p-3">
              <div className="font-mono text-[11px] text-center leading-relaxed">
                <span className="text-success font-semibold">{formatCurrency(gapData.ownerValue)}</span>
                <span className="text-muted-foreground mx-2">−</span>
                <span className="text-danger font-semibold">{formatCurrency(gapData.buyerValue)}</span>
                <span className="text-muted-foreground mx-2">=</span>
                <span className="text-warning font-bold text-[13px]">{formatCurrency(gapData.totalGap)}</span>
                <span className="text-muted-foreground ml-1">gap</span>
              </div>
              <p className="text-[10px] text-muted-foreground text-center mt-2 italic">
                This is the value the market "takes" — the gap between what you think it's worth and what a buyer will pay.
              </p>
            </div>
          </div>

          {/* Connector arrow */}
          <div className="flex justify-center mb-4">
            <div className="w-px h-6 bg-border relative">
              <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-t-[6px] border-t-border" />
            </div>
          </div>

          {/* STEP 3 — Gap splits into two causes */}
          <div className="mb-5">
            <div className="flex items-center gap-2 mb-2.5">
              <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center flex-shrink-0">3</span>
              <span className="text-[12px] font-semibold">The gap has two causes</span>
            </div>
            <div className="ml-7 grid grid-cols-2 gap-2.5">
              <div className="border border-warning/40 rounded-lg p-3">
                <div className="text-[9px] font-bold uppercase tracking-wider text-warning mb-2">EBITDA Gap ({ebitdaPct}%)</div>
                <div className="text-[13px] font-bold text-warning tabular-nums mb-2">{formatCurrency(Math.abs(gapData.ebitdaGap))}</div>
                <div className="text-[10px] text-muted-foreground leading-relaxed mb-2">
                  Sustainability haircuts reduce your EBITDA from <strong>{formatCurrency(gapData.ownerEbitda)}</strong> to <strong>{formatCurrency(gapData.buyerEbitda)}</strong>.
                </div>
                <div className="bg-muted/50 rounded p-2 font-mono text-[9px] leading-relaxed text-muted-foreground">
                  ({formatCurrency(gapData.ownerEbitda)} − {formatCurrency(gapData.buyerEbitda)}) × {gapData.buyerMultiple.toFixed(1)}×
                  <div className="font-semibold text-warning mt-0.5">= {formatCurrency(Math.abs(gapData.ebitdaGap))}</div>
                </div>
                <div className="mt-2 text-[9px] text-muted-foreground">
                  <strong>Sources:</strong> chair downtime, associate departure risk, NHS clawback, etc.
                </div>
              </div>
              <div className="border border-danger/40 rounded-lg p-3">
                <div className="text-[9px] font-bold uppercase tracking-wider text-danger mb-2">Multiple Gap ({multiPct}%)</div>
                <div className="text-[13px] font-bold text-danger tabular-nums mb-2">{formatCurrency(Math.abs(gapData.multipleGap))}</div>
                <div className="text-[10px] text-muted-foreground leading-relaxed mb-2">
                  Risk penalties reduce the multiple from <strong>{gapData.ownerMultiple.toFixed(1)}×</strong> to <strong>{gapData.buyerMultiple.toFixed(1)}×</strong>.
                </div>
                <div className="bg-muted/50 rounded p-2 font-mono text-[9px] leading-relaxed text-muted-foreground">
                  Total gap − EBITDA gap
                  <div>{formatCurrency(gapData.totalGap)} − {formatCurrency(Math.abs(gapData.ebitdaGap))}</div>
                  <div className="font-semibold text-danger mt-0.5">= {formatCurrency(Math.abs(gapData.multipleGap))}</div>
                </div>
                <div className="mt-2 text-[9px] text-muted-foreground">
                  <strong>Sources:</strong> associate dependency, management depth, NHS risk, standardisation, leverage, quality drag.
                </div>
              </div>
            </div>
          </div>

          {/* Connector arrow */}
          <div className="flex justify-center mb-4">
            <div className="w-px h-6 bg-border relative">
              <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-t-[6px] border-t-border" />
            </div>
          </div>

          {/* STEP 4 — Gap Drivers */}
          <div className="mb-5">
            <div className="flex items-center gap-2 mb-2.5">
              <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center flex-shrink-0">4</span>
              <span className="text-[12px] font-semibold">Individual penalties are ranked by £ impact</span>
            </div>
            <div className="ml-7">
              <p className="text-[10px] text-muted-foreground mb-2.5 leading-relaxed">
                Every negative item from the <strong>Multiple Engine</strong> (penalties) and <strong>Sustainability Haircuts</strong> (EBITDA deductions) is converted to a £ value and sorted largest first:
              </p>
              <div className="grid grid-cols-2 gap-2.5 mb-2.5">
                <div className="bg-danger/5 border border-danger/20 rounded p-2.5">
                  <div className="text-[9px] font-bold text-danger uppercase tracking-wider mb-1">Multiple penalty → £ value</div>
                  <div className="font-mono text-[10px] text-muted-foreground leading-relaxed">
                    |penalty| × Sustainable EBITDA
                    <div className="mt-0.5 text-[9px] italic">e.g. 0.3× × {formatCurrency(gapData.buyerEbitda)} = {formatCurrency(0.3 * gapData.buyerEbitda)}</div>
                  </div>
                </div>
                <div className="bg-warning/5 border border-warning/20 rounded p-2.5">
                  <div className="text-[9px] font-bold text-warning uppercase tracking-wider mb-1">EBITDA haircut → £ value</div>
                  <div className="font-mono text-[10px] text-muted-foreground leading-relaxed">
                    |haircut| × Final Multiple
                    <div className="mt-0.5 text-[9px] italic">e.g. {formatCurrency(10000)} × {gapData.buyerMultiple.toFixed(1)}× = {formatCurrency(10000 * gapData.buyerMultiple)}</div>
                  </div>
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                This lets you compare apples-to-apples — a 0.3× multiple penalty and a {formatCurrency(15000)} EBITDA haircut can be ranked side by side in £ terms.
              </p>
            </div>
          </div>

          {/* Connector arrow */}
          <div className="flex justify-center mb-4">
            <div className="w-px h-6 bg-border relative">
              <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-t-[6px] border-t-border" />
            </div>
          </div>

          {/* STEP 5 — Top 3 Resolved */}
          <div>
            <div className="flex items-center gap-2 mb-2.5">
              <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center flex-shrink-0">5</span>
              <span className="text-[12px] font-semibold">"If Top 3 Resolved" simulates fixing the biggest issues</span>
            </div>
            <div className="ml-7">
              <p className="text-[10px] text-muted-foreground mb-2.5 leading-relaxed">
                The 3 largest gap drivers by £ impact are selected. For each one:
              </p>
              <div className="grid grid-cols-2 gap-2.5 mb-2.5">
                <div className="bg-success/5 border border-success/20 rounded p-2.5">
                  <div className="text-[9px] font-bold text-success uppercase tracking-wider mb-1">If it's a Multiple penalty</div>
                  <div className="text-[10px] text-muted-foreground leading-relaxed">
                    The penalty is <strong>removed</strong> from the multiple, increasing it.
                  </div>
                  <div className="font-mono text-[9px] text-muted-foreground mt-1 italic">
                    e.g. {gapData.buyerMultiple.toFixed(1)}× + 0.3× = {(gapData.buyerMultiple + 0.3).toFixed(1)}×
                  </div>
                </div>
                <div className="bg-success/5 border border-success/20 rounded p-2.5">
                  <div className="text-[9px] font-bold text-success uppercase tracking-wider mb-1">If it's an EBITDA haircut</div>
                  <div className="text-[10px] text-muted-foreground leading-relaxed">
                    The haircut is <strong>added back</strong> to EBITDA, increasing it.
                  </div>
                  <div className="font-mono text-[9px] text-muted-foreground mt-1 italic">
                    e.g. {formatCurrency(gapData.buyerEbitda)} + {formatCurrency(10000)} = {formatCurrency(gapData.buyerEbitda + 10000)}
                  </div>
                </div>
              </div>
              <div className="bg-success/5 border border-success/20 rounded-lg p-3 text-center">
                <div className="text-[9px] font-bold uppercase tracking-wider text-success mb-1.5">Resolved Enterprise Value</div>
                <div className="font-mono text-[11px] leading-relaxed">
                  <span className="text-muted-foreground">Resolved EBITDA</span> × <span className="text-muted-foreground">Resolved Multiple</span> = <span className="font-bold text-success">{formatCurrency(gapData.resolved.ev)}</span>
                </div>
                <div className="font-mono text-[10px] text-muted-foreground mt-1">
                  {formatCurrency(gapData.resolved.ebitda)} × {gapData.resolved.multiple.toFixed(1)}×
                  {gapData.buyerMultiple + gapData.resolved.multipleAddBack > 8.0 && <span className="text-warning ml-1">(multiple capped at 8.0×)</span>}
                </div>
                <div className="mt-2 text-[11px] font-bold text-success">
                  +{formatCurrency(gapData.resolved.uplift)} uplift vs today's {formatCurrency(gapData.buyerValue)}
                </div>
              </div>
            </div>
          </div>
        </Card>

      </div>
  );
}

// ─── HOST PAGE: Value Driven (Value Drivers + Scenario Simulator tabs) ───

const VALUE_DRIVEN_TABS = ['value-drivers', 'scenario-simulator'] as const;
type ValueDrivenTab = typeof VALUE_DRIVEN_TABS[number];

export default function GapAnalysis() {
  const { canViewTab, tabs: ebitdaTabs } = useTabPermissions('ebitda_to_value');
  const [searchParams, setSearchParams] = useSearchParams();
  const tabFromUrl = searchParams.get('tab');

  const valueDrivenDefaultTab = useMemo<ValueDrivenTab | undefined>(
    () => VALUE_DRIVEN_TABS.find(t => ebitdaTabs.find(et => et.key === t)?.visible),
    [ebitdaTabs],
  );

  const resolveInitialTab = (): ValueDrivenTab => {
    if (tabFromUrl && (VALUE_DRIVEN_TABS as readonly string[]).includes(tabFromUrl) && canViewTab(tabFromUrl)) {
      return tabFromUrl as ValueDrivenTab;
    }
    return valueDrivenDefaultTab ?? 'value-drivers';
  };
  const [activeTab, setActiveTab] = useState<ValueDrivenTab>(resolveInitialTab);

  useEffect(() => {
    if (tabFromUrl && tabFromUrl !== activeTab && (VALUE_DRIVEN_TABS as readonly string[]).includes(tabFromUrl) && canViewTab(tabFromUrl)) {
      setActiveTab(tabFromUrl as ValueDrivenTab);
    }
  }, [tabFromUrl]);

  useEffect(() => {
    if (valueDrivenDefaultTab && !canViewTab(activeTab)) {
      setActiveTab(valueDrivenDefaultTab);
    }
  }, [valueDrivenDefaultTab]);

  const handleTabChange = (tab: string) => {
    setActiveTab(tab as ValueDrivenTab);
    setSearchParams({ tab }, { replace: true });
  };

  return (
    <MainLayout userRole="admin">
      <Helmet>
        <title>Value Driven | DentPulse</title>
        <meta name="description" content="Valuation gap analysis and scenario simulation" />
      </Helmet>

      <div className="space-y-4">
        <div>
          <h1 className="text-xl font-bold text-foreground">Value Driven</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Valuation gap drivers and what-if scenario simulation</p>
        </div>

        <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
          <TabsList>
            {canViewTab('value-drivers') && <TabsTrigger value="value-drivers">Value Drivers</TabsTrigger>}
            {canViewTab('scenario-simulator') && <TabsTrigger value="scenario-simulator">Scenario Simulator</TabsTrigger>}
          </TabsList>

          <TabsContent value="value-drivers" className="space-y-4">
            <GapAnalysisContent />
          </TabsContent>

          <TabsContent value="scenario-simulator" className="space-y-4">
            <ScenarioSimulatorContent />
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}
