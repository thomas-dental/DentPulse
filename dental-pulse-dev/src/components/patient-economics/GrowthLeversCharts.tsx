/**
 * Growth Levers — trailing-period and multi-practice chart components.
 */

import type { GrowthLeversMonthlyRow } from '@/hooks/useGrowthLeversSummary';
import type { GrowthLeversPracticeRow } from '@/hooks/useGrowthLeversByPractice';
import type { CltvAcquisitionSourceRow } from '@/hooks/useCltvByAcquisitionSource';
import {
  PE_CHART_LABEL_PX,
  PE_CHART_VALUE_PX,
} from '@/lib/peVisualTokens';
import { hasGrowthLeverClinicalData } from '@/lib/peGrowthLeversDisplay';

export function formatGbp(value: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    maximumFractionDigits: value >= 1000 ? 0 : 2,
  }).format(value);
}

function formatMonthLabel(month: string): string {
  const [y, m] = month.split('-');
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
}

export function MonthlyCompletedVisitsChart({ rows }: { rows: GrowthLeversMonthlyRow[] }) {
  const data = rows.filter((r) => r.completedVisits > 0);
  if (data.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No completed visits in this trailing window.
      </p>
    );
  }

  const W = 560;
  const H = 200;
  const pl = 36;
  const pr = 12;
  const pt = 14;
  const pb = 36;
  const maxVal = Math.max(...data.map((r) => r.completedVisits), 1);
  const max = maxVal * 1.1;
  const bw = (W - pl - pr) / data.length;
  const y = (v: number) => pt + (1 - v / max) * (H - pt - pb);
  const primary = 'hsl(var(--warning))';
  const muted = 'hsl(var(--muted-foreground))';
  const grid = 'hsl(var(--border))';

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      className="max-w-full"
      role="img"
      aria-label="Monthly completed visits"
    >
      {[0, 1, 2, 3].map((g) => {
        const gy = pt + (g * (H - pt - pb)) / 3;
        const labelVal = Math.round(max - (max * g) / 3);
        return (
          <g key={g}>
            <line x1={pl} y1={gy} x2={W - pr} y2={gy} stroke={grid} strokeWidth={1} />
            <text x={pl - 4} y={gy + 3} textAnchor="end" fontSize={PE_CHART_LABEL_PX} fill={muted}>
              {labelVal}
            </text>
          </g>
        );
      })}
      {data.map((row, i) => {
        const bx = pl + i * bw + 4;
        const w = Math.max(bw - 8, 4);
        const top = y(row.completedVisits);
        const barH = Math.max(H - pb - top, 2);
        return (
          <g key={row.month}>
            <rect x={bx} y={top} width={w} height={barH} rx={3} fill={primary} opacity={0.9} />
            <text
              x={bx + w / 2}
              y={Math.max(top - 4, 10)}
              textAnchor="middle"
              fontSize={PE_CHART_VALUE_PX}
              fontWeight={700}
              fill={primary}
            >
              {row.completedVisits}
            </text>
            <text
              x={bx + w / 2}
              y={H - 8}
              textAnchor="middle"
              fontSize={PE_CHART_LABEL_PX}
              fill={muted}
            >
              {formatMonthLabel(row.month)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function MonthlyValuePerVisitChart({ rows }: { rows: GrowthLeversMonthlyRow[] }) {
  const data = rows.filter((r) => r.valuePerVisit != null && r.valuePerVisit > 0);
  if (data.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No private/plan revenue per visit in this trailing window.
      </p>
    );
  }

  const W = 560;
  const H = 200;
  const pl = 44;
  const pr = 12;
  const pt = 14;
  const pb = 36;
  const maxVal = Math.max(...data.map((r) => r.valuePerVisit ?? 0), 1);
  const max = maxVal * 1.12;
  const bw = (W - pl - pr) / data.length;
  const y = (v: number) => pt + (1 - v / max) * (H - pt - pb);
  const accent = 'hsl(var(--chart-5))';
  const muted = 'hsl(var(--muted-foreground))';
  const grid = 'hsl(var(--border))';

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      className="max-w-full"
      role="img"
      aria-label="Monthly value per visit"
    >
      {[0, 1, 2, 3].map((g) => {
        const gy = pt + (g * (H - pt - pb)) / 3;
        const labelVal = max - (max * g) / 3;
        return (
          <g key={g}>
            <line x1={pl} y1={gy} x2={W - pr} y2={gy} stroke={grid} strokeWidth={1} />
            <text x={pl - 4} y={gy + 3} textAnchor="end" fontSize={PE_CHART_LABEL_PX} fill={muted}>
              £{Math.round(labelVal)}
            </text>
          </g>
        );
      })}
      {data.map((row, i) => {
        const v = row.valuePerVisit ?? 0;
        const bx = pl + i * bw + 4;
        const w = Math.max(bw - 8, 4);
        const top = y(v);
        const barH = Math.max(H - pb - top, 2);
        return (
          <g key={row.month}>
            <rect x={bx} y={top} width={w} height={barH} rx={3} fill={accent} opacity={0.9} />
            <text
              x={bx + w / 2}
              y={Math.max(top - 4, 10)}
              textAnchor="middle"
              fontSize={PE_CHART_VALUE_PX}
              fontWeight={700}
              fill={accent}
            >
              £{Math.round(v)}
            </text>
            <text
              x={bx + w / 2}
              y={H - 8}
              textAnchor="middle"
              fontSize={PE_CHART_LABEL_PX}
              fill={muted}
            >
              {formatMonthLabel(row.month)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function LeverHeadroomByPracticeChart({ rows }: { rows: GrowthLeversPracticeRow[] }) {
  const chartRows = rows
    .filter((row) => hasGrowthLeverClinicalData(row) && row.combinedHeadroomPct != null)
    .sort((a, b) => (b.combinedHeadroomPct ?? -1) - (a.combinedHeadroomPct ?? -1));

  if (chartRows.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No practice lever data in the trailing window yet. Sync appointments and revenue first.
      </p>
    );
  }

  const W = 560;
  const rowH = 30;
  const pl = 120;
  const pr = 72;
  const H = chartRows.length * rowH + 16;
  const bw = W - pl - pr;
  const max = 100;
  const warn = 'hsl(var(--warning))';
  const danger = 'hsl(var(--danger))';
  const muted = 'hsl(var(--muted-foreground))';
  const grid = 'hsl(var(--border))';
  const success = 'hsl(var(--success))';

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      className="max-w-full"
      role="img"
      aria-label="Lever headroom by practice"
    >
      {chartRows.map((row, i) => {
        const pct = Math.max(0, Math.min(row.combinedHeadroomPct ?? 0, max));
        const yy = 8 + i * rowH;
        const w = bw * (pct / max);
        const col =
          pct <= 0 ? muted : pct >= 55 ? danger : pct >= 30 ? warn : success;
        const label =
          row.practiceName.length > 16
            ? `${row.practiceName.slice(0, 15)}…`
            : row.practiceName;
        return (
          <g key={row.practiceId}>
            <title>{`${row.practiceName}: ${Math.round(pct)}% room`}</title>
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
              <rect x={pl} y={yy + 4} width={w} height={15} rx={4} fill={col} />
            )}
            <text
              x={pl + bw + 6}
              y={yy + 16}
              fontSize={PE_CHART_VALUE_PX}
              fontWeight={700}
              fill={col}
            >
              {Math.round(pct)}% room
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function CltvByAcquisitionSourceChart({ rows }: { rows: CltvAcquisitionSourceRow[] }) {
  const data = rows.filter((r) => r.avgCltv > 0 && !r.isThinSample);
  const thin = rows.filter((r) => r.isThinSample && r.avgCltv > 0);

  if (data.length === 0 && thin.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No modelled CLTV by acquisition source yet. Run the Day 3 modelled job after sync.
      </p>
    );
  }

  const display = [...data, ...thin].slice(0, 8);
  const maxVal = Math.max(...display.map((r) => r.avgCltv), 1);
  const W = 560;
  const rowH = 30;
  const pl = 96;
  const pr = 72;
  const H = display.length * rowH + 16;
  const bw = W - pl - pr;
  const primary = 'hsl(var(--primary))';
  const muted = 'hsl(var(--muted-foreground))';
  const grid = 'hsl(var(--border))';

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      className="max-w-full"
      role="img"
      aria-label="CLTV by acquisition source"
    >
      {display.map((row, i) => {
        const yy = 8 + i * rowH;
        const w = bw * (row.avgCltv / maxVal);
        const opacity = row.isThinSample ? 0.45 : 0.95;
        const label =
          row.acquisitionSourceName.length > 12
            ? `${row.acquisitionSourceName.slice(0, 11)}…`
            : row.acquisitionSourceName;
        return (
          <g key={`${row.acquisitionSourceName}-${i}`}>
            <text x={pl - 8} y={yy + 15} textAnchor="end" fontSize={PE_CHART_LABEL_PX} fill={muted}>
              {label}
            </text>
            <rect x={pl} y={yy + 4} width={bw} height={15} rx={4} fill={grid} opacity={0.5} />
            <rect
              x={pl}
              y={yy + 4}
              width={w}
              height={15}
              rx={4}
              fill={primary}
              opacity={opacity}
            />
            <text x={pl + w + 6} y={yy + 16} fontSize={PE_CHART_VALUE_PX} fontWeight={700} fill={primary}>
              £{Math.round(row.avgCltv).toLocaleString()}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
