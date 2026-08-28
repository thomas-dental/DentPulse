import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';
import { ukDentalFinancialYear } from '@/utils/dentpulseNhsIncome';

/** Practice rollup from invoice-grained v_invoice_contribution + UDA lens. */
export type InvoiceContributionSummary = {
  invoiceCount: number;
  invoicesWithRevenue: number;
  patientCount: number;
  patientsWithRevenue: number;
  totalContribution: number;
  /** Private + plan (contribution engine scope). */
  totalRevenue: number;
  /** @deprecated Prefer revenueNhs */
  totalNhsExcluded: number;
  revenuePrivate: number;
  revenuePlan: number;
  revenueNhs: number;
  /** Delivered UDAs / obligation × 100, or null when no NHS contract. */
  udaDeliveryPct: number | null;
  udaClawbackGbp: number | null;
  udaOnTarget: boolean | null;
  hasNhsContract: boolean;
  nhsContractValue: number;
  udaDelivered: number;
  udaObligation: number;
  /** Invoices with no dominant practitioner (contribution excluded). */
  invoicesMissingPractitioner: number;
  /** Invoices with a practitioner but no configured private-share rate. */
  invoicesMissingRate: number;
  /** Private/plan £ on invoices with no practitioner (excluded from contribution). */
  revenueNoPractitioner: number;
  /** Private/plan £ on invoices where rate is missing (rate treated as 0%). */
  revenueMissingRate: number;
  hasMissingPractitioner: boolean;
  hasMissingRate: boolean;
  hasPartialData: boolean;
  /** Step 1a tier tags for UI chips (from view / derived flags). */
  revenueTier: 'Dentally';
  contributionTier: 'Derived';
  clinicianCostTier: 'Derived' | 'External';
  dominantProvenanceStatus: 'complete' | 'partial_no_practitioner' | 'partial_missing_rate';
};

/** @deprecated Prefer InvoiceContributionSummary */
export type PatientContributionSummary = InvoiceContributionSummary;

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Extract Dentally payment-plan ids from location membership_income_accounts JSON. */
function membershipPlanIdsFromAccounts(raw: unknown): Set<number> {
  const ids = new Set<number>();
  const push = (v: unknown) => {
    if (v == null) return;
    if (typeof v === 'number' && Number.isFinite(v)) {
      ids.add(v);
      return;
    }
    if (typeof v === 'string') {
      const t = v.trim();
      if (/^\d+$/.test(t)) ids.add(Number(t));
      return;
    }
    if (typeof v === 'object' && v !== null) {
      const o = v as Record<string, unknown>;
      push(o.id ?? o.pp_id ?? o.external_id ?? o.value);
    }
  };
  if (Array.isArray(raw)) {
    for (const item of raw) push(item);
  }
  return ids;
}

async function loadMembershipPlanIds(practiceId: string): Promise<Set<number>> {
  const { data, error } = await supabase
    .from('practice_locations')
    .select('membership_income_accounts, provider_membership_income_accounts, membership_income_source')
    .eq('organization_id', practiceId);

  if (error) {
    console.warn('[PE mix] membership plan lookup failed:', error.message);
    return loadMembershipPlanIdsFromDentallyPlans(practiceId);
  }

  const ids = new Set<number>();
  for (const row of data ?? []) {
    const source = String((row as { membership_income_source?: string }).membership_income_source || '')
      .trim()
      .toLowerCase();
    // Only Dentally/PMS plan ids — accounting COA uuids are not pp_ids.
    if (source && source !== 'pms' && source !== 'dentally') continue;
    for (const id of membershipPlanIdsFromAccounts(
      (row as { membership_income_accounts?: unknown }).membership_income_accounts,
    )) {
      ids.add(id);
    }
    for (const id of membershipPlanIdsFromAccounts(
      (row as { provider_membership_income_accounts?: unknown }).provider_membership_income_accounts,
    )) {
      ids.add(id);
    }
  }

  // When Setup Categories use accounting COA (or nothing configured), fall back to
  // Dentally payment_plans that look like membership / Practice Plan / Denplan.
  if (ids.size === 0) {
    return loadMembershipPlanIdsFromDentallyPlans(practiceId);
  }
  return ids;
}

/** Infer membership plan ids from synced Dentally payment_plans. */
async function loadMembershipPlanIdsFromDentallyPlans(
  practiceId: string,
): Promise<Set<number>> {
  const ids = new Set<number>();
  const pageSize = 1000;
  for (let from = 0; from < 20_000; from += pageSize) {
    const { data, error } = await (supabase as any)
      .from('payment_plans')
      .select('pp_id, pp_patient_friendly_name, pp_monthly_memberhsip_fee')
      .eq('organization_id', practiceId)
      .is('deleted_at', null)
      .range(from, from + pageSize - 1);

    if (error) {
      console.warn('[PE mix] payment_plans membership fallback:', error.message);
      break;
    }
    const rows = (data ?? []) as Array<{
      pp_id: number | string | null;
      pp_patient_friendly_name: string | null;
      pp_monthly_memberhsip_fee: number | string | null;
    }>;
    if (rows.length === 0) break;

    for (const row of rows) {
      const fee = num(row.pp_monthly_memberhsip_fee);
      const name = String(row.pp_patient_friendly_name || '').toLowerCase();
      const looksMembership =
        fee > 0 ||
        /practice\s*plan|denplan|membership|member\s*plan|capitation|subscription/.test(
          name,
        );
      if (!looksMembership) continue;
      const id = num(row.pp_id);
      if (id) ids.add(id);
    }
    if (rows.length < pageSize) break;
  }
  return ids;
}

async function loadMemberPatientPtIds(
  practiceId: string,
  membershipPpIds: Set<number>,
): Promise<Set<number>> {
  if (membershipPpIds.size === 0) return new Set();

  const ppList = [...membershipPpIds];
  const memberPts = new Set<number>();
  const pageSize = 1000;
  for (let from = 0; from < 50_000; from += pageSize) {
    const { data, error } = await supabase
      .from('patients')
      .select('pt_id, pt_payment_plan_id')
      .eq('organization_id', practiceId)
      .is('deleted_at', null)
      .in('pt_payment_plan_id', ppList)
      .range(from, from + pageSize - 1);

    if (error) {
      console.warn('[PE mix] member patients lookup failed:', error.message);
      break;
    }
    const rows = data ?? [];
    for (const row of rows) {
      const pt = num(row.pt_id);
      if (pt) memberPts.add(pt);
    }
    if (rows.length < pageSize) break;
  }
  return memberPts;
}

async function loadUdaLens(practiceId: string): Promise<{
  udaDeliveryPct: number | null;
  udaClawbackGbp: number | null;
  udaOnTarget: boolean | null;
  hasNhsContract: boolean;
  nhsContractValue: number;
  udaDelivered: number;
  udaObligation: number;
}> {
  const empty = {
    udaDeliveryPct: null as number | null,
    udaClawbackGbp: null as number | null,
    udaOnTarget: null as boolean | null,
    hasNhsContract: false,
    nhsContractValue: 0,
    udaDelivered: 0,
    udaObligation: 0,
  };

  const fy = ukDentalFinancialYear(new Date());

  const { data: settings, error: settingsErr } = await (supabase as any)
    .from('uda_settings')
    .select('nhs_contract_value, total_uda_obligation, location_id, contract_type')
    .eq('organization_id', practiceId)
    .eq('financial_year', fy)
    .eq('contract_type', 'NHS');

  if (settingsErr) {
    console.warn('[PE UDA] uda_settings:', settingsErr.message);
    return empty;
  }

  const rows = (settings ?? []) as Array<{
    nhs_contract_value: number | string | null;
    total_uda_obligation: number | string | null;
  }>;
  if (rows.length === 0) return empty;

  let obligation = 0;
  let contractValue = 0;
  for (const r of rows) {
    obligation += num(r.total_uda_obligation);
    contractValue += num(r.nhs_contract_value);
  }

  if (obligation <= 0 && contractValue <= 0) return empty;

  // Delivered UDAs = SUM(Dentally expected_uda) from completed NHS claims in
  // the UK dental FY YTD (1 Apr → today). Same source as chatbot NHS performance.
  const fyStart = `${fy}-04-01`;
  const now = new Date();
  const fyEndExclusive = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  )
    .toISOString()
    .slice(0, 10);

  let delivered = 0;
  const pageSize = 1000;
  let offset = 0;
  for (let i = 0; i < 500; i++) {
    const { data, error } = await (supabase as any)
      .from('nhs_claims')
      .select('nc_expected_uda')
      .eq('organization_id', practiceId)
      .eq('nc_claim_status', 'completed')
      .is('deleted_at', null)
      .gte('nc_submitted_date', fyStart)
      .lt('nc_submitted_date', fyEndExclusive)
      .range(offset, offset + pageSize - 1);

    if (error) {
      console.warn('[PE UDA] nhs_claims:', error.message);
      break;
    }
    const rowsPage = (data ?? []) as Array<{ nc_expected_uda: number | string | null }>;
    if (rowsPage.length === 0) break;
    for (const r of rowsPage) {
      delivered += num(r.nc_expected_uda);
    }
    if (rowsPage.length < pageSize) break;
    offset += pageSize;
  }
  delivered = Math.round(delivered * 100) / 100;

  const hasNhsContract = obligation > 0 || contractValue > 0;
  if (!hasNhsContract) return empty;

  const deliveryPct =
    obligation > 0 ? Math.round((delivered / obligation) * 1000) / 10 : null;
  const onTarget = deliveryPct != null ? deliveryPct >= 96 : null;
  const clawback =
    deliveryPct != null && deliveryPct < 100 && contractValue > 0
      ? Math.round(((100 - deliveryPct) / 100) * contractValue)
      : deliveryPct != null
        ? 0
        : null;

  return {
    udaDeliveryPct: deliveryPct,
    udaClawbackGbp: clawback,
    udaOnTarget: onTarget,
    hasNhsContract: true,
    nhsContractValue: contractValue,
    udaDelivered: delivered,
    udaObligation: obligation,
  };
}

async function fetchInvoiceContributionSummary(
  practiceId: string,
): Promise<InvoiceContributionSummary> {
  const [membershipPpIds, uda] = await Promise.all([
    loadMembershipPlanIds(practiceId),
    loadUdaLens(practiceId),
  ]);
  const memberPts = await loadMemberPatientPtIds(practiceId, membershipPpIds);

  const pageSize = 1000;
  let offset = 0;
  let invoiceCount = 0;
  let invoicesWithRevenue = 0;
  let totalContribution = 0;
  let totalRevenue = 0;
  let revenuePrivate = 0;
  let revenuePlan = 0;
  let revenueNhs = 0;
  let invoicesMissingPractitioner = 0;
  let invoicesMissingRate = 0;
  let revenueNoPractitioner = 0;
  let revenueMissingRate = 0;
  const patientIds = new Set<string>();
  const patientsWithRevenue = new Set<string>();

  for (let i = 0; i < 200; i++) {
    const { data, error } = await (supabase as any)
      .from('v_invoice_contribution')
      .select(
        'contribution, revenue_private_plan, revenue_nhs, nhs_excluded_amount, pt_id, patient_id, has_missing_practitioner, has_missing_rate, revenue_no_practitioner, revenue_missing_rate',
      )
      .eq('practice_id', practiceId)
      .range(offset, offset + pageSize - 1);

    if (error) throw error;
    const rows = (data ?? []) as Array<{
      contribution: number | string | null;
      revenue_private_plan: number | string | null;
      revenue_nhs: number | string | null;
      nhs_excluded_amount: number | string | null;
      pt_id: number | string | null;
      patient_id: string | null;
      has_missing_practitioner: boolean | null;
      has_missing_rate: boolean | null;
      revenue_no_practitioner: number | string | null;
      revenue_missing_rate: number | string | null;
    }>;
    if (rows.length === 0) break;

    for (const row of rows) {
      invoiceCount += 1;
      const privatePlan = num(row.revenue_private_plan);
      const nhs = num(row.revenue_nhs ?? row.nhs_excluded_amount);
      const contribution = num(row.contribution);
      const ptId = num(row.pt_id);

      totalRevenue += privatePlan;
      totalContribution += contribution;
      revenueNhs += nhs;

      if (privatePlan > 0 && ptId && memberPts.has(ptId)) {
        revenuePlan += privatePlan;
      } else {
        revenuePrivate += privatePlan;
      }

      if (privatePlan > 0) invoicesWithRevenue += 1;

      if (row.has_missing_practitioner) {
        invoicesMissingPractitioner += 1;
        revenueNoPractitioner += num(row.revenue_no_practitioner);
      }
      if (row.has_missing_rate) {
        invoicesMissingRate += 1;
        revenueMissingRate += num(row.revenue_missing_rate);
      }

      const patientKey =
        row.patient_id != null
          ? String(row.patient_id)
          : row.pt_id != null
            ? `pt:${row.pt_id}`
            : null;
      if (patientKey) {
        patientIds.add(patientKey);
        if (privatePlan > 0) patientsWithRevenue.add(patientKey);
      }
    }

    if (rows.length < pageSize) break;
    offset += pageSize;
  }

  const hasMissingPractitioner = invoicesMissingPractitioner > 0;
  const hasMissingRate = invoicesMissingRate > 0;
  const dominantProvenanceStatus = hasMissingPractitioner
    ? ('partial_no_practitioner' as const)
    : hasMissingRate
      ? ('partial_missing_rate' as const)
      : ('complete' as const);

  return {
    invoiceCount,
    invoicesWithRevenue,
    patientCount: patientIds.size,
    patientsWithRevenue: patientsWithRevenue.size,
    totalContribution,
    totalRevenue,
    totalNhsExcluded: revenueNhs,
    revenuePrivate,
    revenuePlan,
    revenueNhs,
    invoicesMissingPractitioner,
    invoicesMissingRate,
    revenueNoPractitioner,
    revenueMissingRate,
    hasMissingPractitioner,
    hasMissingRate,
    hasPartialData: hasMissingPractitioner || hasMissingRate,
    revenueTier: 'Dentally',
    contributionTier: 'Derived',
    clinicianCostTier: dominantProvenanceStatus === 'complete' ? 'Derived' : 'External',
    dominantProvenanceStatus,
    ...uda,
  };
}

export function useInvoiceContributionSummary() {
  const { organizationId } = useOrganization();

  return useQuery({
    queryKey: ['v_invoice_contribution', 'summary', 'mix-uda-claims-plan', organizationId],
    enabled: !!organizationId,
    queryFn: () => fetchInvoiceContributionSummary(organizationId!),
  });
}

/** @deprecated Prefer useInvoiceContributionSummary */
export function usePatientContributionSummary() {
  return useInvoiceContributionSummary();
}
