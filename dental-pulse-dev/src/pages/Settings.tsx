import { Helmet } from 'react-helmet-async';
import { useState, useEffect } from 'react';
import { useTabPermissions } from '@/hooks/useTabPermissions';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { RoleGate } from '@/components/auth/RoleGate';
import { useUserRole } from '@/hooks/useUserRole';
import {
  Settings as SettingsIcon,
  LayoutDashboard,
  BarChart3,
  TrendingUp,
  Calculator,
  ClipboardList,
  MapPin,
  Users,
  Stethoscope,
  Armchair,
  Zap,
  FileSpreadsheet,
  Link2,
  Check,
  X,
  RefreshCw,
  Shield,
  Bell,
  Globe,
  Clock,
  AlertCircle,
  Pencil,
  Plug,
  Eye,
  EyeOff,
  ArrowRight,
  ListChecks,
} from 'lucide-react';
import { AccountingIntegrationsHub } from '@/components/settings/AccountingIntegrationsHub';
import { DentallyIntegrationCard } from '@/components/settings/DentallyIntegrationCard';
import { PatientEconomicsPatCard } from '@/components/settings/PatientEconomicsPatCard';
import { PlaidSection } from '@/components/plaid/PlaidSection';
import { LocationRegionManagement } from '@/components/settings/LocationRegionManagement';
import { useIntegrations, Integration } from '@/hooks/useIntegrations';
import { useOrganization } from '@/hooks/useOrganization';
import { ORGANIZATION_DISPLAY_SETTINGS_QUERY_KEY } from '@/hooks/useOrganizationSettings';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { IntegrationSyncEntityService } from '@/services/integrations/integrationSyncEntityService';

// Module configuration data
const moduleConfig = [
  { id: 'dashboard', name: 'Dashboard', icon: LayoutDashboard, enabled: true, description: 'Main overview and KPIs' },
  { id: 'performance', name: 'Performance', icon: BarChart3, enabled: true, description: 'Location and entity performance tracking' },
  { id: 'profitability', name: 'Profitability', icon: TrendingUp, enabled: true, description: 'P&L analysis and benchmarking' },
  { id: 'tax', name: 'Tax', icon: Calculator, enabled: true, description: 'Corporation tax and planning' },
  { id: 'budget', name: 'Budget & Planning', icon: ClipboardList, enabled: true, description: 'Budget vs actual and forecasting' },
  { id: 'locations', name: 'Locations', icon: MapPin, enabled: true, description: 'Multi-location management' },
  { id: 'providers', name: 'Providers', icon: Users, enabled: true, description: 'Associate and staff performance' },
  { id: 'treatments', name: 'Treatments', icon: Stethoscope, enabled: true, description: 'Treatment mix and specialty tracking' },
  { id: 'chairs', name: 'Chairs', icon: Armchair, enabled: true, description: 'Chair utilisation and occupancy' },
  { id: 'accounts-payable', name: 'Accounts Payable', icon: Zap, enabled: true, description: 'Invoice automation and processing' },
  { id: 'reports', name: 'Reports', icon: FileSpreadsheet, enabled: true, description: 'Financial statements and reports' },
];

// Integration logo mapping
const integrationLogos: Record<string, string> = {
  'Dentally': '🦷',
  'Implicit Accounting': '📊',
};

export default function Settings() {
  const { canViewTab, defaultTab } = useTabPermissions('admin_settings');

  // Check for ?tab= query param (e.g. from chatbot "configure API key" link)
  const urlTab = new URLSearchParams(window.location.search).get('tab');
  const [activeTab, setActiveTab] = useState(urlTab || defaultTab || 'modules');

  useEffect(() => {
    if (defaultTab && !canViewTab(activeTab)) {
      setActiveTab(defaultTab);
    }
  }, [defaultTab]);

  const navigate = useNavigate();
  const { isOwnerOrAdmin, currentRole } = useUserRole();
  const { integrations, isLoading: integrationsLoading, error: integrationsError, refetch: refetchIntegrations, updateIntegration, connectIntegration, disconnectIntegration, isConnecting } = useIntegrations();
  const { organizationId } = useOrganization();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [modules, setModules] = useState(moduleConfig);
  
  // Debug: Log organizationId and integrations (only on mount and when organizationId changes)
  useEffect(() => {
    console.log('Settings - organizationId:', organizationId);
    console.log('Settings - integrations count:', integrations.length);
    console.log('Settings - integrationsLoading:', integrationsLoading);
    console.log('Settings - integrationsError:', integrationsError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]); // Only depend on organizationId, not integrations

  // Fetch sync entities for all integrations
  useEffect(() => {
    const fetchSyncEntities = async () => {
      if (integrations.length === 0) return;

      console.log('[Settings] Fetching sync entities for integrations:', integrations.map(i => i.id));

      const entitiesMap: Record<string, any[]> = {};

      for (const integration of integrations) {
        let entities = await IntegrationSyncEntityService.getEntitiesForIntegration(integration.id);

        // If no entities exist for Dentally integration, initialize them
        if (entities.length === 0 && integration.integration_name === 'Dentally') {
          console.log(`[Settings] No sync entities found for Dentally integration ${integration.id}, initializing...`);
          await IntegrationSyncEntityService.initializeDefaultEntities(integration.id, 'Dentally');
          // Fetch again after initialization
          entities = await IntegrationSyncEntityService.getEntitiesForIntegration(integration.id);
          console.log(`[Settings] Initialized ${entities.length} sync entities for Dentally integration`);
        }

        console.log(`[Settings] Fetched ${entities.length} entities for integration ${integration.id}:`, entities);
        entitiesMap[integration.id] = entities;
      }

      setSyncEntitiesMap(entitiesMap);
    };

    fetchSyncEntities();
  }, [integrations]);

  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingIntegration, setEditingIntegration] = useState<{ id: string; name: string } | null>(null);
  const [editFormData, setEditFormData] = useState({
    apiEndpoint: '',
    apiKey: '',
    accountLabel: '',
  });
  const [showEditApiKey, setShowEditApiKey] = useState(false);



  // General settings state
  const [generalSettings, setGeneralSettings] = useState({
    companyName: '',
    fiscalYearStart: '',
    currency: '',
    dateFormat: '',
    timezone: '',
    language: '',
    showDecimals: false,
  });
  const [isLoadingSettings, setIsLoadingSettings] = useState(true);
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  // Notification settings
  const [notifications, setNotifications] = useState({
    emailAlerts: true,
    budgetVarianceAlerts: true,
    cashFlowWarnings: true,
    weeklyDigest: true,
    monthlyReports: true,
    integrationErrors: true,
  });


  // Sync entities state (from new table)
  const [syncEntitiesMap, setSyncEntitiesMap] = useState<Record<string, any[]>>({});

  // Load organization settings from database
  useEffect(() => {
    const loadSettings = async () => {
      if (!organizationId) return;

      setIsLoadingSettings(true);
      try {
        // Load organization data
        const { data: org, error: orgError } = await supabase
          .from('organizations')
          .select('name')
          .eq('id', organizationId)
          .single();

        if (orgError) throw orgError;

        // Load organization settings
        const { data: settings, error: settingsError } = await supabase
          .from('organization_settings')
          .select('*')
          .eq('organization_id', organizationId)
          .single();

        if (settingsError && settingsError.code !== 'PGRST116') {
          // PGRST116 = no rows returned, which is fine for first-time setup
          console.error('Error loading settings:', settingsError);
        }

        setGeneralSettings({
          companyName: org?.name || '',
          fiscalYearStart: settings?.financial_month_start ? String(settings.financial_month_start) : '',
          currency: settings?.currency || '',
          dateFormat: settings?.date_format || '',
          timezone: 'Europe/London', // TODO: Add to database if needed
          language: 'en-GB', // TODO: Add to database if needed
          showDecimals: settings?.show_decimals ?? false,
        });
      } catch (error) {
        console.error('Error loading settings:', error);
        toast.error('Failed to load settings');
      } finally {
        setIsLoadingSettings(false);
      }
    };

    loadSettings();
  }, [organizationId]);

  const handleModuleToggle = (moduleId: string) => {
    setModules(prev => prev.map(m =>
      m.id === moduleId ? { ...m, enabled: !m.enabled } : m
    ));
    toast.success("Module visibility settings have been saved.");
  };

  const handleConnect = (integration: Integration) => {
    // Check if API key and endpoint are set
    if (!integration.api_key || !integration.api_endpoints) {
      toast.error("Please set API Key and API Endpoint before connecting.");
      // Open edit dialog
      handleEditIntegration(integration);
      return;
    }

    // Connect using data from database
    connectIntegration({
      id: integration.id,
    });
  };

  const handleDisconnect = (integrationId: string) => {
    disconnectIntegration({ id: integrationId });
  };

  const handleSaveSettings = async () => {
    if (!organizationId) {
      toast.error("Organization not found");
      return;
    }

    setIsSavingSettings(true);
    try {
      const financialMonthValue = generalSettings.fiscalYearStart ? parseInt(generalSettings.fiscalYearStart) : null;

      // Check if organization_settings record exists
      const { data: existing, error: checkError } = await supabase
        .from('organization_settings')
        .select('id')
        .eq('organization_id', organizationId)
        .single();

      if (checkError && checkError.code !== 'PGRST116') {
        throw checkError;
      }

      const settingsData = {
        financial_month_start: financialMonthValue,
        currency: generalSettings.currency || null,
        date_format: generalSettings.dateFormat || null,
        show_decimals: generalSettings.showDecimals,
      };

      if (existing) {
        // Update existing settings
        const { error: updateError } = await supabase
          .from('organization_settings')
          .update({
            ...settingsData,
            updated_at: new Date().toISOString(),
          })
          .eq('organization_id', organizationId);

        if (updateError) throw updateError;
      } else {
        // Create new settings record
        const { error: insertError } = await supabase
          .from('organization_settings')
          .insert({
            organization_id: organizationId,
            ...settingsData,
          });

        if (insertError) throw insertError;
      }

      toast.success("Your settings have been saved successfully.");

      // Refresh organization data
      queryClient.invalidateQueries({ queryKey: ['organization', organizationId] });
      queryClient.invalidateQueries({ queryKey: [ORGANIZATION_DISPLAY_SETTINGS_QUERY_KEY, organizationId] });
    } catch (error: any) {
      console.error('Error saving settings:', error);
      toast.error(error.message || 'Failed to save settings');
    } finally {
      setIsSavingSettings(false);
    }
  };


  const handleEditIntegration = (integration: Integration) => {
    setEditingIntegration({ id: integration.id, name: integration.integration_name });
    const desc = integration.integration_description || '';
    setEditFormData({
      apiEndpoint: integration.api_endpoints || '',
      apiKey: integration.api_key || '',
      accountLabel: desc === 'Cloud-based dental practice management software' ? '' : desc,
    });
    setShowEditApiKey(false);
    setIsEditDialogOpen(true);
  };

  const handleSaveEdit = () => {
    if (!editingIntegration) return;

    const updates: Record<string, any> = {
      api_key: editFormData.apiKey.trim() || null,
    };

    // Only include endpoint for non-Dentally integrations
    if (editingIntegration.name !== 'Dentally') {
      updates.api_endpoints = editFormData.apiEndpoint.trim() || null;
    }

    // Save account label as integration_description for Dentally
    if (editingIntegration.name === 'Dentally') {
      updates.integration_description = editFormData.accountLabel.trim() || 'Cloud-based dental practice management software';
    }

    updateIntegration({
      id: editingIntegration.id,
      updates,
    });

    setIsEditDialogOpen(false);
    setEditingIntegration(null);
    setEditFormData({ apiEndpoint: '', apiKey: '', accountLabel: '' });
  };

  return (
    <MainLayout>
      <Helmet>
        <title>Platform Settings</title>
        <meta name="description" content="Configure application settings, integrations, data syncing, and platform-wide preferences." />
      </Helmet>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <SettingsIcon className="w-6 h-6" />
              Settings
            </h1>
            <p className="text-muted-foreground">Configure modules, integrations, and system preferences</p>
          </div>
          <Button onClick={handleSaveSettings} disabled={isSavingSettings} className="gap-2">
            {isSavingSettings ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Check className="w-4 h-4" />
                Save All Changes
              </>
            )}
          </Button>
        </div>

        {/* Settings Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="flex-wrap h-auto gap-1">
            {canViewTab('modules') && (
              <TabsTrigger value="modules" className="gap-2">
                <LayoutDashboard className="w-4 h-4" />
                Modules
              </TabsTrigger>
            )}
            {canViewTab('integrations') && (
              <TabsTrigger value="integrations" className="gap-2">
                <Link2 className="w-4 h-4" />
                Integrations
              </TabsTrigger>
            )}
            {canViewTab('general') && (
              <TabsTrigger value="general" className="gap-2">
                <Globe className="w-4 h-4" />
                General
              </TabsTrigger>
            )}
            {canViewTab('notifications') && (
              <TabsTrigger value="notifications" className="gap-2">
                <Bell className="w-4 h-4" />
                Notifications
              </TabsTrigger>
            )}
            {canViewTab('security') && (
              <TabsTrigger value="security" className="gap-2">
                <Shield className="w-4 h-4" />
                Security
              </TabsTrigger>
            )}
            {canViewTab('location-region') && (
              <TabsTrigger value="location-region" className="gap-2">
                <MapPin className="w-4 h-4" />
                Location & Region
              </TabsTrigger>
            )}
          </TabsList>

          {/* Modules Tab - Admin Only */}
          <RoleGate allowedRoles={['owner', 'admin']}>
            <TabsContent value="modules" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Module Configuration</CardTitle>
                <CardDescription>Enable or disable modules based on your organisation's needs</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {modules.map((module) => (
                    <div 
                      key={module.id}
                      className={cn(
                        "p-4 rounded-lg border transition-colors",
                        module.enabled 
                          ? "bg-card border-border" 
                          : "bg-muted/30 border-border/50"
                      )}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <div className={cn(
                            "w-10 h-10 rounded-lg flex items-center justify-center",
                            module.enabled 
                              ? "bg-primary/10 text-primary" 
                              : "bg-muted text-muted-foreground"
                          )}>
                            <module.icon className="w-5 h-5" />
                          </div>
                          <div>
                            <div className="font-medium text-foreground">{module.name}</div>
                            <div className="text-xs text-muted-foreground">{module.description}</div>
                          </div>
                        </div>
                        <Switch 
                          checked={module.enabled}
                          onCheckedChange={() => handleModuleToggle(module.id)}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Module-specific settings */}
            <Card>
              <CardHeader>
                <CardTitle>Module Defaults</CardTitle>
                <CardDescription>Configure default settings for each module</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <Label>Default Dashboard View</Label>
                    <Select defaultValue="executive">
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="executive">Executive Summary</SelectItem>
                        <SelectItem value="operational">Operational View</SelectItem>
                        <SelectItem value="financial">Financial Focus</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-4">
                    <Label>Default Comparison Period</Label>
                    <Select defaultValue="prior-year">
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="prior-month">Prior Month</SelectItem>
                        <SelectItem value="prior-year">Prior Year</SelectItem>
                        <SelectItem value="budget">Budget</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-4">
                    <Label>AR Aging Buckets</Label>
                    <Select defaultValue="standard">
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="standard">Standard (30/60/90/120+)</SelectItem>
                        <SelectItem value="weekly">Weekly (7/14/21/28+)</SelectItem>
                        <SelectItem value="custom">Custom Buckets</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-4">
                    <Label>Tax Year End</Label>
                    <Select defaultValue="march">
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="march">31 March</SelectItem>
                        <SelectItem value="december">31 December</SelectItem>
                        <SelectItem value="custom">Custom Date</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
          </RoleGate>

          {/* Integrations Tab - Admin Only */}
          <RoleGate allowedRoles={['owner', 'admin']}>
          <TabsContent value="integrations" className="space-y-6">
            {integrationsLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
              </div>
            ) : integrationsError ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <AlertCircle className="w-12 h-12 text-destructive mb-4" />
                  <p className="text-destructive font-medium mb-2">Error loading integrations</p>
                  <p className="text-muted-foreground text-sm mb-4">
                    {integrationsError instanceof Error ? integrationsError.message : 'Failed to fetch integrations'}
                  </p>
                  <Button onClick={() => refetchIntegrations()} variant="outline">
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Retry
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <>
              <PatientEconomicsPatCard organizationId={organizationId} />

              {/* Dental Integrations + Open Banking side by side */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 items-start">
                <DentallyIntegrationCard
                  integrations={integrations}
                  syncEntitiesMap={syncEntitiesMap}
                  organizationId={organizationId}
                  userId={user?.id}
                  onRefetch={refetchIntegrations}
                  onEditIntegration={handleEditIntegration}
                  onDisconnect={(id) => disconnectIntegration({ id })}
                  onConnect={handleConnect}
                  isConnecting={isConnecting}
                />
                {/* PlaidSection spans 3 cols so bank list can fill the empty space beside it */}
                <div className="lg:col-span-3">
                  <PlaidSection orgId={organizationId} />
                </div>
              </div>

              {/* Non-Dentally integrations (Implicit Accounting, etc.) */}
              {integrations.filter(int => int.integration_name !== 'Dentally').map((integration) => {
                const logo = integrationLogos[integration.integration_name] || '🔌';

                const entities = syncEntitiesMap[integration.id] || [];
                const latestEntitySync = entities
                  .map(e => e.last_synced_at)
                  .filter(Boolean)
                  .sort()
                  .at(-1);
                const lastSyncDate = latestEntitySync || integration.sync_at;
                const lastSync = lastSyncDate
                  ? new Date(lastSyncDate).toLocaleString('en-GB', {
                      year: 'numeric',
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit'
                    }).replace(',', '')
                  : 'Never';

                const maskedApiKey = integration.api_key
                  ? integration.api_key.substring(0, 8) + '••••••••••••••••'
                  : 'Not set';

                return (
                  <Card key={integration.id}>
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-4">
                          <div className={cn(
                            "w-14 h-14 rounded-xl flex items-center justify-center text-2xl",
                            integration.integration_name === 'Dentally' 
                              ? "bg-gradient-to-br from-blue-500 to-cyan-500"
                              : "bg-gradient-to-br from-green-500 to-emerald-500"
                          )}>
                            {logo}
                          </div>
                          <div>
                            <CardTitle className="flex items-center gap-2">
                              {integration.integration_name}
                              <Badge variant={integration.is_connected ? 'default' : 'secondary'} className="ml-2">
                                {integration.is_connected ? (
                                  <><Check className="w-3 h-3 mr-1" /> Connected</>
                                ) : (
                                  <><X className="w-3 h-3 mr-1" /> Disconnected</>
                                )}
                              </Badge>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-5 w-5 ml-2 text-muted-foreground hover:text-foreground"
                                onClick={() => handleEditIntegration(integration)}
                                title="Edit integration settings"
                              >
                                <Pencil className="w-4 h-4" />
                              </Button>
                            </CardTitle>
                            <CardDescription>{integration.integration_description || ''}</CardDescription>
                          </div>
                        </div>
                        {integration.is_connected ? (
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleDisconnect(integration.id)}
                              disabled={isConnecting === integration.id}
                              className="gap-2"
                            >
                              <X className="w-4 h-4" />
                              Disconnect
                            </Button>
                          </div>
                        ) : (
                          <Button
                            variant="default"
                            size="sm"
                            onClick={() => handleConnect(integration)}
                            disabled={
                              isConnecting === integration.id || 
                              integration.integration_name === 'Implicit Accounting' // Disable for Implicit Accounting
                            }
                            className="gap-2"
                            title={
                              integration.integration_name === 'Implicit Accounting' 
                                ? 'Data not available for this integration' 
                                : undefined
                            }
                          >
                            <Plug className={cn("w-4 h-4", isConnecting === integration.id && "animate-pulse")} />
                            {isConnecting === integration.id ? 'Connecting...' : 'Connect'}
                          </Button>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 gap-6 items-start">
                        {/* Left column: Last Sync + API Key */}
                        <div className="space-y-6">
                          <div className="p-3 bg-muted/30 rounded-lg">
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                              <Clock className="w-3 h-3" />
                              Last Sync
                            </div>
                            {lastSyncDate ? (
                              <>
                                <div className="font-semibold text-foreground">
                                  {formatDistanceToNow(new Date(lastSyncDate), { addSuffix: true })}
                                </div>
                                <div className="text-xs text-muted-foreground mt-0.5">
                                  {format(new Date(lastSyncDate), 'dd MMM yyyy, HH:mm')}
                                </div>
                              </>
                            ) : (
                              <div className="font-medium text-muted-foreground">Never synced</div>
                            )}
                          </div>

                        </div>

                      </div>{/* end grid */}
                    </CardContent>
                  </Card>
                );
              })}
              </>
            )}

            {/* Accounting Integrations Hub - Xero, QuickBooks, iplicit */}
            <AccountingIntegrationsHub />

            {/* Setup Categories - Map chart of accounts to cash flow categories */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ListChecks className="h-5 w-5" />
                  Setup Categories
                </CardTitle>
                <CardDescription>
                  Map your chart of accounts to cash flow categories and expense types (Dental) for reporting.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button asChild variant="outline" className="gap-2">
                  <Link to="/settings/setup-categories">
                    Configure Setup Categories
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
              </CardContent>
            </Card>

            {/* AI Suggested Pricing — editable prompt + cache TTL + model */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="h-5 w-5" />
                  AI Suggested Pricing
                </CardTitle>
                <CardDescription>
                  Edit the AI prompt, choose the Claude model, set how often
                  suggestions regenerate, and toggle web search.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button asChild variant="outline" className="gap-2">
                  <Link to="/settings/ai-pricing">
                    Configure AI Pricing
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
          </RoleGate>

          {/* General Tab - All Users */}
          <TabsContent value="general" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Organisation Settings</CardTitle>
                <CardDescription>Basic configuration for your organisation</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground uppercase">Registered Name</Label>
                    <p className="text-sm font-medium">{generalSettings.companyName || 'Not set'}</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Financial Month Start</Label>
                    <Select
                      value={generalSettings.fiscalYearStart}
                      onValueChange={(v) => setGeneralSettings(prev => ({ ...prev, fiscalYearStart: v }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select month" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">January</SelectItem>
                        <SelectItem value="2">February</SelectItem>
                        <SelectItem value="3">March</SelectItem>
                        <SelectItem value="4">April</SelectItem>
                        <SelectItem value="5">May</SelectItem>
                        <SelectItem value="6">June</SelectItem>
                        <SelectItem value="7">July</SelectItem>
                        <SelectItem value="8">August</SelectItem>
                        <SelectItem value="9">September</SelectItem>
                        <SelectItem value="10">October</SelectItem>
                        <SelectItem value="11">November</SelectItem>
                        <SelectItem value="12">December</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Currency</Label>
                    <Select 
                      value={generalSettings.currency}
                      onValueChange={(v) => setGeneralSettings(prev => ({ ...prev, currency: v }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="GBP">GBP (£)</SelectItem>
                        <SelectItem value="EUR">EUR (€)</SelectItem>
                        <SelectItem value="USD">USD ($)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Date Format</Label>
                    <Select 
                      value={generalSettings.dateFormat}
                      onValueChange={(v) => setGeneralSettings(prev => ({ ...prev, dateFormat: v }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="DD/MM/YYYY">DD/MM/YYYY</SelectItem>
                        <SelectItem value="MM/DD/YYYY">MM/DD/YYYY</SelectItem>
                        <SelectItem value="YYYY-MM-DD">YYYY-MM-DD</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Timezone</Label>
                    <Select 
                      value={generalSettings.timezone}
                      onValueChange={(v) => setGeneralSettings(prev => ({ ...prev, timezone: v }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Europe/London">Europe/London (GMT/BST)</SelectItem>
                        <SelectItem value="Europe/Dublin">Europe/Dublin</SelectItem>
                        <SelectItem value="Europe/Paris">Europe/Paris</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Language</Label>
                    <Select 
                      value={generalSettings.language}
                      onValueChange={(v) => setGeneralSettings(prev => ({ ...prev, language: v }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="en-GB">English (UK)</SelectItem>
                        <SelectItem value="en-US">English (US)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Display Preferences</CardTitle>
                <CardDescription>Customise how data is displayed</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg">
                  <div>
                    <div className="font-medium text-foreground">Compact Mode</div>
                    <div className="text-sm text-muted-foreground">Show more data with reduced spacing</div>
                  </div>
                  <Switch />
                </div>
                <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg">
                  <div>
                    <div className="font-medium text-foreground">Show Decimals</div>
                    <div className="text-sm text-muted-foreground">Display decimal places in currency values</div>
                  </div>
                  <Switch
                    checked={generalSettings.showDecimals}
                    onCheckedChange={(checked) =>
                      setGeneralSettings(prev => ({ ...prev, showDecimals: checked }))
                    }
                  />
                </div>
                <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg">
                  <div>
                    <div className="font-medium text-foreground">Negative Values in Red</div>
                    <div className="text-sm text-muted-foreground">Highlight negative values with red colour</div>
                  </div>
                  <Switch defaultChecked />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Notifications Tab */}
          <TabsContent value="notifications" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Alert Settings</CardTitle>
                <CardDescription>Configure when and how you receive notifications</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg">
                  <div>
                    <div className="font-medium text-foreground">Email Alerts</div>
                    <div className="text-sm text-muted-foreground">Receive important alerts via email</div>
                  </div>
                  <Switch 
                    checked={notifications.emailAlerts}
                    onCheckedChange={(v) => setNotifications(prev => ({ ...prev, emailAlerts: v }))}
                  />
                </div>
                <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg">
                  <div>
                    <div className="font-medium text-foreground">Budget Variance Alerts</div>
                    <div className="text-sm text-muted-foreground">Alert when variance exceeds threshold</div>
                  </div>
                  <Switch 
                    checked={notifications.budgetVarianceAlerts}
                    onCheckedChange={(v) => setNotifications(prev => ({ ...prev, budgetVarianceAlerts: v }))}
                  />
                </div>
                <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg">
                  <div>
                    <div className="font-medium text-foreground">Cash Flow Warnings</div>
                    <div className="text-sm text-muted-foreground">Alert when cash falls below minimum</div>
                  </div>
                  <Switch 
                    checked={notifications.cashFlowWarnings}
                    onCheckedChange={(v) => setNotifications(prev => ({ ...prev, cashFlowWarnings: v }))}
                  />
                </div>
                <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg">
                  <div>
                    <div className="font-medium text-foreground">Integration Errors</div>
                    <div className="text-sm text-muted-foreground">Alert when sync fails or errors occur</div>
                  </div>
                  <Switch 
                    checked={notifications.integrationErrors}
                    onCheckedChange={(v) => setNotifications(prev => ({ ...prev, integrationErrors: v }))}
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Scheduled Reports</CardTitle>
                <CardDescription>Automated report delivery</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg">
                  <div>
                    <div className="font-medium text-foreground">Weekly Digest</div>
                    <div className="text-sm text-muted-foreground">Summary of key metrics every Monday</div>
                  </div>
                  <Switch 
                    checked={notifications.weeklyDigest}
                    onCheckedChange={(v) => setNotifications(prev => ({ ...prev, weeklyDigest: v }))}
                  />
                </div>
                <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg">
                  <div>
                    <div className="font-medium text-foreground">Monthly Reports</div>
                    <div className="text-sm text-muted-foreground">Full financial report on 1st of each month</div>
                  </div>
                  <Switch 
                    checked={notifications.monthlyReports}
                    onCheckedChange={(v) => setNotifications(prev => ({ ...prev, monthlyReports: v }))}
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Security Tab - Admin Only */}
          <RoleGate allowedRoles={['owner', 'admin']}>
          <TabsContent value="security" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Access Control</CardTitle>
                <CardDescription>Manage security and access settings</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg">
                  <div>
                    <div className="font-medium text-foreground">Two-Factor Authentication</div>
                    <div className="text-sm text-muted-foreground">Require 2FA for all users</div>
                  </div>
                  <Switch defaultChecked />
                </div>
                <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg">
                  <div>
                    <div className="font-medium text-foreground">Session Timeout</div>
                    <div className="text-sm text-muted-foreground">Auto-logout after inactivity</div>
                  </div>
                  <Select defaultValue="30">
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="15">15 minutes</SelectItem>
                      <SelectItem value="30">30 minutes</SelectItem>
                      <SelectItem value="60">1 hour</SelectItem>
                      <SelectItem value="120">2 hours</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg">
                  <div>
                    <div className="font-medium text-foreground">IP Whitelist</div>
                    <div className="text-sm text-muted-foreground">Restrict access to specific IP addresses</div>
                  </div>
                  <Switch />
                </div>
                <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg">
                  <div>
                    <div className="font-medium text-foreground">Audit Logging</div>
                    <div className="text-sm text-muted-foreground">Log all user actions for compliance</div>
                  </div>
                  <Switch defaultChecked />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Data Protection</CardTitle>
                <CardDescription>GDPR and data handling settings</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                  <div className="flex items-start gap-3">
                    <Shield className="w-5 h-5 text-blue-500 mt-0.5" />
                    <div>
                      <div className="font-medium text-foreground">GDPR Compliance</div>
                      <div className="text-sm text-muted-foreground mt-1">
                        Your data is processed in accordance with GDPR regulations. Patient data is encrypted at rest and in transit.
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg">
                  <div>
                    <div className="font-medium text-foreground">Data Retention Period</div>
                    <div className="text-sm text-muted-foreground">How long to keep historical data</div>
                  </div>
                  <Select defaultValue="7years">
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="3years">3 years</SelectItem>
                      <SelectItem value="5years">5 years</SelectItem>
                      <SelectItem value="7years">7 years</SelectItem>
                      <SelectItem value="10years">10 years</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
          </RoleGate>

          {/* Location & Region Tab - Admin Only */}
          <RoleGate allowedRoles={['owner', 'admin']}>
          <TabsContent value="location-region" className="space-y-6">
            <LocationRegionManagement />
          </TabsContent>
          </RoleGate>
        </Tabs>

        {/* Edit Integration Dialog */}
        <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
            <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>
                Edit {editingIntegration?.name || 'Integration'}
              </DialogTitle>
              <DialogDescription>
                Update the integration settings and configuration.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              {editingIntegration?.name === 'Dentally' && (
                <div className="space-y-2">
                  <Label>Title</Label>
                  <Input
                    type="text"
                    value={editFormData.accountLabel}
                    onChange={(e) => setEditFormData(prev => ({ ...prev, accountLabel: e.target.value }))}
                    placeholder="e.g. London Practice, Manchester Clinic"
                  />
                  <p className="text-xs text-muted-foreground">A friendly name to identify this account</p>
                </div>
              )}
              <div className="space-y-2">
                <Label>API Key</Label>
                <div className="relative">
                  <Input
                    type={showEditApiKey ? 'text' : 'password'}
                    value={editFormData.apiKey}
                    onChange={(e) => setEditFormData(prev => ({ ...prev, apiKey: e.target.value }))}
                    placeholder="Enter API key"
                    className="font-mono pr-10"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-full px-3"
                    onClick={() => setShowEditApiKey(prev => !prev)}
                  >
                    {showEditApiKey
                      ? <EyeOff className="w-4 h-4 text-muted-foreground" />
                      : <Eye className="w-4 h-4 text-muted-foreground" />}
                  </Button>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleSaveEdit}>
                <Check className="w-4 h-4 mr-2" />
                Save Changes
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

      </div>
    </MainLayout>
  );
}
