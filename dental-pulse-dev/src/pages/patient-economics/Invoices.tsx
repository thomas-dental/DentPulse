/**
 * PE Invoices — aged debt, collection rate, outstanding worklist (mockup-aligned).
 */

import { useEffect } from 'react';
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
import { usePeScopedRead } from '@/hooks/usePeScopedRead';
import {
  usePeInvoicesAgedDebt,
  usePeInvoicesCollectionByLocation,
  usePeInvoicesHero,
  usePeInvoicesList,
} from '@/hooks/usePeInvoicesSummary';
import { cn } from '@/lib/utils';
import { PE_CTX_BANNER_CLASS } from '@/lib/peVisualTokens';
import { peReadPending } from '@/lib/peReadLoading';

function formatPct(rate: number | null): string {
  if (rate == null) return '—';
  return `${Math.round(rate * 100)}%`;
}

function HeroCard({
  tone = 'default',
  question,
  value,
  subtitle,
  pending = false,
}: {
  tone?: 'default' | 'success' | 'risk' | 'warn';
  question: string;
  value: string;
  subtitle: React.ReactNode;
  pending?: boolean;
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
      {pending ? (
        <>
          <Skeleton className="h-8 w-[92px]" />
          <Skeleton className="mt-2 h-3.5 w-[140px]" />
        </>
      ) : (
        <>
          <div className={cn('text-[28px] font-extrabold tracking-tight', valueCls)}>{value}</div>
          <div className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">{subtitle}</div>
        </>
      )}
    </div>
  );
}

export function Invoices() {
  const { organizationId } = useOrganization();
  const { scopeKey } = usePeScopedRead();
  const heroQuery = usePeInvoicesHero();
  const agedQuery = usePeInvoicesAgedDebt();
  const collectionQuery = usePeInvoicesCollectionByLocation();
  const {
    data: listData,
    isLoading: listLoading,
    isFetching: listFetching,
    isError: listError,
    error: listErr,
    refetch: refetchList,
    listParams,
    setListParams,
  } = usePeInvoicesList();

  const hero = heroQuery.data;
  const aged = agedQuery.data;
  const collection = collectionQuery.data;
  const heroPending = peReadPending(heroQuery);
  const agedPending = peReadPending(agedQuery);
  const collectionPending = peReadPending(collectionQuery);
  const listPending = listLoading || listFetching;

  const isError = heroQuery.isError || agedQuery.isError || collectionQuery.isError || listError;
  const error = heroQuery.error || agedQuery.error || collectionQuery.error || listErr;

  useEffect(() => {
    setListParams((prev) => ({ ...prev, page: 1 }));
  }, [scopeKey]);

  const refetch = () => {
    void heroQuery.refetch();
    void agedQuery.refetch();
    void collectionQuery.refetch();
    void refetchList();
  };

  const rollupMode = hero?.rollupMode ?? collection?.rollupMode ?? listData?.rollupMode ?? 'location';

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

      {isError && !hero && !aged && !collection && !listData && (
        <div className="rounded-[14px] border border-destructive/30 bg-destructive/5 px-4 py-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">Could not load invoices</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {(error as Error)?.message ?? 'Unknown error'}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => refetch()}
              >
                Retry
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <HeroCard
          pending={heroPending}
          question={`Invoiced · ${hero?.trailingMonths ?? 12}mo`}
          value={hero ? formatGbpCompact(hero.invoicedTrailingGbp) : '—'}
          subtitle={rollupMode === 'location' ? 'Across all locations' : 'Across all practices'}
        />
        <HeroCard
          pending={heroPending}
          tone="success"
          question="Collected"
          value={hero ? formatGbpCompact(hero.collectedTrailingGbp) : '—'}
          subtitle={
            <>
              {formatPct(hero?.collectionRate ?? null)} collection rate{' '}
              <ProvenanceChip kind="dentally" />
            </>
          }
        />
        <HeroCard
          pending={heroPending}
          tone="risk"
          question="Outstanding"
          value={hero ? formatGbpCompact(hero.totalOutstandingGbp) : '—'}
          subtitle="Unpaid, all ages"
        />
        <HeroCard
          pending={heroPending}
          tone="warn"
          question="Overdue > 60d"
          value={hero ? formatGbpCompact(hero.overdue60PlusGbp) : '—'}
          subtitle="Past terms, needs chasing"
        />
        <HeroCard
          pending={heroPending}
          question="On payment plan"
          value={hero ? formatGbpCompact(hero.onPaymentPlanOutstandingGbp) : '—'}
          subtitle={
            hero && hero.onPaymentPlanArrangementCount > 0
              ? `${hero.onPaymentPlanArrangementCount} active arrangements`
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
            {agedPending ? (
              <Skeleton className="h-[200px] w-full rounded-[10px]" />
            ) : !aged || aged.totalOutstandingGbp <= 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No outstanding invoice balances — collection looks clean.
              </p>
            ) : (
              <AgedDebtChart key={scopeKey} buckets={aged.agedBuckets} />
            )}
          </div>
        </div>

        <div className="rounded-[14px] border border-border bg-card px-5 py-[18px] shadow-sm">
          <h3 className="text-[15px] font-bold text-foreground">
            Collection rate by {rollupMode === 'location' ? 'location' : 'practice'}
          </h3>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">
            Collected in PMS · recorded in Dentally, not bank settlement
          </p>
          <div className="mt-4">
            {collectionPending ? (
              <Skeleton className="h-[200px] w-full rounded-[10px]" />
            ) : !collection || collection.collectionByPractice.every((r) => r.invoicedGbp <= 0) ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No invoiced activity in the last {collection?.trailingMonths ?? 12} months.
              </p>
            ) : (
              <CollectionRateByPracticeChart
                key={scopeKey}
                rows={collection.collectionByPractice}
                trailingMonths={collection.trailingMonths}
              />
            )}
          </div>
        </div>
      </div>

      <InvoicesListTable
        rows={listData?.invoiceListRows ?? []}
        total={listData?.total ?? 0}
        listParams={listParams}
        onListParamsChange={(patch) =>
          setListParams((prev) => ({ ...prev, ...patch }))
        }
        isFetching={listPending}
        contextPracticeId={organizationId}
        cashLeakageWindowDays={listData?.cashLeakageWindowDays ?? 30}
        trailingMonths={listData?.trailingMonths ?? hero?.trailingMonths ?? 12}
        cashLeakageCount={listData?.cashLeakageCount ?? 0}
        cashLeakageGbp={listData?.cashLeakageGbp ?? 0}
        rollupMode={rollupMode}
        knownScopes={(collection?.collectionByPractice ?? []).map((r) => ({
          id: r.practiceId,
          name: r.practiceName,
        }))}
      />

      <p className="text-[11.5px] text-muted-foreground">
        Collection window: last {(hero ?? listData)?.trailingMonths ?? 12} months (
        <code className="text-[10px]">collection_rate_trailing_months</code>). Cash leakage
        window: {listData?.cashLeakageWindowDays ?? 30} days from invoice date (
        <code className="text-[10px]">cash_leakage_collection_window_days</code>). Aging uses due
        date when present. Configure in{' '}
        <Link to="/patients?tab=settings" className="text-primary underline-offset-2 hover:underline">
          Settings
        </Link>{' '}
        when exposed.
      </p>
    </div>
  );
}
