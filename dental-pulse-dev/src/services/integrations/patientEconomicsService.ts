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

/** DEV-only mock: localStorage `pe-pat-mock` = validated | invalid | unreachable | error */
function applyDevMock(): SavePatResult | null {
  if (!import.meta.env.DEV) return null;
  const mock = localStorage.getItem('pe-pat-mock');
  if (mock === 'validated') return { validated: true };
  if (mock === 'invalid') {
    return {
      validated: false,
      validationError: 'Token saved, but Dentally rejected it. Check the PAT and try again.',
    };
  }
  if (mock === 'unreachable') {
    throw new DentallyUnreachableError(
      'Token saved, but Dentally timed out. Try connecting again in a moment.',
    );
  }
  if (mock === 'error') {
    throw new Error('Failed to save credentials. Please try again.');
  }
  return null;
}

/** Encrypt, store, and validate Dentally PAT for a practice. */
export async function saveDentallyPat(practiceId: string, pat: string): Promise<SavePatResult> {
  const devResult = applyDevMock();
  if (devResult) {
    await new Promise((r) => setTimeout(r, 800));
    return devResult;
  }

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
