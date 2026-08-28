import { useQuery } from '@tanstack/react-query';
import { useOrganization } from '@/hooks/useOrganization';
import { fetchInvoiceContributionSummaryApi } from '@/services/integrations/patientEconomicsService';

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

function mapInvoiceContributionSummary(raw: Record<string, unknown>): InvoiceContributionSummary {
  const dominant = String(raw.dominantProvenanceStatus || 'complete');
  return {
    invoiceCount: num(raw.invoiceCount),
    invoicesWithRevenue: num(raw.invoicesWithRevenue),
    patientCount: num(raw.patientCount),
    patientsWithRevenue: num(raw.patientsWithRevenue),
    totalContribution: num(raw.totalContribution),
    totalRevenue: num(raw.totalRevenue),
    totalNhsExcluded: num(raw.totalNhsExcluded),
    revenuePrivate: num(raw.revenuePrivate),
    revenuePlan: num(raw.revenuePlan),
    revenueNhs: num(raw.revenueNhs),
    udaDeliveryPct: raw.udaDeliveryPct == null ? null : num(raw.udaDeliveryPct),
    udaClawbackGbp: raw.udaClawbackGbp == null ? null : num(raw.udaClawbackGbp),
    udaOnTarget: raw.udaOnTarget == null ? null : raw.udaOnTarget === true,
    hasNhsContract: raw.hasNhsContract === true,
    nhsContractValue: num(raw.nhsContractValue),
    udaDelivered: num(raw.udaDelivered),
    udaObligation: num(raw.udaObligation),
    invoicesMissingPractitioner: num(raw.invoicesMissingPractitioner),
    invoicesMissingRate: num(raw.invoicesMissingRate),
    revenueNoPractitioner: num(raw.revenueNoPractitioner),
    revenueMissingRate: num(raw.revenueMissingRate),
    hasMissingPractitioner: raw.hasMissingPractitioner === true,
    hasMissingRate: raw.hasMissingRate === true,
    hasPartialData: raw.hasPartialData === true,
    revenueTier: 'Dentally',
    contributionTier: 'Derived',
    clinicianCostTier:
      dominant === 'complete' ? 'Derived' : 'External',
    dominantProvenanceStatus:
      dominant === 'partial_no_practitioner' || dominant === 'partial_missing_rate'
        ? dominant
        : 'complete',
  };
}

async function fetchInvoiceContributionSummary(
  practiceId: string,
): Promise<InvoiceContributionSummary> {
  const { summary } = await fetchInvoiceContributionSummaryApi(practiceId);
  return mapInvoiceContributionSummary(summary);
}

export function useInvoiceContributionSummary() {
  const { organizationId } = useOrganization();

  return useQuery({
    queryKey: ['invoice-contribution-summary', organizationId],
    enabled: !!organizationId,
    queryFn: () => fetchInvoiceContributionSummary(organizationId!),
  });
}

/** @deprecated Prefer useInvoiceContributionSummary */
export function usePatientContributionSummary() {
  return useInvoiceContributionSummary();
}
