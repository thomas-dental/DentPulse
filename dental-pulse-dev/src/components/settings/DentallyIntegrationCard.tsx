import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Plus, X, RefreshCw, Key, Pencil, Loader2, Link2, Database, ChevronsUpDown, X as XIcon, Eye, EyeOff, MapPin, History } from 'lucide-react';
import { Integration } from '@/hooks/useIntegrations';
import { DentallyService } from '@/services/integrations/dentallyService';
import { IntegrationSyncEntityService } from '@/services/integrations/integrationSyncEntityService';
import { SyncJobService } from '@/services/integrations/syncJobService';
import { supabase } from '@/integrations/supabase/client';
import { format, formatDistanceToNow } from 'date-fns';
import { DatePicker, ConfigProvider } from 'antd';
import dayjs from 'dayjs';

// Entities that require a date range when syncing
const DATE_RANGE_ENTITY_ALIASES = new Set([
  'patients', 'appointments', 'invoices',
  'treatment_plans', 'treatment_plan_items', 'treatment_appointments',
  'nhs_claims',
]);

interface DentallyIntegrationCardProps {
  integrations: Integration[];
  syncEntitiesMap: Record<string, any[]>;
  organizationId: string | null;
  userId: string | undefined;
  onRefetch: () => void;
  onEditIntegration: (integration: Integration) => void;
  onDisconnect: (integrationId: string) => void;
  onConnect: (integration: Integration) => void;
  isConnecting: string | null;
}

export function DentallyIntegrationCard({
  integrations,
  syncEntitiesMap,
  organizationId,
  userId,
  onRefetch,
  onEditIntegration,
  onDisconnect,
  onConnect,
  isConnecting,
}: DentallyIntegrationCardProps) {
  const dentallyIntegrations = useMemo(
    () => integrations.filter(int => int.integration_name === 'Dentally'),
    [integrations]
  );

  const isAnyConnected = dentallyIntegrations.some(int => int.is_connected);
  const hasAccounts = dentallyIntegrations.length > 0;

  // Add account dialog state
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [addApiKey, setAddApiKey] = useState('');
  const [addAccountLabel, setAddAccountLabel] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Manual sync dialog state
  const [syncDialogIntegrationId, setSyncDialogIntegrationId] = useState<string | null>(null);
  const [selectedSyncEntities, setSelectedSyncEntities] = useState<string[]>([]);
  const [syncDateRange, setSyncDateRange] = useState<{ from: Date | null; to: Date | null }>({ from: null, to: null });
  const [isManualSyncing, setIsManualSyncing] = useState(false);
  const [isSyncEntitySelectOpen, setIsSyncEntitySelectOpen] = useState(false);

  // Force sync state per integration
  const [forceSyncingId, setForceSyncingId] = useState<string | null>(null);

  // Progressive (last-updated incremental) sync state per integration
  const [progressiveSyncingId, setProgressiveSyncingId] = useState<string | null>(null);

  // Force sync dialog state (site selection)
  const [forceSyncDialogId, setForceSyncDialogId] = useState<string | null>(null);
  const [availableSites, setAvailableSites] = useState<{ id: string; name: string }[]>([]);
  const [selectedSiteIds, setSelectedSiteIds] = useState<string[]>([]);
  const [isLoadingSites, setIsLoadingSites] = useState(false);
  const [selectAllSites, setSelectAllSites] = useState(true);

  // Get sync entities for a specific integration
  const getSyncEntities = (integrationId: string) => {
    const entities = syncEntitiesMap[integrationId] || [];
    return entities
      .filter((e: any) => e.is_available)
      .map((e: any) => ({
        alias: e.entity_alias as string,
        label: e.entity_label as string,
        requiresDateRange: DATE_RANGE_ENTITY_ALIASES.has(e.entity_alias),
      }));
  };

  // Get last sync date for an integration
  const getLastSyncDate = (integration: Integration) => {
    const entities = syncEntitiesMap[integration.id] || [];
    const latestEntitySync = entities
      .map((e: any) => e.last_synced_at)
      .filter(Boolean)
      .sort()
      .at(-1);
    return latestEntitySync || integration.sync_at || null;
  };

  // Handle adding a new Dentally account
  const handleAddAccount = async () => {
    if (!organizationId || !userId) {
      toast.error('No organization or user found.');
      return;
    }
    if (!addApiKey.trim()) {
      toast.error('Please enter your Dentally API Key.');
      return;
    }

    setIsSaving(true);
    try {
      const apiEndpoint = 'https://api.dentally.co';

      // Validate API key
      toast.info('Validating API key...');
      const userResult = await DentallyService.getUser(addApiKey.trim(), apiEndpoint);

      if (!userResult.success || !userResult.data?.user) {
        if (userResult.status === 401 || userResult.status === 403) {
          throw new Error('API key is not valid. Please check your key and try again.');
        }
        if (userResult.data?.error) {
          throw new Error(userResult.data.error.message || userResult.data.error.type || 'API key is not valid.');
        }
        throw new Error('API key is not valid. Please check your key and try again.');
      }

      toast.info('API key validated. Setting up integration...');

      const label = addAccountLabel.trim() || 'Cloud-based dental practice management software';
      const { data: newIntegration, error: createError } = await supabase
        .from('integrations')
        .insert({
          organization_id: organizationId,
          user_id: userId,
          created_by: userId,
          integration_name: 'Dentally',
          integration_description: label,
          is_connected: true,
          api_endpoints: apiEndpoint,
          api_key: addApiKey.trim(),
          sync_frequency: '15min',
        })
        .select()
        .single();

      if (createError) throw createError;

      await IntegrationSyncEntityService.initializeDefaultEntities(newIntegration.id, 'Dentally');

      onRefetch();
      setIsAddDialogOpen(false);
      setAddApiKey('');
      setAddAccountLabel('');
      setShowApiKey(false);

      toast.success('Dentally account connected successfully!');
    } catch (error: any) {
      console.error('Error connecting Dentally:', error);
      toast.error(error.message || 'Failed to connect. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  // Open force sync dialog — fetch available sites from Dentally API
  const openForceSyncDialog = async (integrationId: string) => {
    const integration = dentallyIntegrations.find(i => i.id === integrationId);
    if (!integration?.api_key) {
      toast.error('No API key found for this integration.');
      return;
    }

    setForceSyncDialogId(integrationId);
    setIsLoadingSites(true);
    setAvailableSites([]);

    // Pre-select previously saved sites, or default to all
    const savedSiteIds = integration.synced_site_ids;
    if (savedSiteIds && savedSiteIds.length > 0) {
      setSelectedSiteIds(savedSiteIds);
      setSelectAllSites(false);
    } else {
      setSelectedSiteIds([]);
      setSelectAllSites(true);
    }

    try {
      const result = await DentallyService.getSites(integration.api_key, integration.api_endpoints || undefined);
      if (result.success && result.data?.sites) {
        const sites = result.data.sites
          .filter((s: any) => s.active !== false)
          .map((s: any) => ({ id: String(s.id), name: s.name || s.nickname || `Site ${s.id}` }));
        setAvailableSites(sites);

        // If "all" was selected and no saved preference, select all site ids
        if (!savedSiteIds || savedSiteIds.length === 0) {
          setSelectedSiteIds(sites.map((s: { id: string }) => s.id));
          setSelectAllSites(true);
        }
      } else {
        toast.error('Failed to fetch sites from Dentally.');
      }
    } catch (error: any) {
      console.error('Error fetching sites:', error);
      toast.error('Failed to fetch sites.');
    } finally {
      setIsLoadingSites(false);
    }
  };

  // Handle select all toggle
  const handleSelectAllSites = (checked: boolean) => {
    setSelectAllSites(checked);
    if (checked) {
      setSelectedSiteIds(availableSites.map(s => s.id));
    } else {
      setSelectedSiteIds([]);
    }
  };

  // Handle individual site toggle
  const handleSiteToggle = (siteId: string, checked: boolean) => {
    if (checked) {
      const newIds = [...selectedSiteIds, siteId];
      setSelectedSiteIds(newIds);
      setSelectAllSites(newIds.length === availableSites.length);
    } else {
      const newIds = selectedSiteIds.filter(id => id !== siteId);
      setSelectedSiteIds(newIds);
      setSelectAllSites(false);
    }
  };

  // Execute force sync with selected sites
  const handleForceFullSync = async () => {
    if (!organizationId || !userId || !forceSyncDialogId) return;

    if (selectedSiteIds.length === 0) {
      toast.error('Please select at least one site to sync.');
      return;
    }

    // Save selected site IDs to the integration record
    const syncAllSites = selectAllSites;
    const siteIdsToSave = syncAllSites ? null : selectedSiteIds;

    setForceSyncingId(forceSyncDialogId);
    try {
      // Update synced_site_ids on the integration
      const { error: updateError } = await supabase
        .from('integrations')
        .update({ synced_site_ids: siteIdsToSave })
        .eq('id', forceSyncDialogId);

      if (updateError) {
        console.error('Error saving site selection:', updateError);
        toast.error('Failed to save site selection.');
        return;
      }

      const result = await SyncJobService.forceFullSync(organizationId, forceSyncDialogId);
      if (result.errors.length > 0) {
        toast.error(`Failed to start force sync: ${result.errors[0]}`);
      } else {
        onRefetch();
        toast.success(
          `Force sync started for ${syncAllSites ? 'all sites' : `${selectedSiteIds.length} selected site(s)`} with ${result.jobIds.length} jobs.`,
          { duration: 5000 }
        );
      }
      setForceSyncDialogId(null);
    } catch (error: any) {
      toast.error(error.message || 'Failed to start force sync.');
    } finally {
      setForceSyncingId(null);
    }
  };

  // Trigger the same last-updated incremental window as the nightly 00:00 UK job
  const handleProgressiveSync = async (integrationId: string) => {
    if (!organizationId || !userId) {
      toast.error('No organization or user found.');
      return;
    }

    setProgressiveSyncingId(integrationId);
    try {
      const result = await SyncJobService.progressiveSync(organizationId, integrationId);
      if (result.errors.length > 0) {
        toast.error(`Failed to start progressive sync: ${result.errors[0]}`);
      } else if (result.jobIds.length === 0) {
        toast.info('Nothing to sync for this progressive window.');
      } else {
        onRefetch();
        const lookback = result.lookbackDays ?? 3;
        toast.success(
          `Progressive sync started (${lookback}-day last-updated window, ${result.jobIds.length} jobs). Track progress in the TopBar.`,
          { duration: 5000 }
        );
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to start progressive sync.');
    } finally {
      setProgressiveSyncingId(null);
    }
  };

  // Open manual sync dialog
  const openSyncDialog = (integrationId: string) => {
    setSyncDialogIntegrationId(integrationId);
    setSelectedSyncEntities([]);
    setSyncDateRange({ from: null, to: null });
  };

  // Handle manual sync
  const handleManualSync = async () => {
    if (!organizationId || !userId || !syncDialogIntegrationId) return;

    if (selectedSyncEntities.length === 0) {
      toast.error('Please select at least one entity to sync.');
      return;
    }

    const allEntities = getSyncEntities(syncDialogIntegrationId);
    const dateRangeEntities = selectedSyncEntities.filter(alias =>
      allEntities.find(e => e.alias === alias)?.requiresDateRange
    );
    const fullSyncEntities = selectedSyncEntities.filter(alias =>
      !allEntities.find(e => e.alias === alias)?.requiresDateRange
    );

    if (dateRangeEntities.length > 0 && !syncDateRange.from) {
      toast.error('Please select a start date for the date-range entities.');
      return;
    }

    setIsManualSyncing(true);
    try {
      const results: string[] = [];
      const errors: string[] = [];

      if (dateRangeEntities.length > 0) {
        const fromDate = syncDateRange.from!;
        const startDate = `${fromDate.getFullYear()}-${String(fromDate.getMonth() + 1).padStart(2, '0')}-${String(fromDate.getDate()).padStart(2, '0')}`;
        const toDate = syncDateRange.to || new Date();
        const endDate = `${toDate.getFullYear()}-${String(toDate.getMonth() + 1).padStart(2, '0')}-${String(toDate.getDate()).padStart(2, '0')}`;

        const syncResults = await SyncJobService.syncAll(organizationId, syncDialogIntegrationId, dateRangeEntities, startDate, endDate, userId);
        if (syncResults.success) results.push(...syncResults.jobIds);
        else errors.push(...syncResults.errors);
      }

      if (fullSyncEntities.length > 0) {
        const fullResults = await SyncJobService.syncAll(organizationId, syncDialogIntegrationId, fullSyncEntities, null, null, userId);
        if (fullResults.success) results.push(...fullResults.jobIds);
        else errors.push(...fullResults.errors);
      }

      if (errors.length > 0) {
        toast.error(`Failed to start some syncs: ${errors[0]}`);
      } else {
        toast.success(`Manual sync started for ${selectedSyncEntities.length} ${selectedSyncEntities.length === 1 ? 'entity' : 'entities'}. Track progress in the TopBar.`, { duration: 5000 });
        setSyncDialogIntegrationId(null);
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to start manual sync.');
    } finally {
      setIsManualSyncing(false);
    }
  };

  const hasDateRangeEntities = syncDialogIntegrationId
    ? selectedSyncEntities.some(alias =>
        getSyncEntities(syncDialogIntegrationId).find(e => e.alias === alias)?.requiresDateRange
      )
    : false;

  const syncDialogEntities = syncDialogIntegrationId ? getSyncEntities(syncDialogIntegrationId) : [];

  return (
    <div className="space-y-5">
      {/* Section Header */}
      <div className="flex items-center gap-3 px-1">
        <div className="dnt-section-icon">
          <Database className="w-5 h-5 text-white" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-foreground tracking-tight">
              Dental Integrations
            </h2>
            {isAnyConnected && (
              <span className="dp-active-pill">
                <span className="dp-pulse-dot" /> {dentallyIntegrations.filter(i => i.is_connected).length} Active
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Connect your Dentally practice accounts to sync clinical & patient data
          </p>
        </div>
      </div>

      {/* Dentally Platform Card */}
      <div className="grid grid-cols-1 gap-5">
        <div className={cn("dp-platform-card", isAnyConnected && "dp-platform-card--connected")} style={{ '--card-i': 0 } as React.CSSProperties}>
          {/* Card Header */}
          <div className="dp-card-header">
            <div className="dp-logo-ring dnt-logo-ring">
              <span className="text-3xl">🦷</span>
            </div>
            <span className="text-base font-bold text-foreground mt-3">Dentally</span>
            <div className="mt-2">
              {isAnyConnected ? (
                <span className="dp-status-badge dp-status-badge--connected">
                  <span className="dp-pulse-dot" /> Connected
                </span>
              ) : hasAccounts ? (
                <span className="dp-status-badge dp-status-badge--pending">
                  <Key className="w-3 h-3" /> Credentials Saved
                </span>
              ) : (
                <span className="dp-status-badge dp-status-badge--idle">Not Connected</span>
              )}
            </div>
          </div>

          {/* Card Actions */}
          <div className="dp-card-actions">
            <Button
              onClick={() => { setAddApiKey(''); setAddAccountLabel(''); setShowApiKey(false); setIsAddDialogOpen(true); }}
              variant={hasAccounts ? 'outline' : undefined}
              size="sm"
              className={hasAccounts ? 'dp-btn-action w-full' : 'dp-btn-primary w-full'}
            >
              <Plus className="w-3.5 h-3.5" /> {hasAccounts ? 'Add Account' : 'Connect'}
            </Button>
          </div>

          {/* Card Footer - Connection Rows */}
          {dentallyIntegrations.length > 0 && (
            <div className="dp-card-footer">
              <p className="dp-footer-label">Active Connections</p>
              <div className="space-y-1.5">
                {dentallyIntegrations.map((integration) => {
                  const connected = !!integration.is_connected;
                  const lastSync = getLastSyncDate(integration);
                  const label = integration.integration_description && integration.integration_description !== 'Cloud-based dental practice management software'
                    ? integration.integration_description
                    : integration.api_key ? `${integration.api_key.substring(0, 8)}...` : 'Dentally';

                  return (
                    <div key={integration.id} className="dp-conn-row">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className={cn("dp-conn-dot", connected ? "dp-conn-dot--on" : "dp-conn-dot--off")} />
                        <div className="min-w-0 flex-1">
                          <span className="text-[13px] font-medium text-foreground block truncate" title={label}>{label}</span>
                          {lastSync && (
                            <span className="text-[11px] text-muted-foreground block truncate">
                              Last sync: {formatDistanceToNow(new Date(lastSync), { addSuffix: true })}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="dp-conn-actions">
                        <Button variant="ghost" size="icon" onClick={() => onEditIntegration(integration)} className="dp-icon-btn" title="Edit credentials">
                          <Pencil className="w-3 h-3" />
                        </Button>
                        {connected && (
                          <>
                            <Button variant="ghost" size="icon" onClick={() => openSyncDialog(integration.id)} className="dp-icon-btn" title="Manual sync">
                              <Database className="w-3 h-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleProgressiveSync(integration.id)}
                              disabled={progressiveSyncingId === integration.id || forceSyncingId === integration.id}
                              className="dp-icon-btn"
                              title="Progressive sync (records updated in the last 3 days — same as nightly 00:00 UK job)"
                            >
                              <History className={cn("w-3 h-3", progressiveSyncingId === integration.id && "animate-spin")} />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openForceSyncDialog(integration.id)}
                              disabled={forceSyncingId === integration.id || progressiveSyncingId === integration.id}
                              className="dp-icon-btn"
                              title="Force full sync"
                            >
                              <RefreshCw className={cn("w-3 h-3", forceSyncingId === integration.id && "animate-spin")} />
                            </Button>
                          </>
                        )}
                        {connected ? (
                          <Button variant="ghost" size="sm" onClick={() => onDisconnect(integration.id)} className="dp-disconnect-btn">
                            <X className="w-3 h-3" /> Disconnect
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            onClick={() => onConnect(integration)}
                            disabled={isConnecting === integration.id}
                            className="dp-connect-btn"
                          >
                            {isConnecting === integration.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Link2 className="w-3 h-3" />} Connect
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Add Account Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader className="pb-4">
            <DialogTitle className="flex items-center gap-3 text-xl font-semibold">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center shadow-md text-lg">
                🦷
              </div>
              {hasAccounts ? 'Add Dentally Account' : 'Connect to Dentally'}
            </DialogTitle>
            <DialogDescription className="mt-2 text-sm">
              Enter your Dentally API key to connect your practice account
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Info Box */}
            <div className="p-4 bg-blue-500/10 border-2 border-blue-500/20 rounded-xl">
              <p className="text-sm text-blue-700 dark:text-blue-300 flex items-start gap-2">
                <Key className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>
                  You'll need your Dentally API key. Get it from your{' '}
                  <a
                    href="https://developer.dentally.co"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline font-medium hover:text-blue-800 dark:hover:text-blue-200"
                  >
                    Dentally Developer Portal
                  </a>.
                </span>
              </p>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-sm font-medium">Account Label</Label>
                <Input
                  type="text"
                  placeholder="e.g. London Practice, Manchester Clinic"
                  value={addAccountLabel}
                  onChange={(e) => setAddAccountLabel(e.target.value)}
                  className="h-10"
                />
                <p className="text-xs text-muted-foreground">A friendly name to distinguish this account from others</p>
              </div>

              <div className="space-y-2">
                <Label className="flex items-center gap-2 text-sm font-medium">
                  <Key className="w-4 h-4" />
                  API Key *
                </Label>
                <div className="relative">
                  <Input
                    type={showApiKey ? 'text' : 'password'}
                    placeholder="Enter your Dentally API key"
                    value={addApiKey}
                    onChange={(e) => setAddApiKey(e.target.value)}
                    className="h-10 font-mono pr-10"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-full px-3"
                    onClick={() => setShowApiKey(!showApiKey)}
                  >
                    {showApiKey ? <EyeOff className="w-4 h-4 text-muted-foreground" /> : <Eye className="w-4 h-4 text-muted-foreground" />}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">Your API key is stored securely</p>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-3 pt-4">
            <Button variant="outline" onClick={() => setIsAddDialogOpen(false)} disabled={isSaving}>
              Cancel
            </Button>
            <Button onClick={handleAddAccount} disabled={isSaving || !addApiKey.trim()} className="gap-2 shadow-sm hover:shadow-md transition-shadow">
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
              {isSaving ? 'Connecting...' : 'Connect'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manual Sync Dialog */}
      <Dialog open={!!syncDialogIntegrationId} onOpenChange={(open) => { if (!open) setSyncDialogIntegrationId(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader className="pb-4">
            <DialogTitle className="flex items-center gap-3 text-xl font-semibold">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center shadow-md text-lg">
                🦷
              </div>
              Manual Sync
            </DialogTitle>
            <DialogDescription className="mt-2 text-sm">
              {(() => {
                if (!syncDialogIntegrationId) return 'Select entities and date range to sync';
                const int = dentallyIntegrations.find(i => i.id === syncDialogIntegrationId);
                const label = int?.integration_description && int.integration_description !== 'Cloud-based dental practice management software'
                  ? int.integration_description
                  : 'Dentally';
                return `Sync specific entities for ${label}`;
              })()}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Entity Selection */}
            <div className="space-y-3">
              <Label className="block text-sm font-medium">Select Entities to Sync</Label>
              {selectedSyncEntities.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {selectedSyncEntities.map((entityAlias) => {
                    const entity = syncDialogEntities.find(e => e.alias === entityAlias);
                    return (
                      <div
                        key={entityAlias}
                        className="inline-flex items-center gap-1 px-2.5 py-1 bg-primary/10 text-primary rounded-md border border-primary/30 text-sm"
                      >
                        <span>{entity?.label || entityAlias}</span>
                        <button
                          onClick={() => setSelectedSyncEntities(prev => prev.filter(e => e !== entityAlias))}
                          className="hover:bg-primary/20 rounded-sm"
                        >
                          <XIcon className="h-3 w-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
              <Popover open={isSyncEntitySelectOpen} onOpenChange={setIsSyncEntitySelectOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={isSyncEntitySelectOpen}
                    className="w-full justify-between font-normal"
                  >
                    <span>Search entities...</span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[300px] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search..." className="h-8" />
                    <CommandList>
                      <CommandEmpty>No entities found.</CommandEmpty>
                      <CommandGroup>
                        {syncDialogEntities
                          .filter(entity => !selectedSyncEntities.includes(entity.alias))
                          .map((entity) => (
                            <CommandItem
                              key={entity.alias}
                              value={entity.label}
                              onSelect={() => {
                                setSelectedSyncEntities(prev => [...prev, entity.alias]);
                                setIsSyncEntitySelectOpen(false);
                              }}
                              className="aria-selected:bg-primary aria-selected:text-primary-foreground text-sm"
                            >
                              <span>{entity.label}</span>
                            </CommandItem>
                          ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              {selectedSyncEntities.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {selectedSyncEntities.length} {selectedSyncEntities.length === 1 ? 'entity' : 'entities'} selected
                </p>
              )}
            </div>

            {/* Date Range */}
            {hasDateRangeEntities && (
              <div className="space-y-3">
                <Label className="text-sm font-medium">Select Date Range</Label>
                <ConfigProvider
                  theme={{
                    token: {
                      colorPrimary: 'hsl(244, 48%, 25%)',
                      colorPrimaryBg: '#e6f4ff',
                      colorPrimaryBgHover: '#bae0ff',
                    },
                  }}
                >
                  <DatePicker.RangePicker
                    value={[
                      syncDateRange.from ? dayjs(syncDateRange.from) : null,
                      syncDateRange.to ? dayjs(syncDateRange.to) : null,
                    ]}
                    onChange={(dates) => {
                      setSyncDateRange({
                        from: dates?.[0]?.toDate() ?? null,
                        to: dates?.[1]?.toDate() ?? null,
                      });
                    }}
                    format="DD-MM-YYYY"
                    placeholder={['Start date', 'End date']}
                    className="w-full"
                  />
                </ConfigProvider>
                <p className="text-xs text-muted-foreground">
                  {syncDateRange.to
                    ? `Sync data from ${format(syncDateRange.from!, 'PP')} to ${format(syncDateRange.to, 'PP')}`
                    : syncDateRange.from
                    ? `Sync data from ${format(syncDateRange.from, 'PP')} to today`
                    : 'Select a date range for entities that require it'}
                </p>
              </div>
            )}
          </div>

          <DialogFooter className="gap-3 pt-4">
            <Button variant="outline" onClick={() => setSyncDialogIntegrationId(null)} disabled={isManualSyncing}>
              Cancel
            </Button>
            <Button
              onClick={handleManualSync}
              disabled={isManualSyncing || selectedSyncEntities.length === 0 || (hasDateRangeEntities && !syncDateRange.from)}
              className="gap-2"
            >
              {isManualSyncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              {isManualSyncing ? 'Syncing...' : 'Sync data'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Force Sync Dialog with Site Selection */}
      <Dialog open={!!forceSyncDialogId} onOpenChange={(open) => { if (!open) setForceSyncDialogId(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader className="pb-4">
            <DialogTitle className="flex items-center gap-3 text-xl font-semibold">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center shadow-md text-lg">
                🦷
              </div>
              Force Full Sync
            </DialogTitle>
            <DialogDescription className="mt-2 text-sm">
              {(() => {
                if (!forceSyncDialogId) return 'Select sites to sync';
                const int = dentallyIntegrations.find(i => i.id === forceSyncDialogId);
                const label = int?.integration_description && int.integration_description !== 'Cloud-based dental practice management software'
                  ? int.integration_description
                  : 'Dentally';
                return `Select which sites to sync for ${label}. This will clear sync history and re-sync data for the selected sites.`;
              })()}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Info Box */}
            <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl">
              <p className="text-xs text-amber-700 dark:text-amber-300">
                This will cancel current sync jobs for this account, clear its sync history, and re-sync data from the configured date range. Other connected accounts will not be affected.
              </p>
            </div>

            {/* Site Selection */}
            <div className="space-y-3">
              <Label className="flex items-center gap-2 text-sm font-medium">
                <MapPin className="w-4 h-4" />
                Select Sites to Sync
              </Label>

              {isLoadingSites ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  <span className="ml-2 text-sm text-muted-foreground">Loading sites from Dentally...</span>
                </div>
              ) : availableSites.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">No sites found for this account.</p>
              ) : (
                <div className="space-y-2">
                  {/* Select All */}
                  <label className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30 hover:bg-muted/50 cursor-pointer transition-colors">
                    <Checkbox
                      checked={selectAllSites}
                      onCheckedChange={(checked) => handleSelectAllSites(!!checked)}
                    />
                    <div>
                      <span className="text-sm font-medium">All Sites</span>
                      <p className="text-xs text-muted-foreground">Sync data from all {availableSites.length} sites</p>
                    </div>
                  </label>

                  {/* Individual Sites */}
                  <div className="max-h-[240px] overflow-y-auto space-y-1.5 pr-1">
                    {availableSites.map((site) => (
                      <label
                        key={site.id}
                        className={cn(
                          "flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors",
                          selectedSiteIds.includes(site.id)
                            ? "bg-primary/5 border-primary/30"
                            : "hover:bg-muted/30"
                        )}
                      >
                        <Checkbox
                          checked={selectedSiteIds.includes(site.id)}
                          onCheckedChange={(checked) => handleSiteToggle(site.id, !!checked)}
                        />
                        <div className="min-w-0 flex-1">
                          <span className="text-sm font-medium block truncate">{site.name}</span>
                          <span className="text-xs text-muted-foreground">ID: {site.id.slice(0, 8)}...</span>
                        </div>
                      </label>
                    ))}
                  </div>

                  {!selectAllSites && selectedSiteIds.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {selectedSiteIds.length} of {availableSites.length} site{availableSites.length !== 1 ? 's' : ''} selected
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="gap-3 pt-4">
            <Button variant="outline" onClick={() => setForceSyncDialogId(null)} disabled={!!forceSyncingId}>
              Cancel
            </Button>
            <Button
              onClick={handleForceFullSync}
              disabled={!!forceSyncingId || selectedSiteIds.length === 0 || isLoadingSites}
              className="gap-2"
              variant="destructive"
            >
              {forceSyncingId ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              {forceSyncingId ? 'Starting...' : `Sync ${selectAllSites ? 'All Sites' : `${selectedSiteIds.length} Site${selectedSiteIds.length !== 1 ? 's' : ''}`}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Component Styles */}
      <style>{`
        .dnt-section-icon {
          width: 40px; height: 40px; border-radius: 12px;
          background: linear-gradient(135deg, #3b82f6, #06b6d4);
          display: flex; align-items: center; justify-content: center;
          box-shadow: 0 4px 12px rgba(59,130,246,0.25);
        }
        .dnt-logo-ring {
          border: 2px solid #3b82f620;
        }
      `}</style>
    </div>
  );
}
