/**
 * Sync Job Service
 * Manages background sync operations via Node.js backend API
 * The Node backend handles job creation, queuing, and processing internally
 */

import { supabase } from '@/integrations/supabase/client';

// SYNC_BACKEND_URL should be dynamic based on environment (local/dev/prod)
// - localhost/127.*: point to local Node backend at http://localhost:4000
// - LAN IPs (192.168.*, 10.*): use relative URL '' so requests go through Vite dev proxy (avoids CORS)
// - Production: point directly to production API
let SYNC_BACKEND_URL = 'http://localhost:4000';
if (typeof window !== 'undefined' && window?.location?.hostname) {
  const hostname = window.location.hostname;
  const isLocal = hostname === 'localhost' || hostname.startsWith('127.');
  const isLAN = hostname.startsWith('192.168.') || hostname.startsWith('10.');
  SYNC_BACKEND_URL =
    import.meta.env.VITE_SYNC_BACKEND_URL ||
    (isLocal
      ? 'http://localhost:4000'
      : isLAN
        ? ''  // Use Vite dev proxy to avoid CORS issues on LAN
        : 'https://dent-enterprise-api.dentpulse.com');
} else if (typeof process !== 'undefined' && process.env?.SYNC_BACKEND_URL) {
  SYNC_BACKEND_URL = process.env.SYNC_BACKEND_URL;
}

export interface SyncJob {
  id: string;
  organization_id: string;
  integration_id: string;
  job_type: 'full_sync' | 'entity_sync' | 'scheduled_sync';
  entity_alias: string | null;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress_percentage: number;
  current_page: number;
  total_pages: number | null;
  records_processed: number;
  records_failed: number;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  retry_count: number;
  max_retries: number;
  start_date: string | null;
  end_date: string | null;
  user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateSyncJobParams {
  organizationId: string;
  integrationId: string;
  jobType: 'full_sync' | 'entity_sync' | 'scheduled_sync';
  entityAlias?: string;
  startDate?: string | null;
  endDate?: string | null;
  userId?: string | null;
  startPage?: number;
}

/**
 * Get auth headers for Node backend API calls.
 * Forces a token refresh so the backend never receives an expired access_token.
 */
async function getAuthHeaders(): Promise<Record<string, string>> {
  // refreshSession() fetches a fresh access_token from Supabase using the
  // stored refresh_token, guaranteeing the token is valid right now.
  const { data: { session }, error } = await supabase.auth.refreshSession();
  if (error || !session) {
    // Fallback: try the cached session (handles cases where refresh isn't needed)
    const { data: { session: cachedSession } } = await supabase.auth.getSession();
    if (!cachedSession) {
      throw new Error('No active session');
    }
    return {
      'Authorization': `Bearer ${cachedSession.access_token}`,
      'Content-Type': 'application/json',
    };
  }
  return {
    'Authorization': `Bearer ${session.access_token}`,
    'Content-Type': 'application/json',
  };
}

/** Entity aliases that belong to the Iplicit sync pipeline (not Dentally). */
export const IPLICIT_ENTITY_ALIASES = new Set([
  'iplicit_legal_entities',
  'coa_account_groups',
  'iplicit_chart_of_accounts',
  'iplicit_balance_sheet',
  'iplicit_profit_loss',
  'iplicit_suppliers',
  'iplicit_products',
  'iplicit_sales_invoices',
  'iplicit_sales_receipts',
  'iplicit_receipt_allocations',
  'iplicit_purchase_invoices',
  'iplicit_purchase_invoice_payments',
  'iplicit_payment_allocations',
]);

/** Entity aliases that belong to the Xero sync pipeline. */
export const XERO_ENTITY_ALIASES = new Set([
  'xero_chart_of_accounts',
  'xero_tracking_categories',
  'xero_invoices',
  'xero_bank_transactions',
  'xero_credit_notes',
  'xero_overpayments',
  'xero_journals',
  'xero_profit_loss',
  'xero_balance_sheet',
]);

/** Entity aliases that belong to the QuickBooks sync pipeline. */
export const QUICKBOOKS_ENTITY_ALIASES = new Set([
  'quickbooks_chart_of_accounts',
  'quickbooks_vendors',
  'quickbooks_customers',
  'quickbooks_items',
  'quickbooks_invoices',
  'quickbooks_bills',
  'quickbooks_journal_entries',
  'quickbooks_purchases',
  'quickbooks_payments',
  'quickbooks_bill_payments',
  'quickbooks_credit_memos',
  'quickbooks_vendor_credits',
  'quickbooks_deposits',
  'quickbooks_transfers',
  'quickbooks_profit_loss',
]);

export const SyncJobService = {
  /**
   * Get sync job by ID (direct DB query for UI display)
   */
  async getSyncJob(jobId: string): Promise<SyncJob | null> {
    try {
      const { data, error } = await supabase
        .from('sync_jobs')
        .select('*')
        .eq('id', jobId)
        .single();

      if (error) {
        console.error('Failed to fetch sync job:', error);
        return null;
      }

      return data as SyncJob;
    } catch (error) {
      console.error('Error fetching sync job:', error);
      return null;
    }
  },

  /**
   * Get all active sync jobs for an organization (direct DB query for UI display)
   */
  async getActiveSyncJobs(organizationId: string): Promise<SyncJob[]> {
    try {
      const { data, error } = await supabase
        .from('sync_jobs')
        .select('*')
        .eq('organization_id', organizationId)
        .in('status', ['queued', 'running'])
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Failed to fetch active sync jobs:', error);
        return [];
      }

      return data as SyncJob[];
    } catch (error) {
      console.error('Error fetching active sync jobs:', error);
      return [];
    }
  },

  /**
   * Get all sync jobs for an organization (direct DB query for UI display)
   */
  async getSyncJobs(organizationId: string, limit: number = 50): Promise<SyncJob[]> {
    try {
      const { data, error } = await supabase
        .from('sync_jobs')
        .select('*')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('Failed to fetch sync jobs:', error);
        return [];
      }

      return data as SyncJob[];
    } catch (error) {
      console.error('Error fetching sync jobs:', error);
      return [];
    }
  },

  /**
   * Update sync job status (direct DB update for UI)
   */
  async updateSyncJobStatus(
    jobId: string,
    updates: {
      status?: SyncJob['status'];
      progress_percentage?: number;
      current_page?: number;
      total_pages?: number;
      records_processed?: number;
      records_failed?: number;
      error_message?: string | null;
      started_at?: string;
      completed_at?: string;
    }
  ): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('sync_jobs')
        .update(updates)
        .eq('id', jobId);

      if (error) {
        console.error('Failed to update sync job:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error updating sync job:', error);
      return false;
    }
  },

  /**
   * Cancel a single sync job via Node backend
   */
  async cancelSyncJob(jobId: string): Promise<boolean> {
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`${SYNC_BACKEND_URL}/api/sync/cancel/${jobId}`, {
        method: 'POST',
        headers,
      });

      if (!response.ok) {
        console.error('Failed to cancel sync job:', response.statusText);
        return false;
      }

      const result = await response.json();
      return result.success;
    } catch (error) {
      console.error('Error cancelling sync job:', error);
      // Fallback: cancel directly in DB
      try {
        const { error: dbError } = await supabase
          .from('sync_jobs')
          .update({ status: 'cancelled', completed_at: new Date().toISOString() })
          .eq('id', jobId)
          .in('status', ['queued', 'running']);
        return !dbError;
      } catch {
        return false;
      }
    }
  },

  /**
   * Cancel all active sync jobs for an organization via Node backend
   */
  async cancelAllSyncJobs(organizationId: string): Promise<boolean> {
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`${SYNC_BACKEND_URL}/api/sync/cancel-all/${organizationId}`, {
        method: 'POST',
        headers,
      });

      if (!response.ok) {
        console.error('Failed to cancel all sync jobs:', response.statusText);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error cancelling all sync jobs:', error);
      return false;
    }
  },

  /**
   * Trigger sync for a specific entity via Node backend
   * The backend creates jobs and processes all pages internally
   */
  async syncEntity(
    organizationId: string,
    integrationId: string,
    entityAlias: string,
    startDate?: string | null,
    endDate?: string | null,
    userId?: string | null,
    startPage?: number,
    force?: boolean
  ): Promise<{ success: boolean; jobId?: string; error?: string }> {
    try {
      const headers = await getAuthHeaders();
      const body: Record<string, unknown> = { integration_id: integrationId };

      if (startDate) body.start_date = startDate;
      if (endDate) body.end_date = endDate;

      console.log(`[SyncJobService] Triggering sync for ${entityAlias} via Node backend...`);

      const url = `${SYNC_BACKEND_URL}/api/sync/trigger/${organizationId}/${entityAlias}${force ? '?force=true' : ''}`;
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: response.statusText }));
        console.error(`[SyncJobService] Failed to trigger sync for ${entityAlias}:`, errorData);
        return { success: false, error: errorData.error || response.statusText };
      }

      const result = await response.json();
      console.log(`[SyncJobService] Sync triggered for ${entityAlias}:`, result);

      return {
        success: true,
        jobId: result.jobs?.[0]?.id,
      };
    } catch (error) {
      console.error('Error in syncEntity:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },

  /**
   * Trigger sync for a single Iplicit entity via the Iplicit Node backend route.
   * Must be used instead of syncEntity() for any alias in IPLICIT_ENTITY_ALIASES.
   */
  async syncIplicitEntity(
    organizationId: string,
    entityAlias: string,
  ): Promise<{ success: boolean; jobId?: string; error?: string }> {
    try {
      const headers = await getAuthHeaders();

      console.log(`[SyncJobService] Triggering Iplicit sync for ${entityAlias}...`);

      const response = await fetch(
        `${SYNC_BACKEND_URL}/api/iplicit-sync/trigger/${organizationId}/${entityAlias}`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({}),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: response.statusText }));
        console.error(`[SyncJobService] Iplicit sync trigger failed for ${entityAlias}:`, errorData);
        return { success: false, error: errorData.error || response.statusText };
      }

      const result = await response.json();
      console.log(`[SyncJobService] Iplicit sync triggered for ${entityAlias}:`, result);

      return {
        success: true,
        jobId: result.jobs?.[0]?.id,
      };
    } catch (error) {
      console.error('Error in syncIplicitEntity:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },

  /**
   * Trigger sync for a single Xero entity via the Xero Node backend route.
   * Must be used instead of syncEntity() for any alias in XERO_ENTITY_ALIASES.
   */
  async syncXeroEntity(
    organizationId: string,
    entityAlias: string,
    connectionId?: string,
  ): Promise<{ success: boolean; jobId?: string; error?: string }> {
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `${SYNC_BACKEND_URL}/api/xero-sync/trigger/${organizationId}/${entityAlias}`,
        { method: 'POST', headers, body: JSON.stringify(connectionId ? { connectionId } : {}) }
      );
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: response.statusText }));
        return { success: false, error: errorData.error || response.statusText };
      }
      const result = await response.json();
      return { success: true, jobId: result.jobs?.[0]?.id };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  },

  /**
   * Trigger a full Xero sync (all entities) via the Node backend.
   * If connectionId is given, scope to that single Xero integration.
   */
  async triggerXeroFullSync(
    organizationId: string,
    connectionId?: string,
  ): Promise<{ success: boolean; jobCount: number; jobIds: string[]; error?: string }> {
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `${SYNC_BACKEND_URL}/api/xero-sync/trigger/${organizationId}`,
        { method: 'POST', headers, body: JSON.stringify(connectionId ? { connectionId } : {}) }
      );
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: response.statusText }));
        return { success: false, jobCount: 0, jobIds: [], error: errorData.error || response.statusText };
      }
      const result = await response.json();
      return {
        success: true,
        jobCount: result.jobCount ?? 0,
        jobIds: (result.jobs || []).map((j: { id: string }) => j.id),
      };
    } catch (error) {
      return {
        success: false,
        jobCount: 0,
        jobIds: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },

  /**
   * Trigger sync for a single QuickBooks entity via the QuickBooks Node
   * backend route. Must be used instead of syncEntity() for any alias in
   * QUICKBOOKS_ENTITY_ALIASES.
   */
  async syncQuickBooksEntity(
    organizationId: string,
    entityAlias: string,
    connectionId?: string,
  ): Promise<{ success: boolean; jobId?: string; error?: string }> {
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `${SYNC_BACKEND_URL}/api/quickbooks-sync/trigger/${organizationId}/${entityAlias}`,
        { method: 'POST', headers, body: JSON.stringify(connectionId ? { connectionId } : {}) }
      );
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: response.statusText }));
        return { success: false, error: errorData.error || response.statusText };
      }
      const result = await response.json();
      return { success: true, jobId: result.jobs?.[0]?.id };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  },

  /**
   * Trigger a full QuickBooks sync (all entities) via the Node backend.
   * If connectionId is given, scope to that single QuickBooks integration.
   */
  async triggerQuickBooksFullSync(
    organizationId: string,
    connectionId?: string,
  ): Promise<{ success: boolean; jobCount: number; jobIds: string[]; error?: string }> {
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `${SYNC_BACKEND_URL}/api/quickbooks-sync/trigger/${organizationId}`,
        { method: 'POST', headers, body: JSON.stringify(connectionId ? { connectionId } : {}) }
      );
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: response.statusText }));
        return { success: false, jobCount: 0, jobIds: [], error: errorData.error || response.statusText };
      }
      const result = await response.json();
      return {
        success: true,
        jobCount: result.jobCount ?? 0,
        jobIds: (result.jobs || []).map((j: { id: string }) => j.id),
      };
    } catch (error) {
      return {
        success: false,
        jobCount: 0,
        jobIds: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },

  /**
   * Trigger sync for all enabled entities via Node backend
   * Single API call — the backend creates all jobs and processes them sequentially
   */
  async syncAll(
    organizationId: string,
    integrationId: string,
    enabledEntities: string[],
    startDate?: string | null,
    endDate?: string | null,
    userId?: string | null
  ): Promise<{ success: boolean; jobIds: string[]; errors: string[] }> {
    try {
      const headers = await getAuthHeaders();
      const body: Record<string, unknown> = { integration_id: integrationId };

      if (startDate) body.start_date = startDate;
      if (endDate) body.end_date = endDate;
      if (enabledEntities && enabledEntities.length > 0) {
        body.entities = enabledEntities;
      }

      const url = `${SYNC_BACKEND_URL}/api/sync/trigger/${organizationId}`;
      console.log(`[SyncJobService] Triggering full sync for ${enabledEntities.length} entities via Node backend...`);
      console.log(`[SyncJobService] POST ${url}`, JSON.stringify(body));

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const responseText = await response.text();
        let errorData: any;
        try {
          errorData = JSON.parse(responseText);
        } catch {
          errorData = { error: response.statusText, details: responseText };
        }
        console.error(`[SyncJobService] Failed to trigger full sync (${response.status}):`, errorData);
        return {
          success: false,
          jobIds: [],
          errors: [errorData.error || errorData.message || `${response.status}: ${response.statusText}`],
        };
      }

      const result = await response.json();
      const jobIds = (result.jobs || []).map((j: { id: string }) => j.id);

      console.log(`[SyncJobService] Full sync triggered: ${result.jobCount} jobs created, ${result.skipped} skipped`);

      return {
        success: true,
        jobIds,
        errors: [],
      };
    } catch (error) {
      console.error('Error in syncAll:', error);
      return {
        success: false,
        jobIds: [],
        errors: [error instanceof Error ? error.message : 'Unknown error'],
      };
    }
  },

  /**
   * Force a full re-sync for all entities via Node backend.
   * Passes ?force=true which:
   * - Deletes all completed/cancelled/failed jobs (clean slate)
   * - Resets last_synced_at on all entities
   * - Ignores existing completed jobs and re-syncs everything from default date range
   */
  async forceFullSync(
    organizationId: string,
    integrationId?: string,
  ): Promise<{ success: boolean; jobIds: string[]; errors: string[] }> {
    try {
      const headers = await getAuthHeaders();

      console.log(`[SyncJobService] Force full sync for org ${organizationId}...`);

      const body: Record<string, unknown> = {};
      if (integrationId) body.integration_id = integrationId;

      const response = await fetch(`${SYNC_BACKEND_URL}/api/sync/trigger/${organizationId}?force=true`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: response.statusText }));
        console.error('[SyncJobService] Failed to trigger force sync:', errorData);
        return {
          success: false,
          jobIds: [],
          errors: [errorData.error || response.statusText],
        };
      }

      const result = await response.json();
      const jobIds = (result.jobs || []).map((j: { id: string }) => j.id);

      console.log(`[SyncJobService] Force sync triggered: ${result.jobCount} jobs created`);

      return {
        success: true,
        jobIds,
        errors: [],
      };
    } catch (error) {
      console.error('Error in forceFullSync:', error);
      return {
        success: false,
        jobIds: [],
        errors: [error instanceof Error ? error.message : 'Unknown error'],
      };
    }
  },

  /**
   * Trigger the same last-updated incremental Dentally sync as the nightly
   * 00:00 UK auto-sync (lookback window + updated_after filters). Does not
   * reset last_synced_at or cancel in-flight jobs.
   */
  async progressiveSync(
    organizationId: string,
    integrationId?: string,
  ): Promise<{
    success: boolean;
    jobIds: string[];
    errors: string[];
    windowStart?: string;
    windowEnd?: string;
    lookbackDays?: number;
  }> {
    try {
      const headers = await getAuthHeaders();
      const body: Record<string, unknown> = {};
      if (integrationId) body.integration_id = integrationId;

      const response = await fetch(`${SYNC_BACKEND_URL}/api/sync/progressive/${organizationId}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: response.statusText }));
        console.error('[SyncJobService] Failed to trigger progressive sync:', errorData);
        return {
          success: false,
          jobIds: [],
          errors: [errorData.error || response.statusText],
        };
      }

      const result = await response.json();
      const jobIds = (result.jobs || []).map((j: { id: string }) => j.id);

      console.log(
        `[SyncJobService] Progressive sync triggered: ${result.jobCount} jobs (window ${result.windowStart} → ${result.windowEnd})`
      );

      return {
        success: true,
        jobIds,
        errors: [],
        windowStart: result.windowStart,
        windowEnd: result.windowEnd,
        lookbackDays: result.lookbackDays,
      };
    } catch (error) {
      console.error('Error in progressiveSync:', error);
      return {
        success: false,
        jobIds: [],
        errors: [error instanceof Error ? error.message : 'Unknown error'],
      };
    }
  },

  /**
   * Create and trigger sync jobs during onboarding via Node backend
   * The backend creates jobs with monthly chunking and starts processing automatically
   */
  async createSyncJobsOnly(
    organizationId: string,
    integrationId: string,
    enabledEntities: string[],
    startDate?: string | null,
    endDate?: string | null,
    userId?: string | null
  ): Promise<{ success: boolean; jobIds: string[]; errors: string[] }> {
    try {
      const headers = await getAuthHeaders();
      const body: Record<string, unknown> = {};

      if (startDate) body.start_date = startDate;
      if (endDate) body.end_date = endDate;
      if (enabledEntities && enabledEntities.length > 0) {
        body.entities = enabledEntities;
      }

      const url = `${SYNC_BACKEND_URL}/api/sync/trigger/${organizationId}`;
      console.log(`[SyncJobService] Creating sync jobs for ${enabledEntities.length} entities via Node backend...`);
      console.log(`[SyncJobService] POST ${url}`, JSON.stringify(body));

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const responseText = await response.text();
        let errorData: any;
        try {
          errorData = JSON.parse(responseText);
        } catch {
          errorData = { error: response.statusText, details: responseText };
        }
        console.error(`[SyncJobService] Failed to create sync jobs (${response.status}):`, errorData);
        return {
          success: false,
          jobIds: [],
          errors: [errorData.error || errorData.message || `${response.status}: ${response.statusText}`],
        };
      }

      const result = await response.json();
      const jobIds = (result.jobs || []).map((j: { id: string }) => j.id);

      console.log(`[SyncJobService] Sync jobs created: ${result.jobCount} jobs, ${result.skipped} skipped`);

      return {
        success: true,
        jobIds,
        errors: [],
      };
    } catch (error) {
      console.error('Error in createSyncJobsOnly:', error);
      return {
        success: false,
        jobIds: [],
        errors: [error instanceof Error ? error.message : 'Unknown error'],
      };
    }
  },

  /**
   * Resume processing existing queued jobs via Node backend
   * The backend re-enqueues queued jobs in its in-memory queue
   */
  async triggerQueuedJobs(organizationId: string): Promise<{ success: boolean; triggered: number; errors: string[] }> {
    try {
      const headers = await getAuthHeaders();

      const url = `${SYNC_BACKEND_URL}/api/sync/resume/${organizationId}`;
      console.log('[SyncJobService] Resuming queued jobs via Node backend for org:', organizationId);
      console.log(`[SyncJobService] POST ${url}`);

      const response = await fetch(url, {
        method: 'POST',
        headers,
      });

      if (!response.ok) {
        const responseText = await response.text();
        let errorData: any;
        try {
          errorData = JSON.parse(responseText);
        } catch {
          errorData = { error: response.statusText, details: responseText };
        }
        console.warn(`[SyncJobService] Failed to resume jobs (${response.status}):`, errorData);
        return {
          success: false,
          triggered: 0,
          errors: [errorData.error || errorData.message || `${response.status}: ${response.statusText}`],
        };
      }

      const result = await response.json();

      if (result.resumed > 0) {
        console.log(`[SyncJobService] Resumed ${result.resumed} queued jobs`);
      }

      return {
        success: true,
        triggered: result.resumed || 0,
        errors: [],
      };
    } catch (error) {
      console.error('Error in triggerQueuedJobs:', error);
      return {
        success: false,
        triggered: 0,
        errors: [error instanceof Error ? error.message : 'Unknown error'],
      };
    }
  },

  /**
   * Trigger a full Iplicit sync via Node backend.
   * Passes ?force=true to reset completed jobs and re-sync everything.
   */
  async triggerIplicitSync(
    organizationId: string,
    connectionId?: string,
  ): Promise<{ success: boolean; jobCount: number; skipped: number; error?: string }> {
    try {
      const headers = await getAuthHeaders();

      console.log(`[SyncJobService] Triggering Iplicit sync for org ${organizationId}, connection ${connectionId || 'auto'}...`);

      const response = await fetch(`${SYNC_BACKEND_URL}/api/iplicit-sync/trigger/${organizationId}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ connectionId }),
      });

      const data = await response.json().catch(() => ({ error: response.statusText }));

      if (!response.ok) {
        console.error('[SyncJobService] Failed to trigger Iplicit sync:', data);
        return { success: false, jobCount: 0, skipped: 0, error: data.error || response.statusText };
      }

      console.log(`[SyncJobService] Iplicit sync triggered: ${data.jobCount} jobs, ${data.skipped} skipped`);
      return { success: true, jobCount: data.jobCount ?? 0, skipped: data.skipped ?? 0 };
    } catch (error) {
      console.error('[SyncJobService] Iplicit sync error:', error);
      return {
        success: false,
        jobCount: 0,
        skipped: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },

  /**
   * Get sync status from Node backend (includes queue stats)
   */
  async getSyncStatus(organizationId: string): Promise<{
    jobs: SyncJob[];
    queueStats: { queued: number; active: number };
    isSyncing: boolean;
  } | null> {
    try {
      const headers = await getAuthHeaders();

      const response = await fetch(`${SYNC_BACKEND_URL}/api/sync/status/${organizationId}`, {
        method: 'GET',
        headers,
      });

      if (!response.ok) {
        console.error('Failed to get sync status:', response.statusText);
        return null;
      }

      return await response.json();
    } catch (error) {
      console.error('Error getting sync status:', error);
      return null;
    }
  },
};
