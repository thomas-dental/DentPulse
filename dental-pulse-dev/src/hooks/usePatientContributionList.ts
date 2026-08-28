import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';
import type { PeRetentionStatus, PeRetentionStatusTier } from '@/lib/peRetentionConstants';
import type { PeRecommendedAction } from '@/lib/peRecommendedAction';
import { parseRecommendedAction } from '@/lib/peRecommendedAction';

export type PatientProvenanceStatus =
  | 'complete'
  | 'partial_no_practitioner'
  | 'partial_missing_rate';

export type PatientListRetentionFilter = 'all' | 'active' | 'drifting' | 'lapsed';
export type PatientListTypeFilter = 'all' | 'private' | 'nhs' | 'member';

export type PatientContributionRow = {
  patientId: string;
  ptId: number | null;
  patientName: string;
  patientUuid: string | null;
  practiceName: string;
  isActive: boolean;
  hasPaymentPlan: boolean;
  contribution12mo: number;
  visits12mo: number;
  visitFreqPerYear: number | null;
  valuePerVisit: number | null;
  invoiceCount: number;
  invoicesWithRevenue: number;
  revenuePrivatePlan: number;
  clinicianCost: number;
  directCost: number;
  contribution: number;
  marginPct: number | null;
  invoicesComplete: number;
  invoicesPartialNoPractitioner: number;
  invoicesPartialMissingRate: number;
  pctComplete: number | null;
  contributionProvenanceStatus: PatientProvenanceStatus;
  revenueTier: string;
  clinicianCostTier: string;
  contributionTier: string;
  confidenceScore: number | null;
  retentionStatus: PeRetentionStatus;
  retentionStatusTier: PeRetentionStatusTier;
  opportunityGross: number;
  opportunityGrossTier: string;
  opportunityWeighted: number;
  opportunityWeightedTier: string;
  opportunityWeightedTierNote: string | null;
  patientEconomicValue: number;
  patientEconomicValueTier: string;
  patientEconomicValueTierNote: string | null;
  qualityScore: number;
  recommendedAction: PeRecommendedAction;
  recommendedActionTier: string;
  recommendedActionTierNote: string | null;
};

export type PatientListSortKey =
  | 'patientName'
  | 'ptId'
  | 'revenuePrivatePlan'
  | 'directCost'
  | 'contribution'
  | 'contribution12mo'
  | 'visitFreqPerYear'
  | 'valuePerVisit'
  | 'opportunityWeighted'
  | 'patientEconomicValue'
  | 'qualityScore';

export type PatientListSummary = {
  totalPatients: number;
  activePatients: number;
  retentionActiveCount: number;
  retentionDriftingCount: number;
  retentionLapsedCount: number;
  privatePlanPatients: number;
  memberPatients: number;
  privateTypePatients: number;
  nhsTypePatients: number;
  averageContribution: number;
  averageProjectedLtv: number;
};

const PAGE_SIZE = 1000;
const PATIENT_META_CHUNK = 500;

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function displayName(
  rawName: string | null | undefined,
  ptId: number | null,
): string {
  const trimmed = String(rawName ?? '').trim();
  if (trimmed) return trimmed;
  if (ptId != null) return `Patient #${ptId}`;
  return 'Unknown patient';
}

function parseRetentionStatus(raw: unknown): PeRetentionStatus {
  const s = String(raw || 'active').toLowerCase();
  if (s === 'drifting' || s === 'lapsed' || s === 'healthy') return s;
  return 'active';
}

function parseRetentionStatusTier(raw: unknown): PeRetentionStatusTier {
  return String(raw || 'Derived') === 'Modelled' ? 'Modelled' : 'Derived';
}

export function dataQualityLabel(status: PatientProvenanceStatus): string {
  if (status === 'partial_no_practitioner') return 'No practitioner';
  if (status === 'partial_missing_rate') return 'Missing rate';
  return 'Derived';
}

function twelveMonthsAgoIsoDate(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 12);
  return d.toISOString().slice(0, 10);
}

async function fetchContribution12moByPatient(practiceId: string): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const since = twelveMonthsAgoIsoDate();
  let offset = 0;

  for (let page = 0; page < 100; page++) {
    const { data, error } = await (supabase as any)
      .from('v_invoice_contribution')
      .select('patient_id, contribution')
      .eq('practice_id', practiceId)
      .gte('invoice_date', since)
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw error;

    const batch = data ?? [];
    for (const row of batch) {
      if (row.patient_id == null) continue;
      const pid = String(row.patient_id);
      map.set(pid, (map.get(pid) ?? 0) + num(row.contribution));
    }

    if (batch.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return map;
}

async function fetchCompletedVisits12moByPtId(practiceId: string): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  const since = twelveMonthsAgoIsoDate();
  let offset = 0;

  for (let page = 0; page < 100; page++) {
    const { data, error } = await supabase
      .from('appointments')
      .select('apmt_patient_id, apmt_completed_at, apmt_state')
      .eq('organization_id', practiceId)
      .gte('apmt_completed_at', `${since}T00:00:00`)
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw error;

    const batch = data ?? [];
    for (const row of batch) {
      const ptId = row.apmt_patient_id;
      if (ptId == null || !Number.isFinite(Number(ptId))) continue;
      const state = String(row.apmt_state ?? '').toLowerCase().trim();
      if (state === 'cancelled' || state === 'did not attend' || state === 'dna') continue;
      if (!row.apmt_completed_at && state !== 'completed') continue;
      const n = Number(ptId);
      map.set(n, (map.get(n) ?? 0) + 1);
    }

    if (batch.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return map;
}

function attachTwelveMonthMetrics(
  rows: PatientContributionRow[],
  contribution12mo: Map<string, number>,
  visitsByPtId: Map<number, number>,
): PatientContributionRow[] {
  return rows.map((row) => {
    const c12 = contribution12mo.get(row.patientId) ?? 0;
    const visits =
      row.ptId != null ? (visitsByPtId.get(row.ptId) ?? 0) : 0;
    const visitFreqPerYear = visits > 0 ? visits : null;
    const valuePerVisit =
      visits > 0 && c12 > 0 ? c12 / visits : visits > 0 ? 0 : null;

    return {
      ...row,
      contribution12mo: c12,
      visits12mo: visits,
      visitFreqPerYear,
      valuePerVisit,
    };
  });
}

async function enrichPatientMetadata(
  practiceId: string,
  rows: PatientContributionRow[],
): Promise<PatientContributionRow[]> {
  if (rows.length === 0) return rows;

  const meta = new Map<string, { isActive: boolean; hasPaymentPlan: boolean }>();
  const ids = rows.map((r) => r.patientId);

  for (let i = 0; i < ids.length; i += PATIENT_META_CHUNK) {
    const chunk = ids.slice(i, i + PATIENT_META_CHUNK);
    const { data, error } = await supabase
      .from('patients')
      .select('id, is_active, pt_payment_plan_id')
      .eq('organization_id', practiceId)
      .in('id', chunk);

    if (error) throw error;

    for (const row of data ?? []) {
      meta.set(String(row.id), {
        isActive: row.is_active === true,
        hasPaymentPlan: row.pt_payment_plan_id != null,
      });
    }
  }

  return rows.map((row) => {
    const m = meta.get(row.patientId);
    return {
      ...row,
      isActive: m?.isActive ?? false,
      hasPaymentPlan: m?.hasPaymentPlan ?? false,
    };
  });
}

async function fetchAllPatientRows(
  practiceId: string,
  practiceName: string,
): Promise<PatientContributionRow[]> {
  const all: PatientContributionRow[] = [];
  let offset = 0;

  for (let page = 0; page < 50; page++) {
    const { data, error } = await (supabase as any)
      .from('v_patient_contribution')
      .select('*')
      .eq('practice_id', practiceId)
      .order('contribution', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw error;

    const rows = (data ?? []) as Record<string, unknown>[];
    for (const row of rows) {
      const status = String(row.contribution_provenance_status || 'complete');
      const ptIdRaw = row.pt_id;
      const ptId =
        ptIdRaw == null || ptIdRaw === ''
          ? null
          : Number.isFinite(Number(ptIdRaw))
            ? Number(ptIdRaw)
            : null;

      all.push({
        patientId: String(row.patient_id),
        ptId,
        patientName: displayName(row.patient_name as string, ptId),
        patientUuid:
          row.patient_uuid != null && String(row.patient_uuid).length > 0
            ? String(row.patient_uuid)
            : null,
        practiceName,
        isActive: false,
        hasPaymentPlan: false,
        contribution12mo: 0,
        visits12mo: 0,
        visitFreqPerYear: null,
        valuePerVisit: null,
        invoiceCount: num(row.invoice_count),
        invoicesWithRevenue: num(row.invoices_with_revenue),
        revenuePrivatePlan: num(row.revenue_private_plan),
        clinicianCost: num(row.clinician_cost),
        directCost: num(row.direct_cost),
        contribution: num(row.contribution),
        marginPct: row.margin_pct == null ? null : num(row.margin_pct),
        invoicesComplete: num(row.invoices_complete),
        invoicesPartialNoPractitioner: num(row.invoices_partial_no_practitioner),
        invoicesPartialMissingRate: num(row.invoices_partial_missing_rate),
        pctComplete: row.pct_complete == null ? null : num(row.pct_complete),
        contributionProvenanceStatus:
          status === 'partial_no_practitioner' || status === 'partial_missing_rate'
            ? status
            : 'complete',
        revenueTier: String(row.revenue_tier || 'Dentally'),
        clinicianCostTier: String(row.clinician_cost_tier || 'Derived'),
        contributionTier: String(row.contribution_tier || 'Derived'),
        confidenceScore: row.confidence_score == null ? null : num(row.confidence_score),
        retentionStatus: parseRetentionStatus(row.retention_status),
        retentionStatusTier: parseRetentionStatusTier(row.retention_status_tier),
        opportunityGross: num(row.opportunity_gross),
        opportunityGrossTier: String(row.opportunity_gross_tier || 'Derived'),
        opportunityWeighted: num(row.opportunity_weighted),
        opportunityWeightedTier: String(row.opportunity_weighted_tier || 'Modelled'),
        opportunityWeightedTierNote:
          row.opportunity_weighted_tier_note != null
            ? String(row.opportunity_weighted_tier_note)
            : null,
        patientEconomicValue: num(row.patient_economic_value),
        patientEconomicValueTier: String(row.patient_economic_value_tier || 'Modelled'),
        patientEconomicValueTierNote:
          row.patient_economic_value_tier_note != null
            ? String(row.patient_economic_value_tier_note)
            : null,
        qualityScore: num(row.quality_score),
        recommendedAction: parseRecommendedAction(row.recommended_action),
        recommendedActionTier: String(row.recommended_action_tier || 'Modelled'),
        recommendedActionTierNote:
          row.recommended_action_tier_note != null
            ? String(row.recommended_action_tier_note)
            : null,
      });
    }

    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  const withMeta = await enrichPatientMetadata(practiceId, all);
  const [contribution12mo, visitsByPtId] = await Promise.all([
    fetchContribution12moByPatient(practiceId),
    fetchCompletedVisits12moByPtId(practiceId),
  ]);
  return attachTwelveMonthMetrics(withMeta, contribution12mo, visitsByPtId);
}

export function isPrivatePlanPatient(row: PatientContributionRow): boolean {
  return row.revenuePrivatePlan > 0 || row.hasPaymentPlan;
}

export function patientTypeLabel(row: PatientContributionRow): 'Member' | 'Private' | 'NHS' | null {
  if (row.hasPaymentPlan) return 'Member';
  if (row.revenuePrivatePlan > 0) return 'Private';
  if (row.contribution > 0 || row.invoiceCount > 0) return 'NHS';
  return null;
}

export function retentionListLabel(status: PeRetentionStatus): string {
  if (status === 'healthy' || status === 'active') return 'Active';
  if (status === 'drifting') return 'Drifting';
  if (status === 'lapsed') return 'Lapsed';
  return 'Active';
}

export function filterPatientRowsByChips(
  rows: PatientContributionRow[],
  retentionFilter: PatientListRetentionFilter,
  typeFilter: PatientListTypeFilter,
): PatientContributionRow[] {
  let out = rows;

  if (retentionFilter !== 'all') {
    out = out.filter((row) => {
      if (retentionFilter === 'active') {
        return row.retentionStatus === 'active' || row.retentionStatus === 'healthy';
      }
      if (retentionFilter === 'drifting') return row.retentionStatus === 'drifting';
      if (retentionFilter === 'lapsed') return row.retentionStatus === 'lapsed';
      return true;
    });
  }

  if (typeFilter !== 'all') {
    out = out.filter((row) => {
      const type = patientTypeLabel(row);
      if (typeFilter === 'member') return type === 'Member';
      if (typeFilter === 'private') return type === 'Private';
      if (typeFilter === 'nhs') return type === 'NHS';
      return true;
    });
  }

  return out;
}

export function computePatientListSummary(rows: PatientContributionRow[]): PatientListSummary {
  const totalPatients = rows.length;
  if (totalPatients === 0) {
    return {
      totalPatients: 0,
      activePatients: 0,
      retentionActiveCount: 0,
      retentionDriftingCount: 0,
      retentionLapsedCount: 0,
      privatePlanPatients: 0,
      memberPatients: 0,
      privateTypePatients: 0,
      nhsTypePatients: 0,
      averageContribution: 0,
      averageProjectedLtv: 0,
    };
  }

  let activePatients = 0;
  let retentionActiveCount = 0;
  let retentionDriftingCount = 0;
  let retentionLapsedCount = 0;
  let privatePlanPatients = 0;
  let memberPatients = 0;
  let privateTypePatients = 0;
  let nhsTypePatients = 0;
  let contributionSum = 0;
  let ltvSum = 0;

  for (const row of rows) {
    if (row.isActive) activePatients += 1;
    if (row.retentionStatus === 'active' || row.retentionStatus === 'healthy') {
      retentionActiveCount += 1;
    }
    if (row.retentionStatus === 'drifting') retentionDriftingCount += 1;
    if (row.retentionStatus === 'lapsed') retentionLapsedCount += 1;
    if (isPrivatePlanPatient(row)) privatePlanPatients += 1;
    const type = patientTypeLabel(row);
    if (type === 'Member') memberPatients += 1;
    if (type === 'Private') privateTypePatients += 1;
    if (type === 'NHS') nhsTypePatients += 1;
    contributionSum += row.contribution12mo;
    ltvSum += row.patientEconomicValue;
  }

  return {
    totalPatients,
    activePatients,
    retentionActiveCount,
    retentionDriftingCount,
    retentionLapsedCount,
    privatePlanPatients,
    memberPatients,
    privateTypePatients,
    nhsTypePatients,
    averageContribution: contributionSum / totalPatients,
    averageProjectedLtv: ltvSum / totalPatients,
  };
}

export type PatientListSecondaryKpi = {
  label: string;
  value: string;
  subtitle: string;
  tone: 'default' | 'qual' | 'opp' | 'warn' | 'danger';
};

export type PatientListTertiaryKpi = {
  label: string;
  value: string;
  subtitle: string;
  tone: 'default' | 'qual' | 'opp';
};

/** KPI cards 2 & 3 follow the selected retention / type chips (not static Active + %). */
export function patientListSecondaryKpi(
  retentionFilter: PatientListRetentionFilter,
  filterSummary: PatientListSummary,
  baselineSummary: PatientListSummary,
): PatientListSecondaryKpi {
  if (retentionFilter === 'drifting') {
    return {
      label: 'Drifting',
      value: filterSummary.retentionDriftingCount.toLocaleString('en-GB'),
      subtitle: 'Recall overdue or visit gap risk',
      tone: 'warn',
    };
  }
  if (retentionFilter === 'lapsed') {
    return {
      label: 'Lapsed',
      value: filterSummary.retentionLapsedCount.toLocaleString('en-GB'),
      subtitle: 'Inactive or no visit in 12+ months',
      tone: 'danger',
    };
  }
  if (retentionFilter === 'active') {
    return {
      label: 'Active',
      value: filterSummary.retentionActiveCount.toLocaleString('en-GB'),
      subtitle: 'Healthy or on recall track',
      tone: 'qual',
    };
  }
  return {
    label: 'Active',
    value: baselineSummary.retentionActiveCount.toLocaleString('en-GB'),
    subtitle: `Of ${baselineSummary.totalPatients.toLocaleString('en-GB')} synced patients`,
    tone: 'qual',
  };
}

export function patientListTertiaryKpi(
  typeFilter: PatientListTypeFilter,
  retentionFilter: PatientListRetentionFilter,
  filterSummary: PatientListSummary,
  baselineSummary: PatientListSummary,
): PatientListTertiaryKpi {
  const total = filterSummary.totalPatients;

  if (typeFilter === 'member') {
    return {
      label: 'Member',
      value: filterSummary.memberPatients.toLocaleString('en-GB'),
      subtitle:
        total > 0
          ? `${Math.round((filterSummary.memberPatients / total) * 100)}% of filtered patients`
          : 'Payment plan patients',
      tone: 'opp',
    };
  }
  if (typeFilter === 'private') {
    return {
      label: 'Private',
      value: filterSummary.privateTypePatients.toLocaleString('en-GB'),
      subtitle:
        total > 0
          ? `${Math.round((filterSummary.privateTypePatients / total) * 100)}% of filtered patients`
          : 'Private invoice revenue',
      tone: 'opp',
    };
  }
  if (typeFilter === 'nhs') {
    return {
      label: 'NHS',
      value: filterSummary.nhsTypePatients.toLocaleString('en-GB'),
      subtitle:
        total > 0
          ? `${Math.round((filterSummary.nhsTypePatients / total) * 100)}% of filtered patients`
          : 'NHS or mixed billing',
      tone: 'opp',
    };
  }

  const pctSource =
    typeFilter === 'all' && retentionFilter !== 'all' ? filterSummary : baselineSummary;
  const pct =
    pctSource.totalPatients > 0
      ? Math.round((pctSource.privatePlanPatients / pctSource.totalPatients) * 100)
      : 0;
  const rest = 100 - pct;

  return {
    label: 'Private / plan',
    value: `${pct}%`,
    subtitle:
      retentionFilter !== 'all'
        ? `${pct}% of filtered cohort · ${rest}% NHS or mixed`
        : `Rest NHS or mixed · ${rest}%`,
    tone: 'opp',
  };
}

function csvEscape(value: string | number): string {
  return `"${String(value).replace(/"/g, '""')}"`;
}

/** Export rows exactly as shown in the table (same objects + provenance label). */
export function exportPatientListCsv(rows: PatientContributionRow[]): void {
  const headers = [
    'Patient',
    'Patient ID',
    'Practice',
    'Type',
    'Status',
    'Visit freq /yr',
    'Value/visit',
    'Revenue',
    'Cost',
    'Contribution',
    'Contribution 12mo',
    'Projected LTV',
    'Quality',
  ];

  const lines = rows.map((row) => {
    const type = patientTypeLabel(row);

    return [
      row.patientName,
      row.ptId ?? '',
      row.practiceName,
      type ?? '',
      retentionListLabel(row.retentionStatus),
      row.visitFreqPerYear ?? '',
      row.valuePerVisit != null ? row.valuePerVisit.toFixed(2) : '',
      row.revenuePrivatePlan.toFixed(2),
      row.directCost.toFixed(2),
      row.contribution.toFixed(2),
      row.contribution12mo.toFixed(2),
      row.patientEconomicValue.toFixed(2),
      row.qualityScore > 0 ? row.qualityScore : '',
    ]
      .map(csvEscape)
      .join(',');
  });

  const csv = [headers.map(csvEscape).join(','), ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `patient-list-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function usePatientContributionList() {
  const { organizationId, organization } = useOrganization();
  const practiceName = organization?.name?.trim() || 'This practice';

  return useQuery({
    queryKey: ['v_patient_contribution', 'list', organizationId, practiceName],
    enabled: !!organizationId,
    queryFn: () => fetchAllPatientRows(organizationId!, practiceName),
    staleTime: 60 * 1000,
  });
}

export function filterPatientRows(
  rows: PatientContributionRow[],
  search: string,
): PatientContributionRow[] {
  const q = search.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => {
    if (r.patientName.toLowerCase().includes(q)) return true;
    if (r.ptId != null && String(r.ptId).includes(q)) return true;
    return false;
  });
}

export function sortPatientRows(
  rows: PatientContributionRow[],
  sortKey: PatientListSortKey,
  dir: 'asc' | 'desc',
): PatientContributionRow[] {
  const mul = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    let av: string | number | null = a[sortKey] as string | number | null;
    let bv: string | number | null = b[sortKey] as string | number | null;

    if (sortKey === 'visitFreqPerYear' || sortKey === 'valuePerVisit') {
      av = a[sortKey];
      bv = b[sortKey];
    }

    if (av == null && bv == null) {
      return mul * a.patientName.localeCompare(b.patientName, 'en-GB');
    }
    if (av == null) return 1;
    if (bv == null) return -1;

    if (typeof av === 'string' && typeof bv === 'string') {
      return mul * av.localeCompare(bv, 'en-GB');
    }
    const an = Number(av);
    const bn = Number(bv);
    if (an === bn) return mul * a.patientName.localeCompare(b.patientName, 'en-GB');
    return mul * (an - bn);
  });
}

export function usePatientContributionListTable() {
  const query = usePatientContributionList();
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<PatientListSortKey>('contribution');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  const [retentionFilter, setRetentionFilter] = useState<PatientListRetentionFilter>('all');
  const [typeFilter, setTypeFilter] = useState<PatientListTypeFilter>('all');

  const filtered = useMemo(() => {
    const searched = filterPatientRows(query.data ?? [], search);
    return filterPatientRowsByChips(searched, retentionFilter, typeFilter);
  }, [query.data, search, retentionFilter, typeFilter]);

  const sorted = useMemo(
    () => sortPatientRows(filtered, sortKey, sortDir),
    [filtered, sortKey, sortDir],
  );

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));

  const effectivePage = Math.min(page, totalPages);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const pageRows = useMemo(() => {
    const start = (effectivePage - 1) * pageSize;
    return sorted.slice(start, start + pageSize);
  }, [sorted, effectivePage, pageSize]);

  const summary = useMemo(() => computePatientListSummary(sorted), [sorted]);

  const baselineSummary = useMemo(
    () => computePatientListSummary(query.data ?? []),
    [query.data],
  );

  const toggleSort = (key: PatientListSortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'patientName' ? 'asc' : 'desc');
    }
    setPage(1);
  };

  const onSearchChange = (value: string) => {
    setSearch(value);
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
    page: effectivePage,
    setPage,
    pageSize,
    onPageSizeChange,
    totalPages,
    totalRows: sorted.length,
    totalUnfiltered: (query.data ?? []).length,
    sorted,
    pageRows,
    summary,
    baselineSummary,
    hasSyncedPatients: (query.data?.length ?? 0) > 0,
    exportCsv: () => exportPatientListCsv(sorted),
  };
}
