import { useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { Info, Pencil } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useEbitdaValuation } from '@/hooks/useEbitdaValuation';
import { DEFAULT_QUALITY_WEIGHTS, type QualityWeights } from '@/utils/ebitda/qualityScore';

// ─── HELPERS ───

const scoreColor = (v: number) => (v >= 80 ? 'text-success' : v >= 60 ? 'text-warning' : 'text-danger');
const scoreBg = (v: number) => (v >= 80 ? 'bg-success' : v >= 60 ? 'bg-warning' : 'bg-danger');
const scoreHsl = (v: number) => (v >= 80 ? 'hsl(var(--success))' : v >= 60 ? 'hsl(var(--warning))' : 'hsl(var(--danger))');
const scoreTagClass = (v: number) =>
  v >= 80 ? 'bg-success-muted text-success' : v >= 60 ? 'bg-warning-muted text-warning' : 'bg-danger-muted text-danger';

const LABEL_TO_WEIGHT_KEY: Record<string, keyof QualityWeights> = {
  'Revenue Predictability': 'revenue_predictability',
  'Associate Dependency': 'associate_dependency',
  'Chair Stability': 'chair_stability',
  'Treatment Mix': 'treatment_mix',
  'Cash Conversion': 'cash_conversion',
  'NHS Delivery': 'nhs_delivery',
};

function buildQualityInfo(inputs: {
  monthlyRevenues: number[];
  topProviderRevenuePct: number;
  avgUtilisationPct: number;
  privateRevenuePct: number;
  paidInvoiceRate: number;
  udaDeliveryPct: number | null;
} | null): Record<string, { description: string; calculation: string }> {
  if (!inputs) return {};
  const monthCount = inputs.monthlyRevenues.length;
  const mean = monthCount > 0 ? inputs.monthlyRevenues.reduce((s, v) => s + v, 0) / monthCount : 0;
  const variance = monthCount > 1 ? inputs.monthlyRevenues.reduce((s, v) => s + (v - mean) ** 2, 0) / monthCount : 0;
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;
  const cvPct = Math.round(cv * 100);
  const revScore = Math.max(0, Math.min(100, Math.round(100 - cv * 200)));
  const topPct = Math.round(inputs.topProviderRevenuePct);
  const assocScore = Math.max(0, Math.min(100, Math.round(100 - inputs.topProviderRevenuePct * 1.5)));
  const chairPct = Math.round(inputs.avgUtilisationPct);
  const privatePct = Math.round(inputs.privateRevenuePct);
  const paidPct = Math.round(inputs.paidInvoiceRate * 100);
  const udaPct = inputs.udaDeliveryPct != null ? Math.round(inputs.udaDeliveryPct) : null;

  return {
    'Revenue Predictability': {
      description: 'How consistent is monthly revenue? High variation = unpredictable earnings.',
      calculation: `CV = ${cvPct}% (from ${monthCount} months of revenue). Score = 100 − (${cvPct}% × 2) = ${revScore}.`,
    },
    'Associate Dependency': {
      description: 'How much revenue depends on the top associate? High concentration = risky.',
      calculation: `Top provider = ${topPct}% of total revenue. Score = 100 − (${topPct} × 1.5) = ${assocScore}.`,
    },
    'Chair Stability': {
      description: 'Average chair utilisation across all locations. Low utilisation = wasted capacity.',
      calculation: `Avg utilisation = ${chairPct}%. Score = ${chairPct}.`,
    },
    'Treatment Mix': {
      description: 'Percentage of revenue from private treatments. Higher private = better margins.',
      calculation: `Private revenue = ${privatePct}% of total. Score = ${privatePct}.`,
    },
    'Cash Conversion': {
      description: 'How many invoices are actually paid? High paid rate = healthy cash flow.',
      calculation: `Paid rate = ${paidPct}%. Score = ${paidPct}.`,
    },
    'NHS Delivery': {
      description: 'UDA delivery rate against NHS contract target. Under-delivery risks clawback.',
      calculation: udaPct != null ? `UDA delivery = ${udaPct}%. Score = ${udaPct}.` : 'No NHS contract → default score 65 (neutral).',
    },
  };
}

function getRawMetric(label: string, inputs: {
  monthlyRevenues: number[];
  topProviderRevenuePct: number;
  avgUtilisationPct: number;
  privateRevenuePct: number;
  paidInvoiceRate: number;
  udaDeliveryPct: number | null;
}): string {
  switch (label) {
    case 'Revenue Predictability': {
      if (inputs.monthlyRevenues.length < 2) return 'N/A';
      const mean = inputs.monthlyRevenues.reduce((s, v) => s + v, 0) / inputs.monthlyRevenues.length;
      if (mean === 0) return '0%';
      const variance = inputs.monthlyRevenues.reduce((s, v) => s + (v - mean) ** 2, 0) / inputs.monthlyRevenues.length;
      const cv = Math.sqrt(variance) / mean;
      return `${(cv * 100).toFixed(0)}% CV`;
    }
    case 'Associate Dependency':
      return `${inputs.topProviderRevenuePct.toFixed(0)}%`;
    case 'Chair Stability':
      return `${inputs.avgUtilisationPct.toFixed(0)}%`;
    case 'Treatment Mix':
      return `${inputs.privateRevenuePct.toFixed(0)}%`;
    case 'Cash Conversion':
      return `${(inputs.paidInvoiceRate * 100).toFixed(0)}%`;
    case 'NHS Delivery':
      return inputs.udaDeliveryPct != null ? `${inputs.udaDeliveryPct.toFixed(0)}%` : 'N/A';
    default:
      return 'N/A';
  }
}

function InfoButton({ info }: { info: { description: string; calculation: string } }) {
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

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);
}

// ─── MAIN PAGE ───

export function QualityScoreContent() {
  const { valuation: d, isLoading, settingsApi } = useEbitdaValuation();
  const [editingWeights, setEditingWeights] = useState(false);
  const [weightInputs, setWeightInputs] = useState<QualityWeights>(DEFAULT_QUALITY_WEIGHTS);

  if (isLoading || !d) {
    return (
        <div className="space-y-4">
          {/* Header */}
          <div>
            <Skeleton className="h-6 w-52 mb-2" />
            <Skeleton className="h-4 w-64" />
          </div>

          {/* Gauge + Component Table */}
          <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-3.5">
            {/* Gauge Card */}
            <Card className="p-4 flex flex-col items-center">
              <Skeleton className="h-3 w-24 mb-4" />
              <Skeleton className="h-[120px] w-[120px] rounded-full mb-4" />
              <Skeleton className="h-5 w-32 rounded-full mb-3" />
              <div className="w-full space-y-1.5">
                {[1, 2, 3, 4].map(i => (
                  <Skeleton key={i} className="h-4 w-full" />
                ))}
              </div>
            </Card>

            {/* Component Table */}
            <Card className="p-4">
              <div className="flex items-center justify-between mb-3">
                <Skeleton className="h-3 w-40" />
                <Skeleton className="h-3 w-24" />
              </div>
              <div className="space-y-0">
                <div className="flex gap-3 border-b-2 border-border pb-2 mb-1">
                  {['w-28', 'w-20', 'w-16', 'w-16', 'w-20'].map((w, i) => (
                    <Skeleton key={i} className={`h-3 ${w}`} />
                  ))}
                </div>
                {[1, 2, 3, 4, 5, 6].map(j => (
                  <div key={j} className="flex gap-3 py-2.5 border-b border-border">
                    <Skeleton className="h-3 w-28" />
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-4 w-16 rounded-full" />
                    <Skeleton className="h-3 w-16" />
                    <Skeleton className="h-3 w-20" />
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {/* Multiple Impact Card */}
          <Card className="p-4">
            <Skeleton className="h-3 w-36 mb-4" />
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="text-center space-y-2">
                  <Skeleton className="h-6 w-20 mx-auto" />
                  <Skeleton className="h-3 w-28 mx-auto" />
                </div>
              ))}
            </div>
          </Card>
        </div>
    );
  }

  const qualityScore = d.quality.finalScore;
  const QUALITY_INFO = buildQualityInfo(d.qualityInputs);
  const qualityHsl = scoreHsl(qualityScore);
  const qualityLabel = qualityScore >= 80 ? 'Premium'
    : qualityScore >= 65 ? 'Solid'
    : qualityScore >= 50 ? 'Moderate Risk'
    : 'High Risk';

  // Gauge calculations
  const radius = 48;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (qualityScore / 100) * circumference;

  // Multiple impact based on score band — must match multipleEngine.ts thresholds
  const getMultipleImpact = (score: number) => {
    if (score >= 85) return { impact: '0x', label: 'no penalty' };
    if (score >= 75) return { impact: '-0.1x', label: 'minor drag' };
    if (score >= 65) return { impact: '-0.2x', label: 'current drag' };
    return { impact: '-0.3x', label: 'multiple drag' };
  };

  const currentImpact = getMultipleImpact(qualityScore);

  // Calculate what improving to 80 would add
  const sustainableEBITDA = d.sustainableEBITDA;
  const currentMultiple = d.multiple.finalMultiple;
  // If score goes from current band to 80+ (0x band), the delta is the negative of current drag
  const improvedMultipleDelta = qualityScore < 85
    ? (qualityScore < 65 ? 0.3 : qualityScore < 75 ? 0.2 : 0.1)
    : 0;
  const improvedValueDelta = Math.round(sustainableEBITDA * improvedMultipleDelta);

  return (
      <TooltipProvider>
      <div className="space-y-4">
        {/* Page Header */}
        <div>
          <h1 className="text-xl font-bold text-foreground">EBITDA Quality Score&trade;</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Component breakdown and multiple impact analysis</p>
        </div>

        {/* Top Row: Gauge + Component Table */}
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-3.5">

          {/* Overall Score Gauge */}
          <Card className="p-4 text-center">
            <span className="text-[9.5px] font-bold tracking-wider uppercase text-muted-foreground block mb-3">Overall Score</span>

            <div className="relative w-[120px] h-[120px] mx-auto my-3">
              <svg width="120" height="120" viewBox="0 0 120 120">
                <circle cx="60" cy="60" r={radius} fill="none" stroke="hsl(var(--border))" strokeWidth="9" />
                <circle
                  cx="60" cy="60" r={radius} fill="none"
                  stroke={qualityHsl} strokeWidth="9" strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={dashOffset}
                  transform="rotate(-90 60 60)"
                  className="transition-all duration-700"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-[30px] font-bold tabular-nums" style={{ color: qualityHsl }}>{qualityScore}</span>
                <span className="text-[10px] text-muted-foreground">/100</span>
              </div>
            </div>

            <div className={cn('inline-flex text-[9.5px] font-bold px-2 py-0.5 rounded mb-3', scoreTagClass(qualityScore))}>
              {qualityLabel}
            </div>

            {/* Score ranges legend */}
            <div className="text-left bg-muted rounded-lg p-2.5 text-[10.5px] leading-relaxed text-muted-foreground space-y-0.5">
              <div className="py-0.5 border-b border-border">80-100: <strong className="text-success">Premium</strong></div>
              <div className={cn('py-0.5 border-b border-border', qualityScore >= 65 && qualityScore < 80 && 'font-semibold text-foreground')}>
                65-79: <strong className="text-warning">Solid - some risk{qualityScore >= 65 && qualityScore < 80 ? ' \u2190 here' : ''}</strong>
              </div>
              <div className={cn('py-0.5 border-b border-border', qualityScore >= 50 && qualityScore < 65 && 'font-semibold text-foreground')}>
                50-64: <strong className="text-warning">Moderate risk{qualityScore >= 50 && qualityScore < 65 ? ' \u2190 here' : ''}</strong>
              </div>
              <div className={cn('py-0.5', qualityScore < 50 && 'font-semibold text-foreground')}>
                Below 50: <strong className="text-danger">High risk{qualityScore < 50 ? ' \u2190 here' : ''}</strong>
              </div>
            </div>
          </Card>

          {/* Component Breakdown Table */}
          <Card className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-1.5">
                <span className="text-[9.5px] font-bold tracking-wider uppercase text-muted-foreground">Component Breakdown</span>
                <span className="text-[9px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded font-semibold font-mono">DentPulse model</span>
              </div>
              {!editingWeights && (
                <button
                  onClick={() => {
                    setWeightInputs(settingsApi.current.quality_weights);
                    setEditingWeights(true);
                  }}
                  className="flex items-center gap-1 text-[10px] text-primary hover:text-primary/80 transition-colors"
                  type="button"
                >
                  <Pencil className="w-2.5 h-2.5" />
                  <span>Adjust weights</span>
                </button>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-[12px] border-collapse">
                <thead>
                  <tr className="border-b-2 border-border">
                    <th className="text-left py-2 px-2 text-[11px] text-muted-foreground font-semibold bg-muted">Component</th>
                    <th className="text-left py-2 px-2 text-[11px] text-muted-foreground font-semibold bg-muted">Raw Metric</th>
                    <th className="text-left py-2 px-2 text-[11px] text-muted-foreground font-semibold bg-muted">Score</th>
                    <th className="text-left py-2 px-2 text-[11px] text-muted-foreground font-semibold bg-muted">Weight</th>
                    <th className="text-left py-2 px-2 text-[11px] text-muted-foreground font-semibold bg-muted">
                      Contribution
                      <span className="text-[8px] font-normal ml-0.5">(Score × Weight)</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {d.quality.scores.map((s) => {
                    const info = QUALITY_INFO[s.label];
                    const rawMetric = getRawMetric(s.label, d.qualityInputs);
                    const contribution = (s.value * s.weight).toFixed(1);
                    const weightKey = LABEL_TO_WEIGHT_KEY[s.label];
                    return (
                      <tr key={s.label} className="border-b border-border hover:bg-muted/50 transition-colors">
                        <td className="py-2 px-2 text-muted-foreground flex items-center gap-1">
                          {s.label}
                          {info && <InfoButton info={info} />}
                        </td>
                        <td className="py-2 px-2 tabular-nums font-medium">{rawMetric}</td>
                        <td className="py-2 px-2">
                          <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded tabular-nums', scoreTagClass(s.value))}>
                            {s.value}
                          </span>
                        </td>
                        <td className="py-2 px-2 tabular-nums">
                          {editingWeights && weightKey ? (
                            <div className="flex items-center gap-0.5">
                              <input
                                type="number"
                                step="1"
                                min="0"
                                max="100"
                                value={Math.round(weightInputs[weightKey] * 100)}
                                onChange={(e) => {
                                  const val = parseInt(e.target.value) || 0;
                                  setWeightInputs(prev => ({ ...prev, [weightKey]: val / 100 }));
                                }}
                                className="w-11 h-5 text-[10px] text-right border border-border rounded px-1 bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                              />
                              <span className="text-[10px] text-muted-foreground">%</span>
                            </div>
                          ) : (
                            <span>{Math.round(s.weight * 100)}%</span>
                          )}
                        </td>
                        <td className="py-2 px-2 tabular-nums font-medium">{contribution}</td>
                      </tr>
                    );
                  })}
                  {/* Final Score Row */}
                  <tr className="border-t-2 border-border bg-muted">
                    <td colSpan={4} className="py-2.5 px-2 font-bold">Final Score</td>
                    <td className="py-2.5 px-2 font-bold text-[16px] tabular-nums" style={{ color: qualityHsl }}>
                      {d.quality.scores.reduce((s, item) => s + item.value * item.weight, 0).toFixed(2)} &asymp; {qualityScore}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Weight editing controls */}
            {editingWeights && (() => {
              const total = Object.values(weightInputs).reduce((s, v) => s + v, 0);
              const totalPct = Math.round(total * 100);
              const isValid = totalPct === 100;
              return (
                <div className="mt-3 pt-2 border-t border-border space-y-2">
                  <div className="flex items-center justify-between">
                    <span className={cn('text-[10px] font-semibold', isValid ? 'text-success' : 'text-danger')}>
                      Total: {totalPct}%
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => setEditingWeights(false)}
                        className="text-[10px] px-2 py-0.5 rounded border border-border text-muted-foreground hover:bg-muted"
                        type="button"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => {
                          if (isValid) {
                            settingsApi.update({ quality_weights: weightInputs });
                            setEditingWeights(false);
                          }
                        }}
                        disabled={!isValid}
                        className={cn('text-[10px] px-2 py-0.5 rounded font-medium',
                          isValid ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'bg-muted text-muted-foreground cursor-not-allowed'
                        )}
                        type="button"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                  <div className="p-2 bg-muted/50 rounded-md border border-border/50">
                    <div className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Changing weights will also update</div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5 text-[10px]">
                        <span className="w-1 h-1 rounded-full bg-primary flex-shrink-0" />
                        <span className="text-muted-foreground">This page</span>
                        <span className="text-muted-foreground/40">&rarr;</span>
                        <span className="font-medium text-foreground">Overall Score &amp; Component Contributions</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-[10px]">
                        <span className="w-1 h-1 rounded-full bg-primary flex-shrink-0" />
                        <span className="text-muted-foreground">Multiple Engine</span>
                        <span className="text-muted-foreground/40">&rarr;</span>
                        <span className="font-medium text-foreground">Quality Score Drag (on multiple waterfall)</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-[10px]">
                        <span className="w-1 h-1 rounded-full bg-primary flex-shrink-0" />
                        <span className="text-muted-foreground">Enterprise Overview</span>
                        <span className="text-muted-foreground/40">&rarr;</span>
                        <span className="font-medium text-foreground">Quality Score card, Enterprise Value &amp; Equity Value</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-[10px]">
                        <span className="w-1 h-1 rounded-full bg-primary flex-shrink-0" />
                        <span className="text-muted-foreground">Enterprise Overview</span>
                        <span className="text-muted-foreground/40">&rarr;</span>
                        <span className="font-medium text-foreground">Value Progression (baseline &amp; optimised)</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}
          </Card>
        </div>

        {/* Quality -> Multiple Impact */}
        <Card className="p-4">
          <span className="text-[9.5px] font-bold tracking-wider uppercase text-muted-foreground block mb-3">
            Quality &rarr; Multiple Impact
          </span>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
            {/* Score < 65 */}
            <div className={cn(
              'p-3 border rounded-lg text-center',
              qualityScore < 65
                ? 'border-2 border-danger bg-danger-muted'
                : 'border-border'
            )}>
              <div className={cn('text-[11px]', qualityScore < 65 ? 'text-danger' : 'text-muted-foreground')}>
                Score &lt; 65{qualityScore < 65 ? ' \u2190 now' : ''}
              </div>
              <div className="text-[16px] font-bold text-danger tabular-nums">-0.3x</div>
              <div className={cn('text-[10px]', qualityScore < 65 ? 'text-danger' : 'text-muted-foreground')}>
                on multiple
              </div>
            </div>

            {/* Score 65-74 */}
            <div className={cn(
              'p-3 border rounded-lg text-center',
              qualityScore >= 65 && qualityScore < 75
                ? 'border-2 border-warning bg-warning-muted'
                : 'border-border'
            )}>
              <div className={cn('text-[11px]', qualityScore >= 65 && qualityScore < 75 ? 'text-warning' : 'text-muted-foreground')}>
                Score 65-74{qualityScore >= 65 && qualityScore < 75 ? ' \u2190 now' : ''}
              </div>
              <div className="text-[16px] font-bold text-warning tabular-nums">-0.2x</div>
              <div className={cn('text-[10px]', qualityScore >= 65 && qualityScore < 75 ? 'text-warning' : 'text-muted-foreground')}>
                on multiple
              </div>
            </div>

            {/* Score 75-84 */}
            <div className={cn(
              'p-3 border rounded-lg text-center',
              qualityScore >= 75 && qualityScore < 85
                ? 'border-2 border-warning/50 bg-warning-muted/30'
                : 'border-border'
            )}>
              <div className={cn('text-[11px]', qualityScore >= 75 && qualityScore < 85 ? 'text-foreground' : 'text-muted-foreground')}>
                Score 75-84{qualityScore >= 75 && qualityScore < 85 ? ' \u2190 now' : ''}
              </div>
              <div className="text-[16px] font-bold text-warning/70 tabular-nums">-0.1x</div>
              <div className="text-[10px] text-muted-foreground">minor drag</div>
            </div>

            {/* Score 85+ */}
            <div className={cn(
              'p-3 border rounded-lg text-center',
              qualityScore >= 85
                ? 'border-2 border-success bg-success-muted'
                : 'border-border'
            )}>
              <div className={cn('text-[11px]', qualityScore >= 85 ? 'text-success' : 'text-muted-foreground')}>
                Score 85+{qualityScore >= 85 ? ' \u2190 now' : ''}
              </div>
              <div className="text-[16px] font-bold text-success tabular-nums">0x</div>
              <div className={cn('text-[10px]', qualityScore >= 85 ? 'text-success' : 'text-muted-foreground')}>
                no penalty
              </div>
            </div>
          </div>

          {/* Action insight */}
          {improvedMultipleDelta > 0 && (
            <div className="mt-3 p-3 bg-primary/5 border border-primary/20 rounded-lg text-[12px] text-primary">
              <strong>Action:</strong> Improving score from <strong>{qualityScore}</strong> &rarr; <strong>85+</strong> would remove the <strong>{currentImpact.impact}</strong> quality drag from your multiple.
              <div className="mt-1 text-[10px] font-mono text-primary/70">
                {formatCurrency(sustainableEBITDA)} EBITDA × +{improvedMultipleDelta.toFixed(1)}× = <strong>{formatCurrency(improvedValueDelta)}</strong> extra enterprise value
              </div>
            </div>
          )}
        </Card>

        {/* Score Bars Visual */}
        <Card className="p-4">
          <span className="text-[9.5px] font-bold tracking-wider uppercase text-muted-foreground block mb-3">Score Distribution</span>
          <div className="space-y-1">
            {d.quality.scores.map((s) => {
              const info = QUALITY_INFO[s.label];
              return (
                <div key={s.label} className="flex items-center gap-2 mb-1.5">
                  <span className="text-[11px] text-muted-foreground w-[145px] flex-shrink-0 flex items-center gap-1 whitespace-nowrap overflow-hidden">
                    <span className="truncate">{s.label}</span>
                    {info && <InfoButton info={info} />}
                  </span>
                  <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className={cn('h-full rounded-full transition-all duration-500', scoreBg(s.value))}
                      style={{ width: `${s.value}%` }}
                    />
                  </div>
                  <span className={cn('text-[11px] font-bold w-6 text-right tabular-nums', scoreColor(s.value))}>{s.value}</span>
                  {s.value < 60 && <div className="w-1.5 h-1.5 rounded-full bg-danger flex-shrink-0" />}
                  <span className="text-[9px] text-muted-foreground/60 tabular-nums w-8 text-right">
                    {Math.round(s.weight * 100)}%
                  </span>
                </div>
              );
            })}
          </div>
        </Card>

        {/* Data Traceability Strip */}
        <div className="flex flex-wrap gap-4 p-2.5 px-3.5 bg-muted/50 rounded-lg border border-border text-[10.5px] text-muted-foreground">
          <span><strong className="text-foreground/70">Revenue Predictability</strong> &rarr; Monthly invoices (12m)</span>
          <span><strong className="text-foreground/70">Associate Dependency</strong> &rarr; Provider production (Dentally)</span>
          <span><strong className="text-foreground/70">Chair Stability</strong> &rarr; Chair metrics</span>
          <span><strong className="text-foreground/70">Cash Conversion</strong> &rarr; Invoice data</span>
          <span><strong className="text-foreground/70">NHS Delivery</strong> &rarr; UDA settings</span>
        </div>
      </div>
      </TooltipProvider>
  );
}

export default function QualityScore() {
  return (
    <MainLayout userRole="admin">
      <Helmet><title>Quality Score | DentPulse</title></Helmet>
      <QualityScoreContent />
    </MainLayout>
  );
}
