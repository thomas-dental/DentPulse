import { useState, useMemo } from 'react';
import { Helmet } from 'react-helmet-async';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { Info } from 'lucide-react';
import { useEbitdaValuation } from '@/hooks/useEbitdaValuation';
import { useEbitdaSettings } from '@/hooks/useEbitdaSettings';
import { calculateQualityScore, calculateMultiple } from '@/utils/ebitda';

// ─── HELPERS ───
const formatCurrency = (value: number): string =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);

// ─── SLIDER COMPONENT ───
function SliderInput({
  label,
  value,
  min,
  max,
  step,
  target,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  target: string;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="mb-5">
      <div className="flex justify-between mb-1.5">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span className="text-xs font-bold text-foreground tabular-nums">{value}{suffix}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1 appearance-none rounded-full bg-border outline-none cursor-pointer accent-primary [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer"
      />
      <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
        <span>{min}{suffix}</span>
        <span>Target: {target}</span>
        <span>{max}{suffix}</span>
      </div>
    </div>
  );
}

// ─── INFO BUTTON ───
function InfoBtn({ info }: { info: { description: string; calculation: string } }) {
  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>
        <button className="flex-shrink-0 text-muted-foreground/50 hover:text-primary transition-colors" type="button">
          <Info className="w-3 h-3" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" align="start" className="w-[320px] p-3 shadow-lg border bg-popover z-[100]">
        <p className="text-[11px] font-medium text-popover-foreground mb-1.5 whitespace-normal break-words">{info.description}</p>
        <p className="text-[10px] text-muted-foreground font-mono leading-relaxed whitespace-normal break-words">{info.calculation}</p>
      </TooltipContent>
    </Tooltip>
  );
}

// ─── OUTPUT CARD ───
function OutputCard({
  label,
  value,
  delta,
  highlight,
  span,
  info,
}: {
  label: string;
  value: string;
  delta: { text: string; positive: boolean | null };
  highlight?: boolean;
  span?: boolean;
  info?: { description: string; calculation: string };
}) {
  return (
    <div className={cn(
      'bg-muted/50 border rounded-lg p-3.5',
      highlight ? 'border-primary' : 'border-border',
      span && 'col-span-2'
    )}>
      <div className="text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1">
        {label}
        {info && <InfoBtn info={info} />}
      </div>
      <div className={cn(
        'font-bold tabular-nums',
        highlight ? 'text-[30px] text-primary' : 'text-xl text-foreground'
      )}>
        {value}
      </div>
      <div className={cn(
        'text-[11px] font-medium mt-0.5',
        delta.positive === true ? 'text-success' : delta.positive === false ? 'text-danger' : 'text-muted-foreground'
      )}>
        {delta.text}
      </div>
    </div>
  );
}

// ─── MAIN PAGE ───
export function ScenarioSimulatorContent() {
  const { valuation, isLoading } = useEbitdaValuation();
  // Valuation multiple inputs come from the org's EBITDA Valuation Settings
  // (same source the Enterprise Overview / Multiple Engine use) so scenarios
  // stay consistent — never hardcode the base multiple or penalties.
  const { settings: ebitdaSettings } = useEbitdaSettings();

  // Slider state
  const [udaPct, setUdaPct] = useState<number | null>(null);
  const [depPct, setDepPct] = useState<number | null>(null);
  const [utilPct, setUtilPct] = useState<number | null>(null);
  const [cashPct, setCashPct] = useState<number | null>(null);
  const [newAssoc, setNewAssoc] = useState(0);

  // Derive baseline values from real data
  const baseline = useMemo(() => {
    if (!valuation) return null;
    // Extract current values from quality scores
    const scores = valuation.quality.scores;
    const getScore = (label: string) => scores.find(s => s.label === label)?.value ?? 50;

    return {
      ebitda: valuation.sustainableEBITDA,
      qualityScore: valuation.quality.finalScore,
      multiple: valuation.multiple.finalMultiple,
      ev: valuation.enterpriseValue,
      netDebt: valuation.netDebt,
      totalRevenue: valuation.totalRevenue,
      // Current metric values (reverse-engineered from scores for slider defaults)
      udaDeliveryPct: getScore('NHS Delivery') > 64 ? 92 : 85, // Approximate from score
      topProviderPct: Math.round(Math.max(0, (100 - getScore('Associate Dependency')) / 1.5)),
      utilisationPct: getScore('Chair Stability'),
      cashConversionPct: getScore('Cash Conversion'),
      nhsContractValue: valuation.totalRevenue * 0.3, // Approximate NHS portion
      hasGLData: valuation.hasGLData,
    };
  }, [valuation]);

  // Initialize sliders from baseline on first render
  const uda = udaPct ?? baseline?.udaDeliveryPct ?? 92;
  const dep = depPct ?? baseline?.topProviderPct ?? 29;
  const util = utilPct ?? baseline?.utilisationPct ?? 81;
  const cash = cashPct ?? baseline?.cashConversionPct ?? 88;

  // Simulated calculation
  const simulated = useMemo(() => {
    if (!baseline) return null;

    // Recalculate quality score with simulated inputs
    const newQuality = calculateQualityScore({
      monthlyRevenues: [], // Not changed by sliders — use empty for neutral score
      topProviderRevenuePct: dep,
      avgUtilisationPct: util,
      privateRevenuePct: 95, // Keep current
      paidInvoiceRate: cash / 100,
      udaDeliveryPct: uda,
    });

    // Recalculate multiple
    const newMultiple = calculateMultiple({
      baseMultiple: ebitdaSettings.base_multiple,
      totalRevenue: baseline.totalRevenue,
      avgUtilisationPct: util,
      qualityScore: newQuality.finalScore,
      topProviderRevenuePct: dep,
      udaDeliveryPct: uda,
      hasGLData: baseline.hasGLData,
      netDebtToEbitdaRatio: baseline.ebitda > 0 ? baseline.netDebt / baseline.ebitda : 0,
      mgmtDepthPenalty: ebitdaSettings.mgmt_depth_penalty,
      standardisationPenalty: ebitdaSettings.standardisation_penalty,
      leveragePenalty: ebitdaSettings.leverage_penalty,
      customPenalties: ebitdaSettings.custom_penalties,
    });

    // Recalculate EBITDA with NHS clawback adjustment + new associates
    const currentClawback = baseline.nhsContractValue > 0 && uda < 96
      ? baseline.nhsContractValue * (100 - 92) / 100 : 0; // Current clawback at baseline UDA
    const newClawback = baseline.nhsContractValue > 0 && uda < 96
      ? baseline.nhsContractValue * (100 - uda) / 100 : 0;
    const clawbackGain = currentClawback - newClawback;
    const associateGain = newAssoc * 120000 * 0.5;
    const newEbitda = baseline.ebitda + clawbackGain + associateGain;

    const newEv = newEbitda * newMultiple.finalMultiple;
    const delta = newEv - baseline.ev;

    // Value build-up
    const buildUp: Array<{ label: string; value: number; isBase?: boolean }> = [
      { label: `${formatCurrency(baseline.ev)} baseline`, value: baseline.ev, isBase: true },
    ];
    if (clawbackGain > 0) {
      buildUp.push({ label: '+ NHS UDA fix', value: clawbackGain * newMultiple.finalMultiple });
    }
    if (newAssoc > 0) {
      buildUp.push({ label: '+ New associates', value: associateGain * newMultiple.finalMultiple });
    }
    if (newMultiple.finalMultiple > baseline.multiple) {
      buildUp.push({ label: '+ Multiple improvement', value: (newMultiple.finalMultiple - baseline.multiple) * newEbitda });
    }

    return {
      ebitda: newEbitda,
      qualityScore: newQuality.finalScore,
      multiple: newMultiple.finalMultiple,
      ev: newEv,
      delta,
      buildUp,
      per100k: Math.round(newMultiple.finalMultiple * 100000),
    };
  }, [baseline, uda, dep, util, cash, newAssoc, ebitdaSettings]);

  // Delta helpers
  function getDelta(current: number, base: number, suffix = ''): { text: string; positive: boolean | null } {
    const d = current - base;
    if (Math.abs(d) < 1) return { text: 'baseline', positive: null };
    const sign = d > 0 ? '↑ +' : '↓ ';
    return { text: `${sign}${formatCurrency(Math.abs(d))}${suffix} vs baseline`, positive: d > 0 };
  }

  function getDeltaPts(current: number, base: number): { text: string; positive: boolean | null } {
    const d = current - base;
    if (d === 0) return { text: 'baseline', positive: null };
    return { text: `${d > 0 ? '↑ +' : '↓ '}${Math.abs(d)} pts`, positive: d > 0 };
  }

  function getDeltaMult(current: number, base: number): { text: string; positive: boolean | null } {
    const d = current - base;
    if (Math.abs(d) < 0.05) return { text: 'baseline', positive: null };
    return { text: `${d > 0 ? '↑ +' : '↓ '}${Math.abs(d).toFixed(1)}×`, positive: d > 0 };
  }

  function applyOptimised() {
    setUdaPct(97);
    setDepPct(18);
    setUtilPct(87);
    setCashPct(95);
    setNewAssoc(1);
  }

  function resetToBaseline() {
    setUdaPct(null);
    setDepPct(null);
    setUtilPct(null);
    setCashPct(null);
    setNewAssoc(0);
  }

  if (isLoading || !valuation || !baseline || !simulated) {
    return (
        <div className="space-y-4">
          {/* Header */}
          <div>
            <Skeleton className="h-6 w-44 mb-2" />
            <Skeleton className="h-4 w-64" />
          </div>

          {/* 4 KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[1, 2, 3, 4].map(i => (
              <Card key={i} className="p-4 text-center">
                <Skeleton className="h-3 w-24 mx-auto mb-3" />
                <Skeleton className="h-8 w-28 mx-auto mb-2" />
                <Skeleton className="h-3 w-20 mx-auto" />
              </Card>
            ))}
          </div>

          {/* Sliders + Scenarios */}
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-3.5">
            {/* Sliders */}
            <Card className="p-4">
              <div className="flex items-center justify-between mb-4">
                <Skeleton className="h-3 w-32" />
                <div className="flex gap-2">
                  <Skeleton className="h-7 w-20 rounded-md" />
                  <Skeleton className="h-7 w-28 rounded-md" />
                </div>
              </div>
              <div className="space-y-5">
                {[1, 2, 3, 4, 5].map(i => (
                  <div key={i} className="space-y-2">
                    <div className="flex justify-between">
                      <Skeleton className="h-3 w-32" />
                      <Skeleton className="h-3 w-12" />
                    </div>
                    <Skeleton className="h-2 w-full rounded-full" />
                  </div>
                ))}
              </div>
            </Card>

            {/* Scenario Cards */}
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <Card key={i} className="p-4">
                  <Skeleton className="h-4 w-28 mb-2" />
                  <Skeleton className="h-6 w-24 mb-1" />
                  <Skeleton className="h-3 w-36" />
                </Card>
              ))}
            </div>
          </div>

          {/* Value Build-up */}
          <Card className="p-4">
            <Skeleton className="h-3 w-28 mb-4" />
            <div className="space-y-2">
              {[1, 2, 3].map(i => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="h-6 flex-1 rounded" />
                  <Skeleton className="h-4 w-20" />
                </div>
              ))}
            </div>
          </Card>
        </div>
    );
  }

  // Scenario cards
  const scenarioNhsFix = (() => {
    const q = calculateQualityScore({ monthlyRevenues: [], topProviderRevenuePct: dep, avgUtilisationPct: util, privateRevenuePct: 95, paidInvoiceRate: cash / 100, udaDeliveryPct: 97 });
    const m = calculateMultiple({ baseMultiple: ebitdaSettings.base_multiple, totalRevenue: baseline.totalRevenue, avgUtilisationPct: util, qualityScore: q.finalScore, topProviderRevenuePct: dep, udaDeliveryPct: 97, hasGLData: baseline.hasGLData, netDebtToEbitdaRatio: 0, mgmtDepthPenalty: ebitdaSettings.mgmt_depth_penalty, standardisationPenalty: ebitdaSettings.standardisation_penalty, leveragePenalty: ebitdaSettings.leverage_penalty, customPenalties: ebitdaSettings.custom_penalties });
    const clawbackGain = baseline.nhsContractValue > 0 ? baseline.nhsContractValue * (100 - 92) / 100 : 0;
    const ebitda = baseline.ebitda + clawbackGain;
    return { ev: ebitda * m.finalMultiple, multiple: m.finalMultiple, ebitda };
  })();

  const scenarioOptimised = (() => {
    const q = calculateQualityScore({ monthlyRevenues: [], topProviderRevenuePct: 18, avgUtilisationPct: 87, privateRevenuePct: 95, paidInvoiceRate: 0.95, udaDeliveryPct: 97 });
    const m = calculateMultiple({ baseMultiple: ebitdaSettings.base_multiple, totalRevenue: baseline.totalRevenue, avgUtilisationPct: 87, qualityScore: q.finalScore, topProviderRevenuePct: 18, udaDeliveryPct: 97, hasGLData: baseline.hasGLData, netDebtToEbitdaRatio: 0, mgmtDepthPenalty: ebitdaSettings.mgmt_depth_penalty, standardisationPenalty: ebitdaSettings.standardisation_penalty, leveragePenalty: ebitdaSettings.leverage_penalty, customPenalties: ebitdaSettings.custom_penalties });
    const ebitda = baseline.ebitda + (baseline.nhsContractValue > 0 ? baseline.nhsContractValue * 0.08 : 0) + 60000;
    return { ev: ebitda * m.finalMultiple, multiple: m.finalMultiple, ebitda };
  })();

  return (
      <div className="space-y-4">
        <div>
          <h1 className="text-xl font-bold text-foreground">Scenario Simulator</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Drag the levers to simulate valuation impact</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
          {/* Left: Input Levers */}
          <Card className="p-5">
            <span className="text-[9.5px] font-bold tracking-wider uppercase text-muted-foreground mb-4 block">Input Levers</span>

            <SliderInput label="UDA Delivery %" value={uda} min={85} max={100} step={0.5} target="96%" suffix="%" onChange={setUdaPct} />
            <SliderInput label="Associate Concentration (Top Provider)" value={dep} min={10} max={50} step={1} target="20%" suffix="%" onChange={setDepPct} />
            <SliderInput label="Chair Utilisation %" value={util} min={60} max={95} step={1} target="87%" suffix="%" onChange={setUtilPct} />
            <SliderInput label="Cash Conversion %" value={cash} min={70} max={99} step={1} target="95%" suffix="%" onChange={setCashPct} />
            <SliderInput label="New Associates Added" value={newAssoc} min={0} max={3} step={1} target="1" suffix="" onChange={setNewAssoc} />

            <button
              onClick={applyOptimised}
              className="w-full mb-1.5 py-2.5 bg-primary text-primary-foreground border-none rounded-lg text-xs font-semibold cursor-pointer"
            >
              Apply Optimised Scenario → {formatCurrency(scenarioOptimised.ev)}
            </button>
            <button
              onClick={resetToBaseline}
              className="w-full py-2 bg-transparent text-muted-foreground border border-border rounded-lg text-xs cursor-pointer hover:bg-muted transition-colors"
            >
              Reset to baseline
            </button>
          </Card>

          {/* Right: Live Output */}
          <Card className="p-5">
            <span className="text-[9.5px] font-bold tracking-wider uppercase text-muted-foreground mb-4 block">Live Valuation</span>

            <div className="grid grid-cols-2 gap-2.5 mb-3">
              <OutputCard
                label="Sustainable EBITDA™"
                value={formatCurrency(simulated.ebitda)}
                delta={getDelta(simulated.ebitda, baseline.ebitda)}
                info={{
                  description: 'Sustainable EBITDA after adjusting for NHS clawback changes and new associate revenue.',
                  calculation: `Baseline EBITDA: ${formatCurrency(baseline.ebitda)}${simulated.ebitda !== baseline.ebitda ? `. NHS clawback adjustment + new associate gain = ${formatCurrency(simulated.ebitda - baseline.ebitda)}. Simulated EBITDA = ${formatCurrency(simulated.ebitda)}.` : ' (unchanged).'}`,
                }}
              />
              <OutputCard
                label="Quality Score"
                value={String(simulated.qualityScore)}
                delta={getDeltaPts(simulated.qualityScore, baseline.qualityScore)}
                info={{
                  description: 'Recalculated quality score from simulated slider values. Weighted sum of 6 sub-scores.',
                  calculation: `Inputs: UDA ${uda}%, Associate Dep. ${dep}%, Utilisation ${util}%, Cash Conv. ${cash}%. Baseline score: ${baseline.qualityScore} → Simulated: ${simulated.qualityScore}.`,
                }}
              />
              <OutputCard
                label="Enterprise Value"
                value={formatCurrency(simulated.ev)}
                delta={getDelta(simulated.ev, baseline.ev)}
                highlight
                span
                info={{
                  description: 'Enterprise Value = Sustainable EBITDA × Valuation Multiple.',
                  calculation: `${formatCurrency(simulated.ebitda)} × ${simulated.multiple.toFixed(1)}× = ${formatCurrency(simulated.ev)}. Baseline was ${formatCurrency(baseline.ev)} (${formatCurrency(baseline.ebitda)} × ${baseline.multiple}×).`,
                }}
              />
              <OutputCard
                label="Multiple"
                value={`${simulated.multiple.toFixed(1)}×`}
                delta={getDeltaMult(simulated.multiple, baseline.multiple)}
                info={{
                  description: 'Valuation multiple recalculated from simulated inputs. Built as: Base Market + premiums − penalties.',
                  calculation: `Base: 5.8×. Premiums/penalties applied for chair utilisation (${util}%), associate dependency (${dep}%), UDA delivery (${uda}%), quality score (${simulated.qualityScore}), reporting, leverage. Final: ${simulated.multiple.toFixed(1)}×.`,
                }}
              />
              <OutputCard
                label="Δ Change"
                value={simulated.delta > 1000 ? `+${formatCurrency(simulated.delta)}` : '£0'}
                delta={{ text: simulated.delta > 1000 ? 'above baseline' : 'at baseline', positive: simulated.delta > 1000 ? true : null }}
                info={{
                  description: 'Total value change from your simulated adjustments vs baseline.',
                  calculation: `Simulated EV (${formatCurrency(simulated.ev)}) − Baseline EV (${formatCurrency(baseline.ev)}) = ${formatCurrency(simulated.delta)}.`,
                }}
              />
            </div>

            {/* Value Build-Up */}
            <div className="mt-3 p-3 bg-muted/50 rounded-lg border border-border">
              <div className="text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Value Build-Up</div>
              {simulated.buildUp.map((row, i) => (
                <div key={i} className="flex justify-between text-[11.5px] py-0.5 border-b border-border last:border-b-0">
                  <span className="text-muted-foreground">{row.label}</span>
                  <span className={cn('font-semibold tabular-nums', row.isBase ? 'text-foreground' : 'text-success')}>
                    {row.isBase ? formatCurrency(row.value) : `+${formatCurrency(row.value)}`}
                  </span>
                </div>
              ))}
              <div className="flex justify-between text-xs py-1 font-bold mt-1 pt-1 border-t border-border">
                <span>Simulated</span>
                <span className="text-primary tabular-nums">{formatCurrency(simulated.ev)}</span>
              </div>
            </div>

            {/* Insight strip */}
            <div className="mt-3 bg-foreground rounded-lg px-4 py-3 text-xs text-background leading-relaxed">
              Every <strong className="text-primary-foreground">£100,000 EBITDA</strong> improvement = <strong className="text-primary-foreground">{formatCurrency(simulated.per100k)}</strong> enterprise value at current multiple
            </div>
          </Card>
        </div>

        {/* Scenario Comparison Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3.5">
          <Card className="p-4 text-center">
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Scenario A — Current</div>
            <div className="text-2xl font-bold text-foreground tabular-nums">{formatCurrency(baseline.ev)}</div>
            <div className="text-[11px] text-muted-foreground mt-1">{baseline.multiple}× / {formatCurrency(baseline.ebitda)} EBITDA</div>
          </Card>
          <Card className="p-4 text-center">
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Scenario B — NHS Fix</div>
            <div className="text-2xl font-bold text-foreground tabular-nums">{formatCurrency(scenarioNhsFix.ev)}</div>
            <div className="text-[11px] text-muted-foreground mt-1">{scenarioNhsFix.multiple}× / {formatCurrency(scenarioNhsFix.ebitda)} EBITDA</div>
          </Card>
          <Card className="p-4 text-center border-2 border-primary bg-primary/5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-primary mb-1.5">Scenario C — Optimised</div>
            <div className="text-2xl font-bold text-primary tabular-nums">{formatCurrency(scenarioOptimised.ev)}</div>
            <div className="text-[11px] text-primary mt-1">{scenarioOptimised.multiple}× / {formatCurrency(scenarioOptimised.ebitda)} EBITDA</div>
          </Card>
        </div>
      </div>
  );
}

export default function ScenarioSimulator() {
  return (
    <MainLayout userRole="admin">
      <Helmet>
        <title>Scenario Simulator | DentPulse</title>
        <meta name="description" content="Simulate valuation scenarios by adjusting key operational levers" />
      </Helmet>
      <ScenarioSimulatorContent />
    </MainLayout>
  );
}
