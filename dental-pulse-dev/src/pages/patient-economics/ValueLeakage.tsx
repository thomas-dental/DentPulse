/**
 * Value & Leakage — full screen per mockup v5.1 (#leakage panel).
 */

import { useState, type ReactNode } from 'react';
import { AlertCircle, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import {
  ProvenanceChip,
  tierToChip,
  type ProvenanceKind,
} from '@/components/patient-economics/ProvenanceChip';
import {
  ClinicianCommitmentChart,
  formatGbpCompact,
  formatGbpWhole,
  JourneyWaterfallDetailedChart,
  OpportunityGrossVsWeightedChart,
  WindowCommitmentChart,
} from '@/components/patient-economics/ValueLeakageCharts';
import { useTreatmentEconomicJourney } from '@/hooks/useTreatmentEconomicJourney';
import { useValueLeakageSummary } from '@/hooks/useValueLeakageSummary';
import {
  usePlannedUnscheduledLeakage,
  type PlannedUnscheduledLeakageRow,
} from '@/hooks/usePlannedUnscheduledLeakage';
import { cn } from '@/lib/utils';
import {
  PE_TABLE_BODY_CELL_CLASS,
  PE_TABLE_HEAD_CELL_CLASS,
  PE_TABLE_ROW_CLASS,
} from '@/lib/peVisualTokens';

type HeroTone = 'default' | 'opp' | 'risk' | 'conv';

function formatGbp(value: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    maximumFractionDigits: value >= 1000 ? 0 : 2,
  }).format(value);
}

function formatPct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

function HeroCard({
  tone = 'default',
  valueTone,
  question,
  value,
  subtitle,
  chip,
}: {
  tone?: HeroTone;
  /** Override value colour — mockup uses primary on probability-weighted hero. */
  valueTone?: 'default' | 'primary' | 'muted';
  question: string;
  value: string;
  subtitle: ReactNode;
  chip?: ProvenanceKind;
}) {
  const bar =
    tone === 'opp'
      ? 'bg-[hsl(var(--chart-5))]'
      : tone === 'risk'
        ? 'bg-danger'
        : tone === 'conv'
          ? 'bg-warning'
          : 'bg-primary';

  const valueCls =
    valueTone === 'primary'
      ? 'text-primary'
      : valueTone === 'muted'
        ? 'text-muted-foreground'
        : tone === 'opp'
          ? 'text-foreground'
          : tone === 'risk'
            ? 'text-danger-strong'
            : tone === 'conv'
              ? 'text-warning'
              : 'text-foreground';

  return (
    <div className="relative overflow-hidden rounded-[14px] border border-border bg-card px-4 py-4 pb-[15px] shadow-sm">
      <div className={cn('absolute inset-x-0 top-0 h-[3px]', bar)} />
      <div className="mb-[9px] min-h-[26px] text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
        {question}
      </div>
      <div className={cn('text-[28px] font-extrabold tracking-tight', valueCls)}>{value}</div>
      <div className="mt-2 text-[11.5px] leading-relaxed text-muted-foreground">
        {subtitle}
        {chip && (
          <>
            {' '}
            <ProvenanceChip kind={chip} />
          </>
        )}
      </div>
    </div>
  );
}

function ChartCard({
  title,
  subtitle,
  chip,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  chip?: ProvenanceKind;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="rounded-[14px] border border-border bg-card shadow-sm">
      <div className="border-b border-border px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[15px] font-bold tracking-tight text-foreground">{title}</h2>
          {chip && <ProvenanceChip kind={chip} />}
        </div>
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{subtitle}</p>
      </div>
      <div className="px-5 py-4">{children}</div>
      {footer && (
        <div className="border-t border-border/60 px-5 py-3 text-[12px] leading-relaxed text-muted-foreground">
          {footer}
        </div>
      )}
    </div>
  );
}

type LeakageSortKey = 'treatmentValue' | 'daysUnscheduled' | 'patientName';

function LeakageTable({
  rows,
  thresholdDays,
  sortKey,
  sortDir,
  onSort,
}: {
  rows: PlannedUnscheduledLeakageRow[];
  thresholdDays: number;
  sortKey: LeakageSortKey;
  sortDir: 'asc' | 'desc';
  onSort: (key: LeakageSortKey) => void;
}) {
  const SortIcon = ({ keyName }: { keyName: LeakageSortKey }) => {
    if (sortKey !== keyName) return null;
    return sortDir === 'asc' ? (
      <ChevronUp className="ml-1 inline h-3.5 w-3.5" />
    ) : (
      <ChevronDown className="ml-1 inline h-3.5 w-3.5" />
    );
  };

  const headerBtn = (key: LeakageSortKey, label: string, alignRight = false) => (
    <button
      type="button"
      onClick={() => onSort(key)}
      className={cn(
        'inline-flex items-center text-[12px] font-semibold text-muted-foreground hover:text-foreground',
        alignRight && 'justify-end w-full',
      )}
    >
      {label}
      <SortIcon keyName={key} />
    </button>
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-border">
            <th className={cn(PE_TABLE_HEAD_CELL_CLASS, 'text-left')}>
              {headerBtn('patientName', 'Patient')}
            </th>
            <th className={cn(PE_TABLE_HEAD_CELL_CLASS, 'text-right')}>
              {headerBtn('treatmentValue', 'Treatment value', true)}
            </th>
            <th className={cn(PE_TABLE_HEAD_CELL_CLASS, 'text-right')}>
              {headerBtn('daysUnscheduled', 'Days unscheduled', true)}
            </th>
            <th className={cn(PE_TABLE_HEAD_CELL_CLASS, 'text-right')}>Plan</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={`${row.planId}-${row.tpiId ?? 'x'}`}
              className={PE_TABLE_ROW_CLASS}
            >
              <td className={cn(PE_TABLE_BODY_CELL_CLASS, 'font-semibold text-foreground')}>
                <Link
                  to={`/patients?tab=patient-records&patientId=${encodeURIComponent(row.patientId)}`}
                  className="text-primary hover:underline"
                >
                  {row.patientName}
                </Link>
              </td>
              <td className={cn(PE_TABLE_BODY_CELL_CLASS, 'text-right font-bold tabular-nums text-danger-strong')}>
                {formatGbp(row.treatmentValue)}
              </td>
              <td className={cn(PE_TABLE_BODY_CELL_CLASS, 'text-right tabular-nums')}>
                <span
                  className={cn(
                    'inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold',
                    row.daysUnscheduled > thresholdDays + 30
                      ? 'border-danger/30 bg-danger-muted text-danger-strong'
                      : 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200',
                  )}
                >
                  {row.daysUnscheduled}d
                </span>
              </td>
              <td className={cn(PE_TABLE_BODY_CELL_CLASS, 'text-right text-[12px] text-muted-foreground tabular-nums')}>
                #{row.planId}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const DEFAULT_OPPORTUNITY_CATEGORIES = [
  { category: 'Whitening', gross: 0, weighted: 0 },
  { category: 'Implant', gross: 0, weighted: 0 },
  { category: 'Ortho', gross: 0, weighted: 0 },
  { category: 'Other', gross: 0, weighted: 0 },
];

export function ValueLeakage() {
  const summaryQuery = useValueLeakageSummary();
  const leakageQuery = usePlannedUnscheduledLeakage();
  const journeyQuery = useTreatmentEconomicJourney();

  const summary = summaryQuery.data;
  const leakage = leakageQuery.data;
  const journey = journeyQuery.data;

  const thresholdDays = leakage?.thresholdDays ?? 60;
  const leakageRows = leakage?.rows ?? [];
  const opportunityCategories =
    summary?.opportunityByCategory?.length
      ? summary.opportunityByCategory
      : DEFAULT_OPPORTUNITY_CATEGORIES;

  const [sortKey, setSortKey] = useState<LeakageSortKey>('treatmentValue');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [showWorklist, setShowWorklist] = useState(false);

  const sortedLeakageRows = [...leakageRows].sort((a, b) => {
    let cmp = 0;
    if (sortKey === 'treatmentValue') cmp = a.treatmentValue - b.treatmentValue;
    else if (sortKey === 'daysUnscheduled') cmp = a.daysUnscheduled - b.daysUnscheduled;
    else cmp = a.patientName.localeCompare(b.patientName);
    return sortDir === 'asc' ? cmp : -cmp;
  });

  function onLeakageSort(key: LeakageSortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'patientName' ? 'asc' : 'desc');
    }
  }

  const heroesLoading = summaryQuery.isLoading || leakageQuery.isLoading;
  const heroesError = summaryQuery.isError && leakageQuery.isError;

  const leakageFooter =
    leakage && leakage.totalValueAtRisk > 0 ? (
      <>
        {formatGbpCompact(leakage.totalValueAtRisk)} of private treatment was planned more than{' '}
        {thresholdDays} days ago and has neither a linked appointment nor completion
        {leakage.contributionOpportunity != null ? (
          <>
            , est.{' '}
            <strong className="font-bold text-foreground">
              {formatGbpCompact(leakage.contributionOpportunity)}
            </strong>{' '}
            contribution opportunity.
          </>
        ) : (
          '.'
        )}
      </>
    ) : (
      <>No private treatment sitting unscheduled beyond the {thresholdDays}-day threshold.</>
    );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {heroesLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[120px] rounded-[14px]" />
          ))
        ) : heroesError ? (
          <div className="col-span-full rounded-[14px] border border-danger/20 bg-danger-muted/40 px-5 py-4 text-sm text-danger-strong">
            Could not load Value & Leakage summary. Try refreshing the page.
          </div>
        ) : (
          <>
            <HeroCard
              tone="opp"
              question="Gross opportunity"
              value={formatGbpCompact(summary?.opportunityGross ?? 0)}
              subtitle="Unrealised treatment contribution"
              chip={tierToChip(summary?.opportunityGrossTier)}
            />
            <HeroCard
              valueTone="primary"
              question="Probability-weighted"
              value={formatGbpCompact(summary?.opportunityWeighted ?? 0)}
              subtitle="After conversion probability"
              chip={tierToChip(summary?.opportunityWeightedTier)}
            />
            <HeroCard
              tone="conv"
              question="Commitment rate · 30d"
              value={formatPct(summary?.commitmentRate30d ?? 0)}
              subtitle="Planned → future appt scheduled"
              chip={tierToChip(summary?.commitmentRate30dTier)}
            />
            <HeroCard
              tone="risk"
              question={`Planned > ${thresholdDays}d, unscheduled`}
              value={formatGbpCompact(leakage?.totalValueAtRisk ?? 0)}
              subtitle="No appointment linked yet"
              chip="derived"
            />
          </>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <ChartCard
          title="Treatment Economic Journey™ · detailed"
          subtitle="£ retained and lost at each stage · Dentally events and transparent derivations"
          chip="derived"
        >
          {journeyQuery.isLoading ? (
            <Skeleton className="h-[230px] w-full" />
          ) : journeyQuery.isError ? (
            <div className="flex items-start gap-2 py-6 text-sm text-danger-strong">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-semibold">Could not load journey chart</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => journeyQuery.refetch()}
                >
                  Retry
                </Button>
              </div>
            </div>
          ) : journey?.isBackfilling ? (
            <p className="py-8 text-center text-[13px] text-muted-foreground">
              Too little event history to chart the journey yet. Sync more Dentally ledger events.
            </p>
          ) : journey?.stages?.length ? (
            <>
              <JourneyWaterfallDetailedChart stages={journey.stages} />
              <div className="mt-3 flex flex-wrap gap-4 text-[12px] text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm bg-primary" />
                  Retained
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm bg-danger/60" />
                  Leaked at stage
                </span>
              </div>
            </>
          ) : (
            <p className="py-8 text-center text-[13px] text-muted-foreground">
              No journey stages available yet.
            </p>
          )}
        </ChartCard>

        <ChartCard
          title="Opportunity, gross vs weighted"
          subtitle="Never collapse the two into one number"
          chip="modelled"
        >
          {summaryQuery.isLoading ? (
            <Skeleton className="h-[200px] w-full" />
          ) : summaryQuery.isError ? (
            <p className="py-8 text-center text-[13px] text-muted-foreground">
              Opportunity breakdown unavailable.
            </p>
          ) : (
            <OpportunityGrossVsWeightedChart rows={opportunityCategories} />
          )}
        </ChartCard>
      </div>

      <div>
        <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.08em] text-primary">
          Commitment Intelligence™
        </div>
        <div className="mb-4 flex flex-wrap items-start gap-3 rounded-[10px] border border-amber-500/25 bg-amber-500/5 px-4 py-3 text-[12.5px] leading-relaxed text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" />
          <span>
            <b className="text-foreground">Present-state commitment is robust</b> (a planned course
            either has a future linked appointment or it doesn&apos;t).{' '}
            <b className="text-foreground">Historical time-window rates</b> (7/30/60d) need
            DentPulse to snapshot booking events daily to build its own booking history, since a
            clean booked-at timestamp isn&apos;t guaranteed from the API. Shown here where event
            history is sufficient; flagged for developer validation.
          </span>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard
            title="Treatment Commitment Rate™ by clinician"
            subtitle={`Planned → future appointment within ${summary?.clinicianWindowDays ?? 30} days`}
            chip="derived"
          >
            {summaryQuery.isLoading ? (
              <Skeleton className="h-[180px] w-full" />
            ) : summaryQuery.isError ? (
              <div className="flex items-start gap-2 py-6 text-sm text-danger-strong">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-semibold">Could not load clinician breakdown</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    onClick={() => summaryQuery.refetch()}
                  >
                    Retry
                  </Button>
                </div>
              </div>
            ) : (
              <>
                {summary?.hasUnattributedPlanItems && (
                  <div className="mb-3 flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
                    <ProvenanceChip kind="partial_no_practitioner" />
                    {formatGbpWhole(summary.unattributedEligibleValue)} eligible on plan items
                    without clinician attribution.
                  </div>
                )}
                <ClinicianCommitmentChart rows={summary?.byClinician ?? []} />
              </>
            )}
          </ChartCard>

          <ChartCard
            title="Commitment by time window"
            subtitle="How quickly planned treatment progresses to a booking"
            chip="derived"
            footer={leakageFooter}
          >
            {summaryQuery.isLoading ? (
              <Skeleton className="h-[180px] w-full" />
            ) : summaryQuery.isError ? (
              <p className="py-8 text-center text-[13px] text-muted-foreground">
                Window breakdown unavailable.
              </p>
            ) : (
              <WindowCommitmentChart rows={summary?.byWindow ?? []} />
            )}
          </ChartCard>
        </div>
      </div>

      {leakageRows.length > 0 && (
        <div className="rounded-[14px] border border-border bg-card shadow-sm">
          <button
            type="button"
            onClick={() => setShowWorklist((v) => !v)}
            className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
          >
            <div>
              <h2 className="text-[15px] font-bold text-foreground">
                Patient worklist · planned &gt; {thresholdDays}d unscheduled
              </h2>
              <p className="mt-1 text-[12.5px] text-muted-foreground">
                {leakageRows.length} private item(s) · commercial leakage risk
              </p>
            </div>
            {showWorklist ? (
              <ChevronUp className="h-5 w-5 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-5 w-5 text-muted-foreground" />
            )}
          </button>
          {showWorklist && (
            <div className="border-t border-border">
              {leakageQuery.isError && (
                <div className="flex flex-wrap items-start gap-3 border-b border-danger/20 bg-danger-muted/40 px-5 py-4 text-sm text-danger-strong">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => leakageQuery.refetch()}
                  >
                    Retry
                  </Button>
                </div>
              )}
              <LeakageTable
                rows={sortedLeakageRows}
                thresholdDays={thresholdDays}
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={onLeakageSort}
              />
            </div>
          )}
        </div>
      )}

      {summary?.tierNote && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {summary.tierNote} Weighted opportunity uses{' '}
          <code className="text-[10px]">commitment_rate_window_days</code> (default 30) from Goal
          Settings; leakage threshold via{' '}
          <code className="text-[10px]">leakage_unscheduled_threshold_days</code> (default 60).
        </p>
      )}
    </div>
  );
}
