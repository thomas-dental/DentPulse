import { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { Check, ChevronsUpDown, Loader2, CheckCircle2, XCircle, MinusCircle, Folder, Tag, X, Plus, MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AccountsPayableInvoice } from '@/hooks/useAccountsPayableInvoices';
import { useProviders } from '@/hooks/useProviders';
import { useOrganization } from '@/hooks/useOrganization';
import { useInvoiceFolders } from '@/hooks/useInvoiceFolders';
import { useInvoiceTags, useInvoiceTagsForInvoice } from '@/hooks/useInvoiceTags';
import { useLocations } from '@/hooks/useLocations';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { fetchCoaLabelsByIds } from '@/utils/fetchCoaLabelsByIds';

interface InvoiceDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: AccountsPayableInvoice | null;
  onUpdate?: (invoiceId: string, updates: Partial<AccountsPayableInvoice>) => Promise<void>;
  selectedLocationId?: string | null; // Location ID from global filter
  onTagsUpdate?: () => void; // Callback when tags are updated
}

export function InvoiceDetailModal({
  open,
  onOpenChange,
  invoice,
  onUpdate,
  selectedLocationId,
  onTagsUpdate,
}: InvoiceDetailModalProps) {
  const queryClient = useQueryClient();
  const [isUpdating, setIsUpdating] = useState(false);
  const [approveAll, setApproveAll] = useState(false);
  const [needsApproverApproval, setNeedsApproverApproval] = useState(false);
  const [lineApprovers, setLineApprovers] = useState<Record<string, string>>({});
  const [lineApproverOpen, setLineApproverOpen] = useState<Record<string, boolean>>({});
  const [linePercentages, setLinePercentages] = useState<Record<string, string>>({});
  const [lineCoaIds, setLineCoaIds] = useState<Record<string, string>>({});
  const [lineCoaOpen, setLineCoaOpen] = useState<Record<string, boolean>>({});
  const [coaSearchTerm, setCoaSearchTerm] = useState('');

  // Single approver state (when "All Items Approve by single approver" is checked)
  const [singleApprover, setSingleApprover] = useState<string>('');
  const [singleApproverOpen, setSingleApproverOpen] = useState(false);
  const [singlePercentage, setSinglePercentage] = useState<string>('');
  const [isSendingEmail, setIsSendingEmail] = useState(false);

  // Folder selector state
  const [folderOpen, setFolderOpen] = useState(false);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);

  // Tags selector state
  const [tagsOpen, setTagsOpen] = useState(false);
  const isRemovingTagRef = useRef(false);
  const [newTagName, setNewTagName] = useState('');

  // Location selector state
  const [locationOpen, setLocationOpen] = useState(false);
  const [selectedLocationIdLocal, setSelectedLocationIdLocal] = useState<string | null>(null);

  // Track previous location to detect actual changes (not initial load)
  const [previousLocationId, setPreviousLocationId] = useState<string | null>(null);

  // Reset state when modal closes to ensure fresh data on reopen
  useEffect(() => {
    if (!open) {
      setLineCoaIds({});
      setLineCoaOpen({});
      setCoaSearchTerm('');
      setPreviousLocationId(null);
      setSingleApprover('');
      setSinglePercentage('');
      setApproveAll(false);
    }
  }, [open]);

  // Editable form state
  const [formData, setFormData] = useState({
    customer_name: '',
    vendor_name: '',
    invoice_date: '',
    due_date: '',
  });

  // Determine which location to filter folders by:
  // - If a global location filter is set (selectedLocationId), use that
  // - Otherwise, use the invoice's location (selectedLocationIdLocal)
  const effectiveLocationId = selectedLocationId || selectedLocationIdLocal || invoice?.location_id || null;

  // Fetch providers/dentists for the approver dropdown - filtered by selected location
  const { providers, isLoading: isLoadingProviders } = useProviders(undefined, effectiveLocationId);

  // Fetch folders for the folder dropdown - filtered by location
  const { folders, isLoading: isLoadingFolders } = useInvoiceFolders({
    selectedLocationId: effectiveLocationId,
  });

  // Fetch the current folder name directly if it exists (handles case where folder is from different location)
  const { data: currentFolderData } = useQuery({
    queryKey: ['invoice-folder-by-id', selectedFolderId],
    queryFn: async () => {
      if (!selectedFolderId) return null;
      const { data, error } = await supabase
        .from('invoice_folders')
        .select('id, name')
        .eq('id', selectedFolderId)
        .maybeSingle();
      if (error) {
        console.error('Error fetching folder by ID:', error);
        return null;
      }
      return data;
    },
    enabled: !!selectedFolderId,
  });

  // Get the folder name - either from the filtered list or from direct fetch
  const getFolderName = (folderId: string | null): string | null => {
    if (!folderId) return null;
    // First try to find in the filtered folders list
    const folderInList = folders.find((f) => f.id === folderId);
    if (folderInList) return folderInList.name;
    // If not found, use the directly fetched folder data
    if (currentFolderData && currentFolderData.id === folderId) {
      return currentFolderData.name;
    }
    return null;
  };

  // Fetch locations for the location dropdown
  const { locations, isLoading: isLoadingLocations } = useLocations();

  // Fetch tags for the tags dropdown
  const { tags, isLoading: isLoadingTags, createTag, assignTagsToInvoice } = useInvoiceTags();
  const { assignedTagIds, refetch: refetchInvoiceTags } = useInvoiceTagsForInvoice(invoice?.id || null);

  // Get active providers for dropdown
  const activeProviders = providers?.filter(p => p.is_active) || [];

  // Get organization ID
  const { organizationId } = useOrganization();

  // Check if effective location is mapped to a platform organization
  // Use effectiveLocationId (which includes invoice's location) for consistent COA filtering
  const { data: locationMapping, isLoading: isLoadingMapping } = useQuery({
    queryKey: ['location-org-mapping-detail', effectiveLocationId, organizationId],
    queryFn: async () => {
      if (!effectiveLocationId || !organizationId) return null;

      // Get the mapping for this location
      const { data: mappingData, error: mappingError } = await (supabase as any)
        .from('platform_integration_organization_mapping')
        .select('platform_integration_organizations_id')
        .eq('organization_id', organizationId)
        .eq('location_id', effectiveLocationId)
        .maybeSingle();

      if (mappingError) {
        console.error('Error fetching location mapping:', mappingError);
        return null;
      }

      if (!mappingData?.platform_integration_organizations_id) {
        return null; // Location is not mapped
      }

      // Get the platform organization details with platform integration info
      const { data: platformOrgData, error: platformOrgError } = await (supabase as any)
        .from('platform_integration_organizations')
        .select('id, platform_org_id, platform_org_name, platform_integration_id, platform_name')
        .eq('id', mappingData.platform_integration_organizations_id)
        .single();

      if (platformOrgError) {
        console.error('Error fetching platform org:', platformOrgError);
        return null;
      }

      return {
        platformOrgId: platformOrgData.id,
        platformOrgDbId: platformOrgData.id, // Same as platformOrgId - the DB row id (used as xero_tenant_id)
        platformOrgName: platformOrgData.platform_org_name,
        platformIntegrationId: platformOrgData.platform_integration_id,
        platformName: platformOrgData.platform_name,
      };
    },
    enabled: !!effectiveLocationId && !!organizationId,
  });

  // System accounts to exclude from COA selection
  const excludedSystemAccounts = [
    'BANKCURRENCYGAIN',
    'UNREALISEDCURRENCYGAIN',
    'DEBTORS',
    'CREDITORS',
    'UNPAIDEXPCLM',
    'WAGEPAYABLES',
    'TRACKINGTRANSFERS',
  ];

  // Fetch chart of accounts based on platform type (xero or iplicit)
  const { data: chartOfAccounts = [], isLoading: isLoadingCOA } = useQuery({
    queryKey: ['chart-of-accounts-by-location', locationMapping?.platformOrgId, locationMapping?.platformName, organizationId],
    queryFn: async () => {
      if (!organizationId) return [];

      // Use platform name from location mapping (most reliable with multi-account)
      let platformName = locationMapping?.platformName?.toLowerCase();

      // Fallback: query platform_integrations if no mapping available
      if (!platformName) {
        const { data: connectedPlatforms } = await supabase
          .from('platform_integrations')
          .select('id, platform_name')
          .eq('organization_id', organizationId)
          .eq('is_connected', true)
          .in('platform_name', ['iplicit', 'xero', 'quickbooks', 'sage'])
          .limit(1);

        platformName = connectedPlatforms?.[0]?.platform_name?.toLowerCase();
      }

      let coaData: any[] = [];

      if (platformName === 'iplicit') {
        console.log('[COA Debug] Entering IPLICIT block');
        // Fetch from iplicit_chart_of_accounts table
        // Filter by ap_flag = true to only show accounts valid for purchase invoices
        const { data, error } = await (supabase as any)
          .from('iplicit_chart_of_accounts')
          .select('*')
          .eq('organization_id', organizationId)
          .eq('is_active', true)
          .eq('ap_flag', true)
          .order('account_type', { ascending: true })
          .order('code', { ascending: true });

        if (error) {
          console.error('Error fetching iplicit chart of accounts:', error);
          return [];
        }

        // Map Iplicit fields to common format
        coaData = ((data || []) as any[]).map((account: any) => ({
          id: account.id,
          coa_account_code: account.code,
          coa_account_name: account.name || account.description,
          coa_account_type: account.account_type,
          coa_is_active: account.is_active,
          ...account,
        }));
      } else if (platformName === 'quickbooks') {
        // Fetch from quickbooks_chart_of_accounts table
        let quickbooksQuery = (supabase as any)
          .from('quickbooks_chart_of_accounts')
          .select('*')
          .eq('organization_id', organizationId)
          .eq('is_active', true);

        // Scope to specific QuickBooks connection if mapped
        if (locationMapping?.platformIntegrationId) {
          quickbooksQuery = quickbooksQuery.eq('platform_integration_id', locationMapping.platformIntegrationId);
        }

        const { data, error } = await quickbooksQuery
          .order('account_type', { ascending: true })
          .order('account_number', { ascending: true });

        if (error) {
          console.error('Error fetching quickbooks chart of accounts:', error);
          return [];
        }

        // Map QuickBooks fields to common format
        coaData = ((data || []) as any[]).map((account: any) => ({
          id: account.id,
          coa_account_code: account.account_number,
          coa_account_name: account.account_name,
          coa_account_type: account.account_type,
          coa_is_active: account.is_active,
          ...account,
        }));
      } else if (platformName === 'xero') {
        // Fetch from xero_chart_of_accounts, scoped to the Xero organisation
        // mapped to this location (xero_tenant_id = platformOrgDbId).
        const buildXeroQuery = (scopeToTenant: boolean, scopeToIntegration: boolean) => {
          let q = (supabase as any)
            .from('xero_chart_of_accounts')
            .select('*')
            .eq('organization_id', organizationId)
            .eq('is_active', true);
          if (scopeToIntegration && locationMapping?.platformIntegrationId) {
            q = q.eq('platform_integration_id', locationMapping.platformIntegrationId);
          }
          if (scopeToTenant && locationMapping?.platformOrgDbId) {
            q = q.eq('xero_tenant_id', locationMapping.platformOrgDbId);
          }
          return q.order('account_type', { ascending: true }).order('account_code', { ascending: true });
        };

        // Try scoped query first (by tenant and integration)
        let { data, error } = await buildXeroQuery(true, true);

        // Fall back 1: by integration only (no tenant filter)
        if (!error && (!data || data.length === 0)) {
          const fb = await buildXeroQuery(false, true);
          data = fb.data;
          error = fb.error;
        }

        // Fall back 2: all Xero accounts for the org (no filters)
        if (!error && (!data || data.length === 0)) {
          const fb = await buildXeroQuery(false, false);
          data = fb.data;
          error = fb.error;
        }

        if (error) {
          console.error('Error fetching xero chart of accounts:', error);
          return [];
        }

        // Map Xero fields to common format
        coaData = ((data || []) as any[]).map((account: any) => ({
          id: account.id,
          coa_account_code: account.account_code,
          coa_account_name: account.account_name,
          coa_account_type: account.account_type,
          coa_is_active: account.is_active,
          ...account,
        }));
      } else {
        // Fallback: platform_integration_chart_of_accounts (legacy)
        let query = (supabase as any)
          .from('platform_integration_chart_of_accounts')
          .select('*')
          .eq('organization_id', organizationId)
          .eq('coa_is_active', true)
          .order('coa_account_type', { ascending: true })
          .order('coa_account_code', { ascending: true });

        // If location is mapped, filter by platform organization
        if (locationMapping?.platformOrgId) {
          query = query.eq('platform_integration_organization_id', locationMapping.platformOrgId);
        }

        const { data, error } = await query;

        if (error) {
          console.error('Error fetching chart of accounts:', error);
          return [];
        }
        coaData = data || [];
      }

      // Keep only EXPENSE accounts valid on a PURCHASE BILL line.
      // For accounts payable, we only want expense-type accounts:
      // Xero: EXPENSE, DIRECTCOSTS, OVERHEADS
      // QuickBooks: Expense, Cost of Goods Sold
      // Iplicit/Sage: expense types
      const expenseAccountTypes = [
        'expense', 'expenses', 'directcosts', 'direct costs', 'overheads',
        'overhead', 'cost of goods sold', 'cogs', 'costofgoodssold',
        'other expense', 'otherexpense', 'operating expenses'
      ];

      const filteredAccounts = coaData.filter((account: any) => {
        // Xero stores the SystemAccount (A/R "DEBTORS", A/P "CREDITORS", payroll
        // & currency control accounts) in account_sub_type; legacy data uses
        // coa_system_account. None of these are valid on a purchase bill.
        const sys = account.account_sub_type || account.coa_account_sub_type || account.coa_system_account;
        if (sys && excludedSystemAccounts.includes(sys)) return false;

        const type = `${account.coa_account_type || account.account_type || ''}`.toLowerCase();
        const name = `${account.coa_account_name || ''}`.toLowerCase();

        // Exclude bank and receivable/payable accounts
        if (/bank/.test(type)) return false;
        if (/(receivable|payable)/.test(type)) return false;
        if (/accounts?\s+(receivable|payable)/.test(name)) return false;

        // Only include expense-type accounts
        const isExpenseAccount = expenseAccountTypes.some(expType => type.includes(expType));
        return isExpenseAccount;
      });

      const uniqueAccounts = filteredAccounts.filter(
        (account: any, index: number, self: any[]) =>
          index === self.findIndex(
            (a) => a.coa_account_code === account.coa_account_code && a.coa_account_name === account.coa_account_name
          )
      );

      return uniqueAccounts;
    },
    enabled: !!organizationId && (!effectiveLocationId || !isLoadingMapping),
  });

  // Labels for line-item accounts saved OUTSIDE the scoped options above
  // (another entity, or a pre-resync COA). Looked up by id so the saved value
  // renders instead of "Select".
  const savedLineItemAccountIds = (invoice?.line_items || [])
    .map((li: any) => li.platform_account_id)
    .filter(Boolean) as string[];

  const { data: outOfScopeCoaLabels } = useQuery({
    queryKey: ['coa-fallback-labels-detail', savedLineItemAccountIds.sort().join(',')],
    queryFn: () => fetchCoaLabelsByIds(undefined, savedLineItemAccountIds),
    enabled: open && savedLineItemAccountIds.length > 0,
  });

  // Determine if location mapping is required but missing
  const isLocationNotMapped = effectiveLocationId && !isLoadingMapping && !locationMapping;
  const isCoaDisabled = isLocationNotMapped;

  // Initialize form data when invoice changes
  useEffect(() => {
    if (invoice) {
      setFormData({
        customer_name: invoice.customer_name || '',
        vendor_name: invoice.vendor_name || '',
        invoice_date: invoice.invoice_date || '',
        due_date: invoice.due_date || '',
      });
      setNeedsApproverApproval(invoice.is_approved_by_approver === 1);
      setSelectedFolderId(invoice.folder_id || null);
      setSelectedLocationIdLocal(invoice.location_id || null);

      // Pre-populate line item approvers, percentages, and COA from existing data
      if (invoice.line_items && invoice.line_items.length > 0) {
        const existingPercentages: Record<string, string> = {};
        const existingApprovers: Record<string, string> = {};
        const existingCoas: Record<string, string> = {};

        invoice.line_items.forEach((item: any) => {
          if (item.id) {
            if (item.approver_percentage) {
              existingPercentages[item.id] = item.approver_percentage.toString();
            }
            if (item.approver_id) {
              existingApprovers[item.id] = item.approver_id;
            }
            if (item.platform_account_id) {
              existingCoas[item.id] = item.platform_account_id;
            }
          }
        });

        setLinePercentages(existingPercentages);
        setLineApprovers(existingApprovers);
        setLineCoaIds(existingCoas);
      }
    }
  }, [invoice]);

  // Reset approver states only when location CHANGES to a different value (not on initial load)
  useEffect(() => {
    // If no location is selected, disable the approver toggle
    if (!effectiveLocationId) {
      setNeedsApproverApproval(false);
      setApproveAll(false);
      setPreviousLocationId(null);
      return;
    }

    // Only reset approvers if location actually changed (not initial load)
    if (previousLocationId !== null && previousLocationId !== effectiveLocationId) {
      // Location changed to a different value - reset approver selections
      setSingleApprover('');
      setSinglePercentage('');
      setLineApprovers({});
      setApproveAll(false);
    }

    // Update previous location
    setPreviousLocationId(effectiveLocationId);
  }, [effectiveLocationId, previousLocationId]);

  if (!invoice) return null;

  // Get line items
  const lineItems = invoice.line_items || [];

  // Check if any line item has an approver assigned (for showing "Is Approved" column)
  const hasAnyApproverAssigned = lineItems.some((item: any) => item.approver_id);

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleUpdate = async () => {
    if (!onUpdate) return;

    console.log('=== Starting handleUpdate (InvoiceDetailModal) ===');
    console.log('needsApproverApproval:', needsApproverApproval);
    console.log('lineItems:', lineItems);
    console.log('lineItems count:', lineItems.length);
    console.log('approveAll:', approveAll);
    console.log('singleApprover:', singleApprover);
    console.log('singlePercentage:', singlePercentage);
    console.log('lineApprovers:', lineApprovers);
    console.log('linePercentages:', linePercentages);

    // Validate single approver settings if "All Items Approve by single approver" is checked
    if (needsApproverApproval && approveAll && lineItems.length > 0) {
      if (!singleApprover) {
        toast.error('Please select an approver for all items');
        return;
      }
      const percentage = parseFloat(singlePercentage);
      if (!percentage || percentage <= 0) {
        toast.error('Please enter a valid percentage for the approver');
        return;
      }
    }

    setIsUpdating(true);

    try {
      // Update the main invoice
      await onUpdate(invoice.id, {
        customer_name: formData.customer_name || null,
        vendor_name: formData.vendor_name || null,
        invoice_date: formData.invoice_date || null,
        due_date: formData.due_date || null,
        is_approved_by_approver: needsApproverApproval ? 1 : 0,
        folder_id: selectedFolderId,
      });

      // Save COA (Chart of Account) selections for all line items
      for (let i = 0; i < lineItems.length; i++) {
        const item = lineItems[i] as any;
        const itemKey = item.id || i;
        const newCoaId = lineCoaIds[itemKey];

        console.log(`Line item ${i + 1}: id=${item.id}, newCoaId=${newCoaId}, existing=${item.platform_account_id}`);

        // Update if COA is selected
        if (item.id && newCoaId) {
          const { error: coaError } = await (supabase as any)
            .from('accounts_payable_invoice_line_item')
            .update({ platform_account_id: newCoaId })
            .eq('id', item.id);

          if (coaError) {
            console.error('Error updating line item COA:', coaError);
          } else {
            console.log(`Updated line item ${item.id} with COA ${newCoaId}`);
          }
        }
      }

      // If approval is needed, save line item approver assignments
      if (needsApproverApproval && lineItems.length > 0) {
        console.log('Processing line item approver assignments...');
        console.log('approveAll mode:', approveAll, 'singleApprover:', singleApprover, 'singlePercentage:', singlePercentage);

        // Track items that have NEW or CHANGED assignments (for email notification)
        const newlyAssignedItems: Array<{
          lineItemId: string;
          approverId: string;
          percentage: number;
          amount: number;
          description: string;
          itemNumber: number;
        }> = [];

        // Collect all line items with assigned approvers
        for (let i = 0; i < lineItems.length; i++) {
          const item = lineItems[i] as any; // Cast to access approval fields
          const itemKey = item.id || i;

          console.log(`Processing line item ${i + 1}:`, {
            itemId: item.id,
            itemKey,
            description: item.description,
            line_total: item.line_total,
            existing_approver_id: item.approver_id,
            existing_percentage: item.approver_percentage
          });

          // Get approver and percentage (either from single approver or individual)
          const newApproverId = approveAll ? singleApprover : lineApprovers[itemKey];
          const percentageStr = approveAll ? singlePercentage : linePercentages[itemKey];
          const newPercentage = parseFloat(percentageStr) || 0;

          console.log(`  -> newApproverId: ${newApproverId}, newPercentage: ${newPercentage}`);

          // Skip approved items - they should not be modified
          if (item.approval_status === 'approved') {
            console.log(`  -> Skipping: item is already approved`);
            continue;
          }

          if (newApproverId && newPercentage > 0) {
            const approverAmount = ((item.line_total || 0) * newPercentage) / 100;

            // Check if this is a NEW assignment, CHANGED assignment, or RE-ASSIGNMENT of rejected item
            const isNewAssignment = !item.approver_id;
            const isChangedApprover = item.approver_id && item.approver_id !== newApproverId;
            const isChangedPercentage = item.approver_percentage && item.approver_percentage !== newPercentage;
            const isRejectedReassignment = item.approval_status === 'rejected';

            const shouldSendEmail = isNewAssignment || isChangedApprover || isChangedPercentage || isRejectedReassignment;

            console.log(`  -> isNewAssignment: ${isNewAssignment}, isChangedApprover: ${isChangedApprover}, isChangedPercentage: ${isChangedPercentage}, isRejectedReassignment: ${isRejectedReassignment}`);
            console.log(`  -> shouldSendEmail: ${shouldSendEmail}`);

            // Only add to email list if it's a new or changed assignment
            if (shouldSendEmail) {
              newlyAssignedItems.push({
                lineItemId: item.id,
                approverId: newApproverId,
                percentage: newPercentage,
                amount: approverAmount,
                description: item.description || '',
                itemNumber: i + 1,
              });
            }

            // Update the line item in the database
            console.log(`  -> Updating line item in DB with id: ${item.id}`);
            const { error: updateError, data: updateData } = await (supabase as any)
              .from('accounts_payable_invoice_line_item')
              .update({
                approval_status: 'pending',
                approver_id: newApproverId,
                assigned_at: new Date().toISOString(),
                approver_amount: approverAmount,
                approver_percentage: newPercentage,
              })
              .eq('id', item.id)
              .select();

            if (updateError) {
              console.error('Error updating line item:', updateError);
            } else {
              console.log('  -> Line item updated successfully:', updateData);
            }
          } else {
            console.log(`  -> Skipping: no approverId or percentage <= 0`);
          }
        }

        console.log('Total newly assigned items (for email):', newlyAssignedItems.length);
        console.log('Newly assigned items:', newlyAssignedItems);

        // Show info about assigned items
        if (newlyAssignedItems.length > 0) {
          toast.info(`Assigning ${newlyAssignedItems.length} item(s) to approver...`);
        }

        // Send email notification ONLY for newly assigned or changed items
        if (newlyAssignedItems.length > 0) {
          // Group items by approver
          const itemsByApprover = newlyAssignedItems.reduce((acc, item) => {
            if (!acc[item.approverId]) {
              acc[item.approverId] = [];
            }
            acc[item.approverId].push(item);
            return acc;
          }, {} as Record<string, typeof newlyAssignedItems>);

          // Get session for Authorization header
          const { data: { session } } = await supabase.auth.getSession();

          // Send email for each approver
          for (const [approverId, items] of Object.entries(itemsByApprover)) {
            const approver = activeProviders.find(p => p.id === approverId);
            if (!approver) continue;

            const totalApproverAmount = items.reduce((sum, item) => sum + item.amount, 0);

            try {
              console.log('Sending email notification to approver:', approver.name);
              const { error: emailError, data: emailData } = await supabase.functions.invoke('send-approver-notification', {
                body: {
                  approver_name: approver.name,
                  // approver_email: 'hitesh.parekh985@gmail.com', // Static email for now
                  approver_email: [
                    "hitesh.parekh985@gmail.com",
                    "yash.vithalani@dentpulse.com"
                  ].join(","),
                  invoice_number: invoice.invoice_number || invoice.id.slice(0, 8),
                  invoice_date: formatDate(invoice.invoice_date),
                  vendor_name: invoice.vendor_name || 'Unknown Vendor',
                  line_items: items.map(item => ({
                    item_number: item.itemNumber,
                    description: item.description,
                    status: 'Pending',
                    approver_amount: item.amount,
                  })),
                  total_approver_amount: totalApproverAmount,
                  currency: invoice.currency || '£',
                  approval_link: `${window.location.origin}/approve/${invoice.id}/${approverId}`,
                },
                headers: session?.access_token ? {
                  Authorization: `Bearer ${session.access_token}`,
                } : undefined,
              });

              console.log('Email function response:', { emailError, emailData });

              if (emailError) {
                console.error('Error sending email:', emailError);
                toast.error('Failed to send notification email');
              } else {
                toast.success(`Notification sent to ${approver.name}`);
              }
            } catch (emailErr) {
              console.error('Error invoking email function:', emailErr);
            }
          }
        }
      }

      // Invalidate queries to trigger instant background refetch
      queryClient.invalidateQueries({ queryKey: ['accounts-payable-invoices'] });

      toast.success('Invoice updated successfully');
      onOpenChange(false);
    } catch (error) {
      console.error('Failed to update invoice:', error);
      toast.error('Failed to update invoice');
    } finally {
      setIsUpdating(false);
    }
  };

  // Format currency display
  const formatCurrency = (amount: number | null | undefined) => {
    if (amount === null || amount === undefined) return '£0.00';
    return `£${amount.toFixed(2)}`;
  };

  // Format date for display
  const formatDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return '-';
    try {
      return new Date(dateStr).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn(
        "max-h-[95vh] p-0 transition-all duration-200",
        needsApproverApproval ? "max-w-6xl" : "max-w-4xl"
      )}>
        {/* Header with uploaded date */}
        <div className="bg-muted/50 px-6 py-2 text-sm text-muted-foreground border-b">
          Invoice Uploaded Date: {formatDate(invoice.created_at)}
        </div>

        <DialogHeader className="px-6">
          <DialogTitle className="text-xl font-semibold">Invoice Details</DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[calc(90vh-120px)]">
          <div className="px-6 space-y-4">
            {/* Location Selector - always show, required before folder/tag selection */}
            <div>
              <Label className="text-xs text-muted-foreground mb-0.5 block">Select Location</Label>
              <Popover open={locationOpen} onOpenChange={setLocationOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={locationOpen}
                    className="w-full justify-between font-normal"
                  >
                    {isLoadingLocations ? (
                      <span className="flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Loading locations...
                      </span>
                    ) : effectiveLocationId ? (
                      <span className="flex items-center gap-2">
                        <MapPin className="w-4 h-4" />
                        {locations.find((l) => l.id === effectiveLocationId)?.location_name || 'Select Location'}
                      </span>
                    ) : (
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <MapPin className="w-4 h-4" />
                        Select Location
                      </span>
                    )}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[500px] p-0 z-[100]" align="start">
                  <div className="max-h-[300px] overflow-auto" onWheel={(e) => e.stopPropagation()}>
                    {isLoadingLocations ? (
                      <div className="flex items-center justify-center py-6">
                        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                      </div>
                    ) : (
                      <div className="py-1">
                        {/* Locations list */}
                        {locations.map((location) => (
                          <div
                            key={location.id}
                            className={cn(
                              "px-3 py-2 cursor-pointer hover:bg-gray-100 text-sm",
                              effectiveLocationId === location.id && "bg-indigo-50 text-indigo-700"
                            )}
                            onClick={async () => {
                              setSelectedLocationIdLocal(location.id);
                              setLocationOpen(false);
                              // Auto-save to database
                              if (onUpdate && invoice) {
                                try {
                                  await onUpdate(invoice.id, { location_id: location.id });
                                  toast.success('Location updated');
                                } catch (error) {
                                  toast.error('Failed to update location');
                                }
                              }
                            }}
                          >
                            {location.location_name}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            </div>

            {/* Folder Selector - disabled when no location selected */}
            <div>
              <Label className="text-xs text-muted-foreground mb-0.5 block">Assign Folder</Label>
              <Popover open={folderOpen} onOpenChange={(open) => effectiveLocationId && setFolderOpen(open)}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={folderOpen}
                    disabled={!effectiveLocationId}
                    className="w-full justify-between font-normal"
                  >
                    {!effectiveLocationId ? (
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <Folder className="w-4 h-4" />
                        Select location first
                      </span>
                    ) : isLoadingFolders ? (
                      <span className="flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Loading folders...
                      </span>
                    ) : selectedFolderId ? (
                      <span className="flex items-center gap-2">
                        <Folder className="w-4 h-4" />
                        {getFolderName(selectedFolderId) || 'Select folder'}
                      </span>
                    ) : (
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <Folder className="w-4 h-4" />
                        Select folder
                      </span>
                    )}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[500px] p-0 z-[100]" align="start">
                  <div className="max-h-[300px] overflow-auto" onWheel={(e) => e.stopPropagation()}>
                    {isLoadingFolders ? (
                      <div className="flex items-center justify-center py-6">
                        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                      </div>
                    ) : (
                      <div className="py-1">
                        {/* Option to remove from folder */}
                        <div
                          className={cn(
                            "px-3 py-2 cursor-pointer hover:bg-gray-100 flex items-center",
                            selectedFolderId === null && "bg-indigo-50"
                          )}
                          onClick={async () => {
                            setSelectedFolderId(null);
                            setFolderOpen(false);
                            // Auto-save to database
                            if (onUpdate && invoice) {
                              try {
                                await onUpdate(invoice.id, { folder_id: null });
                                toast.success('Folder updated');
                              } catch (error) {
                                toast.error('Failed to update folder');
                              }
                            }
                          }}
                        >
                          <span className="text-muted-foreground text-sm">No folder (Unassigned)</span>
                        </div>

                        {/* Parent folders and their children */}
                        {folders
                          .filter((f) => !f.parent_id)
                          .map((parentFolder) => {
                            const children = folders.filter((f) => f.parent_id === parentFolder.id);
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
                                    !hasChildren && selectedFolderId === parentFolder.id && "bg-indigo-50 text-indigo-700"
                                  )}
                                  onClick={async () => {
                                    if (hasChildren) return; // Don't allow selection if has children
                                    setSelectedFolderId(parentFolder.id);
                                    setFolderOpen(false);
                                    // Auto-save to database
                                    if (onUpdate && invoice) {
                                      try {
                                        await onUpdate(invoice.id, { folder_id: parentFolder.id });
                                        toast.success('Folder updated');
                                      } catch (error) {
                                        toast.error('Failed to update folder');
                                      }
                                    }
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
                                      selectedFolderId === child.id && "bg-indigo-50 text-indigo-700"
                                    )}
                                    onClick={async () => {
                                      setSelectedFolderId(child.id);
                                      setFolderOpen(false);
                                      // Auto-save to database
                                      if (onUpdate && invoice) {
                                        try {
                                          await onUpdate(invoice.id, { folder_id: child.id });
                                          toast.success('Folder updated');
                                        } catch (error) {
                                          toast.error('Failed to update folder');
                                        }
                                      }
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

            {/* Tags Selector - disabled when no location selected */}
            <div>
              <Label className="text-xs text-muted-foreground mb-0.5 block">Assign Tag</Label>
              <Popover open={tagsOpen} onOpenChange={(open) => {
                // Don't open if we're removing a tag
                if (open && isRemovingTagRef.current) {
                  isRemovingTagRef.current = false;
                  return;
                }
                if (effectiveLocationId) {
                  setTagsOpen(open);
                }
              }}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={tagsOpen}
                    disabled={!effectiveLocationId}
                    className="w-full justify-between font-normal min-h-[40px] h-auto"
                  >
                    {!effectiveLocationId ? (
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <Tag className="w-4 h-4" />
                        Select location first
                      </span>
                    ) : isLoadingTags ? (
                      <span className="flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Loading tags...
                      </span>
                    ) : assignedTagIds.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {assignedTagIds.map((tagId) => {
                          const tag = tags.find((t) => t.id === tagId);
                          if (!tag) return null;
                          return (
                            <span
                              key={tag.id}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200"
                            >
                              {tag.name}
                              <span
                                className="inline-flex"
                                onPointerDown={async (e) => {
                                  e.stopPropagation();
                                  isRemovingTagRef.current = true;
                                  if (invoice) {
                                    const newTagIds = assignedTagIds.filter((id) => id !== tagId);
                                    await assignTagsToInvoice(invoice.id, newTagIds);
                                    refetchInvoiceTags();
                                    onTagsUpdate?.();
                                  }
                                }}
                              >
                                <X className="w-3 h-3 cursor-pointer hover:text-indigo-900" />
                              </span>
                            </span>
                          );
                        })}
                      </div>
                    ) : (
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <Tag className="w-4 h-4" />
                        Select tags
                      </span>
                    )}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[500px] p-0 z-[100]" align="start">
                  <div className="p-2 border-b">
                    <div className="flex gap-2">
                      <Input
                        placeholder="Create new tag..."
                        value={newTagName}
                        onChange={(e) => setNewTagName(e.target.value)}
                        onKeyDown={async (e) => {
                          if (e.key === 'Enter' && newTagName.trim()) {
                            e.preventDefault();
                            createTag({ name: newTagName.trim(), location_id: effectiveLocationId });
                            setNewTagName('');
                          }
                        }}
                        className="h-8"
                      />
                      <Button
                        size="sm"
                        className="h-8"
                        disabled={!newTagName.trim()}
                        onClick={() => {
                          if (newTagName.trim()) {
                            createTag({ name: newTagName.trim(), location_id: effectiveLocationId });
                            setNewTagName('');
                          }
                        }}
                      >
                        <Plus className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="max-h-[250px] overflow-auto" onWheel={(e) => e.stopPropagation()}>
                    {isLoadingTags ? (
                      <div className="flex items-center justify-center py-6">
                        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                      </div>
                    ) : tags.length === 0 ? (
                      <div className="py-6 text-center text-sm text-muted-foreground">
                        No tags yet. Create one above.
                      </div>
                    ) : (
                      <div className="py-1">
                        {tags.map((tag) => {
                          const isSelected = assignedTagIds.includes(tag.id);
                          return (
                            <div
                              key={tag.id}
                              className="px-3 py-2.5 cursor-pointer flex items-center justify-between transition-all duration-150 mx-1 my-0.5 rounded-md hover:bg-indigo-50"
                              onClick={async () => {
                                if (invoice) {
                                  const newTagIds = isSelected
                                    ? assignedTagIds.filter((id) => id !== tag.id)
                                    : [...assignedTagIds, tag.id];
                                  await assignTagsToInvoice(invoice.id, newTagIds);
                                  refetchInvoiceTags();
                                  onTagsUpdate?.();
                                }
                              }}
                            >
                              <div className="flex items-center gap-3">
                                <span
                                  className="w-4 h-4 rounded-full shadow-sm"
                                  style={{ backgroundColor: tag.color }}
                                />
                                <span className="text-sm font-medium">{tag.name}</span>
                              </div>
                              {isSelected && (
                                <Check className="w-4 h-4 text-indigo-600" />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            </div>

            {/* Additional Details - Accordion (collapsed by default) */}
            <Accordion type="single" collapsible>
              <AccordionItem value="additional-details" className="border rounded-lg">
                <AccordionTrigger className="px-4 py-3 hover:no-underline">
                  <span className="text-base font-semibold">Additional Details</span>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4">
                  <div className="grid grid-cols-2 gap-x-8 gap-y-4">
                {/* Left Column */}
                <div className="space-y-4">
                  {/* Invoice Number - Read only */}
                  <div className="flex items-center gap-4">
                    <Label className="w-32 text-muted-foreground">Invoice Number</Label>
                    <span className="text-foreground">{invoice.invoice_number || '-'}</span>
                  </div>

                  {/* Customer Name - Editable */}
                  <div className="flex items-center gap-4">
                    <Label className="w-32 text-muted-foreground">Customer Name</Label>
                    <Input
                      value={formData.customer_name}
                      onChange={(e) => handleInputChange('customer_name', e.target.value)}
                      placeholder="Enter customer name"
                      className="flex-1"
                    />
                  </div>

                  {/* Vendor Name - Editable */}
                  <div className="flex items-center gap-4">
                    <Label className="w-32 text-muted-foreground">Vendor Name</Label>
                    <Input
                      value={formData.vendor_name}
                      onChange={(e) => handleInputChange('vendor_name', e.target.value)}
                      placeholder="Enter vendor name"
                      className="flex-1"
                    />
                  </div>

                  {/* Currency - Read only */}
                  <div className="flex items-center gap-4">
                    <Label className="w-32 text-muted-foreground">Currency</Label>
                    <span className="text-foreground">{invoice.currency || 'GBP'}</span>
                  </div>

                  {/* Invoice Date - Editable */}
                  <div className="flex items-center gap-4">
                    <Label className="w-32 text-muted-foreground">Invoice Date</Label>
                    <Input
                      type="date"
                      value={formData.invoice_date}
                      onChange={(e) => handleInputChange('invoice_date', e.target.value)}
                      className="flex-1 [&::-webkit-calendar-picker-indicator]:order-1"
                    />
                  </div>

                  {/* Due Date - Editable */}
                  <div className="flex items-center gap-4">
                    <Label className="w-32 text-muted-foreground">Due Date</Label>
                    <Input
                      type="date"
                      value={formData.due_date}
                      onChange={(e) => handleInputChange('due_date', e.target.value)}
                      className="flex-1 [&::-webkit-calendar-picker-indicator]:order-1"
                    />
                  </div>
                </div>

                {/* Right Column */}
                <div className="space-y-4">
                  {/* Status - Read only */}
                  <div className="flex items-center gap-4">
                    <Label className="w-36 text-muted-foreground">Status</Label>
                    <span className="text-foreground capitalize">
                      {invoice.status === 'pending_review' ? 'Unpaid' :
                       invoice.status === 'paid' ? 'Paid' :
                       invoice.status?.replace('_', ' ') || 'Unpaid'}
                    </span>
                  </div>

                  {/* Invoice Uploaded Date - Read only */}
                  <div className="flex items-center gap-4">
                    <Label className="w-36 text-muted-foreground">Invoice Uploaded Date</Label>
                    <span className="text-foreground">{formatDate(invoice.created_at)}</span>
                  </div>

                  {/* Subtotal - Read only */}
                  <div className="flex items-center gap-4">
                    <Label className="w-36 text-muted-foreground">Subtotal</Label>
                    <span className="text-foreground">{formatCurrency(invoice.subtotal)}</span>
                  </div>

                  {/* Tax - Read only */}
                  <div className="flex items-center gap-4">
                    <Label className="w-36 text-muted-foreground">Tax</Label>
                    <span className="text-foreground">{formatCurrency(invoice.tax)}</span>
                  </div>

                  {/* Total Amount - Read only */}
                  <div className="flex items-center gap-4">
                    <Label className="w-36 text-muted-foreground">Total Amount</Label>
                    <span className="text-foreground font-semibold">{formatCurrency(invoice.total_amount)}</span>
                  </div>

                  {/* Amount Due - Read only */}
                  <div className="flex items-center gap-4">
                    <Label className="w-36 text-muted-foreground">Amount Due</Label>
                    <span className="text-foreground font-semibold">{formatCurrency(invoice.amount_due || invoice.total_amount)}</span>
                  </div>
                </div>
              </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>

            {/* Invoice Items Section */}
            <div className="space-y-3">
              {/* Header Row 1: Title, Toggle, and Update Button */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <Label className="text-base font-semibold">Invoice Items</Label>
                  <div className="flex items-center gap-2">
                    <Switch
                      id="needs-approver-detail"
                      checked={needsApproverApproval}
                      onCheckedChange={setNeedsApproverApproval}
                      disabled={!effectiveLocationId}
                    />
                    <Label
                      htmlFor="needs-approver-detail"
                      className={cn(
                        "text-sm cursor-pointer",
                        !effectiveLocationId ? "text-muted-foreground/50" : "text-muted-foreground"
                      )}
                    >
                      The invoice need to approve from approver?
                      {!effectiveLocationId && (
                        <span className="ml-2 text-xs text-orange-500">(Select location first)</span>
                      )}
                    </Label>
                  </div>
                </div>
                <Button
                  onClick={handleUpdate}
                  disabled={isUpdating}
                  className="bg-indigo-600 hover:bg-indigo-700"
                >
                  {isUpdating ? 'Updating...' : 'Update'}
                </Button>
              </div>

              {/* Header Row 2: Approver Options (only when toggle is ON) */}
              {needsApproverApproval && (
                <div className="flex items-center gap-4 p-3 bg-indigo-50 rounded-lg border border-indigo-100">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="approve-all-detail"
                      checked={approveAll}
                      onCheckedChange={(checked) => setApproveAll(checked as boolean)}
                    />
                    <label htmlFor="approve-all-detail" className="text-sm font-medium text-indigo-700">
                      All Items Approve by single approver
                    </label>
                  </div>

                  {/* Single approver percentage and dropdown - shown when approveAll is checked */}
                  {approveAll && (
                    <div className="flex items-center gap-3 ml-4 pl-4 border-l border-indigo-200">
                      <div className="flex items-center gap-2">
                        <Label className="text-sm text-muted-foreground whitespace-nowrap">Percentage:</Label>
                        <Input
                          type="number"
                          placeholder="%"
                          value={singlePercentage}
                          onChange={(e) => setSinglePercentage(e.target.value)}
                          className="w-20 h-8 text-sm text-center"
                          min="0"
                          max="100"
                          step="0.01"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <Label className="text-sm text-muted-foreground whitespace-nowrap">Approver:</Label>
                        <Popover open={singleApproverOpen} onOpenChange={setSingleApproverOpen}>
                          <PopoverTrigger asChild>
                            <Button
                              variant="outline"
                              role="combobox"
                              className="w-52 h-8 justify-between text-sm font-normal bg-white"
                            >
                              {singleApprover
                                ? activeProviders.find((p) => p.id === singleApprover)?.name
                                : "-- Select Approver --"}
                              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-56 p-0 z-[100]" align="start">
                            <Command>
                              <CommandInput placeholder="Search approver..." />
                              <CommandList className="max-h-[200px] overflow-auto" onWheel={(e) => e.stopPropagation()}>
                                <CommandEmpty>
                                  {isLoadingProviders ? "Loading..." : "No approver found."}
                                </CommandEmpty>
                                <CommandGroup>
                                  {activeProviders.map((provider) => (
                                    <CommandItem
                                      key={provider.id}
                                      value={provider.name}
                                      onSelect={() => {
                                        setSingleApprover(provider.id);
                                        setSingleApproverOpen(false);
                                      }}
                                    >
                                      <Check
                                        className={cn(
                                          "mr-2 h-4 w-4",
                                          singleApprover === provider.id ? "opacity-100" : "opacity-0"
                                        )}
                                      />
                                      {provider.name}
                                    </CommandItem>
                                  ))}
                                </CommandGroup>
                              </CommandList>
                            </Command>
                          </PopoverContent>
                        </Popover>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="border rounded-lg overflow-x-auto">
                <Table className="min-w-full">
                  <TableHeader>
                    <TableRow className="bg-indigo-600 hover:bg-indigo-600">
                      <TableHead className="text-white font-medium w-12 min-w-[48px]">#</TableHead>
                      <TableHead className="text-white font-medium min-w-[180px]">Description</TableHead>
                      <TableHead className="text-white font-medium min-w-[150px]">Expense Account</TableHead>
                      <TableHead className="text-white font-medium text-right min-w-[80px]">Quantity</TableHead>
                      <TableHead className="text-white font-medium text-right min-w-[90px]">Unit Price</TableHead>
                      <TableHead className="text-white font-medium text-right min-w-[80px]">Total</TableHead>
                      {needsApproverApproval && (
                        <>
                          <TableHead className="text-white font-medium text-center min-w-[100px]">% For Approver</TableHead>
                          <TableHead className="text-white font-medium min-w-[180px]">Approver</TableHead>
                          {hasAnyApproverAssigned && (
                            <TableHead className="text-white font-medium text-center min-w-[100px]">Is Approved</TableHead>
                          )}
                        </>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lineItems.length > 0 ? (
                      lineItems.map((item, index) => (
                        <TableRow key={item.id || index} className={index % 2 === 0 ? 'bg-blue-50/50 dark:bg-blue-950/10' : ''}>
                          <TableCell className="text-sm">{index + 1}</TableCell>
                          <TableCell className="text-sm max-w-xs">
                            <div className="line-clamp-2">{item.description || '-'}</div>
                          </TableCell>
                          <TableCell>
                            <Popover
                              open={lineCoaOpen[item.id || index] || false}
                              onOpenChange={(open) => {
                                setLineCoaOpen(prev => ({ ...prev, [item.id || index]: open }));
                                if (!open) setCoaSearchTerm('');
                              }}
                            >
                              <PopoverTrigger asChild>
                                <Button
                                  variant="outline"
                                  role="combobox"
                                  className="w-40 h-8 justify-between text-xs font-normal"
                                >
                                  <span className="truncate">
                                    {lineCoaIds[item.id || index]
                                      ? (() => {
                                          const selectedId = lineCoaIds[item.id || index];
                                          const coa = chartOfAccounts.find((a: any) => a.id === selectedId);
                                          if (coa) return `${coa.coa_account_code} - ${coa.coa_account_name}`;
                                          const fb = outOfScopeCoaLabels?.get(selectedId);
                                          if (fb) {
                                            const label = fb.code ? `${fb.code} - ${fb.name}` : fb.name;
                                            return `${label} (other entity)`;
                                          }
                                          return 'Select';
                                        })()
                                      : 'Select'}
                                  </span>
                                  <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent
                                className="w-[280px] p-0"
                                align="start"
                                onWheel={(e) => e.stopPropagation()}
                              >
                                <div className="p-2 border-b">
                                  <Input
                                    placeholder="Search accounts..."
                                    value={coaSearchTerm}
                                    onChange={(e) => setCoaSearchTerm(e.target.value)}
                                    className="h-8 text-xs"
                                  />
                                </div>
                                <ScrollArea className="h-[200px]" onWheel={(e) => e.stopPropagation()}>
                                  <div className="p-1">
                                    {isLoadingCOA ? (
                                      <div className="p-3 text-xs text-muted-foreground text-center">Loading...</div>
                                    ) : (
                                      (() => {
                                        const filteredAccounts = chartOfAccounts.filter((account: any) => {
                                          const searchLower = coaSearchTerm.toLowerCase();
                                          return (
                                            account.coa_account_code?.toLowerCase().includes(searchLower) ||
                                            account.coa_account_name?.toLowerCase().includes(searchLower)
                                          );
                                        });

                                        if (filteredAccounts.length === 0) {
                                          return <div className="p-3 text-xs text-muted-foreground text-center">No accounts found.</div>;
                                        }

                                        return filteredAccounts.map((account: any) => (
                                          <div
                                            key={account.id}
                                            onClick={() => {
                                              setLineCoaIds(prev => ({ ...prev, [item.id || index]: account.id }));
                                              setLineCoaOpen(prev => ({ ...prev, [item.id || index]: false }));
                                              setCoaSearchTerm('');
                                            }}
                                            className={cn(
                                              "flex items-center px-2 py-1.5 cursor-pointer rounded-md hover:bg-accent transition-colors text-xs",
                                              lineCoaIds[item.id || index] === account.id && "bg-accent"
                                            )}
                                          >
                                            <span className="font-medium mr-2">{account.coa_account_code}</span>
                                            <span className="text-muted-foreground truncate">{account.coa_account_name}</span>
                                          </div>
                                        ));
                                      })()
                                    )}
                                  </div>
                                </ScrollArea>
                              </PopoverContent>
                            </Popover>
                          </TableCell>
                          <TableCell className="text-sm text-right">{item.quantity?.toFixed(3) || '0.000'}</TableCell>
                          <TableCell className="text-sm text-right">{formatCurrency(item.unit_price)}</TableCell>
                          <TableCell className="text-sm text-right font-medium">{formatCurrency(item.line_total)}</TableCell>
                          {needsApproverApproval && (
                            <>
                              <TableCell className="text-center">
                                <Input
                                  type="number"
                                  placeholder="0.00"
                                  value={linePercentages[item.id || index] || ''}
                                  onChange={(e) => setLinePercentages(prev => ({ ...prev, [item.id || index]: e.target.value }))}
                                  className="w-20 h-8 text-sm text-center mx-auto disabled:opacity-50 disabled:cursor-not-allowed"
                                  min="0"
                                  max="100"
                                  step="0.01"
                                  disabled={approveAll || (item as any).approval_status === 'approved'}
                                />
                              </TableCell>
                              <TableCell>
                                <Popover
                                  open={lineApproverOpen[item.id || index] || false}
                                  onOpenChange={(open) => {
                                    // Don't open if item is approved
                                    if ((item as any).approval_status === 'approved') return;
                                    setLineApproverOpen(prev => ({ ...prev, [item.id || index]: open }));
                                  }}
                                >
                                  <PopoverTrigger asChild>
                                    <Button
                                      variant="outline"
                                      role="combobox"
                                      disabled={approveAll || (item as any).approval_status === 'approved'}
                                      className="w-48 h-8 justify-between text-sm font-normal disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                      {lineApprovers[item.id || index]
                                        ? activeProviders.find((p) => p.id === lineApprovers[item.id || index])?.name
                                        : "-- Select Approver --"}
                                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                    </Button>
                                  </PopoverTrigger>
                                  <PopoverContent className="w-56 p-0 z-[100]" align="start">
                                    <Command>
                                      <CommandInput placeholder="Search approver..." />
                                      <CommandList className="max-h-[200px] overflow-auto" onWheel={(e) => e.stopPropagation()}>
                                        <CommandEmpty>
                                          {isLoadingProviders ? "Loading..." : "No approver found."}
                                        </CommandEmpty>
                                        <CommandGroup>
                                          {activeProviders.map((provider) => (
                                            <CommandItem
                                              key={provider.id}
                                              value={provider.name}
                                              onSelect={() => {
                                                setLineApprovers(prev => ({ ...prev, [item.id || index]: provider.id }));
                                                setLineApproverOpen(prev => ({ ...prev, [item.id || index]: false }));
                                              }}
                                            >
                                          <Check
                                                className={cn(
                                                  "mr-2 h-4 w-4",
                                                  lineApprovers[item.id || index] === provider.id ? "opacity-100" : "opacity-0"
                                                )}
                                              />
                                              {provider.name}
                                            </CommandItem>
                                          ))}
                                        </CommandGroup>
                                      </CommandList>
                                    </Command>
                                  </PopoverContent>
                                </Popover>
                              </TableCell>
                              {hasAnyApproverAssigned && (
                                <TableCell className="text-center">
                                  {/* Show status icon only if approver is assigned */}
                                  {(item as any).approver_id ? (
                                    (item as any).approval_status === 'approved' ? (
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <CheckCircle2 className="w-5 h-5 text-green-500 mx-auto cursor-pointer" />
                                        </TooltipTrigger>
                                        <TooltipContent className="bg-gray-900 text-white px-3 py-2 max-w-xs">
                                          <p className="text-xs font-medium">Approved</p>
                                        </TooltipContent>
                                      </Tooltip>
                                    ) : (item as any).approval_status === 'rejected' ? (
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <XCircle className="w-5 h-5 text-red-500 mx-auto cursor-pointer" />
                                        </TooltipTrigger>
                                        <TooltipContent className="bg-gray-900 text-white px-3 py-2 max-w-xs">
                                          <p className="text-xs font-medium">Rejection Notes: {(item as any).approval_notes || 'No reason provided'}</p>
                                        </TooltipContent>
                                      </Tooltip>
                                    ) : (item as any).approval_status === 'pending' ? (
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <MinusCircle className="w-5 h-5 text-yellow-500 mx-auto cursor-pointer" />
                                        </TooltipTrigger>
                                        <TooltipContent className="bg-gray-900 text-white px-3 py-2 max-w-xs">
                                          <p className="text-xs font-medium">Pending Approval</p>
                                        </TooltipContent>
                                      </Tooltip>
                                    ) : null
                                  ) : null}
                                </TableCell>
                              )}
                            </>
                          )}
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={needsApproverApproval ? (hasAnyApproverAssigned ? 9 : 8) : 6} className="text-center py-8 text-muted-foreground">
                          No line items found
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
