import { useState, useEffect, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { INTEGRATION_LOGOS } from '@/lib/integrationLogos';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useAccountingConnections } from '@/hooks/useAccountingConnections';
import { useLocations } from '@/hooks/useLocations';
import { useXeroTrackingCatalog } from '@/hooks/useXeroTrackingCatalog';
import { supabase } from '@/integrations/supabase/client';
import { PlatformIntegrationOrganization } from '@/services/integrations/xeroService';
import { SyncJobService } from '@/services/integrations/syncJobService';
import { Plus, Check, X, RefreshCw, Trash2, Building2, Link2, AlertCircle, Layers, Loader2, Key, Globe, User, Pencil, Settings2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Sentinel Select value: location is intentionally not mapped to any platform org. */
const UNMAPPED_ORG_VALUE = '__none__';

const isMappedOrgId = (orgId: string | undefined | null): boolean =>
  !!orgId && orgId !== UNMAPPED_ORG_VALUE;

// Helper function to get fresh access token with refresh capability
async function getFreshAccessToken(): Promise<string | null> {
  try {
    console.log('[Auth] Getting fresh access token...');

    // First try to get the current session
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

    console.log('[Auth] Current session:', {
      hasSession: !!sessionData?.session,
      hasToken: !!sessionData?.session?.access_token,
      expiresAt: sessionData?.session?.expires_at,
      error: sessionError?.message
    });

    if (sessionData?.session?.access_token) {
      // Check if token is still valid (not expired)
      const expiresAt = sessionData.session.expires_at;
      const now = Math.floor(Date.now() / 1000);
      const timeUntilExpiry = expiresAt ? expiresAt - now : 0;

      console.log('[Auth] Token expires in:', timeUntilExpiry, 'seconds');

      // If token expires in more than 60 seconds, use it
      if (expiresAt && expiresAt > now + 60) {
        console.log('[Auth] Using existing token (still valid)');
        return sessionData.session.access_token;
      }
    }

    // Token is expired or about to expire, try to refresh
    console.log('[Auth] Access token expired or about to expire, refreshing...');
    const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();

    console.log('[Auth] Refresh result:', {
      hasSession: !!refreshData?.session,
      hasToken: !!refreshData?.session?.access_token,
      error: refreshError?.message
    });

    if (refreshError) {
      console.error('[Auth] Failed to refresh session:', refreshError);
      return null;
    }

    if (refreshData?.session?.access_token) {
      console.log('[Auth] Session refreshed successfully');
      return refreshData.session.access_token;
    }

    console.log('[Auth] No access token available after refresh');
    return null;
  } catch (error) {
    console.error('[Auth] Error getting fresh access token:', error);
    return null;
  }
}

// Accounting platform configurations
const accountingPlatforms = {
  xero: {
    type: 'xero' as const,
    name: 'Xero',
    logo: INTEGRATION_LOGOS.xero,
    logoType: 'image' as const,
    color: 'bg-emerald-600',
    description: 'Cloud-based accounting software for small businesses',
    defaultFeatures: ['Chart of Accounts', 'Tracking categories', 'Invoices', 'Bank Transactions', 'Contacts', 'Payments', 'Reports'],
  },
  quickbooks: {
    type: 'quickbooks' as const,
    name: 'QuickBooks',
    logo: INTEGRATION_LOGOS.quickbooks,
    logoType: 'image' as const,
    color: 'bg-blue-600',
    description: 'Popular accounting software for businesses of all sizes',
    defaultFeatures: ['Chart of Accounts', 'Invoices', 'Expenses', 'Banking', 'Payroll', 'Reports'],
  },
  iplicit: {
    type: 'iplicit' as const,
    name: 'iplicit',
    logo: INTEGRATION_LOGOS.iplicit,
    logoType: 'image' as const,
    color: 'bg-slate-800',
    description: 'Cloud-based financial management and accounting software',
    defaultFeatures: ['General Ledger', 'Invoices', 'Bank Reconciliation', 'Reports', 'Purchase Orders', 'Fixed Assets'],
  },
  sage: {
    type: 'sage' as const,
    name: 'Sage',
    logo: 'Sage',
    logoType: 'text' as const,
    color: 'bg-green-700',
    description: 'Sage Business Cloud Accounting (UK) — OAuth integration',
    defaultFeatures: ['Chart of Accounts', 'Invoices', 'Suppliers', 'Bank Reconciliation', 'Reports'],
  },
};

// Helper component to render platform logo
const PlatformLogo = ({ platform, className = "" }: { platform: typeof accountingPlatforms[keyof typeof accountingPlatforms]; className?: string }) => {
  if (platform.logoType === 'image') {
    return (
      <img 
        src={platform.logo} 
        alt={`${platform.name} logo`}
        className={className || "w-full h-full object-contain"}
      />
    );
  }
  return <span className={className}>{platform.logo}</span>;
};

interface AccountingIntegrationsHubProps {
  organizationId?: string;
}

export function AccountingIntegrationsHub({ organizationId }: AccountingIntegrationsHubProps) {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const [currentOrgId, setCurrentOrgId] = useState<string | undefined>(organizationId);
  const [isOrgIdLoading, setIsOrgIdLoading] = useState(!organizationId);

  // Fetch org ID from profile if not provided
  useEffect(() => {
    async function fetchOrgId() {
      if (organizationId) {
        setCurrentOrgId(organizationId);
        setIsOrgIdLoading(false);
        return;
      }

      if (session?.user?.id) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('current_organization_id')
          .eq('user_id', session.user.id)
          .single();

        if (profile?.current_organization_id) {
          setCurrentOrgId(profile.current_organization_id);
        }
      }
      setIsOrgIdLoading(false);
    }
    fetchOrgId();
  }, [organizationId, session?.user?.id]);

  const {
    connections,
    isLoading,
    refetch,
    updateConnection,
    deleteConnection,
    saveIplicitCredentials,
    connectToIplicit,
    disconnectIplicit,
    syncConnection,
  } = useAccountingConnections(currentOrgId);

  // Fetch locations for mapping
  const { locations, isLoading: isLoadingLocations, refetch: refetchLocations } = useLocations();

  // Platform integrations state
  const [xeroIntegrations, setXeroIntegrations] = useState<any[]>([]);
  // QuickBooks now supports multiple connections (mirrors xeroIntegrations).
  // Each connection is its own platform_integrations row with its OWN
  // client_id/client_secret. `quickbooksIntegration` is the derived "primary"
  // (most-recent) so existing single-reference logic keeps working while the
  // render iterates the array for the multi-connection list.
  const [quickbooksIntegrations, setQuickbooksIntegrations] = useState<any[]>([]);
  const quickbooksIntegration = quickbooksIntegrations[0] || null;
  const [isLoadingIntegrations, setIsLoadingIntegrations] = useState(false);
  // Tracks which OAuth is currently in flight: the integration id being reconnected,
  // 'new-xero' / 'new-quickbooks' for fresh connects, or null when idle. Per-id
  // tracking is necessary so only the clicked Reconnect button shows the spinner
  // — a shared boolean would visually flag every row as connecting.
  const [oauthInProgress, setOauthInProgress] = useState<string | null>(null);
  const isInitiatingOAuth = oauthInProgress !== null;
  const [isDisconnecting, setIsDisconnecting] = useState<string | null>(null);
  const [xeroOrgCount, setXeroOrgCount] = useState<number>(0);
  const [quickbooksOrgCount, setQuickbooksOrgCount] = useState<number>(0);
  const [platformOrganizations, setPlatformOrganizations] = useState<PlatformIntegrationOrganization[]>([]);
  const [isLoadingPlatformOrgs, setIsLoadingPlatformOrgs] = useState(false);
  const [mappingData, setMappingData] = useState<Record<string, string>>({}); // org.id (DB UUID) -> location_id
  const [locationOrganizationMap, setLocationOrganizationMap] = useState<Record<string, string>>({}); // location_id -> org.id (DB UUID)
  /** location_id → Xero tracking category/option selection (Xero mappings only) */
  const [locationTrackingMap, setLocationTrackingMap] = useState<
    Record<string, { categoryId: string; optionId: string; categoryName: string; optionName: string }>
  >({});
  const [isSavingMapping, setIsSavingMapping] = useState(false);
  const [selectedPlatform, setSelectedPlatform] = useState<'xero' | 'quickbooks' | 'iplicit'>('xero');
  const hasFetchedRef = useRef<Record<string, boolean>>({}); // Track if we've fetched for each org (mapping section)
  const [isMappingSectionOpen, setIsMappingSectionOpen] = useState(true); // Control mapping section visibility
  const [isMappingDialogOpen, setIsMappingDialogOpen] = useState(false); // Unified mapping dialog
  // Confirm dialog for Xero disconnect. Each organisation renders as its own
  // row, but they share ONE Xero login/token — disconnecting one disconnects
  // them all, so the user must see the full list before confirming.
  const [xeroDisconnectTarget, setXeroDisconnectTarget] = useState<{ connectionId: string; orgNames: string[] } | null>(null);
  // Per-organisation removal: deactivates ONE tenant of a Xero connection while
  // the shared login/token and the other organisations keep syncing.
  const [xeroRemoveTarget, setXeroRemoveTarget] = useState<PlatformIntegrationOrganization | null>(null);
  const [isRemovingTenant, setIsRemovingTenant] = useState(false);

  // ── Sage integration (Phase 1 — OAuth only) ─────────────────────────────────
  // Self-contained state; uses backend at VITE_BACKEND_URL (default localhost:4000).
  const SAGE_BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';

  // Build Authorization + Content-Type headers for backend Sage calls.
  // Backend's syncAuthMiddleware verifies the Bearer JWT against Supabase.
  const getSageAuthHeaders = async (): Promise<Record<string, string>> => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('No active session — please log in again');
    return {
      'Authorization': `Bearer ${session.access_token}`,
      'Content-Type':  'application/json',
    };
  };

  const [sageStatus, setSageStatus] = useState<{ connected: boolean; integration: any } | null>(null);
  // Multi-connection (Xero/QB parity): every separate Sage login is its own row.
  const [sageIntegrations, setSageIntegrations] = useState<any[]>([]);
  const [isSageConnecting, setIsSageConnecting] = useState(false);
  const [sageCardHighlight, setSageCardHighlight] = useState(false);
  const sageCardRef = useRef<HTMLDivElement | null>(null);

  // ── Sage sync state (Phase B) ───────────────────────────────────────────────
  // Per-connection action state: holds the integration id being acted on (or
  // '__all__' for a legacy org-wide action), null when idle.
  const [sageSyncingId, setSageSyncingId] = useState<string | null>(null);
  const [sageDisconnectingId, setSageDisconnectingId] = useState<string | null>(null);
  const [sageSyncLabel, setSageSyncLabel] = useState<string>('');
  const [lastSageSyncAt, setLastSageSyncAt] = useState<string | null>(null);
  const [lastSageSyncResult, setLastSageSyncResult] = useState<{ suppliers: number; coa: number; invoices: number; lines: number; contactPersons?: number; bankAccounts?: number; bankTransactions?: number; taxRates?: number; creditNotes?: number; creditNoteLines?: number; journals?: number; journalLines?: number; paymentMethods?: number; products?: number; otherPayments?: number; otherReceipts?: number; bankTransfers?: number; attachments?: number; canonicalAccounts?: number; canonicalJournals?: number; canonicalLines?: number } | null>(null);

  // Restore last-sync info from localStorage (so timestamp survives page reload)
  useEffect(() => {
    if (!currentOrgId) return;
    const stored = localStorage.getItem(`sage-last-sync-${currentOrgId}`);
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored);
      if (parsed?.at) setLastSageSyncAt(parsed.at);
      if (parsed?.result) setLastSageSyncResult(parsed.result);
    } catch { /* ignore corrupted entry */ }
  }, [currentOrgId]);

  const fetchSageStatus = useCallback(async () => {
    if (!currentOrgId) return;
    try {
      const headers = await getSageAuthHeaders();
      const res = await fetch(`${SAGE_BACKEND_URL}/api/sage/status?org_id=${currentOrgId}`, { headers });
      if (!res.ok) { setSageStatus(null); return; }
      setSageStatus(await res.json());
    } catch {
      setSageStatus(null);
    }
  }, [currentOrgId, SAGE_BACKEND_URL]);

  useEffect(() => { fetchSageStatus(); }, [fetchSageStatus]);

  // Multi-connection: load every Sage connection row for this org (Xero/QB parity).
  const fetchSageIntegrations = useCallback(async () => {
    if (!currentOrgId) { setSageIntegrations([]); return; }
    const { data } = await (supabase as any)
      .from('platform_integrations')
      .select('*')
      .eq('organization_id', currentOrgId)
      .eq('platform_name', 'sage')
      .order('created_at', { ascending: false });
    setSageIntegrations(data || []);
  }, [currentOrgId]);

  useEffect(() => { fetchSageIntegrations(); }, [fetchSageIntegrations]);

  // Handle Sage OAuth return — backend redirects here with ?sage_connected=true|false
  // after the user authorizes (or denies/errors). Show toast, refetch status, clean URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('sage_connected');
    const errMsg    = params.get('sage_error');
    if (!connected && !errMsg) return;

    if (connected === 'true') {
      toast.success('Sage connected successfully');
      fetchSageStatus();
      fetchSageIntegrations();
      // Scroll Sage card into view + brief highlight pulse — retry until ref attaches
      // (Settings tab activation + AccountingIntegrationsHub render may not be done yet).
      let attempts = 0;
      const tryScroll = () => {
        const el = sageCardRef.current;
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          // Nudge up a bit so the card top isn't flush with the viewport edge.
          setTimeout(() => window.scrollBy({ top: -80, behavior: 'smooth' }), 350);
          setSageCardHighlight(true);
          setTimeout(() => setSageCardHighlight(false), 2200);
          return;
        }
        if (++attempts < 20) setTimeout(tryScroll, 100); // up to 2s total
      };
      setTimeout(tryScroll, 100);
    } else if (connected === 'false' || errMsg) {
      toast.error(`Sage connection failed: ${errMsg || 'unknown error'}`);
    }

    // Strip ONLY the Sage OAuth return params (preserve ?tab=integrations etc.)
    params.delete('sage_connected');
    params.delete('sage_error');
    params.delete('integration_id');
    params.delete('token_expires_at');
    const cleanQs = params.toString();
    const cleanUrl = window.location.pathname + (cleanQs ? `?${cleanQs}` : '') + window.location.hash;
    window.history.replaceState({}, '', cleanUrl);
  }, [fetchSageStatus, fetchSageIntegrations]);

  const isSageConnected = sageIntegrations.some(s => s.is_connected) || Boolean(sageStatus?.connected);
  const hasSageIntegration = sageIntegrations.length > 0;

  // Connect a NEW Sage account (integrationId omitted) or RECONNECT an existing
  // one (integrationId passed → backend updates that row instead of inserting).
  const connectSage = useCallback((integrationId?: string) => {
    if (!currentOrgId) {
      toast.error('Organization not loaded yet');
      return;
    }
    // Show a loading state on the button while we redirect to Sage's OAuth page.
    setIsSageConnecting(true);
    setOauthInProgress(integrationId || 'new-sage');
    // Include tab=integrations so Settings.tsx auto-activates the Integrations tab on return
    const returnUrl = `${window.location.origin}${window.location.pathname}?tab=integrations`;
    const params = new URLSearchParams({
      org_id:      currentOrgId,
      redirect_to: returnUrl,
    });
    if (integrationId) params.set('integration_id', integrationId);
    window.location.href = `${SAGE_BACKEND_URL}/api/sage/connect?${params.toString()}`;
  }, [currentOrgId, SAGE_BACKEND_URL]);

  // ── Sage data sync (Phase B) — calls 3 dev endpoints sequentially ──────────
  const syncSageData = useCallback(async (integrationId?: string) => {
    if (!currentOrgId) return;
    setSageSyncingId(integrationId || '__all__');
    setSageSyncLabel('');

    // Scope the sync to one connection when an integrationId is given (each
    // ACTIVE CONNECTIONS row syncs only its own Sage account).
    const qs = integrationId ? `?integration_id=${integrationId}` : '';
    const callEndpoint = async (label: string, path: string) => {
      setSageSyncLabel(label);
      const headers = await getSageAuthHeaders();
      const res = await fetch(`${SAGE_BACKEND_URL}${path}${qs}`, { method: 'POST', headers });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.error) {
        throw new Error(body?.error || `${label} failed (${res.status})`);
      }
      return body;
    };

    try {
      const sup  = await callEndpoint('Syncing suppliers…',         `/api/sage/dev-sync/${currentOrgId}/suppliers`);
      const cp   = await callEndpoint('Enriching contacts…',        `/api/sage/dev-sync/${currentOrgId}/contact-persons`);
      const coa  = await callEndpoint('Syncing accounts…',          `/api/sage/dev-sync/${currentOrgId}/coa`);
      const tax  = await callEndpoint('Syncing tax rates…',         `/api/sage/dev-sync/${currentOrgId}/tax-rates`);
      const pm   = await callEndpoint('Syncing payment methods…',   `/api/sage/dev-sync/${currentOrgId}/payment-methods`);
      const prod = await callEndpoint('Syncing products/services…', `/api/sage/dev-sync/${currentOrgId}/products`);
      const inv  = await callEndpoint('Syncing invoices…',          `/api/sage/dev-sync/${currentOrgId}/invoices`);
      const cn   = await callEndpoint('Syncing credit notes…',      `/api/sage/dev-sync/${currentOrgId}/credit-notes`);
      const jnl  = await callEndpoint('Syncing journals…',          `/api/sage/dev-sync/${currentOrgId}/journals`);
      const ba   = await callEndpoint('Syncing bank accounts…',     `/api/sage/dev-sync/${currentOrgId}/bank-accounts`);
      const btxn = await callEndpoint('Syncing bank transactions…', `/api/sage/dev-sync/${currentOrgId}/bank-transactions`);
      const op   = await callEndpoint('Syncing other payments…',    `/api/sage/dev-sync/${currentOrgId}/other-payments`);
      const or   = await callEndpoint('Syncing other receipts…',    `/api/sage/dev-sync/${currentOrgId}/other-receipts`);
      const bt   = await callEndpoint('Syncing bank transfers…',    `/api/sage/dev-sync/${currentOrgId}/bank-transfers`);
      const att  = await callEndpoint('Syncing attachments…',       `/api/sage/dev-sync/${currentOrgId}/attachments`);
      const can  = await callEndpoint('Building canonical data…',   `/api/sage/dev-sync/${currentOrgId}/canonical`);

      const result = {
        suppliers:           sup.upserted               ?? 0,
        contactPersons:      cp.updated                 ?? 0,
        coa:                 coa.upserted               ?? 0,
        taxRates:            tax.upserted               ?? 0,
        paymentMethods:      pm.upserted                ?? 0,
        products:            prod.upserted              ?? 0,
        invoices:            inv.headers_upserted       ?? 0,
        lines:               inv.lines_inserted         ?? 0,
        creditNotes:         cn.headers_upserted        ?? 0,
        creditNoteLines:     cn.lines_inserted          ?? 0,
        journals:            jnl.headers_upserted       ?? 0,
        journalLines:        jnl.lines_inserted         ?? 0,
        bankAccounts:        ba.upserted                ?? 0,
        bankTransactions:    btxn.upserted              ?? 0,
        otherPayments:       op.upserted                ?? 0,
        otherReceipts:       or.upserted                ?? 0,
        bankTransfers:       bt.upserted                ?? 0,
        attachments:         att.upserted               ?? 0,
        canonicalAccounts:   can.accounts_upserted      ?? 0,
        canonicalJournals:   can.journal_entries_upserted ?? 0,
        canonicalLines:      can.journal_lines_upserted ?? 0,
      };
      const at = new Date().toISOString();
      setLastSageSyncResult(result);
      setLastSageSyncAt(at);
      try {
        localStorage.setItem(`sage-last-sync-${currentOrgId}`, JSON.stringify({ at, result }));
      } catch { /* localStorage quota / private mode */ }

      toast.success(
        `Sage synced: ${result.suppliers} suppliers · ${result.coa} accounts · ${result.taxRates} tax rates · ${result.paymentMethods} payment methods · ${result.products} products/services · ${result.invoices} invoices · ${result.creditNotes} credit notes · ${result.journals} journals · ${result.bankAccounts} bank accounts · ${result.bankTransactions} bank txns · ${result.otherPayments} other payments · ${result.otherReceipts} other receipts · ${result.bankTransfers} bank transfers · ${result.attachments} attachments`,
        { description: `${result.lines} invoice lines · ${result.creditNoteLines} credit note lines · ${result.journalLines} journal lines · ${result.contactPersons} contacts enriched · Canonical: ${result.canonicalAccounts} accounts / ${result.canonicalJournals} journals / ${result.canonicalLines} lines` }
      );
    } catch (e) {
      toast.error('Sage sync failed', { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setSageSyncingId(null);
      setSageSyncLabel('');
      fetchSageIntegrations();
    }
  }, [currentOrgId, SAGE_BACKEND_URL, fetchSageIntegrations]);

  // Disconnect a specific Sage connection (integrationId) — Xero/QB parity.
  const disconnectSage = useCallback(async (integrationId?: string) => {
    if (!currentOrgId) return;
    if (!confirm('Disconnect this Sage connection? Tokens will be cleared.')) return;
    setSageDisconnectingId(integrationId || '__all__');
    try {
      const headers = await getSageAuthHeaders();
      const res = await fetch(`${SAGE_BACKEND_URL}/api/sage/disconnect`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ org_id: currentOrgId, ...(integrationId ? { integration_id: integrationId } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      toast.success('Sage disconnected');
      await fetchSageStatus();
      await fetchSageIntegrations();
    } catch (e) {
      toast.error(`Sage disconnect failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSageDisconnectingId(null);
    }
  }, [currentOrgId, SAGE_BACKEND_URL, fetchSageStatus, fetchSageIntegrations]);

  // All platforms (xero, quickbooks, iplicit) use platform_integration_organization_mapping table
  const canUseMappingTable = true;

  const { data: trackingCatalog } = useXeroTrackingCatalog(currentOrgId, !!currentOrgId);

  const loadMappingFromTable = useCallback(
    async (orgs: PlatformIntegrationOrganization[]) => {
      if (!currentOrgId) return { mapping: {}, locationMap: {}, trackingMap: {} };
      if (!canUseMappingTable) return { mapping: {}, locationMap: {}, trackingMap: {} };

      const { data, error } = await (supabase as any)
        .from('platform_integration_organization_mapping')
        .select(
          'location_id, platform_integration_organizations_id, xero_tracking_category_id, xero_tracking_option_id, xero_tracking_category_name, xero_tracking_option_name',
        )
        .eq('organization_id', currentOrgId);

      if (error) {
        console.error('Error fetching organization mapping:', error);
        return { mapping: {}, locationMap: {}, trackingMap: {} };
      }

      const orgById = new Map(orgs.map((o) => [o.id, o]));
      const mapping: Record<string, string> = {};
      const locationMap: Record<string, string> = {};
      const trackingMap: Record<
        string,
        { categoryId: string; optionId: string; categoryName: string; optionName: string }
      > = {};

      (data || []).forEach((row: any) => {
        const org = orgById.get(row.platform_integration_organizations_id);
        if (!org) return;
        mapping[org.id] = row.location_id;
        locationMap[row.location_id] = org.id;
        if (row.xero_tracking_category_id || row.xero_tracking_option_id) {
          trackingMap[row.location_id] = {
            categoryId: row.xero_tracking_category_id || '',
            optionId: row.xero_tracking_option_id || '',
            categoryName: row.xero_tracking_category_name || '',
            optionName: row.xero_tracking_option_name || '',
          };
        }
      });

      return { mapping, locationMap, trackingMap };
    },
    [canUseMappingTable, currentOrgId]
  );

  // Derived states - check both dedicated state AND connections array
  const isXeroConnected = xeroIntegrations.some(x => x.is_connected) || connections.some(c => c.platform === 'xero' && c.status === 'connected');
  const isQuickbooksConnected = quickbooksIntegrations.some(q => q.is_connected) || connections.some(c => c.platform === 'quickbooks' && c.status === 'connected');
  const isIplicitConnected = connections.some(c => c.platform === 'iplicit' && c.status === 'connected');
  const xeroNeedsOAuth = false; // Xero uses env credentials, no user client_id/secret needed
  const quickbooksNeedsOAuth = quickbooksIntegrations.length > 0 && !isQuickbooksConnected;

  // Check if integration record exists (regardless of credentials)
  const hasXeroIntegration = xeroIntegrations.length > 0 || connections.some(c => c.platform === 'xero');
  const hasQuickbooksIntegration = quickbooksIntegrations.length > 0 || connections.some(c => c.platform === 'quickbooks');

  // Check if credentials exist (has client_id and client_secret)
  const hasXeroCredentials = xeroIntegrations.length > 0; // Xero uses env credentials; having any integration counts
  const hasQuickbooksCredentials = quickbooksIntegrations.length > 0; // QuickBooks uses env credentials too; having any integration counts

  // Check if iplicit connection exists (has credentials)
  const hasIplicitConnection = connections.some(c => c.platform === 'iplicit');

  // Check if iplicit has credentials saved (regardless of connection status)
  const hasIplicitCredentials = connections.some(c => c.platform === 'iplicit' && c.iplicit_domain);

  // Check if any platform is connected or has credentials saved
  const hasAnyPlatformConnected = isXeroConnected || isQuickbooksConnected || isIplicitConnected || isSageConnected;

  // Determine which platform has credentials saved (for disabling other platforms)
  const platformWithCredentials =
    hasXeroCredentials ? 'xero' :
    hasQuickbooksCredentials ? 'quickbooks' :
    hasIplicitCredentials ? 'iplicit' : null;

  // The active platform is either the connected one or the one with credentials saved
  const activePlatform =
    isXeroConnected ? 'xero' :
    isQuickbooksConnected ? 'quickbooks' :
    isIplicitConnected ? 'iplicit' :
    platformWithCredentials;

  // Count total connected platforms
  const connectedPlatformCount = [isXeroConnected, isQuickbooksConnected, isIplicitConnected].filter(Boolean).length;

  // Check if at least one organization mapping exists (required for Sync Data)
  const hasOrganizationMapping = Object.keys(mappingData).length > 0;

  // Auto-select the connected/integrated platform on load
  useEffect(() => {
    if (hasIplicitConnection) {
      setSelectedPlatform('iplicit');
    } else if (isXeroConnected) {
      setSelectedPlatform('xero');
    } else if (isQuickbooksConnected) {
      setSelectedPlatform('quickbooks');
    }
  }, [hasIplicitConnection, isXeroConnected, isQuickbooksConnected]);

  // Fetch platform integrations (Xero and QuickBooks)
  useEffect(() => {
    async function fetchPlatformIntegrations() {
      if (!currentOrgId) return;

      setIsLoadingIntegrations(true);
      try {
        // Fetch all Xero integrations (multi-account support)
        const { data: xeroData, error: xeroError } = await (supabase as any)
          .from('platform_integrations')
          .select('*')
          .eq('organization_id', currentOrgId)
          .eq('platform_name', 'xero')
          .order('created_at', { ascending: false });

        if (xeroError) {
          console.error('Error fetching Xero integrations:', xeroError);
        }

        // Auto-cleanup orphan Xero rows: rows that never completed OAuth
        // (no tenant in platform_integration_organizations, never marked
        // is_connected, and older than 30 min so we can't race a live OAuth).
        // These appear when a user closes the Xero login window mid-flow or
        // the callback fails. Without this, they render as "Xero Account N
        // — Reconnect" forever and look like a daily disconnect.
        let cleanedXeroData = xeroData || [];
        if (cleanedXeroData.length > 0) {
          const allXeroIds = cleanedXeroData.map((x: any) => x.id);
          const { data: xeroTenantRows } = await (supabase as any)
            .from('platform_integration_organizations')
            .select('platform_integration_id')
            .in('platform_integration_id', allXeroIds)
            .eq('platform_name', 'xero');
          const xeroIdsWithTenants = new Set((xeroTenantRows || []).map((r: any) => r.platform_integration_id));

          const ORPHAN_AGE_MS = 30 * 60 * 1000; // 30 minutes
          const now = Date.now();
          const orphanIds = cleanedXeroData
            .filter((x: any) =>
              !x.is_connected &&
              !xeroIdsWithTenants.has(x.id) &&
              now - new Date(x.created_at).getTime() > ORPHAN_AGE_MS
            )
            .map((x: any) => x.id);

          if (orphanIds.length > 0) {
            console.log(`[AccountingIntegrationsHub] Cleaning up ${orphanIds.length} orphan Xero integration(s)`);
            const { error: deleteErr } = await (supabase as any)
              .from('platform_integrations')
              .delete()
              .in('id', orphanIds);
            if (deleteErr) {
              console.warn('[AccountingIntegrationsHub] Failed to delete orphan Xero rows:', deleteErr);
            } else {
              cleanedXeroData = cleanedXeroData.filter((x: any) => !orphanIds.includes(x.id));
            }
          }
        }

        // Auto-heal "ghost-disconnected" Xero rows. Symptom: is_connected=false
        // but a refresh_token is still saved and the tenant row in
        // platform_integration_organizations still exists. Users hit this
        // when an old disconnect left tokens behind, when an aborted
        // migration flipped the flag, or when the flag was set by a code
        // path that has since been removed. Reconnecting via OAuth works,
        // but it's wasted MFA — if Xero still accepts the refresh_token
        // the connection is genuinely alive. We try the refresh once via
        // the dedicated edge function (single source of truth + mutex);
        // on success we flip is_connected back to true silently.
        try {
          const healableIds = cleanedXeroData
            .filter((x: any) => !x.is_connected && !!x.refresh_token)
            .map((x: any) => x.id);
          if (healableIds.length > 0) {
            const tenantCheckIds = healableIds;
            const { data: tenantRows } = await (supabase as any)
              .from('platform_integration_organizations')
              .select('platform_integration_id')
              .in('platform_integration_id', tenantCheckIds)
              .eq('platform_name', 'xero');
            const hasTenant = new Set((tenantRows || []).map((r: any) => r.platform_integration_id));
            const toHeal = healableIds.filter((id: string) => hasTenant.has(id));
            if (toHeal.length > 0) {
              console.log(`[AccountingIntegrationsHub] Attempting auto-heal on ${toHeal.length} Xero integration(s)`);
              const results = await Promise.all(toHeal.map(async (id: string) => {
                try {
                  const { data, error } = await (supabase as any).functions.invoke('xero-refresh-token', { body: { integrationId: id } });
                  if (error || !data?.success) return { id, healed: false };
                  return { id, healed: true };
                } catch {
                  return { id, healed: false };
                }
              }));
              const healedIds = results.filter(r => r.healed).map(r => r.id);
              if (healedIds.length > 0) {
                await (supabase as any)
                  .from('platform_integrations')
                  .update({ is_connected: true, updated_at: new Date().toISOString() })
                  .in('id', healedIds);
                cleanedXeroData = cleanedXeroData.map((x: any) =>
                  healedIds.includes(x.id) ? { ...x, is_connected: true } : x
                );
                console.log(`[AccountingIntegrationsHub] Auto-healed ${healedIds.length} Xero row(s)`);
              }
            }
          }
        } catch (healErr) {
          console.warn('[AccountingIntegrationsHub] Xero auto-heal skipped:', healErr);
        }

        setXeroIntegrations(cleanedXeroData);

        // Fetch all QuickBooks integrations (multi-account support)
        const { data: qbData, error: qbError } = await (supabase as any)
          .from('platform_integrations')
          .select('*')
          .eq('organization_id', currentOrgId)
          .eq('platform_name', 'quickbooks')
          .order('created_at', { ascending: false });

        if (qbError) {
          console.error('Error fetching QuickBooks integrations:', qbError);
        }

        setQuickbooksIntegrations(qbData || []);

        // Fetch organization counts for Xero (across all integrations)
        if (cleanedXeroData && cleanedXeroData.length > 0) {
          const xeroIds = cleanedXeroData.map((x: any) => x.id);
          const { count: xeroCount, error: xeroCountError } = await (supabase as any)
            .from('platform_integration_organizations')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', currentOrgId)
            .in('platform_integration_id', xeroIds)
            .eq('platform_name', 'xero');

          if (!xeroCountError) {
            setXeroOrgCount(xeroCount || 0);
          } else {
            setXeroOrgCount(0);
          }
        } else {
          setXeroOrgCount(0);
        }

        // Fetch organization counts for QuickBooks (across all integrations)
        if (qbData && qbData.length > 0) {
          const qbIds = qbData.map((q: any) => q.id);
          const { count: qbCount, error: qbCountError } = await (supabase as any)
            .from('platform_integration_organizations')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', currentOrgId)
            .in('platform_integration_id', qbIds)
            .eq('platform_name', 'quickbooks');

          if (!qbCountError) {
            setQuickbooksOrgCount(qbCount || 0);
          } else {
            setQuickbooksOrgCount(0);
          }
        } else {
          setQuickbooksOrgCount(0);
        }
      } catch (err) {
        console.error('Error fetching platform integrations:', err);
      } finally {
        setIsLoadingIntegrations(false);
      }
    }

    fetchPlatformIntegrations();
  }, [currentOrgId]);

  // Fetch platform organizations for mapping section
  // Build a stable key representing all connected integration IDs
  const connectedIntegrationKey = [
    ...xeroIntegrations.filter(x => x.is_connected).map(x => x.id),
    ...(quickbooksIntegration?.is_connected ? [quickbooksIntegration.id] : []),
    ...connections.filter(c => c.platform === 'iplicit' && c.status === 'connected').map(c => c.id),
  ].sort().join(',');

  useEffect(() => {
    if (!currentOrgId || (!isMappingSectionOpen && !isMappingDialogOpen)) return;

    // Build a fetch key that changes whenever connected integrations change
    const fetchKey = `${currentOrgId}:${connectedIntegrationKey}`;
    if (hasFetchedRef.current[fetchKey]) return;

    // Check if any platform is connected or has credentials
    const isXeroConnected = xeroIntegrations.some(x => x.is_connected);
    const isQuickbooksConnected = !!quickbooksIntegration?.is_connected;
    const hasIplicitConn = connections.some(c => c.platform === 'iplicit');
    const isSageConn = Boolean(sageStatus?.connected);

    // Skip API call if no platform is connected/configured
    if (!isXeroConnected && !isQuickbooksConnected && !hasIplicitConn && !isSageConn) {
      setPlatformOrganizations([]);
      return;
    }

    // Define a function to fetch organizations
    const fetchOrgs = async () => {
      setIsLoadingPlatformOrgs(true);
      try {
        // Fetch ACTIVE tenant rows for ALL integrations in the org (connected
        // OR disconnected). Restricting to is_connected=true hid moved/migrated
        // rows in the Active Connections list (they rendered as "Xero Account N"
        // because tenant data wasn't loaded for them). The connection card uses
        // is_connected separately to decide Reconnect vs Disconnect buttons.
        const { data: allIntegrations, error: intError } = await (supabase as any)
          .from('platform_integrations')
          .select('id')
          .eq('organization_id', currentOrgId);

        if (intError) {
          console.error('Error fetching integrations:', intError);
          setPlatformOrganizations([]);
          setIsLoadingPlatformOrgs(false);
          return;
        }

        const integrationIds = (allIntegrations || []).map((r: any) => r.id);

        if (integrationIds.length === 0) {
          setPlatformOrganizations([]);
          setIsLoadingPlatformOrgs(false);
          return;
        }

        // Fetch tenants for every integration in the org.
        const { data, error: platformError } = await (supabase as any)
          .from('platform_integration_organizations')
          .select('*')
          .eq('organization_id', currentOrgId)
          .eq('status', 'active')
          .in('platform_integration_id', integrationIds)
          .order('platform_org_name', { ascending: true });

        if (platformError) {
          console.error('Error fetching platform organizations:', platformError);
          setPlatformOrganizations([]);
        } else {
          const allOrgs = data || [];
          setPlatformOrganizations(allOrgs);

          // Initialize mapping data from platform_integration_organization_mapping table only
          const fromTable = await loadMappingFromTable(allOrgs);
          setMappingData(fromTable.mapping);
          setLocationOrganizationMap(fromTable.locationMap);
          setLocationTrackingMap(fromTable.trackingMap || {});
        }
      } catch (err) {
        console.error('Error fetching platform organizations:', err);
        setPlatformOrganizations([]);
        toast.error('Failed to fetch organizations');
      } finally {
        setIsLoadingPlatformOrgs(false);
      }
    };

    // Fetch organizations for any platform (common mapping)
    if (currentOrgId) {
      hasFetchedRef.current[fetchKey] = true;
      fetchOrgs();
    }
  }, [currentOrgId, isMappingSectionOpen, isMappingDialogOpen, xeroIntegrations, quickbooksIntegration?.id, quickbooksIntegration?.is_connected, connections, sageStatus?.connected, session?.user?.id, toast, loadMappingFromTable]);

  // Reset fetch flag when org changes (so mapping can refetch for new org)
  useEffect(() => {
    if (!currentOrgId) return;
    hasFetchedRef.current = {};
  }, [currentOrgId]);

  // Sync locationOrganizationMap with existing mappings from mappingData
  useEffect(() => {
    if (platformOrganizations.length > 0 && locations.length > 0 && Object.keys(mappingData).length > 0) {
      setLocationOrganizationMap(prev => {
        const syncedMap: Record<string, string> = { ...prev };
        let hasChanges = false;
        
        // For each location, check if there's an existing mapping
        locations.forEach(location => {
          // If location doesn't have a selection in locationOrganizationMap, check mappingData
          if (!syncedMap[location.id]) {
            const mappedOrg = platformOrganizations.find(org => 
              mappingData[org.id] === location.id
            );
            if (mappedOrg) {
              syncedMap[location.id] = mappedOrg.id;
              hasChanges = true;
            }
          }
        });
        
        return hasChanges ? syncedMap : prev;
      });
    }
  }, [mappingData, platformOrganizations, locations]);

  // Initiate Xero OAuth flow (using env credentials - no user credentials needed)
  // connectionId: if provided, reconnect that specific integration; otherwise create a new one
  // forceXeroLogin: drive from the user's INTENT, not from `!connectionId`.
  //   false → silent SSO (smooth, no MFA churn): reconnect, onboarding, and
  //           "connect my current Xero account" (incl. same account → another
  //           DentPulse org; the callback's org-scoped dedupe creates it
  //           correctly). true → only when the user explicitly wants to attach
  //           a DIFFERENT Xero account (must prompt=login to switch Xero user).
  const initiateXeroOAuth = async (connectionId?: string, forceXeroLogin = false) => {
    console.log('[Xero OAuth] Starting...', connectionId ? `reconnecting ${connectionId}` : 'new connection');

    if (!currentOrgId) {
      toast.error('Missing organization');
      return;
    }

    // Caller passes the integration id when reconnecting an existing row, undefined when adding a fresh connection
    setOauthInProgress(connectionId || 'new-xero');

    try {
      console.log('[Xero OAuth] Refreshing session...');
      const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();

      if (refreshError) {
        console.error('[Xero OAuth] Session refresh failed:', refreshError);
        toast.error('Session expired. Please login again.');
        setOauthInProgress(null);
        return;
      }

      console.log('[Xero OAuth] Session refreshed, calling xero-auth edge function...');

      const response = await supabase.functions.invoke('xero-auth', {
        body: {
          organizationId: currentOrgId,
          currentOrigin: window.location.origin,
          connectionId, // undefined for new connection, or specific ID for reconnect
          // Intent-driven (see initiateXeroOAuth doc). Only true when the user
          // explicitly chose "connect a DIFFERENT Xero account"; everything
          // else is silent SSO so connect/reconnect is not interrupted by an
          // MFA prompt every time.
          forceXeroLogin,
        },
      });

      console.log('[Xero OAuth] Response:', response);

      if (response.error) {
        throw new Error(response.error.message || 'Failed to initiate OAuth');
      }

      const { authorizationUrl } = response.data;

      if (!authorizationUrl) {
        throw new Error('No authorization URL received');
      }

      window.location.href = authorizationUrl;
    } catch (error: any) {
      console.error('Error initiating Xero OAuth:', error);
      toast.error(error.message || 'Failed to connect to Xero');
      setOauthInProgress(null);
    }
  };

  // QuickBooks uses APP-LEVEL env credentials (like Xero) — users never enter a
  // client id/secret. integrationId: pass to reconnect that specific connection
  // (re-runs OAuth → fresh tokens); omit for a fresh connect (the integration
  // row is created in quickbooks-callback once OAuth completes). Mirrors
  // initiateXeroOAuth.
  const initiateQuickBooksOAuth = async (integrationId?: string) => {
    if (!currentOrgId) {
      toast.error('Missing organization');
      return;
    }

    // Caller passes the integration id when reconnecting an existing row,
    // undefined when adding a fresh connection.
    setOauthInProgress(integrationId || 'new-quickbooks');

    try {
      // Refresh session before calling edge function
      const { error: refreshError } = await supabase.auth.refreshSession();

      if (refreshError) {
        console.error('[QuickBooks OAuth] Session refresh failed:', refreshError);
        toast.error('Session expired. Please login again.');
        setOauthInProgress(null);
        return;
      }

      const response = await supabase.functions.invoke('quickbooks-auth', {
        body: {
          organizationId: currentOrgId,
          currentOrigin: window.location.origin,
          connectionId: integrationId, // undefined for new connect, or id for reconnect
        },
      });

      if (response.error) {
        throw new Error(response.error.message || 'Failed to initiate OAuth');
      }

      const { authorizationUrl } = response.data;

      if (!authorizationUrl) {
        throw new Error('No authorization URL received');
      }

      // Redirect to QuickBooks OAuth
      window.location.href = authorizationUrl;
    } catch (error: any) {
      console.error('Error initiating QuickBooks OAuth:', error);
      toast.error(error.message || 'Failed to connect to QuickBooks');
      setOauthInProgress(null);
    }
  };

  // Disconnect platform integration
  const disconnectPlatform = async (platform: 'xero' | 'quickbooks', connectionId?: string) => {
    if (platform === 'xero') {
      // For Xero multi-account: disconnect a specific connection
      const targetId = connectionId;
      if (!targetId) return;

      setIsDisconnecting(targetId);
      try {
        const { error } = await (supabase as any)
          .from('platform_integrations')
          .update({
            access_token: null,
            refresh_token: null,
            token_expires_at: null,
            is_connected: false,
            updated_at: new Date().toISOString(),
          })
          .eq('id', targetId);

        if (error) throw error;

        // Refresh Xero integrations
        const { data: updatedData } = await (supabase as any)
          .from('platform_integrations')
          .select('*')
          .eq('organization_id', currentOrgId)
          .eq('platform_name', 'xero')
          .order('created_at', { ascending: false });

        setXeroIntegrations(updatedData || []);
        await refetch();
        toast.success('Disconnected from Xero');
      } catch (error: any) {
        toast.error(error.message || 'Failed to disconnect from Xero');
      } finally {
        setIsDisconnecting(null);
      }
    } else {
      const integration = quickbooksIntegration;
      if (!integration?.id) return;

      setIsDisconnecting(platform);
      try {
        const { error } = await (supabase as any)
          .from('platform_integrations')
          .update({
            access_token: null,
            refresh_token: null,
            token_expires_at: null,
            is_connected: false,
            updated_at: new Date().toISOString(),
          })
          .eq('id', integration.id);

        if (error) throw error;

        const { data: updatedData } = await (supabase as any)
          .from('platform_integrations')
          .select('*')
          .eq('organization_id', currentOrgId)
          .eq('platform_name', platform)
          .order('created_at', { ascending: false });

        setQuickbooksIntegrations(updatedData || []);
        await refetch();
        toast.success('Disconnected from QuickBooks');
      } catch (error: any) {
        toast.error(error.message || 'Failed to disconnect from QuickBooks');
      } finally {
        setIsDisconnecting(null);
      }
    }
  };

  // Remove ONE Xero organisation (tenant) without touching the shared login or
  // the other organisations: mark its tenant row inactive — the sync engine
  // only processes active tenants, and the UI lists only active ones. Its
  // already-synced data stays. Re-running "Connect my Xero account" for the
  // same login re-activates it (xero-callback upserts tenants as active).
  const removeXeroOrganisation = async (tenant: PlatformIntegrationOrganization) => {
    if (!currentOrgId) return;
    setIsRemovingTenant(true);
    try {
      const { error } = await (supabase as any)
        .from('platform_integration_organizations')
        .update({ status: 'inactive', is_selected: false, updated_at: new Date().toISOString() })
        .eq('id', tenant.id)
        .eq('organization_id', currentOrgId);
      if (error) throw error;

      // Drop this organisation's practice-location link (if any) so the
      // location shows as unmapped instead of pointing at a hidden entity.
      const { error: mapError } = await (supabase as any)
        .from('platform_integration_organization_mapping')
        .delete()
        .eq('organization_id', currentOrgId)
        .eq('platform_integration_organizations_id', tenant.id);
      if (mapError) console.warn('[AccountingIntegrationsHub] Failed to remove location mapping for removed organisation:', mapError);

      toast.success(`${tenant.platform_org_name || 'Organisation'} removed`, {
        description: 'It will no longer sync. The other organisations are unaffected — reconnect your Xero account any time to add it back.',
      });
      await fetchPlatformOrganizations();
    } catch (err: any) {
      toast.error(err.message || 'Failed to remove organisation');
    } finally {
      setIsRemovingTenant(false);
      setXeroRemoveTarget(null);
    }
  };

  // Open edit credentials dialog
  const openEditCredentialsDialog = (platform: 'xero' | 'quickbooks' | 'iplicit') => {
    setEditingPlatform(platform);

    if (platform === 'iplicit') {
      // Get iplicit connection data — use editingConnectionId if set, otherwise first iplicit connection
      const iplicitConn = editingConnectionId
        ? connections.find(c => c.id === editingConnectionId)
        : connections.find(c => c.platform === 'iplicit');
      const domain = iplicitConn?.iplicit_domain || '';
      const username = iplicitConn?.iplicit_username || '';
      setEditCredentialsData({
        clientId: '',
        clientSecret: '',
        iplicitDomain: domain,
        iplicitUsername: username,
        iplicitApiKey: '',
      });
    } else {
      const integration = platform === 'xero' ? xeroIntegrations[0] : quickbooksIntegration;
      setEditCredentialsData({
        clientId: integration?.client_id || '',
        clientSecret: integration?.client_secret || '',
        iplicitDomain: '',
        iplicitUsername: '',
        iplicitApiKey: '',
      });
    }

    setIsEditCredentialsDialogOpen(true);
  };

  // Update credentials
  const updateCredentials = async () => {
    if (!editingPlatform || !currentOrgId) return;

    if (editingPlatform === 'iplicit') {
      const { iplicitDomain, iplicitUsername, iplicitApiKey } = editCredentialsData;
      if (!iplicitDomain || !iplicitUsername || !iplicitApiKey) {
        toast.error('Please fill in all iplicit required fields.');
        return;
      }

      setIsUpdatingCredentials(true);
      try {
        // Use the same edge function as add-new so username and client_secret
        // are always stored in their own separate columns (not the old combined format)
        const success = await saveIplicitCredentials({
          connectionName: `iplicit-${iplicitDomain}`,
          entityName: iplicitDomain,
          iplicitDomain,
          iplicitUsername,
          iplicitApiKey,
        }, editingConnectionId || undefined);

        if (!success) return; // saveIplicitCredentials already shows a toast on error

        toast.success('iplicit credentials updated successfully');

        setIsEditCredentialsDialogOpen(false);
        setEditCredentialsData({ clientId: '', clientSecret: '', iplicitDomain: '', iplicitUsername: '', iplicitApiKey: '' });
        setEditingPlatform(null);
      } catch (error: any) {
        toast.error(error.message || 'Failed to update credentials');
      } finally {
        setIsUpdatingCredentials(false);
      }
      return;
    }

    const { clientId, clientSecret } = editCredentialsData;
    if (!clientId || !clientSecret) {
      toast.error('Please fill in all required fields.');
      return;
    }

    setIsUpdatingCredentials(true);
    try {
      const integration = editingPlatform === 'xero' ? xeroIntegrations[0] : quickbooksIntegration;
      if (!integration?.id) {
        throw new Error('Integration not found');
      }

      const { error } = await (supabase as any)
        .from('platform_integrations')
        .update({
          client_id: clientId,
          client_secret: clientSecret,
          updated_at: new Date().toISOString(),
        })
        .eq('id', integration.id);

      if (error) throw error;

      // Refresh platform integrations
      const { data: updatedData } = await (supabase as any)
        .from('platform_integrations')
        .select('*')
        .eq('organization_id', currentOrgId)
        .eq('platform_name', editingPlatform)
        .order('created_at', { ascending: false });

      // Update local state
      if (editingPlatform === 'xero') {
        setXeroIntegrations(updatedData || []);
      } else {
        setQuickbooksIntegrations(updatedData || []);
      }

      toast.success(`${editingPlatform === 'xero' ? 'Xero' : 'QuickBooks'} credentials updated successfully`);

      setIsEditCredentialsDialogOpen(false);
      setEditCredentialsData({ clientId: '', clientSecret: '', iplicitDomain: '', iplicitUsername: '', iplicitApiKey: '' });
      setEditingPlatform(null);
    } catch (error: any) {
      toast.error(error.message || 'Failed to update credentials');
    } finally {
      setIsUpdatingCredentials(false);
    }
  };

  // Fetch platform organizations manually (not using useEffect) - Common for Xero, QuickBooks, and iplicit
  // This fetches ALL organizations from ALL connected platforms for the mapping section
  const fetchPlatformOrganizations = useCallback(async () => {
    if (!currentOrgId) {
      setPlatformOrganizations([]);
      return;
    }

    // Check if any platform is connected or has credentials
    const isXeroConn = xeroIntegrations.some(x => x.is_connected);
    const isQuickbooksConn = !!quickbooksIntegration?.is_connected;
    const hasIplicitConn = connections.some(c => c.platform === 'iplicit');
    const isSageConn = Boolean(sageStatus?.connected);

    // Skip API call if no platform is connected/configured
    if (!isXeroConn && !isQuickbooksConn && !hasIplicitConn && !isSageConn) {
      setPlatformOrganizations([]);
      return;
    }

    setIsLoadingPlatformOrgs(true);
    try {
      // Get IDs of connected integrations only
      const { data: connIntegrations } = await (supabase as any)
        .from('platform_integrations')
        .select('id')
        .eq('organization_id', currentOrgId)
        .eq('is_connected', true);

      const connIds = (connIntegrations || []).map((r: any) => r.id);

      if (connIds.length === 0) {
        setPlatformOrganizations([]);
        setIsLoadingPlatformOrgs(false);
        return;
      }

      // Fetch ACTIVE organizations only from CONNECTED integrations
      const { data, error } = await (supabase as any)
        .from('platform_integration_organizations')
        .select('*')
        .eq('organization_id', currentOrgId)
        .eq('status', 'active')
        .in('platform_integration_id', connIds)
        .order('platform_org_name', { ascending: true });

      if (error) {
        console.error('Error fetching platform organizations:', error);
        setPlatformOrganizations([]);
        toast.error(error.message || 'Failed to fetch organizations');
      } else {
        const orgs = data || [];

        // If iplicit is connected but no iplicit orgs found in DB, trigger iplicit-sync
        // to populate platform_integration_organizations (legal entities).
        // This happens because the regular iplicit sync (Node backend) does not save
        // legal entities — only the iplicit-sync edge function does.
        // Check each iplicit connection — trigger edge function sync for any that have no orgs yet
        const iplicitConns = connections.filter(c => c.platform === 'iplicit');
        const iplicitConnsWithoutOrgs = iplicitConns.filter(conn =>
          !orgs.some((o: any) => o.platform_name === 'iplicit' && o.platform_integration_id === conn.id)
        );

        if (iplicitConnsWithoutOrgs.length > 0) {
          console.log(`[AccountingIntegrationsHub] ${iplicitConnsWithoutOrgs.length} iplicit connection(s) have no orgs, triggering iplicit-sync for each...`);
          try {
            const { data: sessionData } = await supabase.auth.getSession();
            const accessToken = sessionData?.session?.access_token;
            const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://fpqesehkowpvxraommsc.supabase.co';

            // Trigger sync for each connection without orgs
            await Promise.all(iplicitConnsWithoutOrgs.map(async (conn) => {
              console.log(`[AccountingIntegrationsHub] Triggering iplicit-sync for connection ${conn.id} (${conn.iplicit_domain})...`);
              const syncResponse = await fetch(`${supabaseUrl}/functions/v1/iplicit-sync`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${accessToken}`,
                },
                body: JSON.stringify({
                  connectionId: conn.id,
                  organizationId: currentOrgId,
                }),
              });
              if (!syncResponse.ok) {
                console.warn(`[AccountingIntegrationsHub] iplicit-sync failed for ${conn.id}:`, await syncResponse.text());
              }
            }));

            console.log('[AccountingIntegrationsHub] iplicit-sync completed, refetching organizations...');
            // Refetch organizations after sync
            const { data: refreshedData } = await (supabase as any)
              .from('platform_integration_organizations')
              .select('*')
              .eq('organization_id', currentOrgId)
              .eq('status', 'active')
              .in('platform_integration_id', connIds)
              .order('platform_org_name', { ascending: true });

            const refreshedOrgs = refreshedData || [];
            setPlatformOrganizations(refreshedOrgs);
            const fromTable = await loadMappingFromTable(refreshedOrgs);
            setMappingData(fromTable.mapping);
            setLocationOrganizationMap(fromTable.locationMap);
            setLocationTrackingMap(fromTable.trackingMap || {});
            return;
          } catch (syncErr) {
            console.warn('[AccountingIntegrationsHub] Failed to trigger iplicit-sync:', syncErr);
          }
        }

        setPlatformOrganizations(orgs);

        // Initialize mapping data from platform_integration_organization_mapping table only
        const fromTable = await loadMappingFromTable(orgs);
        setMappingData(fromTable.mapping);
        setLocationOrganizationMap(fromTable.locationMap);
        setLocationTrackingMap(fromTable.trackingMap || {});
      }
    } catch (err) {
      console.error('Error fetching platform organizations:', err);
      setPlatformOrganizations([]);
      toast.error('Failed to fetch organizations');
    } finally {
      setIsLoadingPlatformOrgs(false);
    }
  }, [currentOrgId, xeroIntegrations, quickbooksIntegration?.is_connected, connections, sageStatus?.connected, loadMappingFromTable]);

  // Save mapping to database - Common for Xero, QuickBooks, and iplicit
  // Uses platform_integration_organization_mapping table for all platforms
  const handleSaveMapping = async (
    orgId: string,
    locationId: string,
    tracking?: { categoryId: string; optionId: string; categoryName: string; optionName: string } | null,
  ) => {
    if (!currentOrgId) throw new Error('Missing organization');

    const org = platformOrganizations.find(o => o.id === orgId);
    if (!org) throw new Error('Organization not found');

    if (!locationId) {
      // Delete mapping(s) for this platform org
      const { error: deleteError } = await (supabase as any)
        .from('platform_integration_organization_mapping')
        .delete()
        .eq('organization_id', currentOrgId)
        .eq('platform_integration_organizations_id', orgId);

      if (deleteError) throw deleteError;
    } else {
      // Delete ALL existing mappings for this location across ALL platforms
      // This enforces strict 1:1 ownership: one location → one financial entity
      const { error: cleanupError } = await (supabase as any)
        .from('platform_integration_organization_mapping')
        .delete()
        .eq('organization_id', currentOrgId)
        .eq('location_id', locationId);

      if (cleanupError) throw cleanupError;

      const isXero = String(org.platform_name || '').toLowerCase() === 'xero';
      const trackingPayload = isXero && tracking?.optionId
        ? {
            xero_tracking_category_id: tracking.categoryId || null,
            xero_tracking_option_id: tracking.optionId || null,
            xero_tracking_category_name: tracking.categoryName || null,
            xero_tracking_option_name: tracking.optionName || null,
          }
        : {
            xero_tracking_category_id: null,
            xero_tracking_option_id: null,
            xero_tracking_category_name: null,
            xero_tracking_option_name: null,
          };

      const { error: upsertError } = await (supabase as any)
        .from('platform_integration_organization_mapping')
        .upsert(
          {
            organization_id: currentOrgId,
            user_id: session?.user?.id || null,
            location_id: locationId,
            platform_integration_organizations_id: orgId,
            platform_integration_id: org.platform_integration_id,
            ...trackingPayload,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'location_id,platform_integration_organizations_id' }
        );

      if (upsertError) throw upsertError;
    }
  };

  const handleClearLocationMapping = async (locationId: string) => {
    if (!currentOrgId) throw new Error('Missing organization');

    const { error: deleteError } = await (supabase as any)
      .from('platform_integration_organization_mapping')
      .delete()
      .eq('organization_id', currentOrgId)
      .eq('location_id', locationId);

    if (deleteError) throw deleteError;
  };

  // Save all mappings for all locations
  const handleSaveAllMappings = async () => {
    const mappingsToSave = Object.entries(locationOrganizationMap).filter(([, orgId]) => isMappedOrgId(orgId));
    const locationsToUnmap = Object.entries(locationOrganizationMap)
      .filter(([, orgId]) => orgId === UNMAPPED_ORG_VALUE)
      .map(([locationId]) => locationId);

    if (mappingsToSave.length === 0 && locationsToUnmap.length === 0) {
      toast.error('Please select an organization, or choose “No organization” to clear a mapping');
      return;
    }

    setIsSavingMapping(true);
    try {
      const savePromises = mappingsToSave.map(async ([locationId, orgId]) => {
        const org = platformOrganizations.find(o => o.id === orgId);
        if (!org) {
          throw new Error(`Organization ${orgId} not found`);
        }

        const tracking = locationTrackingMap[locationId] || null;
        await handleSaveMapping(org.id, locationId, tracking);
      });

      const unmapPromises = locationsToUnmap.map((locationId) => handleClearLocationMapping(locationId));

      await Promise.all([...savePromises, ...unmapPromises]);

      // Reload authoritative mapping state (supports one Xero org → many locations via tracking)
      const refreshed = await loadMappingFromTable(platformOrganizations);
      setMappingData(refreshed.mapping || {});
      setLocationOrganizationMap(refreshed.locationMap || {});
      setLocationTrackingMap(refreshed.trackingMap || {});
      await queryClient.invalidateQueries({ queryKey: ['location-tracking-labels', currentOrgId] });
      await queryClient.invalidateQueries({ queryKey: ['xero-tracking-catalog', currentOrgId] });
      toast.success('Location mappings saved');
      setIsMappingDialogOpen(false);
    } catch (err: any) {
      console.error('Error saving mappings:', err);
      toast.error(err?.message || 'Failed to save mappings');
    } finally {
      setIsSavingMapping(false);
    }
  };

  const [isSyncing, setIsSyncing] = useState<string | null>(null);
  const [expandedConnections, setExpandedConnections] = useState<string[]>([]);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditCredentialsDialogOpen, setIsEditCredentialsDialogOpen] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isUpdatingCredentials, setIsUpdatingCredentials] = useState(false);
  const [editingPlatform, setEditingPlatform] = useState<'xero' | 'quickbooks' | 'iplicit' | null>(null);
  const [editingConnectionId, setEditingConnectionId] = useState<string | null>(null);
  const [editCredentialsData, setEditCredentialsData] = useState({
    clientId: '',
    clientSecret: '',
    iplicitDomain: '',
    iplicitUsername: '',
    iplicitApiKey: '',
  });
  const [newConnectionData, setNewConnectionData] = useState({
    name: '',
    entityName: '',
    syncFrequency: '1hour',
    iplicitDomain: '',
    iplicitUsername: '',
    iplicitApiKey: '',
    quickbooksClientId: '',
    quickbooksClientSecret: '',
  });

  const handleSync = async (connectionId: string) => {
    setIsSyncing(connectionId);
    const success = await syncConnection(connectionId);
    setIsSyncing(null);
    if (success) {
      // Refresh Platform Organizations list after successful sync
      fetchPlatformOrganizations();
    }
  };

  // Trigger Xero sync via the Node backend. Jobs are persisted to sync_jobs and
  // processed asynchronously, so progress is visible on the Sync Summary page.
  // When integrationId is provided, only that connection's tenants are synced.
  const handleXeroSync = async (integrationId?: string) => {
    if (!currentOrgId) {
      toast.error('Missing organization');
      return;
    }

    setIsSyncing(integrationId || 'xero');

    try {
      const result = await SyncJobService.triggerXeroFullSync(currentOrgId, integrationId);

      if (!result.success) {
        throw new Error(result.error || 'Failed to trigger Xero sync');
      }

      if (result.jobCount === 0) {
        toast.info('Already Syncing', {
          description: 'All Xero jobs for this connection are already queued or running.',
        });
      } else {
        toast.success('Sync Started', {
          description: `Queued ${result.jobCount} Xero job(s). Open Sync Summary to watch progress.`,
        });
      }

      // Refresh Platform Organizations list so newly-synced tenants appear
      fetchPlatformOrganizations();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sync failed';
      toast.error('Sync Error', { description: message });
    } finally {
      setIsSyncing(null);
    }
  };

  // Trigger QuickBooks sync via the Node backend. Jobs are persisted to
  // sync_jobs and processed asynchronously, so progress is visible on the
  // Sync Summary page (mirrors handleXeroSync). When integrationId is given,
  // only that connection's company is synced.
  const handleQuickBooksSync = async (integrationId?: string) => {
    if (!currentOrgId) {
      toast.error('Missing organization');
      return;
    }

    setIsSyncing(integrationId || 'quickbooks');

    try {
      const result = await SyncJobService.triggerQuickBooksFullSync(currentOrgId, integrationId);

      if (!result.success) {
        throw new Error(result.error || 'Failed to trigger QuickBooks sync');
      }

      if (result.jobCount === 0) {
        toast.info('Already Syncing', {
          description: 'All QuickBooks jobs for this connection are already queued or running.',
        });
      } else {
        toast.success('Sync Started', {
          description: `Queued ${result.jobCount} QuickBooks job(s). Open Sync Summary to watch progress.`,
        });
      }

      fetchPlatformOrganizations();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sync failed';
      toast.error('Sync Error', { description: message });
    } finally {
      setIsSyncing(null);
    }
  };

  const handleFeatureToggle = async (connectionId: string, featureName: string) => {
    const connection = connections.find(c => c.id === connectionId);
    if (!connection) return;

    const currentFeatures = connection.enabled_features || [];
    const newFeatures = currentFeatures.includes(featureName)
      ? currentFeatures.filter(f => f !== featureName)
      : [...currentFeatures, featureName];

    await updateConnection(connectionId, { enabled_features: newFeatures });
    refetch();
  };

  const handleDeleteConnection = async (connectionId: string) => {
    await deleteConnection(connectionId);
  };

  const toggleExpanded = (connectionId: string) => {
    setExpandedConnections(prev =>
      prev.includes(connectionId)
        ? prev.filter(id => id !== connectionId)
        : [...prev, connectionId]
    );
  };

  const handleAddConnection = async () => {
    // Platform-specific validation (Xero uses env credentials, no user input needed)
    if (selectedPlatform === 'iplicit') {
      const { iplicitDomain, iplicitUsername, iplicitApiKey } = newConnectionData;
      if (!iplicitDomain || !iplicitUsername || !iplicitApiKey) {
        toast.error('Please fill in all iplicit required fields.');
        return;
      }
    }

    setIsConnecting(true);

    try {
      if (selectedPlatform === 'iplicit') {
        const { iplicitDomain, iplicitUsername, iplicitApiKey } = newConnectionData;

        // Use the saveIplicitCredentials hook method
        const success = await saveIplicitCredentials({
          connectionName: `iplicit-${iplicitDomain}`,
          entityName: iplicitDomain,
          iplicitDomain,
          iplicitUsername,
          iplicitApiKey,
        });

        setIsConnecting(false);

        if (!success) {
          return;
        }

        setIsAddDialogOpen(false);
        setNewConnectionData({
          name: '',
          entityName: '',
          syncFrequency: '1hour',
          iplicitDomain: '',
          iplicitUsername: '',
          iplicitApiKey: '',
          quickbooksClientId: '',
          quickbooksClientSecret: '',
        });
      }
    } catch (error: any) {
      setIsConnecting(false);
      toast.error(error.message || 'Failed to save credentials');
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'connected':
        return <Badge variant="default"><Check className="w-3 h-3 mr-1" /> Connected</Badge>;
      case 'error':
        return <Badge variant="destructive"><AlertCircle className="w-3 h-3 mr-1" /> Error</Badge>;
      case 'pending_auth':
        return <Badge variant="secondary"><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Pending</Badge>;
      default:
        return <Badge variant="secondary"><X className="w-3 h-3 mr-1" /> Disconnected</Badge>;
    }
  };

  if (isOrgIdLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!currentOrgId) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <AlertCircle className="w-12 h-12 text-muted-foreground mb-4" />
          <h3 className="font-semibold text-foreground mb-1">No Organization Selected</h3>
          <p className="text-sm text-muted-foreground text-center">
            Please complete onboarding or select an organization to manage accounting connections.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Helper: render a status badge
  const renderStatusBadge = (connected: boolean, hasCredentials: boolean) => {
    if (connected) return (
      <span className="dp-status-badge dp-status-badge--connected">
        <span className="dp-pulse-dot" /> Connected
      </span>
    );
    if (hasCredentials) return (
      <span className="dp-status-badge dp-status-badge--pending">
        <Key className="w-3 h-3" /> Credentials Saved
      </span>
    );
    return (
      <span className="dp-status-badge dp-status-badge--idle">Not Connected</span>
    );
  };

  // Helper: render a connection row for active connections
  const renderConnectionRow = (
    name: string, subtitle: string, connected: boolean,
    actions: React.ReactNode, key: string
  ) => (
    <div key={key} className="dp-conn-row">
      <div className="flex items-center gap-2.5 min-w-0 flex-1">
        <span className={cn("dp-conn-dot", connected ? "dp-conn-dot--on" : "dp-conn-dot--off")} />
        <div className="min-w-0">
          <span className="text-[13px] font-medium text-foreground block break-words leading-snug">{name}</span>
          {subtitle && <span className="text-[11px] text-muted-foreground block break-words leading-tight">{subtitle}</span>}
        </div>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">{actions}</div>
    </div>
  );

  return (
    <div className="space-y-5">
      {/* ── Section Header ── */}
      <div className="flex items-center gap-3 px-1">
        <div className="dp-section-icon">
          <Layers className="w-5 h-5 text-white" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-foreground tracking-tight">Financial Integrations</h2>
          <p className="text-xs text-muted-foreground">Connect your practice accounting software to sync revenue & expenses</p>
        </div>
        {connectedPlatformCount > 0 && (
          <span className="dp-active-pill ml-auto">
            <span className="dp-pulse-dot" /> {connectedPlatformCount} Active
          </span>
        )}
      </div>

      {/* ── Platform Cards ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">

        {/* ── iplicit Card ── */}
        {(() => {
          const platform = accountingPlatforms.iplicit;
          const iplicitConns = connections.filter(c => c.platform === 'iplicit');

          return (
            <div className={cn("dp-platform-card", isIplicitConnected && "dp-platform-card--connected")} style={{ '--card-i': 0 } as React.CSSProperties}>
              <div className="dp-card-header">
                <div className="dp-logo-ring dp-logo-ring--iplicit">
                  <PlatformLogo platform={platform} className="w-11 h-11 object-contain" />
                </div>
                <span className="text-base font-bold text-foreground mt-3">{platform.name}</span>
                <div className="mt-2">{renderStatusBadge(isIplicitConnected, hasIplicitCredentials)}</div>
              </div>

              <div className="dp-card-actions">
                {isLoading ? (
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground mx-auto" />
                ) : hasIplicitCredentials ? (
                  <Button onClick={() => { setSelectedPlatform('iplicit'); setEditingConnectionId(null); setIsAddDialogOpen(true); }} variant="outline" size="sm" className="dp-btn-action w-full">
                    <Plus className="w-3.5 h-3.5" /> Add Account
                  </Button>
                ) : (
                  <Button onClick={() => { setSelectedPlatform('iplicit'); setEditingConnectionId(null); setIsAddDialogOpen(true); }} size="sm" className="dp-btn-primary w-full">
                    <Plus className="w-3.5 h-3.5" /> Add Credential
                  </Button>
                )}
              </div>

              {iplicitConns.length > 0 && (
                <div className="dp-card-footer">
                  <p className="dp-footer-label">Active Connections</p>
                  <div className="space-y-1.5">
                    {iplicitConns.map((conn) => {
                      const connected = conn.status === 'connected';
                      return renderConnectionRow(
                        conn.iplicit_domain || conn.entity_name || conn.name,
                        conn.iplicit_username || '',
                        connected,
                        <>
                          <Button variant="ghost" size="icon" onClick={() => { setSelectedPlatform('iplicit'); setEditingConnectionId(conn.id); openEditCredentialsDialog('iplicit'); }} className="dp-icon-btn"><Pencil className="w-3 h-3" /></Button>
                          <Button variant="ghost" size="icon" onClick={() => handleSync(conn.id)} disabled={isSyncing === conn.id} className="dp-icon-btn"><RefreshCw className={cn("w-3 h-3", isSyncing === conn.id && "animate-spin")} /></Button>
                          <Button variant="ghost" size="icon" onClick={() => handleDeleteConnection(conn.id)} className="dp-icon-btn dp-icon-btn--danger"><Trash2 className="w-3 h-3" /></Button>
                          {connected ? (
                            <Button variant="ghost" size="sm" onClick={() => disconnectIplicit(conn.id)} disabled={isDisconnecting === conn.id} className="dp-disconnect-btn">
                              <X className="w-3 h-3" /> {isDisconnecting === conn.id ? '...' : 'Disconnect'}
                            </Button>
                          ) : (
                            <Button size="sm" onClick={async () => { setIsConnecting(true); await connectToIplicit(conn.id); setIsConnecting(false); }} disabled={isConnecting} className="dp-connect-btn">
                              {isConnecting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Link2 className="w-3 h-3" />} Connect
                            </Button>
                          )}
                        </>,
                        conn.id
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* ── Xero Card ── */}
        {(() => {
          const platform = accountingPlatforms.xero;

          return (
            <div className={cn("dp-platform-card", isXeroConnected && "dp-platform-card--connected")} style={{ '--card-i': 1 } as React.CSSProperties}>
              <div className="dp-card-header">
                <div className="dp-logo-ring dp-logo-ring--xero">
                  <PlatformLogo platform={platform} className="w-11 h-11 object-contain" />
                </div>
                <span className="text-base font-bold text-foreground mt-3">{platform.name}</span>
                <div className="mt-2">{renderStatusBadge(isXeroConnected, hasXeroCredentials)}</div>
              </div>

              <div className="dp-card-actions">
                {isLoading ? (
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground mx-auto" />
                ) : (
                  // Spinner/label are per-platform; disabled is global so two OAuths can't race.
                  (() => {
                    const isXeroConnecting = oauthInProgress === 'new-xero';
                    return (
                      <Button onClick={() => { setSelectedPlatform('xero'); initiateXeroOAuth(undefined, false); }} disabled={isInitiatingOAuth} size="sm" className="dp-btn-primary w-full">
                        {isXeroConnecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                        {isXeroConnecting ? 'Connecting...' : hasXeroIntegration ? 'Connect my Xero account' : 'Connect to Xero'}
                      </Button>
                    );
                  })()
                )}
              </div>

              {xeroIntegrations.length > 0 && (
                <div className="dp-card-footer">
                  <p className="dp-footer-label">Active Connections</p>
                  <div className="space-y-1.5">
                    {xeroIntegrations.map((xero, i) => {
                      const connected = !!xero.is_connected;
                      const tenants = platformOrganizations.filter(o => o.platform_integration_id === xero.id && o.platform_name === 'xero');
                      const actions = connected ? (
                        <>
                          <Button onClick={() => handleXeroSync(xero.id)} variant="ghost" size="icon" disabled={isSyncing !== null || !hasOrganizationMapping} className="dp-icon-btn" title={!hasOrganizationMapping ? 'Map at least one location first' : 'Sync Data'}>
                            <RefreshCw className={cn("w-3 h-3", isSyncing === xero.id && "animate-spin")} />
                          </Button>
                          <Button onClick={() => disconnectPlatform('xero', xero.id)} variant="ghost" size="sm" disabled={isDisconnecting === xero.id} className="dp-disconnect-btn">
                            {isDisconnecting === xero.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
                            {isDisconnecting === xero.id ? '...' : 'Disconnect'}
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button onClick={() => initiateXeroOAuth(xero.id)} disabled={isInitiatingOAuth} size="sm" className="dp-connect-btn">
                            {oauthInProgress === xero.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Link2 className="w-3 h-3" />} Reconnect
                          </Button>
                          <Button onClick={async () => { await deleteConnection(xero.id); const { data } = await (supabase as any).from('platform_integrations').select('*').eq('organization_id', currentOrgId).eq('platform_name', 'xero').order('created_at', { ascending: false }); setXeroIntegrations(data || []); }} variant="ghost" size="icon" className="dp-icon-btn dp-icon-btn--danger" title="Delete"><Trash2 className="w-3 h-3" /></Button>
                        </>
                      );

                      // Every Xero organisation (tenant) renders as its OWN row —
                      // they are separate businesses to the user even though one
                      // Xero login carries them all on a single token. Sync runs
                      // per connection (covers every organisation); Disconnect
                      // asks for confirmation because it disconnects all of them.
                      if (tenants.length === 0) {
                        // OAuth never completed for this row — keep the old
                        // single-row rendering with Reconnect/Delete actions.
                        return renderConnectionRow(
                          `Xero Account ${i + 1}`,
                          `Created ${new Date(xero.created_at).toLocaleDateString()}`,
                          connected,
                          actions,
                          xero.id
                        );
                      }

                      const orgNames = tenants.map(t => t.platform_org_name || t.platform_org_id);
                      const tenantActions = (t: PlatformIntegrationOrganization) => connected ? (
                        <>
                          <Button onClick={() => handleXeroSync(xero.id)} variant="ghost" size="icon" disabled={isSyncing !== null || !hasOrganizationMapping} className="dp-icon-btn" title={!hasOrganizationMapping ? 'Map at least one location first' : 'Sync Data'}>
                            <RefreshCw className={cn("w-3 h-3", isSyncing === xero.id && "animate-spin")} />
                          </Button>
                          <Button
                            onClick={() => setXeroRemoveTarget(t)}
                            variant="ghost"
                            size="icon"
                            disabled={isRemovingTenant || tenants.length === 1}
                            className="dp-icon-btn dp-icon-btn--danger"
                            title={tenants.length === 1
                              ? 'This is the only organisation — use Disconnect instead'
                              : 'Remove only this organisation (the others keep syncing)'}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                          <Button onClick={() => setXeroDisconnectTarget({ connectionId: xero.id, orgNames })} variant="ghost" size="sm" disabled={isDisconnecting === xero.id} className="dp-disconnect-btn">
                            {isDisconnecting === xero.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
                            {isDisconnecting === xero.id ? '...' : 'Disconnect'}
                          </Button>
                        </>
                      ) : actions;

                      return (
                        <div key={xero.id} className="space-y-1.5">
                          {tenants.map((t) => {
                            const mappedLocId = mappingData[t.id]
                              || Object.entries(locationOrganizationMap).find(([, orgId]) => orgId === t.id)?.[0];
                            const mappedLoc = mappedLocId ? locations.find(l => l.id === mappedLocId) : undefined;
                            const tracking = mappedLocId ? locationTrackingMap[mappedLocId] : undefined;
                            const trackingLabel = tracking?.optionName
                              ? [tracking.categoryName, tracking.optionName].filter(Boolean).join(' · ')
                              : tracking?.categoryName || '';
                            const subtitle = mappedLoc
                              ? (trackingLabel
                                ? `Location: ${mappedLoc.location_name} · ${trackingLabel}`
                                : `Location: ${mappedLoc.location_name}`)
                              : 'Not linked to a practice location yet';
                            return renderConnectionRow(
                              t.platform_org_name || t.platform_org_id,
                              subtitle,
                              connected,
                              tenantActions(t),
                              `${xero.id}-${t.id}`
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* ── QuickBooks Card ── */}
        {(() => {
          const platform = accountingPlatforms.quickbooks;

          return (
            <div className={cn("dp-platform-card", isQuickbooksConnected && "dp-platform-card--connected")} style={{ '--card-i': 2 } as React.CSSProperties}>
              <div className="dp-card-header">
                <div className="dp-logo-ring dp-logo-ring--qb">
                  <PlatformLogo platform={platform} className="w-11 h-11 object-contain" />
                </div>
                <span className="text-base font-bold text-foreground mt-3">{platform.name}</span>
                <div className="mt-2">{renderStatusBadge(isQuickbooksConnected, hasQuickbooksCredentials)}</div>
              </div>

              <div className="dp-card-actions">
                {isLoading ? (
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground mx-auto" />
                ) : (
                  // Persistent connect button (mirrors Xero/Sage). QuickBooks uses
                  // app-level env credentials, so connecting goes straight to the
                  // Intuit login — no "Add Credentials" screen. The button stays
                  // visible after connecting so more companies can be added.
                  // Spinner/label are per-platform; disabled is global so two OAuths can't race.
                  (() => {
                    const isQbConnecting = oauthInProgress === 'new-quickbooks';
                    return (
                      <Button onClick={() => { setSelectedPlatform('quickbooks'); initiateQuickBooksOAuth(); }} disabled={isInitiatingOAuth} size="sm" className="dp-btn-primary w-full">
                        {isQbConnecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                        {isQbConnecting ? 'Connecting...' : isQuickbooksConnected ? 'Connect my QuickBooks account' : 'Connect to QuickBooks'}
                      </Button>
                    );
                  })()
                )}
              </div>

              {quickbooksIntegrations.length > 0 && (
                <div className="dp-card-footer">
                  <p className="dp-footer-label">Active Connections</p>
                  <div className="space-y-1.5">
                    {quickbooksIntegrations.map((qb, i) => {
                      const connected = !!qb.is_connected;
                      const companies = platformOrganizations.filter(o => o.platform_integration_id === qb.id && o.platform_name === 'quickbooks');
                      const actions = connected ? (
                        <>
                          <Button onClick={() => handleQuickBooksSync(qb.id)} variant="ghost" size="icon" disabled={isSyncing !== null} className="dp-icon-btn" title="Sync Data">
                            <RefreshCw className={cn("w-3 h-3", isSyncing === qb.id && "animate-spin")} />
                          </Button>
                          <Button onClick={() => disconnectPlatform('quickbooks', qb.id)} variant="ghost" size="sm" disabled={isDisconnecting === qb.id} className="dp-disconnect-btn">
                            {isDisconnecting === qb.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
                            {isDisconnecting === qb.id ? '...' : 'Disconnect'}
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button onClick={() => initiateQuickBooksOAuth(qb.id)} disabled={isInitiatingOAuth} size="sm" className="dp-connect-btn">
                            {oauthInProgress === qb.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Link2 className="w-3 h-3" />} Reconnect
                          </Button>
                          <Button onClick={async () => { await deleteConnection(qb.id); const { data } = await (supabase as any).from('platform_integrations').select('*').eq('organization_id', currentOrgId).eq('platform_name', 'quickbooks').order('created_at', { ascending: false }); setQuickbooksIntegrations(data || []); }} variant="ghost" size="icon" className="dp-icon-btn dp-icon-btn--danger" title="Delete"><Trash2 className="w-3 h-3" /></Button>
                        </>
                      );

                      // One row per QuickBooks connection: company name + company count
                      const displayName = companies.length > 0
                        ? (companies[0].platform_org_name || companies[0].platform_org_id)
                        : `QuickBooks Account ${i + 1}`;
                      const subtitle = companies.length > 1
                        ? `${companies.length} organizations`
                        : companies.length === 1
                          ? '1 organization'
                          : `Created ${new Date(qb.created_at).toLocaleDateString()}`;
                      return renderConnectionRow(displayName, subtitle, connected, actions, qb.id);
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* ── Sage Card (Phase 1 — OAuth only) ── */}
        {(() => {
          const platform = accountingPlatforms.sage;

          return (
            <div ref={sageCardRef} className={cn("dp-platform-card", isSageConnected && "dp-platform-card--connected", sageCardHighlight && "dp-platform-card--highlight")} style={{ '--card-i': 3 } as React.CSSProperties}>
              <div className="dp-card-header">
                <div className="dp-logo-ring" style={{ background: 'linear-gradient(135deg,#16a34a,#065f46)', color: '#fff' }}>
                  <span className="text-lg font-bold tracking-wide">Sage</span>
                </div>
                <span className="text-base font-bold text-foreground mt-3">{platform.name}</span>
                <div className="mt-2">{renderStatusBadge(isSageConnected, false)}</div>
              </div>

              <div className="dp-card-actions">
                {(() => {
                  // Persistent connect button (Xero/QB parity): stays visible after
                  // connecting so more separate Sage accounts can be added.
                  const isSageConnectingNew = oauthInProgress === 'new-sage' || isSageConnecting;
                  return (
                    <Button onClick={() => connectSage(undefined)} disabled={isSageConnecting} size="sm" className="dp-btn-primary w-full">
                      {isSageConnectingNew ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                      {isSageConnectingNew ? 'Connecting…' : hasSageIntegration ? 'Connect my Sage account' : 'Connect to Sage'}
                    </Button>
                  );
                })()}
              </div>

              {sageIntegrations.length > 0 && (
                <div className="dp-card-footer">
                  <p className="dp-footer-label">Active Connections</p>
                  <div className="space-y-1.5">
                    {sageIntegrations.map((sage, i) => {
                      const connected = !!sage.is_connected;
                      const businesses = platformOrganizations.filter(o => o.platform_integration_id === sage.id && o.platform_name === 'sage');
                      const actions = connected ? (
                        <>
                          <Button onClick={() => syncSageData(sage.id)} variant="ghost" size="icon" disabled={sageSyncingId !== null} className="dp-icon-btn" title="Sync Data">
                            <RefreshCw className={cn("w-3 h-3", sageSyncingId === sage.id && "animate-spin")} />
                          </Button>
                          <Button onClick={() => disconnectSage(sage.id)} variant="ghost" size="sm" disabled={sageDisconnectingId === sage.id} className="dp-disconnect-btn">
                            {sageDisconnectingId === sage.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
                            {sageDisconnectingId === sage.id ? '...' : 'Disconnect'}
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button onClick={() => connectSage(sage.id)} disabled={isSageConnecting} size="sm" className="dp-connect-btn">
                            {oauthInProgress === sage.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Link2 className="w-3 h-3" />} Reconnect
                          </Button>
                          <Button onClick={async () => { await deleteConnection(sage.id); await fetchSageIntegrations(); }} variant="ghost" size="icon" className="dp-icon-btn dp-icon-btn--danger" title="Delete"><Trash2 className="w-3 h-3" /></Button>
                        </>
                      );

                      // One row per Sage connection: first business name + business count
                      const displayName = businesses.length > 0
                        ? (businesses[0].platform_org_name || businesses[0].platform_org_id)
                        : `Sage Account ${i + 1}`;
                      const subtitle = businesses.length > 1
                        ? `${businesses.length} businesses`
                        : businesses.length === 1
                          ? '1 business'
                          : `Created ${new Date(sage.created_at).toLocaleDateString()}`;
                      return renderConnectionRow(displayName, subtitle, connected, actions, sage.id);
                    })}
                  </div>

                  {sageSyncLabel && sageSyncingId && (
                    <p className="text-[10px] text-muted-foreground mt-2 flex items-center gap-1.5">
                      <Loader2 className="w-3 h-3 animate-spin" /> {sageSyncLabel}
                    </p>
                  )}
                  {lastSageSyncAt && isSageConnected && (() => {
                    const diffMin = Math.floor((Date.now() - new Date(lastSageSyncAt).getTime()) / 60000);
                    const label =
                      diffMin < 1   ? 'just now' :
                      diffMin < 60  ? `${diffMin} min ago` :
                      diffMin < 1440 ? `${Math.floor(diffMin / 60)}h ago` :
                                      new Date(lastSageSyncAt).toLocaleDateString();
                    return (
                      <p className="text-[10px] text-muted-foreground mt-1">
                        Last synced: <span className="text-foreground font-medium">{label}</span>
                        {lastSageSyncResult && (
                          <span className="ml-1.5 text-emerald-600 font-medium">
                            · {lastSageSyncResult.suppliers}S / {lastSageSyncResult.coa}C / {lastSageSyncResult.taxRates ?? 0}T / {lastSageSyncResult.paymentMethods ?? 0}PM / {lastSageSyncResult.products ?? 0}P / {lastSageSyncResult.invoices}I / {lastSageSyncResult.creditNotes ?? 0}CN / {lastSageSyncResult.journals ?? 0}J / {lastSageSyncResult.bankAccounts ?? 0}BA / {lastSageSyncResult.bankTransactions ?? 0}BT / {lastSageSyncResult.otherPayments ?? 0}OP / {lastSageSyncResult.otherReceipts ?? 0}OR / {lastSageSyncResult.bankTransfers ?? 0}BTr / {lastSageSyncResult.attachments ?? 0}A
                          </span>
                        )}
                      </p>
                    );
                  })()}
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {/* ── Dental Pulse Design System Styles ── */}
      <style>{`
        /* ── Card entrance ── */
        @keyframes dpCardIn {
          from { opacity: 0; transform: translateY(20px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        .dp-platform-card {
          display: flex; flex-direction: column;
          border-radius: 16px;
          border: 1px solid hsl(var(--border));
          background: hsl(var(--card));
          overflow: hidden;
          animation: dpCardIn 0.5s cubic-bezier(0.22,1,0.36,1) both;
          animation-delay: calc(var(--card-i, 0) * 100ms);
          transition: transform 0.3s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.3s ease, border-color 0.3s ease;
        }
        .dp-platform-card:hover {
          transform: translateY(-4px);
          box-shadow: 0 12px 32px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.04);
        }
        .dp-platform-card--connected {
          border-color: #10b98140;
          box-shadow: 0 0 0 1px #10b98115;
        }
        .dp-platform-card--connected:hover {
          box-shadow: 0 12px 32px rgba(16,185,129,0.1), 0 0 0 1px #10b98130;
        }
        @keyframes dpSageHighlight {
          0%   { box-shadow: 0 0 0 0 rgba(22,163,74,0.6); }
          50%  { box-shadow: 0 0 0 12px rgba(22,163,74,0); }
          100% { box-shadow: 0 0 0 0 rgba(22,163,74,0); }
        }
        .dp-platform-card--highlight {
          animation: dpSageHighlight 1s ease-out 2;
        }

        /* ── Card sections ── */
        .dp-card-header { display: flex; flex-direction: column; align-items: center; padding: 28px 20px 16px; position: relative; }
        .dp-card-actions { display: flex; flex-direction: column; gap: 8px; padding: 0 20px 20px; }
        .dp-card-footer {
          border-top: 1px solid hsl(var(--border));
          background: linear-gradient(180deg, hsl(var(--muted) / 0.25) 0%, hsl(var(--muted) / 0.08) 100%);
          padding: 14px 16px;
        }

        /* ── Logo rings ── */
        .dp-logo-ring {
          width: 64px; height: 64px; border-radius: 18px;
          display: flex; align-items: center; justify-content: center;
          background: white;
          box-shadow: 0 4px 12px rgba(0,0,0,0.06);
          transition: transform 0.3s ease;
        }
        .dp-platform-card:hover .dp-logo-ring { transform: scale(1.05); }
        .dp-logo-ring--iplicit { border: 2px solid #4f46e520; }
        .dp-logo-ring--xero    { border: 2px solid #13B5EA25; }
        .dp-logo-ring--qb      { border: 2px solid #2CA01C25; }

        /* ── Status badges ── */
        .dp-status-badge {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 4px 14px; border-radius: 20px;
          font-size: 12px; font-weight: 600; line-height: 1;
        }
        .dp-status-badge--connected { background: #ecfdf5; color: #059669; border: 1px solid #a7f3d0; }
        .dp-status-badge--pending   { background: #fffbeb; color: #d97706; border: 1px solid #fde68a; }
        .dp-status-badge--idle      { background: hsl(var(--muted)); color: hsl(var(--muted-foreground)); border: 1px solid hsl(var(--border)); }

        .dp-pulse-dot {
          width: 7px; height: 7px; border-radius: 50%;
          background: #10b981;
          box-shadow: 0 0 0 0 rgba(16,185,129,0.5);
          animation: dpPulse 2s ease-in-out infinite;
        }
        @keyframes dpPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(16,185,129,0.5); }
          50%      { box-shadow: 0 0 0 5px rgba(16,185,129,0); }
        }

        /* ── Section header ── */
        .dp-section-icon {
          width: 40px; height: 40px; border-radius: 12px;
          background: linear-gradient(135deg, #0d9488, #14b8a6);
          display: flex; align-items: center; justify-content: center;
          box-shadow: 0 4px 12px rgba(13,148,136,0.25);
        }
        .dp-active-pill {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 5px 14px; border-radius: 20px;
          font-size: 12px; font-weight: 600;
          background: #ecfdf5; color: #059669;
          border: 1px solid #a7f3d0;
        }

        /* ── Connection rows ── */
        .dp-conn-row {
          display: flex; flex-direction: column; gap: 8px;
          padding: 10px; border-radius: 10px;
          background: hsl(var(--card));
          border: 1px solid hsl(var(--border) / 0.5);
          transition: background 0.15s ease;
        }
        .dp-conn-row:hover { background: hsl(var(--muted) / 0.3); }
        .dp-conn-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
        .dp-conn-dot--on  { background: #10b981; box-shadow: 0 0 6px rgba(16,185,129,0.4); }
        .dp-conn-dot--off { background: #d1d5db; }
        .dp-conn-actions {
          display: flex; align-items: center; justify-content: flex-end;
          gap: 4px; flex-wrap: wrap;
        }

        .dp-footer-label {
          font-size: 10px; font-weight: 700; letter-spacing: 0.08em;
          text-transform: uppercase; color: hsl(var(--muted-foreground));
          margin-bottom: 8px; padding-left: 2px;
        }

        /* ── Button variants ── */
        .dp-btn-primary {
          background: linear-gradient(135deg, #0d9488, #0f766e) !important;
          color: white !important; border: none !important;
          font-weight: 600; gap: 6px; border-radius: 10px;
          box-shadow: 0 2px 8px rgba(13,148,136,0.25);
          transition: all 0.2s ease;
        }
        .dp-btn-primary:hover:not(:disabled) {
          box-shadow: 0 4px 14px rgba(13,148,136,0.35);
          transform: translateY(-1px);
        }
        .dp-btn-action {
          gap: 6px; border-radius: 10px; font-weight: 500;
        }

        .dp-icon-btn {
          height: 28px; width: 28px; border-radius: 8px;
          color: hsl(var(--muted-foreground));
          transition: all 0.15s ease;
        }
        .dp-icon-btn:hover { background: hsl(var(--muted)); color: hsl(var(--foreground)); }
        .dp-icon-btn--danger { color: #ef4444; }
        .dp-icon-btn--danger:hover { background: #fef2f2; color: #dc2626; }

        .dp-disconnect-btn {
          gap: 4px; height: 28px; padding: 0 10px;
          font-size: 12px; font-weight: 500; border-radius: 8px;
          color: #ef4444 !important;
        }
        .dp-disconnect-btn:hover { background: #fef2f2 !important; }

        .dp-connect-btn {
          gap: 4px; height: 28px; padding: 0 10px;
          font-size: 12px; font-weight: 600; border-radius: 8px;
          background: linear-gradient(135deg, #0d9488, #0f766e) !important;
          color: white !important; border: none;
        }

        /* ── Mapping section styles ── */
        @keyframes mappingRowSlide {
          from { opacity: 0; transform: translateX(-12px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        .mapping-row {
          animation: mappingRowSlide 0.4s cubic-bezier(0.22,1,0.36,1) both;
          animation-delay: var(--row-delay, 0ms);
        }
        @keyframes arrowPulse {
          0%, 100% { opacity: 0.6; }
          50% { opacity: 1; }
        }
        .mapping-arrow-active { animation: arrowPulse 2s ease-in-out infinite; }
        @keyframes shimmerBorder {
          0% { border-color: hsl(var(--border)); }
          50% { border-color: #22c55e; }
          100% { border-color: hsl(var(--border)); }
        }
        .mapping-card-complete { animation: shimmerBorder 3s ease-in-out 1; }
        @keyframes successGlow {
          0% { box-shadow: 0 0 0 0 rgba(34,197,94,0.4); }
          70% { box-shadow: 0 0 0 8px rgba(34,197,94,0); }
          100% { box-shadow: 0 0 0 0 rgba(34,197,94,0); }
        }
        .mapping-summary-complete { animation: successGlow 1.5s ease-out 1; }
        @keyframes logoBounce {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.15); }
        }
        .mapping-logo {
          animation: logoBounce 0.5s cubic-bezier(0.34,1.56,0.64,1) both;
          animation-delay: var(--row-delay, 0ms);
        }

        /* ── Mapping Section ── */
        .dp-mapping-card {
          border-radius: 16px; overflow: hidden;
          border: 1px solid hsl(var(--border));
          background: hsl(var(--card));
          box-shadow: 0 1px 3px rgba(0,0,0,0.04);
          transition: border-color 0.4s ease, box-shadow 0.4s ease;
        }
        .dp-mapping-card--complete {
          border-color: #10b98130;
          box-shadow: 0 0 0 1px #10b98110, 0 2px 12px rgba(16,185,129,0.06);
        }
        .dp-mapping-header {
          display: flex; align-items: center; justify-content: space-between; gap: 16px;
          padding: 20px 24px;
          background: linear-gradient(135deg, rgba(13,148,136,0.04) 0%, rgba(20,184,166,0.02) 100%);
          border-bottom: 1px solid hsl(var(--border));
        }
        .dp-mapping-icon {
          width: 40px; height: 40px; border-radius: 12px;
          background: linear-gradient(135deg, #0d9488, #14b8a6);
          display: flex; align-items: center; justify-content: center;
          box-shadow: 0 3px 10px rgba(13,148,136,0.2);
          flex-shrink: 0;
        }

        /* Progress ring */
        .dp-progress-ring {
          position: relative; width: 40px; height: 40px;
        }
        .dp-progress-ring svg { transform: rotate(-90deg); }
        .dp-progress-ring circle { pathLength: 100; }
        .dp-progress-text {
          position: absolute; inset: 0;
          display: flex; align-items: center; justify-content: center;
          font-size: 9px; font-weight: 700; letter-spacing: -0.02em;
        }

        /* Chips bar */
        .dp-mapping-chips {
          display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
          padding: 10px 24px;
          border-bottom: 1px solid hsl(var(--border));
          background: hsl(var(--muted) / 0.15);
        }
        .dp-chip {
          display: inline-flex; align-items: center; gap: 5px;
          padding: 3px 12px; border-radius: 20px;
          font-size: 11px; font-weight: 600;
          border: 1px solid color-mix(in srgb, var(--chip-color) 25%, transparent);
          background: color-mix(in srgb, var(--chip-color) 6%, transparent);
          color: var(--chip-color);
        }
        .dp-chip--warn {
          --chip-color: #d97706;
          border-color: #fde68a; background: #fffbeb; color: #b45309;
        }

        /* Mapping rows */
        .dp-mapping-rows { padding: 4px 0; }
        .dp-map-row {
          display: grid;
          grid-template-columns: 1fr auto 1fr;
          align-items: center;
          gap: 12px;
          padding: 12px 24px;
          transition: background 0.15s ease;
          position: relative;
        }
        .dp-map-row:not(:last-child) { border-bottom: 1px solid hsl(var(--border) / 0.5); }
        .dp-map-row--mapped:hover { background: hsl(var(--muted) / 0.2); }
        .dp-map-row--empty { background: linear-gradient(90deg, rgba(245,158,11,0.03) 0%, transparent 60%); }
        .dp-map-row--empty:hover { background: linear-gradient(90deg, rgba(245,158,11,0.06) 0%, transparent 60%); }

        /* Left accent bar on mapped rows */
        .dp-map-row--mapped::before {
          content: ''; position: absolute; left: 0; top: 8px; bottom: 8px;
          width: 3px; border-radius: 0 4px 4px 0;
          background: var(--row-accent, #0d9488);
          opacity: 0.45;
        }

        .dp-map-location { display: flex; align-items: center; gap: 10px; min-width: 0; }

        .dp-map-status {
          width: 28px; height: 28px; border-radius: 9px;
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0; transition: transform 0.2s ease;
        }
        .dp-map-row:hover .dp-map-status { transform: scale(1.1); }
        .dp-map-status--ok { background: #ecfdf5; color: #059669; box-shadow: 0 1px 4px rgba(16,185,129,0.15); }
        .dp-map-status--pending { background: #fffbeb; color: #d97706; }

        .dp-map-connector { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
        .dp-connector-line {
          width: 32px; height: 1.5px; border-radius: 1px;
          background: linear-gradient(90deg, transparent, #e5e7eb);
          transition: all 0.3s ease;
        }
        .dp-connector-line--active {
          background: linear-gradient(90deg, transparent, var(--row-accent, #0d9488));
          animation: arrowPulse 2.5s ease-in-out infinite;
        }

        .dp-map-entity {
          display: flex; align-items: center; gap: 8px;
          min-width: 0;
          padding: 6px 12px; border-radius: 10px;
          border: 1px solid color-mix(in srgb, var(--entity-accent, #0d9488) 20%, transparent);
          background: color-mix(in srgb, var(--entity-accent, #0d9488) 4%, hsl(var(--card)));
          transition: border-color 0.15s ease, background 0.15s ease;
        }
        .dp-map-row:hover .dp-map-entity {
          border-color: color-mix(in srgb, var(--entity-accent, #0d9488) 35%, transparent);
          background: color-mix(in srgb, var(--entity-accent, #0d9488) 7%, hsl(var(--card)));
        }

        .dp-map-empty-btn {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 6px 16px; border-radius: 10px;
          border: 1.5px dashed #fbbf24;
          background: rgba(251,191,36,0.05);
          font-size: 13px; font-weight: 600; color: #b45309;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .dp-map-empty-btn:hover {
          background: rgba(251,191,36,0.1);
          border-color: #f59e0b;
          color: #92400e;
          transform: translateX(2px);
        }
      `}</style>

      {/* Organization & Location Mapping — Always visible when any platform is connected */}
      {hasAnyPlatformConnected && (() => {
        const mappedLocationIds = new Set<string>();
        const platformSummary: Record<string, { count: number; logo: string }> = {};
        platformOrganizations.forEach(org => {
          const locId = mappingData[org.id];
          if (locId) {
            mappedLocationIds.add(locId);
            const pName = org.platform_name || 'other';
            if (!platformSummary[pName]) {
              platformSummary[pName] = { count: 0, logo: INTEGRATION_LOGOS[pName as keyof typeof INTEGRATION_LOGOS] || '' };
            }
            platformSummary[pName].count += 1;
          }
        });
        const mappedCount = mappedLocationIds.size;
        const totalLocations = locations.length;
        const allMapped = totalLocations > 0 && mappedCount === totalLocations;
        const progressPct = totalLocations > 0 ? Math.round((mappedCount / totalLocations) * 100) : 0;
        const pColors: Record<string, string> = { iplicit: '#0d9488', xero: '#0891b2', quickbooks: '#059669' };

        return (
          <div className={cn("dp-mapping-card", allMapped && "dp-mapping-card--complete")}>
            {/* Header */}
            <div className="dp-mapping-header">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="dp-mapping-icon">
                  <Building2 className="w-5 h-5 text-white" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold text-[15px] text-foreground leading-tight">Practice Location Mapping</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">Link each dental practice to its accounting entity</p>
                </div>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                {/* Progress ring */}
                {totalLocations > 0 && (
                  <div className="dp-progress-ring" title={`${mappedCount} of ${totalLocations} mapped`}>
                    <svg width="40" height="40" viewBox="0 0 40 40">
                      <circle cx="20" cy="20" r="16" fill="none" stroke="hsl(var(--border))" strokeWidth="3" />
                      <circle cx="20" cy="20" r="16" fill="none" strokeWidth="3" strokeLinecap="round"
                        stroke={allMapped ? '#10b981' : '#0d9488'}
                        strokeDasharray={`${progressPct} ${100 - progressPct}`}
                        strokeDashoffset="25"
                        style={{ transition: 'stroke-dasharray 0.7s ease' }}
                      />
                    </svg>
                    <span className={cn("dp-progress-text", allMapped ? "text-emerald-600" : "text-teal-600")}>
                      {mappedCount}/{totalLocations}
                    </span>
                  </div>
                )}
                <Button onClick={() => setIsMappingDialogOpen(true)} size="sm" className="dp-btn-primary gap-2">
                  <Settings2 className="w-4 h-4" /> Configure
                </Button>
              </div>
            </div>

            {/* Platform chips bar */}
            {(Object.keys(platformSummary).length > 0 || totalLocations - mappedCount > 0) && (
              <div className="dp-mapping-chips">
                {Object.entries(platformSummary).map(([pName, info]) => (
                  <span key={pName} className="dp-chip" style={{ '--chip-color': pColors[pName] || '#0d9488' } as React.CSSProperties}>
                    {info.logo && <img src={info.logo} alt={pName} className="w-3.5 h-3.5 object-contain" />}
                    {info.count} {pName}
                  </span>
                ))}
                {totalLocations - mappedCount > 0 && (
                  <span className="dp-chip dp-chip--warn">
                    <AlertCircle className="w-3 h-3" /> {totalLocations - mappedCount} unmapped
                  </span>
                )}
              </div>
            )}

            {/* Mapping rows */}
            {totalLocations > 0 && (
              <div className="dp-mapping-rows">
                {locations.map((loc, i) => {
                  const mappedOrgId =
                    locationOrganizationMap[loc.id] ||
                    Object.entries(mappingData).find(([, lid]) => lid === loc.id)?.[0] ||
                    '';
                  const mappedOrg = mappedOrgId
                    ? platformOrganizations.find(org => org.id === mappedOrgId)
                    : undefined;
                  const tracking = locationTrackingMap[loc.id];
                  const trackingLabel = tracking?.optionName
                    ? [tracking.categoryName, tracking.optionName].filter(Boolean).join(' · ')
                    : tracking?.categoryName || '';
                  const pName = mappedOrg?.platform_name || '';
                  const logoSrc = pName ? INTEGRATION_LOGOS[pName as keyof typeof INTEGRATION_LOGOS] : '';
                  const iplicitConns = connections.filter(c => c.platform === 'iplicit');
                  const mappedIplicitConn = (pName === 'iplicit' && iplicitConns.length > 1 && mappedOrg)
                    ? iplicitConns.find(c => c.id === mappedOrg.platform_integration_id) : null;
                  const mappedDomain = mappedIplicitConn
                    ? (mappedIplicitConn.iplicit_username ? `${mappedIplicitConn.iplicit_domain} · ${mappedIplicitConn.iplicit_username}` : mappedIplicitConn.iplicit_domain) : null;
                  const accent = pColors[pName] || '#0d9488';

                  return (
                    <div
                      key={loc.id}
                      style={{ '--row-delay': `${i * 60}ms`, '--row-accent': accent } as React.CSSProperties}
                      className={cn("dp-map-row mapping-row", mappedOrg ? "dp-map-row--mapped" : "dp-map-row--empty")}
                    >
                      {/* Left: location */}
                      <div className="dp-map-location">
                        <div className={cn("dp-map-status", mappedOrg ? "dp-map-status--ok" : "dp-map-status--pending")}>
                          {mappedOrg ? <Check className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                        </div>
                        <span className="text-[13px] font-semibold text-foreground truncate">{loc.location_name}</span>
                      </div>

                      {/* Center: connector */}
                      <div className="dp-map-connector">
                        <div className={cn("dp-connector-line", mappedOrg && "dp-connector-line--active")} />
                        <svg width="10" height="10" viewBox="0 0 10 10" className="flex-shrink-0">
                          <path d="M2 2L8 5L2 8" fill="none" stroke={mappedOrg ? accent : '#d1d5db'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </div>

                      {/* Right: mapped org or action */}
                      {mappedOrg ? (
                        <div className="dp-map-entity" style={{ '--entity-accent': accent } as React.CSSProperties}>
                          {logoSrc && <img src={logoSrc} alt={pName} className="w-5 h-5 object-contain flex-shrink-0 mapping-logo" style={{ '--row-delay': `${i * 60 + 150}ms` } as React.CSSProperties} />}
                          <div className="min-w-0">
                            <span className="text-[13px] font-medium truncate block" style={{ color: accent }}>
                              {mappedOrg.platform_org_name || mappedOrg.platform_org_id}
                            </span>
                            {trackingLabel && (
                              <span className="text-[10px] text-muted-foreground block truncate">
                                Tracking: {trackingLabel}
                              </span>
                            )}
                            {mappedDomain && <span className="text-[10px] text-muted-foreground block truncate">{mappedDomain}</span>}
                          </div>
                        </div>
                      ) : (
                        <button onClick={() => setIsMappingDialogOpen(true)} className="dp-map-empty-btn">
                          <Plus className="w-3.5 h-3.5" /> Assign
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}

      {/* Xero disconnect confirmation — the listed organisations share one Xero
          login/token, so a disconnect stops syncing for every one of them. */}
      <Dialog open={!!xeroDisconnectTarget} onOpenChange={(open) => { if (!open) setXeroDisconnectTarget(null); }}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-[15px] font-bold">Disconnect Xero account?</DialogTitle>
            <DialogDescription className="text-xs">
              These organisations are connected through the same Xero login, so disconnecting stops syncing for all of them:
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-1.5 py-1">
            {(xeroDisconnectTarget?.orgNames || []).map((name) => (
              <li key={name} className="flex items-center gap-2 text-sm text-foreground">
                <span className="dp-conn-dot dp-conn-dot--on" /> {name}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Your synced data, chart of accounts mapping and category setup are kept, so reconnecting later resumes syncing without re-mapping.
          </p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setXeroDisconnectTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                const target = xeroDisconnectTarget;
                setXeroDisconnectTarget(null);
                if (target) disconnectPlatform('xero', target.connectionId);
              }}
            >
              Disconnect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove ONE Xero organisation — the rest of the account keeps syncing */}
      <Dialog open={!!xeroRemoveTarget} onOpenChange={(open) => { if (!open && !isRemovingTenant) setXeroRemoveTarget(null); }}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-[15px] font-bold">
              Remove {xeroRemoveTarget?.platform_org_name || 'this organisation'}?
            </DialogTitle>
            <DialogDescription className="text-xs">
              Only this organisation is removed — the other organisations on your Xero account keep syncing as normal.
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-1.5 py-1 text-xs text-muted-foreground list-disc pl-4">
            <li>It stops syncing and disappears from this list.</li>
            {xeroRemoveTarget && mappingData[xeroRemoveTarget.id] && (
              <li>
                Its link to the practice location{' '}
                <span className="font-medium text-foreground">
                  {locations.find(l => l.id === mappingData[xeroRemoveTarget.id])?.location_name || ''}
                </span>{' '}
                is removed, so that location will show as unmapped.
              </li>
            )}
            <li>Data already synced into DentPulse is kept.</li>
            <li>To add it back later, click "Connect my Xero account" and sign in with the same Xero login.</li>
          </ul>
          <DialogFooter>
            <Button variant="outline" size="sm" disabled={isRemovingTenant} onClick={() => setXeroRemoveTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={isRemovingTenant}
              onClick={() => { if (xeroRemoveTarget) removeXeroOrganisation(xeroRemoveTarget); }}
            >
              {isRemovingTenant ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Remove organisation'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unified Organization & Location Mapping Dialog */}
      <Dialog open={isMappingDialogOpen} onOpenChange={setIsMappingDialogOpen}>
        <DialogContent className="sm:max-w-5xl max-h-[85vh] overflow-y-auto [&>button.absolute]:hidden rounded-2xl">
          <DialogHeader className="pb-0 border-0">
            <div className="flex items-center justify-between gap-4 px-1 py-2" style={{ background: 'linear-gradient(135deg, rgba(13,148,136,0.04) 0%, rgba(20,184,166,0.02) 100%)', borderRadius: '12px', padding: '16px 20px' }}>
              <div className="flex items-center gap-3">
                <div className="dp-mapping-icon">
                  <Building2 className="w-5 h-5 text-white" />
                </div>
                <div>
                  <DialogTitle className="text-[15px] font-bold">
                    Practice Location Mapping
                  </DialogTitle>
                  <DialogDescription className="text-xs mt-0.5">
                    Link each dental practice to its accounting entity
                  </DialogDescription>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  onClick={() => {
                    hasFetchedRef.current = {};
                    refetchLocations();
                    fetchPlatformOrganizations();
                    toast.info('Refreshing locations and organizations...');
                  }}
                  disabled={isLoadingLocations || isLoadingPlatformOrgs}
                  variant="outline"
                  size="sm"
                  className="gap-1.5 h-8 text-xs rounded-lg"
                >
                  {(isLoadingLocations || isLoadingPlatformOrgs) ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3.5 h-3.5" />
                  )}
                  Refresh
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs rounded-lg"
                  onClick={() => setIsMappingDialogOpen(false)}
                >
                  Close
                </Button>
              </div>
            </div>
          </DialogHeader>

          {(() => {
            // Compute grouped orgs once outside the map
            // For iplicit, group by connection (domain) when multiple iplicit accounts exist
            const iplicitConnections = connections.filter(c => c.platform === 'iplicit');
            const hasMultipleIplicit = iplicitConnections.length > 1;

            // Build a lookup: platform_integration_id → iplicit label (domain + username for uniqueness)
            const integrationLabelMap: Record<string, string> = {};
            iplicitConnections.forEach(conn => {
              if (conn.id && conn.iplicit_domain) {
                const label = conn.iplicit_username
                  ? `${conn.iplicit_domain} (${conn.iplicit_username})`
                  : conn.iplicit_domain;
                integrationLabelMap[conn.id] = label;
              }
            });

            // Build Xero integration labels from first tenant name
            const hasMultipleXero = xeroIntegrations.length > 1;
            xeroIntegrations.forEach((xero, i) => {
              const tenants = platformOrganizations.filter(
                org => org.platform_integration_id === xero.id && org.platform_name === 'xero'
              );
              const firstName = tenants[0]?.platform_org_name;
              const label = firstName || `Xero Account ${i + 1}`;
              integrationLabelMap[xero.id] = label;
            });

            const orgsByPlatform: Record<string, typeof platformOrganizations> = {};
            platformOrganizations.forEach(org => {
              const pName = org.platform_name || 'Other';
              let groupKey: string;
              if (pName === 'iplicit' && hasMultipleIplicit && integrationLabelMap[org.platform_integration_id]) {
                groupKey = `iplicit — ${integrationLabelMap[org.platform_integration_id]}`;
              } else if (pName === 'xero' && hasMultipleXero && integrationLabelMap[org.platform_integration_id]) {
                groupKey = `xero — ${integrationLabelMap[org.platform_integration_id]}`;
              } else {
                groupKey = pName;
              }
              if (!orgsByPlatform[groupKey]) orgsByPlatform[groupKey] = [];
              orgsByPlatform[groupKey].push(org);
            });
            const hasMultiplePlatforms = Object.keys(orgsByPlatform).length > 1;

            // Platform colors for visual distinction
            const platformColors: Record<string, { bg: string; text: string; border: string }> = {
              iplicit:    { bg: 'bg-slate-50',    text: 'text-slate-700',   border: 'border-slate-200' },
              xero:       { bg: 'bg-sky-50',      text: 'text-sky-700',     border: 'border-sky-200' },
              quickbooks: { bg: 'bg-green-50',    text: 'text-green-700',   border: 'border-green-200' },
            };

            // Count mapped/unmapped for summary
            const mappedLocIds = new Set<string>();
            platformOrganizations.forEach(org => {
              const locId = mappingData[org.id];
              if (locId) mappedLocIds.add(locId);
            });
            // Also count pending (unsaved) selections / explicit unmaps
            Object.entries(locationOrganizationMap).forEach(([locId, orgId]) => {
              if (isMappedOrgId(orgId)) mappedLocIds.add(locId);
              else if (orgId === UNMAPPED_ORG_VALUE) mappedLocIds.delete(locId);
            });

            return (
              <div className="pt-2">
                {isLoadingPlatformOrgs && isLoadingLocations ? (
                  <div className="space-y-3">
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-full" />
                  </div>
                ) : locations.length === 0 && platformOrganizations.length === 0 ? (
                  <div className="py-10 text-center">
                    <Building2 className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      {hasAnyPlatformConnected
                        ? 'No locations or organizations found. Click "Refresh" to load.'
                        : 'Please connect a platform first to load organizations.'}
                    </p>
                  </div>
                ) : locations.length === 0 ? (
                  <div className="py-10 text-center">
                    <Building2 className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      No practice locations found. Please add locations first.
                    </p>
                  </div>
                ) : platformOrganizations.length === 0 ? (
                  <div className="py-10 text-center">
                    <Building2 className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      {hasAnyPlatformConnected
                        ? 'No organizations found. Click "Refresh" to load organizations.'
                        : 'Please connect a platform to load organizations.'}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Status bar */}
                    <div className="flex items-center justify-between px-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Locations</span>
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">{locations.length}</Badge>
                      </div>
                      <div className="flex items-center gap-2">
                        {hasMultiplePlatforms && Object.entries(orgsByPlatform).map(([pName, orgs]) => {
                          const base = pName.includes(' — ') ? pName.split(' — ')[0] : pName;
                          return (
                            <Badge key={pName} variant="outline" className="gap-1 text-[10px] px-1.5 py-0 h-5">
                              <img src={INTEGRATION_LOGOS[base as keyof typeof INTEGRATION_LOGOS]} alt={base} className="w-3 h-3 object-contain" />
                              {orgs.length}
                            </Badge>
                          );
                        })}
                        <Badge className={cn(
                          "text-[10px] px-1.5 py-0 h-5",
                          mappedLocIds.size === locations.length
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-amber-100 text-amber-700"
                        )}>
                          {mappedLocIds.size}/{locations.length} mapped
                        </Badge>
                      </div>
                    </div>

                    {/* Column headers */}
                    <div className="grid grid-cols-[1fr,auto,1.4fr] gap-2 px-1">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Practice Location</span>
                      <span></span>
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Platform Organization + Xero Tracking</span>
                    </div>

                    {/* Mapping rows */}
                    <div className="space-y-2">
                      {locations.map((location) => {
                        const mappedSelection = locationOrganizationMap[location.id] || '';
                        let selectedOrgId = mappedSelection;

                        if (mappedSelection === UNMAPPED_ORG_VALUE) {
                          selectedOrgId = UNMAPPED_ORG_VALUE;
                        } else if (!selectedOrgId) {
                          const mappedOrg = platformOrganizations.find(org =>
                            mappingData[org.id] === location.id
                          );
                          if (mappedOrg) {
                            selectedOrgId = mappedOrg.id;
                          }
                        }

                        const isMapped = isMappedOrgId(selectedOrgId);
                        const selectedOrg = isMapped ? platformOrganizations.find(o => o.id === selectedOrgId) : null;
                        const selectedPlatformName = selectedOrg?.platform_name || '';
                        const isXeroOrg = String(selectedPlatformName).toLowerCase() === 'xero';
                        const colors = platformColors[selectedPlatformName] || { bg: 'bg-muted/30', text: '', border: 'border-border' };
                        const tracking = locationTrackingMap[location.id];
                        const categoriesForOrg = (trackingCatalog?.categories || []).filter(
                          c => c.platform_integration_organizations_id === selectedOrgId,
                        );
                        const optionsForCategory = (trackingCatalog?.options || []).filter(
                          o =>
                            o.platform_integration_organizations_id === selectedOrgId &&
                            (!tracking?.categoryId || o.xero_tracking_category_id === tracking.categoryId),
                        );
                        const excluded = !!(location as any).exclude_from_financial_display;

                        return (
                          <div
                            key={location.id}
                            className={cn(
                              "grid grid-cols-[1fr,auto,1.4fr] gap-2 items-start p-2.5 rounded-lg border transition-colors",
                              isMapped ? `${colors.bg} ${colors.border}` : 'bg-muted/30 border-dashed border-amber-300/60'
                            )}
                          >
                            {/* Location name */}
                            <div className="flex items-center gap-2 min-w-0 pt-1.5">
                              <Building2 className={cn("w-4 h-4 flex-shrink-0", isMapped ? 'text-emerald-500' : 'text-amber-400')} />
                              <div className="min-w-0">
                                <span className="text-sm font-medium truncate block">{location.location_name}</span>
                                {excluded && (
                                  <span className="text-[10px] text-muted-foreground">Hidden from financial display</span>
                                )}
                              </div>
                            </div>

                            {/* Arrow indicator */}
                            <div className={cn("flex-shrink-0 text-xs pt-2", isMapped ? 'text-emerald-400' : 'text-muted-foreground/30')}>
                              →
                            </div>

                            <div className="space-y-2 min-w-0">
                              {/* Organization dropdown — for Xero, tracking options are selectable under each org */}
                              <Select
                                value={
                                  !isMapped
                                    ? UNMAPPED_ORG_VALUE
                                    : isXeroOrg && tracking?.optionId && tracking?.categoryId
                                      ? `${selectedOrgId}__opt__${tracking.categoryId}__${tracking.optionId}`
                                      : selectedOrgId
                                }
                                onValueChange={(value) => {
                                  if (value === UNMAPPED_ORG_VALUE) {
                                    setLocationOrganizationMap(prev => ({
                                      ...prev,
                                      [location.id]: UNMAPPED_ORG_VALUE,
                                    }));
                                    setLocationTrackingMap(prev => {
                                      const next = { ...prev };
                                      delete next[location.id];
                                      return next;
                                    });
                                    return;
                                  }

                                  const optParts = value.includes('__opt__') ? value.split('__opt__') : null;
                                  const orgId = optParts ? optParts[0] : value;
                                  const optionPayload = optParts?.[1]?.split('__') || null;
                                  const categoryId = optionPayload?.[0] || '';
                                  const optionId = optionPayload?.[1] || '';

                                  setLocationOrganizationMap(prev => ({
                                    ...prev,
                                    [location.id]: orgId,
                                  }));

                                  if (categoryId && optionId) {
                                    const cat = (trackingCatalog?.categories || []).find(
                                      c => c.platform_integration_organizations_id === orgId
                                        && c.xero_tracking_category_id === categoryId,
                                    );
                                    const opt = (trackingCatalog?.options || []).find(
                                      o => o.platform_integration_organizations_id === orgId
                                        && o.xero_tracking_option_id === optionId,
                                    );
                                    setLocationTrackingMap(prev => ({
                                      ...prev,
                                      [location.id]: {
                                        categoryId,
                                        optionId,
                                        categoryName: cat?.name || '',
                                        optionName: opt?.name || '',
                                      },
                                    }));
                                  } else {
                                    setLocationTrackingMap(prev => {
                                      const next = { ...prev };
                                      delete next[location.id];
                                      return next;
                                    });
                                  }
                                }}
                              >
                                <SelectTrigger className={cn(
                                  "w-full h-9 text-sm",
                                  !isMapped && "border-amber-300 text-muted-foreground"
                                )}>
                                  <SelectValue placeholder="Select organization..." />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value={UNMAPPED_ORG_VALUE}>
                                    <span className="text-muted-foreground">No organization (unmapped)</span>
                                  </SelectItem>
                                  {Object.entries(orgsByPlatform).map(([platformName, orgs]) => {
                                    const basePlatform = platformName.includes(' — ') ? platformName.split(' — ')[0] : platformName;
                                    return (
                                    <div key={platformName}>
                                      {hasMultiplePlatforms && (
                                        <div className="flex items-center gap-2 px-2 py-1.5 bg-muted/50 border-b border-t first:border-t-0">
                                          <img
                                            src={INTEGRATION_LOGOS[basePlatform as keyof typeof INTEGRATION_LOGOS]}
                                            alt={basePlatform}
                                            className="w-4 h-4 object-contain"
                                          />
                                          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                            {platformName}
                                          </span>
                                          <Badge variant="secondary" className="text-[9px] px-1 py-0 h-3.5 ml-auto">
                                            {orgs.length}
                                          </Badge>
                                        </div>
                                      )}
                                      {orgs.map((org) => {
                                        const orgName = org.platform_org_name || org.platform_org_id;
                                        const isXero = String(org.platform_name || '').toLowerCase() === 'xero';
                                        const orgOptions = isXero
                                          ? (trackingCatalog?.options || []).filter(
                                              o => o.platform_integration_organizations_id === org.id,
                                            )
                                          : [];
                                        const orgCategories = isXero
                                          ? (trackingCatalog?.categories || []).filter(
                                              c => c.platform_integration_organizations_id === org.id,
                                            )
                                          : [];

                                        // Non-Xero: one org → one location. Xero: same org can map to
                                        // multiple locations via different tracking options.
                                        const isOrgMappedElsewhere =
                                          !isXero
                                          && !!mappingData[org.id]
                                          && mappingData[org.id] !== location.id
                                          && locationOrganizationMap[mappingData[org.id]] === org.id;

                                        const usedOptionIds = new Set(
                                          Object.entries(locationTrackingMap)
                                            .filter(([locId]) => locId !== location.id)
                                            .map(([, t]) => t.optionId)
                                            .filter(Boolean),
                                        );

                                        return (
                                          <div key={org.id}>
                                            <SelectItem
                                              value={org.id}
                                              disabled={!!isOrgMappedElsewhere}
                                              className={cn(isOrgMappedElsewhere && 'opacity-40')}
                                            >
                                              <span className="flex items-center gap-1.5">
                                                {!hasMultiplePlatforms && (
                                                  <img
                                                    src={INTEGRATION_LOGOS[basePlatform as keyof typeof INTEGRATION_LOGOS]}
                                                    alt=""
                                                    className="w-3.5 h-3.5 object-contain flex-shrink-0"
                                                  />
                                                )}
                                                <span>{orgName}</span>
                                                {hasMultiplePlatforms && (
                                                  <span className="text-[10px] text-muted-foreground ml-0.5">({basePlatform})</span>
                                                )}
                                                {orgOptions.length > 0 && (
                                                  <span className="text-[10px] text-muted-foreground ml-1">
                                                    · {orgOptions.length} tracking option{orgOptions.length === 1 ? '' : 's'}
                                                  </span>
                                                )}
                                              </span>
                                            </SelectItem>
                                            {orgOptions.map((opt) => {
                                              const cat = orgCategories.find(
                                                c => c.xero_tracking_category_id === opt.xero_tracking_category_id,
                                              );
                                              const itemValue = `${org.id}__opt__${opt.xero_tracking_category_id}__${opt.xero_tracking_option_id}`;
                                              const taken = usedOptionIds.has(opt.xero_tracking_option_id);
                                              return (
                                                <SelectItem
                                                  key={itemValue}
                                                  value={itemValue}
                                                  disabled={taken}
                                                  className={cn('pl-7', taken && 'opacity-40')}
                                                >
                                                  <span className="flex flex-col items-start gap-0.5">
                                                    <span className="text-sm">
                                                      {opt.name}
                                                    </span>
                                                    <span className="text-[10px] text-muted-foreground">
                                                      {orgName}
                                                      {cat?.name ? ` · ${cat.name}` : ''}
                                                      {taken ? ' · already mapped' : ''}
                                                    </span>
                                                  </span>
                                                </SelectItem>
                                              );
                                            })}
                                          </div>
                                        );
                                      })}
                                    </div>
                                    );
                                  })}
                                </SelectContent>
                              </Select>
                              {!isMapped && (
                                <p className="text-[10px] text-muted-foreground">
                                  Leave as “No organization” if this Dentally location should not be linked to Xero.
                                </p>
                              )}

                              {/* Tracking is optional. Only show when this Xero org actually has categories. */}
                              {isXeroOrg && categoriesForOrg.length > 0 && (
                                <div className="grid grid-cols-2 gap-2">
                                  <Select
                                    value={tracking?.categoryId || '__none__'}
                                    onValueChange={(categoryId) => {
                                      if (categoryId === '__none__') {
                                        setLocationTrackingMap(prev => {
                                          const next = { ...prev };
                                          delete next[location.id];
                                          return next;
                                        });
                                        return;
                                      }
                                      const cat = categoriesForOrg.find(c => c.xero_tracking_category_id === categoryId);
                                      setLocationTrackingMap(prev => ({
                                        ...prev,
                                        [location.id]: {
                                          categoryId,
                                          optionId: '',
                                          categoryName: cat?.name || '',
                                          optionName: '',
                                        },
                                      }));
                                    }}
                                  >
                                    <SelectTrigger className="h-8 text-xs">
                                      <SelectValue placeholder="Tracking category…" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="__none__">
                                        <span className="text-muted-foreground">No tracking (whole org)</span>
                                      </SelectItem>
                                      {categoriesForOrg.map(cat => (
                                        <SelectItem key={cat.xero_tracking_category_id} value={cat.xero_tracking_category_id}>
                                          {cat.name}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                  <Select
                                    value={tracking?.optionId || undefined}
                                    disabled={!tracking?.categoryId}
                                    onValueChange={(optionId) => {
                                      const opt = optionsForCategory.find(o => o.xero_tracking_option_id === optionId);
                                      setLocationTrackingMap(prev => ({
                                        ...prev,
                                        [location.id]: {
                                          categoryId: prev[location.id]?.categoryId || '',
                                          categoryName: prev[location.id]?.categoryName || '',
                                          optionId,
                                          optionName: opt?.name || '',
                                        },
                                      }));
                                    }}
                                  >
                                    <SelectTrigger className="h-8 text-xs">
                                      <SelectValue placeholder={
                                        !tracking?.categoryId
                                          ? 'Select category first'
                                          : optionsForCategory.length
                                            ? 'Tracking option…'
                                            : 'No options'
                                      } />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {optionsForCategory.map(opt => (
                                        <SelectItem key={opt.xero_tracking_option_id} value={opt.xero_tracking_option_id}>
                                          {opt.name}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                  {!tracking?.optionId && (
                                    <p className="col-span-2 text-[10px] text-muted-foreground">
                                      Optional — leave as “No tracking” to use the full Xero org for this location.
                                    </p>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Unmapped warning */}
                    {mappedLocIds.size < locations.length && (
                      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-700">
                        <AlertCircle className="w-4 h-4 flex-shrink-0" />
                        <span className="text-xs">
                          {locations.length - mappedLocIds.size} location{locations.length - mappedLocIds.size > 1 ? 's' : ''} not linked to an accounting organization. Unmapped locations will not receive financial data from that platform.
                        </span>
                      </div>
                    )}

                    {/* Save Mapping Button */}
                    {Object.keys(locationOrganizationMap).filter(locId => locationOrganizationMap[locId]).length > 0 && (
                      <div className="flex justify-end pt-3 border-t">
                        <Button
                          onClick={handleSaveAllMappings}
                          disabled={isSavingMapping}
                          className="gap-2"
                        >
                          {isSavingMapping ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Check className="w-4 h-4" />
                          )}
                          {isSavingMapping ? 'Saving...' : 'Save Mapping'}
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Add Connection Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader className="pb-4">
            <DialogTitle className="flex items-center gap-3 text-xl font-semibold">
              <div className={cn(
                "w-12 h-12 rounded-xl bg-gradient-to-br flex items-center justify-center shadow-md",
                accountingPlatforms[selectedPlatform].color,
                accountingPlatforms[selectedPlatform].logoType === 'image' ? 'p-2.5' : 'text-lg'
              )}>
                <PlatformLogo platform={accountingPlatforms[selectedPlatform]} />
              </div>
              Connect to {accountingPlatforms[selectedPlatform].name}
            </DialogTitle>
            <DialogDescription className="mt-2 text-sm">
              Enter your {accountingPlatforms[selectedPlatform].name} credentials to connect your accounting data
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Info Box */}
            {selectedPlatform === 'iplicit' && (
              <div className="p-4 bg-indigo-500/10 border-2 border-indigo-500/20 rounded-xl">
                <p className="text-sm text-indigo-700 dark:text-indigo-300 flex items-start gap-2">
                  <Key className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span>
                    You'll need your iplicit domain, username, and API key. Contact{' '}
                    <a href="mailto:apisupport@iplicit.com" className="underline font-medium hover:text-indigo-800 dark:hover:text-indigo-200">apisupport@iplicit.com</a>{' '}
                    to request API credentials.
                  </span>
                </p>
              </div>
            )}

            {/* 2-Column Grid Layout */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Platform-specific fields */}
              {selectedPlatform === 'iplicit' && (
                <>
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2 text-sm font-medium">
                      <Globe className="w-4 h-4" />
                      iplicit Domain *
                    </Label>
                    <Input
                      placeholder="e.g., yourcompany.demo"
                      value={newConnectionData.iplicitDomain}
                      onChange={(e) => setNewConnectionData(prev => ({ ...prev, iplicitDomain: e.target.value }))}
                      className="h-10"
                    />
                    <p className="text-xs text-muted-foreground">Your iplicit environment domain (without https://)</p>
                  </div>

                  <div className="space-y-2">
                    <Label className="flex items-center gap-2 text-sm font-medium">
                      <User className="w-4 h-4" />
                      API Username *
                    </Label>
                    <Input
                      placeholder="api_user_12345"
                      value={newConnectionData.iplicitUsername}
                      onChange={(e) => setNewConnectionData(prev => ({ ...prev, iplicitUsername: e.target.value }))}
                      className="h-10"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="flex items-center gap-2 text-sm font-medium">
                      <Key className="w-4 h-4" />
                      API Key *
                    </Label>
                    <Input
                      type="password"
                      placeholder="Enter your iplicit API key"
                      value={newConnectionData.iplicitApiKey}
                      onChange={(e) => setNewConnectionData(prev => ({ ...prev, iplicitApiKey: e.target.value }))}
                      className="h-10"
                    />
                    <p className="text-xs text-muted-foreground">Your API key is stored securely and encrypted</p>
                  </div>
                </>
              )}

            </div>
          </div>

          <DialogFooter className="gap-3 pt-4">
            <Button 
              variant="outline" 
              onClick={() => setIsAddDialogOpen(false)}
              disabled={isConnecting}
            >
              Cancel
            </Button>
            <Button 
              onClick={handleAddConnection} 
              disabled={isConnecting}
              className="gap-2 shadow-sm hover:shadow-md transition-shadow"
            >
              {isConnecting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Link2 className="w-4 h-4" />
              )}
              {isConnecting
                ? 'Connecting...'
                : `Connect to ${accountingPlatforms[selectedPlatform].name}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Credentials Dialog */}
      <Dialog open={isEditCredentialsDialogOpen} onOpenChange={setIsEditCredentialsDialogOpen}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader className="pb-4">
            <DialogTitle className="flex items-center gap-3 text-xl font-semibold">
              <div className={cn(
                "w-12 h-12 rounded-xl bg-gradient-to-br flex items-center justify-center shadow-md",
                editingPlatform ? accountingPlatforms[editingPlatform].color : '',
                editingPlatform && accountingPlatforms[editingPlatform].logoType === 'image' ? 'p-2.5' : 'text-lg'
              )}>
                {editingPlatform && <PlatformLogo platform={accountingPlatforms[editingPlatform]} />}
              </div>
              Edit {editingPlatform === 'xero' ? 'Xero' : editingPlatform === 'quickbooks' ? 'QuickBooks' : editingPlatform === 'iplicit' ? 'iplicit' : ''} Credentials
            </DialogTitle>
            <DialogDescription className="mt-2 text-sm">
              Update your {editingPlatform === 'xero' ? 'Xero' : editingPlatform === 'quickbooks' ? 'QuickBooks' : 'iplicit'} credentials to connect your accounting data
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Info Box */}
            {editingPlatform === 'xero' && (
              <div className="p-4 bg-blue-500/10 border-2 border-blue-500/20 rounded-xl">
                <p className="text-sm text-blue-700 dark:text-blue-300 flex items-start gap-2">
                  <Key className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span>
                    You'll need to create a Xero app in the{' '}
                    <a 
                      href="https://developer.xero.com/myapps" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="underline font-medium hover:text-blue-800 dark:hover:text-blue-200"
                    >
                      Xero Developer Portal
                    </a>
                    {' '}to get your Client ID and Client Secret.
                  </span>
                </p>
              </div>
            )}

            {editingPlatform === 'quickbooks' && (
              <div className="p-4 bg-green-500/10 border-2 border-green-500/20 rounded-xl">
                <p className="text-sm text-green-700 dark:text-green-300 flex items-start gap-2">
                  <Key className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span>
                    You'll need to create a QuickBooks app in the{' '}
                    <a 
                      href="https://developer.intuit.com/app/developer/myapps" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="underline font-medium hover:text-green-800 dark:hover:text-green-200"
                    >
                      Intuit Developer Portal
                    </a>
                    {' '}to get your Client ID and Client Secret.
                  </span>
                </p>
              </div>
            )}

            {/* 2-Column Grid Layout - Same as Add Credentials */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {editingPlatform === 'iplicit' && (
                <>
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2 text-sm font-medium">
                      <Globe className="w-4 h-4" />
                      iplicit Domain *
                    </Label>
                    <Input
                      placeholder="e.g., yourcompany.demo"
                      value={editCredentialsData.iplicitDomain}
                      onChange={(e) => setEditCredentialsData(prev => ({ ...prev, iplicitDomain: e.target.value }))}
                      className="h-10"
                    />
                    <p className="text-xs text-muted-foreground">Your iplicit environment domain (without https://)</p>
                  </div>

                  <div className="space-y-2">
                    <Label className="flex items-center gap-2 text-sm font-medium">
                      <User className="w-4 h-4" />
                      API Username *
                    </Label>
                    <Input
                      placeholder="api_user_12345"
                      value={editCredentialsData.iplicitUsername}
                      onChange={(e) => setEditCredentialsData(prev => ({ ...prev, iplicitUsername: e.target.value }))}
                      className="h-10"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="flex items-center gap-2 text-sm font-medium">
                      <Key className="w-4 h-4" />
                      API Key *
                    </Label>
                    <Input
                      type="password"
                      placeholder="Enter your iplicit API key"
                      value={editCredentialsData.iplicitApiKey}
                      onChange={(e) => setEditCredentialsData(prev => ({ ...prev, iplicitApiKey: e.target.value }))}
                      className="h-10"
                    />
                    <p className="text-xs text-muted-foreground">Your API key is stored securely and encrypted</p>
                  </div>
                </>
              )}

              {(editingPlatform === 'xero' || editingPlatform === 'quickbooks') && (
                <>
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2 text-sm font-medium">
                      <Key className="w-4 h-4" />
                      Client ID *
                    </Label>
                    <Input
                      placeholder={`Enter your ${editingPlatform === 'xero' ? 'Xero' : 'QuickBooks'} Client ID`}
                      value={editCredentialsData.clientId}
                      onChange={(e) => setEditCredentialsData(prev => ({ ...prev, clientId: e.target.value }))}
                      className="h-10"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="flex items-center gap-2 text-sm font-medium">
                      <Key className="w-4 h-4" />
                      Client Secret *
                    </Label>
                    <Input
                      type="password"
                      placeholder={`Enter your ${editingPlatform === 'xero' ? 'Xero' : 'QuickBooks'} Client Secret`}
                      value={editCredentialsData.clientSecret}
                      onChange={(e) => setEditCredentialsData(prev => ({ ...prev, clientSecret: e.target.value }))}
                      className="h-10"
                    />
                    <p className="text-xs text-muted-foreground">Your credentials are stored securely and encrypted</p>
                  </div>
                </>
              )}
            </div>
          </div>

          <DialogFooter className="gap-3 pt-4">
            <Button 
              variant="outline" 
              onClick={() => {
                setIsEditCredentialsDialogOpen(false);
                setEditCredentialsData({ clientId: '', clientSecret: '', iplicitDomain: '', iplicitUsername: '', iplicitApiKey: '' });
                setEditingPlatform(null);
              }}
              disabled={isUpdatingCredentials}
            >
              Cancel
            </Button>
            <Button 
              onClick={updateCredentials} 
              disabled={isUpdatingCredentials}
              className="gap-2 shadow-sm hover:shadow-md transition-shadow"
            >
              {isUpdatingCredentials ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Link2 className="w-4 h-4" />
              )}
              {isUpdatingCredentials ? 'Updating...' : `Update ${editingPlatform === 'xero' ? 'Xero' : editingPlatform === 'quickbooks' ? 'QuickBooks' : 'iplicit'} Credentials`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
