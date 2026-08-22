import { supabase } from '@/integrations/supabase/client';

// Mirrors SYNC_BACKEND_URL logic from syncJobService.ts
const getBackendUrl = (): string => {
  if (typeof window !== 'undefined') {
    const h = window.location.hostname;
    const isLocal = h === 'localhost' || h.startsWith('127.');
    const isLAN   = h.startsWith('192.168.') || h.startsWith('10.');
    return (import.meta.env as any).VITE_SYNC_BACKEND_URL ||
      (isLocal ? 'http://localhost:4000' : isLAN ? '' : 'https://dent-enterprise-api.dentpulse.com');
  }
  return 'http://localhost:4000';
};

async function getToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  if (data.session?.access_token) return data.session.access_token;
  const { data: r } = await supabase.auth.refreshSession();
  return r.session?.access_token || '';
}

async function apiFetch<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const base  = getBackendUrl();
  const token = await getToken();
  const res   = await fetch(`${base}/api/plaid${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(opts.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!body.success && body.error) throw new Error(body.error);
  return body;
}

// ── Onboarding ────────────────────────────────────────────────────────────────

export const PlaidService = {
  getOnboardingState: (orgId: string) =>
    apiFetch<any>(`/onboarding/state?orgId=${orgId}`),

  saveBusinessStep: (data: {
    orgId: string; legalName: string; companiesHouseNumber?: string;
    tradingName?: string; address?: string; industry?: string;
  }) => apiFetch<any>('/onboarding/business', { method: 'POST', body: JSON.stringify(data) }),

  addPerson: (data: {
    orgId: string; verificationId: string; firstName: string; lastName: string;
    role?: string; ownershipPercent?: number;
  }) => apiFetch<any>('/onboarding/people', { method: 'POST', body: JSON.stringify(data) }),

  removePerson: (personId: string) =>
    apiFetch<any>(`/onboarding/people/${personId}`, { method: 'DELETE' }),

  getPersonIdvToken: (personId: string) =>
    apiFetch<any>(`/onboarding/people/${personId}/idv-token`, { method: 'POST', body: '{}' }),

  submitPersonIdvResult: (personId: string, idvId?: string) =>
    apiFetch<any>(`/onboarding/people/${personId}/idv-result`, {
      method: 'POST', body: JSON.stringify({ idvId }),
    }),

  getOnboardingBankLinkToken: (orgId: string) =>
    apiFetch<any>('/onboarding/bank/link-token', { method: 'POST', body: JSON.stringify({ orgId }) }),

  connectOnboardingBank: (data: { orgId: string; publicToken: string; metadata: any }) =>
    apiFetch<any>('/onboarding/bank/connect', { method: 'POST', body: JSON.stringify(data) }),

  disconnectOnboardingBank: (orgId: string) =>
    apiFetch<any>(`/onboarding/bank?orgId=${encodeURIComponent(orgId)}`, { method: 'DELETE' }),

  // ── Connections ─────────────────────────────────────────────────────────────

  getLinkToken: (orgId: string) =>
    apiFetch<any>('/link-token', { method: 'POST', body: JSON.stringify({ orgId }) }),

  exchangeToken: (data: { orgId: string; publicToken: string; metadata: any }) =>
    apiFetch<any>('/exchange-token', { method: 'POST', body: JSON.stringify(data) }),

  getConnections: (orgId: string) =>
    apiFetch<any>(`/connections?orgId=${orgId}`),

  disconnectBank: (connId: string) =>
    apiFetch<any>(`/connections/${connId}`, { method: 'DELETE' }),

  // ── Invoice Payment Initiation ───────────────────────────────────────────────

  initiateInvoicePayment: (data: {
    orgId: string;
    vendorBankId?: string;
    vendorBankName?: string;
    vendorSortCode?: string;
    vendorAccountNumber?: string;
    amount: number;
    reference?: string;
  }) => apiFetch<{ success: boolean; plaidPaymentId: string; linkToken: string }>(
    '/invoice-pay', { method: 'POST', body: JSON.stringify(data) }
  ),

  refreshBalances: (connId: string) =>
    apiFetch<any>(`/connections/${connId}/refresh`, { method: 'POST', body: '{}' }),

  getTransactions: (connId: string, startDate: string, endDate: string) =>
    apiFetch<any>(`/connections/${connId}/transactions?startDate=${startDate}&endDate=${endDate}`),
};
