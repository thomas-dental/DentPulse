import { supabase } from '@/integrations/supabase/client';
import type {
  PractitionerRatesListResponse,
  PractitionerWithRates,
} from '@/types/patientEconomicsAssumptions';

function getBackendUrl(): string {
  if (typeof window !== 'undefined') {
    const h = window.location.hostname;
    const isLocal = h === 'localhost' || h.startsWith('127.');
    const isLAN = h.startsWith('192.168.') || h.startsWith('10.');
    return (
      import.meta.env.VITE_BACKEND_URL ||
      import.meta.env.VITE_SYNC_BACKEND_URL ||
      (isLocal ? 'http://localhost:4000' : isLAN ? '' : 'https://dent-enterprise-api.dentpulse.com')
    );
  }
  return 'http://localhost:4000';
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const {
    data: { session },
    error,
  } = await supabase.auth.refreshSession();
  if (error || !session) {
    const {
      data: { session: cached },
    } = await supabase.auth.getSession();
    if (!cached) throw new Error('No active session');
    return {
      Authorization: `Bearer ${cached.access_token}`,
      'Content-Type': 'application/json',
    };
  }
  return {
    Authorization: `Bearer ${session.access_token}`,
    'Content-Type': 'application/json',
  };
}

export type DentallyCredential = {
  id: string;
  accountLabel: string | null;
  patHint: string | null;
  validatedAt: string | null;
  needsReconnection: boolean;
  authErrorMessage: string | null;
  authFailedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SavePatResult =
  | { validated: true; credential?: DentallyCredential | null }
  | { validated: false; validationError: string; credential?: DentallyCredential | null };

export class DentallyUnreachableError extends Error {
  readonly code = 'DENTALLY_UNREACHABLE';
  readonly credential?: DentallyCredential | null;

  constructor(message: string, credential?: DentallyCredential | null) {
    super(message);
    this.name = 'DentallyUnreachableError';
    this.credential = credential;
  }
}

type ApiCredential = {
  id: string;
  accountLabel: string | null;
  patHint: string | null;
  validatedAt: string | null;
  needsReconnection?: boolean;
  authErrorMessage?: string | null;
  authFailedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

function mapCredential(row: ApiCredential): DentallyCredential {
  return {
    id: row.id,
    accountLabel: row.accountLabel,
    patHint: row.patHint,
    validatedAt: row.validatedAt,
    needsReconnection: row.needsReconnection === true,
    authErrorMessage: row.authErrorMessage || null,
    authFailedAt: row.authFailedAt || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Load the single saved PAT for a practice (one per practice). */
export async function getDentallyCredential(practiceId: string): Promise<DentallyCredential | null> {
  const headers = await getAuthHeaders();
  const params = new URLSearchParams({ practiceId });
  const res = await fetch(`${getBackendUrl()}/api/economics-engine/credentials?${params}`, {
    method: 'GET',
    headers,
  });
  const body = await res.json().catch(() => ({} as { success?: boolean; credential?: ApiCredential | null; error?: string }));

  if (!res.ok || !body.success) {
    throw new Error(body.error || `Failed to load credential (${res.status})`);
  }

  return body.credential ? mapCredential(body.credential) : null;
}

/** Encrypt, store, and validate the practice PAT (upserts — only one per practice). */
export async function saveDentallyPat(practiceId: string, pat: string): Promise<SavePatResult> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${getBackendUrl()}/api/economics-engine/credentials`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ practiceId, pat }),
  });
  const body = await res.json().catch(() => ({} as {
    success?: boolean;
    validated?: boolean;
    error?: string;
    code?: string;
    credential?: ApiCredential | null;
  }));

  const credential = body.credential ? mapCredential(body.credential) : null;

  if (body.code === 'DENTALLY_UNREACHABLE' || res.status === 503) {
    throw new DentallyUnreachableError(body.error || 'Dentally API is unavailable right now', credential);
  }

  if (!res.ok || !body.success) {
    throw new Error(body.error || `Save failed (${res.status})`);
  }

  if (body.validated === false) {
    return {
      validated: false,
      validationError: body.error || 'Token saved but could not be validated',
      credential,
    };
  }

  return { validated: true, credential };
}

/** Re-validate the stored PAT without re-entering it. */
export async function revalidateDentallyCredential(practiceId: string): Promise<SavePatResult> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${getBackendUrl()}/api/economics-engine/credentials/validate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ practiceId }),
  });
  const body = await res.json().catch(() => ({} as {
    success?: boolean;
    validated?: boolean;
    error?: string;
    code?: string;
    credential?: ApiCredential | null;
  }));

  const credential = body.credential ? mapCredential(body.credential) : null;

  if (body.code === 'DENTALLY_UNREACHABLE' || res.status === 503) {
    throw new DentallyUnreachableError(body.error || 'Dentally API is unavailable right now', credential);
  }

  if (!res.ok || !body.success) {
    throw new Error(body.error || `Validation failed (${res.status})`);
  }

  if (body.validated === false) {
    return {
      validated: false,
      validationError: body.error || 'Dentally rejected this token',
      credential,
    };
  }

  return { validated: true, credential };
}

/** Remove the stored PAT for a practice. */
export async function deleteDentallyCredential(practiceId: string): Promise<void> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${getBackendUrl()}/api/economics-engine/credentials`, {
    method: 'DELETE',
    headers,
    body: JSON.stringify({ practiceId }),
  });
  const body = await res.json().catch(() => ({} as { success?: boolean; error?: string }));

  if (!res.ok || !body.success) {
    throw new Error(body.error || `Delete failed (${res.status})`);
  }
}

/** Add another Dentally account to an org — PAT encrypted server-side (main sync lane). */
export async function connectDentallyAccount(
  organizationId: string,
  pat: string,
  label?: string
): Promise<{ integrationId: string; jobCount: number }> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${getBackendUrl()}/api/onboard/dentally/add-account/${organizationId}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      api_key: pat.trim(),
      api_endpoint: 'https://api.dentally.co',
      label: label?.trim() || undefined,
    }),
  });
  const body = await res.json().catch(() => ({} as {
    success?: boolean;
    error?: string;
    integrationId?: string;
    jobCount?: number;
  }));

  if (res.status === 409) {
    throw new Error(body.error || 'This Dentally account is already connected.');
  }
  if (!res.ok || !body.success) {
    throw new Error(body.error || `Connect failed (${res.status})`);
  }

  return {
    integrationId: body.integrationId!,
    jobCount: body.jobCount ?? 0,
  };
}

/** Fetch Dentally sites using stored encrypted PAT (never exposes token to browser). */
export async function fetchDentallySites(
  organizationId: string,
  integrationId: string
): Promise<{ id: string; name: string }[]> {
  const headers = await getAuthHeaders();
  const res = await fetch(
    `${getBackendUrl()}/api/organizations/${organizationId}/integrations/${integrationId}/dentally-sites`,
    { method: 'GET', headers }
  );
  const body = await res.json().catch(() => ({} as { success?: boolean; sites?: { id: string; name: string }[]; error?: string }));

  if (!res.ok || !body.success) {
    throw new Error(body.error || `Failed to load sites (${res.status})`);
  }

  return body.sites || [];
}

/** True when integration has an encrypted PAT (pat_hint is the client-safe indicator). */
export function integrationHasPat(integration: { pat_hint?: string | null; encrypted_pat?: string | null }): boolean {
  return !!(integration.pat_hint || integration.encrypted_pat);
}

/** List practitioners with current effective private-share rate (or explicit not-configured). */
export async function listPractitionerPrivateShareRates(
  practiceId: string,
  options?: {
    page?: number;
    pageSize?: number;
    search?: string;
    sortBy?: 'name' | 'private_share' | 'role';
    sortDir?: 'asc' | 'desc';
  },
): Promise<PractitionerRatesListResponse> {
  const headers = await getAuthHeaders();
  const params = new URLSearchParams({ practiceId });
  if (options?.page != null) params.set('page', String(options.page));
  if (options?.pageSize != null) params.set('pageSize', String(options.pageSize));
  if (options?.search) params.set('search', options.search);
  if (options?.sortBy) params.set('sortBy', options.sortBy);
  if (options?.sortDir) params.set('sortDir', options.sortDir);
  const res = await fetch(
    `${getBackendUrl()}/api/economics-engine/assumptions/practitioner-rates?${params}`,
    { method: 'GET', headers },
  );
  const body = await res.json().catch(() => ({} as {
    success?: boolean;
    error?: string;
    code?: string;
    practitioners?: PractitionerWithRates[];
    summary?: PractitionerRatesListResponse['summary'];
    pagination?: PractitionerRatesListResponse['pagination'];
  }));

  if (!res.ok || !body.success) {
    const err = new Error(body.error || `Failed to load practitioner rates (${res.status})`);
    if (body.code) (err as Error & { code?: string }).code = body.code;
    throw err;
  }

  return {
    practitioners: body.practitioners || [],
    summary: body.summary || {
      totalPractitioners: 0,
      configuredCount: 0,
      notConfiguredCount: 0,
      hasMissingRate: false,
    },
    pagination: body.pagination || {
      page: 1,
      pageSize: options?.pageSize ?? 10,
      totalPages: 1,
      totalCount: 0,
    },
  };
}

/** Load every clinician row (paginates past API pageSize cap of 50). */
export async function fetchAllPractitionerPrivateShareRates(
  practiceId: string,
): Promise<PractitionerWithRates[]> {
  const practitioners: PractitionerWithRates[] = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    const data = await listPractitionerPrivateShareRates(practiceId, {
      page,
      pageSize: 50,
    });
    practitioners.push(...data.practitioners);
    totalPages = data.pagination.totalPages;
    page += 1;
  }

  return practitioners;
}

export type JourneyStageKey =
  | 'planned'
  | 'scheduled'
  | 'started'
  | 'completed'
  | 'charged'
  | 'collected';

export type JourneyEventType =
  | 'PLAN_CREATED'
  | 'APPOINTMENT_LINKED'
  | 'TREATMENT_STARTED'
  | 'PLAN_COMPLETED'
  | 'INVOICE_RAISED'
  | 'PAYMENT_ALLOCATED';

export type TreatmentEconomicJourneyStage = {
  key: JourneyStageKey;
  label: string;
  eventType: JourneyEventType;
  eventCount: number;
  valueGbp: number;
};

export type TreatmentEconomicJourneyResponse = {
  stages: TreatmentEconomicJourneyStage[];
  totalEvents: number;
  plannedEventCount: number;
  isBackfilling: boolean;
};

/** Aggregated Treatment Economic Journey™ from backend (event_ledger rollup). */
export async function fetchTreatmentEconomicJourney(
  practiceId: string,
): Promise<TreatmentEconomicJourneyResponse> {
  const headers = await getAuthHeaders();
  const params = new URLSearchParams({ practiceId });
  const res = await fetch(
    `${getBackendUrl()}/api/economics-engine/journey/treatment-economic?${params}`,
    { method: 'GET', headers },
  );
  const body = await res.json().catch(
    () =>
      ({} as {
        success?: boolean;
        error?: string;
        stages?: TreatmentEconomicJourneyStage[];
        totalEvents?: number;
        plannedEventCount?: number;
        isBackfilling?: boolean;
      }),
  );

  if (!res.ok || !body.success) {
    throw new Error(body.error || `Failed to load treatment economic journey (${res.status})`);
  }

  return {
    stages: body.stages || [],
    totalEvents: body.totalEvents ?? 0,
    plannedEventCount: body.plannedEventCount ?? 0,
    isBackfilling: body.isBackfilling === true,
  };
}

async function economicsReadGet<T>(
  path: string,
  params: Record<string, string>,
): Promise<T> {
  const headers = await getAuthHeaders();
  const qs = new URLSearchParams(params);
  const res = await fetch(`${getBackendUrl()}/api/economics-engine${path}?${qs}`, {
    method: 'GET',
    headers,
  });
  const body = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string } & T;
  if (!res.ok || !body.success) {
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return body;
}

/** Patient List rows — server aggregates v_patient_contribution + 12mo metrics. */
export async function fetchPatientContributionList(practiceId: string) {
  return economicsReadGet<{
    success: true;
    practiceId: string;
    practiceName: string;
    rollupMode: 'location' | 'practice';
    locations: Array<{ id: string; name: string }>;
    patients: Array<Record<string, unknown>>;
  }>('/read/patient-contribution-list', { practiceId });
}

/** Patient Financial Records roster rows. */
export async function fetchPatientFinancialRecordList(practiceId: string) {
  return economicsReadGet<{
    success: true;
    practiceId: string;
    practiceName: string;
    rollupMode: 'location' | 'practice';
    locations: Array<{ id: string; name: string }>;
    patients: Array<Record<string, unknown>>;
  }>('/read/patient-financial-records', { practiceId });
}

/** Single patient financial record detail. Returns null when patient not in PE data. */
export async function fetchPatientFinancialRecordApi(
  practiceId: string,
  patientId: string,
) {
  const headers = await getAuthHeaders();
  const params = new URLSearchParams({ practiceId, patientId });
  const res = await fetch(
    `${getBackendUrl()}/api/economics-engine/read/patient-financial-record?${params}`,
    { method: 'GET', headers },
  );
  const body = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    error?: string;
    row?: Record<string, unknown>;
    modelled?: Record<string, unknown> | null;
    retention?: Record<string, unknown>;
    invoices?: Array<Record<string, unknown>>;
    acquisitionSourceName?: string | null;
    recallHint?: string | null;
  };
  if (res.status === 404) return null;
  if (!res.ok || !body.success) {
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return body;
}

/** Expanded roster treatment lines for one patient. */
export async function fetchPatientTreatmentLinesApi(
  practiceId: string,
  patientId: string,
  ptId: number | null,
) {
  const params: Record<string, string> = { practiceId, patientId };
  if (ptId != null) params.ptId = String(ptId);
  return economicsReadGet<{
    success: true;
    practiceId: string;
    patientId: string;
    lines: Array<Record<string, unknown>>;
  }>('/read/patient-treatment-lines', params);
}

/** Patient invoice drill-down rows. */
export async function fetchPatientInvoicesApi(practiceId: string, patientId: string) {
  return economicsReadGet<{
    success: true;
    practiceId: string;
    patientId: string;
    invoices: Array<Record<string, unknown>>;
  }>('/read/patient-invoices', { practiceId, patientId });
}

/** Economic Pulse practice rollup from v_invoice_contribution. */
export async function fetchInvoiceContributionSummaryApi(practiceId: string) {
  return economicsReadGet<{
    success: true;
    practiceId: string;
    summary: Record<string, unknown>;
  }>('/read/invoice-contribution-summary', { practiceId });
}

/** Economic Pulse hero row — combined invoice, leakage, retention, growth metrics. */
export async function fetchEconomicPulseHeroApi(practiceId: string) {
  return economicsReadGet<{
    success: true;
    practiceId: string;
    invoiceSummary: Record<string, unknown>;
    opportunityWeighted: number;
    opportunityGross: number;
    opportunityWeightedTier: string;
    atRiskContributionGbp: number;
    retentionTier: string;
    commitmentRate30d: number;
    commitmentRate30dTier: string;
    avgAnnualContribution: number | null;
    projectedLtv: number | null;
    projectedLtvTier: string;
  }>('/read/economic-pulse-hero', { practiceId });
}

/** Cost Impact / multi-site practice contribution rollup (backend RPCs). */
export async function fetchPracticeContributionRollupApi() {
  return economicsReadGet<{
    success: true;
    rollupMode: 'location' | 'practice';
    rows: Array<Record<string, unknown>>;
  }>('/read/practice-contribution-rollup', {});
}

/** Value & Leakage — planned private items unscheduled beyond threshold days. */
export async function fetchPlannedUnscheduledLeakageApi(practiceId: string) {
  return economicsReadGet<{
    success: true;
    practiceId: string;
    thresholdDays: number;
    tier: string;
    tierNote: string;
    itemCount: number;
    totalValueAtRisk: number;
    marginPct?: number | null;
    contributionOpportunity?: number | null;
    rows: Array<{
      planId: string;
      tpiId: string | null;
      patientId: string;
      patientName: string;
      treatmentValue: number;
      daysUnscheduled: number;
      planCreatedAt: string;
    }>;
  }>('/read/planned-unscheduled-leakage', { practiceId });
}

/** Value & Leakage — opportunity + commitment breakdowns. */
export async function fetchValueLeakageSummaryApi(practiceId: string) {
  return economicsReadGet<{
    success: true;
    practiceId: string;
    opportunityGross: number;
    opportunityGrossTier: string;
    opportunityGrossTierNote: string;
    opportunityWeighted: number;
    opportunityWeightedTier: string;
    opportunityWeightedTierNote: string;
    opportunityWeightConfidence: number;
    opportunityByCategory?: Array<{
      category: string;
      gross: number;
      weighted: number;
    }>;
    weightingWindowDays: number;
    commitmentRate30d: number;
    commitmentRate30dTier: string;
    commitmentRate30dConfidence: number;
    commitmentRate30dTierNote: string;
    commitmentRate30dEligibleValue: number;
    commitmentRate30dCommittedValue: number;
    byWindow: Array<{
      windowDays: number;
      commitmentRate: number;
      totalEligibleValue: number;
      committedValueWithinWindow: number;
      eligibleItemCount: number;
      committedItemCount: number;
      confidence: number;
      tier: string;
      tierNote: string;
    }>;
    byClinician: Array<{
      practitionerExtId: string | null;
      providerId: string | null;
      practitionerName: string;
      windowDays: number;
      commitmentRate: number;
      totalEligibleValue: number;
      committedValueWithinWindow: number;
      eligibleItemCount: number;
      committedItemCount: number;
      confidence: number;
      tier: string;
      attributionTier: string;
      tierNote: string;
    }>;
    clinicianWindowDays: number;
    hasUnattributedPlanItems: boolean;
    unattributedEligibleValue: number;
    tier: string;
    tierNote: string;
  }>('/read/value-leakage-summary', { practiceId });
}

/** Growth Levers — visit frequency and value per visit (Derived tier). */
export async function fetchGrowthLeversSummaryApi(practiceId: string) {
  return economicsReadGet<{
    success: true;
    practiceId: string;
    trailingMonths: number;
    sinceDate: string;
    visitFrequency: number | null;
    visitFrequencyTier: string;
    visitFrequencyTierNote: string;
    valuePerVisit: number | null;
    valuePerVisitTier: string;
    valuePerVisitTierNote: string;
    totalCompletedVisits: number;
    totalRevenuePrivatePlan: number;
    activePatientCount: number;
    monthly: Array<{
      month: string;
      completedVisits: number;
      revenuePrivatePlan: number;
      valuePerVisit: number | null;
    }>;
    hasAppointmentData: boolean;
    hasRevenueData: boolean;
    hasActivePatients: boolean;
    tenureYears: number | null;
    tenureTier: string;
    tenureTierNote: string;
    tenurePatientCount: number;
    projectedLifetimeYears: number | null;
    projectedLifetimeTier: string;
    projectedLifetimeTierNote: string;
    projectedLifetimePatientCount: number;
    hasTenureData: boolean;
    hasProjectedLifetimeData: boolean;
    tier: string;
    tierNote: string;
  }>('/read/growth-levers-summary', { practiceId });
}

/** Multi-practice growth levers with headroom vs benchmark. */
export async function fetchGrowthLeversByPracticeApi(practiceId: string) {
  return economicsReadGet<{
    success: true;
    contextPracticeId: string;
    benchmarkMethod: string;
    benchmarkMethodNote: string;
    groupBenchmarks: {
      visitFrequency: number | null;
      valuePerVisit: number | null;
      tenureYears: number | null;
      projectedLifetimeYears: number | null;
    };
    practices: Array<{
      practiceId: string;
      practiceName: string;
      visitFrequency: number | null;
      valuePerVisit: number | null;
      tenureYears: number | null;
      projectedLifetimeYears: number | null;
      trailingMonths: number | null;
      benchmarks: {
        visitFrequency: number | null;
        valuePerVisit: number | null;
        tenureYears: number | null;
        projectedLifetimeYears: number | null;
      };
      visitFrequencyHeadroom: number | null;
      valuePerVisitHeadroom: number | null;
      tenureHeadroom: number | null;
      projectedLifetimeHeadroom: number | null;
      combinedHeadroomPct: number | null;
      topLeverToPull: string | null;
    }>;
    hasData: boolean;
  }>('/read/growth-levers-by-practice', { practiceId });
}

export type RetentionContributionSegmentRow = {
  status: string;
  label: string;
  patientCount: number;
  contributionGbp: number;
};

export type RetentionContributionRollup = {
  practiceId: string;
  practiceName: string;
  segments: RetentionContributionSegmentRow[];
  totalContributionGbp: number;
  totalPatientCount: number;
  atRiskContributionGbp: number;
  atRiskPatientCount: number;
  tier: string;
  tierNote: string;
};

/** Retention & Reactivation — contribution by 4-tier segment (practice + group). */
export async function fetchRetentionContributionAtRiskApi(practiceId: string) {
  return economicsReadGet<{
    success: true;
    practiceId: string;
    practiceName: string;
    practice: RetentionContributionRollup;
    group: RetentionContributionRollup & {
      practiceCount: number;
      practices: RetentionContributionRollup[];
    };
    hasData: boolean;
  }>('/read/retention-contribution-at-risk', { practiceId });
}

export type ReactivationFlagRow = {
  flagId: string;
  patientId: string;
  patientName: string;
  segmentAtFlagTime: string;
  /** Live retention_status on v_patient_contribution — matches Patient Records. */
  currentRetentionStatus: string;
  contributionAtRiskAtFlagTime: number;
  contributionPreFlagGbp: number;
  flaggedAt: string;
  status: string;
  recoveredAt: string | null;
  reactivatedEventAt: string | null;
  contributionRecoveredGbp: number | null;
  recoveryWindowDays: number;
  trailingMonths: number;
  practiceId?: string;
  practiceName?: string;
};

export type ReactivationWorklistRow = ReactivationFlagRow & {
  daysSinceFlagged: number;
  lastVisitAt: string | null;
  daysOverdue: number;
  histContributionYr: number;
  ownerName: string | null;
  workflowStatus: 'new' | 'contacted' | 'booked' | 'recovered';
};

export type RecoveryFunnelStage = {
  key: string;
  label: string;
  valueGbp: number;
};

export type RecoveryFunnel = {
  flaggedAtRiskGbp: number;
  assignedGbp: number;
  contactedGbp: number;
  bookedGbp: number;
  recoveredAtRiskGbp: number;
  recoveredValueGbp: number;
  openValueGbp: number;
  bankedPct: number | null;
  stages: RecoveryFunnelStage[];
};

export type RetentionRecoveryPracticePayload = {
  practiceId: string;
  practiceName: string;
  reactivationValueGbp: number;
  openFlagCount: number;
  recoveryWindowDays: number;
  minContributionThresholdGbp: number;
  trailingMonths: number;
  flaggedValueGbp: number;
  recoveredValueGbp: number;
  recoveredAtRiskGbp: number;
  openValueGbp: number;
  recoveredFlagCount: number;
  totalFlagCount: number;
  recoveryRatePct: number | null;
  recoveryFlagRatePct: number | null;
  flags: ReactivationFlagRow[];
  openWorklist: ReactivationWorklistRow[];
  recoveredThisQuarterGbp: number;
  inProgressGbp: number;
  recoveryFunnel: RecoveryFunnel;
  tier: string;
  tierNote: string;
};

export type ReactivationValueByPracticeRow = {
  practiceId: string;
  practiceName: string;
  reactivationValueGbp: number;
  openFlagCount: number;
};

/** Retention & Reactivation — flags, recovery loop, reactivation value by practice. */
export async function fetchRetentionRecoveryLoopApi(practiceId: string) {
  return economicsReadGet<{
    success: true;
    contextPracticeId: string;
    practiceName: string;
    practice: RetentionRecoveryPracticePayload;
    group: RetentionRecoveryPracticePayload & {
      practiceCount: number;
      practices: ReactivationValueByPracticeRow[];
      flags: ReactivationFlagRow[];
    };
    hasData: boolean;
  }>('/read/retention-recovery-loop', { practiceId });
}

/** Day 3 modelled CLTV rollup by acquisition source. */
export async function fetchCltvByAcquisitionSourceApi(practiceId: string) {
  return economicsReadGet<{
    success: true;
    practiceId: string;
    minSampleSize: number;
    minSampleTierNote: string;
    sources: Array<{
      acquisitionSourceName: string;
      patientCount: number;
      avgCltv: number;
      totalCltv: number;
      avgQualityScore: number;
      isThinSample: boolean;
      tier: string;
    }>;
    hasData: boolean;
    tier: string;
    tierNote: string;
  }>('/read/cltv-by-acquisition-source', { practiceId });
}

/** Goal Settings — group defaults + per-practice overrides with actuals. */
export async function fetchGoalSettingsApi(practiceId: string) {
  return economicsReadGet<{
    success: true;
    contextPracticeId: string;
    commitmentWindowDays: number;
    quarterStart: string;
    defaults: {
      commitmentRatePct: number | null;
      contributionPerActiveGbp: number | null;
      opportunityProgressionGbp: number | null;
      attritionCeilingPct: number | null;
    };
    contextMetrics: {
      commitmentRate: { actual: number | null; target: number | null; progressPct: number | null; onTrack: boolean | null };
      contributionPerActive: { actual: number | null; target: number | null; progressPct: number | null; onTrack: boolean | null };
      opportunityProgression: { actual: number | null; target: number | null; progressPct: number | null; onTrack: boolean | null };
      attritionCeiling: { actual: number | null; target: number | null; progressPct: number | null; onTrack: boolean | null };
    } | null;
    practices: Array<{
      practiceId: string;
      practiceName: string;
      override: {
        commitmentRatePct: number | null;
        contributionPerActiveGbp: number | null;
        opportunityProgressionGbp: number | null;
        attritionCeilingPct: number | null;
      } | null;
      targets: {
        commitmentRatePct: number | null;
        contributionPerActiveGbp: number | null;
        opportunityProgressionGbp: number | null;
        attritionCeilingPct: number | null;
      };
      actuals: {
        commitmentRate30d: number | null;
        contributionPerActiveGbp: number | null;
        opportunityProgressionGbp: number | null;
        attritionPct: number | null;
      };
      metrics: {
        commitmentRate: { actual: number | null; target: number | null; progressPct: number | null; onTrack: boolean | null };
        contributionPerActive: { actual: number | null; target: number | null; progressPct: number | null; onTrack: boolean | null };
        opportunityProgression: { actual: number | null; target: number | null; progressPct: number | null; onTrack: boolean | null };
        attritionCeiling: { actual: number | null; target: number | null; progressPct: number | null; onTrack: boolean | null };
      };
    }>;
    hasData: boolean;
  }>('/read/goal-settings', { practiceId });
}

export async function saveGoalSettingsApi(
  contextPracticeId: string,
  payload: {
    defaults: {
      commitmentRatePct: number | null;
      contributionPerActiveGbp: number | null;
      opportunityProgressionGbp: number | null;
      attritionCeilingPct: number | null;
    };
    practiceOverrides: Array<{
      practiceId: string;
      commitmentRatePct: number | null;
      contributionPerActiveGbp: number | null;
      opportunityProgressionGbp: number | null;
      attritionCeilingPct: number | null;
    }>;
  },
) {
  const headers = await getAuthHeaders();
  const res = await fetch(`${getBackendUrl()}/api/economics-engine/assumptions/goal-settings`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ contextPracticeId, ...payload }),
  });
  const body = await res.json().catch(() => ({} as { success?: boolean; error?: string }));
  if (!res.ok || !body.success) {
    throw new Error(body.error || `Failed to save goal settings (${res.status})`);
  }
  return body;
}

export async function fetchEconomicAssumptionsApi(practiceId: string) {
  const headers = await getAuthHeaders();
  const params = new URLSearchParams({ practiceId });
  const res = await fetch(
    `${getBackendUrl()}/api/economics-engine/assumptions/economic-assumptions?${params}`,
    { method: 'GET', headers },
  );
  const body = await res.json().catch(() => ({} as { success?: boolean; error?: string }));
  if (!res.ok || !body.success) {
    throw new Error(body.error || `Failed to load economic assumptions (${res.status})`);
  }
  return body as {
    practiceId: string;
    assumptions: import('@/types/peEconomicAssumptions').PeEconomicAssumptions;
    defaults: import('@/types/peEconomicAssumptions').PeEconomicAssumptions;
    opsOnlyNote?: string;
  };
}

export async function saveEconomicAssumptionsApi(
  practiceId: string,
  assumptions: import('@/types/peEconomicAssumptions').PeEconomicAssumptions,
) {
  const headers = await getAuthHeaders();
  const res = await fetch(`${getBackendUrl()}/api/economics-engine/assumptions/economic-assumptions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ practiceId, assumptions }),
  });
  const body = await res.json().catch(() => ({} as { success?: boolean; error?: string }));
  if (!res.ok || !body.success) {
    throw new Error(body.error || `Failed to save economic assumptions (${res.status})`);
  }
  return body;
}

export async function fetchConversionProbabilitiesApi(practiceId: string) {
  const headers = await getAuthHeaders();
  const params = new URLSearchParams({ practiceId });
  const res = await fetch(
    `${getBackendUrl()}/api/economics-engine/read/conversion-probabilities?${params}`,
    { method: 'GET', headers },
  );
  const body = await res.json().catch(() => ({} as { success?: boolean; error?: string }));
  if (!res.ok || !body.success) {
    throw new Error(body.error || `Failed to load conversion probabilities (${res.status})`);
  }
  return body as import('@/types/peEconomicAssumptions').PeConversionProbabilitiesSummary;
}

/** Append a new effective-dated private-share rate (never updates existing rows). */
export async function createPractitionerPrivateShareRate(
  practiceId: string,
  practitionerId: string,
  rate: number,
  effectiveFrom: string,
): Promise<PractitionerWithRates & { inserted: { id: string; rate: number; effectiveFrom: string; createdAt: string } }> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${getBackendUrl()}/api/economics-engine/assumptions/practitioner-rates`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ practiceId, practitionerId, rate, effectiveFrom }),
  });
  const body = await res.json().catch(() => ({} as {
    success?: boolean;
    error?: string;
    code?: string;
    practitionerId?: string;
    practitionerName?: string;
    rateConfigured?: boolean;
    currentRate?: number | null;
    currentEffectiveFrom?: string | null;
    history?: PractitionerWithRates['history'];
    inserted?: { id: string; rate: number; effectiveFrom: string; createdAt: string };
  }));

  if (!res.ok || !body.success) {
    throw new Error(body.error || `Failed to save rate (${res.status})`);
  }

  return {
    id: practitionerId,
    name: body.practitionerName || '',
    providerRole: null,
    isActive: true,
    rateConfigured: body.rateConfigured === true,
    currentRate: body.currentRate ?? null,
    currentEffectiveFrom: body.currentEffectiveFrom ?? null,
    history: body.history || [],
    inserted: body.inserted!,
  };
}
