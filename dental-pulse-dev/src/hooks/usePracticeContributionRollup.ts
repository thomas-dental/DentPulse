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

type InvoiceGrainRow = {
  practice_id: string;
  patient_id: string | null;
  revenue_private_plan: number | string | null;
  clinician_cost: number | string | null;
  direct_cost: number | string | null;
  contribution: number | string | null;
  contribution_provenance_status: string | null;
  confidence_score: number | string | null;
  revenue_tier?: string | null;
  clinician_cost_tier?: string | null;
  contribution_tier?: string | null;
};

type PeRollupUnit = {
  unitId: string;
  unitName: string;
  unitType: 'location' | 'practice';
  organizationId: string;
  locationId: string | null;
};

const PAGE_SIZE = 1000;

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function emptyRow(
  practiceId: string,
  practiceName: string,
  unitType: 'location' | 'practice' = 'practice',
  organizationId?: string,
): PracticeContributionRow {
  return {
    practiceId,
    practiceName,
    unitType,
    organizationId: organizationId ?? practiceId,
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

async function fetchAllPages<T>(
  buildQuery: (from: number, to: number) => Promise<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  for (let i = 0; i < 100; i++) {
    const { data, error } = await buildQuery(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

async function loadUserPracticeIds(userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('user_roles')
    .select('organization_id')
    .eq('user_id', userId);

  if (error) throw error;

  return [
    ...new Set(
      (data ?? [])
        .map((r) => r.organization_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  ];
}

async function loadLocationsForOrg(
  organizationId: string,
): Promise<Array<{ id: string; name: string }>> {
  const { data, error } = await (supabase as any)
    .from('practice_locations')
    .select('id, location_name')
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .order('location_name');

  if (error) throw error;

  return (data ?? [])
    .map((row: { id: string; location_name: string | null }) => ({
      id: String(row.id),
      name: String(row.location_name || 'Site').trim() || 'Site',
    }))
    .filter((row) => row.id.length > 0);
}

async function resolvePeRollupUnits(userId: string): Promise<{
  rollupMode: 'location' | 'practice';
  units: PeRollupUnit[];
  organizationIds: string[];
}> {
  const organizationIds = await loadUserPracticeIds(userId);
  if (organizationIds.length === 0) {
    return { rollupMode: 'practice', units: [], organizationIds: [] };
  }

  const { data: orgs, error: orgsErr } = await supabase
    .from('organizations')
    .select('id, name')
    .in('id', organizationIds);

  if (orgsErr) throw orgsErr;

  const nameById = new Map<string, string>();
  for (const o of orgs ?? []) {
    nameById.set(o.id, o.name || 'Practice');
  }

  const units: PeRollupUnit[] = [];
  for (const orgId of organizationIds) {
    const orgName = nameById.get(orgId) || 'Practice';
    const locations = await loadLocationsForOrg(orgId);

    if (locations.length > 1) {
      for (const loc of locations) {
        units.push({
          unitId: loc.id,
          unitName: loc.name,
          unitType: 'location',
          organizationId: orgId,
          locationId: loc.id,
        });
      }
    } else {
      units.push({
        unitId: orgId,
        unitName: orgName,
        unitType: 'practice',
        organizationId: orgId,
        locationId: locations[0]?.id ?? null,
      });
    }
  }

  units.sort((a, b) => a.unitName.localeCompare(b.unitName));
  const rollupMode = units.some((u) => u.unitType === 'location') ? 'location' : 'practice';
  return { rollupMode, units, organizationIds };
}

async function loadPatientLocationMap(
  organizationIds: string[],
): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  if (organizationIds.length === 0) return map;

  const rows = await fetchAllPages<{ id: string; location_id: string | null }>((from, to) =>
    (supabase as any)
      .from('patients')
      .select('id, location_id')
      .in('organization_id', organizationIds)
      .is('deleted_at', null)
      .range(from, to),
  );

  for (const row of rows) {
    if (!row.id) continue;
    map.set(String(row.id), row.location_id != null ? String(row.location_id) : null);
  }
  return map;
}

function finalizeRow(acc: PracticeContributionRow): PracticeContributionRow {
  const withRevenue = acc.invoicesWithRevenue;
  acc.marginPct =
    acc.revenuePrivatePlan > 0
      ? Math.round((acc.contribution / acc.revenuePrivatePlan) * 1000) / 10
      : null;
  acc.pctComplete =
    withRevenue > 0
      ? Math.round((1000 * acc.invoicesComplete) / withRevenue) / 10
      : null;
  acc.pctPartialNoPractitioner =
    withRevenue > 0
      ? Math.round((1000 * acc.invoicesPartialNoPractitioner) / withRevenue) / 10
      : null;
  acc.pctPartialMissingRate =
    withRevenue > 0
      ? Math.round((1000 * acc.invoicesPartialMissingRate) / withRevenue) / 10
      : null;

  if (acc.invoicesPartialNoPractitioner > 0) {
    acc.contributionProvenanceStatus = 'partial_no_practitioner';
  } else if (acc.invoicesPartialMissingRate > 0) {
    acc.contributionProvenanceStatus = 'partial_missing_rate';
  } else {
    acc.contributionProvenanceStatus = 'complete';
  }

  if (acc.invoicesPartialNoPractitioner > 0 || acc.invoicesPartialMissingRate > 0) {
    acc.clinicianCostTier = 'External';
  } else {
    acc.clinicianCostTier = 'Derived';
  }

  if (acc.confidenceScore != null && acc.invoiceCount > 0) {
    acc.confidenceScore = Math.round(acc.confidenceScore / acc.invoiceCount);
  }

  acc.revenuePrivatePlan = Math.round(acc.revenuePrivatePlan * 100) / 100;
  acc.clinicianCost = Math.round(acc.clinicianCost * 100) / 100;
  acc.directCost = Math.round(acc.directCost * 100) / 100;
  acc.contribution = Math.round(acc.contribution * 100) / 100;

  return acc;
}

function accumulateInvoice(
  acc: PracticeContributionRow,
  inv: InvoiceGrainRow,
  patientsWithAny: Set<string>,
  patientsWithRevenue: Set<string>,
) {
  const revenue = num(inv.revenue_private_plan);
  const patientId = inv.patient_id != null ? String(inv.patient_id) : null;
  const status = String(inv.contribution_provenance_status || 'complete');

  acc.invoiceCount += 1;
  acc.revenuePrivatePlan += revenue;
  acc.clinicianCost += num(inv.clinician_cost);
  acc.directCost += num(inv.direct_cost);
  acc.contribution += num(inv.contribution);
  acc.confidenceScore = (acc.confidenceScore ?? 0) + num(inv.confidence_score);

  // Provenance counts / % match v_practice_contribution: scoped to invoices with revenue.
  if (revenue > 0) {
    acc.invoicesWithRevenue += 1;
    if (status === 'partial_no_practitioner') acc.invoicesPartialNoPractitioner += 1;
    else if (status === 'partial_missing_rate') acc.invoicesPartialMissingRate += 1;
    else acc.invoicesComplete += 1;
  }

  if (patientId) {
    patientsWithAny.add(patientId);
    if (revenue > 0) patientsWithRevenue.add(patientId);
  }
}

export type PracticeContributionRollupResult = {
  rows: PracticeContributionRow[];
  rollupMode: 'location' | 'practice';
};

async function fetchPracticeContributionRollup(
  userId: string,
): Promise<PracticeContributionRollupResult> {
  const { rollupMode, units, organizationIds } = await resolvePeRollupUnits(userId);
  if (units.length === 0) return { rows: [], rollupMode: 'practice' };

  const invoices = await fetchAllPages<InvoiceGrainRow>((from, to) =>
    (supabase as any)
      .from('v_invoice_contribution')
      .select(
        'practice_id, patient_id, revenue_private_plan, clinician_cost, direct_cost, contribution, contribution_provenance_status, confidence_score, revenue_tier, clinician_cost_tier, contribution_tier',
      )
      .in('practice_id', organizationIds)
      .range(from, to),
  );

  const patientLocation =
    rollupMode === 'location' ? await loadPatientLocationMap(organizationIds) : new Map();

  const byUnit = new Map<string, PracticeContributionRow>();
  const patientsAnyByUnit = new Map<string, Set<string>>();
  const patientsRevByUnit = new Map<string, Set<string>>();

  for (const unit of units) {
    byUnit.set(
      unit.unitId,
      emptyRow(unit.unitId, unit.unitName, unit.unitType, unit.organizationId),
    );
    patientsAnyByUnit.set(unit.unitId, new Set());
    patientsRevByUnit.set(unit.unitId, new Set());
  }

  // Unassigned patients (no location_id) roll into first location of their org when in location mode —
  // better: skip them from location rows OR attach to org-primary. Prefer skipping from bars so
  // only patients with a home location count; still show empty location rows.
  for (const inv of invoices) {
    const orgId = String(inv.practice_id);
    let unitId: string | null = null;

    if (rollupMode === 'location') {
      const patientId = inv.patient_id != null ? String(inv.patient_id) : null;
      const locId = patientId ? patientLocation.get(patientId) ?? null : null;
      if (locId && byUnit.has(locId)) unitId = locId;
      else continue;
    } else {
      unitId = orgId;
    }

    if (!unitId || !byUnit.has(unitId)) continue;

    accumulateInvoice(
      byUnit.get(unitId)!,
      inv,
      patientsAnyByUnit.get(unitId)!,
      patientsRevByUnit.get(unitId)!,
    );
  }

  const rows = units.map((unit) => {
    const acc = byUnit.get(unit.unitId)!;
    acc.patientCount = patientsAnyByUnit.get(unit.unitId)?.size ?? 0;
    acc.patientsWithRevenue = patientsRevByUnit.get(unit.unitId)?.size ?? 0;
    return finalizeRow(acc);
  });

  rows.sort((a, b) => b.contribution - a.contribution);
  return { rows, rollupMode };
}

export function usePracticeContributionRollup() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['v_practice_contribution', 'rollup-by-location', user?.id],
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
