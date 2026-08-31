/**
 * PE Invoices — aged debt, collection rate, outstanding worklist (mockup-aligned).
 */

import { useMemo } from 'react';
import { AlertCircle, FileText } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AgedDebtChart,
  CollectionRateByPracticeChart,
  formatGbpCompact,
} from '@/components/patient-economics/InvoicesCharts';
import { InvoicesListTable } from '@/components/patient-economics/InvoicesListTable';
import { ProvenanceChip } from '@/components/patient-economics/ProvenanceChip';
import { useOrganization } from '@/hooks/useOrganization';
import { usePeInvoicesSummary } from '@/hooks/usePeInvoicesSummary';
import {
  PE_AGING_BUCKET_LABELS,
  PE_AGING_BUCKET_ORDER,
  type PeAgingBucketId,
} from '@/lib/peInvoicesConstants';
import type { PeAgedDebtBucket, PeInvoicesSummary } from '@/services/integrations/peInvoicesService';
import { cn } from '@/lib/utils';
import { PE_CTX_BANNER_CLASS } from '@/lib/peVisualTokens';

function formatPct(rate: number | null): string {
  if (rate == null) return '—';
  return `${Math.round(rate * 100)}%`;
}

function buildGroupAgedBuckets(rows: PeInvoicesSummary['invoiceListRows']): PeAgedDebtBucket[] {
  const totals = new Map<PeAgingBucketId, { gbp: number; count: number }>();
  for (const id of PE_AGING_BUCKET_ORDER) {
    totals.set(id, { gbp: 0, count: 0 });
  }
  for (const row of rows) {
    if (!row.isOutstanding) continue;
    const t = totals.get(row.agingBucket)!;
    t.gbp += row.outstandingGbp;
    t.count += 1;
  }
  return PE_AGING_BUCKET_ORDER.map((bucket) => ({
    bucket,
    label: PE_AGING_BUCKET_LABELS[bucket],
    outstandingGbp: Math.round(totals.get(bucket)!.gbp * 100) / 100,
    invoiceCount: totals.get(bucket)!.count,
  }));
}

function HeroCard({
  tone = 'default',
  question,
  value,
  subtitle,
}: {
  tone?: 'default' | 'success' | 'risk' | 'warn';
  question: string;
  value: string;
  subtitle: React.ReactNode;
}) {
  const bar =
    tone === 'success'
      ? 'bg-success'
      : tone === 'risk'
        ? 'bg-danger'
        : tone === 'warn'
          ? 'bg-warning'
          : 'bg-primary';
  const valueCls =
    tone === 'success'
      ? 'text-success'
      : tone === 'risk'
        ? 'text-danger-strong'
        : tone === 'warn'
          ? 'text-warning'
          : 'text-foreground';

  return (
    <div className="relative overflow-hidden rounded-[14px] border border-border bg-card px-4 py-4 pb-[15px] shadow-sm">
      <div className={cn('absolute inset-x-0 top-0 h-[3px]', bar)} />
      <div className="mb-[9px] min-h-[26px] text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
        {question}
      </div>
      <div className={cn('text-[28px] font-extrabold tracking-tight', valueCls)}>{value}</div>
      <div className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">{subtitle}</div>
    </div>
  );
}

export function Invoices() {
  const { organizationId } = useOrganization();
  const summaryQuery = usePeInvoicesSummary();
  const data = summaryQuery.data;

  const heroes = useMemo(() => {
    if (!data) return null;

    const invoicedAll = data.collectionByPractice.reduce((s, r) => s + r.invoicedGbp, 0);
    const collectedAll = data.collectionByPractice.reduce((s, r) => s + r.collectedGbp, 0);
    const collectionRateAll =
      invoicedAll > 0 ? Math.round((collectedAll / invoicedAll) * 1000) / 1000 : null;

    const outstandingRows = data.invoiceListRows.filter((r) => r.isOutstanding);
    const totalOutstanding = outstandingRows.reduce((s, r) => s + r.outstandingGbp, 0);
    const overdue60Plus = outstandingRows
      .filter((r) => r.daysPastDue > 60)
      .reduce((s, r) => s + r.outstandingGbp, 0);

    const agedBuckets = buildGroupAgedBuckets(data.invoiceListRows);

    return {
      invoicedAll,
      collectedAll,
      collectionRateAll,
      totalOutstanding,
      overdue60Plus,
      agedBuckets,
    };
  }, [data]);

  return (
    <div className="space-y-5">
      <div className={cn(PE_CTX_BANNER_CLASS, 'items-start')}>
        <FileText className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
        <p>
          This is the <b className="text-foreground">Charged → Collected</b> step of the Treatment
          Economic Journey made actionable. Treatment done but not collected is contribution
          already earned and sitting at risk.
        </p>
      </div>

      {summaryQuery.isLoading && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-[108px] rounded-[14px]" />
            ))}
          </div>
          <div className="grid gap-5 xl:grid-cols-2">
            <Skeleton className="h-[280px] rounded-[14px]" />
            <Skeleton className="h-[280px] rounded-[14px]" />
          </div>
          <Skeleton className="h-[320px] rounded-[14px]" />
        </div>
      )}

      {summaryQuery.isError && (
        <div className="rounded-[14px] border border-destructive/30 bg-destructive/5 px-4 py-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">Could not load invoices</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {(summaryQuery.error as Error)?.message ?? 'Unknown error'}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => summaryQuery.refetch()}
              >
                Retry
              </Button>
            </div>
          </div>
        </div>
      )}

      {summaryQuery.isSuccess && data && heroes && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <HeroCard
              question={`Invoiced · ${data.trailingMonths}mo`}
              value={formatGbpCompact(heroes.invoicedAll)}
              subtitle="Across all practices"
            />
            <HeroCard
              tone="success"
              question="Collected"
              value={formatGbpCompact(heroes.collectedAll)}
              subtitle={
                <>
                  {formatPct(heroes.collectionRateAll)} collection rate{' '}
                  <ProvenanceChip kind="dentally" />
                </>
              }
            />
            <HeroCard
              tone="risk"
              question="Outstanding"
              value={formatGbpCompact(heroes.totalOutstanding)}
              subtitle="Unpaid, all ages"
            />
            <HeroCard
              tone="warn"
              question="Overdue > 60d"
              value={formatGbpCompact(heroes.overdue60Plus)}
              subtitle="Past terms, needs chasing"
            />
            <HeroCard
              question="On payment plan"
              value={formatGbpCompact(data.onPaymentPlanOutstandingGbp)}
              subtitle={
                data.onPaymentPlanArrangementCount > 0
                  ? `${data.onPaymentPlanArrangementCount} active arrangements`
                  : 'No outstanding on payment plan'
              }
            />
          </div>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <div className="rounded-[14px] border border-border bg-card px-5 py-[18px] shadow-sm">
              <h3 className="text-[15px] font-bold text-foreground">Aged debt</h3>
              <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                Outstanding balance by age bucket
              </p>
              <div className="mt-4">
                {heroes.totalOutstanding <= 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    No outstanding invoice balances — collection looks clean.
                  </p>
                ) : (
                  <AgedDebtChart buckets={heroes.agedBuckets} />
                )}
              </div>
            </div>

            <div className="rounded-[14px] border border-border bg-card px-5 py-[18px] shadow-sm">
              <h3 className="text-[15px] font-bold text-foreground">Collection rate by practice</h3>
              <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                Collected in PMS · recorded in Dentally, not bank settlement
              </p>
              <div className="mt-4">
                {data.collectionByPractice.every((r) => r.invoicedGbp <= 0) ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    No invoiced activity in the last {data.trailingMonths} months.
                  </p>
                ) : (
                  <CollectionRateByPracticeChart
                    rows={data.collectionByPractice}
                    trailingMonths={data.trailingMonths}
                  />
                )}
              </div>
            </div>
          </div>

          <InvoicesListTable
            rows={data.invoiceListRows}
            contextPracticeId={organizationId}
            cashLeakageWindowDays={data.cashLeakageWindowDays}
            trailingMonths={data.trailingMonths}
            cashLeakageCount={data.cashLeakageCount}
            cashLeakageGbp={data.cashLeakageGbp}
          />

          <p className="text-[11.5px] text-muted-foreground">
            Collection window: last {data.trailingMonths} months (
            <code className="text-[10px]">collection_rate_trailing_months</code>). Cash leakage
            window: {data.cashLeakageWindowDays} days from invoice date (
            <code className="text-[10px]">cash_leakage_collection_window_days</code>). Aging uses due
            date when present. Configure in{' '}
            <Link to="/patients?tab=settings" className="text-primary underline-offset-2 hover:underline">
              Settings
            </Link>{' '}
            when exposed.
          </p>
        </>
      )}
    </div>
  );
}
