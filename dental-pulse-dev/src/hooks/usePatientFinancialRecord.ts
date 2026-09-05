import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { usePeScopedRead } from '@/hooks/usePeScopedRead';
import { useOrganization } from '@/hooks/useOrganization';
import {
  mapPatientContributionRow,
  type PatientContributionRow,
  type PatientListRetentionFilter,
  type PatientListSortKey,
  type PatientListTypeFilter,
  type PatientProvenanceStatus,
} from '@/hooks/usePatientContributionList';
import {
  fetchPatientFinancialRecordApi,
  fetchPatientFinancialRecordList,
  fetchPatientInvoicesApi,
  fetchPatientTreatmentLinesApi,
  type PePatientListParams,
} from '@/services/integrations/patientEconomicsService';
import type { PeRetentionStatus } from '@/lib/peRetentionConstants';
import { PE_OPPORTUNITY_WEIGHTED_TIER_NOTE } from '@/lib/peRetentionConstants';
import type { PeRetentionStatusTone } from '@/lib/peRetentionSegmentation';
import { parseRecommendedAction } from '@/lib/peRecommendedAction';

export type PatientInvoiceRow = {
  invoiceId: string;
  platformInvoiceId: string | null;
  invoiceDate: string | null;
  revenuePrivatePlan: number;
  revenueNhs: number;
  clinicianCost: number;
  labCost: number;
  materialsCost: number;
  directCost: number;
  contribution: number;
  privateShareRate: number | null;
  contributionProvenanceStatus: PatientProvenanceStatus;
  revenueTier: string;
  clinicianCostTier: string;
  contributionTier: string;
  confidenceScore: number | null;
  dentallyPatientUuid: string | null;
  invoiceUuid: string | null;
  accountUuid: string | null;
  dentallyInvoiceUrl: string | null;
};

export type PatientTreatmentLineRow = {
  lineId: string;
  treatmentLabel: string;
  date: string | null;
  clinicianName: string | null;
  revenue: number;
  cost: number;
  contribution: number;
};

export type PatientModelledScores = {
  cltvProjection: number;
  qualityScore: number;
  cltvTier: string;
  qualityScoreTier: string;
  confidenceScore: number;
  computedAt: string;
};

export type RetentionStatus = {
  status: PeRetentionStatus;
  label: string;
  tier: string;
  tone: PeRetentionStatusTone;
};

export type PatientFinancialRecordRow = PatientContributionRow & {
  cltvProjection: number | null;
  cltvTier: string | null;
  qualityScoreTier: string | null;
  modelledConfidenceScore: number | null;
  modelledComputedAt: string | null;
};

export type PatientFinancialRecord = {
  row: PatientFinancialRecordRow;
  modelled: PatientModelledScores | null;
  retention: RetentionStatus;
  invoices: PatientInvoiceRow[];
  acquisitionSourceName: string | null;
  recallHint: string | null;
};

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function parseProvenanceStatus(raw: string): PatientProvenanceStatus {
  if (raw === 'partial_no_practitioner' || raw === 'partial_missing_rate') return raw;
  return 'complete';
}

function mapFinancialRecordRow(raw: Record<string, unknown>): PatientFinancialRecordRow {
  const base = mapPatientContributionRow(raw);
  const cltvProjection =
    raw.cltvProjection == null || raw.cltvProjection === ''
      ? null
      : num(raw.cltvProjection);
  return {
    ...base,
    cltvProjection,
    cltvTier: cltvProjection != null ? String(raw.cltvTier || 'Modelled') : null,
    qualityScoreTier:
      cltvProjection != null ? String(raw.qualityScoreTier || 'Modelled') : null,
    modelledConfidenceScore:
      raw.modelledConfidenceScore == null ? null : num(raw.modelledConfidenceScore),
    modelledComputedAt:
      raw.modelledComputedAt != null && String(raw.modelledComputedAt).length > 0
        ? String(raw.modelledComputedAt)
        : null,
  };
}

function mapInvoiceRow(raw: Record<string, unknown>): PatientInvoiceRow {
  return {
    invoiceId: String(raw.invoiceId),
    platformInvoiceId:
      raw.platformInvoiceId != null ? String(raw.platformInvoiceId) : null,
    invoiceDate: raw.invoiceDate != null ? String(raw.invoiceDate) : null,
    revenuePrivatePlan: num(raw.revenuePrivatePlan),
    revenueNhs: num(raw.revenueNhs),
    clinicianCost: num(raw.clinicianCost),
    labCost: num(raw.labCost),
    materialsCost: num(raw.materialsCost),
    directCost: num(raw.directCost),
    contribution: num(raw.contribution),
    privateShareRate: raw.privateShareRate == null ? null : num(raw.privateShareRate),
    contributionProvenanceStatus: parseProvenanceStatus(
      String(raw.contributionProvenanceStatus || 'complete'),
    ),
    revenueTier: String(raw.revenueTier || 'Dentally'),
    clinicianCostTier: String(raw.clinicianCostTier || 'Derived'),
    contributionTier: String(raw.contributionTier || 'Derived'),
    confidenceScore: raw.confidenceScore == null ? null : num(raw.confidenceScore),
    dentallyPatientUuid:
      raw.dentallyPatientUuid != null ? String(raw.dentallyPatientUuid) : null,
    invoiceUuid: raw.invoiceUuid != null ? String(raw.invoiceUuid) : null,
    accountUuid: raw.accountUuid != null ? String(raw.accountUuid) : null,
    dentallyInvoiceUrl:
      raw.dentallyInvoiceUrl != null ? String(raw.dentallyInvoiceUrl) : null,
  };
}

function mapTreatmentLineRow(raw: Record<string, unknown>): PatientTreatmentLineRow {
  return {
    lineId: String(raw.lineId),
    treatmentLabel: String(raw.treatmentLabel || 'Treatment'),
    date: raw.date != null ? String(raw.date) : null,
    clinicianName: raw.clinicianName != null ? String(raw.clinicianName) : null,
    revenue: num(raw.revenue),
    cost: num(raw.cost),
    contribution: num(raw.contribution),
  };
}

function mapModelledScores(raw: Record<string, unknown> | null): PatientModelledScores | null {
  if (!raw) return null;
  return {
    cltvProjection: num(raw.cltvProjection),
    qualityScore: num(raw.qualityScore),
    cltvTier: String(raw.cltvTier || 'Modelled'),
    qualityScoreTier: String(raw.qualityScoreTier || 'Modelled'),
    confidenceScore: num(raw.confidenceScore),
    computedAt: String(raw.computedAt || ''),
  };
}

function mapRetention(raw: Record<string, unknown>): RetentionStatus {
  const status = String(raw.status || 'active') as PeRetentionStatus;
  return {
    status,
    label: String(raw.label || 'Active'),
    tier: String(raw.tier || 'Derived'),
    tone: (raw.tone as RetentionStatus['tone']) || 'active',
  };
}

export { PE_OPPORTUNITY_WEIGHTED_TIER_NOTE };

export function usePatientFinancialRecordList(listParams?: PePatientListParams) {
  const { organizationId, scopeKey, apiScope, enabled } = usePeScopedRead();

  return useQuery({
    queryKey: ['patient-financial-records', organizationId, scopeKey, listParams],
    enabled,
    queryFn: () => fetchPatientFinancialRecordList(organizationId!, apiScope, listParams),
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
  });
}

export function usePatientFinancialRecordListTable() {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<PatientListSortKey>('contribution');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  const [retentionFilter, setRetentionFilter] = useState<PatientListRetentionFilter>('all');
  const [typeFilter, setTypeFilter] = useState<PatientListTypeFilter>('all');

  const listParams: PePatientListParams = {
    page,
    pageSize,
    sort: sortKey,
    sortDir,
    search,
    retentionFilter,
    typeFilter,
  };

  const query = usePatientFinancialRecordList(listParams);

  const rollupMode =
    query.data?.rollupMode === 'location' ? 'location' : 'practice';

  const totalRows = query.data?.total ?? 0;
  const totalUnfiltered = query.data?.totalUnfiltered ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));

  useEffect(() => {
    if (query.data == null || query.isPlaceholderData) return;
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages, query.data, query.isPlaceholderData]);

  const pageRows = useMemo(
    () =>
      (query.data?.patients ?? []).map((row) =>
        mapFinancialRecordRow(row as Record<string, unknown>),
      ),
    [query.data?.patients],
  );

  const onSearchChange = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  const toggleSort = (key: PatientListSortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'patientName' ? 'asc' : 'desc');
    }
    setPage(1);
  };

  const onPageSizeChange = (size: number) => {
    setPageSize(size);
    setPage(1);
  };

  const onRetentionFilterChange = (value: PatientListRetentionFilter) => {
    setRetentionFilter(value);
    setPage(1);
  };

  const onTypeFilterChange = (value: PatientListTypeFilter) => {
    setTypeFilter(value);
    setPage(1);
  };

  return {
    ...query,
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
    rollupMode,
    hasSyncedPatients: totalUnfiltered > 0,
  };
}

async function fetchPatientFinancialRecord(
  practiceId: string,
  patientId: string,
): Promise<PatientFinancialRecord | null> {
  const payload = await fetchPatientFinancialRecordApi(practiceId, patientId);
  if (!payload?.row) return null;

  const row = mapFinancialRecordRow(payload.row as Record<string, unknown>);
  row.recommendedAction = parseRecommendedAction(row.recommendedAction);
  return {
    row,
    modelled: mapModelledScores(payload.modelled as Record<string, unknown> | null),
    retention: mapRetention(payload.retention as Record<string, unknown>),
    invoices: (payload.invoices ?? []).map((r) =>
      mapInvoiceRow(r as Record<string, unknown>),
    ),
    acquisitionSourceName: payload.acquisitionSourceName ?? null,
    recallHint: payload.recallHint ?? null,
  };
}

export function usePatientTreatmentLines(
  patientId: string | null | undefined,
  ptId: number | null | undefined,
) {
  const { organizationId } = useOrganization();

  return useQuery({
    queryKey: ['patient-treatment-lines', organizationId, patientId, ptId],
    enabled: !!organizationId && !!patientId,
    queryFn: async () => {
      const { lines } = await fetchPatientTreatmentLinesApi(
        organizationId!,
        patientId!,
        ptId ?? null,
      );
      return lines.map((row) => mapTreatmentLineRow(row as Record<string, unknown>));
    },
    staleTime: 60 * 1000,
  });
}

export function usePatientInvoices(patientId: string | null | undefined) {
  const { organizationId } = useOrganization();

  return useQuery({
    queryKey: ['patient-invoices', organizationId, patientId],
    enabled: !!organizationId && !!patientId,
    queryFn: async () => {
      const { invoices } = await fetchPatientInvoicesApi(organizationId!, patientId!);
      return invoices.map((row) => mapInvoiceRow(row as Record<string, unknown>));
    },
    staleTime: 60 * 1000,
  });
}

export function usePatientFinancialRecord(patientId: string | null | undefined) {
  const { organizationId } = useOrganization();

  return useQuery({
    queryKey: ['patient-financial-record', organizationId, patientId],
    enabled: !!organizationId && !!patientId,
    queryFn: () => fetchPatientFinancialRecord(organizationId!, patientId!),
    staleTime: 60 * 1000,
  });
}
