import { AlertCircle, ChevronLeft, ChevronRight, Download, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  patientListSecondaryKpi,
  patientListTertiaryKpi,
  patientTypeLabel,
  usePatientContributionListTable,
  type PatientContributionRow,
  patientScopeLabel,
  type PatientListRetentionFilter,
  type PatientListSortKey,
  type PatientListTypeFilter,
} from '@/hooks/usePatientContributionList';
import type { PeRetentionStatus } from '@/lib/peRetentionConstants';
import { retentionListLabel } from '@/lib/peRetentionSegmentation';
import { cn } from '@/lib/utils';

const PAGE_SIZE_OPTIONS = [5, 10, 25, 50, 100];

const RETENTION_FILTERS: { key: PatientListRetentionFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'drifting', label: 'Drifting' },
  { key: 'lapsed', label: 'Lapsed' },
  { key: 'effectively_lost', label: 'Effectively lost' },
];

const TYPE_FILTERS: { key: PatientListTypeFilter; label: string }[] = [
  { key: 'private', label: 'Private' },
  { key: 'nhs', label: 'NHS' },
  { key: 'member', label: 'Member' },
];

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

function formatVisitFreq(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toFixed(1).replace(/\.0$/, '');
}

function SummaryKpiCard({
  label,
  value,
  subtitle,
  tone = 'default',
  isLoading,
}: {
  label: string;
  value: string;
  subtitle: string;
  tone?: 'default' | 'qual' | 'opp' | 'warn' | 'danger';
  isLoading?: boolean;
}) {
  const bar =
    tone === 'qual'
      ? 'bg-success'
      : tone === 'opp'
        ? 'bg-[hsl(var(--chart-5))]'
        : tone === 'warn'
          ? 'bg-amber-500'
          : tone === 'danger'
            ? 'bg-danger'
            : 'bg-primary';

  return (
    <div className="relative overflow-hidden rounded-[14px] border border-border bg-card px-4 py-4 pb-[15px] shadow-sm">
      <div className={cn('absolute inset-x-0 top-0 h-[3px]', bar)} />
      <div className="mb-[9px] min-h-[26px] text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
        {label}
      </div>
      {isLoading ? (
        <Skeleton className="h-7 w-28" />
      ) : (
        <div
          className={cn(
            'text-[28px] font-extrabold leading-none tracking-[-0.02em]',
            tone === 'qual' && 'text-success',
            tone === 'opp' && 'text-[hsl(var(--chart-5))]',
            tone === 'warn' && 'text-amber-700 dark:text-amber-300',
            tone === 'danger' && 'text-danger-strong',
            tone === 'default' && 'text-foreground',
          )}
        >
          {value}
        </div>
      )}
      <div className="mt-[7px] text-[11.5px] leading-[1.5] text-muted-foreground">{subtitle}</div>
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

function PatientTypeBadge({ row }: { row: PatientContributionRow }) {
  const label = patientTypeLabel(row);
  if (!label) {
    return <span className="text-muted-foreground">—</span>;
  }

  const cls =
    label === 'Member'
      ? 'border-primary/25 bg-primary/12 text-primary'
      : label === 'Private'
        ? 'border-success/30 bg-success-muted text-success'
        : 'border-border bg-muted text-muted-foreground';

  return (
    <span
      className={cn(
        'inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold',
        cls,
      )}
    >
      {label}
    </span>
  );
}

function RetentionListBadge({ status }: { status: PeRetentionStatus }) {
  const label = retentionListLabel(status);
  const cls =
    status === 'active'
      ? 'border-success/30 bg-success-muted text-success'
      : status === 'drifting'
        ? 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200'
        : status === 'lapsed'
          ? 'border-danger/30 bg-danger-muted text-danger-strong'
          : 'border-muted-foreground/40 bg-muted text-muted-foreground';

  return (
    <span
      className={cn(
        'inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold',
        cls,
      )}
    >
      {label}
    </span>
  );
}

function QualityScoreBadge({ score }: { score: number }) {
  const n = Math.round(Number(score));
  if (!Number.isFinite(n) || n <= 0) {
    return <span className="text-[11px] text-muted-foreground">—</span>;
  }

  const cls =
    n >= 70
      ? 'border-success/30 bg-success-muted text-success'
      : n >= 40
        ? 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200'
        : 'border-danger/30 bg-danger-muted text-danger-strong';

  return (
    <span
      className={cn(
        'inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tabular-nums',
        cls,
      )}
    >
      {n}
    </span>
  );
}

export function PatientListDirectory() {
  const {
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
    search,
    onSearchChange,
    retentionFilter,
    onRetentionFilterChange,
    typeFilter,
    onTypeFilterChange,
    sortKey,
    sortDir,
    toggleSort,
    page,
    setPage,
    pageSize,
    onPageSizeChange,
    totalPages,
    totalRows,
    totalUnfiltered,
    pageRows,
    summary,
    baselineSummary,
    locationFilter,
    onLocationFilterChange,
    locationOptions,
    rollupMode,
    hasSyncedPatients,
    exportCsv,
  } = usePatientContributionListTable();

  const secondaryKpi = patientListSecondaryKpi(
    retentionFilter,
    summary,
    baselineSummary,
  );
  const tertiaryKpi = patientListTertiaryKpi(
    typeFilter,
    retentionFilter,
    summary,
    baselineSummary,
  );

  const columns: {
    key: PatientListSortKey | 'practice' | 'type' | 'status';
    label: string;
    align?: 'left' | 'right';
    sortable?: boolean;
  }[] = [
    { key: 'patientName', label: 'Patient', align: 'left', sortable: true },
    { key: 'practice', label: rollupMode === 'location' ? 'Location' : 'Practice', align: 'left', sortable: false },
    { key: 'type', label: 'Type', align: 'left', sortable: false },
    { key: 'status', label: 'Status', align: 'left', sortable: false },
    { key: 'visitFreqPerYear', label: 'Visit freq /yr', align: 'right', sortable: true },
    { key: 'valuePerVisit', label: 'Value/visit', align: 'right', sortable: true },
    { key: 'revenuePrivatePlan', label: 'Revenue', align: 'right', sortable: true },
    { key: 'directCost', label: 'Cost', align: 'right', sortable: true },
    { key: 'contribution', label: 'Contribution', align: 'right', sortable: true },
    { key: 'contribution12mo', label: 'Contribution 12mo', align: 'right', sortable: true },
    { key: 'patientEconomicValue', label: 'Projected LTV', align: 'right', sortable: true },
    { key: 'qualityScore', label: 'Quality', align: 'right', sortable: true },
  ];

  const onTypeChipClick = (key: PatientListTypeFilter) => {
    onTypeFilterChange(typeFilter === key ? 'all' : key);
  };

  return (
    <div className="space-y-[18px]">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryKpiCard
          label="Total patients"
          value={summary.totalPatients.toLocaleString('en-GB')}
          subtitle={
            search.trim() ||
            locationFilter !== 'all' ||
            retentionFilter !== 'all' ||
            typeFilter !== 'all'
              ? `${totalRows.toLocaleString('en-GB')} in current filter`
              : 'Synced invoice economics · this practice'
          }
          isLoading={isLoading}
        />
        <SummaryKpiCard
          label={secondaryKpi.label}
          value={secondaryKpi.value}
          subtitle={secondaryKpi.subtitle}
          tone={secondaryKpi.tone}
          isLoading={isLoading}
        />
        <SummaryKpiCard
          label={tertiaryKpi.label}
          value={tertiaryKpi.value}
          subtitle={tertiaryKpi.subtitle}
          tone={tertiaryKpi.tone}
          isLoading={isLoading}
        />
        <SummaryKpiCard
          label="Avg contribution / patient"
          value={formatGbp(summary.averageContribution)}
          subtitle={`12mo · LTV ${formatGbp(summary.averageProjectedLtv)}`}
          isLoading={isLoading}
        />
      </div>

      <div className="overflow-hidden rounded-[14px] border border-border bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-border px-5 py-3">
          <div className="min-w-0 flex-1 basis-[240px]">
            <h3 className="text-[15px] font-bold text-foreground">Patient List</h3>
            <p className="mt-0.5 text-[12.5px] text-muted-foreground">
              Every patient as an economic record · Filter, sort, then open one to drill in · Revenue
              − Cost = attributed contribution
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {rollupMode === 'location' && locationOptions.length > 1 && (
              <Select
                value={locationFilter}
                onValueChange={onLocationFilterChange}
                disabled={isLoading}
              >
                <SelectTrigger className="h-9 w-[200px] max-w-full">
                  <SelectValue placeholder="All locations" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All locations</SelectItem>
                  {locationOptions.map(([id, name]) => (
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
                value={search}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Search patient…"
                className="pl-9"
                disabled={isLoading}
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-9 w-9 shrink-0 px-0"
              onClick={exportCsv}
              disabled={isLoading || isError || totalRows === 0}
              aria-label="Export CSV"
              title="Export CSV"
            >
              <Download className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-5 py-2.5">
          {RETENTION_FILTERS.map((f) => (
            <FilterChip
              key={f.key}
              label={f.label}
              active={retentionFilter === f.key}
              onClick={() => onRetentionFilterChange(f.key)}
            />
          ))}
          <span className="mx-1 h-4 w-px bg-border" />
          {TYPE_FILTERS.map((f) => (
            <FilterChip
              key={f.key}
              label={f.label}
              active={typeFilter === f.key}
              onClick={() => onTypeChipClick(f.key)}
            />
          ))}
        </div>

        {isError && (
          <div className="m-5 flex flex-wrap items-start gap-3 rounded-[10px] border border-danger/30 bg-danger-muted px-3 py-2.5 text-sm text-danger-strong">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="flex-1">
              <div className="font-semibold">Couldn’t load patient directory</div>
              <div className="mt-0.5 text-danger-strong/80">
                {(error as Error)?.message || 'v_patient_contribution query failed.'}
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              Retry
            </Button>
          </div>
        )}

        <div className="overflow-x-auto px-5 pb-5">
          <table className="w-full min-w-[1280px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-border text-left text-[12px] font-semibold text-muted-foreground">
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className={cn(
                      'whitespace-nowrap px-3 py-2.5',
                      col.align === 'right' && 'text-right',
                    )}
                  >
                    {col.sortable ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 hover:text-foreground"
                        onClick={() => toggleSort(col.key as PatientListSortKey)}
                      >
                        {col.label}
                        {sortKey === col.key && (
                          <span className="text-[10px]">{sortDir === 'asc' ? '↑' : '↓'}</span>
                        )}
                      </button>
                    ) : (
                      col.label
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading &&
                Array.from({ length: pageSize }).map((_, i) => (
                  <tr key={i} className="border-b border-border/60">
                    {columns.map((col) => (
                      <td key={col.key} className="px-3 py-3">
                        <Skeleton className="h-4 w-full" />
                      </td>
                    ))}
                  </tr>
                ))}

              {!isLoading && !isError && !hasSyncedPatients && (
                <tr>
                  <td
                    colSpan={columns.length}
                    className="px-3 py-12 text-center text-[13px] text-muted-foreground"
                  >
                    <div className="font-semibold text-foreground">No patients synced yet</div>
                    <div className="mt-1 text-[12px]">
                      Connect Dentally and run Patient Economics sync so invoices can populate this
                      directory.
                    </div>
                  </td>
                </tr>
              )}

              {!isLoading && !isError && hasSyncedPatients && totalRows === 0 && (
                <tr>
                  <td
                    colSpan={columns.length}
                    className="px-3 py-10 text-center text-[13px] text-muted-foreground"
                  >
                    No patients match your search or filters.
                  </td>
                </tr>
              )}

              {!isLoading &&
                !isError &&
                pageRows.map((row) => {
                  const recordUrl = `/patients?tab=patient-records&patientId=${encodeURIComponent(
                    row.patientId,
                  )}`;
                  const nameCell = (
                    <Link
                      to={recordUrl}
                      className="font-semibold text-primary hover:underline"
                    >
                      {row.patientName}
                    </Link>
                  );

                  return (
                    <tr
                      key={row.patientId}
                      className="border-b border-border/60 last:border-b-0 hover:bg-primary/[0.04]"
                    >
                      <td className="px-3 py-3">{nameCell}</td>
                      <td className="px-3 py-3 text-foreground">
                        {patientScopeLabel(row, rollupMode)}
                      </td>
                      <td className="px-3 py-3">
                        <PatientTypeBadge row={row} />
                      </td>
                      <td className="px-3 py-3">
                        <RetentionListBadge status={row.retentionStatus} />
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {formatVisitFreq(row.visitFreqPerYear)}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {row.valuePerVisit != null ? formatGbpCompact(row.valuePerVisit) : '—'}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {formatGbpCompact(row.revenuePrivatePlan)}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-danger">
                        {formatGbpCompact(row.directCost)}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-success">
                        {formatGbpCompact(row.contribution)}
                      </td>
                      <td className="px-3 py-3 text-right font-bold tabular-nums text-success">
                        {formatGbpCompact(row.contribution12mo)}
                      </td>
                      <td className="px-3 py-3 text-right font-bold tabular-nums">
                        {formatGbpCompact(row.patientEconomicValue)}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <QualityScoreBadge score={row.qualityScore} />
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>

        {!isLoading && !isError && hasSyncedPatients && totalRows > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3 text-[12px] text-muted-foreground">
            <span>
              Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, totalRows)} of{' '}
              {totalRows.toLocaleString('en-GB')} patients
              {totalRows !== totalUnfiltered
                ? ` (filtered from ${totalUnfiltered.toLocaleString('en-GB')})`
                : ''}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              {totalPages > 1 && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 w-8 px-0"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    aria-label="Previous page"
                    title="Previous"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="tabular-nums">
                    Page {page} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 w-8 px-0"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    aria-label="Next page"
                    title="Next"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </>
              )}
              <Select
                value={String(pageSize)}
                onValueChange={(v) => onPageSizeChange(Number(v))}
                disabled={isLoading}
              >
                <SelectTrigger className="h-8 w-[64px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZE_OPTIONS.map((n) => (
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
    </div>
  );
}
