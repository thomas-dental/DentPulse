/**
 * PE Invoices — aged debt and collection rate charts (mockup-aligned).
 */

import type { PeAgedDebtBucket, PeCollectionRatePracticeRow } from '@/services/integrations/peInvoicesService';
import {
  PE_AGING_BUCKET_CHART_LABELS,
  PE_COLLECTION_RATE_TARGET_DEFAULT,
  type PeAgingBucketId,
} from '@/lib/peInvoicesConstants';
import {
  PE_CHART_CAPTION_PX,
  PE_CHART_LABEL_PX,
  PE_CHART_VALUE_PX,
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
  if (abs >= 1_000_000) {
    return `£${(abs / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`;
  }
  if (abs >= 1_000) return `£${(abs / 1_000).toFixed(0)}k`;
  return formatGbp(value);
}

function formatPct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

const BUCKET_COLORS: Record<PeAgingBucketId, string> = {
  '0-30': 'hsl(var(--primary))',
  '31-60': 'hsl(var(--warning))',
  '61-90': 'hsl(var(--destructive) / 0.85)',
  '90+': 'hsl(var(--destructive))',
};

/** Vertical column chart — mockup aged debt. */
export function AgedDebtChart({ buckets }: { buckets: PeAgedDebtBucket[] }) {
  const max = Math.max(...buckets.map((b) => b.outstandingGbp), 1);
  const W = 520;
  const n = buckets.length;
  const padX = 36;
  const chartW = W - padX * 2;
  const colW = chartW / n;
  const barW = Math.min(72, colW * 0.55);
  const chartH = 160;
  const baseY = chartH + 28;
  const H = baseY + 22;
  const muted = 'hsl(var(--muted-foreground))';

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      className="max-w-full"
      role="img"
      aria-label="Outstanding balance by aging bucket"
    >
      {buckets.map((row, i) => {
        const cx = padX + colW * i + colW / 2;
        const isZero = row.outstandingGbp <= 0;
        // Always draw a bar (stub height when £0) so empty buckets stay visible.
        const h = isZero ? 4 : Math.max(4, (row.outstandingGbp / max) * chartH);
        const color = BUCKET_COLORS[row.bucket] ?? BUCKET_COLORS['0-30'];
        const label = PE_AGING_BUCKET_CHART_LABELS[row.bucket] ?? row.label;

        return (
          <g key={row.bucket}>
            <text
              x={cx}
              y={baseY - h - 6}
              textAnchor="middle"
              fontSize={PE_CHART_VALUE_PX}
              fill={color}
              fontWeight="700"
              opacity={isZero ? 0.55 : 1}
            >
              {isZero ? '£0' : formatGbpCompact(row.outstandingGbp)}
            </text>
            <rect
              x={cx - barW / 2}
              y={baseY - h}
              width={barW}
              height={h}
              rx={4}
              fill={color}
              opacity={isZero ? 0.35 : 0.92}
            />
            <text
              x={cx}
              y={baseY + 14}
              textAnchor="middle"
              fontSize={PE_CHART_LABEL_PX}
              fill={muted}
              fontWeight="600"
            >
              {label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function CollectionRateByPracticeChart({
  rows,
  trailingMonths,
  targetRate = PE_COLLECTION_RATE_TARGET_DEFAULT,
}: {
  rows: PeCollectionRatePracticeRow[];
  trailingMonths: number;
  targetRate?: number;
}) {
  if (rows.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        No practices in scope for collection rate.
      </p>
    );
  }

  // Scale bars to the highest rate so 147% is longer than 103% (not both capped at full track).
  const rateValues = rows
    .map((r) => r.collectionRate)
    .filter((r): r is number => r != null && Number.isFinite(r) && r > 0);
  const maxScale = Math.max(1, targetRate, ...rateValues);

  // Match ClinicianCommitmentChart: full labels, thin track/fill, value beside bar.
  const maxLabelLen = Math.max(...rows.map((r) => r.practiceName.length), 8);
  const pl = Math.min(220, Math.max(110, maxLabelLen * 6.4 + 14));
  const pr = 52;
  const rowH = 30;
  const barH = 14;
  const barRx = 4;
  const bw = 280;
  const headerH = 40;
  const W = pl + bw + pr;
  const H = headerH + rows.length * rowH + 8;
  const grid = 'hsl(var(--border))';
  const muted = 'hsl(var(--muted-foreground))';
  const primary = 'hsl(var(--primary))';
  const targetX = pl + (bw * targetRate) / maxScale;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      className="max-w-full"
      role="img"
      aria-label="Collection rate by practice"
      preserveAspectRatio="xMinYMin meet"
    >
      <text x={pl} y={14} fontSize={PE_CHART_CAPTION_PX} fill={muted}>
        Last {trailingMonths} months · collected ÷ invoiced
      </text>
      <text x={targetX + 6} y={32} fontSize={PE_CHART_CAPTION_PX} fill={primary} fontWeight={600}>
        {formatPct(targetRate)} target
      </text>
      {rows.map((row, i) => {
        const yy = headerH + i * rowH;
        const rate = row.collectionRate;
        const pct = rate != null ? Math.round(rate * 100) : null;
        const w = rate != null && rate > 0 ? bw * (rate / maxScale) : 0;
        const col =
          rate == null
            ? muted
            : rate >= targetRate
              ? 'hsl(var(--success))'
              : rate >= targetRate - 0.03
                ? 'hsl(var(--warning))'
                : 'hsl(var(--destructive) / 0.85)';
        const label =
          row.practiceName.length > 32
            ? `${row.practiceName.slice(0, 31)}…`
            : row.practiceName;

        return (
          <g key={row.practiceId}>
            <title>
              {row.practiceName}
              {pct != null ? `: ${pct}%` : ''}
            </title>
            <text
              x={8}
              y={yy + 16}
              textAnchor="start"
              fontSize={PE_CHART_LABEL_PX}
              fontWeight={600}
              fill={muted}
            >
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
            {w > 0 && (
              <rect x={pl} y={yy + 6} width={w} height={barH} rx={barRx} fill={col} />
            )}
            <text
              x={pl + (w > 0 ? w : 0) + 6}
              y={yy + 16}
              fontSize={PE_CHART_VALUE_PX}
              fontWeight={700}
              fill={col}
            >
              {pct != null ? `${pct}%` : '—'}
            </text>
          </g>
        );
      })}
      {/* Draw target baseline after bars so it sits on top of the real-data fills. */}
      <line
        x1={targetX}
        y1={headerH - 2}
        x2={targetX}
        y2={H - 4}
        stroke={primary}
        strokeWidth={2.5}
        strokeDasharray="5 4"
      />
    </svg>
  );
}
