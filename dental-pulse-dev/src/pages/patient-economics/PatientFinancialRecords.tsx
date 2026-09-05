import { Fragment, useEffect, useMemo, useState } from 'react';
import { AlertCircle, ChevronDown, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DentallyInvoiceLink,
  DentallyPatientLink,
} from '@/components/patient-economics/DentallyLinks';
import {
  patientOpportunityMetrics,
  patientScopeLabel,
  patientTypeLabel,
  type PatientListRetentionFilter,
  type PatientListSortKey,
  type PatientListTypeFilter,
  type PatientProvenanceStatus,
} from '@/hooks/usePatientContributionList';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { PeRetentionStatus } from '@/lib/peRetentionConstants';
import { retentionListLabel } from '@/lib/peRetentionSegmentation';
import {
  usePatientFinancialRecord,
  usePatientFinancialRecordListTable,
  usePatientInvoices,
  PE_OPPORTUNITY_WEIGHTED_TIER_NOTE,
  type PatientFinancialRecordRow,
  type RetentionStatus,
} from '@/hooks/usePatientFinancialRecord';
import { cn } from '@/lib/utils';
import {
  ProvenanceChip,
  tierToChip,
} from '@/components/patient-economics/ProvenanceChip';

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
  const negative = value < 0;
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    const m = abs / 1_000_000;
    const compact = `£${m.toFixed(m >= 10 ? 1 : 2).replace(/\.?0+$/, '')}m`;
    return negative ? `−${compact}` : compact;
  }
  if (abs >= 1_000) {
    const k = abs / 1_000;
    const compact = `£${k.toFixed(k >= 10 ? 0 : 1).replace(/\.0$/, '')}k`;
    return negative ? `−${compact}` : compact;
  }
  return formatGbp(value);
}

function formatDate(raw: string | null): string {
  if (!raw) return '—';
  return new Date(`${raw}T00:00:00`).toLocaleDateString('en-GB');
}

function DataQualityChip({ status }: { status: PatientProvenanceStatus }) {
  if (status === 'partial_no_practitioner') {
    return <ProvenanceChip kind="partial_no_practitioner" />;
  }
  if (status === 'partial_missing_rate') {
    return <ProvenanceChip kind="partial_missing_rate" />;
  }
  return <ProvenanceChip kind="derived" />;
}

function StatLine({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: React.ReactNode;
  valueClassName?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-dashed border-border py-2 text-[13px] last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn('font-bold tabular-nums', valueClassName)}>{value}</span>
    </div>
  );
}

function DataQualityBanner({
  status,
  pctComplete,
  invoicesPartialNoPractitioner,
  invoicesPartialMissingRate,
}: {
  status: PatientProvenanceStatus;
  pctComplete: number | null;
  invoicesPartialNoPractitioner: number;
  invoicesPartialMissingRate: number;
}) {
  if (status === 'complete') return null;

  const detail =
    status === 'partial_no_practitioner'
      ? `${invoicesPartialNoPractitioner} invoice(s) lack an attributed practitioner — clinician cost may be understated.`
      : `${invoicesPartialMissingRate} invoice(s) lack a private share rate — clinician cost uses defaults.`;

  return (
    <div className="rounded-[10px] border border-amber-500/35 bg-amber-500/10 px-4 py-3 text-[13px] text-amber-900 dark:text-amber-100">
      <div className="flex flex-wrap items-center gap-2">
        <DataQualityChip status={status} />
        {pctComplete != null && (
          <span className="text-[12px] font-medium opacity-90">
            {pctComplete}% of revenue lines fully attributed
          </span>
        )}
      </div>
      <p className="mt-2 leading-relaxed opacity-90">{detail}</p>
    </div>
  );
}

function OpportunityM6Notice({
  tierNote,
  confidence,
}: {
  tierNote: string | null;
  confidence?: number;
}) {
  const text = tierNote ?? PE_OPPORTUNITY_WEIGHTED_TIER_NOTE;
  return (
    <div className="mt-3 rounded-[10px] border border-amber-500/30 bg-amber-500/8 px-3 py-2.5 text-[11px] leading-relaxed text-amber-950 dark:text-amber-100">
      <span className="font-semibold">Modelled weighting: </span>
      {text}
      {confidence != null && confidence > 0 && (
        <span className="mt-1 block text-amber-900/80 dark:text-amber-50/80">
          Commitment confidence: {confidence}%
        </span>
      )}
    </div>
  );
}

function RetentionStatusBadge({
  retention,
  recallHint,
}: {
  retention: RetentionStatus;
  recallHint?: string | null;
}) {
  const cls =
    retention.tone === 'active'
      ? 'border-primary/25 bg-primary/10 text-primary'
      : retention.tone === 'drifting'
        ? 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200'
        : retention.tone === 'lapsed'
          ? 'border-danger/30 bg-danger-muted text-danger-strong'
          : 'border-muted-foreground/40 bg-muted text-muted-foreground';

  const text = recallHint ? `${retention.label} · ${recallHint}` : retention.label;

  return (
    <span
      className={cn(
        'inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold',
        cls,
      )}
    >
      {text}
    </span>
  );
}

function PatientTypeBadge({ row }: { row: PatientFinancialRecordRow }) {
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

function patientSubtitleParts(row: PatientFinancialRecordRow): string[] {
  const parts: string[] = [];
  if (row.hasPaymentPlan) parts.push('member');
  if (row.revenuePrivatePlan > 0) parts.push('private');
  return parts;
}

function ExpandedInvoiceBreakdown({
  patientId,
  patientName,
  row,
}: {
  patientId: string;
  patientName: string;
  row: PatientFinancialRecordRow;
}) {
  const { data: invoices, isLoading, isError } = usePatientInvoices(patientId);

  const invoiceTotals = useMemo(() => {
    if (!invoices?.length) return null;
    return invoices.reduce(
      (acc, inv) => ({
        revenuePrivatePlan: acc.revenuePrivatePlan + inv.revenuePrivatePlan,
        revenueNhs: acc.revenueNhs + inv.revenueNhs,
        clinicianCost: acc.clinicianCost + inv.clinicianCost,
        labCost: acc.labCost + inv.labCost,
        materialsCost: acc.materialsCost + inv.materialsCost,
        directCost: acc.directCost + inv.directCost,
        contribution: acc.contribution + inv.contribution,
      }),
      {
        revenuePrivatePlan: 0,
        revenueNhs: 0,
        clinicianCost: 0,
        labCost: 0,
        materialsCost: 0,
        directCost: 0,
        contribution: 0,
      },
    );
  }, [invoices]);

  return (
    <tr>
      <td />
      <td colSpan={10} className="bg-muted/40 px-5 py-3">
        <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
          Invoice detail · {patientName}
          <ProvenanceChip kind="dentally" />
          <ProvenanceChip kind="derived" />
        </div>
        {isLoading && <Skeleton className="h-24 w-full rounded-lg" />}
        {isError && (
          <p className="text-[13px] text-danger-strong">Could not load invoices.</p>
        )}
        {!isLoading && !isError && invoices && invoices.length === 0 && (
          <p className="text-[13px] text-muted-foreground">No invoices on file.</p>
        )}
        {!isLoading && !isError && invoices && invoices.length > 0 && (
          <table className="w-full min-w-[960px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-border text-left text-[12px] font-semibold text-muted-foreground">
                <th className="whitespace-nowrap px-3 py-2.5">Invoice</th>
                <th className="whitespace-nowrap px-3 py-2.5">Date</th>
                <th className="whitespace-nowrap px-3 py-2.5 text-right">Revenue</th>
                <th className="whitespace-nowrap px-3 py-2.5 text-right">NHS</th>
                <th className="whitespace-nowrap px-3 py-2.5 text-right">Clinician</th>
                <th className="whitespace-nowrap px-3 py-2.5 text-right">Lab</th>
                <th className="whitespace-nowrap px-3 py-2.5 text-right">Materials</th>
                <th className="whitespace-nowrap px-3 py-2.5 text-right">Direct cost</th>
                <th className="whitespace-nowrap px-3 py-2.5 text-right">Contribution</th>
                <th className="whitespace-nowrap px-3 py-2.5 text-right">Share %</th>
                <th className="whitespace-nowrap px-3 py-2.5">Data quality</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr
                  key={inv.invoiceId}
                  className="border-b border-border/60 last:border-b-0 hover:bg-primary/[0.04]"
                >
                  <td className="px-3 py-3 font-semibold text-foreground">
                    <DentallyInvoiceLink
                      label={inv.platformInvoiceId ?? inv.invoiceId}
                      dentallyPatientUuid={inv.dentallyPatientUuid}
                      accountUuid={inv.accountUuid}
                      invoiceUuid={inv.invoiceUuid}
                    />
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">
                    {formatDate(inv.invoiceDate)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {formatGbpCompact(inv.revenuePrivatePlan)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {formatGbpCompact(inv.revenueNhs)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-danger">
                    {formatGbpCompact(inv.clinicianCost)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {formatGbpCompact(inv.labCost)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {formatGbpCompact(inv.materialsCost)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-danger">
                    {formatGbpCompact(inv.directCost)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-success">
                    {formatGbpCompact(inv.contribution)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {inv.privateShareRate != null ? `${inv.privateShareRate}%` : '—'}
                  </td>
                  <td className="px-3 py-3">
                    <DataQualityChip status={inv.contributionProvenanceStatus} />
                  </td>
                </tr>
              ))}
              <tr className="border-t border-border">
                <td className="px-3 py-3 font-bold text-foreground">Total</td>
                <td className="px-3 py-3" />
                <td className="px-3 py-3 text-right font-bold tabular-nums">
                  {formatGbp(invoiceTotals?.revenuePrivatePlan ?? 0)}
                </td>
                <td className="px-3 py-3 text-right font-bold tabular-nums">
                  {formatGbp(invoiceTotals?.revenueNhs ?? 0)}
                </td>
                <td className="px-3 py-3 text-right font-bold tabular-nums text-danger">
                  {formatGbp(invoiceTotals?.clinicianCost ?? 0)}
                </td>
                <td className="px-3 py-3 text-right font-bold tabular-nums">
                  {formatGbp(invoiceTotals?.labCost ?? 0)}
                </td>
                <td className="px-3 py-3 text-right font-bold tabular-nums">
                  {formatGbp(invoiceTotals?.materialsCost ?? 0)}
                </td>
                <td className="px-3 py-3 text-right font-bold tabular-nums text-danger">
                  {formatGbp(invoiceTotals?.directCost ?? 0)}
                </td>
                <td className="px-3 py-3 text-right font-bold tabular-nums text-success">
                  {formatGbp(invoiceTotals?.contribution ?? 0)}
                </td>
                <td className="px-3 py-3" />
                <td className="px-3 py-3" />
              </tr>
            </tbody>
          </table>
        )}
      </td>
    </tr>
  );
}

function RecordsRoster({
  selectedPatientId,
  expandedPatientId,
  onSelectPatient,
  onToggleExpand,
  onClearExpand,
}: {
  selectedPatientId: string | null;
  expandedPatientId: string | null;
  onSelectPatient: (patientId: string) => void;
  onToggleExpand: (patientId: string) => void;
  onClearExpand: () => void;
}) {
  const {
    isLoading,
    isPlaceholderData,
    isError,
    error,
    refetch,
    search,
    onSearchChange,
    retentionFilter,
    onRetentionFilterChange,
    typeFilter,
    onTypeFilterChange,
    pageRows,
    totalRows,
    totalUnfiltered,
    hasSyncedPatients,
    page,
    setPage,
    pageSize,
    onPageSizeChange,
    totalPages,
    sortKey,
    sortDir,
    toggleSort,
    rollupMode,
    isFetching,
  } = usePatientFinancialRecordListTable();

  const tablePending = isLoading || isPlaceholderData;

  useEffect(() => {
    if (
      expandedPatientId &&
      !pageRows.some((row) => row.patientId === expandedPatientId)
    ) {
      onClearExpand();
    }
  }, [page, pageRows, expandedPatientId, onClearExpand]);

  const onTypeChipClick = (key: PatientListTypeFilter) => {
    onTypeFilterChange(typeFilter === key ? 'all' : key);
  };

  return (
    <div className="overflow-hidden rounded-[14px] border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-border px-5 py-3">
        <div className="min-w-0 flex-1 basis-[240px]">
          <h3 className="text-[15px] font-bold text-foreground">Patient Financial Records</h3>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">
            Revenue (Dentally) − cost (attributed) = contribution (Derived). Click a row for the
            patient detail · expand icon for invoice breakdown.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
            <div className="font-semibold">Could not load patient records</div>
            <div className="mt-0.5 text-danger-strong/80">{error?.message}</div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            Retry
          </Button>
        </div>
      )}

      <div className="overflow-x-auto px-5 pb-5">
        <table className="w-full min-w-[1180px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-border text-left text-[12px] font-semibold text-muted-foreground">
              <th className="w-8 px-3 py-2.5" />
              <th className="px-3 py-2.5">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 hover:text-foreground"
                  onClick={() => toggleSort('patientName')}
                >
                  Patient
                  {sortKey === 'patientName' && (
                    <span className="text-[10px]">{sortDir === 'asc' ? '↑' : '↓'}</span>
                  )}
                </button>
              </th>
              <th className="px-3 py-2.5">
                {rollupMode === 'location' ? 'Location' : 'Practice'}
              </th>
              <th className="px-3 py-2.5">Type</th>
              <th className="px-3 py-2.5">Status</th>
              <th className="px-3 py-2.5 text-right">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 hover:text-foreground"
                  onClick={() => toggleSort('revenuePrivatePlan')}
                >
                  Revenue
                  {sortKey === 'revenuePrivatePlan' && (
                    <span className="text-[10px]">{sortDir === 'asc' ? '↑' : '↓'}</span>
                  )}
                </button>
              </th>
              <th className="px-3 py-2.5 text-right">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 hover:text-foreground"
                  onClick={() => toggleSort('directCost')}
                >
                  Cost
                  {sortKey === 'directCost' && (
                    <span className="text-[10px]">{sortDir === 'asc' ? '↑' : '↓'}</span>
                  )}
                </button>
              </th>
              <th className="px-3 py-2.5 text-right">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 hover:text-foreground"
                  onClick={() => toggleSort('contribution')}
                >
                  Contribution
                  {sortKey === 'contribution' && (
                    <span className="text-[10px]">{sortDir === 'asc' ? '↑' : '↓'}</span>
                  )}
                </button>
              </th>
              <th className="px-3 py-2.5 text-right">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 hover:text-foreground"
                  onClick={() => toggleSort('opportunityWeighted')}
                >
                  Opportunity (wtd)
                  {sortKey === 'opportunityWeighted' && (
                    <span className="text-[10px]">{sortDir === 'asc' ? '↑' : '↓'}</span>
                  )}
                </button>
              </th>
              <th className="px-3 py-2.5 text-right">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 hover:text-foreground"
                  onClick={() => toggleSort('patientEconomicValue')}
                >
                  Projected LTV
                  {sortKey === 'patientEconomicValue' && (
                    <span className="text-[10px]">{sortDir === 'asc' ? '↑' : '↓'}</span>
                  )}
                </button>
              </th>
              <th className="px-3 py-2.5 text-right">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 hover:text-foreground"
                  onClick={() => toggleSort('qualityScore')}
                >
                  Quality
                  {sortKey === 'qualityScore' && (
                    <span className="text-[10px]">{sortDir === 'asc' ? '↑' : '↓'}</span>
                  )}
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {tablePending &&
              Array.from({ length: pageSize }).map((_, i) => (
                <tr key={i} className="border-b border-border/60">
                  {Array.from({ length: 11 }).map((_, j) => (
                    <td key={j} className="px-3 py-3">
                      <Skeleton className="h-4 w-full" />
                    </td>
                  ))}
                </tr>
              ))}

            {!tablePending && !isError && !hasSyncedPatients && (
              <tr>
                <td colSpan={11} className="px-3 py-12 text-center text-[13px] text-muted-foreground">
                  <div className="font-semibold text-foreground">No patients synced yet</div>
                  <div className="mt-1 text-[12px]">
                    Connect Dentally and run Patient Economics sync so invoices can populate this
                    directory.
                  </div>
                </td>
              </tr>
            )}

            {!tablePending && !isError && hasSyncedPatients && totalRows === 0 && (
              <tr>
                <td colSpan={11} className="px-3 py-10 text-center text-[13px] text-muted-foreground">
                  No patients match your search.
                </td>
              </tr>
            )}

            {!tablePending &&
              !isError &&
              pageRows.map((row) => {
                const selected = selectedPatientId === row.patientId;
                const expanded = expandedPatientId === row.patientId;
                const opportunityWeighted = patientOpportunityMetrics(row).probabilityWeighted;

                return (
                  <Fragment key={row.patientId}>
                    <tr
                      className={cn(
                        'border-b border-border/60 cursor-pointer transition-colors last:border-b-0',
                        selected ? 'bg-primary/[0.06] hover:bg-primary/[0.08]' : 'hover:bg-primary/[0.04]',
                      )}
                      onClick={() => onSelectPatient(row.patientId)}
                    >
                      <td className="px-3 py-3 text-muted-foreground">
                        <button
                          type="button"
                          className="rounded p-0.5 hover:bg-muted"
                          aria-label={expanded ? 'Collapse invoice lines' : 'Expand invoice lines'}
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleExpand(row.patientId);
                          }}
                        >
                          {expanded ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </button>
                      </td>
                      <td className="px-3 py-3">
                        <DentallyPatientLink dentallyPatientUuid={row.patientUuid}>
                          {row.patientName}
                        </DentallyPatientLink>
                      </td>
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
                        {formatGbpCompact(row.revenuePrivatePlan)}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-danger">
                        {formatGbpCompact(row.directCost)}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-success">
                        {formatGbpCompact(row.contribution)}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-primary">
                        {formatGbpCompact(opportunityWeighted)}
                      </td>
                      <td className="px-3 py-3 text-right font-bold tabular-nums">
                        {formatGbpCompact(row.patientEconomicValue)}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <QualityScoreBadge score={row.qualityScore} />
                      </td>
                    </tr>
                    {expanded && (
                      <ExpandedInvoiceBreakdown
                        patientId={row.patientId}
                        patientName={row.patientName}
                        row={row}
                      />
                    )}
                  </Fragment>
                );
              })}
          </tbody>
        </table>
      </div>

      {!isError && hasSyncedPatients && totalRows > 0 && (
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
  );
}

function PatientFinancialRecordInlineDetail({ patientId }: { patientId: string }) {
  const { data, isLoading, isError, error, refetch } = usePatientFinancialRecord(patientId);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-64" />
        <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
          <Skeleton className="h-80 rounded-[14px]" />
          <Skeleton className="h-80 rounded-[14px]" />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-[14px] border border-danger/30 bg-danger-muted px-5 py-6 text-sm text-danger-strong">
        <div className="flex items-start gap-2">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div className="font-semibold">Could not load financial record</div>
            <div>{error?.message}</div>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>
              Retry
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-[14px] border border-border bg-card px-5 py-8 text-center text-muted-foreground">
        Patient not found in contribution data.
      </div>
    );
  }

  const {
    row: c,
    modelled,
    retention,
    invoices,
    acquisitionSourceName,
    recallHint,
  } = data;

  const {
    unscheduledTreatmentGross,
    grossContributionOpportunity,
    probabilityWeighted,
  } = patientOpportunityMetrics(c);

  const marginLabel = c.marginPct != null ? `${c.marginPct}% margin` : 'margin n/a';
  const subtitleParts = patientSubtitleParts(c);
  if (acquisitionSourceName) subtitleParts.push(acquisitionSourceName);

  let labTotal = 0;
  let materialsTotal = 0;
  for (const inv of invoices) {
    labTotal += inv.labCost;
    materialsTotal += inv.materialsCost;
  }

  const qualityDisplay =
    c.qualityScore > 0 ? c.qualityScore : modelled?.qualityScore ?? 0;
  const hasQuality = qualityDisplay > 0;

  const pevFootnote =
    c.cltvProjection != null
      ? 'Patient Economic Value™ uses the Day 3 CLTV projection when modelled scores exist; otherwise contribution to date only.'
      : 'Patient Economic Value™ equals contribution to date until the Day 3 modelled job runs.';

  return (
    <div className="space-y-4">
      <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-primary">
        Patient Financial Record · {c.patientName}
        <span className="ml-2 font-medium normal-case tracking-normal text-muted-foreground">
          {subtitleParts.length > 0 ? ` · ${subtitleParts.join(' · ')}` : ''}
        </span>
      </div>

      <DataQualityBanner
        status={c.contributionProvenanceStatus}
        pctComplete={c.pctComplete}
        invoicesPartialNoPractitioner={c.invoicesPartialNoPractitioner}
        invoicesPartialMissingRate={c.invoicesPartialMissingRate}
      />

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        {/* Left: economics */}
        <div className="rounded-[14px] border border-border bg-card p-5 shadow-sm">
          <div className="flex flex-wrap gap-6">
            <div>
              <div className="text-[11.5px] text-muted-foreground">Patient Economic Value™</div>
              <div className="text-[30px] font-extrabold tracking-tight text-primary tabular-nums">
                {formatGbp(c.patientEconomicValue)}
              </div>
            </div>
            <div>
              <div className="text-[11.5px] text-muted-foreground">Contribution to date</div>
              <div className="text-[30px] font-extrabold tracking-tight text-success tabular-nums">
                {formatGbp(c.contribution)}
              </div>
            </div>
            <div>
              <div className="text-[11.5px] text-muted-foreground">Quality Score™</div>
              <div className="text-[30px] font-extrabold tracking-tight tabular-nums text-foreground">
                {hasQuality ? qualityDisplay : '—'}
                {hasQuality && (
                  <span className="text-[15px] font-semibold text-muted-foreground">/100</span>
                )}
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-0 sm:grid-cols-2 sm:gap-x-6">
            <div>
              <div className="mb-1 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-primary">
                Revenue
                <ProvenanceChip kind={tierToChip(c.revenueTier)} />
              </div>
              <StatLine
                label="Total revenue"
                value={formatGbp(c.revenuePrivatePlan)}
                valueClassName="font-bold"
              />
            </div>
            <div>
              <div className="mb-1 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-danger">
                Direct cost
                <ProvenanceChip kind={tierToChip(c.clinicianCostTier)} />
              </div>
              <StatLine label="Clinician (attributed)" value={formatGbp(c.clinicianCost)} />
              <StatLine label="Lab" value={formatGbp(labTotal)} />
              <StatLine label="Materials" value={formatGbp(materialsTotal)} />
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between rounded-[10px] bg-success-muted px-4 py-3">
            <span className="text-[13px] font-semibold text-success">Patient Contribution™</span>
            <span className="text-[18px] font-extrabold text-success tabular-nums">
              {formatGbp(c.contribution)}
              <span className="text-[12px] font-semibold"> · {marginLabel}</span>
            </span>
          </div>
        </div>

        {/* Right: opportunity & risk */}
        <div className="rounded-[14px] border border-border bg-card p-5 shadow-sm">
          <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-primary">
            Opportunity & risk
          </div>

          <StatLine
            label="Unscheduled treatment (gross)"
            value={formatGbp(unscheduledTreatmentGross)}
          />
          <StatLine
            label="Gross contribution opportunity"
            value={formatGbp(grossContributionOpportunity)}
          />
          <StatLine
            label="Probability-weighted"
            value={formatGbp(probabilityWeighted)}
            valueClassName="text-primary"
          />
          <StatLine
            label="Retention status"
            value={<RetentionStatusBadge retention={retention} recallHint={recallHint} />}
          />
          <StatLine
            label="Data confidence"
            value={
              c.confidenceScore != null
                ? `${c.confidenceScore}%`
                : c.pctComplete != null
                  ? `${c.pctComplete}%`
                  : '—'
            }
          />

          <OpportunityM6Notice
            tierNote={c.opportunityWeightedTierNote}
            confidence={c.opportunityWeightConfidence}
          />

          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">{pevFootnote}</p>
        </div>
      </div>
    </div>
  );
}

export function PatientFinancialRecords() {
  const [searchParams, setSearchParams] = useSearchParams();
  const patientId = searchParams.get('patientId')?.trim() ?? null;
  const [expandedPatientId, setExpandedPatientId] = useState<string | null>(null);

  const onSelectPatient = (id: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', 'patient-records');
    next.set('patientId', id);
    setSearchParams(next);
  };

  const onToggleExpand = (id: string) => {
    setExpandedPatientId((current) => (current === id ? null : id));
  };

  return (
    <div className="space-y-4">
      <RecordsRoster
        selectedPatientId={patientId}
        expandedPatientId={expandedPatientId}
        onSelectPatient={onSelectPatient}
        onToggleExpand={onToggleExpand}
        onClearExpand={() => setExpandedPatientId(null)}
      />
      {patientId && <PatientFinancialRecordInlineDetail patientId={patientId} />}
    </div>
  );
}
