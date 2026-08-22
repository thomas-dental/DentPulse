import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Helmet } from 'react-helmet-async';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip as UITooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Info, ChevronDown, ChevronUp, Sparkles, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useEbitdaValuation } from '@/hooks/useEbitdaValuation';
import { useAIPriorityTips } from '@/hooks/useAIPriorityTips';

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  LineChart,
  Line,
} from 'recharts';

function InfoTip({ description, calculation, light }: { description: string; calculation: string; light?: boolean }) {
  return (
    <UITooltip delayDuration={200}>
      <TooltipTrigger asChild>
        <button className={cn('flex-shrink-0 transition-colors ml-1 align-middle', light ? 'text-white/40 hover:text-white/80' : 'text-muted-foreground/50 hover:text-primary')} type="button">
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
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);

const formatCompact = formatCurrency;

const scoreColor = (v: number) => (v >= 80 ? 'text-success' : v >= 60 ? 'text-warning' : 'text-danger');
const scoreDot = (v: number) => (v >= 80 ? 'bg-success' : v >= 60 ? 'bg-warning' : 'bg-danger');

interface ReadinessCalc {
  label: string;
  score: number;
  source: string;   // plain-English: what raw metric drove this
  formula: string;   // the math
}

export function ExitCockpitContent() {
  const { valuation: d, isLoading } = useEbitdaValuation();
  const [achievementPct, setAchievementPct] = useState(55);
  const { tips: aiTips, isLoading: tipsLoading, error: tipsError, generateTips } = useAIPriorityTips();
  const tipsRequested = useRef(false);

  const cockpitData = useMemo(() => {
    if (!d) return null;

    const currentEV = d.enterpriseValue;
    const optimisedEV = d.valueProgression.optimised.value;
    const gap = optimisedEV - currentEV;

    // Exit readiness sub-scores (derived from quality + key drivers)
    const qs = d.quality;
    const qsVal = (label: string) => qs.scores.find(s => s.label === label)?.value ?? qs.finalScore;
    const chairStab = qsVal('Chair Stability');
    const treatMix = qsVal('Treatment Mix');
    const cashConv = qsVal('Cash Conversion');
    const revPred = qsVal('Revenue Predictability');
    const assocDep = qsVal('Associate Dependency');
    const nhsDel = qsVal('NHS Delivery');

    const qi = d.qualityInputs;
    const readinessScores: ReadinessCalc[] = [
      { label: 'Earnings Quality', score: qs.finalScore,
        source: `Weighted average of 6 quality sub-scores`,
        formula: `Quality Score = ${qs.finalScore}` },
      { label: 'Operational Stability', score: Math.round((chairStab + treatMix) / 2),
        source: `Chair utilisation ${qi.avgUtilisationPct.toFixed(0)}% → score ${chairStab}, Private revenue ${qi.privateRevenuePct.toFixed(0)}% → score ${treatMix}`,
        formula: `(${chairStab} + ${treatMix}) / 2 = ${Math.round((chairStab + treatMix) / 2)}` },
      { label: 'Management Depth', score: Math.max(55, qs.finalScore - 4),
        source: `Proxy from Quality Score (no direct management data yet)`,
        formula: `max(55, ${qs.finalScore} − 4) = ${Math.max(55, qs.finalScore - 4)}` },
      { label: 'Revenue Predictability', score: revPred,
        source: `Monthly revenue variation over ${qi.monthlyRevenues.length} months`,
        formula: `100 − (CV × 200) = ${revPred}` },
      { label: 'Scalability', score: Math.round((cashConv + treatMix) / 2),
        source: `Paid invoice rate ${(qi.paidInvoiceRate * 100).toFixed(0)}% → score ${cashConv}, Private revenue ${qi.privateRevenuePct.toFixed(0)}% → score ${treatMix}`,
        formula: `(${cashConv} + ${treatMix}) / 2 = ${Math.round((cashConv + treatMix) / 2)}` },
      { label: 'Financial Control', score: Math.min(95, cashConv + 14),
        source: `Paid invoice rate ${(qi.paidInvoiceRate * 100).toFixed(0)}% → score ${cashConv}, plus maturity uplift`,
        formula: `min(95, ${cashConv} + 14) = ${Math.min(95, cashConv + 14)}` },
    ];
    const overallReadiness = Math.round(readinessScores.reduce((s, r) => s + r.score, 0) / readinessScores.length);

    // Recommendation logic
    const shouldWait = gap > currentEV * 0.3;
    const recommendation = shouldWait ? 'WAIT 12–18 MONTHS' : gap > currentEV * 0.1 ? 'WAIT 6–12 MONTHS' : 'CONSIDER SELLING';
    const confidence = shouldWait ? 82 : gap > currentEV * 0.1 ? 70 : 60;
    const gapPct = currentEV > 0 ? Math.round(gap / currentEV * 100) : 0;

    // Timeline projection
    const pct = achievementPct / 100;
    const ev12m = currentEV + gap * pct;
    const ev24m = optimisedEV;
    const optMultiple = d.valueProgression.optimised.multiple;
    const mult12m = d.multiple.finalMultiple + (optMultiple - d.multiple.finalMultiple) * pct;

    // Timeline chart data
    const timelineData = [
      { period: 'Now', doNothing: currentEV / 1e6, optimised: currentEV / 1e6 },
      { period: '6m', doNothing: currentEV * 1.02 / 1e6, optimised: currentEV * 1.21 / 1e6 },
      { period: '12m', doNothing: currentEV * 1.06 / 1e6, optimised: ev12m / 1e6 },
      { period: '18m', doNothing: currentEV * 1.08 / 1e6, optimised: (ev12m + (ev24m - ev12m) * 0.5) / 1e6 },
      { period: '24m', doNothing: currentEV * 1.11 / 1e6, optimised: ev24m / 1e6 },
    ];

    // Deal structure — dynamic based on quality score
    const qScore = qs.finalScore;
    const todayCash = qScore >= 80 ? 70 : qScore >= 65 ? 55 : qScore >= 50 ? 45 : 35;
    const todayDeferred = qScore >= 80 ? 20 : qScore >= 65 ? 20 : qScore >= 50 ? 25 : 25;
    const todayEarnout = 100 - todayCash - todayDeferred;
    const optQScore = d.valueProgression.optimised.multiple >= 6 ? 85 : 78; // proxy for optimised quality
    const optCash = optQScore >= 80 ? 75 : 65;
    const optDeferred = optQScore >= 80 ? 15 : 20;
    const optEarnout = 100 - optCash - optDeferred;

    const dealData = [
      { name: 'Today', cash: todayCash, deferred: todayDeferred, earnout: todayEarnout },
      { name: 'After Optimisation', cash: optCash, deferred: optDeferred, earnout: optEarnout },
    ];

    // Priority actions — derived from real practice metrics
    const negativeWaterfall = d.multiple.waterfall.filter(f => f.value < 0);
    const ebitdaMarginPct = d.totalRevenue > 0 ? (d.reportedEBITDA / d.totalRevenue) * 100 : 0;
    const priorityActions: Array<{
      rank: number;
      label: string;
      metric: string;
      actual: string;
      target: string;
      evImpact: number;
      timeframe: string;
      severity: 'red' | 'amber' | 'green';
      category: string;
    }> = [];

    // 1. Associate Dependency — if top provider > 25%
    if (qi.topProviderRevenuePct > 25) {
      const penaltyX = qi.topProviderRevenuePct > 40 ? 0.4 : qi.topProviderRevenuePct > 30 ? 0.3 : 0.2;
      priorityActions.push({
        rank: 0, label: `Reduce top associate concentration below 25%`,
        metric: 'Associate Dependency', actual: `${qi.topProviderRevenuePct.toFixed(0)}%`,
        target: '<25%', evImpact: penaltyX * d.sustainableEBITDA,
        timeframe: qi.topProviderRevenuePct > 35 ? '6–12 months' : '3–6 months',
        severity: qi.topProviderRevenuePct > 35 ? 'red' : 'amber',
        category: 'practitioners',
      });
    }

    // 2. UDA Delivery — if < 96%
    if (qi.udaDeliveryPct != null && qi.udaDeliveryPct < 96) {
      const penaltyX = qi.udaDeliveryPct < 92 ? 0.3 : 0.2;
      priorityActions.push({
        rank: 0, label: `Achieve 96%+ UDA delivery`,
        metric: 'NHS Delivery', actual: `${qi.udaDeliveryPct.toFixed(0)}%`,
        target: '≥96%', evImpact: penaltyX * d.sustainableEBITDA,
        timeframe: qi.udaDeliveryPct < 90 ? '6–12 months' : '3–6 months',
        severity: qi.udaDeliveryPct < 90 ? 'red' : 'amber',
        category: 'revenue',
      });
    }

    // 3. Chair Utilisation — if < 80%
    if (qi.avgUtilisationPct < 80) {
      const upliftPct = Math.min(85, qi.avgUtilisationPct + 15) - qi.avgUtilisationPct;
      const evImpact = (upliftPct / 100) * d.totalRevenue * 0.4; // marginal revenue × margin
      priorityActions.push({
        rank: 0, label: `Improve chair utilisation to ${Math.min(85, Math.round(qi.avgUtilisationPct + 15))}%+`,
        metric: 'Chair Utilisation', actual: `${qi.avgUtilisationPct.toFixed(0)}%`,
        target: '≥80%', evImpact,
        timeframe: '3–6 months',
        severity: qi.avgUtilisationPct < 65 ? 'red' : 'amber',
        category: 'appointments',
      });
    }

    // 4. Private Revenue Mix — if < 50%
    if (qi.privateRevenuePct < 50) {
      const targetPct = Math.min(50, qi.privateRevenuePct + 15);
      const additionalPrivateRev = (targetPct - qi.privateRevenuePct) / 100 * d.totalRevenue;
      const evImpact = additionalPrivateRev * 0.35; // private treatments have ~35% higher margin
      priorityActions.push({
        rank: 0, label: `Grow private revenue mix to ${Math.round(targetPct)}%+`,
        metric: 'Treatment Mix', actual: `${qi.privateRevenuePct.toFixed(0)}%`,
        target: '≥50%', evImpact,
        timeframe: '6–12 months',
        severity: qi.privateRevenuePct < 30 ? 'red' : 'amber',
        category: 'revenue',
      });
    }

    // 5. Cash Conversion — if paid rate < 90%
    if (qi.paidInvoiceRate < 0.90) {
      const improvementRate = Math.min(0.95, qi.paidInvoiceRate + 0.10) - qi.paidInvoiceRate;
      const evImpact = improvementRate * d.totalRevenue;
      priorityActions.push({
        rank: 0, label: `Improve invoice collection rate to ${Math.round(Math.min(95, qi.paidInvoiceRate * 100 + 10))}%+`,
        metric: 'Cash Conversion', actual: `${(qi.paidInvoiceRate * 100).toFixed(0)}%`,
        target: '≥90%', evImpact,
        timeframe: '3–6 months',
        severity: qi.paidInvoiceRate < 0.75 ? 'red' : 'amber',
        category: 'costs',
      });
    }

    // 6. EBITDA Margin — if < 25%
    if (ebitdaMarginPct < 25) {
      const targetMargin = Math.min(25, ebitdaMarginPct + 8);
      const evImpact = ((targetMargin - ebitdaMarginPct) / 100) * d.totalRevenue;
      priorityActions.push({
        rank: 0, label: `Lift EBITDA margin to ${Math.round(targetMargin)}%+`,
        metric: 'Margin Efficiency', actual: `${ebitdaMarginPct.toFixed(0)}%`,
        target: '≥25%', evImpact,
        timeframe: '6–12 months',
        severity: ebitdaMarginPct < 15 ? 'red' : 'amber',
        category: 'costs',
      });
    }

    // 7. Revenue Predictability — if score < 70
    if (revPred < 70) {
      const evImpact = 0.1 * d.sustainableEBITDA; // ~0.1× multiple improvement
      priorityActions.push({
        rank: 0, label: `Stabilise monthly revenue variance`,
        metric: 'Revenue Predictability', actual: `Score ${revPred}`,
        target: '≥70', evImpact,
        timeframe: '6–12 months',
        severity: revPred < 50 ? 'red' : 'amber',
        category: 'revenue',
      });
    }

    // Sort by EV impact descending, take top 5, assign ranks
    const actions = priorityActions
      .sort((a, b) => b.evImpact - a.evImpact)
      .slice(0, 5)
      .map((a, i) => ({ ...a, rank: i + 1 }));

    const totalUplift = actions.reduce((s, a) => s + a.evImpact, 0);

    // Quality sub-scores for display
    const qualitySubScores = qs.scores;

    // Waterfall items for multiple breakdown
    const waterfallItems = d.multiple.waterfall;

    return {
      currentEV, optimisedEV, gap, gapPct,
      recommendation, confidence, shouldWait,
      readinessScores, overallReadiness,
      ev12m, ev24m, mult12m, optMultiple,
      timelineData, dealData, actions, totalUplift,
      qualitySubScores, waterfallItems, negativeWaterfall,
      chairStab, treatMix, cashConv, revPred, assocDep, nhsDel,
      qScore, todayCash, todayDeferred, todayEarnout,
      optCash, optDeferred, optEarnout,
      pct,
    };
  }, [d, achievementPct]);

  // Auto-generate AI tips when cockpit data is ready
  useEffect(() => {
    if (cockpitData && d && !tipsRequested.current && cockpitData.actions.length > 0) {
      tipsRequested.current = true;
      generateTips(
        cockpitData.actions.map(a => ({
          label: a.label,
          penaltyX: 0,
          value: a.evImpact,
          metric: a.metric,
          actual: a.actual,
          target: a.target,
          category: a.category,
        })),
        {
          sustainableEBITDA: d.sustainableEBITDA,
          currentEV: cockpitData.currentEV,
          optimisedEV: cockpitData.optimisedEV,
          qualityScore: cockpitData.qScore,
          overallReadiness: cockpitData.overallReadiness,
        }
      );
    }
  }, [cockpitData, d, generateTips]);

  if (isLoading || !d || !cockpitData) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-48 mb-2" />
        <Skeleton className="h-40 w-full rounded-lg" />
        <div className="grid grid-cols-2 gap-3.5">
          <Skeleton className="h-60 rounded-lg" />
          <Skeleton className="h-60 rounded-lg" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3.5">

      {/* Page Header */}
        <div>
          <h1 className="text-xl font-bold text-foreground">Exit Decision Cockpit&trade;</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Sell now or wait — readiness score, value timeline and action plan</p>
        </div>

        {/* Recommendation Panel */}
        <Card className="bg-foreground text-white p-5">
          <div className="grid grid-cols-[1fr_auto] gap-5">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-white/40 mb-1.5">
                Recommended Action
                <InfoTip light description="DentPulse's recommended exit timing based on the value gap remaining, key risk factors, and market conditions." calculation="Wait if value gap > 30% of current EV. Confidence based on number of fixable issues." />
              </div>
              <div className="text-[28px] font-bold tracking-tight leading-none">{cockpitData.recommendation}</div>
              <div className="text-[13px] text-emerald-400 font-medium mt-1">
                Confidence: {cockpitData.confidence}%
                <InfoTip light description="How confident the model is in this recommendation — based on number and severity of unresolved issues." calculation="82% = significant gap + multiple fixable issues. Lower gap → lower confidence in waiting." />
              </div>
              <div className="mt-3 border-t border-white/10 pt-3 space-y-1.5">
                <div className="flex items-start gap-2 text-xs text-white/60">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0 mt-1.5" />
                  Significant value gap remains ({formatCompact(cockpitData.gap)})
                </div>
                {d.multiple.waterfall.filter(f => f.value <= -0.3).slice(0, 2).map((f, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs text-white/60">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0 mt-1.5" />
                    {f.label} suppressing multiple by {f.value.toFixed(1)}×
                  </div>
                ))}
                <div className="flex items-start gap-2 text-xs text-white/60">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0 mt-1.5" />
                  Market conditions neutral-to-supportive
                </div>
              </div>

              {/* Recommendation Calculation Breakdown */}
              <div className="mt-3 border-t border-white/10 pt-1.5">
                <details className="group">
                  <summary className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/30 hover:text-white/60 transition-colors cursor-pointer list-none">
                    <ChevronDown className="w-3 h-3 group-open:hidden" />
                    <ChevronUp className="w-3 h-3 hidden group-open:block" />
                    How it's calculated
                  </summary>
                  <div className="mt-2 text-[11px] font-mono text-white/50 bg-white/5 rounded-md p-3 leading-normal grid grid-cols-[1fr_auto] gap-x-4">
                    <span>Current EV = {formatCurrency(d.sustainableEBITDA)} x {d.multiple.finalMultiple.toFixed(1)}</span>
                    <span className="text-right text-white/60">{formatCompact(cockpitData.currentEV)}</span>
                    <span>Optimised EV = {formatCurrency(d.valueProgression.optimised.ebitda)} x {cockpitData.optMultiple.toFixed(1)}</span>
                    <span className="text-right text-white/60">{formatCompact(cockpitData.optimisedEV)}</span>
                    <span>Gap = {cockpitData.gapPct}% of current EV</span>
                    <span className="text-right text-white/60">{formatCompact(cockpitData.gap)}</span>
                    <span className="border-t border-white/10 pt-0.5 mt-0.5 text-white/60">Rule: gap {cockpitData.gapPct}% {cockpitData.shouldWait ? '> 30%' : cockpitData.gapPct > 10 ? '> 10%' : '<= 10%'} → {cockpitData.recommendation}</span>
                    <span className="border-t border-white/10 pt-0.5 mt-0.5 text-right text-white/60">{cockpitData.confidence}% conf.</span>
                  </div>
                </details>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 self-center">
              <div className="text-center">
                <div className="text-[10px] text-white/40 uppercase tracking-wider mb-1">Today
                <InfoTip light description="Current enterprise value based on Sustainable EBITDA™ × risk-adjusted multiple." calculation={`${formatCurrency(d.sustainableEBITDA)} × ${d.multiple.finalMultiple.toFixed(1)} = ${formatCompact(cockpitData.currentEV)}`} />
              </div>
                <div className="text-[22px] font-bold tabular-nums">{formatCompact(cockpitData.currentEV)}</div>
                <div className="text-[13px] text-white/60">{d.multiple.finalMultiple.toFixed(1)}×</div>
              </div>
              <div className="text-center border border-emerald-400/30 rounded-lg p-2 bg-emerald-400/10">
                <div className="text-[10px] text-emerald-400 uppercase tracking-wider mb-1">12 Months ✓
                  <InfoTip light description={`Projected value after 12 months of optimisation — assumes ${achievementPct}% of total improvement is achieved.`} calculation={`${formatCompact(cockpitData.currentEV)} + (${formatCompact(cockpitData.gap)} × ${achievementPct}%) = ${formatCompact(cockpitData.currentEV)} + ${formatCompact(Math.round(cockpitData.gap * achievementPct / 100))} = ${formatCompact(cockpitData.ev12m)}`} />
                </div>
                <div className="text-[22px] font-bold tabular-nums text-emerald-400">{formatCompact(cockpitData.ev12m)}</div>
                <div className="text-[13px] text-emerald-400/60">{cockpitData.mult12m.toFixed(1)}×</div>
              </div>
              <div className="text-center">
                <div className="text-[10px] text-white/40 uppercase tracking-wider mb-1">24 Months
                  <InfoTip light description="Full optimised value — assumes all improvement actions are completed after 24 months." calculation={`${formatCurrency(d.valueProgression.optimised.ebitda)} × ${cockpitData.optMultiple.toFixed(1)} = ${formatCompact(cockpitData.ev24m)}`} />
                </div>
                <div className="text-[22px] font-bold tabular-nums">{formatCompact(cockpitData.ev24m)}</div>
                <div className="text-[13px] text-white/60">{cockpitData.optMultiple.toFixed(1)}×</div>
              </div>
            </div>
            <div className="col-span-2 flex items-center gap-3 mt-3 pt-3 border-t border-white/10">
              <span className="text-[10px] text-white/40 uppercase tracking-wider whitespace-nowrap">Achievement %</span>
              <input
                type="range"
                min={10}
                max={100}
                step={5}
                value={achievementPct}
                onChange={e => setAchievementPct(Number(e.target.value))}
                className="flex-1 h-1 accent-emerald-400 cursor-pointer"
              />
              <span className="text-[13px] font-mono text-emerald-400 tabular-nums w-10 text-right">{achievementPct}%</span>
            </div>
          </div>
        </Card>

        {/* Exit Readiness + Deal Structure */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
          <Card className="p-4">
            <div className="flex items-center gap-4 mb-3">
              <div className="text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground">
                Exit Readiness Score™
                <InfoTip description="Composite score (0–100) measuring how ready the practice group is for a sale — derived from 6 sub-dimensions." calculation="Average of: Earnings Quality, Operational Stability, Management Depth, Revenue Predictability, Scalability, Financial Control." />
              </div>
              <span className="text-[9px] font-mono bg-muted px-1.5 py-0.5 rounded text-muted-foreground">DentPulse model</span>
            </div>
            <div className="flex items-center gap-4 mb-4">
              <div className="relative w-20 h-20 flex-shrink-0">
                <svg className="w-full h-full -rotate-90" viewBox="0 0 80 80">
                  <circle cx="40" cy="40" r="32" fill="none" stroke="hsl(var(--border))" strokeWidth="7" />
                  <circle cx="40" cy="40" r="32" fill="none"
                    stroke={cockpitData.overallReadiness >= 80 ? 'hsl(var(--success))' : cockpitData.overallReadiness >= 60 ? 'hsl(var(--warning))' : 'hsl(var(--danger))'}
                    strokeWidth="7" strokeLinecap="round"
                    strokeDasharray={`${2 * Math.PI * 32}`}
                    strokeDashoffset={`${2 * Math.PI * 32 * (1 - cockpitData.overallReadiness / 100)}`}
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className={cn('text-lg font-bold', scoreColor(cockpitData.overallReadiness))}>{cockpitData.overallReadiness}</span>
                  <span className="text-[10px] text-muted-foreground">/100</span>
                </div>
              </div>
              <div>
                <div className={cn('text-[10px] font-bold uppercase tracking-wide mb-1.5 px-2 py-0.5 rounded inline-block',
                  cockpitData.overallReadiness >= 80 ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'
                )}>
                  {cockpitData.overallReadiness >= 80 ? 'GREEN — PREMIUM READY' : 'AMBER — SALEABLE, NOT PREMIUM'}
                </div>
                <div className="text-[11px] text-muted-foreground">"Saleable, but {cockpitData.overallReadiness >= 80 ? 'premium-ready' : 'not premium-ready'}"</div>
              </div>
            </div>
            <div className="space-y-0">
              {cockpitData.readinessScores.map((item, i) => (
                <div key={i} className="py-1.5 border-b last:border-b-0">
                  <div className="flex items-center gap-2">
                    <div className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', scoreDot(item.score))} />
                    <span className="flex-1 text-xs font-medium text-foreground">{item.label}</span>
                    <span className={cn('text-xs font-semibold tabular-nums', scoreColor(item.score))}>{item.score}</span>
                  </div>
                  <div className="ml-3.5 text-[10.5px] text-muted-foreground leading-snug mt-0.5">{item.source}</div>
                </div>
              ))}
            </div>

            {/* Readiness Calculation Breakdown */}
            <CalcBreakdown>
              <CRow l={`Overall = (${cockpitData.readinessScores.map(r => r.score).join(' + ')}) / 6`} r={cockpitData.overallReadiness} bold />
              <table className="w-full mt-2 border-collapse">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-1 font-semibold text-foreground">Sub-score</th>
                    <th className="text-left py-1 font-semibold text-foreground">Calculation</th>
                    <th className="text-right py-1 font-semibold text-foreground w-10">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {cockpitData.readinessScores.map((item, i) => (
                    <tr key={i} className="border-b last:border-b-0">
                      <td className="py-1 pr-2 align-top whitespace-nowrap">{item.label}</td>
                      <td className="py-1 pr-2">{item.formula}</td>
                      <td className={cn('py-1 text-right font-semibold', scoreColor(item.score))}>{item.score}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="border-t mt-2 pt-2">
                <div className="font-semibold text-foreground mb-1">Where the input scores come from (EBITDA Quality)</div>
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-0.5 font-semibold text-foreground">Metric</th>
                      <th className="text-left py-0.5 font-semibold text-foreground">Raw Value</th>
                      <th className="text-left py-0.5 font-semibold text-foreground">How it becomes a score</th>
                      <th className="text-right py-0.5 font-semibold text-foreground">Wt</th>
                      <th className="text-right py-0.5 font-semibold text-foreground">Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b">
                      <td className="py-0.5">Revenue Predictability</td>
                      <td className="py-0.5">CV of {d.qualityInputs.monthlyRevenues.length}m revenue</td>
                      <td className="py-0.5">100 − (CV × 200)</td>
                      <td className="py-0.5 text-right">20%</td>
                      <td className="py-0.5 text-right font-semibold">{cockpitData.revPred}</td>
                    </tr>
                    <tr className="border-b">
                      <td className="py-0.5">Associate Dependency</td>
                      <td className="py-0.5">Top provider: {d.qualityInputs.topProviderRevenuePct.toFixed(0)}%</td>
                      <td className="py-0.5">100 − ({d.qualityInputs.topProviderRevenuePct.toFixed(0)} × 1.5)</td>
                      <td className="py-0.5 text-right">20%</td>
                      <td className="py-0.5 text-right font-semibold">{cockpitData.assocDep}</td>
                    </tr>
                    <tr className="border-b">
                      <td className="py-0.5">Chair Stability</td>
                      <td className="py-0.5">Avg utilisation: {d.qualityInputs.avgUtilisationPct.toFixed(0)}%</td>
                      <td className="py-0.5">Direct mapping of %</td>
                      <td className="py-0.5 text-right">15%</td>
                      <td className="py-0.5 text-right font-semibold">{cockpitData.chairStab}</td>
                    </tr>
                    <tr className="border-b">
                      <td className="py-0.5">Treatment Mix</td>
                      <td className="py-0.5">Private revenue: {d.qualityInputs.privateRevenuePct.toFixed(0)}%</td>
                      <td className="py-0.5">Direct mapping of %</td>
                      <td className="py-0.5 text-right">15%</td>
                      <td className="py-0.5 text-right font-semibold">{cockpitData.treatMix}</td>
                    </tr>
                    <tr className="border-b">
                      <td className="py-0.5">Cash Conversion</td>
                      <td className="py-0.5">Paid invoices: {(d.qualityInputs.paidInvoiceRate * 100).toFixed(0)}%</td>
                      <td className="py-0.5">Rate × 100</td>
                      <td className="py-0.5 text-right">15%</td>
                      <td className="py-0.5 text-right font-semibold">{cockpitData.cashConv}</td>
                    </tr>
                    <tr>
                      <td className="py-0.5">NHS Delivery</td>
                      <td className="py-0.5">{d.qualityInputs.udaDeliveryPct != null ? `UDA delivery: ${d.qualityInputs.udaDeliveryPct.toFixed(0)}%` : 'No NHS contract'}</td>
                      <td className="py-0.5">{d.qualityInputs.udaDeliveryPct != null ? 'Direct mapping of %' : 'Default neutral = 65'}</td>
                      <td className="py-0.5 text-right">15%</td>
                      <td className="py-0.5 text-right font-semibold">{cockpitData.nhsDel}</td>
                    </tr>
                  </tbody>
                </table>
                <CRow l="Weighted Final Quality Score" r={d.quality.finalScore} bold />
              </div>
            </CalcBreakdown>
          </Card>

          <Card className="p-4">
            <div className="text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground mb-3">
              Deal Structure — Today vs After Optimisation
              <InfoTip description="How the deal payment is likely to be structured. Higher quality earnings means more cash upfront and less in earn-outs." calculation="Based on EBITDA Quality Score — higher quality = more cash upfront, less earn-out risk." />
            </div>
            <div className="h-[160px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={cockpitData.dealData} layout="horizontal">
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 9 }} tickFormatter={(v) => v + '%'} domain={[0, 100]} />
                  <Tooltip formatter={(v: number) => v + '%'} />
                  <Legend iconSize={10} wrapperStyle={{ fontSize: '10px' }} />
                  <Bar dataKey="cash" stackId="a" fill="hsl(var(--primary))" name="Cash (upfront)" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="deferred" stackId="a" fill="hsl(var(--foreground))" name="Deferred" />
                  <Bar dataKey="earnout" stackId="a" fill="hsl(var(--warning))" name="Earn-out" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2.5 text-[11px] text-muted-foreground italic text-center">"Improving quality reduces reliance on earn-outs"</div>

            {/* Deal Structure Calculation Breakdown */}
            <CalcBreakdown>
              <CRow l={`Quality Score = ${cockpitData.qScore} → drives deal split`} r="" bold />
              <table className="w-full text-[11px] mt-1 border-collapse">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-0.5 font-semibold text-foreground">Score Band</th>
                    <th className="text-right py-0.5 font-semibold text-foreground">Cash</th>
                    <th className="text-right py-0.5 font-semibold text-foreground">Deferred</th>
                    <th className="text-right py-0.5 font-semibold text-foreground">Earn-out</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { band: '80+', cash: 70, def: 20, earn: 10, active: cockpitData.qScore >= 80 },
                    { band: '65–79', cash: 55, def: 20, earn: 25, active: cockpitData.qScore >= 65 && cockpitData.qScore < 80 },
                    { band: '50–64', cash: 45, def: 25, earn: 30, active: cockpitData.qScore >= 50 && cockpitData.qScore < 65 },
                    { band: '<50', cash: 35, def: 25, earn: 40, active: cockpitData.qScore < 50 },
                  ].map((row) => (
                    <tr key={row.band} className={row.active ? 'bg-primary/10 font-semibold text-foreground' : ''}>
                      <td className="py-0.5">{row.band} {row.active ? '◀' : ''}</td>
                      <td className="text-right py-0.5">{row.cash}%</td>
                      <td className="text-right py-0.5">{row.def}%</td>
                      <td className="text-right py-0.5">{row.earn}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-1 text-muted-foreground/50">Higher quality = lower buyer risk = more cash upfront</div>
            </CalcBreakdown>
          </Card>
        </div>

        {/* Value Timeline */}
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground">
              Value Timeline — Do Nothing vs Optimised
              <InfoTip description="Projected enterprise value over 24 months under two scenarios: taking no action vs executing the optimisation plan." calculation="Do Nothing: ~2% annual organic growth. Optimised: phased improvement reaching full potential at 24 months." />
            </div>
            <span className="text-[9px] font-mono bg-muted px-1.5 py-0.5 rounded text-muted-foreground">DentPulse forecast</span>
          </div>
          <div className="h-[180px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={cockpitData.timelineData}>
                <XAxis dataKey="period" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 9 }} tickFormatter={(v) => '£' + v.toFixed(0) + 'M'} />
                <Tooltip formatter={(v: number) => '£' + v.toFixed(1) + 'M'} />
                <Legend iconSize={12} wrapperStyle={{ fontSize: '11px' }} />
                <Line type="monotone" dataKey="doNothing" stroke="hsl(var(--danger))" strokeWidth={2} dot={{ r: 4 }} name="Do Nothing" />
                <Line type="monotone" dataKey="optimised" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 4 }} name="Optimised" />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Value Timeline Calculation Breakdown */}
          <CalcBreakdown>
            <CRow l={`Value gap = ${formatCompact(cockpitData.optimisedEV)} − ${formatCompact(cockpitData.currentEV)}`} r={formatCompact(cockpitData.gap)} bold />
            <table className="w-full text-[11px] mt-1 border-collapse">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-0.5 font-semibold text-foreground">Period</th>
                  <th className="text-right py-0.5 font-semibold text-foreground">Do Nothing</th>
                  <th className="text-left py-0.5 pl-2 text-muted-foreground/50">How</th>
                  <th className="text-right py-0.5 font-semibold text-foreground">Optimised</th>
                  <th className="text-left py-0.5 pl-2 text-muted-foreground/50">How</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { p: 'Now', dnM: 1, dnH: 'baseline', oM: 1, oH: 'baseline' },
                  { p: '6m', dnM: 1.02, dnH: 'x1.02', oM: 1.21, oH: 'x1.21 early wins' },
                  { p: '12m', dnM: 1.06, dnH: 'x1.06', oM: null as number | null, oH: `+gap x ${achievementPct}%` },
                  { p: '18m', dnM: 1.08, dnH: 'x1.08', oM: null as number | null, oH: 'midpoint 12m–24m' },
                  { p: '24m', dnM: 1.11, dnH: 'x1.11', oM: null as number | null, oH: 'full optimised' },
                ].map((row) => {
                  const dnVal = Math.round(cockpitData.currentEV * row.dnM);
                  const oVal = row.p === 'Now' ? cockpitData.currentEV
                    : row.p === '6m' ? Math.round(cockpitData.currentEV * 1.21)
                    : row.p === '12m' ? cockpitData.ev12m
                    : row.p === '18m' ? Math.round((cockpitData.ev12m + cockpitData.ev24m) / 2)
                    : cockpitData.ev24m;
                  return (
                    <tr key={row.p} className="border-b last:border-b-0">
                      <td className="py-0.5 font-medium">{row.p}</td>
                      <td className="text-right py-0.5 tabular-nums">{formatCompact(dnVal)}</td>
                      <td className="py-0.5 pl-2 text-muted-foreground/50">{row.dnH}</td>
                      <td className="text-right py-0.5 tabular-nums">{formatCompact(oVal)}</td>
                      <td className="py-0.5 pl-2 text-muted-foreground/50">{row.oH}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="border-t mt-1 pt-1">
              <CRow l={`Multiple: ${d.multiple.finalMultiple.toFixed(1)}x → ${cockpitData.mult12m.toFixed(1)}x (12m) → ${cockpitData.optMultiple.toFixed(1)}x (24m)`} r="" />
            </div>
            {d.valueProgression.drivers.length > 0 && (
              <div className="border-t mt-1 pt-1 grid grid-cols-[auto_auto_1fr] gap-x-2 text-[11px]">
                <span className="font-semibold text-foreground col-span-3 mb-0.5">Optimisation drivers</span>
                {d.valueProgression.drivers.map((driver, i) => (
                  <React.Fragment key={i}>
                    <span>{driver.label}</span>
                    <span className="text-muted-foreground/50">{driver.from} → {driver.to}</span>
                    <span className="text-muted-foreground/50">{driver.impact}</span>
                  </React.Fragment>
                ))}
              </div>
            )}
          </CalcBreakdown>
        </Card>

        {/* Actions + Sell/Wait grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
          <Card className="p-4">
            <div className="text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground mb-3">
              Top Actions — Ranked by Value Impact
              <InfoTip description="The highest-impact actions to increase enterprise value — derived from real practice metrics including associate dependency, chair utilisation, treatment mix, NHS delivery, and cash conversion." calculation="Each action's EV impact is calculated from the gap between current and target metric values." />
            </div>
            <div className="space-y-0">
              {cockpitData.actions.map((action) => (
                <div key={action.rank} className="flex items-center justify-between py-2 border-b last:border-b-0">
                  <div className="flex items-center gap-2.5">
                    <div className="w-5 h-5 rounded-full bg-foreground text-background text-[10px] font-bold flex items-center justify-center flex-shrink-0">{action.rank}</div>
                    <div>
                      <span className="text-[12.5px] font-medium">{action.label}</span>
                      <div className="text-[10px] text-muted-foreground">{action.metric}: {action.actual} → {action.target}</div>
                    </div>
                  </div>
                  <span className="text-[13px] font-bold text-success tabular-nums">+{formatCompact(action.evImpact)}</span>
                </div>
              ))}
              <div className="mt-2.5 p-2 bg-primary/5 border border-primary/20 rounded-md flex justify-between text-xs">
                <span className="font-semibold text-primary">Total potential uplift</span>
                <span className="font-bold text-primary">+{formatCompact(cockpitData.totalUplift)}</span>
              </div>
            </div>

            {/* Actions Calculation Breakdown */}
            <CalcBreakdown>
              <CRow l="Impact derived from metric gap × revenue/EBITDA multiplier" r="" bold />
              <table className="w-full text-[11px] mt-1 border-collapse">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-0.5 font-semibold text-foreground">Metric</th>
                    <th className="text-right py-0.5 font-semibold text-foreground">Current</th>
                    <th className="text-right py-0.5 font-semibold text-foreground">Target</th>
                    <th className="text-right py-0.5 font-semibold text-foreground">EV Impact</th>
                  </tr>
                </thead>
                <tbody>
                  {cockpitData.actions.map((a, i) => (
                    <tr key={i} className="border-b last:border-b-0">
                      <td className="py-0.5">{a.metric}</td>
                      <td className="text-right py-0.5 text-danger">{a.actual}</td>
                      <td className="text-right py-0.5 text-success">{a.target}</td>
                      <td className="text-right py-0.5 text-success">+{formatCompact(a.evImpact)}</td>
                    </tr>
                  ))}
                  <tr className="border-t font-semibold text-foreground">
                    <td className="py-0.5" colSpan={3}>Total if all achieved</td>
                    <td className="text-right py-0.5">+{formatCompact(cockpitData.totalUplift)}</td>
                  </tr>
                </tbody>
              </table>
              <div className="border-t mt-1.5 pt-1 text-[11px]">
                <span className="font-semibold text-foreground">Multiple waterfall</span>
                {cockpitData.waterfallItems.map((item, i) => (
                  <div key={i} className="flex justify-between">
                    <span>{item.label}</span>
                    <span className={cn('tabular-nums', item.type === 'negative' ? 'text-danger' : item.type === 'positive' ? 'text-success' : 'font-semibold text-foreground')}>
                      {item.type === 'base' ? item.value.toFixed(1) + 'x' : (item.value >= 0 ? '+' : '') + item.value.toFixed(1) + 'x'}
                    </span>
                  </div>
                ))}
                <CRow l="Final (clamped 3.0–8.0)" r={d.multiple.finalMultiple.toFixed(1) + 'x'} bold />
              </div>
            </CalcBreakdown>
          </Card>

          <Card className="p-4">
            <div className="text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground mb-3">
              Sell Now vs Wait Decision Grid
              <InfoTip description="Compares the three timing options — sell immediately, wait 12 months, or wait 24 months — by projected value and risk." calculation="Values from the timeline projection. Risk increases slightly with longer horizons due to market uncertainty." />
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b-2">
                  <th className="py-1.5 px-2 text-left text-muted-foreground font-semibold">Option</th>
                  <th className="py-1.5 px-2 text-right text-muted-foreground font-semibold">Value</th>
                  <th className="py-1.5 px-2 text-right text-muted-foreground font-semibold">Gain</th>
                  <th className="py-1.5 px-2 text-center text-muted-foreground font-semibold">Risk</th>
                  <th className="py-1.5 px-2 text-center text-muted-foreground font-semibold">Verdict</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b bg-danger/5">
                  <td className="py-2 px-2">Sell Now</td>
                  <td className="py-2 px-2 text-right font-bold tabular-nums">{formatCompact(cockpitData.currentEV)}</td>
                  <td className="py-2 px-2 text-right tabular-nums text-muted-foreground">—</td>
                  <td className="py-2 px-2 text-center"><span className="text-[10px] font-bold bg-warning/10 text-warning px-1.5 py-0.5 rounded">Medium</span></td>
                  <td className="py-2 px-2 text-center text-danger font-semibold">✗ Not recommended</td>
                </tr>
                <tr className="border-b bg-success/5">
                  <td className="py-2 px-2 font-semibold">Wait 12M</td>
                  <td className="py-2 px-2 text-right font-bold tabular-nums text-success">{formatCompact(cockpitData.ev12m)}</td>
                  <td className="py-2 px-2 text-right font-semibold tabular-nums text-success">+{formatCompact(cockpitData.ev12m - cockpitData.currentEV)}</td>
                  <td className="py-2 px-2 text-center"><span className="text-[10px] font-bold bg-warning/10 text-warning px-1.5 py-0.5 rounded">Moderate</span></td>
                  <td className="py-2 px-2 text-center text-success font-semibold">✓ Recommended</td>
                </tr>
                <tr>
                  <td className="py-2 px-2">Wait 24M</td>
                  <td className="py-2 px-2 text-right font-bold tabular-nums text-primary">{formatCompact(cockpitData.ev24m)}</td>
                  <td className="py-2 px-2 text-right font-semibold tabular-nums text-primary">+{formatCompact(cockpitData.ev24m - cockpitData.currentEV)}</td>
                  <td className="py-2 px-2 text-center"><span className="text-[10px] font-bold bg-warning/10 text-warning px-1.5 py-0.5 rounded">Slightly higher</span></td>
                  <td className="py-2 px-2 text-center text-primary font-semibold">✓ Consider</td>
                </tr>
              </tbody>
            </table>

            {/* Decision Grid Calculation Breakdown */}
            <CalcBreakdown>
              <table className="w-full text-[11px] border-collapse">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-0.5 font-semibold text-foreground">Option</th>
                    <th className="text-left py-0.5 font-semibold text-foreground">Formula</th>
                    <th className="text-right py-0.5 font-semibold text-foreground">Value</th>
                    <th className="text-right py-0.5 font-semibold text-foreground">Gain</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b">
                    <td className="py-0.5">Sell Now</td>
                    <td className="py-0.5">{formatCurrency(d.sustainableEBITDA)} x {d.multiple.finalMultiple.toFixed(1)}</td>
                    <td className="text-right py-0.5 tabular-nums">{formatCompact(cockpitData.currentEV)}</td>
                    <td className="text-right py-0.5 text-muted-foreground/50">—</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-0.5">Wait 12M</td>
                    <td className="py-0.5">EV + gap x {achievementPct}%</td>
                    <td className="text-right py-0.5 tabular-nums">{formatCompact(cockpitData.ev12m)}</td>
                    <td className="text-right py-0.5 text-success tabular-nums">+{cockpitData.currentEV > 0 ? Math.round((cockpitData.ev12m - cockpitData.currentEV) / cockpitData.currentEV * 100) : 0}%</td>
                  </tr>
                  <tr>
                    <td className="py-0.5">Wait 24M</td>
                    <td className="py-0.5">{formatCurrency(d.valueProgression.optimised.ebitda)} x {cockpitData.optMultiple.toFixed(1)}</td>
                    <td className="text-right py-0.5 tabular-nums">{formatCompact(cockpitData.ev24m)}</td>
                    <td className="text-right py-0.5 text-success tabular-nums">+{cockpitData.currentEV > 0 ? Math.round((cockpitData.ev24m - cockpitData.currentEV) / cockpitData.currentEV * 100) : 0}%</td>
                  </tr>
                </tbody>
              </table>
              <div className="border-t mt-1 pt-1 grid grid-cols-[1fr_auto] gap-x-3 text-[11px]">
                <span className="font-semibold text-foreground col-span-2">24M value decomposition</span>
                <span>EBITDA uplift ({formatCurrency(d.valueProgression.baseline.ebitda)} → {formatCurrency(d.valueProgression.optimised.ebitda)})</span>
                <span className="text-right tabular-nums">+{formatCurrency(d.valueProgression.ebitdaValueImpact)}</span>
                <span>Multiple uplift ({d.valueProgression.baseline.multiple.toFixed(1)} → {d.valueProgression.optimised.multiple.toFixed(1)})</span>
                <span className="text-right tabular-nums">+{formatCurrency(d.valueProgression.multipleValueImpact)}</span>
                <span>Combined effect</span>
                <span className="text-right tabular-nums">+{formatCurrency(d.valueProgression.combinedEffect)}</span>
                <span className="font-semibold text-foreground border-t pt-0.5">Total opportunity</span>
                <span className="font-semibold text-foreground text-right border-t pt-0.5 tabular-nums">+{formatCompact(d.valueProgression.opportunity)}</span>
              </div>
            </CalcBreakdown>
          </Card>
        </div>

        {/* Priority Actions */}
        <Card className="p-5 bg-slate-50/50 dark:bg-muted/30">
          <div className="flex items-center justify-between mb-4">
            <div className="text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground">
              Priority Actions
            </div>
            <button
              type="button"
              onClick={() => {
                tipsRequested.current = false;
                generateTips(
                  cockpitData.actions.map(a => ({
                    label: a.label, penaltyX: 0, value: a.evImpact,
                    metric: a.metric, actual: a.actual, target: a.target, category: a.category,
                  })),
                  {
                    sustainableEBITDA: d.sustainableEBITDA,
                    currentEV: cockpitData.currentEV,
                    optimisedEV: cockpitData.optimisedEV,
                    qualityScore: cockpitData.qScore,
                    overallReadiness: cockpitData.overallReadiness,
                  }
                );
              }}
              disabled={tipsLoading}
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
            >
              <RefreshCw className={cn('w-3 h-3', tipsLoading && 'animate-spin')} />
              {aiTips.length > 0 ? 'Refresh tips' : 'Generate AI tips'}
            </button>
          </div>
          <div className="space-y-0">
            {cockpitData.actions.map((action, i) => {
              const dotColor = action.severity === 'red' ? 'bg-red-500' : action.severity === 'amber' ? 'bg-amber-500' : 'bg-emerald-500';
              const tip = aiTips.find(t => t.actionLabel === action.label || action.label.includes(t.actionLabel));
              return (
                <div key={i} className="py-3 border-b last:border-b-0 border-border/60">
                  <div className="flex items-start gap-3">
                    <div className={cn('w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1', dotColor)} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-semibold text-foreground">{action.label}</div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[12px] font-semibold text-teal-600 dark:text-teal-400">+{formatCompact(action.evImpact)} EV</span>
                        <span className="text-[11px] text-muted-foreground">{action.timeframe}</span>
                      </div>
                    </div>
                  </div>
                  {/* AI Tip */}
                  {tipsLoading && !tip && (
                    <div className="ml-5.5 mt-2 pl-3 border-l-2 border-purple-200 dark:border-purple-800">
                      <div className="flex items-center gap-1.5">
                        <Sparkles className="w-3 h-3 text-purple-400 animate-pulse" />
                        <Skeleton className="h-3 w-48" />
                      </div>
                    </div>
                  )}
                  {tip && (
                    <div className="ml-[22px] mt-2 pl-3 border-l-2 border-purple-200 dark:border-purple-800">
                      <div className="flex items-start gap-1.5">
                        <Sparkles className="w-3 h-3 text-purple-500 flex-shrink-0 mt-0.5" />
                        <p className="text-[11.5px] text-muted-foreground leading-relaxed">{tip.tip}</p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {tipsError && (
            <div className="mt-3 text-[11px] text-muted-foreground/60 italic">{tipsError}</div>
          )}
        </Card>
      </div>
  );
}

export default function ExitCockpit() {
  return (
    <MainLayout userRole="admin">
      <Helmet><title>Exit Cockpit™ | DentPulse</title></Helmet>
      <ExitCockpitContent />
    </MainLayout>
  );
}
