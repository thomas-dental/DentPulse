/**
 * Value & Leakage — mockup v5.1 chart components.
 */

import type { JourneyStage } from '@/hooks/useTreatmentEconomicJourney';
import type { CommitmentClinicianRow, CommitmentWindowRow } from '@/hooks/useValueLeakageSummary';

export function formatGbpCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    return `£${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 2).replace(/\.0$/, '')}m`;
  }
  if (abs >= 1_000) {
    return `£${(abs / 1_000).toFixed(abs >= 10_000 ? 0 : 1).replace(/\.0$/, '')}k`;
  }
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    maximumFractionDigits: value >= 1000 ? 0 : 2,
  }).format(value);
}

export function formatGbpWhole(value: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    maximumFractionDigits: 0,
  }).format(value);
}

const COMMITMENT_BENCHMARK_PCT = 70;

export function JourneyWaterfallDetailedChart({ stages }: { stages: JourneyStage[] }) {
  const W = 560;
  const H = 230;
  const pl = 40;
  const pr = 12;
  const pt = 18;
  const pb = 44;
  const maxVal = Math.max(...stages.map((s) => s.valueGbp), 1);
  const max = maxVal * 1.08;
  const bw = (W - pl - pr) / stages.length;
  const y = (v: number) => pt + (1 - v / max) * (H - pt - pb);
  const primary = 'hsl(var(--primary))';
  const muted = 'hsl(var(--muted-foreground))';
  const danger = 'hsl(var(--danger))';
  const grid = 'hsl(var(--border))';

  const gridLines = [0, 1, 2, 3, 4].map((g) => {
    const gy = pt + (g * (H - pt - pb)) / 4;
    const labelVal = max - (max * g) / 4;
    return (
      <g key={g}>
        <line x1={pl} y1={gy} x2={W - pr} y2={gy} stroke={grid} strokeWidth={1} />
        <text x={pl - 6} y={gy + 3} textAnchor="end" fontSize={9} fill={muted}>
          {formatGbpCompact(labelVal)}
        </text>
      </g>
    );
  });

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      className="max-w-full"
      role="img"
      aria-label="Treatment Economic Journey detailed"
    >
      {gridLines}
      {stages.map((s, i) => {
        const bx = pl + i * bw + 6;
        const w = bw - 14;
        const top = y(s.valueGbp);
        const barH = Math.max(H - pb - top, s.valueGbp > 0 ? 2 : 0);
        const prev = i > 0 ? stages[i - 1] : null;
        return (
          <g key={s.key}>
            {prev && prev.valueGbp > s.valueGbp && (
              <rect
                x={bx - 6}
                y={y(prev.valueGbp)}
                width={6}
                height={Math.max(y(s.valueGbp) - y(prev.valueGbp), 0)}
                fill={danger}
                opacity={0.55}
              />
            )}
            <rect
              x={bx}
              y={top}
              width={w}
              height={barH}
              rx={4}
              fill={primary}
              opacity={i === 0 || i === stages.length - 1 ? 1 : 0.88}
            />
            <text
              x={bx + w / 2}
              y={Math.max(top - 5, 11)}
              textAnchor="middle"
              fontSize={10.5}
              fontWeight={700}
              fill={primary}
            >
              {formatGbpCompact(s.valueGbp)}
            </text>
            <text
              x={bx + w / 2}
              y={H - pb + 16}
              textAnchor="middle"
              fontSize={9.5}
              fill={muted}
            >
              {s.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export type OpportunityCategoryRow = {
  category: string;
  gross: number;
  weighted: number;
};

export function OpportunityGrossVsWeightedChart({ rows }: { rows: OpportunityCategoryRow[] }) {
  const W = 520;
  const pl = 70;
  const pr = 54;
  const rowH = 40;
  const primary = 'hsl(var(--primary))';
  const muted = 'hsl(var(--muted-foreground))';
  const max = Math.max(...rows.map((r) => r.gross), 1);
  const bw = W - pl - pr;
  const chartH = rows.length * rowH + 24;

  return (
    <svg
      viewBox={`0 0 ${W} ${chartH}`}
      width="100%"
      className="max-w-full"
      role="img"
      aria-label="Opportunity gross vs weighted by category"
    >
      {rows.map((row, i) => {
        const yy = 8 + i * rowH;
        const grossW = (bw * row.gross) / max;
        const wtdW = (bw * row.weighted) / max;
        return (
          <g key={row.category}>
            <text x={pl - 8} y={yy + 20} textAnchor="end" fontSize={11} fill={muted}>
              {row.category}
            </text>
            <rect x={pl} y={yy + 4} width={grossW} height={13} rx={4} fill={primary} opacity={0.25} />
            <rect x={pl} y={yy + 20} width={wtdW} height={13} rx={4} fill={primary} />
            <text
              x={pl + (row.gross > 0 ? grossW + 5 : 4)}
              y={yy + 14}
              fontSize={9.5}
              fill={muted}
            >
              £{Math.round(row.gross)}
            </text>
            <text
              x={pl + (row.weighted > 0 ? wtdW + 5 : 4)}
              y={yy + 30}
              fontSize={9.5}
              fontWeight={700}
              fill={primary}
              opacity={row.weighted > 0 ? 1 : 0.55}
            >
              £{Math.round(row.weighted)}
            </text>
          </g>
        );
      })}
      <text x={pl} y={chartH - 2} fontSize={9.5} fill={muted}>
        ▨ gross ▮ probability-weighted
      </text>
    </svg>
  );
}

function commitmentBarColor(pct: number): string {
  if (pct >= COMMITMENT_BENCHMARK_PCT) return 'hsl(var(--success))';
  if (pct >= 55) return 'hsl(var(--warning))';
  return 'hsl(var(--danger))';
}

export function ClinicianCommitmentChart({ rows }: { rows: CommitmentClinicianRow[] }) {
  const chartRows = rows
    .filter((r) => r.practitionerExtId != null)
    .sort((a, b) => b.commitmentRate - a.commitmentRate);

  if (chartRows.length === 0) {
    return (
      <p className="px-5 py-10 text-center text-[13px] text-muted-foreground">
        No clinician-attributed items for chart.
      </p>
    );
  }

  const maxLabelLen = Math.max(...chartRows.map((r) => r.practitionerName.length), 8);
  const pl = Math.min(200, Math.max(100, maxLabelLen * 6.4 + 14));
  const pr = 48;
  const rowH = 26;
  const barH = 7;
  const barRx = 3.5;
  const bw = 280;
  const W = pl + bw + pr;
  const H = chartRows.length * rowH + 16;
  const grid = 'hsl(var(--border))';
  const muted = 'hsl(var(--muted-foreground))';
  const primary = 'hsl(var(--primary))';

  const benchmarkX = pl + (bw * COMMITMENT_BENCHMARK_PCT) / 100;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      className="max-w-full"
      role="img"
      aria-label="Treatment Commitment Rate by clinician"
      preserveAspectRatio="xMinYMin meet"
    >
      <line
        x1={benchmarkX}
        y1={4}
        x2={benchmarkX}
        y2={H - 8}
        stroke={primary}
        strokeWidth={1.5}
        strokeDasharray="4 3"
      />
      {chartRows.map((row, i) => {
        const yy = 8 + i * rowH;
        const pct = Math.round(row.commitmentRate * 100);
        const w = (bw * pct) / 100;
        const col = commitmentBarColor(pct);
        const label =
          row.practitionerName.length > 32
            ? `${row.practitionerName.slice(0, 31)}…`
            : row.practitionerName;
        return (
          <g key={row.practitionerExtId ?? row.practitionerName}>
            <text x={8} y={yy + 12} textAnchor="start" fontSize={11} fill={muted}>
              {label}
            </text>
            <rect
              x={pl}
              y={yy + 6}
              width={bw}
              height={barH}
              rx={barRx}
              fill={grid}
              opacity={0.5}
            />
            <rect x={pl} y={yy + 6} width={w} height={barH} rx={barRx} fill={col} />
            <text x={pl + w + 6} y={yy + 12} fontSize={10.5} fontWeight={700} fill={col}>
              {pct}%
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function WindowCommitmentChart({ rows }: { rows: CommitmentWindowRow[] }) {
  const sorted = [...rows].sort((a, b) => a.windowDays - b.windowDays);
  if (sorted.length === 0) {
    return (
      <p className="px-5 py-10 text-center text-[13px] text-muted-foreground">
        No window data available.
      </p>
    );
  }

  const W = 520;
  const H = 180;
  const pl = 30;
  const pr = 10;
  const pt = 14;
  const pb = 26;
  const max = 100;
  const bw = (W - pl - pr) / sorted.length;
  const y = (v: number) => pt + (1 - v / max) * (H - pt - pb);
  const blue = 'hsl(var(--chart-5))';
  const muted = 'hsl(var(--muted-foreground))';

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      className="max-w-full"
      role="img"
      aria-label="Commitment by time window"
    >
      {sorted.map((row, i) => {
        const pct = Math.round(row.commitmentRate * 100);
        const bx = pl + i * bw;
        const barTop = y(pct);
        const opacity = 0.55 + i * 0.12;
        return (
          <g key={row.windowDays}>
            <rect
              x={bx + 16}
              y={barTop}
              width={bw - 32}
              height={H - pb - barTop}
              rx={4}
              fill={blue}
              opacity={opacity}
            />
            <text
              x={bx + bw / 2}
              y={barTop - 5}
              textAnchor="middle"
              fontSize={11}
              fontWeight={800}
              fill={blue}
            >
              {pct}%
            </text>
            <text
              x={bx + bw / 2}
              y={H - 8}
              textAnchor="middle"
              fontSize={10.5}
              fill={muted}
            >
              {row.windowDays}d
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export { COMMITMENT_BENCHMARK_PCT };
