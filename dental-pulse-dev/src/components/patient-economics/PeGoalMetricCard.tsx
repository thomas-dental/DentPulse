/**
 * Goal Settings metric card — mockup v5.1 with inline target input, actual, progress bar.
 */

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  computeGoalBarWidthPct,
  computeGoalOnTrack,
  formatGoalProgressFooter,
  computeGoalProgressRatio,
  type PeGoalProgressFormat,
} from '@/lib/peGoalProgress';
import type { PeGoalMetricRollup, PeGoalPracticeRow } from '@/types/peGoalSettings';

function formatGbp(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `£${(abs / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`;
  if (abs >= 1_000) return `£${Math.round(abs / 1_000)}k`;
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPctRate(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

type PeGoalMetricCardProps = {
  title: string;
  subtitle: string;
  metric: PeGoalMetricRollup;
  format: 'pct' | 'gbp' | 'pctCeiling';
  targetFieldLabel: string;
  actualColumnLabel?: string;
  targetInputValue: string;
  onTargetInputChange: (value: string) => void;
  targetSuffix?: string;
  footerHint?: string;
};

export function PeGoalMetricCard({
  title,
  subtitle,
  metric,
  format,
  targetFieldLabel,
  actualColumnLabel = 'Actual',
  targetInputValue,
  onTargetInputChange,
  targetSuffix,
  footerHint,
}: PeGoalMetricCardProps) {
  const { actual, target, onTrack: savedOnTrack } = metric;
  const progressFormat = format as PeGoalProgressFormat;

  const barWidth = computeGoalBarWidthPct(actual, targetInputValue, progressFormat, target);
  const onTrack =
    computeGoalOnTrack(actual, targetInputValue, progressFormat, target) ?? savedOnTrack;

  const actualLabel =
    actual == null
      ? '—'
      : format === 'gbp'
        ? formatGbp(actual)
        : formatPctRate(actual);

  const actualColor =
    onTrack == null
      ? 'text-foreground'
      : onTrack
        ? 'text-success'
        : format === 'gbp'
          ? 'text-primary'
          : 'text-warning';

  const barColor =
    onTrack == null
      ? 'bg-muted-foreground/40'
      : onTrack
        ? 'bg-success'
        : format === 'gbp'
          ? 'bg-primary'
          : 'bg-warning';

  let statusBadge: { label: string; className: string } | null = null;

  if (format === 'pctCeiling') {
    statusBadge =
      onTrack == null
        ? null
        : onTrack
          ? {
              label: 'Within limit',
              className: 'border-success/30 bg-success-muted text-success-strong',
            }
          : {
              label: 'Above ceiling',
              className: 'border-warning/30 bg-warning-muted text-warning',
            };
  } else if (format === 'gbp') {
    statusBadge =
      onTrack == null
        ? null
        : onTrack
          ? {
              label: 'On track',
              className: 'border-success/30 bg-success-muted text-success-strong',
            }
          : barWidth > 0
            ? {
                label: 'In progress',
                className: 'border-primary/25 bg-primary/12 text-primary',
              }
            : {
                label: 'Below target',
                className: 'border-warning/30 bg-warning-muted text-warning',
              };
  } else {
    statusBadge =
      onTrack == null
        ? null
        : onTrack
          ? {
              label: 'On track',
              className: 'border-success/30 bg-success-muted text-success-strong',
            }
          : {
              label: 'Below target',
              className: 'border-warning/30 bg-warning-muted text-warning',
            };
  }

  const defaultFooter = formatGoalProgressFooter(
    actual,
    targetInputValue,
    progressFormat,
    target,
  );

  return (
    <div className="rounded-[14px] border border-border bg-card px-5 py-[18px] shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-bold tracking-tight text-foreground">{title}</h3>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">{subtitle}</p>
        </div>
        {statusBadge && (
          <span
            className={cn(
              'shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold',
              statusBadge.className,
            )}
          >
            {statusBadge.label}
          </span>
        )}
      </div>

      <div className="mt-4 flex items-end gap-3">
        <div className="flex-1 space-y-1">
          <label className="text-[12px] font-medium text-muted-foreground">
            {targetFieldLabel}
          </label>
          <div className="flex items-center gap-2">
            {format === 'gbp' && (
              <span className="text-[13px] text-muted-foreground">£</span>
            )}
            <Input
              value={targetInputValue}
              onChange={(e) => onTargetInputChange(e.target.value)}
              className={cn(
                'h-9 text-[13px] font-semibold',
                format === 'gbp' ? 'max-w-[140px]' : 'w-[80px]',
              )}
              placeholder={
                format === 'pct' || format === 'pctCeiling' ? '70' : '420'
              }
            />
            {targetSuffix && (
              <span className="text-[13px] text-muted-foreground">{targetSuffix}</span>
            )}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[12px] text-muted-foreground">{actualColumnLabel}</div>
          <div className={cn('text-[22px] font-extrabold tracking-tight', actualColor)}>
            {actualLabel}
          </div>
        </div>
      </div>

      <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-muted/80">
        <div
          className={cn('h-full rounded-full transition-all', barColor)}
          style={{ width: `${barWidth}%` }}
        />
      </div>

      {(footerHint || defaultFooter) && (
        <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
          {footerHint ?? defaultFooter}
        </p>
      )}
    </div>
  );
}

/** Overall practice goal progress (average of actual÷goal ratios). */
export function computePracticeGoalProgressPct(
  row: PeGoalPracticeRow,
  defaultInputs: {
    commitmentRatePct: string;
    contributionPerActiveGbp: string;
    opportunityProgressionGbp: string;
    attritionCeilingPct: string;
  },
  overrideInputs: {
    commitmentRatePct: string;
    contributionPerActiveGbp: string;
    opportunityProgressionGbp: string;
    attritionCeilingPct: string;
  },
): number | null {
  const pick = (override: string, defaultVal: string) =>
    override.trim() ? override : defaultVal;

  const ratios = [
    computeGoalProgressRatio(
      row.actuals.commitmentRate30d,
      pick(overrideInputs.commitmentRatePct, defaultInputs.commitmentRatePct),
      'pct',
      row.metrics.commitmentRate.target,
    ),
    computeGoalProgressRatio(
      row.actuals.contributionPerActiveGbp,
      pick(overrideInputs.contributionPerActiveGbp, defaultInputs.contributionPerActiveGbp),
      'gbp',
      row.metrics.contributionPerActive.target,
    ),
    computeGoalProgressRatio(
      row.actuals.opportunityProgressionGbp,
      pick(overrideInputs.opportunityProgressionGbp, defaultInputs.opportunityProgressionGbp),
      'gbp',
      row.metrics.opportunityProgression.target,
    ),
    computeGoalProgressRatio(
      row.actuals.attritionPct,
      pick(overrideInputs.attritionCeilingPct, defaultInputs.attritionCeilingPct),
      'pctCeiling',
      row.metrics.attritionCeiling.target,
    ),
  ]
    .filter((r): r is number => r != null)
    .map((r) => Math.min(r, 1.5));

  if (ratios.length === 0) return null;
  const avg = ratios.reduce((sum, r) => sum + r, 0) / ratios.length;
  return Math.round(avg * 100);
}

export function goalProgressBarClass(pct: number): string {
  if (pct >= 95) return 'bg-success';
  if (pct >= 75) return 'bg-warning';
  return 'bg-danger';
}
