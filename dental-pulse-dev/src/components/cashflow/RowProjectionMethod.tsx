import { useState } from 'react';
import type { ForecastRow } from '@/hooks/useCashflowForecast';
import type { LineMethodConfig, ForecastMethod } from '@/hooks/useCashflowForecastSettings';

// Per-line projection-method picker shown in the row editor's menu. Lets a single
// line override the global Income/Cost method default (or fall back to it).
//   • Inherit  → clears the override (uses the family default from Settings)
//   • Smart / Flat average / Repeat → explicit method, applied immediately
//   • Manual   → a growth % per month, or a fixed £ per week
// Applying calls onApply(cfg|null) which persists via setMethod and closes.

interface Props {
  row: ForecastRow;
  /** The explicit per-line override for this row, if any (else inherit the default). */
  explicit: LineMethodConfig | undefined;
  /** The effective method in force (override if set, else the resolved family default). */
  effective: LineMethodConfig;
  onApply: (cfg: LineMethodConfig | null) => void;
}

type Choice = 'inherit' | 'auto' | 'average' | 'repeat' | 'manual-growth' | 'manual-fixed';

const CHOICES: { id: Choice; label: string; hint: string }[] = [
  { id: 'inherit', label: 'Use forecast settings', hint: 'Follow the default for this line type' },
  { id: 'auto', label: 'Smart', hint: 'Recent average with the trend (and appointments)' },
  { id: 'average', label: 'Flat average', hint: 'Every week = the last-13-week average' },
  { id: 'repeat', label: 'Repeat last 13 weeks', hint: 'Replay the recent weeks exactly' },
  { id: 'manual-growth', label: 'Manual growth', hint: 'Grow/shrink by a set % each month' },
  { id: 'manual-fixed', label: 'Fixed amount', hint: 'The same £ every week' },
];

const initialChoice = (explicit: LineMethodConfig | undefined): Choice => {
  if (!explicit) return 'inherit';
  if (explicit.method === 'manual') return explicit.fixed != null ? 'manual-fixed' : 'manual-growth';
  return explicit.method as Choice;
};

export function RowProjectionMethod({ row, explicit, effective, onApply }: Props) {
  const [choice, setChoice] = useState<Choice>(() => initialChoice(explicit));
  const [growth, setGrowth] = useState<number>(explicit?.growthPct ?? 0);
  const [fixed, setFixed] = useState<string>(explicit?.fixed != null ? String(Math.round(explicit.fixed)) : '');

  const defaultLabel = ((): string => {
    const m: ForecastMethod = effective.method;
    if (m === 'manual') return effective.fixed != null ? 'Fixed amount' : 'Manual growth';
    return m === 'auto' ? 'Smart' : m === 'average' ? 'Flat average' : 'Repeat last 13 weeks';
  })();

  const apply = (c: Choice) => {
    if (c === 'inherit') return onApply(null);
    if (c === 'manual-growth') return onApply({ method: 'manual', growthPct: growth });
    if (c === 'manual-fixed') {
      const amt = Number(String(fixed).replace(/[£,\s]/g, ''));
      return onApply({ method: 'manual', fixed: Number.isFinite(amt) ? Math.max(0, amt) : 0 });
    }
    return onApply({ method: c as ForecastMethod });
  };

  const numCls =
    'w-28 rounded-md border border-border bg-background px-2 py-1 text-right text-sm tabular-nums focus:border-primary focus:outline-none';

  return (
    <div className="mb-4 rounded-lg border border-border p-3">
      <div className="text-sm font-medium text-foreground">Projection method</div>
      <p className="mt-0.5 text-xs text-muted-foreground">
        How <span className="font-medium text-foreground">{row.label}</span> is projected. Inheriting uses{' '}
        <span className="font-medium text-foreground">{defaultLabel}</span> from your forecast settings.
      </p>
      <div className="mt-2 space-y-1.5">
        {CHOICES.map((opt) => {
          const active = choice === opt.id;
          const isInput = opt.id === 'manual-growth' || opt.id === 'manual-fixed';
          return (
            <div key={opt.id}>
              <button
                type="button"
                onClick={() => { setChoice(opt.id); if (!isInput) apply(opt.id); }}
                className={`flex w-full items-start gap-2.5 rounded-md border px-2.5 py-1.5 text-left transition-colors ${
                  active ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border hover:border-primary/50 hover:bg-muted/40'
                }`}
              >
                <span className={`mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border ${active ? 'border-primary' : 'border-muted-foreground/40'}`}>
                  {active && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
                </span>
                <span>
                  <span className={`block text-[13px] font-medium ${active ? 'text-primary' : 'text-foreground'}`}>{opt.label}</span>
                  <span className="block text-[11px] leading-tight text-muted-foreground">{opt.hint}</span>
                </span>
              </button>
              {active && isInput && (
                <div className="mt-1.5 flex items-center gap-2 pl-6">
                  {opt.id === 'manual-growth' ? (
                    <>
                      <input type="number" step={0.5} value={growth} onChange={(e) => setGrowth(Number(e.target.value))} className={numCls} />
                      <span className="text-sm text-muted-foreground">% / month</span>
                    </>
                  ) : (
                    <>
                      <span className="text-sm text-muted-foreground">£</span>
                      <input inputMode="numeric" value={fixed} placeholder="e.g. 2,000" onChange={(e) => setFixed(e.target.value)} className={numCls} />
                      <span className="text-sm text-muted-foreground">/ week</span>
                    </>
                  )}
                  <button type="button" onClick={() => apply(opt.id)} className="ml-auto rounded-md bg-primary px-3 py-1 text-sm font-medium text-primary-foreground hover:bg-primary/90">
                    Apply
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
