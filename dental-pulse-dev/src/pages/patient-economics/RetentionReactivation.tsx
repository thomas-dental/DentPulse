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
import type { ReactivationWorklistRow } from '@/services/integrations/patientEconomicsService';
import {
  ContributionAtRiskBySegmentChart,
  RecoveryLoopFunnelChart,
  ReactivationValueByPracticeChart,
  ReactivationWorklistTable,
  formatGbp,
  formatGbpCompact,
} from '@/components/patient-economics/RetentionReactivationCharts';
import {
  segmentContributionByStatus,
  useRetentionContributionAtRisk,
  type RetentionContributionAtRisk,
} from '@/hooks/useRetentionContributionAtRisk';
import { useRetentionRecoveryLoop } from '@/hooks/useRetentionRecoveryLoop';
import { useEconomicAssumptions } from '@/hooks/useEconomicAssumptions';
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

function RetentionHeroCard({
  tone = 'default',
  question,
  value,
  subtitle,
}: {
  tone?: RetentionHeroTone;
  question: string;
  value: string;
  subtitle: ReactNode;
}) {
  const bar =
    tone === 'risk' ? 'bg-danger' : tone === 'conv' ? 'bg-warning' : 'bg-primary';
  const valueCls =
    tone === 'risk'
      ? 'text-danger-strong'
      : tone === 'conv'
        ? 'text-warning'
        : question === retentionStatusLabel('effectively_lost')
          ? 'text-muted-foreground'
          : 'text-foreground';

  return (
    <div className="relative overflow-hidden rounded-[14px] border border-border bg-card px-4 py-4 pb-[15px] shadow-sm">
      <div className={cn('absolute inset-x-0 top-0 h-[3px]', bar)} />
      <div className="mb-[9px] min-h-[26px] text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
        {question}
      </div>
      <div className={cn('text-[28px] font-extrabold tracking-tight', valueCls)}>{value}</div>
      <div className="mt-2 text-[11.5px] leading-relaxed text-muted-foreground">{subtitle}</div>
    </div>
  );
}

function RetentionHeroGrid({
  data,
  multiPractice,
}: {
  data: RetentionContributionAtRisk;
  multiPractice: boolean;
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
          <RetentionHeroCard
            key={status}
            tone={RETENTION_HERO_TONES[status]}
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
  const [worklistSearch, setWorklistSearch] = useState('');
  const [worklistLocationFilter, setWorklistLocationFilter] = useState('all');
  const [worklistStatusFilter, setWorklistStatusFilter] = useState<WorklistStatusFilter>('all');
  const [worklistOwnerFilter, setWorklistOwnerFilter] = useState<WorklistOwnerFilter>('all');
  const [worklistHighValueOnly, setWorklistHighValueOnly] = useState(false);
  const [worklistPage, setWorklistPage] = useState(1);
  const [worklistPageSize, setWorklistPageSize] = useState(5);

  const atRiskQuery = useRetentionContributionAtRisk();
  const recoveryQuery = useRetentionRecoveryLoop();
  const assumptionsQuery = useEconomicAssumptions();

  const { data, isLoading, isError, error, refetch, isFetching } = atRiskQuery;
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

  const worklistLocationOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of worklistRows) {
      if (row.practiceId && row.practiceName) {
        map.set(row.practiceId, row.practiceName);
      }
    }
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [worklistRows]);

  const worklistHasActiveFilters =
    worklistSearch.trim() !== '' ||
    worklistLocationFilter !== 'all' ||
    worklistStatusFilter !== 'all' ||
    worklistOwnerFilter !== 'all' ||
    worklistHighValueOnly;

  const filteredWorklistRows = useMemo(() => {
    const q = worklistSearch.trim().toLowerCase();
    return worklistRows.filter((row) => {
      if (worklistLocationFilter !== 'all' && row.practiceId !== worklistLocationFilter) {
        return false;
      }
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
    worklistLocationFilter,
    worklistStatusFilter,
    worklistOwnerFilter,
    worklistHighValueOnly,
    highValueThreshold,
  ]);

  const worklistTotalRows = filteredWorklistRows.length;
  const worklistTotalPages = Math.max(1, Math.ceil(worklistTotalRows / worklistPageSize));
  const worklistEffectivePage = Math.min(worklistPage, worklistTotalPages);

  useEffect(() => {
    setWorklistPage(1);
  }, [
    worklistSearch,
    worklistLocationFilter,
    worklistStatusFilter,
    worklistOwnerFilter,
    worklistHighValueOnly,
  ]);

  useEffect(() => {
    if (worklistPage > worklistTotalPages) setWorklistPage(worklistTotalPages);
  }, [worklistPage, worklistTotalPages]);

  const worklistPageRows = useMemo(() => {
    const start = (worklistEffectivePage - 1) * worklistPageSize;
    return filteredWorklistRows.slice(start, start + worklistPageSize);
  }, [filteredWorklistRows, worklistEffectivePage, worklistPageSize]);

  const onWorklistPageSizeChange = (size: number) => {
    setWorklistPageSize(size);
    setWorklistPage(1);
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

  const isPageLoading = isLoading || recoveryQuery.isLoading;

  return (
    <div className="space-y-5">
      {isPageLoading && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[120px] rounded-[14px]" />
          ))}
        </div>
      )}

      {isError && (
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
                onClick={() => refetch()}
                disabled={isFetching}
              >
                Retry
              </Button>
            </div>
          </div>
        </div>
      )}

      {!isPageLoading && !isError && data && !data.hasData && (
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

      {!isPageLoading && !isError && data && data.hasData && segmentRollup && (
        <>
          <RetentionHeroGrid data={data} multiPractice={multiPractice} />

          <div className="grid gap-4 lg:grid-cols-2">
            <SimpleChartCard
              title="Contribution at Risk by segment"
              subtitle="Patient counts turned into £, value, not volume"
            >
              <ContributionAtRiskBySegmentChart rollup={segmentRollup} />
            </SimpleChartCard>

            <SimpleChartCard
              title={`Reactivation value by ${rollupUnitLabel}`}
              subtitle="Recoverable contribution from lapsed patients"
            >
              {recoveryQuery.isLoading ? (
                <Skeleton className="h-[180px] w-full" />
              ) : recoveryQuery.isError ? (
                <p className="py-6 text-sm text-danger-strong">Could not load reactivation value.</p>
              ) : reactivationChartPractices.length > 0 ? (
                <ReactivationValueByPracticeChart practices={reactivationChartPractices} />
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
        </>
      )}

      {recoveryQuery.isLoading && (
        <Skeleton className="h-[280px] rounded-[14px]" />
      )}

      {recoveryQuery.isError && (
        <div className="rounded-[14px] border border-destructive/30 bg-destructive/5 px-4 py-4 text-sm text-danger-strong">
          Could not load Recovery Loop data.
        </div>
      )}

      {!recoveryQuery.isLoading && !recoveryQuery.isError && recoveryRollup && (
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
          </div>
          <div className="px-5 py-4">
            <RecoveryLoopFunnelChart funnel={recoveryRollup.recoveryFunnel} />
            <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
              Funnel £ follows worklist workflow status (new → contacted → booked). The{' '}
              <strong className="font-semibold text-foreground">At-risk recovered</strong> bar is
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
          </div>
        </div>
      )}

      {!recoveryQuery.isLoading && !recoveryQuery.isError && recoveryData && (
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
              {multiPractice && worklistLocationOptions.length > 1 && (
                <Select
                  value={worklistLocationFilter}
                  onValueChange={setWorklistLocationFilter}
                >
                  <SelectTrigger className="h-9 w-[200px] max-w-full">
                    <SelectValue placeholder="All locations" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All locations</SelectItem>
                    {worklistLocationOptions.map(([id, name]) => (
                      <SelectItem key={id} value={id}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
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
            <ReactivationWorklistTable
              rows={worklistPageRows}
              showPractice={multiPractice}
              isFiltered={worklistHasActiveFilters && worklistRows.length > 0}
            />
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
