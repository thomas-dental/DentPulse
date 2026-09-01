import { useState } from 'react';
import { AlertCircle, ChevronDown, ChevronUp, Settings2, TrendingUp } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import {
  ProvenanceChip,
  tierToChip,
} from '@/components/patient-economics/ProvenanceChip';
import {
  LeverHeadroomByPracticeChart,
  CltvByAcquisitionSourceChart,
  formatGbp,
} from '@/components/patient-economics/GrowthLeversCharts';
import { useGrowthLeversSummary } from '@/hooks/useGrowthLeversSummary';
import {
  useGrowthLeversByPractice,
  type GrowthLeversPracticeRow,
} from '@/hooks/useGrowthLeversByPractice';
import { useCltvByAcquisitionSource } from '@/hooks/useCltvByAcquisitionSource';
import { useEconomicAssumptions } from '@/hooks/useEconomicAssumptions';
import { GrowthLeversSimulator } from '@/components/patient-economics/GrowthLeversSimulator';
import { PeSectionLabel } from '@/components/patient-economics/PeSectionLabel';
import {
  computeLeverYoYMetrics,
  computePatientEconomicValueGbp,
  computePracticeEconomicValueGbp,
  formatLeverDelta,
} from '@/lib/peGrowthLeversDisplay';
import { cn } from '@/lib/utils';
import { PE_CTX_BANNER_CLASS } from '@/lib/peVisualTokens';

type HeroTone = 'conv' | 'opp' | 'qual';

function HeroCard({
  tone = 'conv',
  question,
  value,
  subtitle,
  chip,
}: {
  tone?: HeroTone;
  question: string;
  value: React.ReactNode;
  subtitle: React.ReactNode;
  chip?: 'derived' | 'dentally' | 'modelled' | 'external' | 'pending';
}) {
  const bar =
    tone === 'opp'
      ? 'bg-[hsl(var(--chart-5))]'
      : tone === 'qual'
        ? 'bg-success'
        : 'bg-warning';

  const valueCls =
    tone === 'opp'
      ? 'text-[hsl(var(--chart-5))]'
      : tone === 'qual'
        ? 'text-success'
        : 'text-warning';

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
}: {
  title: string;
  subtitle: string;
  chip?: 'derived' | 'dentally' | 'modelled' | 'external' | 'pending';
  children: React.ReactNode;
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
    </div>
  );
}

function formatVisitFrequency(value: number | null): string {
  if (value == null) return '—';
  return value.toFixed(1);
}

function formatYears(value: number | null): string {
  if (value == null) return '—';
  return value.toFixed(1);
}

type PracticeSortKey =
  | 'practiceName'
  | 'visitFrequency'
  | 'valuePerVisit'
  | 'economicValue'
  | 'tenureYears'
  | 'combinedHeadroomPct';

function practiceSortValue(row: GrowthLeversPracticeRow, key: PracticeSortKey): string | number | null {
  if (key === 'economicValue') return computePracticeEconomicValueGbp(row);
  return row[key];
}

function sortPracticeRows(
  rows: GrowthLeversPracticeRow[],
  key: PracticeSortKey,
  dir: 'asc' | 'desc',
): GrowthLeversPracticeRow[] {
  const mul = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = practiceSortValue(a, key);
    const bv = practiceSortValue(b, key);
    if (typeof av === 'string' && typeof bv === 'string') {
      return mul * av.localeCompare(bv, 'en-GB');
    }
    const an = av == null ? Number.NEGATIVE_INFINITY : Number(av);
    const bn = bv == null ? Number.NEGATIVE_INFINITY : Number(bv);
    if (an === bn) return mul * a.practiceName.localeCompare(b.practiceName, 'en-GB');
    return mul * (an - bn);
  });
}

function SortHeader({
  label,
  active,
  dir,
  onClick,
  className,
}: {
  label: string;
  active: boolean;
  dir: 'asc' | 'desc';
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 text-left text-[12px] font-semibold hover:text-foreground',
        active ? 'text-foreground' : 'text-muted-foreground',
        className,
      )}
    >
      {label}
      {active && (dir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
    </button>
  );
}

export function GrowthLevers() {
  const summaryQuery = useGrowthLeversSummary();
  const byPracticeQuery = useGrowthLeversByPractice();
  const cltvQuery = useCltvByAcquisitionSource();
  const assumptionsQuery = useEconomicAssumptions();

  const { data, isLoading, isError, error, refetch, isFetching } = summaryQuery;

  const isEmpty =
    !!data &&
    !data.hasAppointmentData &&
    !data.hasRevenueData &&
    !data.hasTenureData &&
    !isLoading;

  const yoyMetrics =
    data != null
      ? computeLeverYoYMetrics(data.monthly, data.trailingMonths, data.activePatientCount)
      : { visitFrequencyDelta: null, valuePerVisitPctChange: null };

  const assumptions = assumptionsQuery.data;
  const groupBenchmarks = byPracticeQuery.data?.groupBenchmarks;
  const rollupUnitLabel =
    byPracticeQuery.data?.rollupMode === 'location' ? 'location' : 'practice';

  const targetVisitFrequency =
    assumptions?.growthLeversTargetVisitFrequency ?? groupBenchmarks?.visitFrequency ?? null;
  const targetValuePerVisit =
    assumptions?.growthLeversTargetValuePerVisit ?? groupBenchmarks?.valuePerVisit ?? null;

  const heroEconomicValue =
    data != null
      ? computePatientEconomicValueGbp(
          data.visitFrequency,
          data.valuePerVisit,
          data.projectedLifetimeYears,
          data.tenureYears,
        )
      : null;

  const visitFreqDelta = formatLeverDelta(yoyMetrics.visitFrequencyDelta, 'freq');
  const valuePerVisitDelta = formatLeverDelta(yoyMetrics.valuePerVisitPctChange, 'pct');

  const [sortKey, setSortKey] = useState<PracticeSortKey>('combinedHeadroomPct');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const practiceRows = sortPracticeRows(
    byPracticeQuery.data?.practices ?? [],
    sortKey,
    sortDir,
  );

  function toggleSort(key: PracticeSortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'practiceName' ? 'asc' : 'desc');
    }
  }

  return (
    <div className="space-y-4">
      <div className={cn(PE_CTX_BANNER_CLASS, 'mb-0')}>
        <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <span>
          Patient value has three levers: how <strong>often</strong> patients visit, how{' '}
          <strong>much</strong> each visit is worth, and how <strong>long</strong> they stay.{' '}
          <strong>
            Visit Frequency × Value per Visit × Patient Lifetime → Patient Economic Value.
          </strong>{' '}
          They multiply, they don&apos;t add.
        </span>
      </div>

      {isError && (
        <div className="flex flex-wrap items-start gap-3 rounded-[10px] border border-danger/30 bg-danger-muted px-4 py-3 text-sm text-danger-strong">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="flex-1">
            <div className="font-semibold">Couldn&apos;t load Growth Levers</div>
            <div className="mt-0.5 text-danger-strong/80">
              {error instanceof Error ? error.message : 'Summary query failed.'}
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            Retry
          </Button>
        </div>
      )}

      {isEmpty && !isError && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-primary/20 bg-gradient-to-r from-primary/[0.08] to-primary/[0.02] px-4 py-3 text-sm">
          <div>
            <div className="font-semibold text-foreground">No synced visit or revenue data yet</div>
            <div className="mt-0.5 text-muted-foreground">
              Connect Dentally and run Patient Economics sync so appointments and invoices can feed
              Growth Levers.
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

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-[120px] rounded-[14px]" />
          ))
        ) : isError ? null : (
          <>
            <HeroCard
              tone="conv"
              question="Lever 1 · Visit Frequency"
              value={
                <>
                  {formatVisitFrequency(data?.visitFrequency ?? null)}
                  {data?.visitFrequency != null && (
                    <span className="text-[14px] font-semibold text-muted-foreground">/yr</span>
                  )}
                </>
              }
              subtitle={
                <>
                  Chargeable visits per active patient
                  <br />
                  {visitFreqDelta && (
                    <span className="font-semibold text-success-strong">{visitFreqDelta}</span>
                  )}
                  {visitFreqDelta ? ' vs prior yr' : 'Prior yr comparison unavailable'}
                  {targetVisitFrequency != null && (
                    <>
                      {' · '}
                      target {targetVisitFrequency.toFixed(1)}
                    </>
                  )}
                  {' '}
                  <ProvenanceChip kind={tierToChip(data?.visitFrequencyTier)} />
                </>
              }
            />
            <HeroCard
              tone="opp"
              question="Lever 2 · Value per Visit"
              value={data?.valuePerVisit != null ? formatGbp(data.valuePerVisit) : '—'}
              subtitle={
                <>
                  Avg contribution-bearing value per visit
                  <br />
                  {valuePerVisitDelta && (
                    <span className="font-semibold text-success-strong">{valuePerVisitDelta}</span>
                  )}
                  {valuePerVisitDelta ? '' : 'Prior yr comparison unavailable'}
                  {targetValuePerVisit != null && (
                    <>
                      {valuePerVisitDelta ? ' · ' : ' · '}
                      target {formatGbp(targetValuePerVisit)}
                    </>
                  )}
                  {' '}
                  <ProvenanceChip kind={tierToChip(data?.valuePerVisitTier)} />
                </>
              }
            />
            <HeroCard
              tone="qual"
              question="Lever 3 · Patient Retention / Lifetime"
              value={
                <>
                  {formatYears(data?.tenureYears ?? null)}
                  {data?.tenureYears != null && (
                    <span className="text-[14px] font-semibold text-muted-foreground"> yrs</span>
                  )}
                </>
              }
              subtitle={
                <>
                  Current avg tenure{' '}
                  <ProvenanceChip kind={tierToChip(data?.tenureTier)} />
                  <br />
                  Projected lifetime{' '}
                  {data?.projectedLifetimeYears != null
                    ? `${data.projectedLifetimeYears.toFixed(1)} yrs`
                    : '—'}
                  {heroEconomicValue != null && (
                    <>
                      {' · '}
                      Economic Value {formatGbp(heroEconomicValue)}
                    </>
                  )}
                  {' '}
                  <ProvenanceChip kind={tierToChip(data?.projectedLifetimeTier)} />
                </>
              }
            />
          </>
        )}
      </div>

      <GrowthLeversSimulator />

      <PeSectionLabel>Where the headroom is</PeSectionLabel>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title={`Lever headroom by ${rollupUnitLabel}`}
          subtitle="Gap to target on each lever · darker = more room to grow"
        >
          {byPracticeQuery.isLoading ? (
            <Skeleton className="h-[180px] w-full" />
          ) : byPracticeQuery.isError ? (
            <div className="flex items-start gap-2 py-6 text-sm text-danger-strong">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-semibold">Could not load practice headroom</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => byPracticeQuery.refetch()}
                >
                  Retry
                </Button>
              </div>
            </div>
          ) : (
            <LeverHeadroomByPracticeChart rows={practiceRows} />
          )}
        </ChartCard>

        <ChartCard
          title="CLTV™ by acquisition source"
          subtitle="Not all patients are worth the same over a lifetime"
        >
          {cltvQuery.isLoading ? (
            <Skeleton className="h-[180px] w-full" />
          ) : cltvQuery.isError ? (
            <div className="flex items-start gap-2 py-6 text-sm text-danger-strong">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-semibold">Could not load CLTV by source</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => cltvQuery.refetch()}
                >
                  Retry
                </Button>
              </div>
            </div>
          ) : (
            <>
              <CltvByAcquisitionSourceChart rows={cltvQuery.data?.sources ?? []} />
              <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
                Referred and membership patients carry the highest lifetime contribution.
                CAC-adjusted view arrives with attribution in the next version.
              </p>
            </>
          )}
        </ChartCard>
      </div>

      <div className="rounded-[14px] border border-border bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-4">
          <div>
            <h2 className="text-[15px] font-bold tracking-tight text-foreground">
              Growth levers by {rollupUnitLabel}
            </h2>
            <p className="mt-1 text-[12.5px] text-muted-foreground">
              Visit Frequency, Value per Visit and Economic Value side by side, ranked by combined
              headroom
            </p>
          </div>
          <span className="rounded-full bg-primary/12 px-2.5 py-0.5 text-[11px] font-semibold text-primary">
            Multi-practice view
          </span>
        </div>

        {byPracticeQuery.isLoading ? (
          <div className="p-5 space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : byPracticeQuery.isError ? (
          <div className="flex items-start gap-2 px-5 py-8 text-sm text-danger-strong">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-semibold">Could not load practice table</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => byPracticeQuery.refetch()}
              >
                Retry
              </Button>
            </div>
          </div>
        ) : practiceRows.length === 0 ? (
          <p className="px-5 py-8 text-sm text-muted-foreground">
            Join additional practices (user_roles) to compare growth levers across your group.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-4 py-3 text-left">
                    <SortHeader
                      label={rollupUnitLabel === 'location' ? 'Location' : 'Practice'}
                      active={sortKey === 'practiceName'}
                      dir={sortDir}
                      onClick={() => toggleSort('practiceName')}
                    />
                  </th>
                  <th className="px-3 py-3 text-right">
                    <SortHeader
                      label="Visit freq /yr"
                      active={sortKey === 'visitFrequency'}
                      dir={sortDir}
                      onClick={() => toggleSort('visitFrequency')}
                      className="justify-end"
                    />
                  </th>
                  <th className="px-3 py-3 text-right">
                    <SortHeader
                      label="Value/visit"
                      active={sortKey === 'valuePerVisit'}
                      dir={sortDir}
                      onClick={() => toggleSort('valuePerVisit')}
                      className="justify-end"
                    />
                  </th>
                  <th className="px-3 py-3 text-right">
                    <SortHeader
                      label="Economic value"
                      active={sortKey === 'economicValue'}
                      dir={sortDir}
                      onClick={() => toggleSort('economicValue')}
                      className="justify-end"
                    />
                  </th>
                  <th className="px-3 py-3 text-right">
                    <SortHeader
                      label="Avg tenure"
                      active={sortKey === 'tenureYears'}
                      dir={sortDir}
                      onClick={() => toggleSort('tenureYears')}
                      className="justify-end"
                    />
                  </th>
                  <th className="px-3 py-3 text-right">
                    <SortHeader
                      label="Combined headroom"
                      active={sortKey === 'combinedHeadroomPct'}
                      dir={sortDir}
                      onClick={() => toggleSort('combinedHeadroomPct')}
                      className="justify-end"
                    />
                  </th>
                  <th className="px-4 py-3 text-left text-[12px] font-semibold text-muted-foreground">
                    Top lever to pull
                  </th>
                </tr>
              </thead>
              <tbody>
                {practiceRows.map((row) => (
                  <tr
                    key={row.practiceId}
                    className="border-b border-border/60 last:border-0 hover:bg-primary/[0.04]"
                  >
                    <td className="px-4 py-3 font-semibold text-foreground">{row.practiceName}</td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {row.visitFrequency != null ? row.visitFrequency.toFixed(1) : '—'}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {row.valuePerVisit != null ? formatGbp(row.valuePerVisit) : '—'}
                    </td>
                    <td className="px-3 py-3 text-right font-bold tabular-nums text-foreground">
                      {(() => {
                        const ev = computePracticeEconomicValueGbp(row);
                        return ev != null ? formatGbp(ev) : '—';
                      })()}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {row.tenureYears != null ? `${row.tenureYears.toFixed(1)} yrs` : '—'}
                    </td>
                    <td className="px-3 py-3 text-right">
                      {row.combinedHeadroomPct != null ? (
                        <span
                          className={cn(
                            'inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold tabular-nums',
                            row.combinedHeadroomPct >= 55
                              ? 'border-danger/30 bg-danger-muted text-danger-strong'
                              : row.combinedHeadroomPct >= 30
                                ? 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200'
                                : 'border-success/30 bg-success-muted text-success-strong',
                          )}
                        >
                          {Math.round(row.combinedHeadroomPct)}%
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {row.topLeverToPull ? (
                        <span className="inline-flex rounded-full bg-primary/12 px-2.5 py-0.5 text-[11px] font-semibold text-primary">
                          {row.topLeverToPull}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
