/**
 * Growth Lever Simulator™ — mockup v5.1 actions-wrap with absolute lever inputs.
 */

import { useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useGrowthLeversSimulatorBaseline } from '@/hooks/useGrowthLeversSimulatorBaseline';
import {
  computeCompoundedProjectionFromTargets,
  computeSingleLeverUpliftFromTargets,
  type GrowthLeverAbsoluteTargets,
} from '@/lib/peGrowthLeversSimulator';
import { formatGbp } from '@/components/patient-economics/GrowthLeversCharts';
import { cn } from '@/lib/utils';

function formatGbpCompact(value: number): string {
  const sign = value < 0 ? '−' : '+';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    return `${sign}£${(abs / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`;
  }
  if (abs >= 1_000) return `${sign}£${Math.round(abs / 1_000)}k`;
  return `${sign}${formatGbp(value)}`;
}

function roundLeverInput(value: number, decimals = 1): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

/** Tenure for simulator; fall back to projected lifetime when elapsed tenure is too thin. */
function simulatorLifetimeYears(baseline: {
  tenureYears: number | null;
  projectedLifetimeYears: number | null;
}): number | null {
  const tenure = baseline.tenureYears;
  const projected = baseline.projectedLifetimeYears;
  if (tenure != null && tenure >= 0.5) return tenure;
  if (projected != null && projected > 0) return projected;
  if (tenure != null && tenure > 0) return tenure;
  return null;
}

function formatLifetimeYears(value: number): string {
  if (value >= 1) return value.toFixed(1);
  return value.toFixed(2);
}

function defaultTargetsFromBaseline(baseline: {
  visitFrequency: number | null;
  valuePerVisit: number | null;
  tenureYears: number | null;
  projectedLifetimeYears: number | null;
}): GrowthLeverAbsoluteTargets | null {
  const vf = baseline.visitFrequency;
  const vv = baseline.valuePerVisit;
  const life = simulatorLifetimeYears(baseline);
  if (vf == null || vv == null || life == null) return null;

  const bumpedLife = life < 1 ? roundLeverInput(life + 0.5, 2) : roundLeverInput(life * 1.1, 1);

  return {
    visitFrequency: roundLeverInput(vf * 1.14, 1),
    valuePerVisit: roundLeverInput(vv * 1.087, 0),
    lifetimeYears: bumpedLife,
  };
}

function SimulatorActCard({
  label,
  baselineDisplay,
  inputValue,
  onInputChange,
  suffix,
  hint,
  uplift,
  highlight,
}: {
  label: string;
  baselineDisplay: string;
  inputValue: string;
  onInputChange: (v: string) => void;
  suffix?: string;
  hint: string;
  uplift: number | null;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-[11px] border bg-card px-3.5 py-3.5 shadow-sm',
        highlight ? 'border-primary/40 bg-primary/[0.04]' : 'border-border',
      )}
    >
      <div
        className={cn(
          'text-[10.5px] font-bold uppercase tracking-[0.05em]',
          highlight ? 'text-primary' : 'text-primary',
        )}
      >
        {label}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[13.5px] font-bold text-foreground">
        <span>{baselineDisplay}</span>
        <span className="text-muted-foreground">→</span>
        <Input
          type="number"
          value={inputValue}
          onChange={(e) => onInputChange(e.target.value)}
          className="h-[30px] w-[72px] px-2 text-center text-[13px] font-bold"
        />
        {suffix && <span className="text-[13px] font-semibold text-muted-foreground">{suffix}</span>}
      </div>
      <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">{hint}</p>
      {uplift != null && Math.abs(uplift) >= 1 && (
        <div className="mt-2.5 text-[19px] font-extrabold tracking-tight text-primary">
          {formatGbpCompact(uplift)}{' '}
          <span className="text-[12px] font-semibold text-muted-foreground">contribution</span>
        </div>
      )}
    </div>
  );
}

export function GrowthLeversSimulator() {
  const { baseline, hasBaseline, isLoading, isError, error, refetch, isFetching } =
    useGrowthLeversSimulatorBaseline();

  const [targets, setTargets] = useState<GrowthLeverAbsoluteTargets | null>(null);

  useEffect(() => {
    if (!baseline) {
      setTargets(null);
      return;
    }
    setTargets(defaultTargetsFromBaseline(baseline));
  }, [
    baseline?.visitFrequency,
    baseline?.valuePerVisit,
    baseline?.tenureYears,
    baseline?.projectedLifetimeYears,
  ]);

  const contributionBase = baseline?.trailingContribution ?? null;

  const lifetimeYears = baseline ? simulatorLifetimeYears(baseline) : null;

  const baselineLevers: GrowthLeverAbsoluteTargets | null =
    baseline?.visitFrequency != null &&
    baseline?.valuePerVisit != null &&
    lifetimeYears != null
      ? {
          visitFrequency: baseline.visitFrequency!,
          valuePerVisit: baseline.valuePerVisit!,
          lifetimeYears,
        }
      : null;

  const compounded =
    contributionBase != null && baselineLevers && targets
      ? computeCompoundedProjectionFromTargets(contributionBase, baselineLevers, targets)
      : null;

  const visitUplift =
    contributionBase != null && baselineLevers && targets
      ? computeSingleLeverUpliftFromTargets(
          contributionBase,
          baselineLevers,
          targets,
          'visitFrequency',
        )
      : null;
  const valueUplift =
    contributionBase != null && baselineLevers && targets
      ? computeSingleLeverUpliftFromTargets(
          contributionBase,
          baselineLevers,
          targets,
          'valuePerVisit',
        )
      : null;
  const lifetimeUplift =
    contributionBase != null && baselineLevers && targets
      ? computeSingleLeverUpliftFromTargets(
          contributionBase,
          baselineLevers,
          targets,
          'lifetimeYears',
        )
      : null;

  return (
    <div
      className="rounded-[14px] border border-primary/25 bg-gradient-to-br from-primary/[0.1] to-primary/[0.03] px-5 py-[18px] shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="text-[15px] font-extrabold tracking-tight text-foreground">
          Growth Lever Simulator<span className="text-primary">™</span>
          {' · '}
          <span className="text-primary">what a small move on each is worth</span>
        </h2>
        {baseline && (
          <span className="text-[12px] text-muted-foreground">
            Applied to {baseline.activePatientCount.toLocaleString()} active patients · contribution
            basis
          </span>
        )}
      </div>
      <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
        Move all three a little and the effect stacks. Edit any lever to see combined contribution
        uplift.
      </p>

      {isLoading ? (
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[130px] rounded-[11px]" />
          ))}
        </div>
      ) : isError ? (
        <div className="mt-4 flex flex-wrap items-start gap-3 text-sm text-danger-strong">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="flex-1">
            <div className="font-semibold">Couldn&apos;t load simulator baseline</div>
            <div className="mt-0.5 text-danger-strong/80">
              {error instanceof Error ? error.message : 'Baseline query failed.'}
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            Retry
          </Button>
        </div>
      ) : !hasBaseline || !baselineLevers || !targets ? (
        <p className="mt-4 text-sm text-muted-foreground">
          No trailing revenue or contribution baseline yet — sync invoices and appointments first.
        </p>
      ) : (
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <SimulatorActCard
            label="Visit Frequency"
            baselineDisplay={baselineLevers.visitFrequency.toFixed(1)}
            inputValue={String(targets.visitFrequency)}
            onInputChange={(raw) => {
              const n = Number(raw);
              if (!Number.isFinite(n)) return;
              setTargets((t) => (t ? { ...t, visitFrequency: n } : t));
            }}
            suffix="/yr"
            hint="Recall attendance + hygiene cadence."
            uplift={visitUplift}
          />
          <SimulatorActCard
            label="Value per Visit"
            baselineDisplay={formatGbp(baselineLevers.valuePerVisit)}
            inputValue={String(Math.round(targets.valuePerVisit))}
            onInputChange={(raw) => {
              const n = Number(raw);
              if (!Number.isFinite(n)) return;
              setTargets((t) => (t ? { ...t, valuePerVisit: n } : t));
            }}
            hint="Treatment mix + private uptake."
            uplift={valueUplift}
          />
          <SimulatorActCard
            label="Patient Lifetime"
            baselineDisplay={formatLifetimeYears(baselineLevers.lifetimeYears)}
            inputValue={
              baselineLevers.lifetimeYears < 1
                ? String(targets.lifetimeYears)
                : String(roundLeverInput(targets.lifetimeYears, 1))
            }
            onInputChange={(raw) => {
              const n = Number(raw);
              if (!Number.isFinite(n)) return;
              setTargets((t) => (t ? { ...t, lifetimeYears: n } : t));
            }}
            suffix="yrs"
            hint="Fewer lapses, longer patient life."
            uplift={lifetimeUplift}
          />
          <div className="rounded-[11px] border border-primary/40 bg-primary/[0.04] px-3.5 py-3.5 shadow-sm">
            <div className="text-[10.5px] font-bold uppercase tracking-[0.05em] text-primary">
              Combined (compounding)
            </div>
            <div className="mt-1.5 text-[13.5px] font-bold text-foreground">All three together</div>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
              Stacked effect, not the sum of the parts.
            </p>
            {compounded != null && (
              <div className="mt-2.5 text-[22px] font-extrabold tracking-tight text-primary">
                {formatGbpCompact(compounded.uplift)}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
