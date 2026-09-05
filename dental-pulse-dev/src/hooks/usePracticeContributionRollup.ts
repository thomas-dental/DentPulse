import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { fetchPracticeContributionRollupApi } from '@/services/integrations/patientEconomicsService';
import { usePeScopedRead } from '@/hooks/usePeScopedRead';

export type PracticeProvenanceStatus =
  | 'complete'
  | 'partial_no_practitioner'
  | 'partial_missing_rate';

export type PracticeContributionRow = {
  practiceId: string;
  practiceName: string;
  unitType?: 'location' | 'practice';
  organizationId?: string;
  invoiceCount: number;
  invoicesWithRevenue: number;
  patientCount: number;
  patientsWithRevenue: number;
  revenuePrivatePlan: number;
  clinicianCost: number;
  directCost: number;
  contribution: number;
  marginPct: number | null;
  invoicesComplete: number;
  invoicesPartialNoPractitioner: number;
  invoicesPartialMissingRate: number;
  pctComplete: number | null;
  pctPartialNoPractitioner: number | null;
  pctPartialMissingRate: number | null;
  contributionProvenanceStatus: PracticeProvenanceStatus;
  revenueTier: string;
  clinicianCostTier: string;
  contributionTier: string;
  confidenceScore: number | null;
};

export type PracticeSortKey =
  | 'practiceName'
  | 'patientsWithRevenue'
  | 'revenuePrivatePlan'
  | 'clinicianCost'
  | 'directCost'
  | 'contribution'
  | 'marginPct'
  | 'pctComplete';

export type PracticeContributionRollupResult = {
  rows: PracticeContributionRow[];
  rollupMode: 'location' | 'practice';
};

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function mapRow(raw: Record<string, unknown>): PracticeContributionRow {
  return {
    practiceId: String(raw.practiceId ?? ''),
    practiceName: String(raw.practiceName ?? 'Practice'),
    unitType: (raw.unitType as 'location' | 'practice' | undefined) ?? 'practice',
    organizationId: raw.organizationId != null ? String(raw.organizationId) : undefined,
    invoiceCount: num(raw.invoiceCount),
    invoicesWithRevenue: num(raw.invoicesWithRevenue),
    patientCount: num(raw.patientCount),
    patientsWithRevenue: num(raw.patientsWithRevenue),
    revenuePrivatePlan: num(raw.revenuePrivatePlan),
    clinicianCost: num(raw.clinicianCost),
    directCost: num(raw.directCost),
    contribution: num(raw.contribution),
    marginPct: raw.marginPct != null ? num(raw.marginPct) : null,
    invoicesComplete: num(raw.invoicesComplete),
    invoicesPartialNoPractitioner: num(raw.invoicesPartialNoPractitioner),
    invoicesPartialMissingRate: num(raw.invoicesPartialMissingRate),
    pctComplete: raw.pctComplete != null ? num(raw.pctComplete) : null,
    pctPartialNoPractitioner:
      raw.pctPartialNoPractitioner != null ? num(raw.pctPartialNoPractitioner) : null,
    pctPartialMissingRate:
      raw.pctPartialMissingRate != null ? num(raw.pctPartialMissingRate) : null,
    contributionProvenanceStatus:
      (raw.contributionProvenanceStatus as PracticeProvenanceStatus) ?? 'complete',
    revenueTier: String(raw.revenueTier ?? 'Dentally'),
    clinicianCostTier: String(raw.clinicianCostTier ?? 'Derived'),
    contributionTier: String(raw.contributionTier ?? 'Derived'),
    confidenceScore: raw.confidenceScore != null ? num(raw.confidenceScore) : null,
  };
}

async function fetchPracticeContributionRollup(
  scope?: import('@/services/integrations/patientEconomicsService').PeApiScope,
): Promise<PracticeContributionRollupResult> {
  const body = await fetchPracticeContributionRollupApi(scope);
  return {
    rollupMode: body.rollupMode,
    rows: (body.rows ?? []).map((row) => mapRow(row as Record<string, unknown>)),
  };
}

export function usePracticeContributionRollup() {
  const { user } = useAuth();
  const { scopeKey, apiScope, enabled } = usePeScopedRead();

  return useQuery({
    queryKey: ['practice-contribution-rollup', user?.id, scopeKey],
    enabled: !!user?.id && enabled,
    queryFn: () => fetchPracticeContributionRollup(apiScope),
  });
}

export function sortPracticeRows(
  rows: PracticeContributionRow[],
  sortKey: PracticeSortKey,
  dir: 'asc' | 'desc',
): PracticeContributionRow[] {
  const mul = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    if (typeof av === 'string' && typeof bv === 'string') {
      return mul * av.localeCompare(bv, 'en-GB');
    }
    const an = av == null ? Number.NEGATIVE_INFINITY : Number(av);
    const bn = bv == null ? Number.NEGATIVE_INFINITY : Number(bv);
    if (an === bn) return mul * a.practiceName.localeCompare(b.practiceName, 'en-GB');
    return mul * (an - bn);
  });
}

export function useSortedPracticeContributionRollup() {
  const query = usePracticeContributionRollup();
  const [sortKey, setSortKey] = useState<PracticeSortKey>('contribution');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const rows = useMemo(
    () => sortPracticeRows(query.data?.rows ?? [], sortKey, sortDir),
    [query.data?.rows, sortKey, sortDir],
  );

  const rollupMode = query.data?.rollupMode ?? 'practice';

  const toggleSort = (key: PracticeSortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'practiceName' ? 'asc' : 'desc');
    }
  };

  return { ...query, rows, rollupMode, sortKey, sortDir, toggleSort };
}
