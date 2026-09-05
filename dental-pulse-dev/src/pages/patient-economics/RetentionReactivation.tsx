/**
 * Retention & Reactivation — mockup v5.1 layout.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { AlertCircle, ChevronLeft, ChevronRight, Search, Settings2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { PeChartSkeleton, PeHeroCard } from '@/components/patient-economics/PeHeroCard';
import type { ReactivationWorklistRow } from '@/services/integrations/patientEconomicsService';
import {
  ContributionAtRiskBySegmentChart,
  RecoveryLoopFunnelChart,
  ReactivationValueByPracticeChart,
  ReactivationWorklistTable,
  formatGbp,
  formatGbpCompact,
  type WorklistSortKey,
} from '@/components/patient-economics/RetentionReactivationCharts';
import {
  segmentContributionByStatus,
  useRetentionContributionAtRisk,
  type RetentionContributionAtRisk,
} from '@/hooks/useRetentionContributionAtRisk';
import { useRetentionRecoveryLoop } from '@/hooks/useRetentionRecoveryLoop';
import { usePeScopedRead } from '@/hooks/usePeScopedRead';
import { useEconomicAssumptions } from '@/hooks/useEconomicAssumptions';
import { peReadPending } from '@/lib/peReadLoading';
import {
  PE_RETENTION_SEGMENT_ORDER,
  retentionStatusLabel,
  type PeRetentionStatus,
} from '@/lib/peRetentionConstants';
import { cn } from '@/lib/utils';
import { PE_CTX_BANNER_CLASS } from '@/lib/peVisualTokens';

type RetentionHeroTone = 'default' | 'conv' | 'risk';

const RETENTION_HERO_SUBTITLES: Record<PeRetentionStatus, string> = {
  active: 'Seen within recall window',
  drifting: 'Approaching lapse',
  lapsed: 'Contribution at risk',
  effectively_lost: 'No realistic recovery',
};

const RETENTION_HERO_TONES: Record<PeRetentionStatus, RetentionHeroTone> = {
  active: 'default',
  drifting: 'conv',
  lapsed: 'risk',
  effectively_lost: 'default',
};

function RetentionHeroGrid({
  data,
  multiPractice,
  pending = false,
}: {
  data: RetentionContributionAtRisk;
  multiPractice: boolean;
  pending?: boolean;
}) {
  const rollup = multiPractice ? data.group : data.practice;
  const byStatus = segmentContributionByStatus(rollup);

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      {PE_RETENTION_SEGMENT_ORDER.map((status) => {
        const seg = byStatus.get(status);
        const count = seg?.patientCount ?? 0;
        const subtitle =
          status === 'lapsed' && seg
            ? `${formatGbpCompact(seg.contributionGbp)} contribution at risk`
            : RETENTION_HERO_SUBTITLES[status];

        return (
          <PeHeroCard
            key={status}
            tone={RETENTION_HERO_TONES[status]}
            pending={pending}
            question={retentionStatusLabel(status)}
            value={count.toLocaleString('en-GB')}
            subtitle={subtitle}
          />
        );
      })}
    </div>
  );
}

function FilterChip({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition-colors',
        active
          ? 'border-primary/30 bg-primary/12 text-primary'
          : 'border-border bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      {label}
    </button>
  );
}

type WorklistStatusFilter = 'all' | ReactivationWorklistRow['workflowStatus'];
type WorklistOwnerFilter = 'all' | 'unassigned' | 'assigned';

const WORKLIST_STATUS_FILTERS: { key: WorklistStatusFilter; label: string }[] = [
  { key: 'all', label: 'All statuses' },
  { key: 'new', label: 'New' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'booked', label: 'Booked' },
];

const WORKLIST_OWNER_FILTERS: { key: WorklistOwnerFilter; label: string }[] = [
  { key: 'all', label: 'All owners' },
  { key: 'unassigned', label: 'Unassigned' },
  { key: 'assigned', label: 'Assigned' },
];

const WORKLIST_PAGE_SIZE_OPTIONS = [5, 10, 25, 50, 100];

const WORKLIST_STATUS_SORT_ORDER: Record<ReactivationWorklistRow['workflowStatus'], number> = {
  new: 0,
  contacted: 1,
  booked: 2,
  recovered: 3,
};

function sortWorklistRows(
  rows: ReactivationWorklistRow[],
  key: WorklistSortKey,
  dir: 'asc' | 'desc',
): ReactivationWorklistRow[] {
  const mul = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    let cmp = 0;
    switch (key) {
      case 'patientName':
        cmp = a.patientName.localeCompare(b.patientName, 'en-GB');
        break;
      case 'practiceName':
        cmp = (a.practiceName ?? '').localeCompare(b.practiceName ?? '', 'en-GB');
        break;
      case 'lastVisitAt': {
        const at = a.lastVisitAt ? Date.parse(a.lastVisitAt) : Number.NEGATIVE_INFINITY;
        const bt = b.lastVisitAt ? Date.parse(b.lastVisitAt) : Number.NEGATIVE_INFINITY;
        cmp = at - bt;
        break;
      }
      case 'daysOverdue':
        cmp = a.daysOverdue - b.daysOverdue;
        break;
      case 'histContributionYr':
        cmp = a.histContributionYr - b.histContributionYr;
        break;
      case 'contributionAtRiskAtFlagTime':
        cmp = a.contributionAtRiskAtFlagTime - b.contributionAtRiskAtFlagTime;
        break;
      case 'ownerName': {
        const ao = a.ownerName?.trim() || 'Unassigned';
        const bo = b.ownerName?.trim() || 'Unassigned';
        cmp = ao.localeCompare(bo, 'en-GB');
        break;
      }
      case 'workflowStatus':
        cmp =
          WORKLIST_STATUS_SORT_ORDER[a.workflowStatus] -
          WORKLIST_STATUS_SORT_ORDER[b.workflowStatus];
        break;
    }
    if (cmp === 0 && key !== 'contributionAtRiskAtFlagTime') {
      cmp = b.contributionAtRiskAtFlagTime - a.contributionAtRiskAtFlagTime;
    }
    return mul * cmp;
  });
}

function SimpleChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-[14px] border border-border bg-card shadow-sm">
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-[15px] font-bold tracking-tight text-foreground">{title}</h2>
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{subtitle}</p>
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}

export function RetentionReactivation() {
  const { scopeKey } = usePeScopedRead();
  const [worklistSearch, setWorklistSearch] = useState('');
  const [worklistStatusFilter, setWorklistStatusFilter] = useState<WorklistStatusFilter>('all');
  const [worklistOwnerFilter, setWorklistOwnerFilter] = useState<WorklistOwnerFilter>('all');
  const [worklistHighValueOnly, setWorklistHighValueOnly] = useState(false);
  const [worklistPage, setWorklistPage] = useState(1);
  const [worklistPageSize, setWorklistPageSize] = useState(5);
  const [worklistSortKey, setWorklistSortKey] =
    useState<WorklistSortKey>('contributionAtRiskAtFlagTime');
  const [worklistSortDir, setWorklistSortDir] = useState<'asc' | 'desc'>('desc');

  const atRiskQuery = useRetentionContributionAtRisk();
  const recoveryQuery = useRetentionRecoveryLoop();
  const assumptionsQuery = useEconomicAssumptions();

  const { data, isError, error, refetch, isFetching } = atRiskQuery;
  const atRiskPending = peReadPending(atRiskQuery);
  const recoveryPending = peReadPending(recoveryQuery);
  const multiPractice = (data?.group.practiceCount ?? 0) > 1;
  const segmentRollup = data ? (multiPractice ? data.group : data.practice) : null;

  const recoveryData = recoveryQuery.data;
  const rollupUnitLabel =
    recoveryData?.rollupMode === 'location' || data?.rollupMode === 'location'
      ? 'location'
      : 'practice';
  const recoveryPractice = recoveryData?.practice;
  const recoveryGroup = recoveryData?.group;
  const recoveryRollup =
    multiPractice && recoveryGroup ? recoveryGroup : recoveryPractice;
  const worklistRows = multiPractice
    ? recoveryGroup?.openWorklist ?? []
    : recoveryPractice?.openWorklist ?? [];

  const highValueThreshold =
    assumptionsQuery.data?.reactivationHighValueAtRiskGbp ?? 500;
  const highValueOverdueCount = worklistRows.filter(
    (r) => r.histContributionYr >= highValueThreshold,
  ).length;

  const worklistHasActiveFilters =
    worklistSearch.trim() !== '' ||
    worklistStatusFilter !== 'all' ||
    worklistOwnerFilter !== 'all' ||
    worklistHighValueOnly;

  const filteredWorklistRows = useMemo(() => {
    const q = worklistSearch.trim().toLowerCase();
    return worklistRows.filter((row) => {
      if (worklistStatusFilter !== 'all' && row.workflowStatus !== worklistStatusFilter) {
        return false;
      }
      const owner = row.ownerName?.trim() || 'Unassigned';
      if (worklistOwnerFilter === 'unassigned' && owner !== 'Unassigned') return false;
      if (worklistOwnerFilter === 'assigned' && owner === 'Unassigned') return false;
      if (worklistHighValueOnly && row.histContributionYr < highValueThreshold) return false;
      if (q) {
        const hay = `${row.patientName} ${row.practiceName ?? ''} ${owner}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [
    worklistRows,
    worklistSearch,
    worklistStatusFilter,
    worklistOwnerFilter,
    worklistHighValueOnly,
    highValueThreshold,
  ]);

  const sortedWorklistRows = useMemo(
    () => sortWorklistRows(filteredWorklistRows, worklistSortKey, worklistSortDir),
    [filteredWorklistRows, worklistSortKey, worklistSortDir],
  );

  const worklistTotalRows = sortedWorklistRows.length;
  const worklistTotalPages = Math.max(1, Math.ceil(worklistTotalRows / worklistPageSize));
  const worklistEffectivePage = Math.min(worklistPage, worklistTotalPages);

  const onWorklistSort = (key: WorklistSortKey) => {
    if (worklistSortKey === key) {
      setWorklistSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setWorklistSortKey(key);
      setWorklistSortDir(
        key === 'patientName' || key === 'ownerName' || key === 'practiceName' ? 'asc' : 'desc',
      );
    }
    setWorklistPage(1);
  };

  useEffect(() => {
    setWorklistPage(1);
  }, [
    scopeKey,
    worklistSearch,
    worklistStatusFilter,
    worklistOwnerFilter,
    worklistHighValueOnly,
  ]);

  useEffect(() => {
    if (worklistPage > worklistTotalPages) setWorklistPage(worklistTotalPages);
  }, [worklistPage, worklistTotalPages]);

  const worklistPageRows = useMemo(() => {
    const start = (worklistEffectivePage - 1) * worklistPageSize;
    return sortedWorklistRows.slice(start, start + worklistPageSize);
  }, [sortedWorklistRows, worklistEffectivePage, worklistPageSize]);

  const onWorklistPageSizeChange = (size: number) => {
    setWorklistPageSize(size);
    setWorklistPage(1);
  };

  const refetchAll = () => {
    void refetch();
    void recoveryQuery.refetch();
  };

  const reactivationPractices = recoveryGroup?.practices ?? [];
  const reactivationChartPractices =
    reactivationPractices.length > 0
      ? reactivationPractices
      : recoveryPractice && recoveryPractice.reactivationValueGbp > 0
        ? [
            {
              practiceId: recoveryPractice.practiceId,
              practiceName: recoveryPractice.practiceName,
              reactivationValueGbp: recoveryPractice.reactivationValueGbp,
              openFlagCount: recoveryPractice.openFlagCount,
            },
          ]
        : [];

  return (
    <div className="space-y-5">
      {data && data.hasData && segmentRollup ? (
        <RetentionHeroGrid data={data} multiPractice={multiPractice} pending={atRiskPending} />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {PE_RETENTION_SEGMENT_ORDER.map((status) => (
            <PeHeroCard
              key={status}
              tone={RETENTION_HERO_TONES[status]}
              pending={atRiskPending}
              question={retentionStatusLabel(status)}
              value="—"
              subtitle={RETENTION_HERO_SUBTITLES[status]}
            />
          ))}
        </div>
      )}

      {isError && !data && (
        <div className="rounded-[14px] border border-destructive/30 bg-destructive/5 px-4 py-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">
                Could not load contribution at risk
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {(error as Error)?.message ?? 'Unknown error'}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={refetchAll}
                disabled={isFetching || recoveryPending}
              >
                Retry
              </Button>
            </div>
          </div>
        </div>
      )}

      {!atRiskPending && !isError && data && !data.hasData && (
        <div className={cn(PE_CTX_BANNER_CLASS, 'flex-wrap justify-between')}>
          <div>
            <div className="font-semibold text-foreground">No patient contribution data yet</div>
            <div className="mt-0.5 text-muted-foreground">
              Connect Dentally and run Patient Economics sync so invoice contribution and retention
              segments can be computed.
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

      {data && data.hasData && segmentRollup && (
        <div className="grid gap-4 lg:grid-cols-2">
          <SimpleChartCard
            title="Contribution at Risk by segment"
            subtitle="Patient counts turned into £, value, not volume"
          >
            {atRiskPending ? (
              <PeChartSkeleton className="h-[180px]" />
            ) : (
              <ContributionAtRiskBySegmentChart key={scopeKey} rollup={segmentRollup} />
            )}
          </SimpleChartCard>

          <SimpleChartCard
            title={`Reactivation value by ${rollupUnitLabel}`}
            subtitle="Recoverable contribution from lapsed patients"
          >
            {recoveryPending ? (
              <PeChartSkeleton className="h-[180px]" />
            ) : recoveryQuery.isError ? (
              <p className="py-6 text-sm text-danger-strong">Could not load reactivation value.</p>
            ) : reactivationChartPractices.length > 0 ? (
              <ReactivationValueByPracticeChart
                key={scopeKey}
                practices={reactivationChartPractices}
              />
            ) : recoveryPractice && recoveryPractice.openFlagCount > 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                {recoveryPractice.openFlagCount} open flag(s) ·{' '}
                {formatGbpCompact(recoveryPractice.reactivationValueGbp)} recoverable
              </p>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No open reactivation flags yet.
              </p>
            )}
          </SimpleChartCard>
        </div>
      )}

      {recoveryQuery.isError && !recoveryData && (
        <div className="rounded-[14px] border border-destructive/30 bg-destructive/5 px-4 py-4 text-sm text-danger-strong">
          Could not load Recovery Loop data.
        </div>
      )}

      {(recoveryRollup || recoveryPending) && (
        <div className="rounded-[14px] border border-border bg-card shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div>
              <h2 className="text-[15px] font-bold tracking-tight text-foreground">
                Recovery Loop<span className="text-primary">™</span>
              </h2>
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
                From flagged to banked. Every at-risk £ gets an owner, a status and a measured
                outcome.
              </p>
            </div>
            {recoveryPending ? (
              <div className="flex gap-6">
                <Skeleton className="h-12 w-24" />
                <Skeleton className="h-12 w-24" />
              </div>
            ) : recoveryRollup ? (
              <div className="flex gap-6">
                <div className="text-right">
                  <div className="text-[11px] text-muted-foreground">
                    Recovered this quarter
                    <span className="block text-[10px] font-normal">contribution booked</span>
                  </div>
                  <div className="text-[22px] font-extrabold tracking-tight text-success">
                    {formatGbp(recoveryRollup.recoveredThisQuarterGbp)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[11px] text-muted-foreground">
                    In progress
                    <span className="block text-[10px] font-normal">open flags at risk</span>
                  </div>
                  <div className="text-[22px] font-extrabold tracking-tight text-primary">
                    {formatGbp(recoveryRollup.inProgressGbp)}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
          <div className="px-5 py-4">
            {recoveryPending ? (
              <PeChartSkeleton className="h-[200px]" />
            ) : recoveryRollup ? (
              <>
                <RecoveryLoopFunnelChart key={scopeKey} funnel={recoveryRollup.recoveryFunnel} />
                <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
                  Funnel £ follows worklist workflow status (new → contacted → booked). The{' '}
                  <strong className="font-semibold text-foreground">Recovered</strong> bar is
                  contribution at risk on closed flags — not the same as{' '}
                  <strong className="font-semibold text-foreground">Recovered this quarter</strong>{' '}
                  (invoice contribution in the last 90 days).
                  {recoveryRollup.recoveryFunnel.bankedPct != null && (
                    <>
                      {' '}
                      Cohort recovery rate:{' '}
                      <strong className="font-bold text-foreground">
                        {Math.round(recoveryRollup.recoveryFunnel.bankedPct * 100)}%
                      </strong>{' '}
                      of flagged at-risk £.
                    </>
                  )}
                  {recoveryRollup.recoveryFunnel.recoveredValueGbp > 0 && (
                    <>
                      {' '}
                      Lifetime contribution on recovered flags:{' '}
                      <strong className="font-semibold text-foreground">
                        {formatGbp(recoveryRollup.recoveryFunnel.recoveredValueGbp)}
                      </strong>
                      .
                    </>
                  )}
                </p>
              </>
            ) : null}
          </div>
        </div>
      )}

      {(recoveryData || recoveryPending) && !recoveryQuery.isError && (
        <div className="overflow-hidden rounded-[14px] border border-border bg-card shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-border px-5 py-3">
            <div className="min-w-0 flex-1 basis-[240px]">
              <h2 className="text-[15px] font-bold tracking-tight text-foreground">
                Financially-prioritised reactivation worklist
              </h2>
              <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                Highest contribution at risk first · Search and filter, then open a patient record
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative w-[220px] max-w-full">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={worklistSearch}
                  onChange={(e) => setWorklistSearch(e.target.value)}
                  placeholder="Search patient…"
                  className="pl-9"
                />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-5 py-2.5">
            {WORKLIST_STATUS_FILTERS.map((f) => (
              <FilterChip
                key={f.key}
                label={f.label}
                active={worklistStatusFilter === f.key}
                onClick={() => setWorklistStatusFilter(f.key)}
              />
            ))}
            <span className="mx-1 h-4 w-px bg-border" />
            {WORKLIST_OWNER_FILTERS.map((f) => (
              <FilterChip
                key={f.key}
                label={f.label}
                active={worklistOwnerFilter === f.key}
                onClick={() => setWorklistOwnerFilter(f.key)}
              />
            ))}
            {highValueThreshold > 0 && (
              <>
                <span className="mx-1 h-4 w-px bg-border" />
                <FilterChip
                  label={`High value (≥${formatGbpCompact(highValueThreshold)})`}
                  active={worklistHighValueOnly}
                  onClick={() => setWorklistHighValueOnly((v) => !v)}
                />
              </>
            )}
            {worklistHasActiveFilters && (
              <span className="ml-2 text-[11.5px] text-muted-foreground">
                {filteredWorklistRows.length.toLocaleString('en-GB')} of{' '}
                {worklistRows.length.toLocaleString('en-GB')}
              </span>
            )}
            {highValueOverdueCount > 0 && !worklistHasActiveFilters && (
              <span className="ml-2 rounded-full border border-danger/30 bg-danger-muted px-2.5 py-0.5 text-[11px] font-semibold text-danger-strong">
                {highValueOverdueCount} high-value overdue
              </span>
            )}
          </div>

          <div className="overflow-x-auto px-5">
            {recoveryPending ? (
              <div className="space-y-2 py-2">
                {Array.from({ length: worklistPageSize }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : (
              <ReactivationWorklistTable
                rows={worklistPageRows}
                showPractice={multiPractice}
                isFiltered={worklistHasActiveFilters && worklistRows.length > 0}
                sortKey={worklistSortKey}
                sortDir={worklistSortDir}
                onSort={onWorklistSort}
              />
            )}
          </div>

          {worklistTotalRows > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3 text-[12px] text-muted-foreground">
              <span>
                Showing {(worklistEffectivePage - 1) * worklistPageSize + 1}–
                {Math.min(worklistEffectivePage * worklistPageSize, worklistTotalRows)} of{' '}
                {worklistTotalRows.toLocaleString('en-GB')} patients
                {worklistTotalRows !== worklistRows.length
                  ? ` (filtered from ${worklistRows.length.toLocaleString('en-GB')})`
                  : ''}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                {worklistTotalPages > 1 && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 w-8 px-0"
                      onClick={() => setWorklistPage((p) => Math.max(1, p - 1))}
                      disabled={worklistEffectivePage <= 1}
                      aria-label="Previous page"
                      title="Previous"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="tabular-nums">
                      Page {worklistEffectivePage} of {worklistTotalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 w-8 px-0"
                      onClick={() =>
                        setWorklistPage((p) => Math.min(worklistTotalPages, p + 1))
                      }
                      disabled={worklistEffectivePage >= worklistTotalPages}
                      aria-label="Next page"
                      title="Next"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </>
                )}
                <Select
                  value={String(worklistPageSize)}
                  onValueChange={(v) => onWorklistPageSizeChange(Number(v))}
                >
                  <SelectTrigger className="h-8 w-[64px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WORKLIST_PAGE_SIZE_OPTIONS.map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
