import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useOrganization } from '@/hooks/useOrganization';
import { fetchPatientContributionList } from '@/services/integrations/patientEconomicsService';
import type { PeRetentionStatus, PeRetentionStatusTier } from '@/lib/peRetentionConstants';
import {
  parseRetentionStatus,
  parseRetentionStatusTier,
  retentionListLabel,
} from '@/lib/peRetentionSegmentation';
import type { PeRecommendedAction } from '@/lib/peRecommendedAction';
import { parseRecommendedAction } from '@/lib/peRecommendedAction';

export type PatientProvenanceStatus =
  | 'complete'
  | 'partial_no_practitioner'
  | 'partial_missing_rate';

export type PatientListRetentionFilter =
  | 'all'
  | 'active'
  | 'drifting'
  | 'lapsed'
  | 'effectively_lost';
export type PatientListTypeFilter = 'all' | 'private' | 'nhs' | 'member';

export type PatientContributionRow = {
  patientId: string;
  ptId: number | null;
  patientName: string;
  patientUuid: string | null;
  practiceName: string;
  locationId: string | null;
  locationName: string | null;
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
  opportunityWeightConfidence: number;
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
  retentionEffectivelyLostCount: number;
  privatePlanPatients: number;
  memberPatients: number;
  privateTypePatients: number;
  nhsTypePatients: number;
  averageContribution: number;
  averageProjectedLtv: number;
};


function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function mapPatientContributionRow(raw: Record<string, unknown>): PatientContributionRow {
  return {
    patientId: String(raw.patientId),
    ptId: raw.ptId == null ? null : num(raw.ptId),
    patientName: String(raw.patientName ?? 'Unknown patient'),
    patientUuid: raw.patientUuid != null ? String(raw.patientUuid) : null,
    practiceName: String(raw.practiceName ?? 'This practice'),
    locationId: raw.locationId != null ? String(raw.locationId) : null,
    locationName: raw.locationName != null ? String(raw.locationName) : null,
    isActive: raw.isActive === true,
    hasPaymentPlan: raw.hasPaymentPlan === true,
    contribution12mo: num(raw.contribution12mo),
    visits12mo: num(raw.visits12mo),
    visitFreqPerYear:
      raw.visitFreqPerYear == null ? null : num(raw.visitFreqPerYear),
    valuePerVisit: raw.valuePerVisit == null ? null : num(raw.valuePerVisit),
    invoiceCount: num(raw.invoiceCount),
    invoicesWithRevenue: num(raw.invoicesWithRevenue),
    revenuePrivatePlan: num(raw.revenuePrivatePlan),
    clinicianCost: num(raw.clinicianCost),
    directCost: num(raw.directCost),
    contribution: num(raw.contribution),
    marginPct: raw.marginPct == null ? null : num(raw.marginPct),
    invoicesComplete: num(raw.invoicesComplete),
    invoicesPartialNoPractitioner: num(raw.invoicesPartialNoPractitioner),
    invoicesPartialMissingRate: num(raw.invoicesPartialMissingRate),
    pctComplete: raw.pctComplete == null ? null : num(raw.pctComplete),
    contributionProvenanceStatus:
      raw.contributionProvenanceStatus === 'partial_no_practitioner' ||
      raw.contributionProvenanceStatus === 'partial_missing_rate'
        ? raw.contributionProvenanceStatus
        : 'complete',
    revenueTier: String(raw.revenueTier || 'Dentally'),
    clinicianCostTier: String(raw.clinicianCostTier || 'Derived'),
    contributionTier: String(raw.contributionTier || 'Derived'),
    confidenceScore: raw.confidenceScore == null ? null : num(raw.confidenceScore),
    retentionStatus: parseRetentionStatus(raw.retentionStatus),
    retentionStatusTier: parseRetentionStatusTier(raw.retentionStatusTier),
    opportunityGross: num(raw.opportunityGross),
    opportunityGrossTier: String(raw.opportunityGrossTier || 'Derived'),
    opportunityWeighted: num(raw.opportunityWeighted),
    opportunityWeightedTier: String(raw.opportunityWeightedTier || 'Modelled'),
    opportunityWeightedTierNote:
      raw.opportunityWeightedTierNote != null
        ? String(raw.opportunityWeightedTierNote)
        : null,
    opportunityWeightConfidence: num(raw.opportunityWeightConfidence),
    patientEconomicValue: num(raw.patientEconomicValue),
    patientEconomicValueTier: String(raw.patientEconomicValueTier || 'Modelled'),
    patientEconomicValueTierNote:
      raw.patientEconomicValueTierNote != null
        ? String(raw.patientEconomicValueTierNote)
        : null,
    qualityScore: num(raw.qualityScore),
    recommendedAction: parseRecommendedAction(raw.recommendedAction),
    recommendedActionTier: String(raw.recommendedActionTier || 'Modelled'),
    recommendedActionTierNote:
      raw.recommendedActionTierNote != null
        ? String(raw.recommendedActionTierNote)
        : null,
  };
}

async function fetchAllPatientRows(
  practiceId: string,
): Promise<{
  rows: PatientContributionRow[];
  rollupMode: 'location' | 'practice';
  locations: PeLocationScope[];
}> {
  const data = await fetchPatientContributionList(practiceId);
  return {
    rows: data.patients.map((row) => mapPatientContributionRow(row)),
    rollupMode: data.rollupMode === 'location' ? 'location' : 'practice',
    locations: (data.locations ?? []).map((loc) => ({
      id: String(loc.id),
      name: String(loc.name || 'Site'),
    })),
  };
}

export type PeRollupMode = 'location' | 'practice';

/** Label for Practice / Location column in patient list tables. */
export function patientScopeLabel(
  row: PatientContributionRow,
  rollupMode: PeRollupMode = 'practice',
): string {
  if (rollupMode === 'location') {
    return row.locationName?.trim() || 'Unassigned';
  }
  return row.practiceName;
}

export function dataQualityLabel(status: PatientProvenanceStatus): string {
  if (status === 'partial_no_practitioner') return 'No practitioner';
  if (status === 'partial_missing_rate') return 'Missing rate';
  return 'Derived';
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

export function filterPatientRowsByChips(
  rows: PatientContributionRow[],
  retentionFilter: PatientListRetentionFilter,
  typeFilter: PatientListTypeFilter,
): PatientContributionRow[] {
  let out = rows;

  if (retentionFilter !== 'all') {
    out = out.filter((row) => {
      if (retentionFilter === 'active') return row.retentionStatus === 'active';
      if (retentionFilter === 'drifting') return row.retentionStatus === 'drifting';
      if (retentionFilter === 'lapsed') return row.retentionStatus === 'lapsed';
      if (retentionFilter === 'effectively_lost') {
        return row.retentionStatus === 'effectively_lost';
      }
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

const UNASSIGNED_LOCATION_ID = '__unassigned__';

export function patientLocationId(row: PatientContributionRow): string {
  return row.locationId ?? UNASSIGNED_LOCATION_ID;
}

export type PeLocationScope = { id: string; name: string };

/** All org locations plus any unassigned bucket seen on patient rows. */
export function buildLocationOptions(
  scopes: PeLocationScope[],
  rows: PatientContributionRow[],
): Array<[string, string]> {
  const map = new Map<string, string>();
  for (const loc of scopes) {
    if (loc.id) map.set(loc.id, loc.name);
  }
  for (const row of rows) {
    const id = patientLocationId(row);
    if (!map.has(id)) {
      map.set(id, row.locationName?.trim() || 'Unassigned');
    }
  }
  return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
}

export function filterPatientRowsByLocation(
  rows: PatientContributionRow[],
  locationFilter: string,
): PatientContributionRow[] {
  if (locationFilter === 'all') return rows;
  return rows.filter((row) => patientLocationId(row) === locationFilter);
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
      retentionEffectivelyLostCount: 0,
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
  let retentionEffectivelyLostCount = 0;
  let privatePlanPatients = 0;
  let memberPatients = 0;
  let privateTypePatients = 0;
  let nhsTypePatients = 0;
  let contributionSum = 0;
  let ltvSum = 0;

  for (const row of rows) {
    if (row.isActive) activePatients += 1;
    if (row.retentionStatus === 'active') retentionActiveCount += 1;
    if (row.retentionStatus === 'drifting') retentionDriftingCount += 1;
    if (row.retentionStatus === 'lapsed') retentionLapsedCount += 1;
    if (row.retentionStatus === 'effectively_lost') retentionEffectivelyLostCount += 1;
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
    retentionEffectivelyLostCount,
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
      subtitle: 'Long recall/visit gap — reactivation candidate',
      tone: 'danger',
    };
  }
  if (retentionFilter === 'effectively_lost') {
    return {
      label: 'Effectively lost',
      value: filterSummary.retentionEffectivelyLostCount.toLocaleString('en-GB'),
      subtitle: 'Inactive or very long gap — low recovery probability',
      tone: 'danger',
    };
  }
  if (retentionFilter === 'active') {
    return {
      label: 'Active',
      value: filterSummary.retentionActiveCount.toLocaleString('en-GB'),
      subtitle: 'On recall track',
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
export function exportPatientListCsv(
  rows: PatientContributionRow[],
  rollupMode: PeRollupMode = 'practice',
): void {
  const scopeHeader = rollupMode === 'location' ? 'Location' : 'Practice';
  const headers = [
    'Patient',
    scopeHeader,
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
      patientScopeLabel(row, rollupMode),
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
  const { organizationId } = useOrganization();

  return useQuery({
    queryKey: ['patient-contribution-list', organizationId],
    enabled: !!organizationId,
    queryFn: () => fetchAllPatientRows(organizationId!),
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

/** Margin rate for converting treatment £ opportunity → contribution £. */
export function contributionMarginRate(row: PatientContributionRow): number {
  if (row.marginPct != null && row.marginPct > 0) return row.marginPct / 100;
  if (row.revenuePrivatePlan > 0) return row.contribution / row.revenuePrivatePlan;
  return 0;
}

/** Contribution £ after commitment rate and margin — matches Patient Records table column. */
export function probabilityWeightedContribution(row: PatientContributionRow): number {
  return row.opportunityWeighted * contributionMarginRate(row);
}

export function patientOpportunityMetrics(row: PatientContributionRow) {
  const marginRate = contributionMarginRate(row);
  return {
    unscheduledTreatmentGross: row.opportunityGross,
    grossContributionOpportunity: row.opportunityGross * marginRate,
    probabilityWeighted: row.opportunityWeighted * marginRate,
  };
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

    if (sortKey === 'opportunityWeighted') {
      av = probabilityWeightedContribution(a);
      bv = probabilityWeightedContribution(b);
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
  const [locationFilter, setLocationFilter] = useState<string>('all');

  const rollupMode = query.data?.rollupMode ?? 'practice';

  const locationOptions = useMemo(
    () => buildLocationOptions(query.data?.locations ?? [], query.data?.rows ?? []),
    [query.data?.locations, query.data?.rows],
  );

  const filtered = useMemo(() => {
    const allRows = query.data?.rows ?? [];
    const searched = filterPatientRows(allRows, search);
    const byLocation =
      rollupMode === 'location'
        ? filterPatientRowsByLocation(searched, locationFilter)
        : searched;
    return filterPatientRowsByChips(byLocation, retentionFilter, typeFilter);
  }, [
    query.data?.rows,
    search,
    retentionFilter,
    typeFilter,
    locationFilter,
    rollupMode,
  ]);

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
    () => computePatientListSummary(query.data?.rows ?? []),
    [query.data?.rows],
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

  const onLocationFilterChange = (value: string) => {
    setLocationFilter(value);
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
    locationFilter,
    onLocationFilterChange,
    locationOptions,
    rollupMode,
    sortKey,
    sortDir,
    toggleSort,
    page: effectivePage,
    setPage,
    pageSize,
    onPageSizeChange,
    totalPages,
    totalRows: sorted.length,
    totalUnfiltered: query.data?.rows?.length ?? 0,
    sorted,
    pageRows,
    summary,
    baselineSummary,
    hasSyncedPatients: (query.data?.rows?.length ?? 0) > 0,
    exportCsv: () => exportPatientListCsv(sorted, rollupMode),
  };
}
