import { Fragment, useEffect, useState } from 'react';
import { AlertCircle, ChevronDown, ChevronLeft, ChevronRight, ExternalLink, Search } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  patientOpportunityMetrics,
  type PatientListSortKey,
  type PatientProvenanceStatus,
} from '@/hooks/usePatientContributionList';
import { useOrganization } from '@/hooks/useOrganization';
import {
  usePatientFinancialRecord,
  usePatientFinancialRecordListTable,
  usePatientTreatmentLines,
  PE_OPPORTUNITY_WEIGHTED_TIER_NOTE,
  type PatientFinancialRecordRow,
  type RetentionStatus,
} from '@/hooks/usePatientFinancialRecord';
import { cn } from '@/lib/utils';
import {
  ProvenanceChip,
  tierToChip,
} from '@/components/patient-economics/ProvenanceChip';
import { PE_CTX_BANNER_CLASS } from '@/lib/peVisualTokens';
import {
  recommendedActionDetail,
} from '@/lib/peRecommendedAction';

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
    return `£${m.toFixed(m >= 10 ? 1 : 2).replace(/\.?0+$/, '')}m`;
  }
  if (abs >= 1_000) {
    const k = abs / 1_000;
    return `£${k.toFixed(k >= 10 ? 0 : 1).replace(/\.0$/, '')}k`;
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

function PatientTypeStatusBadge({ row }: { row: PatientFinancialRecordRow }) {
  const label = row.hasPaymentPlan
    ? 'Member'
    : row.revenuePrivatePlan > 0
      ? 'Private'
      : null;

  if (!label) {
    return <span className="text-muted-foreground">—</span>;
  }

  const cls =
    label === 'Member'
      ? 'border-primary/25 bg-primary/12 text-primary'
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

function QualityScoreCell({ score }: { score: number }) {
  const n = Math.round(Number(score));
  if (!Number.isFinite(n) || n <= 0) {
    return (
      <span
        className="text-[11px] text-muted-foreground"
        title="Quality score comes from the Day 3 modelled job — run PE sync after contribution data is loaded"
      >
        —
      </span>
    );
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
      {n}/100
    </span>
  );
}

function RosterMoneyCell({
  value,
  tone = 'default',
  bold = false,
}: {
  value: number;
  tone?: 'default' | 'danger' | 'success' | 'primary';
  bold?: boolean;
}) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return <span className="text-muted-foreground">—</span>;
  }

  if (n === 0) {
    return (
      <span
        className="tabular-nums text-muted-foreground"
        title="No weighted opportunity on file (requires unscheduled plans in the event ledger)"
      >
        £0
      </span>
    );
  }

  const toneCls =
    tone === 'danger'
      ? 'text-danger'
      : tone === 'success'
        ? 'text-success'
        : tone === 'primary'
          ? 'text-primary'
          : 'text-foreground';

  return (
    <span className={cn('tabular-nums', toneCls, bold && 'font-bold')}>
      {formatGbpCompact(n)}
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
  const { data: treatmentLines, isLoading, isError } = usePatientTreatmentLines(
    patientId,
    row.ptId,
  );

  return (
    <tr>
      <td />
      <td colSpan={9} className="bg-muted/40 px-5 py-3">
        <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
          Completed treatments · {patientName}
          <ProvenanceChip kind="dentally" />
          <ProvenanceChip kind="derived" />
        </div>
        {isLoading && <Skeleton className="h-24 w-full rounded-lg" />}
        {isError && (
          <p className="text-[13px] text-danger-strong">Could not load treatment lines.</p>
        )}
        {!isLoading && !isError && treatmentLines && treatmentLines.length === 0 && (
          <p className="text-[13px] text-muted-foreground">No private treatment lines on file.</p>
        )}
        {!isLoading && !isError && treatmentLines && treatmentLines.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full min-w-[720px] text-[12px]">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2">Treatment</th>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Clinician</th>
                  <th className="px-3 py-2 text-right">Revenue</th>
                  <th className="px-3 py-2 text-right">Cost</th>
                  <th className="px-3 py-2 text-right">Contribution</th>
                </tr>
              </thead>
              <tbody>
                {treatmentLines.map((line) => (
                  <tr key={line.lineId} className="border-b border-border/60 last:border-b-0">
                    <td className="px-3 py-2 font-medium">{line.treatmentLabel}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {line.date ? formatDate(line.date) : '—'}
                    </td>
                    <td className="px-3 py-2 text-primary">
                      {line.clinicianName ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatGbp(line.revenue)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-danger">
                      {formatGbp(line.cost)}
                    </td>
                    <td
                      className={cn(
                        'px-3 py-2 text-right font-semibold tabular-nums',
                        line.contribution >= 0 ? 'text-success' : 'text-danger',
                      )}
                    >
                      {formatGbp(line.contribution)}
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-border">
                  <td className="px-3 py-2 font-bold">Total</td>
                  <td />
                  <td />
                  <td className="px-3 py-2 text-right font-bold tabular-nums">
                    {formatGbp(row.revenuePrivatePlan)}
                  </td>
                  <td className="px-3 py-2 text-right font-bold tabular-nums text-danger">
                    {formatGbp(row.directCost)}
                  </td>
                  <td className="px-3 py-2 text-right font-extrabold tabular-nums text-success">
                    {formatGbp(row.contribution)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </td>
    </tr>
  );
}

function SortableHeader({
  label,
  keyName,
  sortKey,
  sortDir,
  onSort,
  align = 'left',
  className,
}: {
  label: string;
  keyName: PatientListSortKey;
  sortKey: PatientListSortKey;
  sortDir: 'asc' | 'desc';
  onSort: (key: PatientListSortKey) => void;
  align?: 'left' | 'right';
  className?: string;
}) {
  return (
    <th
      className={cn(
        'px-3 py-3',
        align === 'right' && 'text-right',
        className,
      )}
    >
      <button
        type="button"
        className={cn(
          'inline-flex items-center gap-1 hover:text-foreground',
          align === 'right' && 'justify-end',
        )}
        onClick={() => onSort(keyName)}
      >
        {label}
        {sortKey === keyName && (
          <span className="text-[10px]">{sortDir === 'asc' ? '↑' : '↓'}</span>
        )}
      </button>
    </th>
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
  const { organization } = useOrganization();
  const practiceName = organization?.name ?? 'Practice';

  const {
    isLoading,
    isError,
    error,
    refetch,
    search,
    onSearchChange,
    pageRows,
    totalRows,
    hasSyncedPatients,
    page,
    setPage,
    pageSize,
    totalPages,
    sortKey,
    sortDir,
    toggleSort,
  } = usePatientFinancialRecordListTable();

  useEffect(() => {
    if (
      expandedPatientId &&
      !pageRows.some((row) => row.patientId === expandedPatientId)
    ) {
      onClearExpand();
    }
  }, [page, pageRows, expandedPatientId, onClearExpand]);

  return (
    <div className="rounded-[14px] border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h2 className="text-lg font-bold text-foreground">Patient Financial Records</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Revenue (Dentally) − cost (attributed) = contribution (Derived). Click any row for
            the breakdown below.
          </p>
        </div>
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search patient…"
            className="pl-9"
          />
        </div>
      </div>

      {isError && (
        <div className="flex items-start gap-2 border-b border-border px-5 py-4 text-sm text-danger-strong">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div className="font-semibold">Could not load patient records</div>
            <div className="text-danger">{error?.message}</div>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => refetch()}>
              Retry
            </Button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[960px] text-[13px]">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <th className="w-8 px-3 py-3" />
              <th className="px-3 py-3">Patient</th>
              <th className="px-3 py-3">Practice</th>
              <th className="px-3 py-3">Status</th>
              <th className="px-3 py-3 text-right">Revenue</th>
              <th className="px-3 py-3 text-right">Cost</th>
              <SortableHeader
                label="Contribution"
                keyName="contribution"
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={toggleSort}
                align="right"
              />
              <SortableHeader
                label="Opportunity (wtd)"
                keyName="opportunityWeighted"
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={toggleSort}
                align="right"
              />
              <SortableHeader
                label="Econ. value"
                keyName="patientEconomicValue"
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={toggleSort}
                align="right"
              />
              <SortableHeader
                label="Quality"
                keyName="qualityScore"
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={toggleSort}
                align="right"
                className="px-5"
              />
            </tr>
          </thead>
          <tbody>
            {isLoading &&
              Array.from({ length: pageSize }).map((_, i) => (
                <tr key={i} className="border-b border-border/60">
                  {Array.from({ length: 10 }).map((_, j) => (
                    <td key={j} className="px-3 py-3">
                      <Skeleton className="h-4 w-full" />
                    </td>
                  ))}
                </tr>
              ))}

            {!isLoading && !isError && !hasSyncedPatients && (
              <tr>
                <td colSpan={10} className="px-5 py-12 text-center text-muted-foreground">
                  No patient economics data yet. Run PE sync after connecting Dentally.
                </td>
              </tr>
            )}

            {!isLoading &&
              !isError &&
              pageRows.map((row) => {
                const selected = selectedPatientId === row.patientId;
                const expanded = expandedPatientId === row.patientId;
                return (
                  <Fragment key={row.patientId}>
                    <tr
                      className={cn(
                        'border-b border-border/60 cursor-pointer transition-colors',
                        selected ? 'bg-primary/6 hover:bg-primary/8' : 'hover:bg-muted/30',
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
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-foreground">{row.patientName}</span>
                        {row.patientUuid && (
                          <a
                            href={`https://app.dentally.co/patients/${row.patientUuid}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-muted-foreground hover:text-primary"
                            title="Open in Dentally"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">{practiceName}</td>
                    <td className="px-3 py-3 text-left">
                      <PatientTypeStatusBadge row={row} />
                    </td>
                    <td className="px-3 py-3 text-right">
                      <RosterMoneyCell value={row.revenuePrivatePlan} />
                    </td>
                    <td className="px-3 py-3 text-right">
                      <RosterMoneyCell value={row.directCost} tone="danger" />
                    </td>
                    <td className="px-3 py-3 text-right">
                      <RosterMoneyCell
                        value={row.contribution}
                        tone={row.contribution < 0 ? 'danger' : 'success'}
                        bold
                      />
                    </td>
                    <td className="px-3 py-3 text-right">
                      <RosterMoneyCell
                        value={patientOpportunityMetrics(row).probabilityWeighted}
                        tone="primary"
                      />
                    </td>
                    <td className="px-3 py-3 text-right">
                      <RosterMoneyCell value={row.patientEconomicValue} bold />
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end">
                        <QualityScoreCell score={row.qualityScore} />
                      </div>
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

      {!isLoading && !isError && hasSyncedPatients && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3 text-[12px] text-muted-foreground">
          <span>
            {totalRows > 0
              ? `Showing ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, totalRows)} of ${totalRows.toLocaleString('en-GB')} patients with invoice contribution data`
              : 'No patients match your search'}
            {search.trim() ? ' (filtered)' : ''}
          </span>
          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
              >
                <ChevronLeft className="h-4 w-4" />
                Previous
              </Button>
              <span className="tabular-nums">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
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

          <div className={cn(PE_CTX_BANNER_CLASS, 'mt-4')}>
            <div className="text-[11px] font-bold uppercase tracking-wide text-primary">
              Recommended action
            </div>
            <p className="mt-2 text-[13px] leading-relaxed text-foreground">
              {recommendedActionDetail(
                c.recommendedAction,
                grossContributionOpportunity,
                probabilityWeighted,
              )}
            </p>
          </div>

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
    if (patientId === id) {
      next.delete('patientId');
    } else {
      next.set('patientId', id);
    }
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
