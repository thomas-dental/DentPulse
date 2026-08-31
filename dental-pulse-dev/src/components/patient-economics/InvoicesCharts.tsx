/**
 * PE Invoices — aged debt and collection rate charts (mockup-aligned).
 */

import type { PeAgedDebtBucket, PeCollectionRatePracticeRow } from '@/services/integrations/peInvoicesService';
import {
  PE_AGING_BUCKET_CHART_LABELS,
  PE_COLLECTION_RATE_TARGET_DEFAULT,
  type PeAgingBucketId,
} from '@/lib/peInvoicesConstants';

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
        const h =
          row.outstandingGbp > 0 ? Math.max(4, (row.outstandingGbp / max) * chartH) : 0;
        const color = BUCKET_COLORS[row.bucket] ?? BUCKET_COLORS['0-30'];
        const label = PE_AGING_BUCKET_CHART_LABELS[row.bucket] ?? row.label;

        return (
          <g key={row.bucket}>
            {h > 0 && (
              <text
                x={cx}
                y={baseY - h - 6}
                textAnchor="middle"
                fontSize="12"
                fill={color}
                fontWeight="700"
              >
                {formatGbpCompact(row.outstandingGbp)}
              </text>
            )}
            {h > 0 && (
              <rect
                x={cx - barW / 2}
                y={baseY - h}
                width={barW}
                height={h}
                rx={4}
                fill={color}
                opacity={0.92}
              />
            )}
            <text x={cx} y={baseY + 14} textAnchor="middle" fontSize="12" fill={muted} fontWeight="600">
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

  const W = 520;
  const rowH = 44;
  const pl = 118;
  const pr = 54;
  const H = rows.length * rowH + 28;
  const bw = W - pl - pr;
  const muted = 'hsl(var(--muted-foreground))';
  const label = 'hsl(var(--foreground))';
  const primary = 'hsl(var(--primary))';
  const targetX = pl + bw * targetRate;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      className="max-w-full"
      role="img"
      aria-label="Collection rate by practice"
    >
      <text x={pl} y={12} fontSize="10.5" fill={muted}>
        Last {trailingMonths} months · collected ÷ invoiced
      </text>
      <line
        x1={targetX}
        y1={16}
        x2={targetX}
        y2={H - 4}
        stroke={primary}
        strokeWidth={1.5}
        strokeDasharray="5 4"
        opacity={0.65}
      />
      <text x={targetX + 4} y={24} fontSize="10" fill={primary} fontWeight="600">
        {formatPct(targetRate)} target
      </text>
      {rows.map((row, i) => {
        const yy = 20 + i * rowH;
        const rate = row.collectionRate ?? 0;
        const w = rate > 0 ? bw * rate : 0;
        const color =
          rate >= targetRate
            ? 'hsl(var(--success))'
            : rate >= targetRate - 0.03
              ? 'hsl(var(--warning))'
              : 'hsl(var(--destructive) / 0.85)';

        return (
          <g key={row.practiceId}>
            <text
              x={pl - 8}
              y={yy + 16}
              textAnchor="end"
              fontSize="12"
              fill={label}
              fontWeight="600"
            >
              {row.practiceName.length > 16
                ? `${row.practiceName.slice(0, 15)}…`
                : row.practiceName}
            </text>
            <rect
              x={pl}
              y={yy + 10}
              width={bw}
              height={22}
              rx={4}
              fill="hsl(var(--muted))"
              opacity={0.35}
            />
            {w > 0 && (
              <rect x={pl} y={yy + 10} width={w} height={22} rx={4} fill={color} opacity={0.92} />
            )}
            <text x={pl + bw + 6} y={yy + 26} fontSize="12" fill={label} fontWeight="700">
              {row.collectionRate != null ? formatPct(row.collectionRate) : '—'}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
