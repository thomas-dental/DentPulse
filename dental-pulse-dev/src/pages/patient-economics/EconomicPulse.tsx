/**
 * Patients (/patients) — Economic Pulse is live; other PE tabs pending in sidebar.
 */

import type { ReactNode } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, AlertTriangle, Download, Info, Plus, Settings2 } from 'lucide-react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useInvoiceContributionSummary,
  type InvoiceContributionSummary,
} from '@/hooks/usePatientContributionSummary';
import {
  useTreatmentEconomicJourney,
  type JourneyStage,
  type TreatmentEconomicJourney,
} from '@/hooks/useTreatmentEconomicJourney';
import { cn } from '@/lib/utils';
import { PatientEconomicsSettingsTab } from '@/pages/patient-economics/PatientEconomicsSettingsTab';

type ProvenanceKind = 'derived' | 'pending' | 'partial' | 'dentally';
type HeroTone = 'default' | 'opp' | 'risk' | 'conv' | 'qual';

const PE_TABS: { key: string | null; label: string; to: string }[] = [
  { key: null, label: 'Economic Pulse', to: '/patients' },
  { key: 'growth-levers', label: 'Growth Levers', to: '/patients?tab=growth-levers' },
  { key: 'value-leakage', label: 'Value & Leakage', to: '/patients?tab=value-leakage' },
  { key: 'retention', label: 'Retention & Reactivation', to: '/patients?tab=retention' },
  { key: 'patient-list', label: 'Patient List', to: '/patients?tab=patient-list' },
  { key: 'patient-records', label: 'Patient Records', to: '/patients?tab=patient-records' },
  { key: 'invoices', label: 'Invoices', to: '/patients?tab=invoices' },
  { key: 'goal-settings', label: 'Goal Settings', to: '/patients?tab=goal-settings' },
  { key: 'settings', label: 'Settings', to: '/patients?tab=settings' },
];

const PENDING_TABS: Record<string, { title: string }> = {
  'growth-levers': { title: 'Growth Levers' },
  'value-leakage': { title: 'Value & Leakage' },
  retention: { title: 'Retention & Reactivation' },
  'patient-list': { title: 'Patient List' },
  'patient-records': { title: 'Patient Records' },
  invoices: { title: 'Invoices' },
  'goal-settings': { title: 'Goal Settings' },
};

const PE_TAB_KEYS = new Set(PE_TABS.map((t) => t.key).filter(Boolean) as string[]);

function formatGbp(value: number): string {
  const abs = Math.abs(value);
  const formatted = new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    maximumFractionDigits: abs >= 1000 ? 0 : 2,
  }).format(abs);
  return value < 0 ? `−${formatted}` : formatted;
}

function formatGbpCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    const m = abs / 1_000_000;
    const digits = m >= 10 ? 1 : 2;
    return `£${m.toFixed(digits).replace(/\.?0+$/, '')}m`;
  }
  if (abs >= 1_000) {
    const k = abs / 1_000;
    return `£${k.toFixed(k >= 10 ? 0 : 1).replace(/\.0$/, '')}k`;
  }
  return formatGbp(value);
}

type RevenueMixSegment = {
  key: string;
  label: string;
  value: number;
  barClass: string;
};

function RevenueMixCard({
  isLoading,
  revenuePrivate,
  revenuePlan,
  revenueNhs,
  udaDeliveryPct,
  udaClawbackGbp,
  udaOnTarget,
  hasNhsContract,
}: {
  isLoading?: boolean;
  revenuePrivate: number;
  revenuePlan: number;
  revenueNhs: number;
  udaDeliveryPct: number | null;
  udaClawbackGbp: number | null;
  udaOnTarget: boolean | null;
  hasNhsContract: boolean;
}) {
  if (isLoading) {
    return (
      <div className="rounded-[14px] border border-border bg-card px-5 py-[18px] shadow-sm">
        <Skeleton className="h-4 w-72" />
        <Skeleton className="mt-2 h-3 w-full max-w-md" />
        <Skeleton className="mt-4 h-[26px] w-full rounded-[7px]" />
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
        </div>
      </div>
    );
  }

  const engineRevenue = revenuePrivate + revenuePlan;
  const totalMix = engineRevenue + revenueNhs;

  const segments: RevenueMixSegment[] = [
    { key: 'private', label: 'Private', value: revenuePrivate, barClass: 'bg-primary' },
    { key: 'plan', label: 'Plan', value: revenuePlan, barClass: 'bg-[hsl(var(--chart-2))]' },
    {
      key: 'nhs',
      label: 'NHS/UDA',
      value: revenueNhs,
      barClass: 'bg-muted-foreground',
    },
  ].filter((s) => s.value > 0);

  const visibleSegments =
    segments.length > 0
      ? segments
      : [{ key: 'empty', label: 'No invoice mix yet', value: 1, barClass: 'bg-muted' }];

  const isMixed = engineRevenue > 0 && revenueNhs > 0;
  const badgeLabel = isMixed
    ? 'Mixed NHS/private income in scope'
    : revenueNhs > 0
      ? 'NHS/UDA tracked separately'
      : 'Private & plan income only';

  let udaDeliveryLabel: ReactNode;
  if (!hasNhsContract) {
    udaDeliveryLabel = (
      <span className="text-muted-foreground/80">
        — · no NHS contract ·{' '}
        <Link to="/patients?tab=settings" className="underline underline-offset-2 hover:text-foreground">
          set contract
        </Link>
      </span>
    );
  } else if (udaDeliveryPct == null) {
    udaDeliveryLabel = <span className="text-muted-foreground/80">—</span>;
  } else {
    udaDeliveryLabel = (
      <>
        {udaDeliveryPct}%
        {udaOnTarget != null && (
          <>
            {' · '}
            <span className={udaOnTarget ? 'text-success' : 'text-warning'}>
              {udaOnTarget ? 'on target' : 'below target'}
            </span>
          </>
        )}
      </>
    );
  }

  let clawbackLabel: ReactNode;
  if (!hasNhsContract || udaClawbackGbp == null) {
    clawbackLabel = <span className="text-muted-foreground/80">£0</span>;
  } else if (udaClawbackGbp > 0) {
    clawbackLabel = (
      <span className="text-warning">{formatGbpCompact(udaClawbackGbp)}</span>
    );
  } else {
    clawbackLabel = <span className="text-success">£0</span>;
  }

  return (
    <div className="rounded-[14px] border border-border bg-card px-5 py-[18px] shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-bold text-foreground">
            Revenue mix &amp; scope of the contribution view
          </h3>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">
            Contribution is calculated on private &amp; plan income. NHS/UDA is contract-value
            based, so it is tracked separately, never blended in.
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">
          {badgeLabel}
        </span>
      </div>

      <div className="mt-3.5 flex h-[26px] overflow-hidden rounded-[7px] text-[11px] font-bold text-white">
        {visibleSegments.map((segment) => {
          const pct =
            totalMix > 0
              ? Math.round((segment.value / totalMix) * 100)
              : segment.key === 'empty'
                ? 100
                : 0;
          // Small slices (e.g. NHS ~8%) can't fit in-bar text — legend below covers them.
          const showLabel = pct >= 12 && segment.key !== 'empty';
          return (
            <div
              key={segment.key}
              className={cn(
                'flex min-w-0 items-center justify-center px-1',
                segment.barClass,
              )}
              style={{ width: `${Math.max(pct, segment.key === 'empty' ? 100 : 0)}%` }}
              title={`${segment.label} ${formatGbp(segment.value)} (${pct}%)`}
            >
              {showLabel && (
                <span className="truncate">
                  {segment.label} {formatGbpCompact(segment.value)} · {pct}%
                </span>
              )}
            </div>
          );
        })}
      </div>

      {segments.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted-foreground">
          {segments.map((segment) => {
            const pct =
              totalMix > 0 ? Math.round((segment.value / totalMix) * 100) : 0;
            return (
              <span key={segment.key} className="inline-flex items-center gap-1.5">
                <span className={cn('h-2 w-2 shrink-0 rounded-sm', segment.barClass)} />
                <span className="font-medium text-foreground">{segment.label}</span>
                <span>
                  {formatGbpCompact(segment.value)} · {pct}%
                </span>
              </span>
            );
          })}
        </div>
      )}

      <div className="mt-3.5 grid gap-0 sm:grid-cols-3">
        <div className="flex items-baseline justify-between border-b border-dashed border-border py-2 sm:border-b-0 sm:border-r sm:border-dashed sm:pr-3">
          <span className="text-[12.5px] text-muted-foreground">
            In contribution engine (private + plan)
          </span>
          <span className="text-[13.5px] font-bold text-primary">
            {formatGbpCompact(engineRevenue)}
          </span>
        </div>
        <div className="flex items-baseline justify-between border-b border-dashed border-border py-2 sm:border-b-0 sm:border-r sm:border-dashed sm:px-3">
          <span className="text-[12.5px] text-muted-foreground">UDA delivery YTD</span>
          <span className="text-[13.5px] font-bold text-foreground">{udaDeliveryLabel}</span>
        </div>
        <div className="flex items-baseline justify-between py-2 sm:pl-3">
          <span className="text-[12.5px] text-muted-foreground">UDA clawback exposure</span>
          <span className="text-[13.5px] font-bold">{clawbackLabel}</span>
        </div>
      </div>
    </div>
  );
}

function ProvenanceChip({ kind }: { kind: ProvenanceKind }) {
  if (kind === 'pending') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/70" />
        Pending
      </span>
    );
  }
  if (kind === 'partial') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:text-amber-200">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
        Partial data
      </span>
    );
  }
  if (kind === 'dentally') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[11px] font-semibold text-sky-800 dark:text-sky-200">
        <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />
        Dentally
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
      <span className="h-1.5 w-1.5 rounded-full bg-primary" />
      Derived
    </span>
  );
}

/** Step 6 — distinct missing_practitioner vs missing_rate copy (not generic “incomplete”). */
function PartialDataBanner({
  summary,
}: {
  summary: Pick<
    InvoiceContributionSummary,
    | 'hasMissingPractitioner'
    | 'hasMissingRate'
    | 'invoicesMissingPractitioner'
    | 'invoicesMissingRate'
    | 'revenueNoPractitioner'
    | 'revenueMissingRate'
  >;
}) {
  const gaps: ReactNode[] = [];

  if (summary.hasMissingPractitioner) {
    gaps.push(
      <li key="missing_practitioner">
        <span className="font-semibold text-foreground">Missing practitioner</span>
        {' — '}
        {summary.invoicesMissingPractitioner.toLocaleString('en-GB')} invoice
        {summary.invoicesMissingPractitioner === 1 ? '' : 's'} (
        {formatGbpCompact(summary.revenueNoPractitioner)} private/plan) have no clinician to
        attribute. Contribution for those invoices is excluded until a practitioner is set on
        the line items in Dentally.
      </li>,
    );
  }

  if (summary.hasMissingRate) {
    gaps.push(
      <li key="missing_rate">
        <span className="font-semibold text-foreground">Missing rate</span>
        {' — '}
        {summary.invoicesMissingRate.toLocaleString('en-GB')} invoice
        {summary.invoicesMissingRate === 1 ? '' : 's'} (
        {formatGbpCompact(summary.revenueMissingRate)} private/plan) have a clinician but no
        private-share rate. Clinician cost is treated as 0% for now; set rates in Settings so
        contribution reflects real cost.
      </li>,
    );
  }

  if (gaps.length === 0) return null;

  return (
    <div className="flex flex-wrap items-start gap-3 rounded-[10px] border border-amber-500/25 bg-amber-500/5 px-4 py-3 text-sm">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <div className="font-semibold text-foreground">Contribution uses partial data</div>
          <ProvenanceChip kind="partial" />
        </div>
        <ul className="mt-2 list-disc space-y-1.5 pl-4 text-[13px] text-muted-foreground">
          {gaps}
        </ul>
      </div>
      {summary.hasMissingRate && (
        <Button asChild size="sm" variant="outline" className="gap-2 shrink-0">
          <Link to="/patients?tab=settings">
            <Settings2 className="h-4 w-4" />
            Set clinician rates
          </Link>
        </Button>
      )}
    </div>
  );
}

function HeroCard({
  tone = 'default',
  question,
  children,
  subtitle,
}: {
  tone?: HeroTone;
  question: string;
  children: ReactNode;
  subtitle: ReactNode;
}) {
  const bar =
    tone === 'opp'
      ? 'bg-[hsl(var(--chart-5))]'
      : tone === 'risk'
        ? 'bg-danger'
        : tone === 'conv'
          ? 'bg-warning'
          : tone === 'qual'
            ? 'bg-success'
            : 'bg-primary';

  return (
    <div className="relative overflow-hidden rounded-[14px] border border-border bg-card px-4 py-4 pb-[15px] shadow-sm">
      <div className={cn('absolute inset-x-0 top-0 h-[3px]', bar)} />
      <div className="text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground mb-[9px] min-h-[26px]">
        {question}
      </div>
      <div className="mt-2 min-h-[2.5rem]">{children}</div>
      <div className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">{subtitle}</div>
    </div>
  );
}

function PendingValue() {
  return (
    <div className="text-[22px] font-extrabold tracking-tight text-muted-foreground/80">
      —
    </div>
  );
}

function PageChrome({ activeTab }: { activeTab: string | null }) {
  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-foreground">
            Patient Economics Engine
            <span className="align-super text-xs font-semibold text-primary">™</span>
          </h1>
          <p className="mt-[3px] text-sm text-muted-foreground">
            Every patient as a financial record, contribution, opportunity and value at risk,
            across all 12 practices.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" className="h-9 gap-2 px-3.5" disabled>
            <Download className="h-3.5 w-3.5" />
            Export
          </Button>
          <Button type="button" size="sm" className="h-9 gap-2 px-3.5" disabled>
            <Plus className="h-3.5 w-3.5" />
            New Report
          </Button>
        </div>
      </div>

      <div className="mb-[18px] flex items-start gap-2.5 rounded-[10px] border border-primary/20 bg-gradient-to-r from-primary/[0.08] to-primary/[0.02] px-3.5 py-2.5 text-[13px] leading-relaxed text-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <span>
          Viewing as <b className="font-semibold text-primary">Multi-Practice Manager</b>
          {' · '}
          figures aggregate <b className="font-semibold text-primary">all practices</b>.
          Contribution figures use the{' '}
          <b className="font-semibold text-primary">Economic Assumptions</b> in Settings where
          live cost feeds aren&apos;t connected, each number carries a data-confidence tag.
        </span>
      </div>

      <div className="mb-5 flex flex-wrap gap-1 rounded-[10px] bg-muted p-1">
        {PE_TABS.map((t) => {
          const isActive = activeTab === t.key;
          return (
            <Link
              key={t.label}
              to={t.to}
              className={cn(
                'rounded-[7px] px-[13px] py-2 text-[13px] font-semibold transition-colors',
                isActive
                  ? 'bg-card text-primary shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
    </>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mt-[26px] mb-3 text-[11px] font-bold uppercase tracking-[0.08em] text-primary">
      {children}
    </div>
  );
}

function PendingChartPlaceholder({ height = 220 }: { height?: number }) {
  return (
    <div
      className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/30 text-center"
      style={{ minHeight: height }}
    >
      <div className="text-[13px] font-semibold text-muted-foreground">Calculating</div>
      <div className="mt-1.5 text-[12px] text-muted-foreground/80">
        Chart lands with the full economics engine
      </div>
      <div className="mt-3">
        <ProvenanceChip kind="pending" />
      </div>
    </div>
  );
}

function OpportunityActionsPending() {
  const priorities = [
    {
      label: 'Priority 1 · Retention',
      title: 'High-value overdue patients',
      description:
        'Lapsed patients who previously generated £1,000+ contribution/yr. Prioritise reactivation.',
      metric: 'at risk',
    },
    {
      label: 'Priority 2 · Commercial opportunity',
      title: 'Planned > 60 days, unscheduled',
      description:
        'Private treatment planned with no future appointment linked. Chase to schedule.',
      metric: 'contribution',
    },
    {
      label: 'Priority 3 · Billing leakage',
      title: 'Completed treatment not yet charged',
      description:
        'Courses completed in Dentally but no invoice raised yet. Charge them.',
      metric: 'contribution',
    },
  ];

  return (
    <div className="mt-5 rounded-[14px] border border-primary/25 bg-gradient-to-br from-primary/10 to-primary/[0.03] px-5 py-[18px]">
      <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2">
        <div className="text-[15px] font-extrabold text-foreground">
          DentPulse has identified{' '}
          <span className="text-muted-foreground/80">—</span> of patient economic opportunity
        </div>
        <span className="text-[12px] text-muted-foreground">
          Calculating — full breakdown not yet available
        </span>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {priorities.map((item) => (
          <div
            key={item.label}
            className="rounded-[11px] border border-border bg-card px-3.5 py-3.5"
          >
            <div className="text-[10.5px] font-bold uppercase tracking-[0.05em] text-primary">
              {item.label}
            </div>
            <div className="mt-1 text-[13.5px] font-bold text-foreground">{item.title}</div>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
              {item.description}
            </p>
            <div className="mt-2 text-[19px] font-extrabold text-muted-foreground/70">
              —{' '}
              <span className="text-[12px] font-semibold text-muted-foreground">{item.metric}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function JourneyWaterfallChart({ stages }: { stages: JourneyStage[] }) {
  const W = 560;
  const H = 230;
  const pl = 40;
  const pr = 12;
  const pt = 18;
  const pb = 44;
  const maxVal = Math.max(...stages.map((s) => s.valueGbp), 1);
  // Nice axis headroom
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
        <text
          x={pl - 6}
          y={gy + 3}
          textAnchor="end"
          fontSize={9}
          fill={muted}
        >
          {formatGbpCompact(labelVal)}
        </text>
      </g>
    );
  });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" className="max-w-full" role="img" aria-label="Treatment Economic Journey">
      {gridLines}
      {stages.map((s, i) => {
        const bx = pl + i * bw + 6;
        const w = bw - 14;
        const top = y(s.valueGbp);
        const barH = Math.max(H - pb - top, s.valueGbp > 0 ? 2 : 0);
        const prev = i > 0 ? stages[i - 1] : null;
        const drop = prev && prev.valueGbp > s.valueGbp ? prev.valueGbp - s.valueGbp : 0;
        return (
          <g key={s.key}>
            {drop > 0 && prev && (
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
              rx={3}
              fill={primary}
              opacity={i === 0 || i === stages.length - 1 ? 1 : 0.85}
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
            <text
              x={bx + w / 2}
              y={H - pb + 28}
              textAnchor="middle"
              fontSize={9}
              fill={muted}
            >
              {s.eventCount.toLocaleString('en-GB')}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function ContributionVsRevenueChart({
  revenue,
  contribution,
}: {
  revenue: number;
  contribution: number;
}) {
  const W = 280;
  const H = 150;
  const pl = 10;
  const pr = 10;
  const pt = 18;
  const pb = 26;
  const max = Math.max(revenue, contribution, 1) * 1.08;
  const bw = (W - pl - pr) / 2;
  const y = (v: number) => pt + (1 - v / max) * (H - pt - pb);
  const mut = 'hsl(var(--muted-foreground))';
  const success = 'hsl(var(--success))';

  const bars: { label: string; value: number; color: string }[] = [
    { label: 'Revenue', value: revenue, color: mut },
    { label: 'Contribution', value: contribution, color: success },
  ];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" className="max-w-full" role="img" aria-label="Contribution vs Revenue">
      {bars.map((b, i) => {
        const bx = pl + i * bw;
        const top = y(b.value);
        return (
          <g key={b.label}>
            <rect
              x={bx + 24}
              y={top}
              width={bw - 48}
              height={Math.max(H - pb - top, b.value > 0 ? 2 : 0)}
              rx={4}
              fill={b.color}
            />
            <text
              x={bx + bw / 2}
              y={Math.max(top - 5, 12)}
              textAnchor="middle"
              fontSize={12}
              fontWeight={800}
              fill={b.color}
            >
              {formatGbpCompact(b.value)}
            </text>
            <text x={bx + bw / 2} y={H - 8} textAnchor="middle" fontSize={10.5} fill={mut}>
              {b.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function TreatmentEconomicJourneyCard({
  isLoading,
  isError,
  errorMessage,
  onRetry,
  isFetching,
  journey,
}: {
  isLoading: boolean;
  isError: boolean;
  errorMessage?: string;
  onRetry: () => void;
  isFetching: boolean;
  journey: TreatmentEconomicJourney | undefined;
}) {
  return (
    <div className="rounded-[14px] border border-border bg-card px-5 py-[18px] shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-bold text-foreground">
            Treatment Economic Journey
            <span className="align-super text-[9px] font-semibold text-primary">™</span>
          </h3>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">
            Planned → collected · ledger event counts and payload £
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <ProvenanceChip kind="dentally" />
          <ProvenanceChip kind="derived" />
        </div>
      </div>

      {isError && (
        <div className="mt-3.5 flex flex-wrap items-start gap-3 rounded-[10px] border border-danger/30 bg-danger-muted px-3 py-2.5 text-sm text-danger-strong">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="flex-1">
            <div className="font-semibold">Couldn’t load journey ledger</div>
            <div className="mt-0.5 text-danger-strong/80">
              {errorMessage || 'event_ledger query failed.'}
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={onRetry} disabled={isFetching}>
            Retry
          </Button>
        </div>
      )}

      {!isError && isLoading && (
        <div className="mt-3.5 space-y-3">
          <Skeleton className="h-[180px] w-full rounded-lg" />
          <Skeleton className="h-3 w-48" />
        </div>
      )}

      {!isError && !isLoading && journey?.isBackfilling && (
        <div className="mt-3.5 flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/30 px-4 text-center">
          <div className="text-[13px] font-semibold text-foreground">
            Ledger data still backfilling
          </div>
          <div className="mt-1.5 max-w-sm text-[12px] text-muted-foreground">
            Too little event history to chart the journey yet. After Dentally sync finishes
            writing Planned → Collected events, this funnel fills in automatically.
          </div>
          <div className="mt-3">
            <ProvenanceChip kind="pending" />
          </div>
        </div>
      )}

      {!isError && !isLoading && journey && !journey.isBackfilling && (
        <div className="mt-3.5">
          <JourneyWaterfallChart stages={journey.stages} />
        </div>
      )}
    </div>
  );
}

function ContributionVsRevenueCard({
  isLoading,
  isError,
  revenue,
  contribution,
  showEmpty,
}: {
  isLoading: boolean;
  isError: boolean;
  revenue: number;
  contribution: number;
  showEmpty: boolean;
}) {
  const marginPct =
    revenue > 0 ? Math.round((contribution / revenue) * 1000) / 10 : null;

  return (
    <div className="rounded-[14px] border border-border bg-card px-5 py-[18px] shadow-sm">
      <h3 className="text-[15px] font-bold text-foreground">Contribution vs Revenue</h3>
      <p className="mt-0.5 text-[12.5px] text-muted-foreground">Why economics beats “spend”</p>

      {isLoading && (
        <div className="mt-2.5 space-y-2">
          <Skeleton className="h-[140px] w-full rounded-lg" />
          <Skeleton className="h-3 w-full" />
        </div>
      )}

      {!isLoading && (isError || showEmpty) && (
        <div className="mt-2.5">
          <PendingChartPlaceholder height={160} />
          <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
            Margin summary calculates once revenue and contribution feeds are connected.
          </p>
        </div>
      )}

      {!isLoading && !isError && !showEmpty && (
        <>
          <div className="mt-2.5">
            <ContributionVsRevenueChart revenue={revenue} contribution={contribution} />
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
            The practice booked{' '}
            <b className="text-foreground">{formatGbpCompact(revenue)}</b> private/plan revenue
            and generated{' '}
            <b className="text-[hsl(var(--success))]">{formatGbpCompact(contribution)}</b> of
            patient contribution
            {marginPct != null ? (
              <>
                , a <b className="text-foreground">{marginPct}%</b> margin after attributed
                clinician, lab and material cost.
              </>
            ) : (
              '.'
            )}
          </p>
        </>
      )}
    </div>
  );
}

function WhereTheValueSits() {
  const journeyQuery = useTreatmentEconomicJourney();
  const contribQuery = useInvoiceContributionSummary();

  const hasSyncedFinancials =
    !!contribQuery.data &&
    (contribQuery.data.totalRevenue > 0 || contribQuery.data.revenueNhs > 0);

  return (
    <>
      <SectionLabel>Where the value sits</SectionLabel>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.5fr_1fr]">
        <TreatmentEconomicJourneyCard
          isLoading={journeyQuery.isLoading}
          isError={journeyQuery.isError}
          errorMessage={
            journeyQuery.error instanceof Error ? journeyQuery.error.message : undefined
          }
          onRetry={() => journeyQuery.refetch()}
          isFetching={journeyQuery.isFetching}
          journey={journeyQuery.data}
        />
        <ContributionVsRevenueCard
          isLoading={contribQuery.isLoading}
          isError={contribQuery.isError}
          revenue={contribQuery.data?.totalRevenue ?? 0}
          contribution={contribQuery.data?.totalContribution ?? 0}
          showEmpty={!hasSyncedFinancials}
        />
      </div>
    </>
  );
}

function PracticeComparisonPending() {
  const columns = [
    'Practice',
    'Active',
    'Econ. Value',
    'Contribution 12mo',
    'Opportunity (wtd)',
    'At Risk',
    'Commit. Rate',
    'Status',
  ];

  return (
    <>
      <SectionLabel>Practice comparison</SectionLabel>
      <div className="overflow-hidden rounded-[14px] border border-border bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-[18px] pb-1.5">
          <div>
            <h3 className="text-[15px] font-bold text-foreground">Per-Practice Economics</h3>
            <p className="mt-0.5 text-[12.5px] text-muted-foreground">
              Ranked by patient economic value
            </p>
          </div>
          <span className="inline-flex shrink-0 items-center rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">
            Multi-practice view
          </span>
        </div>
        <div className="overflow-x-auto px-5 pb-5">
          <table className="w-full min-w-[720px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-border text-left text-[12px] font-semibold text-muted-foreground">
                {columns.map((col, i) => (
                  <th
                    key={col}
                    className={cn('whitespace-nowrap px-3.5 py-2.5', i > 0 && 'text-right')}
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-3.5 py-10 text-center text-[13px] text-muted-foreground"
                >
                  <div className="font-semibold">Calculating</div>
                  <div className="mt-1 text-[12px]">
                    Per-practice ranking lands with opportunity and commitment engines
                  </div>
                  <div className="mt-3 flex justify-center">
                    <ProvenanceChip kind="pending" />
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function EconomicPulseBelowFold() {
  return (
    <>
      <OpportunityActionsPending />
      <WhereTheValueSits />
      <PracticeComparisonPending />
    </>
  );
}

function PendingTabPanel({ title }: { title: string }) {
  return (
    <div className="rounded-[14px] border border-border bg-card p-8 shadow-sm">
      <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
        {title}
      </div>
      <div className="mt-3 text-[22px] font-extrabold tracking-tight text-muted-foreground/80">
        —
      </div>
      <p className="mt-3 max-w-xl text-sm text-muted-foreground">
        Calculating — this section is listed now; the engine behind it is not yet available.
      </p>
      <div className="mt-4">
        <ProvenanceChip kind="pending" />
      </div>
    </div>
  );
}

function EconomicPulseHeroes() {
  const { data, isLoading, isError, error, refetch, isFetching } =
    useInvoiceContributionSummary();

  const hasSyncedFinancials =
    !!data && (data.totalRevenue > 0 || data.revenueNhs > 0);
  const isEmpty =
    !!data && data.totalRevenue <= 0 && data.revenueNhs <= 0 && !isLoading;

  return (
    <>
      {isError && (
        <div className="flex flex-wrap items-start gap-3 rounded-[10px] border border-danger/30 bg-danger-muted px-4 py-3 text-sm text-danger-strong">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="flex-1">
            <div className="font-semibold">Couldn’t load contribution data</div>
            <div className="mt-0.5 text-danger-strong/80">
              {error instanceof Error ? error.message : 'View query failed.'}
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            Retry
          </Button>
        </div>
      )}

      {isEmpty && !isError && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-primary/20 bg-primary/5 px-4 py-3 text-sm">
          <div>
            <div className="font-semibold text-foreground">No synced financial data yet</div>
            <div className="mt-0.5 text-muted-foreground">
              Connect Dentally and run Patient Economics sync so invoices can feed Existing
              Patient Value.
            </div>
          </div>
          <Button asChild size="sm" className="gap-2">
            <Link to="/admin?tab=integrations">
              <Settings2 className="h-4 w-4" />
              Settings / Integrations
            </Link>
          </Button>
        </div>
      )}

      {!isError && !isLoading && hasSyncedFinancials && data?.hasPartialData && (
        <PartialDataBanner summary={data} />
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="rounded-[14px] border border-border bg-card p-4 shadow-sm">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="mt-3 h-8 w-24" />
              <Skeleton className="mt-3 h-3 w-full" />
              <Skeleton className="mt-2 h-3 w-2/3" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
          <HeroCard
            question="1 · Existing patient value"
            subtitle={
              <>
                Contribution to date (private + plan)
                <br />
                NHS/UDA excluded &nbsp;
                <ProvenanceChip
                  kind={
                    hasSyncedFinancials && data?.hasPartialData ? 'partial' : 'derived'
                  }
                />
              </>
            }
          >
            {isError ? (
              <PendingValue />
            ) : (
              <div className="text-[28px] font-extrabold tracking-tight text-foreground">
                {hasSyncedFinancials ? formatGbp(data!.totalContribution) : '£0'}
              </div>
            )}
          </HeroCard>

          <HeroCard
            tone="opp"
            question="2 · Opportunity in your database"
            subtitle={
              <>
                Unrealised contribution (prob-weighted)
                <br />
                Calculating &nbsp;
                <ProvenanceChip kind="pending" />
              </>
            }
          >
            <PendingValue />
          </HeroCard>

          <HeroCard
            tone="risk"
            question="3 · Value at risk"
            subtitle={
              <>
                Patient Contribution at Risk
                <span className="align-super text-[9px]">™</span>
                <br />
                Calculating &nbsp;
                <ProvenanceChip kind="pending" />
              </>
            }
          >
            <PendingValue />
          </HeroCard>

          <HeroCard
            tone="conv"
            question="4 · Conversion"
            subtitle={
              <>
                Commitment Rate
                <span className="align-super text-[9px]">™</span> (planned→scheduled 30d)
                <br />
                Calculating &nbsp;
                <ProvenanceChip kind="pending" />
              </>
            }
          >
            <PendingValue />
          </HeroCard>

          <HeroCard
            tone="qual"
            question="5 · Patient quality"
            subtitle={
              <>
                Avg annual contribution / projected LTV
                <br />
                Calculating &nbsp;
                <ProvenanceChip kind="pending" />
              </>
            }
          >
            <PendingValue />
          </HeroCard>
        </div>
      )}

      {!isError && (isLoading || hasSyncedFinancials) && (
        <RevenueMixCard
          isLoading={isLoading}
          revenuePrivate={data?.revenuePrivate ?? 0}
          revenuePlan={data?.revenuePlan ?? 0}
          revenueNhs={data?.revenueNhs ?? 0}
          udaDeliveryPct={data?.udaDeliveryPct ?? null}
          udaClawbackGbp={data?.udaClawbackGbp ?? null}
          udaOnTarget={data?.udaOnTarget ?? null}
          hasNhsContract={data?.hasNhsContract ?? false}
        />
      )}

      {!isError && <EconomicPulseBelowFold />}
    </>
  );
}

export default function EconomicPulse() {
  const [searchParams] = useSearchParams();
  const tab = searchParams.get('tab')?.trim().toLowerCase() ?? null;
  const isSettingsTab = tab === 'settings';
  const pending = tab && !isSettingsTab ? PENDING_TABS[tab] : null;
  const activeTab = tab && (PE_TAB_KEYS.has(tab) || tab === 'settings') ? tab : null;
  const pageTitle = isSettingsTab
    ? 'Settings · Patients · DentPulse'
    : pending
      ? `${pending.title} · Patients · DentPulse`
      : 'Economic Pulse · Patients · DentPulse';

  return (
    <MainLayout contentClassName="px-7 pb-[60px] pt-[5.5rem]">
      <Helmet>
        <title>{pageTitle}</title>
      </Helmet>

      <div className="w-full max-w-[1460px]">
        <PageChrome activeTab={activeTab} />
        <div className="space-y-4">
          {isSettingsTab ? (
            <PatientEconomicsSettingsTab />
          ) : pending ? (
            <PendingTabPanel title={pending.title} />
          ) : (
            <EconomicPulseHeroes />
          )}
        </div>
      </div>
    </MainLayout>
  );
}
