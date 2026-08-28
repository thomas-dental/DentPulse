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
