import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { usePeScopedRead } from '@/hooks/usePeScopedRead';
import {
  fetchInvoicesAgedDebtApi,
  fetchInvoicesCollectionByLocationApi,
  fetchInvoicesHeroApi,
  fetchInvoicesListApi,
} from '@/services/integrations/patientEconomicsService';
import type {
  PeInvoicesAgedDebt,
  PeInvoicesCollectionByLocation,
  PeInvoicesHero,
  PeInvoicesList,
  PeInvoicesListParams,
  PeInvoicesSummary,
} from '@/services/integrations/peInvoicesTypes';
import { PE_READ_STALE_MS } from '@/lib/peReadStaleTime';

const DEFAULT_LIST_PARAMS: PeInvoicesListParams = {
  page: 1,
  pageSize: 5,
  sort: 'outstanding',
  sortDir: 'desc',
  search: '',
  statusFilter: 'all',
  cashLeakageOnly: false,
};

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function mapInvoiceListRows(
  rows: Array<Record<string, unknown>> | undefined,
): PeInvoicesList['invoiceListRows'] {
  return (rows ?? []).map((raw) => ({
    practiceId: String(raw.practiceId ?? ''),
    practiceName: String(raw.practiceName ?? 'Practice'),
    platformInvoiceId: String(raw.platformInvoiceId ?? ''),
    invoiceNumber: raw.invoiceNumber != null ? String(raw.invoiceNumber) : null,
    invoiceDate: raw.invoiceDate != null ? String(raw.invoiceDate) : null,
    dueDate: raw.dueDate != null ? String(raw.dueDate) : null,
    amountGbp: num(raw.amountGbp),
    outstandingGbp: num(raw.outstandingGbp),
    daysPastDue: num(raw.daysPastDue),
    daysSinceRaised: num(raw.daysSinceRaised),
    agingBucket: String(raw.agingBucket ?? '0-30') as PeInvoicesList['invoiceListRows'][0]['agingBucket'],
    status: String(raw.status ?? ''),
    isPaid: raw.isPaid === true,
    isPaidInPms:
      raw.isPaidInPms === true ||
      (raw.isPaidInPms !== false &&
        String(raw.status ?? '').toLowerCase().trim() === 'paid'),
    isOutstanding: raw.isOutstanding === true,
    isCashLeakage: raw.isCashLeakage === true,
    patientId: raw.patientId == null ? null : num(raw.patientId),
    dentallyPatientUuid:
      raw.dentallyPatientUuid != null ? String(raw.dentallyPatientUuid) : null,
    patientRecordId: raw.patientRecordId != null ? String(raw.patientRecordId) : null,
    patientName: raw.patientName != null ? String(raw.patientName) : null,
    onPaymentPlan: raw.onPaymentPlan === true,
    invoiceUuid: raw.invoiceUuid != null ? String(raw.invoiceUuid) : null,
    accountUuid: raw.accountUuid != null ? String(raw.accountUuid) : null,
    dentallyInvoiceUrl:
      raw.dentallyInvoiceUrl != null ? String(raw.dentallyInvoiceUrl) : null,
    locationId: raw.locationId != null ? String(raw.locationId) : null,
    locationName: raw.locationName != null ? String(raw.locationName) : null,
  }));
}

function mapAgedBuckets(
  buckets: Array<{ bucket: string; label: string; outstandingGbp: number; invoiceCount: number }> | undefined,
): PeInvoicesAgedDebt['agedBuckets'] {
  return (buckets ?? []).map((b) => ({
    bucket: b.bucket as PeInvoicesAgedDebt['agedBuckets'][0]['bucket'],
    label: String(b.label),
    outstandingGbp: num(b.outstandingGbp),
    invoiceCount: num(b.invoiceCount),
  }));
}

export function usePeInvoicesHero() {
  const { organizationId, scopeKey, apiScope, enabled } = usePeScopedRead();
  const { user } = useAuth();

  return useQuery({
    queryKey: ['pe-invoices-hero', organizationId, user?.id, scopeKey],
    enabled: enabled && !!user?.id,
    staleTime: PE_READ_STALE_MS,
    queryFn: async (): Promise<PeInvoicesHero> => {
      const body = await fetchInvoicesHeroApi(organizationId!, apiScope);
      return {
        trailingMonths: num(body.trailingMonths) || 12,
        trailingSince: String(body.trailingSince),
        rollupMode: body.rollupMode === 'location' ? 'location' : 'practice',
        invoicedTrailingGbp: num(body.invoicedTrailingGbp),
        collectedTrailingGbp: num(body.collectedTrailingGbp),
        collectionRate: body.collectionRate == null ? null : num(body.collectionRate),
        totalOutstandingGbp: num(body.totalOutstandingGbp),
        overdue60PlusGbp: num(body.overdue60PlusGbp),
        onPaymentPlanOutstandingGbp: num(body.onPaymentPlanOutstandingGbp),
        onPaymentPlanArrangementCount: num(body.onPaymentPlanArrangementCount),
      };
    },
  });
}

export function usePeInvoicesAgedDebt() {
  const { organizationId, apiScope, scope, enabled } = usePeScopedRead();
  const { user } = useAuth();
  const locationScopeKey = scope.locationId ?? 'all';

  return useQuery({
    queryKey: ['pe-invoices-aged-debt', organizationId, user?.id, locationScopeKey],
    enabled: enabled && !!user?.id,
    staleTime: PE_READ_STALE_MS,
    queryFn: async (): Promise<PeInvoicesAgedDebt> => {
      const body = await fetchInvoicesAgedDebtApi(organizationId!, {
        locationId: apiScope.locationId,
      });
      return {
        trailingMonths: num(body.trailingMonths) || 12,
        rollupMode: body.rollupMode === 'location' ? 'location' : 'practice',
        totalOutstandingGbp: num(body.totalOutstandingGbp),
        agedBuckets: mapAgedBuckets(body.agedBuckets),
      };
    },
  });
}

export function usePeInvoicesCollectionByLocation() {
  const { organizationId, scopeKey, apiScope, enabled } = usePeScopedRead();
  const { user } = useAuth();

  return useQuery({
    queryKey: ['pe-invoices-collection-by-location', organizationId, user?.id, scopeKey],
    enabled: enabled && !!user?.id,
    staleTime: PE_READ_STALE_MS,
    queryFn: async (): Promise<PeInvoicesCollectionByLocation> => {
      const body = await fetchInvoicesCollectionByLocationApi(organizationId!, apiScope);
      return {
        trailingMonths: num(body.trailingMonths) || 12,
        rollupMode: body.rollupMode === 'location' ? 'location' : 'practice',
        collectionByPractice: (body.collectionByPractice ?? []).map((r) => ({
          practiceId: String(r.practiceId),
          practiceName: String(r.practiceName),
          invoicedGbp: num(r.invoicedGbp),
          collectedGbp: num(r.collectedGbp),
          collectionRate: r.collectionRate == null ? null : num(r.collectionRate),
        })),
      };
    },
  });
}

export function usePeInvoicesList() {
  const { organizationId, scopeKey, apiScope, enabled } = usePeScopedRead();
  const { user } = useAuth();
  const [listParams, setListParams] = useState<PeInvoicesListParams>(DEFAULT_LIST_PARAMS);
  const listKey = JSON.stringify(listParams);

  const query = useQuery({
    queryKey: ['pe-invoices-list', organizationId, user?.id, scopeKey, listKey],
    enabled: enabled && !!user?.id,
    staleTime: PE_READ_STALE_MS,
    queryFn: async (): Promise<PeInvoicesList> => {
      const body = await fetchInvoicesListApi(organizationId!, apiScope, listParams);
      return {
        trailingMonths: num(body.trailingMonths) || 12,
        cashLeakageWindowDays: num(body.cashLeakageWindowDays) || 30,
        cashLeakageCount: num(body.cashLeakageCount),
        cashLeakageGbp: num(body.cashLeakageGbp),
        rollupMode: body.rollupMode === 'location' ? 'location' : 'practice',
        invoiceListRows: mapInvoiceListRows(body.invoiceListRows),
        total: num(body.total),
        page: num(body.page) || 1,
        pageSize: num(body.pageSize) || 5,
        sort: String(body.sort || 'outstanding'),
        sortDir: body.sortDir === 'asc' ? 'asc' : 'desc',
      };
    },
  });

  return {
    ...query,
    listParams,
    setListParams,
  };
}

/** @deprecated Use the four split invoice hooks. */
export function usePeInvoicesSummary() {
  const hero = usePeInvoicesHero();
  const aged = usePeInvoicesAgedDebt();
  const collection = usePeInvoicesCollectionByLocation();
  const list = usePeInvoicesList();

  const data: PeInvoicesSummary | undefined =
    hero.data && aged.data && collection.data && list.data
      ? {
          trailingMonths: hero.data.trailingMonths,
          trailingSince: hero.data.trailingSince,
          cashLeakageWindowDays: list.data.cashLeakageWindowDays,
          cashLeakageCount: list.data.cashLeakageCount,
          cashLeakageGbp: list.data.cashLeakageGbp,
          totalOutstandingGbp: hero.data.totalOutstandingGbp,
          overdue60PlusGbp: hero.data.overdue60PlusGbp,
          collectedTrailingGbp: hero.data.collectedTrailingGbp,
          invoicedTrailingGbp: hero.data.invoicedTrailingGbp,
          collectionRate: hero.data.collectionRate,
          onPaymentPlanOutstandingGbp: hero.data.onPaymentPlanOutstandingGbp,
          onPaymentPlanArrangementCount: hero.data.onPaymentPlanArrangementCount,
          agedBuckets: aged.data.agedBuckets,
          invoiceListRows: list.data.invoiceListRows,
          collectionByPractice: collection.data.collectionByPractice,
          rollupMode: hero.data.rollupMode,
          total: list.data.total,
          page: list.data.page,
          pageSize: list.data.pageSize,
          sort: list.data.sort,
          sortDir: list.data.sortDir,
        }
      : undefined;

  return {
    data,
    isLoading: hero.isLoading || aged.isLoading || collection.isLoading || list.isLoading,
    isError: hero.isError || aged.isError || collection.isError || list.isError,
    error: hero.error || aged.error || collection.error || list.error,
    refetch: () => {
      void hero.refetch();
      void aged.refetch();
      void collection.refetch();
      void list.refetch();
    },
    isFetching: list.isFetching,
    listParams: list.listParams,
    setListParams: list.setListParams,
  };
}
