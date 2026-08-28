import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';
import {
  filterPatientRows,
  sortPatientRows,
  type PatientContributionRow,
  type PatientListSortKey,
  type PatientProvenanceStatus,
} from '@/hooks/usePatientContributionList';
import type { PeRetentionStatus } from '@/lib/peRetentionConstants';
import { PE_OPPORTUNITY_WEIGHTED_TIER_NOTE } from '@/lib/peRetentionConstants';
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
  tone: 'healthy' | 'drifting' | 'lapsed' | 'active';
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

function formatRecallHint(
  dentistRecall: string | null,
  hygienistRecall: string | null,
): string | null {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const labels: string[] = [];

  const fmt = (raw: string) => {
    const d = new Date(`${raw.slice(0, 10)}T00:00:00`);
    return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
  };

  if (dentistRecall) {
    const d = new Date(`${dentistRecall.slice(0, 10)}T00:00:00`);
    if (d >= today) labels.push(`dentist recall ${fmt(dentistRecall)}`);
  }
  if (hygienistRecall) {
    const d = new Date(`${hygienistRecall.slice(0, 10)}T00:00:00`);
    if (d >= today) labels.push(`hygienist recall ${fmt(hygienistRecall)}`);
  }

  if (labels.length === 0) {
    const past = [dentistRecall, hygienistRecall]
      .filter(Boolean)
      .map((r) => new Date(`${String(r).slice(0, 10)}T00:00:00`))
      .filter((d) => d < today)
      .sort((a, b) => b.getTime() - a.getTime());
    if (past.length > 0) {
      return `recall overdue since ${fmt(past[0].toISOString().slice(0, 10))}`;
    }
    return null;
  }

  return labels[0];
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function displayName(rawName: string | null | undefined, ptId: number | null): string {
  const trimmed = String(rawName ?? '').trim();
  if (trimmed) return trimmed;
  if (ptId != null) return `Patient #${ptId}`;
  return 'Unknown patient';
}

function parseProvenanceStatus(raw: string): PatientProvenanceStatus {
  if (raw === 'partial_no_practitioner' || raw === 'partial_missing_rate') return raw;
  return 'complete';
}

function parseRetentionStatus(raw: unknown): PeRetentionStatus {
  const s = String(raw || 'active').toLowerCase();
  if (s === 'drifting' || s === 'lapsed' || s === 'healthy') return s;
  return 'active';
}

function retentionDisplayFromRow(
  status: PeRetentionStatus,
  tier: string,
): RetentionStatus {
  const label =
    status === 'healthy'
      ? 'Healthy'
      : status === 'drifting'
        ? 'Drifting'
        : status === 'lapsed'
          ? 'Lapsed'
          : 'Active';
  const tone =
    status === 'healthy'
      ? 'healthy'
      : status === 'drifting'
        ? 'drifting'
        : status === 'lapsed'
          ? 'lapsed'
          : 'active';
  return { status, label, tier, tone };
}

export { PE_OPPORTUNITY_WEIGHTED_TIER_NOTE };

const FINANCIAL_RECORD_VIEW = 'v_patient_financial_record';
const PAGE_SIZE = 1000;

const FINANCIAL_RECORD_SELECT =
  'practice_id, patient_id, pt_id, patient_name, patient_uuid, invoice_count, invoices_with_revenue, ' +
  'revenue_private_plan, clinician_cost, direct_cost, contribution, margin_pct, invoices_complete, ' +
  'invoices_partial_no_practitioner, invoices_partial_missing_rate, pct_complete, ' +
  'contribution_provenance_status, revenue_tier, clinician_cost_tier, contribution_tier, confidence_score, ' +
  'retention_status, retention_status_tier, opportunity_gross, opportunity_gross_tier, ' +
  'opportunity_weighted, opportunity_weighted_tier, opportunity_weighted_tier_note, ' +
  'patient_economic_value, patient_economic_value_tier, patient_economic_value_tier_note, ' +
  'quality_score, recommended_action, recommended_action_tier, recommended_action_tier_note, ' +
  'cltv_projection, cltv_tier, quality_score_tier, modelled_confidence_score, modelled_computed_at';

function mapFinancialRecordRow(row: Record<string, unknown>): PatientFinancialRecordRow {
  const base = mapContributionRow(row);
  const cltvRaw = row.cltv_projection;
  const cltvProjection =
    cltvRaw == null || cltvRaw === '' ? null : num(cltvRaw);
  const modelledAt = row.modelled_computed_at;
  return {
    ...base,
    cltvProjection,
    cltvTier: cltvProjection != null ? String(row.cltv_tier || 'Modelled') : null,
    qualityScoreTier:
      cltvProjection != null ? String(row.quality_score_tier || 'Modelled') : null,
    modelledConfidenceScore:
      row.modelled_confidence_score == null ? null : num(row.modelled_confidence_score),
    modelledComputedAt:
      modelledAt != null && String(modelledAt).length > 0 ? String(modelledAt) : null,
  };
}

function modelledFromFinancialRecordRow(row: PatientFinancialRecordRow): PatientModelledScores | null {
  if (row.cltvProjection == null) return null;
  return {
    cltvProjection: row.cltvProjection,
    qualityScore: row.qualityScore,
    cltvTier: row.cltvTier ?? 'Modelled',
    qualityScoreTier: row.qualityScoreTier ?? 'Modelled',
    confidenceScore: row.modelledConfidenceScore ?? 0,
    computedAt: row.modelledComputedAt ?? '',
  };
}

function mapContributionRow(row: Record<string, unknown>): PatientContributionRow {
  const status = parseProvenanceStatus(String(row.contribution_provenance_status || 'complete'));
  const ptIdRaw = row.pt_id;
  const ptId =
    ptIdRaw == null || ptIdRaw === ''
      ? null
      : Number.isFinite(Number(ptIdRaw))
        ? Number(ptIdRaw)
        : null;

  return {
    patientId: String(row.patient_id),
    ptId,
    patientName: displayName(row.patient_name as string, ptId),
    patientUuid:
      row.patient_uuid != null && String(row.patient_uuid).length > 0
        ? String(row.patient_uuid)
        : null,
    isActive: false,
    hasPaymentPlan: false,
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
    contributionProvenanceStatus: status,
    revenueTier: String(row.revenue_tier || 'Dentally'),
    clinicianCostTier: String(row.clinician_cost_tier || 'Derived'),
    contributionTier: String(row.contribution_tier || 'Derived'),
    confidenceScore: row.confidence_score == null ? null : num(row.confidence_score),
    retentionStatus: parseRetentionStatus(row.retention_status),
    retentionStatusTier:
      String(row.retention_status_tier || 'Derived') === 'Modelled' ? 'Modelled' : 'Derived',
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
  };
}

async function enrichPatientMetadata(
  practiceId: string,
  rows: PatientFinancialRecordRow[],
): Promise<PatientFinancialRecordRow[]> {
  if (rows.length === 0) return rows;

  const meta = new Map<string, { isActive: boolean; hasPaymentPlan: boolean }>();
  const ids = rows.map((r) => r.patientId);
  const CHUNK = 500;

  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
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

async function fetchAllFinancialRecordRows(practiceId: string): Promise<PatientFinancialRecordRow[]> {
  const all: PatientFinancialRecordRow[] = [];
  let offset = 0;

  for (let page = 0; page < 50; page++) {
    const { data, error } = await (supabase as any)
      .from(FINANCIAL_RECORD_VIEW)
      .select(FINANCIAL_RECORD_SELECT)
      .eq('practice_id', practiceId)
      .order('contribution', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      if (error.code === '42P01') return [];
      throw error;
    }

    const rows = (data ?? []) as Record<string, unknown>[];
    for (const row of rows) {
      all.push(mapFinancialRecordRow(row));
    }

    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return enrichPatientMetadata(practiceId, all);
}

function mapInvoiceRow(row: Record<string, unknown>): PatientInvoiceRow {
  return {
    invoiceId: String(row.invoice_id),
    platformInvoiceId:
      row.platform_invoice_id != null ? String(row.platform_invoice_id) : null,
    invoiceDate: row.invoice_date != null ? String(row.invoice_date) : null,
    revenuePrivatePlan: num(row.revenue_private_plan),
    revenueNhs: num(row.revenue_nhs),
    clinicianCost: num(row.clinician_cost),
    labCost: num(row.lab_cost),
    materialsCost: num(row.materials_cost),
    directCost: num(row.direct_cost),
    contribution: num(row.contribution),
    privateShareRate:
      row.private_share_rate == null ? null : num(row.private_share_rate),
    contributionProvenanceStatus: parseProvenanceStatus(
      String(row.contribution_provenance_status || 'complete'),
    ),
    revenueTier: String(row.revenue_tier || 'Dentally'),
    clinicianCostTier: String(row.clinician_cost_tier || 'Derived'),
    contributionTier: String(row.contribution_tier || 'Derived'),
    confidenceScore: row.confidence_score == null ? null : num(row.confidence_score),
  };
}

async function fetchPatientFinancialRecord(
  practiceId: string,
  patientId: string,
): Promise<PatientFinancialRecord | null> {
  const { data: recordRow, error: recordErr } = await (supabase as any)
    .from(FINANCIAL_RECORD_VIEW)
    .select(FINANCIAL_RECORD_SELECT)
    .eq('practice_id', practiceId)
    .eq('patient_id', patientId)
    .maybeSingle();

  if (recordErr) {
    if (recordErr.code === '42P01') return null;
    throw recordErr;
  }
  if (!recordRow) return null;

  const { data: patientRow, error: patientErr } = await supabase
    .from('patients')
    .select(
      'id, is_active, pt_payment_plan_id, pt_acquisition_source_name, pt_dentist_recall_date, pt_hygienist_recall_date',
    )
    .eq('organization_id', practiceId)
    .eq('id', patientId)
    .maybeSingle();

  if (patientErr) throw patientErr;

  const row = mapFinancialRecordRow(recordRow as Record<string, unknown>);
  row.isActive = patientRow?.is_active === true;
  row.hasPaymentPlan = patientRow?.pt_payment_plan_id != null;

  const recallHint = formatRecallHint(
    patientRow?.pt_dentist_recall_date != null
      ? String(patientRow.pt_dentist_recall_date)
      : null,
    patientRow?.pt_hygienist_recall_date != null
      ? String(patientRow.pt_hygienist_recall_date)
      : null,
  );

  const retention = retentionDisplayFromRow(row.retentionStatus, row.retentionStatusTier);
  const modelled = modelledFromFinancialRecordRow(row);
  const invoices = await fetchPatientInvoices(practiceId, patientId);

  return {
    row,
    modelled,
    retention,
    invoices,
    acquisitionSourceName:
      patientRow?.pt_acquisition_source_name != null &&
      String(patientRow.pt_acquisition_source_name).trim()
        ? String(patientRow.pt_acquisition_source_name).trim()
        : null,
    recallHint,
  };
}

async function fetchPatientInvoices(
  practiceId: string,
  patientId: string,
): Promise<PatientInvoiceRow[]> {
  const { data: invoiceRows, error: invoiceErr } = await (supabase as any)
    .from('v_invoice_contribution')
    .select('*')
    .eq('practice_id', practiceId)
    .eq('patient_id', patientId)
    .order('invoice_date', { ascending: false });

  if (invoiceErr) throw invoiceErr;

  return (invoiceRows ?? []).map((r) => mapInvoiceRow(r as Record<string, unknown>));
}

async function fetchPatientTreatmentLines(
  practiceId: string,
  patientId: string,
  ptId: number | null,
): Promise<PatientTreatmentLineRow[]> {
  let dentallyPtId = ptId;
  if (dentallyPtId == null) {
    const { data: patientRow, error: patientErr } = await supabase
      .from('patients')
      .select('pt_id')
      .eq('organization_id', practiceId)
      .eq('id', patientId)
      .maybeSingle();
    if (patientErr) throw patientErr;
    dentallyPtId = patientRow?.pt_id ?? null;
  }
  if (dentallyPtId == null) return [];

  const { data: invoices, error: invErr } = await supabase
    .from('platform_integration_invoices')
    .select('id, invoice_date')
    .eq('organization_id', practiceId)
    .eq('patient_id', String(dentallyPtId))
    .is('deleted_at', null);

  if (invErr) throw invErr;
  if (!invoices?.length) return [];

  const invoiceIds = invoices.map((i) => i.id);
  const invoiceDateById = new Map(invoices.map((i) => [i.id, i.invoice_date]));

  const { data: invoiceContrib, error: contribErr } = await (supabase as any)
    .from('v_invoice_contribution')
    .select('invoice_id, revenue_private_plan, direct_cost, contribution')
    .eq('practice_id', practiceId)
    .eq('patient_id', patientId);

  if (contribErr) throw contribErr;

  const contribByInvoice = new Map<string, Record<string, unknown>>(
    (invoiceContrib ?? []).map((r: Record<string, unknown>) => [
      String(r.invoice_id),
      r,
    ]),
  );

  const { data: lines, error: lineErr } = await supabase
    .from('platform_integration_invoice_line_items')
    .select(
      'id, invoice_id, item_name, description, net, line_amount, gross, practitioner_id, completed_at, service_date, tooth_ref, is_nhs',
    )
    .eq('organization_id', practiceId)
    .in('invoice_id', invoiceIds);

  if (lineErr) throw lineErr;

  const privateLines = (lines ?? []).filter((l) => !l.is_nhs);

  const practitionerExtIds = [
    ...new Set(
      privateLines
        .map((l) => l.practitioner_id)
        .filter((id) => id != null && String(id).trim() !== '')
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id)),
    ),
  ];

  const providerNameByExtId = new Map<number, string>();
  if (practitionerExtIds.length > 0) {
    const { data: providers, error: providerErr } = await supabase
      .from('providers')
      .select('external_id, name, provider_code')
      .eq('organization_id', practiceId)
      .in('external_id', practitionerExtIds);

    if (providerErr) throw providerErr;

    for (const p of providers ?? []) {
      if (p.external_id != null) {
        const label =
          (p.provider_code && p.provider_code.trim()) ||
          (p.name && p.name.trim()) ||
          `ID ${p.external_id}`;
        providerNameByExtId.set(p.external_id, label);
      }
    }
  }

  const rows: PatientTreatmentLineRow[] = [];

  for (const line of privateLines) {
    const revenue = num(line.net ?? line.line_amount ?? line.gross ?? 0);
    if (revenue === 0) continue;

    const invContrib = contribByInvoice.get(String(line.invoice_id));
    const invRevenue = invContrib ? num(invContrib.revenue_private_plan) : revenue;
    const share = invRevenue > 0 ? revenue / invRevenue : 1;
    const cost = invContrib ? num(invContrib.direct_cost) * share : 0;
    const contribution = invContrib ? num(invContrib.contribution) * share : revenue - cost;

    const baseName =
      (line.item_name && String(line.item_name).trim()) ||
      (line.description && String(line.description).trim()) ||
      'Treatment';
    const treatmentLabel = line.tooth_ref
      ? `${baseName} (${line.tooth_ref})`
      : baseName;

    const dateRaw =
      line.completed_at?.slice(0, 10) ??
      line.service_date ??
      invoiceDateById.get(line.invoice_id ?? '');

    const clinicianName =
      line.practitioner_id != null && String(line.practitioner_id).trim() !== ''
        ? providerNameByExtId.get(Number(line.practitioner_id)) ?? '—'
        : null;

    rows.push({
      lineId: line.id,
      treatmentLabel,
      date: dateRaw != null ? String(dateRaw).slice(0, 10) : null,
      clinicianName,
      revenue,
      cost,
      contribution,
    });
  }

  rows.sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return b.date.localeCompare(a.date);
  });

  return rows;
}

export function usePatientFinancialRecordList() {
  const { organizationId } = useOrganization();

  return useQuery({
    queryKey: [FINANCIAL_RECORD_VIEW, 'list', organizationId],
    enabled: !!organizationId,
    queryFn: () => fetchAllFinancialRecordRows(organizationId!),
    staleTime: 60 * 1000,
  });
}

export function usePatientFinancialRecordListTable() {
  const query = usePatientFinancialRecordList();
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<PatientListSortKey>('contribution');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);

  const filtered = useMemo(
    () => filterPatientRows(query.data ?? [], search),
    [query.data, search],
  );

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
    return sorted.slice(start, start + pageSize) as PatientFinancialRecordRow[];
  }, [sorted, effectivePage, pageSize]);

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

  return {
    ...query,
    search,
    onSearchChange,
    sortKey,
    sortDir,
    toggleSort,
    page: effectivePage,
    setPage,
    pageSize,
    totalPages,
    totalRows: sorted.length,
    pageRows,
    hasSyncedPatients: (query.data?.length ?? 0) > 0,
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
    queryFn: () =>
      fetchPatientTreatmentLines(organizationId!, patientId!, ptId ?? null),
    staleTime: 60 * 1000,
  });
}

export function usePatientInvoices(patientId: string | null | undefined) {
  const { organizationId } = useOrganization();

  return useQuery({
    queryKey: ['patient-invoices', organizationId, patientId],
    enabled: !!organizationId && !!patientId,
    queryFn: () => fetchPatientInvoices(organizationId!, patientId!),
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
