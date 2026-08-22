import { useState, useEffect, useMemo } from 'react';
import { usePermissions } from '@/hooks/usePermissions';
import { useTabPermissions } from '@/hooks/useTabPermissions';
import { useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { useOrganization, Organization as OrganizationType } from '@/hooks/useOrganization';
import { PLAN_TIERS, PLAN_LABELS, PLAN_FEATURES, PlanTier } from '@/lib/planRegistry';
import { LocationDetailContent } from '@/components/organization/LocationDetailContent';
import { useAuth } from '@/hooks/useAuth';
import { usePaymentPlans } from '@/hooks/usePaymentPlans';
import { useInvoiceFolders } from '@/hooks/useInvoiceFolders';
import { useFilters } from '@/contexts/FilterContext';
// Note: Inbound emails are only created at location level during onboarding, not at organization level
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2, Building2, MapPin, Phone, Mail, Users, Calendar, Edit, ArrowLeft, Settings, Plus, Save, ChevronsUpDown, Trash2, Pencil, FileText, FolderIcon, Check, CheckCircle2 } from 'lucide-react';
import { ImageUpload } from '@/components/ui/image-upload';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

export default function Organization() {
  const { can } = usePermissions();
  const { canViewTab, defaultTab } = useTabPermissions('organization');
  const [activeTab, setActiveTab] = useState(defaultTab || 'team-members');

  useEffect(() => {
    if (defaultTab && !canViewTab(activeTab)) {
      setActiveTab(defaultTab);
    }
  }, [defaultTab]);

  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, loading: authLoading } = useAuth();
  const { selectedLocationId } = useFilters();
  const { organization, isLoading, error } = useOrganization();
  const { paymentPlans: allPaymentPlans, isLoading: isLoadingPaymentPlans } = usePaymentPlans();

  // Filter payment plans: location-specific + global plans (no site_id from Dentally)
  const paymentPlans = selectedLocationId
    ? allPaymentPlans.filter(plan => plan.location_id === selectedLocationId || !plan.location_id)
    : allPaymentPlans;

  // Fetch all organizations the user has access to (via user_id, created_by, or user_roles)
  const { data: allOrganizations = [], isLoading: isLoadingAllOrgs } = useQuery({
    queryKey: ['all-user-organizations', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];

      // 1. Fetch orgs where user is owner (user_id) or creator (created_by)
      const { data: ownedOrgs, error: ownedError } = await supabase
        .from('organizations')
        .select('*')
        .or(`user_id.eq.${user.id},created_by.eq.${user.id}`)
        .order('name');

      if (ownedError) throw ownedError;

      // 2. Fetch org IDs from user_roles for this user
      const { data: roleOrgs, error: roleError } = await supabase
        .from('user_roles')
        .select('organization_id')
        .eq('user_id', user.id);

      if (roleError) throw roleError;

      const roleOrgIds = (roleOrgs || [])
        .map(r => r.organization_id)
        .filter(Boolean) as string[];

      // 3. Fetch those orgs not already in ownedOrgs
      const ownedIds = new Set((ownedOrgs || []).map(o => o.id));
      const missingIds = roleOrgIds.filter(id => !ownedIds.has(id));

      let roleBasedOrgs: OrganizationType[] = [];
      if (missingIds.length > 0) {
        const { data: extraOrgs, error: extraError } = await supabase
          .from('organizations')
          .select('*')
          .in('id', missingIds)
          .order('name');

        if (extraError) throw extraError;
        roleBasedOrgs = (extraOrgs || []) as OrganizationType[];
      }

      // Combine and deduplicate
      return [...(ownedOrgs || []), ...roleBasedOrgs] as OrganizationType[];
    },
    enabled: !!user?.id,
  });

  // Fetch the organization for the selected location
  const { data: locationOrganization, isLoading: isLoadingLocationOrg } = useQuery({
    queryKey: ['location-organization', selectedLocationId],
    queryFn: async () => {
      if (!selectedLocationId) return null;

      // Get the organization_id from the location
      const { data: locationData, error: locationError } = await supabase
        .from('practice_locations')
        .select('organization_id')
        .eq('id', selectedLocationId)
        .single();

      if (locationError) throw locationError;
      if (!locationData?.organization_id) return null;

      // Fetch the organization
      const { data: orgData, error: orgError } = await supabase
        .from('organizations')
        .select('*')
        .eq('id', locationData.organization_id)
        .single();

      if (orgError) throw orgError;
      return orgData as OrganizationType;
    },
    enabled: !!selectedLocationId,
  });

  // Fetch all practice locations for all organizations the user has access to
  const { data: allLocations = [], isLoading: isLoadingLocations } = useQuery({
    queryKey: ['all-practice-locations', allOrganizations?.map(o => o.id)],
    queryFn: async () => {
      if (!allOrganizations || allOrganizations.length === 0) return [];

      const orgIds = allOrganizations.map(o => o.id);

      const { data: locationsData, error: locationsError } = await supabase
        .from('practice_locations')
        .select('*')
        .in('organization_id', orgIds)
        .is('deleted_at', null)
        .order('location_name');

      if (locationsError) throw locationsError;
      return locationsData || [];
    },
    enabled: !!allOrganizations && allOrganizations.length > 0,
  });

  // Determine which organizations to display
  const showAllOrganizations = !selectedLocationId;
  const displayOrganizations = useMemo(
    () => showAllOrganizations ? allOrganizations : (locationOrganization ? [locationOrganization] : []),
    [showAllOrganizations, allOrganizations, locationOrganization]
  );

  // Use location-specific organization when a location is selected, otherwise use default
  const currentOrganization = selectedLocationId ? locationOrganization : organization;
  const [isAddPracticeOpen, setIsAddPracticeOpen] = useState(false);
  const [practiceForm, setPracticeForm] = useState({
    name: '',
    address: '',
    city: '',
    state: '',
    zipCode: '',
    phone: '',
    email: '',
    chairs: '',
  });

  // Chart of Accounts state
  const [chartOfAccounts, setChartOfAccounts] = useState<any[]>([]);
  const [isLoadingCOA, setIsLoadingCOA] = useState(true);

  // Set of external tenant UUIDs (`platform_integration_organizations.platform_org_id`)
  // linked to the currently-selected location. We filter COA by this value
  // because `xero_chart_of_accounts.platform_integration_organization_id`
  // stores the *external* Xero tenant UUID (see xeroService.ts:982), and
  // filtering by `platform_integration_id` is insufficient since one OAuth
  // connection can cover many Xero tenants.
  const [locationLinkedPlatformOrgIds, setLocationLinkedPlatformOrgIds] = useState<Set<string>>(new Set());

  // Edit Organization Modal state
  const [isEditOrgModalOpen, setIsEditOrgModalOpen] = useState(false);
  const [editOrgForm, setEditOrgForm] = useState({
    name: '',
    email: '',
    phone: '',
    address: '',
    logo_url: '',
  });
  const [isSavingOrg, setIsSavingOrg] = useState(false);

  // Initialize edit form when modal opens
  useEffect(() => {
    if (isEditOrgModalOpen && displayOrganizations.length > 0) {
      const org = displayOrganizations[0];
      setEditOrgForm({
        name: org?.name || '',
        email: org?.email || '',
        phone: org?.phone || '',
        address: org?.address || '',
        logo_url: org?.logo_url || '',
      });
    }
  }, [isEditOrgModalOpen, displayOrganizations]);

  // Save organization changes
  const handleSaveOrganization = async () => {
    if (!displayOrganizations[0]?.id) return;

    setIsSavingOrg(true);
    try {
      const updateData: any = {
        name: editOrgForm.name,
        email: editOrgForm.email || null,
        phone: editOrgForm.phone || null,
        address: editOrgForm.address || null,
        logo_url: editOrgForm.logo_url || null,
      };

      const { error } = await supabase
        .from('organizations')
        .update(updateData)
        .eq('id', displayOrganizations[0].id);

      if (error) throw error;

      toast.success('Organization updated successfully');
      queryClient.invalidateQueries({ queryKey: ['all-user-organizations'] });
      queryClient.invalidateQueries({ queryKey: ['organization'] });
      setIsEditOrgModalOpen(false);
    } catch (error) {
      console.error('Error updating organization:', error);
      toast.error('Failed to update organization');
    } finally {
      setIsSavingOrg(false);
    }
  };

  // Rules state
  interface Rule {
    id: string;
    user_id: string | null;
    email: string;
    inbound_email_address: string | null;
    inbound_email_id: string | null;
    organization_id: string | null;
    folder_id: string | null;
    chart_of_account_id: string | null;
    is_active: boolean;
    created_at: string;
    updated_at: string;
  }
  const [rules, setRules] = useState<Rule[]>([]);
  const [isLoadingRules, setIsLoadingRules] = useState(false);
  const [isRuleModalOpen, setIsRuleModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<Rule | null>(null);
  const [ruleForm, setRuleForm] = useState({
    email: '',
    inbound_email_id: '',
    folder_id: '',
    chart_of_account_id: '',
  });
  const [isSavingRule, setIsSavingRule] = useState(false);
  const [isDeletingRule, setIsDeletingRule] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [ruleToDelete, setRuleToDelete] = useState<string | null>(null);

  // Organization inbound emails for dropdown
  interface InboundEmail {
    id: string;
    email_type: string;
    inbound_email_address: string;
    location_id: string | null;
  }
  const [organizationInboundEmails, setOrganizationInboundEmails] = useState<InboundEmail[]>([]);
  // Track the location of the selected inbound email for folder filtering
  const [selectedInboundEmailLocationId, setSelectedInboundEmailLocationId] = useState<string | null>(null);
  const [isLoadingInboundEmails, setIsLoadingInboundEmails] = useState(false);

  // Use invoice folders hook - filtered by the inbound email's location for rules, or global selectedLocationId
  // For rules modal, use selectedInboundEmailLocationId; otherwise use global selectedLocationId
  const effectiveFolderLocationId = selectedInboundEmailLocationId || selectedLocationId;
  const { folders: invoiceFolders, isLoading: isLoadingFolders } = useInvoiceFolders({
    selectedLocationId: effectiveFolderLocationId
  });

  // Inbound email state
  const [costEmail, setCostEmail] = useState<string | null>(null);
  const [salesEmail, setSalesEmail] = useState<string | null>(null);
  const [isCreatingInboundEmail, setIsCreatingInboundEmail] = useState(false);

  // Fetch existing inbound emails when organization loads (no creation - emails are created at location level during onboarding)
  useEffect(() => {
    console.log('[Organization] useEffect triggered, organization:', {
      id: currentOrganization?.id,
      name: currentOrganization?.name
    });

    const fetchInboundEmails = async () => {
      if (!currentOrganization?.id) {
        console.log('[Organization] Skipping inbound email fetch - missing id');
        return;
      }

      console.log('[Organization] Fetching existing inbound emails...');
      setIsCreatingInboundEmail(true);
      try {
        // Fetch existing inbound emails for this organization (location-level emails)
        const { data: emails, error } = await supabase
          .from('location_inbound_emails')
          .select('email_type, inbound_email_address')
          .eq('organization_id', currentOrganization.id)
          .eq('inbound_created', 1);

        if (error) {
          console.error('[Organization] Error fetching inbound emails:', error);
          return;
        }

        console.log('[Organization] Fetched inbound emails:', emails);

        // Find cost and sales emails (could be org-level or location-level)
        const costEmail = emails?.find(e => e.email_type === 'cost');
        const salesEmail = emails?.find(e => e.email_type === 'sales');

        setCostEmail(costEmail?.inbound_email_address || null);
        setSalesEmail(salesEmail?.inbound_email_address || null);
      } catch (error) {
        console.error('[Organization] Error fetching inbound emails:', error);
      } finally {
        setIsCreatingInboundEmail(false);
      }
    };

    fetchInboundEmails();
  }, [currentOrganization?.id]);

  // Fetch organization inbound emails for the rules dropdown
  useEffect(() => {
    const fetchOrganizationInboundEmails = async () => {
      if (!currentOrganization?.id) return;

      setIsLoadingInboundEmails(true);
      try {
        const { data, error } = await supabase
          .from('location_inbound_emails')
          .select('id, email_type, inbound_email_address, location_id')
          .eq('organization_id', currentOrganization.id)
          .eq('inbound_created', 1)
          .order('email_type', { ascending: true });

        if (error) throw error;

        setOrganizationInboundEmails(data || []);
      } catch (error) {
        console.error('Error fetching organization inbound emails:', error);
      } finally {
        setIsLoadingInboundEmails(false);
      }
    };

    fetchOrganizationInboundEmails();
  }, [currentOrganization?.id, costEmail, salesEmail]);

  // Fetch related data
  const { data: practices } = useQuery({
    queryKey: ['practices', currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization?.id) return [];
      const { data } = await supabase
        .from('practices')
        .select('*')
        .eq('organization_id', currentOrganization.id)
        .order('created_at', { ascending: false });
      return data || [];
    },
    enabled: !!currentOrganization?.id,
  });

  // Fetch Chart of Accounts for organization (always fetch to display names)
  // Queries both xero_chart_of_accounts (Xero) and iplicit_chart_of_accounts (Iplicit Node backend)
  useEffect(() => {
    const fetchChartOfAccounts = async () => {
      if (!currentOrganization?.id) {
        setChartOfAccounts([]);
        return;
      }

      setIsLoadingCOA(true);
      try {
        let allAccounts: any[] = [];

        // Query both COA tables + platform_integrations + orgs (for connection names) in parallel
        const [platformResult, iplicitResult, connectionsResult, orgsResult] = await Promise.all([
          supabase
            .from('xero_chart_of_accounts' as any)
            .select('*')
            .eq('organization_id', currentOrganization.id)
            .eq('is_active', true)
            .order('account_type', { ascending: true })
            .order('account_code', { ascending: true }),
          supabase
            .from('iplicit_chart_of_accounts' as any)
            .select('*')
            .eq('organization_id', currentOrganization.id)
            .order('account_type', { ascending: true })
            .order('code', { ascending: true }),
          (supabase as any)
            .from('platform_integrations')
            .select('id, platform_name, client_id')
            .eq('organization_id', currentOrganization.id)
            .in('platform_name', ['iplicit', 'xero', 'Iplicit', 'Xero']),
          (supabase as any)
            .from('platform_integration_organizations')
            .select('platform_integration_id, platform_org_name, platform_name')
            .eq('organization_id', currentOrganization.id),
        ]);

        // Build connection name lookup: platform_integration_id → display name
        // Use org names from platform_integration_organizations (Xero tenant names, Iplicit entity names)
        const connectionNameMap = new Map<string, string>();
        const orgNameMap = new Map<string, string>();

        // Row-UUID → Xero GUID map so availableAccounts downstream can filter
        // COA rows (which store xero_tenant_id as UUID) against locationTenantIds
        // (which collects Xero tenant GUIDs).
        const tenantUuidToGuid = new Map<string, string>();
        // Per-TENANT name lookup: one Xero connection can carry several
        // organisations, and the connection-level orgNameMap keeps only the
        // last tenant's name — labelling all accounts with it mislabels the
        // other organisations' accounts. Keyed by tenant row UUID and GUID.
        const xeroTenantNameByKey = new Map<string, string>();

        // First, build org name map from platform_integration_organizations
        if (!orgsResult.error && orgsResult.data) {
          const { data: tenantRows } = await (supabase as any)
            .from('platform_integration_organizations')
            .select('id, platform_org_id, platform_org_name, platform_integration_id')
            .eq('organization_id', currentOrganization.id);
          for (const r of (tenantRows ?? []) as any[]) {
            if (r.id && r.platform_org_id) tenantUuidToGuid.set(r.id, r.platform_org_id);
            if (r.platform_org_name) {
              if (r.id) xeroTenantNameByKey.set(r.id, r.platform_org_name);
              if (r.platform_org_id) xeroTenantNameByKey.set(r.platform_org_id, r.platform_org_name);
            }
          }
          for (const org of orgsResult.data as any[]) {
            if (org.platform_org_name && org.platform_integration_id) {
              orgNameMap.set(org.platform_integration_id, org.platform_org_name);
            }
          }
        }

        // Then build connection name map, preferring org names
        if (!connectionsResult.error && connectionsResult.data) {
          for (const conn of connectionsResult.data as any[]) {
            const platform = (conn.platform_name || '').charAt(0).toUpperCase() + (conn.platform_name || '').slice(1);
            const name = orgNameMap.get(conn.id) || conn.client_id || '';
            connectionNameMap.set(conn.id, name ? `${platform} · ${name}` : platform);
          }
        }

        // Add xero_chart_of_accounts records (Xero) with resolved GUID alias.
        if (!platformResult.error && platformResult.data?.length > 0) {
          const withConnectionName = (platformResult.data as any[]).map((acc: any) => {
            // Label each account with ITS OWN organisation (tenant) name; the
            // connection-level name is a fallback only.
            const tenantName = xeroTenantNameByKey.get(acc.xero_tenant_id);
            return {
              ...acc,
              platform_integration_organization_id:
                tenantUuidToGuid.get(acc.xero_tenant_id) || acc.xero_tenant_id || null,
              _connectionName: tenantName
                ? `Xero · ${tenantName}`
                : (connectionNameMap.get(acc.platform_integration_id) || acc.platform_name || 'Xero'),
            };
          });
          allAccounts.push(...withConnectionName);
        } else if (platformResult.error) {
          console.warn('[COA] xero_chart_of_accounts query error:', platformResult.error);
        }

        // Add iplicit_chart_of_accounts records (Iplicit Node backend) — normalize columns
        if (!iplicitResult.error && iplicitResult.data?.length > 0) {
          const normalized = (iplicitResult.data as any[]).map((acc: any) => ({
            ...acc,
            xero_account_id: acc.account_id,
            account_code: acc.code,
            account_name: acc.name,
            account_type: acc.account_type,
            is_active: acc.is_active,
            description: acc.description,
            _connectionName: connectionNameMap.get(acc.platform_integration_id) || 'Iplicit',
          }));
          allAccounts.push(...normalized);
        } else if (iplicitResult.error) {
          console.warn('[COA] iplicit_chart_of_accounts query error:', iplicitResult.error);
        }

        console.log('[COA] Fetched accounts:', {
          platformCount: platformResult.data?.length ?? 0,
          iplicitCount: iplicitResult.data?.length ?? 0,
          totalCount: allAccounts.length,
          connections: Object.fromEntries(connectionNameMap),
        });

        // Remove duplicates (preserve accounts from different connections AND
        // different organisations/tenants of the same connection — the three
        // Xero orgs share the standard chart, so a connection-level key
        // collapsed same-named accounts to one arbitrary org's copy).
        const tenantKey = (a: any) => a.platform_integration_organization_id ?? a.xero_tenant_id ?? null;
        const uniqueAccounts = allAccounts.filter((account: any, index: number, self: any[]) =>
          index === self.findIndex((a: any) =>
            a.account_code === account.account_code &&
            a.account_name === account.account_name &&
            a.platform_integration_id === account.platform_integration_id &&
            tenantKey(a) === tenantKey(account)
          )
        );
        console.log('[COA] Unique accounts:', uniqueAccounts.length);
        setChartOfAccounts(uniqueAccounts);
      } catch (error) {
        console.error('Error fetching chart of accounts:', error);
        setChartOfAccounts([]);
      } finally {
        setIsLoadingCOA(false);
      }
    };

    fetchChartOfAccounts();
  }, [currentOrganization?.id]);

  // Resolve the accounting tenants linked to the selected location so the
  // Chart-of-Accounts dropdowns can be filtered to just that location's
  // accounts. We go: location → mapping.platform_integration_organizations_id
  // → platform_integration_organizations.platform_org_id (external Xero
  // tenant UUID), which is what the COA table actually stores.
  useEffect(() => {
    let cancelled = false;
    const fetchLinkedPlatformOrgs = async () => {
      if (!selectedLocationId) {
        setLocationLinkedPlatformOrgIds(new Set());
        return;
      }
      // Step 1: mapping row(s) for this location.
      const { data: mappingRows, error: mappingErr } = await (supabase as any)
        .from('platform_integration_organization_mapping')
        .select('platform_integration_organizations_id')
        .eq('location_id', selectedLocationId);
      if (cancelled) return;
      if (mappingErr) {
        console.warn('[COA] Location → mapping lookup failed:', mappingErr.message);
        setLocationLinkedPlatformOrgIds(new Set());
        return;
      }
      const internalOrgIds = Array.from(new Set(
        (mappingRows ?? [])
          .map((r: any) => r.platform_integration_organizations_id)
          .filter((id: any): id is string => !!id),
      ));
      if (internalOrgIds.length === 0) {
        setLocationLinkedPlatformOrgIds(new Set());
        return;
      }
      // Step 2: resolve the external tenant UUIDs.
      const { data: orgRows, error: orgErr } = await (supabase as any)
        .from('platform_integration_organizations')
        .select('id, platform_org_id')
        .in('id', internalOrgIds);
      if (cancelled) return;
      if (orgErr) {
        console.warn('[COA] platform_integration_organizations lookup failed:', orgErr.message);
        setLocationLinkedPlatformOrgIds(new Set());
        return;
      }
      const tenantIds = new Set<string>();
      for (const o of (orgRows ?? []) as any[]) {
        if (o.platform_org_id) tenantIds.add(o.platform_org_id);
      }
      console.log('[COA] location-linked tenants', {
        locationId: selectedLocationId,
        mappingRows: mappingRows?.length ?? 0,
        tenantIds: Array.from(tenantIds),
      });
      setLocationLinkedPlatformOrgIds(tenantIds);
    };
    fetchLinkedPlatformOrgs();
    return () => { cancelled = true; };
  }, [selectedLocationId]);

  // Dropdown-facing list. When a location is selected and has at least one
  // tenant mapped to it, restrict accounts to those tenants. Falls back to
  // the full list when the location has no mapping (so the user can still
  // see every account) or when no location is selected at all.
  const availableAccounts = useMemo(() => {
    if (!selectedLocationId) return chartOfAccounts;
    if (locationLinkedPlatformOrgIds.size === 0) return chartOfAccounts;
    return chartOfAccounts.filter(acc => {
      const tenantId = acc.platform_integration_organization_id;
      return tenantId ? locationLinkedPlatformOrgIds.has(tenantId) : false;
    });
  }, [chartOfAccounts, selectedLocationId, locationLinkedPlatformOrgIds]);

  // Fetch rules for organization
  const fetchRules = async () => {
    if (!currentOrganization?.id) {
      setRules([]);
      return;
    }

    setIsLoadingRules(true);
    try {
      const { data, error } = await supabase
        .from('accounts_payable_invoice_rules_mapping' as any)
        .select('*')
        .eq('organization_id', currentOrganization.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setRules((data || []) as Rule[]);
    } catch (error) {
      console.error('Error fetching rules:', error);
      setRules([]);
    } finally {
      setIsLoadingRules(false);
    }
  };

  useEffect(() => {
    fetchRules();
  }, [currentOrganization?.id]);

  // Handle save rule (create or update)

  const handleSaveRule = async () => {
    if (!ruleForm.inbound_email_id) {
      toast.error('Please select an inbound email');
      return;
    }

    if (!ruleForm.email.trim()) {
      toast.error('Please enter an email address');
      return;
    }

    // Check for duplicate rule (same email + inbound_email_id)
    const duplicateRule = rules.find(
      (rule) =>
        rule.email.toLowerCase() === ruleForm.email.toLowerCase().trim() &&
        rule.inbound_email_id === ruleForm.inbound_email_id &&
        (!editingRule || rule.id !== editingRule.id) // Allow editing the same rule
    );

    if (duplicateRule) {
      toast.error('A rule with this email and inbound email combination already exists');
      return;
    }

    // Get the inbound email address from the selected inbound_email_id
    const selectedInboundEmail = organizationInboundEmails.find(
      (email) => email.id === ruleForm.inbound_email_id
    );
    const inboundEmailAddress = selectedInboundEmail?.inbound_email_address || null;

    setIsSavingRule(true);
    try {
      if (editingRule) {
        // Update existing rule
        const { error } = await supabase
          .from('accounts_payable_invoice_rules_mapping' as any)
          .update({
            email: ruleForm.email,
            inbound_email_id: ruleForm.inbound_email_id || null,
            inbound_email_address: inboundEmailAddress,
            folder_id: ruleForm.folder_id || null,
            chart_of_account_id: ruleForm.chart_of_account_id || null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', editingRule.id);

        if (error) throw error;
        toast.success('Rule updated successfully');
      } else {
        // Create new rule
        const { error } = await supabase
          .from('accounts_payable_invoice_rules_mapping' as any)
          .insert({
            user_id: user?.id || null,
            organization_id: currentOrganization?.id || null,
            email: ruleForm.email,
            inbound_email_id: ruleForm.inbound_email_id || null,
            inbound_email_address: inboundEmailAddress,
            folder_id: ruleForm.folder_id || null,
            chart_of_account_id: ruleForm.chart_of_account_id || null,
            is_active: true,
          });

        if (error) throw error;
        toast.success('Rule created successfully');
      }

      // Reset form and close modal
      setRuleForm({ email: '', inbound_email_id: '', folder_id: '', chart_of_account_id: '' });
      setEditingRule(null);
      setIsRuleModalOpen(false);
      fetchRules();
    } catch (error: any) {
      console.error('Error saving rule:', error);
      toast.error(`Failed to save rule: ${error.message || 'Unknown error'}`);
    } finally {
      setIsSavingRule(false);
    }
  };

  // Open delete confirmation dialog
  const handleDeleteRule = (ruleId: string) => {
    setRuleToDelete(ruleId);
    setDeleteConfirmOpen(true);
  };

  // Confirm delete rule
  const confirmDeleteRule = async () => {
    if (!ruleToDelete) return;

    setIsDeletingRule(true);
    try {
      const { error } = await supabase
        .from('accounts_payable_invoice_rules_mapping' as any)
        .delete()
        .eq('id', ruleToDelete);

      if (error) throw error;
      toast.success('Rule deleted successfully');
      fetchRules();
    } catch (error: any) {
      console.error('Error deleting rule:', error);
      toast.error(`Failed to delete rule: ${error.message || 'Unknown error'}`);
    } finally {
      setIsDeletingRule(false);
      setDeleteConfirmOpen(false);
      setRuleToDelete(null);
    }
  };

  // Handle toggle rule active status
  const handleToggleRuleStatus = async (rule: Rule) => {
    try {
      const { error } = await supabase
        .from('accounts_payable_invoice_rules_mapping' as any)
        .update({ is_active: !rule.is_active, updated_at: new Date().toISOString() })
        .eq('id', rule.id);

      if (error) throw error;
      toast.success(`Rule ${rule.is_active ? 'deactivated' : 'activated'} successfully`);
      fetchRules();
    } catch (error: any) {
      console.error('Error toggling rule status:', error);
      toast.error(`Failed to update rule: ${error.message || 'Unknown error'}`);
    }
  };

  // Open edit modal with rule data
  const handleEditRule = (rule: Rule) => {
    setEditingRule(rule);
    setRuleForm({
      email: rule.email,
      inbound_email_id: rule.inbound_email_id || '',
      folder_id: rule.folder_id || '',
      chart_of_account_id: rule.chart_of_account_id || '',
    });
    // Set the location for the existing rule's inbound email
    const existingEmail = organizationInboundEmails.find(e => e.id === rule.inbound_email_id);
    setSelectedInboundEmailLocationId(existingEmail?.location_id || null);
    setIsRuleModalOpen(true);
  };

  // Open create modal
  const handleAddRule = () => {
    setEditingRule(null);
    setRuleForm({ email: '', inbound_email_id: '', folder_id: '', chart_of_account_id: '' });
    // Reset location filter when creating new rule
    setSelectedInboundEmailLocationId(null);
    setIsRuleModalOpen(true);
  };

  // Mutation to add practice
  const addPracticeMutation = useMutation({
    mutationFn: async (practiceData: {
      name: string;
      address: string;
      phone?: string;
      email?: string;
      chairs?: number;
    }) => {
      if (!currentOrganization?.id) throw new Error('Organization not found');
      
      const { data, error } = await supabase
        .from('practices')
        .insert({
          organization_id: currentOrganization.id,
          name: practiceData.name,
          address: practiceData.address,
          phone: practiceData.phone || null,
          email: practiceData.email || null,
          chairs: practiceData.chairs || 0,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['practices', currentOrganization?.id] });
      toast.success('Practice added successfully');
      setIsAddPracticeOpen(false);
      setPracticeForm({
        name: '',
        address: '',
        city: '',
        state: '',
        zipCode: '',
        phone: '',
        email: '',
        chairs: '',
      });
    },
    onError: (error: any) => {
      toast.error(`Failed to add practice: ${error.message || 'An error occurred while adding the practice.'}`);
    },
  });

  const handleAddPractice = () => {
    if (!practiceForm.name.trim()) {
      toast.error('Practice name required. Please enter a practice name.');
      return;
    }

    const fullAddress = [
      practiceForm.address,
      practiceForm.city,
      practiceForm.state,
      practiceForm.zipCode,
    ]
      .filter(Boolean)
      .join(', ');

    addPracticeMutation.mutate({
      name: practiceForm.name,
      address: fullAddress || practiceForm.address,
      phone: practiceForm.phone || undefined,
      email: practiceForm.email || undefined,
      chairs: practiceForm.chairs ? parseInt(practiceForm.chairs) : 0,
    });
  };

  const { data: teamMembers } = useQuery({
    queryKey: ['teamMembers', currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization?.id) return [];
      const { data } = await supabase
        .from('team_members')
        .select('*')
        .eq('organization_id', currentOrganization.id)
        .order('created_at', { ascending: false });
      return data || [];
    },
    enabled: !!currentOrganization?.id,
  });

  const { data: userRoles } = useQuery({
    queryKey: ['userRoles', currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization?.id) return [];
      const { data } = await supabase
        .from('user_roles')
        .select('*, profiles:user_id(*)')
        .eq('organization_id', currentOrganization.id)
        .order('created_at', { ascending: false });
      return data || [];
    },
    enabled: !!currentOrganization?.id,
  });

  const { data: orgSettings } = useQuery({
    queryKey: ['orgSettings', currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization?.id) return null;
      const { data } = await supabase
        .from('organization_settings')
        .select('*')
        .eq('organization_id', currentOrganization.id)
        .maybeSingle();
      return data;
    },
    enabled: !!currentOrganization?.id,
  });

  // Combined loading state — include authLoading so we don't show "not found"
  // while auth is still initialising (user/profile not yet available after login)
  const isPageLoading = authLoading || isLoading || isLoadingAllOrgs || (selectedLocationId && isLoadingLocationOrg);

  if (isPageLoading) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </MainLayout>
    );
  }

  // Only show error if we're not loading and there's actually an error or no organization
  // Don't show error if we're still waiting for profile to load
  if (!isPageLoading && (error || (!currentOrganization && displayOrganizations.length === 0))) {
    return (
      <MainLayout>
        <div className="flex flex-col items-center justify-center h-64">
          <h2 className="text-xl font-semibold mb-2">Organization Not Found</h2>
          <p className="text-muted-foreground mb-4">
            Please complete onboarding to set up your organization.
          </p>
          <Button onClick={() => navigate('/onboarding')}>
            Go to Onboarding
          </Button>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <Helmet>
        <title>Organization Settings</title>
        <meta name="description" content="Manage organization details, practices, payment plans, income mapping, and master configurations." />
      </Helmet>
      <div className="space-y-6 pt-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Organization Details</h1>
              <p className="text-muted-foreground">View your organization information</p>
            </div>
          </div>
          {can('organization', 'update', 'settings_tab') && (
            <Button onClick={() => setIsEditOrgModalOpen(true)}>
              <Edit className="w-4 h-4 mr-2" />
              Edit Organization
            </Button>
          )}
        </div>

        {/* Subscription Plan */}
        {organization && (() => {
          const currentPlan = (organization.plan_tier as PlanTier) || 'basic';
          return (
            <div>
              <div className="mb-4">
                <h2 className="text-lg font-semibold">Subscription Plan</h2>
                <p className="text-muted-foreground text-sm">
                  Your plan controls which features are available to your organization. Contact your DentPulse account manager to change your plan.
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                {PLAN_TIERS.map((tier) => {
                  const isActive = tier === currentPlan;
                  return (
                    <Card
                      key={tier}
                      className={cn(
                        'relative flex flex-col',
                        isActive && 'border-primary ring-1 ring-primary',
                      )}
                    >
                      {isActive && (
                        <Badge className="absolute -top-2.5 right-4">Active</Badge>
                      )}
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          {PLAN_LABELS[tier]}
                          {tier === 'basic' && (
                            <Badge variant="secondary" className="font-normal">Free</Badge>
                          )}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="flex flex-col flex-1 gap-4">
                        <ul className="space-y-2 flex-1">
                          {PLAN_FEATURES[tier].map((feature) => (
                            <li key={feature} className="flex items-start gap-2 text-sm">
                              <Check className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                              <span>{feature}</span>
                            </li>
                          ))}
                        </ul>
                        {isActive && (
                          <Button disabled variant="outline" className="w-full">
                            <CheckCircle2 className="w-4 h-4 mr-2" />
                            Current Plan
                          </Button>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* Organization Details - Card view when "All" locations selected */}
        {showAllOrganizations && displayOrganizations.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold mb-4">Organization Details </h2>
            <div className="space-y-6">
              {displayOrganizations.map((org) => (
                <div key={org.id} className="border rounded-lg bg-card">
                  {/* Organization Header */}
                  <div className="px-6 py-4 border-b flex items-center gap-4">
                    {org.logo_url ? (
                      <img
                        src={org.logo_url}
                        alt={org.name}
                        className="w-12 h-12 rounded-lg object-cover border"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center">
                        <Building2 className="w-6 h-6 text-primary-foreground" />
                      </div>
                    )}
                    <div>
                      <div className="text-lg font-semibold">{org.name}</div>
                      <div className="text-sm text-muted-foreground">
                        {org.email || 'No email'} • Created {format(new Date(org.created_at), 'MMM dd, yyyy')}
                      </div>
                    </div>
                  </div>
                  {/* Organization Info Card Only */}
                  <div className="p-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-4">
                        <div>
                          <label className="text-sm font-medium text-muted-foreground">Email</label>
                          <div className="flex items-center gap-2 mt-1">
                            <Mail className="w-4 h-4 text-muted-foreground" />
                            <span>{org.email || 'Not provided'}</span>
                          </div>
                        </div>
                        <div>
                          <label className="text-sm font-medium text-muted-foreground">Phone</label>
                          <div className="flex items-center gap-2 mt-1">
                            <Phone className="w-4 h-4 text-muted-foreground" />
                            <span>{org.phone || 'Not provided'}</span>
                          </div>
                        </div>
                      </div>
                      <div className="space-y-4">
                        <div>
                          <label className="text-sm font-medium text-muted-foreground">Organization ID</label>
                          <div className="mt-1">
                            <code className="text-xs bg-muted px-2 py-1 rounded font-mono">{org.id}</code>
                          </div>
                        </div>
                        <div>
                          <label className="text-sm font-medium text-muted-foreground">Created</label>
                          <div className="flex items-center gap-2 mt-1">
                            <Calendar className="w-4 h-4 text-muted-foreground" />
                            <span>{format(new Date(org.created_at), 'MMMM dd, yyyy')}</span>
                          </div>
                        </div>
                        <div>
                          <label className="text-sm font-medium text-muted-foreground">Address</label>
                          <div className="flex items-center gap-2 mt-1">
                            <MapPin className="w-4 h-4 text-muted-foreground" />
                            <span>{org.address || 'Not provided'}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Location Details - Accordion view when "All" locations selected */}
        {showAllOrganizations && allLocations.length > 0 && (
          <div className="mt-6">
            <h2 className="text-lg font-semibold mb-4">Location Details ({allLocations.length})</h2>
            <Accordion type="single" collapsible className="w-full space-y-4">
              {allLocations.map((location: any) => {
                const parentOrg = allOrganizations?.find(o => o.id === location.organization_id);
                return (
                  <AccordionItem key={location.id} value={location.id} className="border rounded-lg bg-card">
                    <AccordionTrigger className="px-6 hover:no-underline">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
                          <MapPin className="w-6 h-6 text-white" />
                        </div>
                        <div className="text-left">
                          <div className="text-lg font-semibold">{location.location_name}</div>
                          <div className="text-sm text-muted-foreground">
                            {parentOrg?.name || 'Unknown Organization'} • Created {location.created_at ? format(new Date(location.created_at), 'MMM dd, yyyy') : 'N/A'}
                          </div>
                        </div>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="px-6 pb-6">
                      <LocationDetailContent
                        location={location}
                        organizationName={parentOrg?.name}
                        isAccordionView={true}
                      />
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          </div>
        )}

        {/* Selected Location Details - Show when a specific location is selected */}
        {!showAllOrganizations && selectedLocationId && (() => {
          const selectedLocation = allLocations.find((loc: any) => loc.id === selectedLocationId);
          const parentOrg = allOrganizations?.find(o => o.id === selectedLocation?.organization_id);
          if (!selectedLocation) return null;
          return (
            <div className="space-y-6">
              {/* Organization Details */}
              {parentOrg && (
                <div>
                  <h2 className="text-lg font-semibold mb-4">Organization Details</h2>
                  <div className="border rounded-lg bg-card">
                    {/* Organization Header */}
                    <div className="px-6 py-4 border-b flex items-center gap-4">
                      {parentOrg.logo_url ? (
                        <img
                          src={parentOrg.logo_url}
                          alt={parentOrg.name}
                          className="w-12 h-12 rounded-lg object-cover border"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center">
                          <Building2 className="w-6 h-6 text-primary-foreground" />
                        </div>
                      )}
                      <div>
                        <div className="text-lg font-semibold">{parentOrg.name}</div>
                        <div className="text-sm text-muted-foreground">
                          {parentOrg.email || 'No email'} • Created {format(new Date(parentOrg.created_at), 'MMM dd, yyyy')}
                        </div>
                      </div>
                    </div>
                    {/* Organization Info */}
                    <div className="p-6">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-4">
                          <div>
                            <label className="text-sm font-medium text-muted-foreground">Email</label>
                            <div className="flex items-center gap-2 mt-1">
                              <Mail className="w-4 h-4 text-muted-foreground" />
                              <span>{parentOrg.email || 'Not provided'}</span>
                            </div>
                          </div>
                          <div>
                            <label className="text-sm font-medium text-muted-foreground">Phone</label>
                            <div className="flex items-center gap-2 mt-1">
                              <Phone className="w-4 h-4 text-muted-foreground" />
                              <span>{parentOrg.phone || 'Not provided'}</span>
                            </div>
                          </div>
                        </div>
                        <div className="space-y-4">
                          <div>
                            <label className="text-sm font-medium text-muted-foreground">Organization ID</label>
                            <div className="mt-1">
                              <code className="text-xs bg-muted px-2 py-1 rounded font-mono">{parentOrg.id}</code>
                            </div>
                          </div>
                          <div>
                            <label className="text-sm font-medium text-muted-foreground">Created</label>
                            <div className="flex items-center gap-2 mt-1">
                              <Calendar className="w-4 h-4 text-muted-foreground" />
                              <span>{format(new Date(parentOrg.created_at), 'MMMM dd, yyyy')}</span>
                            </div>
                          </div>
                          <div>
                            <label className="text-sm font-medium text-muted-foreground">Address</label>
                            <div className="flex items-center gap-2 mt-1">
                              <MapPin className="w-4 h-4 text-muted-foreground" />
                              <span>{parentOrg.address || 'Not provided'}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Location Details */}
              <div>
                <h2 className="text-lg font-semibold mb-4">Location Details</h2>
                <div className="border rounded-lg bg-card">
                  {/* Location Header */}
                  <div className="px-6 py-4 border-b flex items-center gap-4">
                    <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
                      <MapPin className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <div className="text-lg font-semibold">{selectedLocation.location_name}</div>
                      <div className="text-sm text-muted-foreground">
                        {parentOrg?.name || 'Unknown Organization'} • Created {selectedLocation.created_at ? format(new Date(selectedLocation.created_at), 'MMM dd, yyyy') : 'N/A'}
                      </div>
                    </div>
                  </div>
                  {/* Location Content */}
                  <div className="p-6">
                    <LocationDetailContent
                      location={selectedLocation as any}
                      organizationName={parentOrg?.name}
                      isAccordionView={false}
                    />
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Statistics and Tabs - Only show when no specific location is selected */}
        {showAllOrganizations && !(displayOrganizations.length > 0) && (
          <>
        {/* Statistics */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                <Users className="w-4 h-4" />
                <span>Team Members</span>
              </div>
              <div className="text-2xl font-semibold">{teamMembers?.length || 0}</div>
              <div className="text-xs text-muted-foreground">Total members</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                <Users className="w-4 h-4" />
                <span>Users</span>
              </div>
              <div className="text-2xl font-semibold">{userRoles?.length || 0}</div>
              <div className="text-xs text-muted-foreground">Organization users</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                <Settings className="w-4 h-4" />
                <span>Settings</span>
              </div>
              <div className="text-2xl font-semibold">{orgSettings ? '✓' : '—'}</div>
              <div className="text-xs text-muted-foreground">{orgSettings ? 'Configured' : 'Not set'}</div>
            </CardContent>
          </Card>
        </div>

        {/* Tabs for detailed views */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList>
            {canViewTab('team-members') && <TabsTrigger value="team-members">Team Members ({teamMembers?.length || 0})</TabsTrigger>}
            {canViewTab('users') && <TabsTrigger value="users">Users ({userRoles?.length || 0})</TabsTrigger>}
            {canViewTab('rules') && <TabsTrigger value="rules">Rules</TabsTrigger>}
          </TabsList>

          <TabsContent value="team-members">
            <Card>
              <CardHeader>
                <CardTitle>Team Members</CardTitle>
                <CardDescription>All team members in this organization</CardDescription>
              </CardHeader>
              <CardContent>
                {teamMembers && teamMembers.length > 0 ? (
                  <div className="space-y-3">
                    {teamMembers.map((member: any) => (
                      <div key={member.id} className="p-4 border rounded-lg">
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <h3 className="font-medium text-lg">{member.name}</h3>
                            <div className="flex items-center gap-3 mt-1">
                              <Badge variant="secondary" className="capitalize">
                                {member.role_type}
                              </Badge>
                              {member.specialization && (
                                <span className="text-sm text-muted-foreground">{member.specialization}</span>
                              )}
                            </div>
                            {member.email && (
                              <p className="text-sm text-muted-foreground mt-2 flex items-center gap-1">
                                <Mail className="w-3 h-3" />
                                {member.email}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <p>No team members found.</p>
                    {can('organization', 'add', 'team_members_tab') && (
                      <Button variant="link" onClick={() => navigate('/onboarding')} className="mt-2">
                        Add team members in onboarding
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="users">
            <Card>
              <CardHeader>
                <CardTitle>Organization Users</CardTitle>
                <CardDescription>Users with access to this organization</CardDescription>
              </CardHeader>
              <CardContent>
                {userRoles && userRoles.length > 0 ? (
                  <div className="space-y-3">
                    {userRoles.map((role: any) => (
                      <div key={role.id} className="p-4 border rounded-lg">
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <Badge variant={
                                role.role === 'owner' ? 'default' :
                                role.role === 'admin' ? 'secondary' : 'outline'
                              } className="capitalize">
                                {role.role}
                              </Badge>
                              <span className="text-sm text-muted-foreground">
                                Added {format(new Date(role.created_at), 'MMM dd, yyyy')}
                              </span>
                            </div>
                            {role.profiles && (
                              <p className="text-sm text-muted-foreground mt-1">
                                User ID: {role.user_id}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <p>No users found.</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Rules Tab */}
          <TabsContent value="rules">
            {/* Rules Header */}
            <div className="mb-6">
              <h2 className="text-2xl font-semibold text-foreground">Rules</h2>
              <p className="text-muted-foreground">Manage your rules and automation settings</p>
            </div>

            {/* Available Rules Card */}
            <Card>
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg font-semibold">Available Rules</CardTitle>
                  {can('organization', 'add', 'rules_tab') && (
                    <Button onClick={handleAddRule} variant="outline" className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2">
                      <Plus className="w-4 h-4 mr-2" />
                      Add Rule
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {isLoadingRules ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
                    <span className="ml-2 text-gray-600">Loading rules...</span>
                  </div>
                ) : rules.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <FileText className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                    <p>No rules configured yet.</p>
                    <p className="text-sm">Click "Add Rule" to create your first automation rule.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {rules.map((rule) => {
                      const folder = invoiceFolders.find(f => f.id === rule.folder_id);
                      const coa = chartOfAccounts.find(c => c.id === rule.chart_of_account_id);
                      const isActive = rule.is_active;

                      return (
                        <div
                          key={rule.id}
                          className={`border-2 ${isActive ? 'border-indigo-200' : 'border-gray-200'} rounded-lg p-4 bg-white relative overflow-hidden`}
                        >
                          <div className={`absolute left-0 top-0 bottom-0 w-1 ${isActive ? 'bg-indigo-500' : 'bg-gray-400'}`}></div>
                          <div className="flex items-start justify-between pl-2">
                            <div className="space-y-2 flex-1">
                              {/* Email From */}
                              <div className="flex items-center gap-2">
                                <Mail className="w-4 h-4 text-gray-500" />
                                <span className="text-sm text-gray-600">Email From:</span>
                                <span className="text-sm font-medium text-gray-900">{rule.email}</span>
                              </div>
                              {/* Email To */}
                              <div className="flex items-center gap-2">
                                <Mail className="w-4 h-4 text-gray-500" />
                                <span className="text-sm text-gray-600">Email To:</span>
                                <span className="text-sm font-medium text-gray-900">{rule.inbound_email_address || 'Not set'}</span>
                              </div>
                              {/* Organization, Folder, COA row */}
                              <div className="flex items-center gap-6 pt-1 flex-wrap">
                                <div className="flex items-center gap-1.5">
                                  <Building2 className={`w-4 h-4 ${isActive ? 'text-indigo-500' : 'text-gray-500'}`} />
                                  <span className={`text-sm font-medium ${isActive ? 'text-indigo-600' : 'text-gray-600'}`}>Organization:</span>
                                  <span className={`text-sm ${isActive ? 'text-indigo-600' : 'text-gray-600'}`}>{currentOrganization?.name || '-'}</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <FolderIcon className={`w-4 h-4 ${isActive ? 'text-indigo-500' : 'text-gray-500'}`} />
                                  <span className={`text-sm font-medium ${isActive ? 'text-indigo-600' : 'text-gray-600'}`}>Folder:</span>
                                  <span className={`text-sm ${isActive ? 'text-indigo-600' : 'text-gray-600'}`}>{folder?.name || '-'}</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <span className={`text-sm font-medium ${isActive ? 'text-indigo-600' : 'text-gray-600'}`}>COA:</span>
                                  <span className={`text-sm ${isActive ? 'text-indigo-600' : 'text-gray-600'}`}>
                                    {coa ? `${coa.account_code || ''} ${coa.account_name}` : '-'}
                                  </span>
                                </div>
                              </div>
                            </div>
                            {/* Actions */}
                            <div className="flex items-center gap-3">
                              <Badge
                                className={`${isActive
                                  ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                } border-0 font-medium px-3 cursor-pointer`}
                                onClick={() => handleToggleRuleStatus(rule)}
                              >
                                {isActive ? 'ACTIVE' : 'INACTIVE'}
                              </Badge>
                              {can('organization', 'update', 'rules_tab') && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50"
                                  onClick={() => handleEditRule(rule)}
                                >
                                  <Pencil className="w-4 h-4" />
                                </Button>
                              )}
                              {can('organization', 'delete', 'rules_tab') && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-50"
                                  onClick={() => handleDeleteRule(rule.id)}
                                  disabled={isDeletingRule}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Add/Edit Rule Modal */}
            <Dialog open={isRuleModalOpen} onOpenChange={(open) => {
              setIsRuleModalOpen(open);
              if (!open) {
                // Reset location filter when modal closes
                setSelectedInboundEmailLocationId(null);
              }
            }}>
              <DialogContent className="max-w-2xl space-y-4">
                <DialogHeader>
                  <DialogTitle>{editingRule ? 'Edit Rule' : 'Create Rule'}</DialogTitle>
                  <DialogDescription>
                    {editingRule
                      ? 'Update the rule settings below.'
                      : 'Configure a new rule for automatic invoice processing.'}
                  </DialogDescription>
                </DialogHeader>                
                <div className="space-y-2">
                  {/* Inbound Email Selection */}
                  <div className="space-y-2">
                    <Label htmlFor="inbound_email">Select Inbound Email *</Label>
                    <Select
                      value={ruleForm.inbound_email_id}
                      onValueChange={(value) => {
                        // Find the selected inbound email to get its location_id
                        const selectedEmail = organizationInboundEmails.find(e => e.id === value);
                        setSelectedInboundEmailLocationId(selectedEmail?.location_id || null);
                        // Reset folder selection when inbound email changes
                        setRuleForm({ ...ruleForm, inbound_email_id: value, folder_id: '' });
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="-- Select Inbound Email --" />
                      </SelectTrigger>
                      <SelectContent>
                        {isLoadingInboundEmails ? (
                          <div className="flex items-center justify-center py-2">
                            <Loader2 className="w-4 h-4 animate-spin" />
                          </div>
                        ) : organizationInboundEmails.length === 0 ? (
                          <div className="px-2 py-2 text-sm text-muted-foreground">
                            No inbound emails available
                          </div>
                        ) : (
                          organizationInboundEmails.map((inboundEmail) => (
                            <SelectItem key={inboundEmail.id} value={inboundEmail.id}>
                              {inboundEmail.inbound_email_address}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Select the inbound email address for this rule
                    </p>
                  </div>
                
                  {/* Email */}
                  <div className="space-y-2">
                    <Label htmlFor="email">Email Address *</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="sender@example.com"
                      value={ruleForm.email}
                      onChange={(e) => setRuleForm({ ...ruleForm, email: e.target.value })}
                    />
                    <p className="text-xs text-muted-foreground">
                      Invoices from this email will be automatically processed
                    </p>
                  </div>

                  {/* Folder Selection - filtered by selected inbound email's location */}
                  <div className="space-y-2">
                    <Label htmlFor="folder">Assign to Folder</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          role="combobox"
                          disabled={!ruleForm.inbound_email_id}
                          className="w-full justify-between font-normal"
                        >
                          {!ruleForm.inbound_email_id ? (
                            <span className="flex items-center gap-2 text-muted-foreground">
                              <FolderIcon className="w-4 h-4" />
                              Select inbound email first
                            </span>
                          ) : ruleForm.folder_id ? (
                            <span className="flex items-center gap-2">
                              <FolderIcon className="w-4 h-4" />
                              {invoiceFolders.find((f) => f.id === ruleForm.folder_id)?.name || 'Select folder'}
                            </span>
                          ) : (
                            <span className="flex items-center gap-2 text-muted-foreground">
                              <FolderIcon className="w-4 h-4" />
                              Select folder
                            </span>
                          )}
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[400px] p-0" align="start">
                        <div className="max-h-[300px] overflow-auto" onWheel={(e) => e.stopPropagation()}>
                          {isLoadingFolders ? (
                            <div className="flex items-center justify-center py-6">
                              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                            </div>
                          ) : invoiceFolders.length === 0 ? (
                            <div className="px-3 py-4 text-sm text-muted-foreground text-center">
                              No folders available
                            </div>
                          ) : (
                            <div className="py-1">
                              {/* Parent folders and their children */}
                              {invoiceFolders
                                .filter((f) => !f.parent_id)
                                .map((parentFolder) => {
                                  const children = invoiceFolders.filter((f) => f.parent_id === parentFolder.id);
                                  const hasChildren = children.length > 0;

                                  return (
                                    <div key={parentFolder.id}>
                                      {/* Parent folder as header - disabled if has children */}
                                      <div
                                        className={cn(
                                          "px-3 py-2 font-medium text-sm border-t border-gray-100",
                                          hasChildren
                                            ? "text-gray-500 cursor-default"
                                            : "cursor-pointer hover:bg-gray-100",
                                          !hasChildren && ruleForm.folder_id === parentFolder.id && "bg-indigo-50 text-indigo-700"
                                        )}
                                        onClick={() => {
                                          if (hasChildren) return;
                                          setRuleForm({ ...ruleForm, folder_id: parentFolder.id });
                                        }}
                                      >
                                        {parentFolder.name}
                                      </div>

                                      {/* Child folders */}
                                      {children.map((child) => (
                                        <div
                                          key={child.id}
                                          className={cn(
                                            "px-3 py-2 pl-6 cursor-pointer hover:bg-gray-100 text-sm",
                                            ruleForm.folder_id === child.id && "bg-indigo-50 text-indigo-700"
                                          )}
                                          onClick={() => {
                                            setRuleForm({ ...ruleForm, folder_id: child.id });
                                          }}
                                        >
                                          {child.name}
                                        </div>
                                      ))}
                                    </div>
                                  );
                                })}
                            </div>
                          )}
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>

                  {/* Chart of Accounts Selection */}
                  <div className="space-y-2">
                    <Label htmlFor="coa">Chart of Accounts</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          role="combobox"
                          className="w-full justify-between font-normal"
                        >
                          {ruleForm.chart_of_account_id ? (
                            (() => {
                              const account = chartOfAccounts.find(
                                (acc) => acc.id === ruleForm.chart_of_account_id
                              );
                              return account
                                ? `${account.account_code || ''} - ${account.account_name}`
                                : 'Select account...';
                            })()
                          ) : (
                            'Select account...'
                          )}
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[400px] p-0" align="start">
                        <Command>
                          <CommandInput placeholder="Search accounts..." />
                          <CommandList>
                            <CommandEmpty>No accounts found.</CommandEmpty>
                            <CommandGroup>
                              {availableAccounts.map((account) => {
                                const displayValue = `${account.account_code || ''} - ${account.account_name}`;
                                return (
                                  <CommandItem
                                    key={account.id}
                                    value={displayValue}
                                    onSelect={() => {
                                      setRuleForm({ ...ruleForm, chart_of_account_id: account.id });
                                    }}
                                    className="aria-selected:bg-primary aria-selected:text-primary-foreground"
                                  >
                                    <span className="font-mono text-xs mr-2">
                                      {account.account_code}
                                    </span>
                                    <span>{account.account_name}</span>
                                    <span className="ml-auto text-xs opacity-70">
                                      {account.account_type}
                                    </span>
                                  </CommandItem>
                                );
                              })}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setIsRuleModalOpen(false);
                      setEditingRule(null);
                      setRuleForm({ email: '', inbound_email_id: '', folder_id: '', chart_of_account_id: '' });
                    }}
                    disabled={isSavingRule}
                  >
                    Cancel
                  </Button>
                  <Button onClick={handleSaveRule} disabled={isSavingRule || !ruleForm.email.trim() || !ruleForm.inbound_email_id}>
                    {isSavingRule ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        {editingRule ? 'Updating...' : 'Creating...'}
                      </>
                    ) : editingRule ? (
                      'Update Rule'
                    ) : (
                      'Create Rule'
                    )}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>

            {/* Delete Confirmation Dialog */}
            <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete Rule</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to delete this rule? This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={isDeletingRule}>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={confirmDeleteRule}
                    disabled={isDeletingRule}
                    className="bg-red-600 hover:bg-red-700"
                  >
                    {isDeletingRule ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Deleting...
                      </>
                    ) : (
                      'Delete'
                    )}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </TabsContent>
        </Tabs>
          </>
        )}
      </div>

      {/* Edit Organization Modal */}
      <Dialog open={isEditOrgModalOpen} onOpenChange={setIsEditOrgModalOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" onOpenAutoFocus={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>Organization Details</DialogTitle>
            <DialogDescription>View and edit your organization information</DialogDescription>
          </DialogHeader>
          <div className="space-y-6 py-4">
            {displayOrganizations.length > 0 && (
              <>
                {/* Organization Details Section */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-foreground">Organization Information</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Organization Name</Label>
                      <Input
                        value={editOrgForm.name}
                        onChange={(e) => setEditOrgForm({ ...editOrgForm, name: e.target.value })}
                        placeholder="Organization name"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-muted-foreground">Organization ID</Label>
                      <Input
                        value={displayOrganizations[0]?.id || ''}
                        disabled
                        className="bg-muted/50 font-mono text-xs cursor-not-allowed"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Email</Label>
                      <Input
                        value={editOrgForm.email}
                        onChange={(e) => setEditOrgForm({ ...editOrgForm, email: e.target.value })}
                        placeholder="Email address"
                        type="email"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Phone</Label>
                      <Input
                        value={editOrgForm.phone}
                        onChange={(e) => setEditOrgForm({ ...editOrgForm, phone: e.target.value })}
                        placeholder="Phone number"
                      />
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <Label>Address</Label>
                      <Input
                        value={editOrgForm.address}
                        onChange={(e) => setEditOrgForm({ ...editOrgForm, address: e.target.value })}
                        placeholder="Organization address"
                      />
                    </div>
                  </div>
                </div>

                {/* Logo Section */}
                <div className="space-y-2 pt-4 border-t">
                  <Label>Logo</Label>
                  <ImageUpload
                    value={editOrgForm.logo_url}
                    onChange={(url) => setEditOrgForm({ ...editOrgForm, logo_url: url || '' })}
                    variant="logo"
                  />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditOrgModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveOrganization} disabled={isSavingOrg}>
              {isSavingOrg ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4 mr-2" />
                  Save Changes
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
