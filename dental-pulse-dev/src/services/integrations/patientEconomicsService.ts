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

export type SavePatResult =
  | { validated: true }
  | { validated: false; validationError: string };

export class DentallyUnreachableError extends Error {
  readonly code = 'DENTALLY_UNREACHABLE';

  constructor(message: string) {
    super(message);
    this.name = 'DentallyUnreachableError';
  }
}

/** Encrypt, store, and validate Dentally PAT for a practice. */
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
  }));

  if (body.code === 'DENTALLY_UNREACHABLE' || res.status === 503) {
    throw new DentallyUnreachableError(body.error || 'Dentally API is unavailable right now');
  }

  if (!res.ok || !body.success) {
    throw new Error(body.error || `Save failed (${res.status})`);
  }

  if (body.validated === false) {
    return {
      validated: false,
      validationError: body.error || 'Token saved but could not be validated',
    };
  }

  return { validated: true };
}
