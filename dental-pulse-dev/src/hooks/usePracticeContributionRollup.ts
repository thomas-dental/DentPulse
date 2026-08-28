import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export type PracticeProvenanceStatus =
  | 'complete'
  | 'partial_no_practitioner'
  | 'partial_missing_rate';

export type PracticeContributionRow = {
  practiceId: string;
  practiceName: string;
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

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function emptyRow(practiceId: string, practiceName: string): PracticeContributionRow {
  return {
    practiceId,
    practiceName,
    invoiceCount: 0,
    invoicesWithRevenue: 0,
    patientCount: 0,
    patientsWithRevenue: 0,
    revenuePrivatePlan: 0,
    clinicianCost: 0,
    directCost: 0,
    contribution: 0,
    marginPct: null,
    invoicesComplete: 0,
    invoicesPartialNoPractitioner: 0,
    invoicesPartialMissingRate: 0,
    pctComplete: null,
    pctPartialNoPractitioner: null,
    pctPartialMissingRate: null,
    contributionProvenanceStatus: 'complete',
    revenueTier: 'Dentally',
    clinicianCostTier: 'Derived',
    contributionTier: 'Derived',
    confidenceScore: null,
  };
}

async function fetchPracticeContributionRollup(
  userId: string,
): Promise<PracticeContributionRow[]> {
  const { data: roles, error: rolesErr } = await supabase
    .from('user_roles')
    .select('organization_id')
    .eq('user_id', userId);

  if (rolesErr) throw rolesErr;

  const practiceIds = [
    ...new Set(
      (roles ?? [])
        .map((r) => r.organization_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  ];
  if (practiceIds.length === 0) return [];

  const { data: orgs, error: orgsErr } = await supabase
    .from('organizations')
    .select('id, name')
    .in('id', practiceIds);

  if (orgsErr) throw orgsErr;

  const nameById = new Map<string, string>();
  for (const o of orgs ?? []) {
    nameById.set(o.id, o.name || 'Practice');
  }

  const { data: rollups, error: rollupErr } = await (supabase as any)
    .from('v_practice_contribution')
    .select('*')
    .in('practice_id', practiceIds);

  if (rollupErr) throw rollupErr;

  const byId = new Map<string, PracticeContributionRow>();
  for (const id of practiceIds) {
    byId.set(id, emptyRow(id, nameById.get(id) || 'Practice'));
  }

  for (const row of rollups ?? []) {
    const id = String(row.practice_id);
    const status = String(row.contribution_provenance_status || 'complete');
    byId.set(id, {
      practiceId: id,
      practiceName: nameById.get(id) || 'Practice',
      invoiceCount: num(row.invoice_count),
      invoicesWithRevenue: num(row.invoices_with_revenue),
      patientCount: num(row.patient_count),
      patientsWithRevenue: num(row.patients_with_revenue),
      revenuePrivatePlan: num(row.revenue_private_plan),
      clinicianCost: num(row.clinician_cost),
      directCost: num(row.direct_cost),
      contribution: num(row.contribution),
      marginPct: row.margin_pct == null ? null : num(row.margin_pct),
      invoicesComplete: num(row.invoices_complete),
      invoicesPartialNoPractitioner: num(row.invoices_partial_no_practitioner),
      invoicesPartialMissingRate: num(row.invoices_partial_missing_rate),
      pctComplete: row.pct_complete == null ? null : num(row.pct_complete),
      pctPartialNoPractitioner:
        row.pct_partial_no_practitioner == null
          ? null
          : num(row.pct_partial_no_practitioner),
      pctPartialMissingRate:
        row.pct_partial_missing_rate == null ? null : num(row.pct_partial_missing_rate),
      contributionProvenanceStatus:
        status === 'partial_no_practitioner' || status === 'partial_missing_rate'
          ? status
          : 'complete',
      revenueTier: String(row.revenue_tier || 'Dentally'),
      clinicianCostTier: String(row.clinician_cost_tier || 'Derived'),
      contributionTier: String(row.contribution_tier || 'Derived'),
      confidenceScore: row.confidence_score == null ? null : num(row.confidence_score),
    });
  }

  return [...byId.values()].sort((a, b) => b.contribution - a.contribution);
}

export function usePracticeContributionRollup() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['v_practice_contribution', 'rollup', user?.id],
    enabled: !!user?.id,
    queryFn: () => fetchPracticeContributionRollup(user!.id),
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
    () => sortPracticeRows(query.data ?? [], sortKey, sortDir),
    [query.data, sortKey, sortDir],
  );

  const toggleSort = (key: PracticeSortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'practiceName' ? 'asc' : 'desc');
    }
  };

  return { ...query, rows, sortKey, sortDir, toggleSort };
}
