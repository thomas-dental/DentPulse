import { supabase } from './supabase';

const API_URL = import.meta.env.VITE_API_URL;

const getHeaders = () => {
  const token = localStorage.getItem('access_token');
  return {
    'Content-Type': 'application/json',
    ...(token && { Authorization: `Bearer ${token}` }),
  };
};

export const api = {
  // Exchange the stored refresh_token for a new access token. Returns true on
  // success (and updates localStorage), false if there's no refresh token or it
  // was rejected. De-duped so concurrent callers share one network round-trip.
  _refreshInFlight: null,
  refreshSession() {
    if (this._refreshInFlight) return this._refreshInFlight;
    const refresh_token = localStorage.getItem('refresh_token');
    if (!refresh_token) return Promise.resolve(false);
    this._refreshInFlight = supabase.auth
      .refreshSession({ refresh_token })
      .then(({ data, error }) => {
        if (error || !data?.session) return false;
        localStorage.setItem('access_token', data.session.access_token);
        localStorage.setItem('refresh_token', data.session.refresh_token);
        return true;
      })
      .catch(() => false)
      .finally(() => { this._refreshInFlight = null; });
    return this._refreshInFlight;
  },

  async login(email, password) {
    const res = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data;
  },

  async logout() {
    const res = await fetch(`${API_URL}/auth/logout`, {
      method: 'POST',
      headers: getHeaders(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data;
  },

  async getMe() {
    const res = await fetch(`${API_URL}/auth/me`, {
      headers: getHeaders(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data;
  },

  async getDashboardStats() {
    const res = await fetch(`${API_URL}/dashboard/stats`, {
      headers: getHeaders(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data;
  },

  async getUsers() {
    const res = await fetch(`${API_URL}/users`, {
      headers: getHeaders(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data;
  },

  async getOrganizations() {
    const res = await fetch(`${API_URL}/organizations`, {
      headers: getHeaders(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data;
  },

  async getOrganization(id) {
    const res = await fetch(`${API_URL}/organizations/${id}`, {
      headers: getHeaders(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data;
  },

  async getDentallyAccounts(orgId) {
    const res = await fetch(`${API_URL}/organizations/${orgId}/dentally-accounts`, {
      headers: getHeaders(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data;
  },

  async deleteUser(id) {
    const res = await fetch(`${API_URL}/users/${id}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data;
  },

  async setUserAiKey(id, apiKey) {
    const res = await fetch(`${API_URL}/users/${id}/ai-key`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({ api_key: apiKey }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data;
  },

  async deleteUserAiKey(id) {
    const res = await fetch(`${API_URL}/users/${id}/ai-key`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data;
  },

  async setUserAiEnabled(id, enabled) {
    const res = await fetch(`${API_URL}/users/${id}/ai-key/enabled`, {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify({ enabled }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data;
  },

  async getSyncStatus(orgId, integrationId) {
    const url = integrationId
      ? `${API_URL}/sync/admin/status/${orgId}?integration_id=${encodeURIComponent(integrationId)}`
      : `${API_URL}/sync/admin/status/${orgId}`;
    const res = await fetch(url, {
      headers: getHeaders(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data;
  },

  async stopSync(orgId, integrationId) {
    const res = await fetch(`${API_URL}/sync/admin/stop/${orgId}`, {
      method: 'POST',
      headers: getHeaders(),
      body: integrationId ? JSON.stringify({ integration_id: integrationId }) : undefined,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data;
  },

  async getSyncDateRange() {
    const res = await fetch(`${API_URL}/settings/sync-date-range`, {
      headers: getHeaders(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data;
  },

  async saveSyncDateRange(syncStartDate, syncEndDate, syncMode) {
    const res = await fetch(`${API_URL}/settings/sync-date-range`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({ sync_start_date: syncStartDate, sync_end_date: syncEndDate, sync_mode: syncMode || 'current' }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data;
  },

  async getAiInsightsSettings() {
    const res = await fetch(`${API_URL}/settings/ai-insights`, {
      headers: getHeaders(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data;
  },

  async saveAiInsightsSettings({ mode, weekday, monthDay }) {
    const res = await fetch(`${API_URL}/settings/ai-insights`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({ mode, weekday, month_day: monthDay }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data;
  },

  async getIplicitSyncDateRange() {
    const res = await fetch(`${API_URL}/settings/iplicit-sync-date-range`, {
      headers: getHeaders(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data;
  },

  async saveIplicitSyncDateRange(startDate, endDate) {
    const res = await fetch(`${API_URL}/settings/iplicit-sync-date-range`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({ iplicit_start_date: startDate, iplicit_end_date: endDate }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data;
  },

  async getXeroSyncDateRange() {
    const res = await fetch(`${API_URL}/settings/xero-sync-date-range`, {
      headers: getHeaders(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data;
  },

  async saveXeroSyncDateRange(startDate, endDate) {
    const res = await fetch(`${API_URL}/settings/xero-sync-date-range`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({ xero_start_date: startDate, xero_end_date: endDate }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data;
  },

  async getQuickBooksSyncDateRange() {
    const res = await fetch(`${API_URL}/settings/quickbooks-sync-date-range`, {
      headers: getHeaders(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data;
  },

  async saveQuickBooksSyncDateRange(startDate, endDate) {
    const res = await fetch(`${API_URL}/settings/quickbooks-sync-date-range`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({ quickbooks_start_date: startDate, quickbooks_end_date: endDate }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data;
  },

  // AI Suggested Pricing — global default settings
  async getAIPricingSettings() {
    const res = await fetch(`${API_URL}/settings/ai-pricing`, {
      headers: getHeaders(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data;
  },

  async saveAIPricingSettings(patch) {
    const res = await fetch(`${API_URL}/settings/ai-pricing`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data;
  },

  // Chatbot Version Control
  async getChatbotVersion() {
    const res = await fetch(`${API_URL}/settings/chatbot-version`, {
      headers: getHeaders(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data;
  },

  async saveChatbotVersion(patch) {
    const res = await fetch(`${API_URL}/settings/chatbot-version`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data;
  },

  async triggerIplicitSync(orgId, force = false) {
    const url = force
      ? `${API_URL}/iplicit-sync/admin/trigger/${orgId}?force=true`
      : `${API_URL}/iplicit-sync/admin/trigger/${orgId}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: getHeaders(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data;
  },

  // AI Token Usage — per-user usage of the chatbot and AI summaries
  async getAIUsage(range = '30d', orgId = null, includeDeleted = false) {
    const params = new URLSearchParams();
    if (range) params.set('range', range);
    if (orgId) params.set('org_id', orgId);
    if (includeDeleted) params.set('include_deleted', '1');
    const qs = params.toString();
    const res = await fetch(`${API_URL}/ai-usage${qs ? `?${qs}` : ''}`, {
      headers: getHeaders(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data;
  },

  async claimAIUsageOrphans(organizationId, userId, overrideEmail = null) {
    const body = { organization_id: organizationId, user_id: userId };
    if (overrideEmail) body.override_email = overrideEmail;
    const res = await fetch(`${API_URL}/ai-usage/orphans/claim`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data;
  },

  async getAIUsageForUser(userId, range = '30d', orgId = null) {
    const params = new URLSearchParams();
    if (range) params.set('range', range);
    if (orgId) params.set('org_id', orgId);
    const qs = params.toString();
    const res = await fetch(`${API_URL}/ai-usage/${userId}${qs ? `?${qs}` : ''}`, {
      headers: getHeaders(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data;
  },

  // Module Access — default + per-organization module enable/disable
  async getModules() {
    const res = await fetch(`${API_URL}/module-access/modules`, {
      headers: getHeaders(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data;
  },

  async getModuleAccess(organizationId = null) {
    const qs = organizationId ? `?organization_id=${encodeURIComponent(organizationId)}` : '';
    const res = await fetch(`${API_URL}/module-access${qs}`, {
      headers: getHeaders(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data;
  },

  async saveModuleAccess(organizationId, modules) {
    const res = await fetch(`${API_URL}/module-access`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({ organization_id: organizationId || null, modules }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data;
  },

  async triggerSync(orgId, force = false, { start_date, end_date, entities, integration_id } = {}) {
    const url = force
      ? `${API_URL}/sync/admin/trigger/${orgId}?force=true`
      : `${API_URL}/sync/admin/trigger/${orgId}`;
    const body = {};
    if (start_date && end_date) {
      body.start_date = start_date;
      body.end_date = end_date;
    }
    if (entities && entities.length > 0) {
      body.entities = entities;
    }
    if (integration_id) {
      body.integration_id = integration_id;
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: getHeaders(),
      body: Object.keys(body).length > 0 ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data;
  },
};
