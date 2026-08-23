import { supabase } from '@/integrations/supabase/client';

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
  createdAt: string;
  updatedAt: string;
};

function mapCredential(row: ApiCredential): DentallyCredential {
  return {
    id: row.id,
    accountLabel: row.accountLabel,
    patHint: row.patHint,
    validatedAt: row.validatedAt,
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
