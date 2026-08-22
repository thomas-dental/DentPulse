import { useState, useEffect, useMemo, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useAuth } from '@/hooks/useAuth';
import { useFilters } from '@/contexts/FilterContext';
import { useInvoiceFolders } from '@/hooks/useInvoiceFolders';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Mail, Phone, MapPin, Calendar, Users, Settings, FileText, Loader2, Plus, ChevronsUpDown, Trash2, Pencil, FolderIcon } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { createInboundEmail, checkEmailExists, InboundEmailType } from '@/services/inboundService';
import type { PracticeLocation as PracticeLocationRecord } from '@/types/location';

// Account-mapping fields (expense/revenue/provider-income/P&L) used to live here
// too, duplicating the shape maintained in @/types/location — they're now
// configured solely in Setup Categories (Settings → Integrations), so this
// component only needs the base record plus logo_url.
type PracticeLocation = PracticeLocationRecord & { logo_url: string | null };

interface Rule {
  id: string;
  user_id: string | null;
  email: string;
  inbound_email_address: string | null;
  inbound_email_id: string | null;
  organization_id: string | null;
  location_id: string | null;
  folder_id: string | null;
  chart_of_account_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface LocationDetailContentProps {
  location: PracticeLocation;
  organizationName?: string;
  isAccordionView?: boolean;
}

export function LocationDetailContent({ location, organizationName, isAccordionView = false }: LocationDetailContentProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Inbound email state
  const [costEmail, setCostEmail] = useState<string | null>(null);
  const [salesEmail, setSalesEmail] = useState<string | null>(null);
  const [isCreatingEmails, setIsCreatingEmails] = useState(false);
  const hasInitializedEmails = useRef(false);

  // Business Settings state — operational settings saved per-location
  const [businessInfo, setBusinessInfo] = useState({
    week_open_per_year: '',
    days_open_per_week: '',
    open_hours_per_day: '',
    number_of_surgeries: '',
    associate_weeks_per_year: '',
    associate_days_per_week: '',
    associate_cost_lab_source: 'flat_per_by_practice',
    associate_cost_labs_percent: '',
    material_cost_source: 'flat_per_by_practice',
    practice_cost_materials_percent: '',
    target_profit_percent: '',
    target_chair_revenue_per_hour: '',
    employee_working_duration_type: 'hours',
    is_associate_pay_including_lab_cost: true,
    is_associate_pay_including_material_cost: false,
  });
  const [isSavingBusinessInfo, setIsSavingBusinessInfo] = useState(false);

  // Load business settings from this location's own record whenever the
  // location changes (each location has its own values, not shared org-wide).
  useEffect(() => {
    setBusinessInfo({
      week_open_per_year: location.week_open_per_year?.toString() ?? '',
      days_open_per_week: location.days_open_per_week?.toString() ?? '',
      open_hours_per_day: location.open_hours_per_day?.toString() ?? '',
      number_of_surgeries: location.number_of_surgeries?.toString() ?? '',
      associate_weeks_per_year: location.associate_weeks_per_year?.toString() ?? '',
      associate_days_per_week: location.associate_days_per_week?.toString() ?? '',
      associate_cost_lab_source: location.associate_cost_lab_source || 'flat_per_by_practice',
      associate_cost_labs_percent: location.associate_cost_labs_percent?.toString() ?? '',
      material_cost_source: location.material_cost_source || 'flat_per_by_practice',
      practice_cost_materials_percent: location.practice_cost_materials_percent?.toString() ?? '',
      target_profit_percent: location.target_profit_percent?.toString() ?? '',
      target_chair_revenue_per_hour: location.target_chair_revenue_per_hour?.toString() ?? '',
      employee_working_duration_type: location.employee_working_duration_type || 'hours',
      is_associate_pay_including_lab_cost: location.is_associate_pay_including_lab_cost ?? true,
      is_associate_pay_including_material_cost: location.is_associate_pay_including_material_cost ?? false,
    });
  }, [location.id]);

  // Chart of Accounts state
  const [chartOfAccounts, setChartOfAccounts] = useState<any[]>([]);
  const [isLoadingCOA, setIsLoadingCOA] = useState(true);

  // Rules state
  const [rules, setRules] = useState<Rule[]>([]);
  const [isLoadingRules, setIsLoadingRules] = useState(false);
  const [isRuleModalOpen, setIsRuleModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<Rule | null>(null);
  const [ruleForm, setRuleForm] = useState({ email: '', inbound_email_id: '', folder_id: '', chart_of_account_id: '' });
  const [isSavingRule, setIsSavingRule] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [ruleToDelete, setRuleToDelete] = useState<string | null>(null);
  const [isDeletingRule, setIsDeletingRule] = useState(false);
  const [folderPopoverOpen, setFolderPopoverOpen] = useState(false);

  // Use invoice folders hook
  const { folders: invoiceFolders } = useInvoiceFolders({ selectedLocationId: location.id });

  // Full address
  const fullAddress = [
    location.address_line1,
    location.address_line2,
    location.city,
    location.state,
    location.postal_code,
    location.country
  ].filter(Boolean).join(', ');

  // Fetch team members for this location
  const { data: teamMembers = [] } = useQuery({
    queryKey: ['location-team-members', location.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('team_members')
        .select('*')
        .eq('location_id', location.id)
        .is('deleted_at', null)
        .order('name');

      if (error) throw error;
      return data || [];
    },
    enabled: !!location.id,
  });

  // Fetch providers for this location
  const { data: providers = [] } = useQuery({
    queryKey: ['location-providers', location.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('providers')
        .select('*')
        .eq('location_id', location.id)
        .is('deleted_at', null)
        .order('name');

      if (error) throw error;
      return data || [];
    },
    enabled: !!location.id,
  });

  // Fetch user roles for this location (via organization)
  const { data: userRoles = [] } = useQuery({
    queryKey: ['location-user-roles', location.organization_id],
    queryFn: async () => {
      const { data } = await supabase
        .from('user_roles')
        .select('*, profiles:user_id(*)')
        .eq('organization_id', location.organization_id)
        .order('created_at', { ascending: false });
      return data || [];
    },
    enabled: !!location.organization_id,
  });

  // Fetch inbound emails for this location
  const { data: locationInboundEmails = [] } = useQuery({
    queryKey: ['location-inbound-emails', location.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('location_inbound_emails')
        .select('*')
        .eq('location_id', location.id);
      return data || [];
    },
    enabled: !!location.id,
  });

  useEffect(() => {
    if (locationInboundEmails.length > 0) {
      const cost = locationInboundEmails.find((e: any) => e.email_type === 'cost');
      const sales = locationInboundEmails.find((e: any) => e.email_type === 'sales');
      setCostEmail(cost?.inbound_email_address || null);
      setSalesEmail(sales?.inbound_email_address || null);
    }
  }, [locationInboundEmails]);

  // Auto-create inbound emails when component mounts (accordion opens)
  useEffect(() => {
    const autoCreateInboundEmails = async () => {
      // Only run once per mount and if we have the required data
      if (hasInitializedEmails.current || !location.id || !location.organization_id || !user?.id) {
        return;
      }

      hasInitializedEmails.current = true;
      setIsCreatingEmails(true);

      try {
        // Check and create cost email if it doesn't exist
        const existingCost = await checkEmailExists(
          location.organization_id,
          'cost' as InboundEmailType,
          user.id,
          location.id
        );

        if (!existingCost) {
          console.log('[LocationDetail] Creating cost inbound email for location:', location.location_name);
          const costResult = await createInboundEmail({
            organizationId: location.organization_id,
            locationId: location.id,
            userId: user.id,
            emailType: 'cost' as InboundEmailType,
            name: `${location.location_name}_cost`,
          });

          if (costResult.success && costResult.email) {
            setCostEmail(costResult.email);
            console.log('[LocationDetail] Cost email created:', costResult.email);
          }
        } else {
          setCostEmail(existingCost.inbound_email_address);
        }

        // Check and create sales email if it doesn't exist
        const existingSales = await checkEmailExists(
          location.organization_id,
          'sales' as InboundEmailType,
          user.id,
          location.id
        );

        if (!existingSales) {
          console.log('[LocationDetail] Creating sales inbound email for location:', location.location_name);
          const salesResult = await createInboundEmail({
            organizationId: location.organization_id,
            locationId: location.id,
            userId: user.id,
            emailType: 'sales' as InboundEmailType,
            name: `${location.location_name}_sales`,
          });

          if (salesResult.success && salesResult.email) {
            setSalesEmail(salesResult.email);
            console.log('[LocationDetail] Sales email created:', salesResult.email);
          }
        } else {
          setSalesEmail(existingSales.inbound_email_address);
        }

        // Refetch the query to update the UI
        queryClient.invalidateQueries({ queryKey: ['location-inbound-emails', location.id] });
      } catch (error) {
        console.error('[LocationDetail] Error auto-creating inbound emails:', error);
      } finally {
        setIsCreatingEmails(false);
      }
    };

    autoCreateInboundEmails();
  }, [location.id, location.organization_id, location.location_name, user?.id, queryClient]);

  // Fetch Chart of Accounts for location — queries Xero, Iplicit, QuickBooks, Sage + legacy
  useEffect(() => {
    const fetchChartOfAccounts = async () => {
      if (!location.id || !location.organization_id) {
        setChartOfAccounts([]);
        setIsLoadingCOA(false);
        return;
      }

      setIsLoadingCOA(true);
      try {
        let allAccounts: any[] = [];

        // Query both COA tables + the legacy COA table + platform_integrations + orgs in parallel.
        // Legacy `platform_integration_chart_of_accounts` is included only so previously-saved
        // mapping IDs (from before the migration to dedicated xero/iplicit tables) can still
        // resolve to their original code/name on the badge. Legacy rows are marked __legacy
        // and excluded from the dropdown so new selections always go through the new tables.
        const [platformResult, iplicitResult, quickbooksResult, sageResult, legacyResult, connectionsResult, orgsResult] = await Promise.all([
          supabase
            .from('xero_chart_of_accounts' as any)
            .select('*')
            .eq('organization_id', location.organization_id)
            // Keep inactive accounts in the list too, so previously-mapped
            // accounts that have since been deactivated in Xero still render
            // their name/code on the badge. The dropdown filters out inactive
            // accounts separately so users can't pick new ones.
            .order('account_type', { ascending: true })
            .order('account_code', { ascending: true }),
          supabase
            .from('iplicit_chart_of_accounts' as any)
            .select('*')
            .eq('organization_id', location.organization_id)
            .order('account_type', { ascending: true })
            .order('code', { ascending: true }),
          supabase
            .from('quickbooks_chart_of_accounts' as any)
            .select('*')
            .eq('organization_id', location.organization_id)
            .order('account_type', { ascending: true })
            .order('account_number', { ascending: true }),
          supabase
            .from('sage_chart_of_accounts' as any)
            .select('*')
            .eq('organization_id', location.organization_id)
            .order('account_type', { ascending: true })
            .order('account_code', { ascending: true }),
          supabase
            .from('platform_integration_chart_of_accounts' as any)
            .select('id, platform_integration_id, platform_integration_organization_id, platform_name, coa_account_id, coa_account_code, coa_account_name, coa_account_type, coa_is_active')
            .eq('organization_id', location.organization_id),
          (supabase as any)
            .from('platform_integrations')
            .select('id, platform_name, client_id')
            .eq('organization_id', location.organization_id)
            .in('platform_name', ['iplicit', 'xero', 'quickbooks', 'sage', 'Iplicit', 'Xero', 'QuickBooks', 'Sage']),
          (supabase as any)
            .from('platform_integration_organizations')
            .select('platform_integration_id, platform_org_name, platform_name')
            .eq('organization_id', location.organization_id),
        ]);

        // Build connection name lookup: platform_integration_id → display name
        // Use org names from platform_integration_organizations (Xero tenant names, Iplicit entity names)
        const connectionNameMap = new Map<string, string>();
        const orgNameMap = new Map<string, string>();

        // Row-UUID → Xero GUID map. xero_chart_of_accounts.xero_tenant_id stores
        // the row UUID, but locationTenantIds collects Xero GUIDs (platform_org_id)
        // to match xero_invoices.xero_tenant_id which is TEXT. Resolve both here
        // so the availableAccounts filter downstream can match on either.
        const tenantUuidToGuid = new Map<string, string>();
        // Sage is single-tenant per OAuth — each platform_integration_id maps
        // to exactly one Sage business GUID. sage_chart_of_accounts has no
        // tenant_id column, so we resolve the tenant via this map when
        // normalizing Sage COA rows further down.
        const sageIntegrationToBusinessId = new Map<string, string>();
        // Per-TENANT name lookup for Xero. One Xero connection can carry several
        // organisations (tenants); labelling accounts with the CONNECTION-level
        // name mislabels them (the last tenant row overwrote orgNameMap, so e.g.
        // Leiston's accounts showed "Xero · TFL Care Limited"). Keyed by both the
        // tenant row UUID (what xero_chart_of_accounts.xero_tenant_id stores) and
        // the Xero GUID, so either representation resolves.
        const xeroTenantNameByKey = new Map<string, string>();

        // First, build org name map from platform_integration_organizations
        if (!orgsResult.error && orgsResult.data) {
          // Need to re-query to get id + platform_org_id together; the orgsResult
          // only selected platform_integration_id + platform_org_name.
          const { data: tenantRows } = await (supabase as any)
            .from('platform_integration_organizations')
            .select('id, platform_org_id, platform_org_name, platform_integration_id, platform_name')
            .eq('organization_id', location.organization_id);
          for (const r of (tenantRows ?? []) as any[]) {
            if (r.id && r.platform_org_id) tenantUuidToGuid.set(r.id, r.platform_org_id);
            if (r.platform_name === 'sage' && r.platform_integration_id && r.platform_org_id) {
              sageIntegrationToBusinessId.set(r.platform_integration_id, r.platform_org_id);
            }
            if (r.platform_name === 'xero' && r.platform_org_name) {
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

        // Add xero_chart_of_accounts records (Xero). Resolve the Xero tenant GUID
        // from the row UUID stored in xero_tenant_id so the availableAccounts
        // filter can match by GUID (consistent with how xero_invoices stores it).
        if (!platformResult.error && platformResult.data?.length > 0) {
          const withConnectionName = (platformResult.data as any[]).map((acc: any) => {
            // Label each account with ITS OWN organisation (tenant) name, not
            // the connection-level name — a multi-org Xero login would
            // otherwise stamp one org's name on all three orgs' accounts.
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
        }

        // Add iplicit_chart_of_accounts records — normalize columns
        if (!iplicitResult.error && iplicitResult.data?.length > 0) {
          const normalized = (iplicitResult.data as any[]).map((acc: any) => ({
            ...acc,
            xero_account_id: acc.account_id,
            account_code: acc.code,
            account_name: acc.name || acc.description,
            account_type: acc.account_type,
            is_active: acc.is_active,
            description: acc.description,
            _connectionName: connectionNameMap.get(acc.platform_integration_id) || 'Iplicit',
          }));
          allAccounts.push(...normalized);
        }

        // Add quickbooks_chart_of_accounts records — normalize columns.
        // realm_id IS the QBO company id (= platform_integration_organizations
        // .platform_org_id), so set it as platform_integration_organization_id
        // so the per-location tenant filter (locationTenantIds) matches when
        // the location is mapped to the QuickBooks company.
        if (!quickbooksResult.error && quickbooksResult.data?.length > 0) {
          const normalized = (quickbooksResult.data as any[]).map((acc: any) => ({
            ...acc,
            xero_account_id: acc.qb_account_id,
            account_code: acc.account_number,
            account_name: acc.account_name,
            account_type: acc.account_type,
            is_active: acc.is_active,
            description: acc.description,
            platform_integration_organization_id: acc.realm_id || null,
            _connectionName: connectionNameMap.get(acc.platform_integration_id) || 'QuickBooks',
          }));
          allAccounts.push(...normalized);
        }

        // Add sage_chart_of_accounts records — normalize columns.
        // Sage is single-tenant per OAuth, so all rows for a given
        // platform_integration_id belong to the same Sage business GUID
        // (resolved via sageIntegrationToBusinessId map built above from
        // platform_integration_organizations). Setting that GUID as
        // platform_integration_organization_id lets the per-location tenant
        // filter (locationTenantIds) match when the location is mapped to a
        // Sage business via Practice Location Mapping.
        if (!sageResult.error && sageResult.data?.length > 0) {
          const normalized = (sageResult.data as any[]).map((acc: any) => ({
            ...acc,
            xero_account_id: acc.sage_account_id,
            account_code: acc.account_code,
            account_name: acc.account_name,
            account_type: acc.account_type,
            is_active: acc.is_active,
            description: acc.description,
            platform_integration_organization_id:
              sageIntegrationToBusinessId.get(acc.platform_integration_id) || null,
            _connectionName: connectionNameMap.get(acc.platform_integration_id) || 'Sage',
          }));
          allAccounts.push(...normalized);
        }

        // Add legacy platform_integration_chart_of_accounts rows LAST. They exist only to
        // resolve names for mappings saved against the old table; the dedupe below prefers
        // the new-table row when codes match, and availableAccounts skips __legacy entirely.
        if (!legacyResult.error && legacyResult.data?.length > 0) {
          const platformLabel = (p?: string) => {
            if (!p) return 'Accounting';
            return p.charAt(0).toUpperCase() + p.slice(1);
          };
          const legacyNormalized = (legacyResult.data as any[]).map((acc: any) => ({
            id: acc.id,
            xero_account_id: acc.coa_account_id,
            account_code: acc.coa_account_code,
            account_name: acc.coa_account_name,
            account_type: acc.coa_account_type,
            is_active: acc.coa_is_active,
            platform_integration_id: acc.platform_integration_id,
            platform_integration_organization_id: acc.platform_integration_organization_id,
            _connectionName: connectionNameMap.get(acc.platform_integration_id) || platformLabel(acc.platform_name),
            __legacy: true,
          }));
          allAccounts.push(...legacyNormalized);
        }

        console.log('[Location COA] Fetched accounts:', {
          platformCount: platformResult.data?.length ?? 0,
          iplicitCount: iplicitResult.data?.length ?? 0,
          quickbooksCount: quickbooksResult.data?.length ?? 0,
          sageCount: sageResult.data?.length ?? 0,
          legacyCount: legacyResult.data?.length ?? 0,
          totalCount: allAccounts.length,
        });

        // Remove duplicates among NEW-table rows (legacy rows are always kept so their
        // row IDs remain resolvable by the badge lookup; the dropdown excludes legacy).
        // The tenant MUST be part of the key: one Xero connection carries several
        // organisations that share the standard chart (same code+name), and a
        // connection-level dedupe collapsed them to one arbitrary organisation's
        // copy — the per-location filter then dropped the account entirely for
        // every other organisation's location ("missing accounts").
        const tenantKey = (a: any) => a.platform_integration_organization_id ?? a.xero_tenant_id ?? null;
        const uniqueAccounts = allAccounts.filter((account: any, index: number, self: any[]) => {
          if (account.__legacy) return true;
          return index === self.findIndex((a: any) =>
            !a.__legacy &&
            a.account_code === account.account_code &&
            a.account_name === account.account_name &&
            a.platform_integration_id === account.platform_integration_id &&
            tenantKey(a) === tenantKey(account)
          );
        });
        setChartOfAccounts(uniqueAccounts);
      } catch (error) {
        console.error('Error fetching chart of accounts:', error);
        setChartOfAccounts([]);
      } finally {
        setIsLoadingCOA(false);
      }
    };

    fetchChartOfAccounts();
  }, [location.id, location.organization_id]);

  // External Xero tenant UUIDs (platform_integration_organizations.platform_org_id)
  // mapped to THIS location via platform_integration_organization_mapping.
  // The COA table stores `platform_integration_organization_id` = external tenant
  // UUID (see xeroService.ts:982), so we filter against that. Filtering by the
  // OAuth `platform_integration_id` isn't enough — one OAuth can cover many
  // Xero tenants.
  const [locationTenantIds, setLocationTenantIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    let cancelled = false;
    const resolveTenants = async () => {
      if (!location.id) {
        setLocationTenantIds(new Set());
        return;
      }
      const { data: mappingRows, error: mappingErr } = await (supabase as any)
        .from('platform_integration_organization_mapping')
        .select('platform_integration_organizations_id')
        .eq('location_id', location.id);
      if (cancelled) return;
      if (mappingErr) {
        console.warn('[Location COA] mapping lookup failed:', mappingErr.message);
        setLocationTenantIds(new Set());
        return;
      }
      const internalIds = Array.from(new Set(
        (mappingRows ?? [])
          .map((r: any) => r.platform_integration_organizations_id)
          .filter((id: any): id is string => !!id),
      ));
      if (internalIds.length === 0) {
        setLocationTenantIds(new Set());
        return;
      }
      const { data: orgRows, error: orgErr } = await (supabase as any)
        .from('platform_integration_organizations')
        .select('id, platform_org_id')
        .in('id', internalIds);
      if (cancelled) return;
      if (orgErr) {
        console.warn('[Location COA] platform_integration_organizations lookup failed:', orgErr.message);
        setLocationTenantIds(new Set());
        return;
      }
      const tenants = new Set<string>();
      for (const o of (orgRows ?? []) as any[]) {
        if (o.platform_org_id) tenants.add(o.platform_org_id);
      }
      console.log('[Location COA] tenants for location', {
        locationId: location.id,
        tenantIds: Array.from(tenants),
      });
      setLocationTenantIds(tenants);
    };
    resolveTenants();
    return () => { cancelled = true; };
  }, [location.id]);

  // Dropdown-facing list. Strictly restricts COA to the tenants mapped to this
  // location via Practice Location Mapping. If the location has no
  // Xero/Iplicit/QuickBooks/Sage mapping, the dropdown is empty — surfacing
  // "No accounts available" rather than leaking accounts from sibling
  // locations that happen to share the org.
  // Inactive accounts are dropped too so users can't pick a deactivated one;
  // the badge lookup against chartOfAccounts still resolves their name/code if
  // they were already mapped before being deactivated.
  const availableAccounts = useMemo(() => {
    if (locationTenantIds.size === 0) return [];
    return chartOfAccounts.filter(acc => {
      if (acc.is_active === false) return false;
      if (acc.__legacy) return false;
      const tenantId = acc.platform_integration_organization_id;
      return tenantId ? locationTenantIds.has(tenantId) : false;
    });
  }, [chartOfAccounts, locationTenantIds]);

  // ── Per-account totals for the global date range ────────────────────
  // Mirrors the cost-impact pages: sum iplicit_profit_loss.amount by
  // account_code/account_id (Iplicit) and platform_integration_invoice_line_items
  // .line_amount with the same grouping (Xero), scoped to the location's
  // mapped tenants when present. Rendered beside each account in the
  // selector so users can see which accounts actually carry money before
  // picking them. Uses the global top-bar date filter (same as Cost Impact).
  const { dateRange } = useFilters();
  const dateFromStr = useMemo(() => {
    const d = dateRange.startDate;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, [dateRange.startDate]);
  const dateToStr = useMemo(() => {
    const d = dateRange.endDate;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, [dateRange.endDate]);

  const tenantIdsKey = useMemo(() => Array.from(locationTenantIds).sort().join(','), [locationTenantIds]);

  const { data: accountAmounts } = useQuery({
    queryKey: ['location-coa-amounts', location.organization_id, location.id, dateFromStr, dateToStr, tenantIdsKey],
    enabled: !!location.organization_id && chartOfAccounts.length > 0,
    queryFn: async () => {
      const byId = new Map<string, number>();
      const byCode = new Map<string, number>();
      if (!location.organization_id) return { byId, byCode };

      const tenants = Array.from(locationTenantIds);
      // Iplicit P&L — normalise start-of-month like Cost Impact so custom
      // date ranges that don't start on the 1st still include that month.
      const iplicitFrom = dateFromStr.slice(0, 8) + '01';
      const PAGE = 1000;

      // Iplicit path
      try {
        let from = 0;
        let hasMore = true;
        while (hasMore) {
          let q = (supabase as any)
            .from('iplicit_profit_loss')
            .select('amount, account_code, account_id')
            .eq('organization_id', location.organization_id)
            .gte('period_date', iplicitFrom)
            .lte('period_date', dateToStr + 'T23:59:59');
          if (tenants.length === 1) q = q.eq('legal_entity_id', tenants[0]);
          else if (tenants.length > 1) q = q.in('legal_entity_id', tenants);
          const { data: rows, error } = await q.range(from, from + PAGE - 1);
          if (error) { console.warn('[Location COA amounts] iplicit error:', error.message); break; }
          for (const r of (rows ?? []) as Array<{ amount: unknown; account_code: string | null; account_id: string | null }>) {
            const amt = Number(r.amount) || 0;
            const code = (r.account_code || '').trim();
            const id = (r.account_id || '').trim();
            if (id) byId.set(id, (byId.get(id) ?? 0) + amt);
            if (code) byCode.set(code, (byCode.get(code) ?? 0) + amt);
          }
          hasMore = (rows ?? []).length === PAGE;
          from += PAGE;
        }
      } catch (e) {
        console.warn('[Location COA amounts] iplicit threw:', e);
      }

      // Xero path
      try {
        let from = 0;
        let hasMore = true;
        while (hasMore) {
          let q = (supabase as any)
            .from('xero_invoice_line_items')
            .select(`
              line_amount,
              account_code,
              account_id,
              invoice:xero_invoices!inner(
                invoice_date, invoice_type, xero_tenant_id
              )
            `)
            .eq('organization_id', location.organization_id)
            // Mirror Cost Impact: amounts come from PL_SYNTHETIC lines (the
            // Xero P&L report mirrored as invoice lines) — they cover every
            // P&L account for the period; adding real ACCPAY lines on top
            // would double-count. Tenant scoping is via xero_tenant_id (the
            // Xero GUID), which is what locationTenantIds collects.
            .eq('invoice.invoice_type', 'PL_SYNTHETIC')
            .gte('invoice.invoice_date', dateFromStr)
            .lte('invoice.invoice_date', dateToStr + 'T23:59:59');
          if (tenants.length === 1) q = q.eq('invoice.xero_tenant_id', tenants[0]);
          else if (tenants.length > 1) q = q.in('invoice.xero_tenant_id', tenants);
          const { data: rows, error } = await q.range(from, from + PAGE - 1);
          if (error) { console.warn('[Location COA amounts] xero error:', error.message); break; }
          for (const r of (rows ?? []) as Array<{ line_amount: unknown; account_code: string | null; account_id: string | null }>) {
            const amt = Number(r.line_amount) || 0;
            const code = (r.account_code || '').trim();
            const id = (r.account_id || '').trim();
            if (id) byId.set(id, (byId.get(id) ?? 0) + amt);
            if (code) byCode.set(code, (byCode.get(code) ?? 0) + amt);
          }
          hasMore = (rows ?? []).length === PAGE;
          from += PAGE;
        }
      } catch (e) {
        console.warn('[Location COA amounts] xero threw:', e);
      }

      // QuickBooks path — quickbooks_profit_loss holds one row per account
      // per calendar month, keyed by qb_account_id (= the value the COA
      // normalisation maps onto `xero_account_id` for QuickBooks rows, which
      // getAccountAmount() looks up in `byId`). Mirrors the Iplicit monthly
      // aggregation: anchor on the month-start (from_date) so a sub-monthly
      // range still picks up that month's P&L. Purely additive — the Xero /
      // Iplicit paths above are unchanged, and QBO account ids don't collide
      // with Xero GUIDs / Iplicit codes so other platforms are unaffected.
      try {
        let from = 0;
        let hasMore = true;
        while (hasMore) {
          let q = (supabase as any)
            .from('quickbooks_profit_loss')
            .select('amount, qb_account_id')
            .eq('organization_id', location.organization_id)
            .gte('from_date', iplicitFrom)
            .lte('from_date', dateToStr);
          if (tenants.length === 1) q = q.eq('realm_id', tenants[0]);
          else if (tenants.length > 1) q = q.in('realm_id', tenants);
          const { data: rows, error } = await q.range(from, from + PAGE - 1);
          if (error) { console.warn('[Location COA amounts] quickbooks error:', error.message); break; }
          for (const r of (rows ?? []) as Array<{ amount: unknown; qb_account_id: string | null }>) {
            const amt = Number(r.amount) || 0;
            const id = (r.qb_account_id || '').trim();
            if (id) byId.set(id, (byId.get(id) ?? 0) + amt);
          }
          hasMore = (rows ?? []).length === PAGE;
          from += PAGE;
        }
      } catch (e) {
        console.warn('[Location COA amounts] quickbooks threw:', e);
      }

      // Sage path — sage_invoice_line_items are the real ACCPAY line items
      // (Sage has no synthetic P&L table; we aggregate real invoices). Each
      // line has an account_code which getAccountAmount() looks up in `byCode`.
      // Tenant scoping: sage_invoices.platform_integration_id resolves to a
      // single Sage business GUID (Sage is single-tenant per OAuth). We fetch
      // the PIO mapping upfront, then filter in JS — Supabase can't filter
      // across a multi-hop join in a single query. Purely additive — other
      // provider paths above are untouched.
      try {
        // Build sage platform_integration_id → business GUID map
        const { data: pioRows } = await (supabase as any)
          .from('platform_integration_organizations')
          .select('platform_integration_id, platform_org_id, platform_name')
          .eq('organization_id', location.organization_id)
          .eq('platform_name', 'sage');
        const sagePiiToTenant = new Map<string, string>();
        for (const r of (pioRows ?? []) as Array<{ platform_integration_id: string | null; platform_org_id: string | null }>) {
          if (r.platform_integration_id && r.platform_org_id) {
            sagePiiToTenant.set(r.platform_integration_id, r.platform_org_id);
          }
        }

        let from = 0;
        let hasMore = true;
        while (hasMore) {
          const q = (supabase as any)
            .from('sage_invoice_line_items')
            .select(`
              line_amount,
              account_code,
              invoice:sage_invoices!inner(
                invoice_date, platform_integration_id
              )
            `)
            .eq('organization_id', location.organization_id)
            .gte('invoice.invoice_date', dateFromStr)
            .lte('invoice.invoice_date', dateToStr + 'T23:59:59');
          const { data: rows, error } = await q.range(from, from + PAGE - 1);
          if (error) { console.warn('[Location COA amounts] sage error:', error.message); break; }
          for (const r of (rows ?? []) as Array<{ line_amount: unknown; account_code: string | null; invoice?: { platform_integration_id?: string | null } | null }>) {
            const pii = r.invoice?.platform_integration_id ?? null;
            const sageTenant = pii ? (sagePiiToTenant.get(pii) || null) : null;
            // Apply tenant scope same as other providers: when the location
            // has mapped tenants, only include rows whose Sage tenant matches.
            if (tenants.length > 0) {
              if (!sageTenant || !tenants.includes(sageTenant)) continue;
            }
            const amt = Number(r.line_amount) || 0;
            const code = (r.account_code || '').trim();
            if (code) byCode.set(code, (byCode.get(code) ?? 0) + amt);
          }
          hasMore = (rows ?? []).length === PAGE;
          from += PAGE;
        }
      } catch (e) {
        console.warn('[Location COA amounts] sage threw:', e);
      }

      return { byId, byCode };
    },
    staleTime: 5 * 60 * 1000, // 5 minutes — amounts don't change as you scroll the list
  });

  const formatAccountAmount = (value: number): string => {
    const sign = value < 0 ? '-' : '';
    const abs = Math.abs(value);
    // Show the exact figure to 2 decimal places — never round to whole pounds.
    // The underlying amounts (P&L / current_balance) are NUMERIC(18,2), so 2dp
    // is their full precision.
    return `${sign}£${abs.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const getAccountAmount = (account: any): number | null => {
    if (!accountAmounts) return null;
    const id = (account.xero_account_id || '').trim();
    const code = (account.account_code || '').trim();
    if (id && accountAmounts.byId.has(id)) return accountAmounts.byId.get(id)!;
    if (code && accountAmounts.byCode.has(code)) return accountAmounts.byCode.get(code)!;
    // QuickBooks balance-sheet accounts (Bank / Accounts Payable / Accounts
    // Receivable / Credit Card / Fixed Asset / etc.) never appear in a Profit
    // & Loss report, so quickbooks_profit_loss — and therefore `byId` — has no
    // row for them and the amount would always render £0. Fall back to the
    // account's current balance from quickbooks_chart_of_accounts. QBO reports
    // current_balance as 0 for P&L accounts, so this only ever surfaces a
    // figure for balance-sheet accounts and never overrides a real P&L total.
    // `qb_account_id` is only present on normalised QuickBooks rows, so Xero
    // and Iplicit accounts are untouched.
    if (account.qb_account_id) {
      const bal = Number(account.current_balance);
      if (Number.isFinite(bal) && bal !== 0) return bal;
    }
    return 0;
  };

  // Fetch rules for location
  const fetchRules = async () => {
    if (!location.id) {
      setRules([]);
      return;
    }

    setIsLoadingRules(true);
    try {
      const { data, error } = await supabase
        .from('accounts_payable_invoice_rules_mapping' as any)
        .select('*')
        .eq('location_id', location.id)
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
  }, [location.id]);

  // Save Business Settings for this location
  const handleSaveBusinessInfo = async () => {
    setIsSavingBusinessInfo(true);
    try {
      const { error } = await supabase
        .from('practice_locations')
        .update({
          // parseFloat throughout — these fields accept decimals (e.g. 7.5 open
          // hours, 4.5 days a week); parseInt would silently truncate them.
          week_open_per_year: businessInfo.week_open_per_year ? parseFloat(businessInfo.week_open_per_year) : null,
          days_open_per_week: businessInfo.days_open_per_week ? parseFloat(businessInfo.days_open_per_week) : null,
          open_hours_per_day: businessInfo.open_hours_per_day ? parseFloat(businessInfo.open_hours_per_day) : null,
          number_of_surgeries: businessInfo.number_of_surgeries ? parseFloat(businessInfo.number_of_surgeries) : null,
          associate_weeks_per_year: businessInfo.associate_weeks_per_year ? parseFloat(businessInfo.associate_weeks_per_year) : null,
          associate_days_per_week: businessInfo.associate_days_per_week ? parseFloat(businessInfo.associate_days_per_week) : null,
          associate_cost_lab_source: businessInfo.associate_cost_lab_source || null,
          associate_cost_labs_percent: businessInfo.associate_cost_labs_percent ? parseFloat(businessInfo.associate_cost_labs_percent) : null,
          material_cost_source: businessInfo.material_cost_source || null,
          practice_cost_materials_percent: businessInfo.practice_cost_materials_percent ? parseFloat(businessInfo.practice_cost_materials_percent) : null,
          target_profit_percent: businessInfo.target_profit_percent ? parseFloat(businessInfo.target_profit_percent) : null,
          target_chair_revenue_per_hour: businessInfo.target_chair_revenue_per_hour ? parseFloat(businessInfo.target_chair_revenue_per_hour) : null,
          employee_working_duration_type: businessInfo.employee_working_duration_type || null,
          is_associate_pay_including_lab_cost: businessInfo.is_associate_pay_including_lab_cost,
          is_associate_pay_including_material_cost: businessInfo.is_associate_pay_including_material_cost,
          updated_by: user?.id,
        } as any)
        .eq('id', location.id);

      if (error) throw error;

      toast.success('Business settings saved successfully');
      queryClient.invalidateQueries({ queryKey: ['practice_locations'] });
      queryClient.invalidateQueries({ queryKey: ['user_practice_locations'] });
    } catch (error: any) {
      console.error('Error saving business settings:', error);
      toast.error(error.message || 'Failed to save business settings');
    } finally {
      setIsSavingBusinessInfo(false);
    }
  };

  // Rules handlers
  const handleAddRule = () => {
    setEditingRule(null);
    setRuleForm({ email: '', inbound_email_id: '', folder_id: '', chart_of_account_id: '' });
    setIsRuleModalOpen(true);
  };

  const handleEditRule = (rule: Rule) => {
    setEditingRule(rule);
    setRuleForm({
      email: rule.email,
      inbound_email_id: rule.inbound_email_id || '',
      folder_id: rule.folder_id || '',
      chart_of_account_id: rule.chart_of_account_id || '',
    });
    setIsRuleModalOpen(true);
  };

  const handleSaveRule = async () => {
    if (!ruleForm.email) {
      toast.error('Email is required');
      return;
    }

    setIsSavingRule(true);
    try {
      const selectedInboundEmail = locationInboundEmails.find((e: any) => e.id === ruleForm.inbound_email_id);

      const ruleData = {
        email: ruleForm.email,
        inbound_email_id: ruleForm.inbound_email_id || null,
        inbound_email_address: selectedInboundEmail?.inbound_email_address || null,
        folder_id: ruleForm.folder_id || null,
        chart_of_account_id: ruleForm.chart_of_account_id || null,
        organization_id: location.organization_id,
        location_id: location.id,
        user_id: user?.id,
        is_active: true,
      };

      if (editingRule) {
        const { error } = await supabase
          .from('accounts_payable_invoice_rules_mapping' as any)
          .update(ruleData)
          .eq('id', editingRule.id);

        if (error) throw error;
        toast.success('Rule updated successfully');
      } else {
        const { error } = await supabase
          .from('accounts_payable_invoice_rules_mapping' as any)
          .insert(ruleData);

        if (error) throw error;
        toast.success('Rule created successfully');
      }

      setIsRuleModalOpen(false);
      fetchRules();
    } catch (error) {
      console.error('Error saving rule:', error);
      toast.error('Failed to save rule');
    } finally {
      setIsSavingRule(false);
    }
  };

  const handleDeleteRule = async () => {
    if (!ruleToDelete) return;

    setIsDeletingRule(true);
    try {
      const { error } = await supabase
        .from('accounts_payable_invoice_rules_mapping' as any)
        .delete()
        .eq('id', ruleToDelete);

      if (error) throw error;
      toast.success('Rule deleted successfully');
      setDeleteConfirmOpen(false);
      setRuleToDelete(null);
      fetchRules();
    } catch (error) {
      console.error('Error deleting rule:', error);
      toast.error('Failed to delete rule');
    } finally {
      setIsDeletingRule(false);
    }
  };

  return (
    <div className={cn("space-y-6", isAccordionView && "pt-4")}>
      {/* Location Info Card */}
      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-muted-foreground">Email</label>
                <div className="flex items-center gap-2 mt-1">
                  <Mail className="w-4 h-4 text-muted-foreground" />
                  <span>{location.email || 'Not provided'}</span>
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Inbound Email (Cost)</label>
                <div className="flex items-center gap-2 mt-1">
                  {isCreatingEmails && !costEmail ? (
                    <>
                      <Loader2 className="w-4 h-4 text-primary animate-spin" />
                      <span className="text-sm text-primary">Generating email...</span>
                    </>
                  ) : (
                    <>
                      <Mail className="w-4 h-4 text-muted-foreground" />
                      {costEmail ? (
                        <span className="text-sm break-all">{costEmail}</span>
                      ) : (
                        <span className="text-muted-foreground text-sm">Not configured</span>
                      )}
                    </>
                  )}
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Inbound Email (Sales)</label>
                <div className="flex items-center gap-2 mt-1">
                  {isCreatingEmails && !salesEmail ? (
                    <>
                      <Loader2 className="w-4 h-4 text-primary animate-spin" />
                      <span className="text-sm text-primary">Generating email...</span>
                    </>
                  ) : (
                    <>
                      <Mail className="w-4 h-4 text-muted-foreground" />
                      {salesEmail ? (
                        <span className="text-sm break-all">{salesEmail}</span>
                      ) : (
                        <span className="text-muted-foreground text-sm">Not configured</span>
                      )}
                    </>
                  )}
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Phone</label>
                <div className="flex items-center gap-2 mt-1">
                  <Phone className="w-4 h-4 text-muted-foreground" />
                  <span>{location.phone || 'Not provided'}</span>
                </div>
              </div>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-muted-foreground">Location ID</label>
                <div className="mt-1">
                  <code className="text-xs bg-muted px-2 py-1 rounded font-mono">{location.id}</code>
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Created</label>
                <div className="flex items-center gap-2 mt-1">
                  <Calendar className="w-4 h-4 text-muted-foreground" />
                  <span>{location.created_at ? format(new Date(location.created_at), 'MMMM dd, yyyy') : 'N/A'}</span>
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Last Updated</label>
                <div className="flex items-center gap-2 mt-1">
                  <Calendar className="w-4 h-4 text-muted-foreground" />
                  <span>{location.updated_at ? format(new Date(location.updated_at), 'MMMM dd, yyyy') : 'N/A'}</span>
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Address</label>
                <div className="flex items-center gap-2 mt-1">
                  <MapPin className="w-4 h-4 text-muted-foreground" />
                  <span>{fullAddress || 'Not provided'}</span>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <Users className="w-4 h-4" />
              <span>Team Members</span>
            </div>
            <div className="text-2xl font-semibold">{teamMembers.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <Users className="w-4 h-4" />
              <span>Users</span>
            </div>
            <div className="text-2xl font-semibold">{userRoles.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <Settings className="w-4 h-4" />
              <span>Chart of Accounts</span>
            </div>
            <div className="text-2xl font-semibold">{availableAccounts.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <FileText className="w-4 h-4" />
              <span>Rules</span>
            </div>
            <div className="text-2xl font-semibold">{rules.length}</div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="team" className="space-y-4">
        <TabsList>
          <TabsTrigger value="team">Team Members ({teamMembers.length})</TabsTrigger>
          <TabsTrigger value="users">Users ({userRoles.length})</TabsTrigger>
          <TabsTrigger value="rules">Rules</TabsTrigger>
          <TabsTrigger value="business">Business Settings</TabsTrigger>
        </TabsList>

        {/* Team Members Tab */}
        <TabsContent value="team">
          <Card>
            <CardHeader>
              <CardTitle>Team Members</CardTitle>
              <CardDescription>Staff members at this location</CardDescription>
            </CardHeader>
            <CardContent>
              {teamMembers.length > 0 ? (
                <div className="space-y-4">
                  {teamMembers.map((member: any) => (
                    <div key={member.id} className="flex items-center justify-between p-4 border rounded-lg">
                      <div className="space-y-1">
                        <div className="font-medium">{member.name}</div>
                        <div className="text-sm text-muted-foreground">{member.role_type}</div>
                        {member.email && (
                          <div className="text-sm text-muted-foreground flex items-center gap-1">
                            <Mail className="w-3 h-3" />
                            {member.email}
                          </div>
                        )}
                      </div>
                      <Badge variant="outline">{member.status || 'Active'}</Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Users className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>No team members added yet</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Users Tab */}
        <TabsContent value="users">
          <Card>
            <CardHeader>
              <CardTitle>Users</CardTitle>
              <CardDescription>Users with access to this organization</CardDescription>
            </CardHeader>
            <CardContent>
              {userRoles.length > 0 ? (
                <div className="space-y-4">
                  {userRoles.map((userRole: any) => (
                    <div key={userRole.id} className="flex items-center justify-between p-4 border rounded-lg">
                      <div className="space-y-1">
                        <div className="font-medium">{userRole.profiles?.full_name || userRole.profiles?.email || 'Unknown User'}</div>
                        <div className="text-sm text-muted-foreground">{userRole.profiles?.email}</div>
                      </div>
                      <Badge variant="secondary">{userRole.role}</Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Users className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>No users found</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Rules Tab */}
        <TabsContent value="rules">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Rules</CardTitle>
                  <CardDescription>Automation rules for invoice processing at this location</CardDescription>
                </div>
                <Button onClick={handleAddRule}>
                  <Plus className="w-4 h-4 mr-2" />
                  Add Rule
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {isLoadingRules ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                  <span className="ml-2">Loading rules...</span>
                </div>
              ) : rules.length > 0 ? (
                <div className="space-y-4">
                  {rules.map((rule) => {
                    const folder = invoiceFolders.find((f: any) => f.id === rule.folder_id);
                    const coa = chartOfAccounts.find((c: any) => c.id === rule.chart_of_account_id);

                    return (
                      <div key={rule.id} className={`border rounded-lg p-4 relative ${rule.is_active ? 'border-primary/50 bg-primary/5' : 'border-gray-200'}`}>
                        <div className={`absolute left-0 top-0 bottom-0 w-1 rounded-l-lg ${rule.is_active ? 'bg-primary' : 'bg-gray-400'}`}></div>
                        <div className="pl-3 flex items-start justify-between">
                          <div className="space-y-2 flex-1">
                            <div className="flex items-center gap-2">
                              <Mail className="w-4 h-4 text-muted-foreground" />
                              <span className="font-medium">{rule.email}</span>
                            </div>
                            {rule.inbound_email_address && (
                              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <Mail className="w-3 h-3" />
                                <span className="break-all">{rule.inbound_email_address}</span>
                              </div>
                            )}
                            <div className="flex flex-wrap gap-4 text-sm">
                              {folder && (
                                <div className="flex items-center gap-1 text-muted-foreground">
                                  <FolderIcon className="w-3 h-3" />
                                  <span>{folder.name}</span>
                                </div>
                              )}
                              {coa && (
                                <div className="flex items-center gap-1 text-muted-foreground">
                                  <FileText className="w-3 h-3" />
                                  <span>{coa.account_code} - {coa.account_name}</span>
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button variant="ghost" size="icon" onClick={() => handleEditRule(rule)}>
                              <Pencil className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                setRuleToDelete(rule.id);
                                setDeleteConfirmOpen(true);
                              }}
                            >
                              <Trash2 className="w-4 h-4 text-destructive" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>No rules configured yet</p>
                  <p className="text-sm mt-2">Add rules to automate invoice processing</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Business Settings Tab */}
        <TabsContent value="business">
          <Card>
            <CardHeader>
              <CardTitle>Business Settings</CardTitle>
              <CardDescription>Operational details used for profit and payslip calculations at this location</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="weekOpenPerYear">Week Open Per Year</Label>
                  <Input
                    id="weekOpenPerYear"
                    type="number"
                    step="any"
                    placeholder="Enter weeks"
                    value={businessInfo.week_open_per_year}
                    onChange={(e) => setBusinessInfo({ ...businessInfo, week_open_per_year: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="daysOpenPerWeek">Days Open Per Week</Label>
                  <Input
                    id="daysOpenPerWeek"
                    type="number"
                    step="any"
                    placeholder="Enter days"
                    value={businessInfo.days_open_per_week}
                    onChange={(e) => setBusinessInfo({ ...businessInfo, days_open_per_week: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="openHourInDay">Open Hour in a Day</Label>
                  <Input
                    id="openHourInDay"
                    type="number"
                    step="any"
                    placeholder="Enter hours"
                    value={businessInfo.open_hours_per_day}
                    onChange={(e) => setBusinessInfo({ ...businessInfo, open_hours_per_day: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="numberOfSurgeries">Number Of Surgeries</Label>
                  <Input
                    id="numberOfSurgeries"
                    type="number"
                    step="any"
                    placeholder="Enter number"
                    value={businessInfo.number_of_surgeries}
                    onChange={(e) => setBusinessInfo({ ...businessInfo, number_of_surgeries: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="associateWeeksPerYear">Associates Weeks Per Year</Label>
                  <Input
                    id="associateWeeksPerYear"
                    type="number"
                    step="any"
                    placeholder="Enter weeks"
                    value={businessInfo.associate_weeks_per_year}
                    onChange={(e) => setBusinessInfo({ ...businessInfo, associate_weeks_per_year: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="associateDaysPerWeek">Associates Days Per Week</Label>
                  <Input
                    id="associateDaysPerWeek"
                    type="number"
                    step="any"
                    placeholder="Enter days"
                    value={businessInfo.associate_days_per_week}
                    onChange={(e) => setBusinessInfo({ ...businessInfo, associate_days_per_week: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="associateCostLabSource">Associate Cost Lab Source</Label>
                  <Select
                    value={businessInfo.associate_cost_lab_source}
                    onValueChange={(value) => setBusinessInfo({ ...businessInfo, associate_cost_lab_source: value })}
                  >
                    <SelectTrigger id="associateCostLabSource">
                      <SelectValue placeholder="Select source" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="flat_per_by_practice">Flat per by price</SelectItem>
                      <SelectItem value="associate_wise">Associate wise Per</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {businessInfo.associate_cost_lab_source === 'flat_per_by_practice' && (
                  <div className="space-y-2">
                    <Label htmlFor="associateCostLabs">Associate Cost Labs (%)</Label>
                    <Input
                      id="associateCostLabs"
                      type="number"
                      step="0.01"
                      placeholder="Enter percentage"
                      value={businessInfo.associate_cost_labs_percent}
                      onChange={(e) => setBusinessInfo({ ...businessInfo, associate_cost_labs_percent: e.target.value })}
                    />
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="materialCostSource">Material Cost Source</Label>
                  <Select
                    value={businessInfo.material_cost_source}
                    onValueChange={(value) => setBusinessInfo({ ...businessInfo, material_cost_source: value })}
                  >
                    <SelectTrigger id="materialCostSource">
                      <SelectValue placeholder="Select source" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="flat_per_by_practice">Flat per by price</SelectItem>
                      <SelectItem value="associate_wise">Associate wise Per</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {businessInfo.material_cost_source === 'flat_per_by_practice' && (
                  <div className="space-y-2">
                    <Label htmlFor="practiceCostMaterials">Practice Cost Materials (%)</Label>
                    <Input
                      id="practiceCostMaterials"
                      type="number"
                      step="0.01"
                      placeholder="Enter percentage"
                      value={businessInfo.practice_cost_materials_percent}
                      onChange={(e) => setBusinessInfo({ ...businessInfo, practice_cost_materials_percent: e.target.value })}
                    />
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="targetProfit">Target Profit (%)</Label>
                  <Input
                    id="targetProfit"
                    type="number"
                    step="0.01"
                    placeholder="Enter percentage"
                    value={businessInfo.target_profit_percent}
                    onChange={(e) => setBusinessInfo({ ...businessInfo, target_profit_percent: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="targetChairRevenue">Target Chair Revenue per Hour</Label>
                  <Input
                    id="targetChairRevenue"
                    type="number"
                    step="0.01"
                    placeholder="Enter amount"
                    value={businessInfo.target_chair_revenue_per_hour}
                    onChange={(e) => setBusinessInfo({ ...businessInfo, target_chair_revenue_per_hour: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="employeeWorkingDurationType">Employee Working Duration Type</Label>
                  <Select
                    value={businessInfo.employee_working_duration_type}
                    onValueChange={(value) => setBusinessInfo({ ...businessInfo, employee_working_duration_type: value })}
                  >
                    <SelectTrigger id="employeeWorkingDurationType">
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="days">Days</SelectItem>
                      <SelectItem value="hours">Hours</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-3">
                  <Label htmlFor="isAssociatePayIncludingLabCost">Is Associate Pay Including Lab Cost</Label>
                  <Switch
                    id="isAssociatePayIncludingLabCost"
                    checked={businessInfo.is_associate_pay_including_lab_cost}
                    onCheckedChange={(checked) => setBusinessInfo({ ...businessInfo, is_associate_pay_including_lab_cost: checked })}
                  />
                </div>
                <div className="flex items-center gap-3">
                  <Label htmlFor="isAssociatePayIncludingMaterialCost">Is Associate Pay Including Material Cost</Label>
                  <Switch
                    id="isAssociatePayIncludingMaterialCost"
                    checked={businessInfo.is_associate_pay_including_material_cost}
                    onCheckedChange={(checked) => setBusinessInfo({ ...businessInfo, is_associate_pay_including_material_cost: checked })}
                  />
                </div>
              </div>

              <div className="flex justify-end mt-6">
                <Button onClick={handleSaveBusinessInfo} disabled={isSavingBusinessInfo}>
                  {isSavingBusinessInfo ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    'Save Business Settings'
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Add/Edit Rule Modal */}
      <Dialog open={isRuleModalOpen} onOpenChange={setIsRuleModalOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingRule ? 'Edit Rule' : 'Create Rule'}</DialogTitle>
            <DialogDescription>Configure automation rules for invoice processing</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Select Inbound Email *</Label>
              <Select
                value={ruleForm.inbound_email_id}
                onValueChange={(value) => {
                  // Reset folder selection when inbound email changes
                  setRuleForm({ ...ruleForm, inbound_email_id: value, folder_id: '' });
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="-- Select Inbound Email --" />
                </SelectTrigger>
                <SelectContent>
                  {locationInboundEmails.length === 0 ? (
                    <div className="px-2 py-2 text-sm text-muted-foreground">No inbound emails available</div>
                  ) : (
                    locationInboundEmails.map((email: any) => (
                      <SelectItem key={email.id} value={email.id}>
                        {email.inbound_email_address}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Sender Email *</Label>
              <Input
                type="email"
                placeholder="sender@example.com"
                value={ruleForm.email}
                onChange={(e) => setRuleForm({ ...ruleForm, email: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">Invoices from this email will be automatically processed</p>
            </div>
            <div className="space-y-2">
              <Label>Folder</Label>
              <Popover open={folderPopoverOpen} onOpenChange={(open) => ruleForm.inbound_email_id && setFolderPopoverOpen(open)}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={folderPopoverOpen}
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
                        {invoiceFolders.find((f: any) => f.id === ruleForm.folder_id)?.name || 'Select folder'}
                      </span>
                    ) : (
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <FolderIcon className="w-4 h-4" />
                        -- Select Folder --
                      </span>
                    )}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[400px] p-0 z-[100]" align="start">
                  <div className="max-h-[300px] overflow-auto" onWheel={(e) => e.stopPropagation()}>
                    <div className="py-1">
                      {/* Parent folders and their children */}
                      {invoiceFolders
                        .filter((f: any) => !f.parent_id)
                        .map((parentFolder: any) => {
                          const children = invoiceFolders.filter((f: any) => f.parent_id === parentFolder.id);
                          const hasChildren = children.length > 0;

                          return (
                            <div key={parentFolder.id}>
                              {/* Parent folder as header - disabled if has children */}
                              <div
                                className={cn(
                                  "px-3 py-2 font-medium text-sm border-t border-gray-100 first:border-t-0",
                                  hasChildren
                                    ? "text-indigo-600 cursor-default"
                                    : "cursor-pointer hover:bg-gray-100",
                                  !hasChildren && ruleForm.folder_id === parentFolder.id && "bg-indigo-50 text-indigo-700"
                                )}
                                onClick={() => {
                                  if (hasChildren) return; // Don't allow selection if has children
                                  setRuleForm({ ...ruleForm, folder_id: parentFolder.id });
                                  setFolderPopoverOpen(false);
                                }}
                              >
                                {parentFolder.name}
                              </div>

                              {/* Child folders - indented */}
                              {children.map((child: any) => (
                                <div
                                  key={child.id}
                                  className={cn(
                                    "px-3 py-2 pl-6 cursor-pointer hover:bg-gray-100 text-sm",
                                    ruleForm.folder_id === child.id && "bg-indigo-50 text-indigo-700"
                                  )}
                                  onClick={() => {
                                    setRuleForm({ ...ruleForm, folder_id: child.id });
                                    setFolderPopoverOpen(false);
                                  }}
                                >
                                  {child.name}
                                </div>
                              ))}
                            </div>
                          );
                        })}
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-2">
              <Label>Chart of Account</Label>
              <Select
                value={ruleForm.chart_of_account_id}
                onValueChange={(value) => setRuleForm({ ...ruleForm, chart_of_account_id: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="-- Select Account --" />
                </SelectTrigger>
                <SelectContent>
                  {availableAccounts.map((account: any) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.account_code} - {account.account_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsRuleModalOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveRule} disabled={isSavingRule}>
              {isSavingRule ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                editingRule ? 'Save Rule' : 'Create Rule'
              )}
            </Button>
          </DialogFooter>
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
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteRule} disabled={isDeletingRule}>
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
    </div>
  );
}
