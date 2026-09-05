/**
 * Retention & Reactivation — contribution at risk charts.
 */

import { ChevronDown, ChevronUp } from 'lucide-react';

import { DentallyPatientLink } from '@/components/patient-economics/DentallyLinks';

import type {
  ReactivationFlagRow,
  ReactivationValueByPracticeRow,
  ReactivationWorklistRow,
  RecoveryFunnel,
  RetentionContributionRollup,
} from '@/services/integrations/patientEconomicsService';
import {
  PE_RETENTION_SEGMENT_ORDER,
  type PeRetentionStatus,
} from '@/lib/peRetentionConstants';
import { cn } from '@/lib/utils';
import {
  PE_CHART_CAPTION_CLASS,
  PE_CHART_CAPTION_PX,
  PE_CHART_LABEL_PX,
  PE_CHART_VALUE_PX,
  PE_TABLE_BODY_CELL_CLASS,
  PE_TABLE_HEAD_CELL_CLASS,
  PE_TABLE_ROW_CLASS,
} from '@/lib/peVisualTokens';

export function formatGbp(value: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    maximumFractionDigits: value >= 1000 ? 0 : 2,
  }).format(value);
}

export function formatGbpCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `£${(abs / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`;
  if (abs >= 1_000) return `£${(abs / 1_000).toFixed(0)}k`;
  return formatGbp(value);
}

const SEGMENT_COLORS: Record<PeRetentionStatus, string> = {
  active: 'hsl(var(--success))',
  drifting: 'hsl(var(--warning))',
  lapsed: 'hsl(var(--destructive) / 0.85)',
  effectively_lost: 'hsl(var(--muted-foreground))',
};

const SEGMENT_CHART_LABELS: Record<PeRetentionStatus, string> = {
  active: 'Active (healthy)',
  drifting: 'Drifting',
  lapsed: 'Lapsed',
  effectively_lost: 'Lost',
};

const FUNNEL_STAGE_COLORS: Record<string, string> = {
  flagged: 'hsl(var(--destructive))',
  assigned: 'hsl(var(--warning))',
  contacted: 'hsl(221 83% 53%)',
  booked: 'hsl(var(--primary))',
  recovered: 'hsl(var(--success))',
};

function formatVisitDate(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Horizontal bars — contribution £ at risk by retention segment (mockup v5.1). */
export function ContributionAtRiskBySegmentChart({
  rollup,
}: {
  rollup: RetentionContributionRollup;
  scopeLabel?: string;
}) {
  const byStatus = new Map(rollup.segments.map((s) => [s.status, s]));
  const segments = PE_RETENTION_SEGMENT_ORDER.map((status) => {
    const row = byStatus.get(status);
    return {
      status,
      label: SEGMENT_CHART_LABELS[status],
      contributionGbp: row?.contributionGbp ?? 0,
      patientCount: row?.patientCount ?? 0,
    };
  });

  if (rollup.totalPatientCount === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No patients with contribution data yet.
      </p>
    );
  }

  const barSegments = segments.filter(
    (s) =>
      s.contributionGbp > 0 &&
      (s.status === 'drifting' || s.status === 'lapsed' || s.status === 'effectively_lost'),
  );
  const maxVal = Math.max(...barSegments.map((s) => s.contributionGbp), 1);
  const W = 560;
  const rowH = 44;
  const pl = 110;
  /** Space for longest value ("£x,xxx.xx not recoverable") so text is never clipped. */
  const pr = 168;
  const H = segments.length * rowH + 16;
  const bw = W - pl - pr;
  const muted = 'hsl(var(--muted-foreground))';
  const labelColor = 'hsl(246 79% 25%)';

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      className="max-w-full"
      role="img"
      aria-label="Contribution at risk by segment"
    >
      {segments.map((row, i) => {
        const yy = 8 + i * rowH;
        const color = SEGMENT_COLORS[row.status as PeRetentionStatus] ?? muted;
        const showBar =
          row.contributionGbp > 0 &&
          (row.status === 'drifting' ||
            row.status === 'lapsed' ||
            row.status === 'effectively_lost');
        const barWidth = showBar
          ? bw * (Math.min(row.contributionGbp, maxVal) / maxVal)
          : 0;
        const valueLabel =
          row.status === 'effectively_lost'
            ? `${formatGbpCompact(row.contributionGbp)} not recoverable`
            : `${formatGbpCompact(row.contributionGbp)} at risk`;

        return (
          <g key={row.status}>
            <text
              x={pl - 8}
              y={yy + 16}
              textAnchor="end"
              fontSize={PE_CHART_LABEL_PX}
              fontWeight={600}
              fill={labelColor}
            >
              {row.label}
            </text>
            <text x={pl - 8} y={yy + 29} textAnchor="end" fontSize={PE_CHART_CAPTION_PX} fill={muted}>
              {row.patientCount.toLocaleString('en-GB')} patients
            </text>
            {showBar ? (
              <>
                <rect
                  x={pl}
                  y={yy + 6}
                  width={barWidth}
                  height={20}
                  rx={4}
                  fill={color}
                  opacity={row.status === 'effectively_lost' ? 0.55 : 1}
                />
                <text
                  x={pl + barWidth + 6}
                  y={yy + 20}
                  fontSize={PE_CHART_VALUE_PX}
                  fontWeight={700}
                  fill={color}
                >
                  {valueLabel}
                </text>
              </>
            ) : (
              <text x={pl} y={yy + 20} fontSize={PE_CHART_VALUE_PX} fill={muted}>
                {row.status === 'active' ? 'no contribution at risk' : '—'}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** Recovery Loop™ funnel — always five stages (mockup v5.1), even when £ is zero. */
export function RecoveryLoopFunnelChart({ funnel }: { funnel: RecoveryFunnel }) {
  const stages = funnel.stages;
  if (stages.length === 0 || funnel.flaggedAtRiskGbp <= 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No flagged cohort yet — flags open when at-risk patients exceed the contribution threshold.
      </p>
    );
  }

  const W = 560;
  const rowH = 34;
  const pl = 112;
  const pr = 54;
  const max = Math.max(funnel.flaggedAtRiskGbp, 1);
  const H = stages.length * rowH + 16;
  const bw = W - pl - pr;
  const grid = 'hsl(var(--border))';
  const labelColor = 'hsl(246 79% 25%)';
  const muted = 'hsl(var(--muted-foreground))';

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      className="max-w-full"
      role="img"
      aria-label="Recovery loop funnel"
    >
      {stages.map((stage, i) => {
        const yy = 8 + i * rowH;
        const w = bw * (Math.min(stage.valueGbp, max) / max);
        const col = FUNNEL_STAGE_COLORS[stage.key] ?? 'hsl(var(--primary))';
        return (
          <g key={stage.key}>
            <text
              x={pl - 8}
              y={yy + 18}
              textAnchor="end"
              fontSize={PE_CHART_LABEL_PX}
              fontWeight={600}
              fill={labelColor}
            >
              {stage.label}
            </text>
            <rect x={pl} y={yy + 4} width={bw} height={21} rx={4} fill={grid} opacity={0.45} />
            {w > 0 && (
              <rect x={pl} y={yy + 4} width={w} height={21} rx={4} fill={col} />
            )}
            <text
              x={pl + (w > 0 ? w + 6 : 6)}
              y={yy + 20}
              fontSize={PE_CHART_VALUE_PX}
              fontWeight={700}
              fill={stage.valueGbp > 0 ? col : muted}
            >
              {formatGbpCompact(stage.valueGbp)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Horizontal bars — at-risk contribution £ per practice (group rollup). */
export function AtRiskContributionByPracticeChart({
  practices,
}: {
  practices: RetentionContributionRollup[];
}) {
  const data = practices
    .filter((p) => p.atRiskContributionGbp > 0)
    .sort((a, b) => b.atRiskContributionGbp - a.atRiskContributionGbp);

  if (data.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No at-risk contribution across practices in this group.
      </p>
    );
  }

  const W = 560;
  const rowH = 32;
  const pl = 108;
  const pr = 72;
  const H = data.length * rowH + 12;
  const bw = W - pl - pr;
  const max = Math.max(...data.map((r) => r.atRiskContributionGbp), 1);
  const warn = 'hsl(var(--warning))';
  const danger = 'hsl(var(--destructive))';
  const muted = 'hsl(var(--muted-foreground))';
  const grid = 'hsl(var(--border))';

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      className="max-w-full"
      role="img"
      aria-label="At-risk contribution by practice"
    >
      {data.map((row, i) => {
        const val = row.atRiskContributionGbp;
        const yy = 6 + i * rowH;
        const w = bw * (val / max);
        const col = val >= max * 0.55 ? danger : warn;
        const name =
          row.practiceName.length > 16
            ? `${row.practiceName.slice(0, 15)}…`
            : row.practiceName;
        return (
          <g key={row.practiceId}>
            <text
              x={pl - 8}
              y={yy + 18}
              textAnchor="end"
              fontSize={PE_CHART_LABEL_PX}
              fontWeight={600}
              fill={muted}
            >
              {name}
            </text>
            <rect x={pl} y={yy + 6} width={bw} height={16} rx={4} fill={grid} opacity={0.5} />
            <rect x={pl} y={yy + 6} width={w} height={16} rx={4} fill={col} opacity={0.9} />
            <text
              x={pl + w + 6}
              y={yy + 18}
              fontSize={PE_CHART_VALUE_PX}
              fontWeight={700}
              fill={col}
            >
              {formatGbpCompact(val)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Open-flag reactivation value £ per practice/location (includes £0 rows).
 *  Layout matches CltvByAcquisitionSourceChart: SVG bars, end-ellipsis labels.
 */
export function ReactivationValueByPracticeChart({
  practices,
}: {
  practices: ReactivationValueByPracticeRow[];
}) {
  const data = [...practices].sort(
    (a, b) => b.reactivationValueGbp - a.reactivationValueGbp,
  );

  if (data.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No open reactivation flags — at-risk patients below threshold or not yet synced.
      </p>
    );
  }

  const W = 560;
  const rowH = 30;
  const pl = 120;
  const pr = 72;
  const H = data.length * rowH + 16;
  const bw = W - pl - pr;
  const max = Math.max(...data.map((r) => r.reactivationValueGbp), 1);
  const primary = 'hsl(var(--primary))';
  const muted = 'hsl(var(--muted-foreground))';
  const grid = 'hsl(var(--border))';
  const anyOpen = data.some((r) => r.reactivationValueGbp > 0);

  return (
    <div className="space-y-1">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        className="max-w-full"
        role="img"
        aria-label="Reactivation value by practice"
      >
        {data.map((row, i) => {
          const yy = 8 + i * rowH;
          const val = row.reactivationValueGbp;
          const w = val > 0 ? bw * (val / max) : 0;
          const label =
            row.practiceName.length > 16
              ? `${row.practiceName.slice(0, 15)}…`
              : row.practiceName;
          return (
            <g key={row.practiceId}>
              <title>{`${row.practiceName}: ${formatGbpCompact(val)}`}</title>
              <text
                x={pl - 8}
                y={yy + 15}
                textAnchor="end"
                fontSize={PE_CHART_LABEL_PX}
                fill={muted}
              >
                {label}
              </text>
              <rect x={pl} y={yy + 4} width={bw} height={15} rx={4} fill={grid} opacity={0.5} />
              {w > 0 && (
                <rect
                  x={pl}
                  y={yy + 4}
                  width={w}
                  height={15}
                  rx={4}
                  fill={primary}
                  opacity={0.95}
                />
              )}
              <text
                x={pl + (w > 0 ? w + 6 : 6)}
                y={yy + 16}
                fontSize={PE_CHART_VALUE_PX}
                fontWeight={700}
                fill={val > 0 ? primary : muted}
              >
                {formatGbpCompact(val)}
              </text>
            </g>
          );
        })}
      </svg>
      {!anyOpen && (
        <p className={cn('text-center', PE_CHART_CAPTION_CLASS)}>
          No open flags yet — locations shown at £0
        </p>
      )}
    </div>
  );
}

/** Stacked bar: recovered vs still-open flagged contribution £. */
export function RecoveryLoopValueChart({
  recoveredValueGbp,
  openValueGbp,
  recoveryRatePct,
}: {
  recoveredValueGbp: number;
  openValueGbp: number;
  recoveryRatePct: number | null;
}) {
  const total = recoveredValueGbp + openValueGbp;
  if (total <= 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No flagged cohort yet — flags open when at-risk patients exceed the contribution
        threshold.
      </p>
    );
  }

  const W = 400;
  const H = 48;
  const recoveredW = (recoveredValueGbp / total) * (W - 4);
  const openW = W - recoveredW;
  const success = 'hsl(var(--success))';
  const warn = 'hsl(var(--warning))';
  const muted = 'hsl(var(--muted-foreground))';

  return (
    <div className="space-y-3">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        className="max-w-full"
        role="img"
        aria-label="Recovery loop value split"
      >
        <rect x={0} y={8} width={W} height={32} rx={6} fill="hsl(var(--border))" opacity={0.4} />
        {recoveredW > 0 && (
          <rect x={0} y={8} width={recoveredW} height={32} rx={6} fill={success} opacity={0.9} />
        )}
        {openW > 0 && (
          <rect
            x={recoveredW}
            y={8}
            width={openW}
            height={32}
            rx={6}
            fill={warn}
            opacity={0.85}
          />
        )}
        <text x={W / 2} y={28} textAnchor="middle" fontSize={PE_CHART_VALUE_PX} fontWeight={700} fill={muted}>
          {recoveryRatePct != null
            ? `${Math.round(recoveryRatePct * 100)}% value recovered`
            : '—'}
        </text>
      </svg>
      <div className={cn('flex flex-wrap gap-4', PE_CHART_CAPTION_CLASS)}>
        <span>
          <span className="font-semibold text-success">Recovered</span>{' '}
          {formatGbpCompact(recoveredValueGbp)}
        </span>
        <span>
          <span className="font-semibold text-warning">Still open</span>{' '}
          {formatGbpCompact(openValueGbp)}
        </span>
      </div>
    </div>
  );
}

function WorkflowStatusPill({ status }: { status: ReactivationWorklistRow['workflowStatus'] }) {
  const config = {
    new: 'border-primary/25 bg-primary/10 text-primary',
    contacted: 'border-warning/30 bg-warning/10 text-warning',
    booked: 'border-primary bg-primary text-primary-foreground',
    recovered: 'border-success/30 bg-success-muted text-success-strong',
  } as const;
  const label = {
    new: 'New',
    contacted: 'Contacted',
    booked: 'Booked',
    recovered: 'Recovered',
  }[status];

  return (
    <span
      className={cn(
        'inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold capitalize',
        config[status],
      )}
    >
      {label}
    </span>
  );
}

export type WorklistSortKey =
  | 'patientName'
  | 'practiceName'
  | 'lastVisitAt'
  | 'daysOverdue'
  | 'histContributionYr'
  | 'contributionAtRiskAtFlagTime'
  | 'ownerName'
  | 'workflowStatus';

function WorklistSortHeader({
  label,
  sortKey,
  activeKey,
  sortDir,
  onSort,
  alignRight = false,
}: {
  label: string;
  sortKey: WorklistSortKey;
  activeKey: WorklistSortKey;
  sortDir: 'asc' | 'desc';
  onSort: (key: WorklistSortKey) => void;
  alignRight?: boolean;
}) {
  const active = activeKey === sortKey;
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className={cn(
        'inline-flex items-center gap-0.5 text-[12px] font-semibold hover:text-foreground',
        active ? 'text-foreground' : 'text-muted-foreground',
        alignRight && 'ml-auto',
      )}
    >
      {label}
      {active &&
        (sortDir === 'asc' ? (
          <ChevronUp className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 shrink-0" />
        ))}
    </button>
  );
}

/** Financially-prioritised reactivation worklist — mockup v5.1 columns. */
export function ReactivationWorklistTable({
  rows,
  showPractice = true,
  isFiltered = false,
  sortKey,
  sortDir,
  onSort,
}: {
  rows: ReactivationWorklistRow[];
  showPractice?: boolean;
  isFiltered?: boolean;
  sortKey: WorklistSortKey;
  sortDir: 'asc' | 'desc';
  onSort: (key: WorklistSortKey) => void;
}) {
  if (rows.length === 0) {
    if (isFiltered) {
      return (
        <p className="py-10 text-center text-[13px] text-muted-foreground">
          No patients match your search or filters.
        </p>
      );
    }
    return (
      <div className="rounded-lg border border-success/25 bg-success/5 px-4 py-8 text-center">
        <p className="text-sm font-semibold text-foreground">No open reactivation targets</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Good sign — nothing flagged for outreach right now.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[960px] border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-border text-left">
            <th className="whitespace-nowrap px-3 py-2.5">
              <WorklistSortHeader
                label="Patient"
                sortKey="patientName"
                activeKey={sortKey}
                sortDir={sortDir}
                onSort={onSort}
              />
            </th>
            {showPractice && (
              <th className="whitespace-nowrap px-3 py-2.5">
                <WorklistSortHeader
                  label="Practice"
                  sortKey="practiceName"
                  activeKey={sortKey}
                  sortDir={sortDir}
                  onSort={onSort}
                />
              </th>
            )}
            <th className="whitespace-nowrap px-3 py-2.5">
              <WorklistSortHeader
                label="Last visit"
                sortKey="lastVisitAt"
                activeKey={sortKey}
                sortDir={sortDir}
                onSort={onSort}
              />
            </th>
            <th className="whitespace-nowrap px-3 py-2.5 text-right">
              <WorklistSortHeader
                label="Days overdue"
                sortKey="daysOverdue"
                activeKey={sortKey}
                sortDir={sortDir}
                onSort={onSort}
                alignRight
              />
            </th>
            <th className="whitespace-nowrap px-3 py-2.5 text-right">
              <WorklistSortHeader
                label="Hist. contribution/yr"
                sortKey="histContributionYr"
                activeKey={sortKey}
                sortDir={sortDir}
                onSort={onSort}
                alignRight
              />
            </th>
            <th className="whitespace-nowrap px-3 py-2.5 text-right">
              <WorklistSortHeader
                label="Contribution at risk"
                sortKey="contributionAtRiskAtFlagTime"
                activeKey={sortKey}
                sortDir={sortDir}
                onSort={onSort}
                alignRight
              />
            </th>
            <th className="whitespace-nowrap px-3 py-2.5">
              <WorklistSortHeader
                label="Owner"
                sortKey="ownerName"
                activeKey={sortKey}
                sortDir={sortDir}
                onSort={onSort}
              />
            </th>
            <th className="whitespace-nowrap px-3 py-2.5">
              <WorklistSortHeader
                label="Status"
                sortKey="workflowStatus"
                activeKey={sortKey}
                sortDir={sortDir}
                onSort={onSort}
              />
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const owner = row.ownerName?.trim() || 'Unassigned';
            const overdueTone =
              row.daysOverdue > 180
                ? 'text-danger-strong'
                : row.daysOverdue > 90
                  ? 'text-warning'
                  : 'text-muted-foreground';

            return (
              <tr
                key={row.flagId}
                className="border-b border-border/60 last:border-b-0 hover:bg-primary/[0.04]"
              >
                <td className="px-3 py-3">
                  <DentallyPatientLink dentallyPatientUuid={row.dentallyPatientUuid}>
                    {row.patientName}
                  </DentallyPatientLink>
                </td>
                {showPractice && (
                  <td className="px-3 py-3 text-foreground">{row.practiceName ?? '—'}</td>
                )}
                <td className="px-3 py-3 text-muted-foreground">
                  {formatVisitDate(row.lastVisitAt)}
                </td>
                <td className="px-3 py-3 text-right tabular-nums">
                  <span className={cn('font-semibold', overdueTone)}>
                    {row.daysOverdue > 0 ? `${row.daysOverdue}d` : '—'}
                  </span>
                </td>
                <td className="px-3 py-3 text-right tabular-nums">
                  {formatGbpCompact(row.histContributionYr)}
                </td>
                <td className="px-3 py-3 text-right font-bold tabular-nums text-danger-strong">
                  {formatGbpCompact(row.contributionAtRiskAtFlagTime)}
                </td>
                <td
                  className={cn(
                    'px-3 py-3',
                    owner === 'Unassigned' ? 'text-muted-foreground' : 'text-foreground',
                  )}
                >
                  {owner}
                </td>
                <td className="px-3 py-3">
                  <WorkflowStatusPill status={row.workflowStatus} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function RecoveryLoopPatientTable({ flags }: { flags: ReactivationFlagRow[] }) {
  const rows = flags.slice(0, 50);
  if (rows.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        No reactivation flags in this cohort yet.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[640px] border-collapse text-[13px]">
        <thead className="border-b border-border">
          <tr>
            <th className={cn(PE_TABLE_HEAD_CELL_CLASS, 'text-left')}>Patient</th>
            <th className={cn(PE_TABLE_HEAD_CELL_CLASS, 'text-left')}>Segment</th>
            <th className={cn(PE_TABLE_HEAD_CELL_CLASS, 'text-right')}>At risk £</th>
            <th className={cn(PE_TABLE_HEAD_CELL_CLASS, 'text-left')}>Flagged</th>
            <th className={cn(PE_TABLE_HEAD_CELL_CLASS, 'text-left')}>Status</th>
            <th className={cn(PE_TABLE_HEAD_CELL_CLASS, 'text-right')}>Recovered £</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.flagId} className={PE_TABLE_ROW_CLASS}>
              <td className={cn(PE_TABLE_BODY_CELL_CLASS, 'font-medium text-foreground')}>
                <DentallyPatientLink dentallyPatientUuid={row.dentallyPatientUuid}>
                  {row.patientName}
                </DentallyPatientLink>
              </td>
              <td className={cn(PE_TABLE_BODY_CELL_CLASS, 'capitalize')}>
                {row.segmentAtFlagTime.replace('_', ' ')}
              </td>
              <td className={cn(PE_TABLE_BODY_CELL_CLASS, 'text-right tabular-nums')}>
                {formatGbpCompact(row.contributionAtRiskAtFlagTime)}
              </td>
              <td className={cn(PE_TABLE_BODY_CELL_CLASS, 'text-muted-foreground')}>
                {new Date(row.flaggedAt).toLocaleDateString('en-GB')}
              </td>
              <td className={PE_TABLE_BODY_CELL_CLASS}>
                <span
                  className={
                    row.status === 'recovered'
                      ? 'font-semibold text-success'
                      : 'font-semibold text-warning'
                  }
                >
                  {row.status === 'recovered' ? 'Recovered' : 'Open'}
                </span>
              </td>
              <td className={cn(PE_TABLE_BODY_CELL_CLASS, 'text-right tabular-nums')}>
                {row.contributionRecoveredGbp != null
                  ? formatGbpCompact(row.contributionRecoveredGbp)
                  : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
