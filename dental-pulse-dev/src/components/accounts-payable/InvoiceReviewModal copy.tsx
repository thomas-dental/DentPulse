import { useState, useEffect } from 'react';
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
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
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
import { Label } from '@/components/ui/label';
import { FileText, ExternalLink, Check, ChevronsUpDown, CheckCircle2, XCircle, MinusCircle, Folder, Loader2, MapPin, Tag } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AccountsPayableInvoice } from '@/hooks/useAccountsPayableInvoices';
import { useProviders } from '@/hooks/useProviders';
import { useInvoiceFolders } from '@/hooks/useInvoiceFolders';
import { useOrganization } from '@/hooks/useOrganization';
import { useLocations } from '@/hooks/useLocations';
import { TagSelector } from './TagSelector';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface InvoiceReviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: AccountsPayableInvoice | null;
  onUpdate?: (invoiceId: string, updates: Partial<AccountsPayableInvoice>) => Promise<void>;
  onApprove?: (invoiceId: string) => Promise<void>;
  onTagsUpdate?: () => void;
}

// Confidence badge component
const ConfidenceBadge = ({ score }: { score: number | null | undefined }) => {
  const value = score ?? 0;

  if (value >= 80) {
    return <Badge className="ml-2 bg-emerald-500/20 text-emerald-700 border-emerald-500/30 text-xs">{value}%</Badge>;
  } else if (value >= 50) {
    return <Badge className="ml-2 bg-amber-500/20 text-amber-700 border-amber-500/30 text-xs">{value}%</Badge>;
  } else {
    return <Badge className="ml-2 bg-red-500/20 text-red-700 border-red-500/30 text-xs">{value}%</Badge>;
  }
};

// Field row component
const FieldRow = ({
  label,
  value,
  confidence,
  isHighlighted = false,
}: {
  label: string;
  value: string | number | null | undefined;
  confidence?: number | null;
  isHighlighted?: boolean;
}) => {
  const displayValue = value !== null && value !== undefined ? String(value) : '';

  return (
    <div className={`flex items-center py-2 px-3 ${isHighlighted ? 'bg-blue-50 dark:bg-blue-950/20' : ''}`}>
      <div className="w-32 flex-shrink-0 text-xs font-medium font-medium mr-2">{label}</div>
      <div className="flex-1 flex items-center min-w-0">
        <span className="text-sm text-foreground truncate">{displayValue || '-'}</span>
        {confidence !== undefined && <ConfidenceBadge score={confidence} />}
      </div>
    </div>
  );
};

export function InvoiceReviewModal({
  open,
  onOpenChange,
  invoice,
  onUpdate,
  onApprove,
  onTagsUpdate,
}: InvoiceReviewModalProps) {
  const queryClient = useQueryClient();
  const [isUpdating, setIsUpdating] = useState(false);
  const [approveAll, setApproveAll] = useState(false);
  const [needsApproverApproval, setNeedsApproverApproval] = useState(invoice?.is_approved_by_approver === 1);
  const [singleApprover, setSingleApprover] = useState('');
  const [singleApproverOpen, setSingleApproverOpen] = useState(false);
  const [singlePercentage, setSinglePercentage] = useState<string>('');
  const [lineApprovers, setLineApprovers] = useState<Record<string, string>>({});
  const [linePercentages, setLinePercentages] = useState<Record<string, string>>({});
  const [lineApproverOpen, setLineApproverOpen] = useState<Record<string, boolean>>({});
  const [lineCoaIds, setLineCoaIds] = useState<Record<string, string>>({});
  const [lineCoaOpen, setLineCoaOpen] = useState<Record<string, boolean>>({});
  const [coaSearchTerm, setCoaSearchTerm] = useState('');

  // Folder selector state
  const [folderOpen, setFolderOpen] = useState(false);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);

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

  const { organizationId } = useOrganization();

  // Determine effective location ID for folder filtering and provider filtering
  const effectiveLocationId = selectedLocationIdLocal || invoice?.location_id || null;

  // Fetch providers/dentists for the approver dropdown - filtered by selected location
  const { providers, isLoading: isLoadingProviders } = useProviders(undefined, effectiveLocationId);

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

  // Fetch Chart of Accounts
  const { data: chartOfAccounts = [], isLoading: isLoadingCOA } = useQuery({
    queryKey: ['chart-of-accounts-review', organizationId],
    queryFn: async () => {
      if (!organizationId) return [];

      const { data, error } = await (supabase as any)
        .from('platform_integration_chart_of_accounts')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('coa_is_active', true)
        .order('coa_account_type', { ascending: true })
        .order('coa_account_code', { ascending: true });

      if (error) {
        console.error('Error fetching chart of accounts:', error);
        return [];
      }

      // Filter out excluded system accounts and remove duplicates
      const filteredAccounts = (data || []).filter(
        (account: any) => !account.coa_system_account || !excludedSystemAccounts.includes(account.coa_system_account)
      );

      const uniqueAccounts = filteredAccounts.filter(
        (account: any, index: number, self: any[]) =>
          index === self.findIndex(
            (a) => a.coa_account_code === account.coa_account_code && a.coa_account_name === account.coa_account_name
          )
      );

      return uniqueAccounts;
    },
    enabled: !!organizationId,
  });

  // Fetch folders for the folder dropdown - filtered by invoice's location
  const { folders, isLoading: isLoadingFolders } = useInvoiceFolders({
    selectedLocationId: effectiveLocationId,
  });

  // Fetch locations for the location dropdown
  const { locations, isLoading: isLoadingLocations } = useLocations();

  // Get active providers for dropdown
  const activeProviders = providers?.filter(p => p.is_active) || [];

  // Pre-populate line item approvers, percentages, and COA from existing data
  useEffect(() => {
    if (invoice && invoice.line_items) {
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
  }, [invoice]);

  // Update needsApproverApproval, selectedFolderId and selectedLocationIdLocal when invoice changes
  useEffect(() => {
    if (invoice) {
      setNeedsApproverApproval(invoice.is_approved_by_approver === 1);
      setSelectedFolderId(invoice.folder_id || null);
      setSelectedLocationIdLocal(invoice.location_id || null);
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

  // Parse confidence scores from raw_json
  const confidenceScores = invoice.raw_json?.confidence_scores || {};

  // Get line items
  const lineItems = invoice.line_items || [];

  // Check if any line item has an approver assigned (for showing "Is Approved" column)
  const hasAnyApproverAssigned = lineItems.some((item: any) => item.approver_id);

  const handleUpdate = async () => {
    if (!onUpdate) return;

    console.log('=== Starting handleUpdate (InvoiceReviewModal) ===');
    console.log('needsApproverApproval:', needsApproverApproval);
    console.log('lineItems count:', lineItems.length);
    console.log('approveAll:', approveAll);
    console.log('singleApprover:', singleApprover);
    console.log('singlePercentage:', singlePercentage);

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
        status: 'pending_approval',
        is_approved_by_approver: needsApproverApproval ? 1 : 0,
      });

      // Save COA (Chart of Account) selections for all line items
      for (let i = 0; i < lineItems.length; i++) {
        const item = lineItems[i] as any;
        const itemKey = item.id || i;
        const newCoaId = lineCoaIds[itemKey];

        console.log(`handleUpdate - Line item ${i + 1}: id=${item.id}, newCoaId=${newCoaId}`);

        // Update if item has an ID and a COA is selected
        if (item.id && newCoaId) {
          const { error: coaError } = await (supabase as any)
            .from('accounts_payable_invoice_line_item')
            .update({ platform_account_id: newCoaId })
            .eq('id', item.id);

          if (coaError) {
            console.error('Error updating line item COA:', coaError);
          } else {
            console.log(`Successfully updated line item ${item.id} with COA ${newCoaId}`);
          }
        }
      }

      // If approval is needed, save line item approver assignments and send emails
      if (needsApproverApproval && lineItems.length > 0) {
        console.log('Processing approver assignments...');

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
          const item = lineItems[i] as any;
          const itemKey = item.id || i;

          // Get approver and percentage (either from single approver or individual)
          const newApproverId = approveAll ? singleApprover : lineApprovers[itemKey];
          const percentageStr = approveAll ? singlePercentage : linePercentages[itemKey];
          const newPercentage = parseFloat(percentageStr) || 0;

          console.log(`Line item ${i + 1}:`, {
            itemKey,
            newApproverId,
            newPercentage,
            lineTotal: item.line_total,
          });

          // Skip approved items
          if (item.approval_status === 'approved') {
            console.log(`  -> Skipping: item is already approved`);
            continue;
          }

          if (newApproverId && newPercentage > 0) {
            const approverAmount = ((item.line_total || 0) * newPercentage) / 100;

            // Check if this is a NEW or CHANGED assignment
            const isNewAssignment = !item.approver_id;
            const isChangedApprover = item.approver_id && item.approver_id !== newApproverId;
            const isChangedPercentage = item.approver_percentage && item.approver_percentage !== newPercentage;
            const isRejectedReassignment = item.approval_status === 'rejected';

            const shouldSendEmail = isNewAssignment || isChangedApprover || isChangedPercentage || isRejectedReassignment;

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
            const { error: updateError } = await (supabase as any)
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
            }
          }
        }

        console.log('Total newly assigned items:', newlyAssignedItems.length);

        // Show info and send emails
        if (newlyAssignedItems.length > 0) {
          toast.info(`Assigning ${newlyAssignedItems.length} item(s) to approver...`);

          // Get session for Authorization header
          const { data: { session } } = await supabase.auth.getSession();

          // Group items by approver
          const itemsByApprover = newlyAssignedItems.reduce((acc, item) => {
            if (!acc[item.approverId]) {
              acc[item.approverId] = [];
            }
            acc[item.approverId].push(item);
            return acc;
          }, {} as Record<string, typeof newlyAssignedItems>);

          // Send email for each approver
          for (const [approverId, items] of Object.entries(itemsByApprover)) {
            const approver = activeProviders.find(p => p.id === approverId);
            if (!approver) continue;

            const totalApproverAmount = items.reduce((sum, item) => sum + item.amount, 0);

            try {
              const { error: emailError } = await supabase.functions.invoke('send-approver-notification', {
                body: {
                  approver_name: approver.name,
                  // approver_email: 'hitesh.parekh985@gmail.com',
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

  const handleApprove = async () => {
    if (!onApprove) return;

    console.log('=== Starting handleApprove ===');
    console.log('needsApproverApproval:', needsApproverApproval);
    console.log('lineItems count:', lineItems.length);
    console.log('approveAll:', approveAll);

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
    console.log('singleApprover:', singleApprover);
    console.log('singlePercentage:', singlePercentage);
    console.log('lineApprovers:', lineApprovers);
    console.log('linePercentages:', linePercentages);

    try {
      // Save COA selections for all line items
      for (let i = 0; i < lineItems.length; i++) {
        const item = lineItems[i] as any;
        const itemKey = item.id || i;
        const newCoaId = lineCoaIds[itemKey];

        console.log(`Line item ${i + 1}: id=${item.id}, newCoaId=${newCoaId}`);

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
        console.log('Processing approver assignments...');

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

          // Get approver and percentage (either from single approver or individual)
          const newApproverId = approveAll ? singleApprover : lineApprovers[itemKey];
          const percentageStr = approveAll ? singlePercentage : linePercentages[itemKey];
          const newPercentage = parseFloat(percentageStr) || 0;

          console.log(`Line item ${i + 1}:`, {
            itemKey,
            newApproverId,
            newPercentage,
            lineTotal: item.line_total,
            existing_approver_id: item.approver_id,
            existing_percentage: item.approver_percentage
          });

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
            console.log(`  -> Updating line item in DB: ${item.id}`);
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
          console.log('=== Sending email notifications ===');

          // Get session for Authorization header
          const { data: { session } } = await supabase.auth.getSession();

          // Group items by approver
          const itemsByApprover = newlyAssignedItems.reduce((acc, item) => {
            if (!acc[item.approverId]) {
              acc[item.approverId] = [];
            }
            acc[item.approverId].push(item);
            return acc;
          }, {} as Record<string, typeof newlyAssignedItems>);

          console.log('Items grouped by approver:', itemsByApprover);

          // Send email for each approver
          for (const [approverId, items] of Object.entries(itemsByApprover)) {
            const approver = activeProviders.find(p => p.id === approverId);
            console.log(`Processing approver: ${approverId}`, approver);

            if (!approver) {
              console.log('  -> Approver not found, skipping');
              continue;
            }

            const totalApproverAmount = items.reduce((sum, item) => sum + item.amount, 0);

            const emailPayload = {
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
            };

            console.log('=== EMAIL PAYLOAD ===');
            console.log(JSON.stringify(emailPayload, null, 2));

            try {
              console.log('Invoking send-approver-notification function...');
              const { error: emailError, data: emailData } = await supabase.functions.invoke('send-approver-notification', {
                body: emailPayload,
                headers: session?.access_token ? {
                  Authorization: `Bearer ${session.access_token}`,
                } : undefined,
              });

              console.log('Email function response:', { emailError, emailData });

              if (emailError) {
                console.error('Error sending email:', emailError);
                toast.error('Failed to send notification email');
              } else {
                console.log('Email sent successfully!');
                toast.success(`Notification sent to ${approver.name}`);
              }
            } catch (emailErr) {
              console.error('Error invoking email function:', emailErr);
            }
          }
        } else {
          console.log('No items assigned, skipping email');
        }
      } else {
        console.log('Skipping approver processing - needsApproverApproval:', needsApproverApproval, 'lineItems:', lineItems.length);
      }

      await onApprove(invoice.id);

      // Invalidate queries to trigger instant background refetch
      queryClient.invalidateQueries({ queryKey: ['accounts-payable-invoices'] });

      toast.success('Invoice approved successfully');
      onOpenChange(false);
    } catch (error) {
      console.error('Failed to approve invoice:', error);
      toast.error('Failed to approve invoice');
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn(
        "max-h-[95vh] p-0 transition-all duration-200",
        needsApproverApproval ? "max-w-6xl" : "max-w-4xl"
      )}>
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <FileText className="w-5 h-5 text-primary" />
              </div>
              <div>
                <DialogTitle className="text-lg">
                  Invoice Review - {invoice.invoice_number || invoice.id.slice(0, 8)}
                </DialogTitle>
                <p className="text-sm font-medium mr-2 mt-0.5">
                  {invoice.vendor_name || 'Unknown Vendor'} • Overall Confidence: {invoice.confidence_score || 0}%
                </p>
              </div>
            </div>
            {invoice.pdf_path && (
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => window.open(invoice.pdf_path!, '_blank')}
              >
                <ExternalLink className="w-4 h-4" />
                View PDF
              </Button>
            )}
          </div>
        </DialogHeader>

        <ScrollArea className="max-h-[calc(90vh-180px)]">
          <div className="px-6 space-y-4">
            {/* Location Selector - required before folder/tag selection */}
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
                        {locations.find((l) => l.id === effectiveLocationId)?.location_name || 'Select location'}
                      </span>
                    ) : (
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <MapPin className="w-4 h-4" />
                        Select location
                      </span>
                    )}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[500px] p-0 z-[100]" align="start">
                  <div className="max-h-[300px] overflow-auto" onWheel={(e) => e.stopPropagation()}>
                    {isLoadingLocations ? (
                      <div className="flex items-center justify-center py-6">
                        <Loader2 className="w-5 h-5 animate-spin mr-2" />
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
              <Label className="text-xs text-muted-foreground mb-0.5 block">Select Folder</Label>
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
                        {folders.find((f) => f.id === selectedFolderId)?.name || 'Select folder'}
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
                        <Loader2 className="w-5 h-5 animate-spin font-medium mr-2" />
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
                          <span className="font-medium mr-2 text-sm">No folder (Unassigned)</span>
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
            {invoice && (
              <div>
                <Label className="text-xs text-muted-foreground mb-0.5 block">Select Tags</Label>
                {effectiveLocationId ? (
                  <TagSelector
                    invoiceId={invoice.id}
                    locationId={effectiveLocationId}
                    onTagsUpdate={onTagsUpdate}
                  />
                ) : (
                  <Button
                    variant="outline"
                    disabled
                    className="w-full justify-between font-normal min-h-[40px] h-auto"
                  >
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <Tag className="w-4 h-4" />
                      Select location first
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                )}
              </div>
            )}

            {/* Invoice Information Section - Accordion (collapsed by default) */}
            <Accordion type="single" collapsible>
              <AccordionItem value="invoice-information" className="border rounded-lg">
                <AccordionTrigger className="px-4 py-3 hover:no-underline">
                  <span className="text-sm font-semibold">Invoice Information</span>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4">
                  <div className="grid grid-cols-2 gap-4">
                {/* Left Column - Primary Invoice Details */}
                <div className="border rounded-lg divide-y">
                  <FieldRow label="Vendor Name" value={invoice.vendor_name} confidence={confidenceScores.vendor_name} isHighlighted />
                  <FieldRow label="Customer Name" value={invoice.customer_name} confidence={confidenceScores.customer_name} />
                  <FieldRow label="Invoice Number" value={invoice.invoice_number} confidence={confidenceScores.invoice_number} isHighlighted />
                  <FieldRow label="Invoice Date" value={invoice.invoice_date} confidence={confidenceScores.invoice_date} />
                  <FieldRow label="Due Date" value={invoice.due_date} confidence={confidenceScores.due_date} isHighlighted />
                  <FieldRow label="Currency" value={invoice.currency} confidence={confidenceScores.currency} />
                  <FieldRow label="Subtotal" value={invoice.subtotal} confidence={confidenceScores.subtotal} isHighlighted />
                  <FieldRow label="Tax Total" value={invoice.tax} confidence={confidenceScores.tax} />
                  <FieldRow label="Total" value={invoice.total_amount} confidence={confidenceScores.total_amount} isHighlighted />
                  <FieldRow label="Amount Due" value={invoice.amount_due} confidence={confidenceScores.amount_due} />
                  <FieldRow label="Purchase Order" value={invoice.purchase_order} confidence={confidenceScores.purchase_order} isHighlighted />
                  <FieldRow label="Order Number" value={invoice.order_number} confidence={confidenceScores.order_number} />
                  <FieldRow label="Patient" value={invoice.patient} confidence={confidenceScores.patient} isHighlighted />
                  <FieldRow label="Billed To" value={invoice.billed_to} confidence={confidenceScores.billed_to} />
                  <FieldRow label="VAT No" value={invoice.vat_no} confidence={confidenceScores.vat_no} isHighlighted />
                </div>

                {/* Right Column - Secondary & Account Details */}
                <div className="border rounded-lg divide-y">
                  <FieldRow label="Account" value={invoice.account} confidence={confidenceScores.account} isHighlighted />
                  <FieldRow label="Account Number" value={invoice.account_number} confidence={confidenceScores.account_number} />
                  <FieldRow label="Date Delivered" value={invoice.date_delivered} confidence={confidenceScores.date_delivered} isHighlighted />
                  <FieldRow label="Payment Due By" value={invoice.payment_due_by} confidence={confidenceScores.payment_due_by} />
                  <FieldRow label="Amount" value={invoice.amount} confidence={confidenceScores.amount} isHighlighted />
                  <FieldRow label="Total (No VAT)" value={invoice.total_no_vat} confidence={confidenceScores.total_no_vat} />
                  <FieldRow label="Total GBP" value={invoice.total_gbp} confidence={confidenceScores.total_gbp} isHighlighted />
                  <FieldRow label="Brand ID" value={invoice.brand_id} confidence={confidenceScores.brand_id} />
                  <FieldRow label="Charged" value={invoice.charged ? 'Yes' : 'No'} confidence={confidenceScores.charged} isHighlighted />
                  <FieldRow label="Customer Ref" value={invoice.customer_reference} confidence={confidenceScores.customer_reference} />
                  <FieldRow label="Supply Address" value={invoice.supply_address} confidence={confidenceScores.supply_address} isHighlighted />
                  <FieldRow label="Supply Point ID" value={invoice.supply_point_id} confidence={confidenceScores.supply_point_id} />
                  <FieldRow label="Previous Balance" value={invoice.previous_balance} confidence={confidenceScores.previous_balance} isHighlighted />
                  <FieldRow label="Payments Received" value={invoice.payments_received} confidence={confidenceScores.payments_received} />
                  <FieldRow label="Account Balance" value={invoice.account_balance} confidence={confidenceScores.account_balance} isHighlighted />
                </div>
              </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>

            {/* Invoice Items Section */}
            {lineItems.length > 0 && (
              <div className="space-y-3">
                {/* Header Row 1: Title and Toggle */}
                <div className="flex items-center gap-4 px-3">
                  <h3 className="text-sm font-semibold text-foreground">Invoice Items</h3>
                  <div className="flex items-center gap-2">
                    <Switch
                      id="needs-approver"
                      checked={needsApproverApproval}
                      onCheckedChange={setNeedsApproverApproval}
                      disabled={!effectiveLocationId}
                    />
                    <Label
                      htmlFor="needs-approver"
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

                {/* Header Row 2: Approver Options (only when toggle is ON) */}
                {needsApproverApproval && (
                  <div className="flex items-center gap-4 p-3 bg-indigo-50 rounded-lg border border-indigo-100 mx-3">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="approve-all"
                        checked={approveAll}
                        onCheckedChange={(checked) => setApproveAll(checked as boolean)}
                      />
                      <label htmlFor="approve-all" className="text-sm font-medium text-indigo-700">
                        All Items Approve by single approver
                      </label>
                    </div>

                    {/* Single approver controls - shown when checkbox is checked */}
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
                                aria-expanded={singleApproverOpen}
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
                        <TableHead className="text-white font-medium min-w-[180px]">Description</TableHead>
                        <TableHead className="text-white font-medium min-w-[160px]">Account</TableHead>
                        <TableHead className="text-white font-medium text-right min-w-[70px]">Qty</TableHead>
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
                      {lineItems.map((item, index) => (
                        <TableRow key={item.id || index} className={index % 2 === 0 ? 'bg-blue-50/50 dark:bg-blue-950/10' : ''}>
                          <TableCell className="text-sm max-w-xs">
                            <div className="line-clamp-3">{item.description || '-'}</div>
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
                                  className="w-44 h-8 justify-between text-xs font-normal"
                                >
                                  <span className="truncate">
                                    {lineCoaIds[item.id || index]
                                      ? (() => {
                                          const coa = chartOfAccounts.find((a: any) => a.id === lineCoaIds[item.id || index]);
                                          return coa ? `${coa.coa_account_code} - ${coa.coa_account_name}` : 'Select Account';
                                        })()
                                      : 'Select Account'}
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
                                      <div className="p-3 text-xs font-medium mr-2 text-center">Loading...</div>
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
                                          return <div className="p-3 text-xs font-medium mr-2 text-center">No accounts found.</div>;
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
                                              "flex items-center px-2 py-1.5 cursor-pointer rounded-md hover:bg-accent transition-colors hover:text-white text-xs",
                                              lineCoaIds[item.id || index] === account.id && "bg-accent text-white"
                                            )}
                                          >
                                            <span className="font-medium mr-2">{account.coa_account_code}</span>
                                            <span className="font-medium mr-2">{account.coa_account_name}</span>
                                          </div>
                                        ));
                                      })()
                                    )}
                                  </div>
                                </ScrollArea>
                              </PopoverContent>
                            </Popover>
                          </TableCell>
                          <TableCell className="text-sm text-right">{item.quantity?.toFixed(3) || '-'}</TableCell>
                          <TableCell className="text-sm text-right">{item.unit_price?.toFixed(2) || '-'}</TableCell>
                          <TableCell className="text-sm text-right font-medium">{item.line_total?.toFixed(2) || '-'}</TableCell>
                          {needsApproverApproval && (
                            <>
                              <TableCell className="text-right">
                                <Input
                                  type="number"
                                  placeholder="0.00"
                                  value={linePercentages[item.id || index] || ''}
                                  onChange={(e) => setLinePercentages(prev => ({ ...prev, [item.id || index]: e.target.value }))}
                                  className="w-20 h-8 text-sm text-center disabled:opacity-50 disabled:cursor-not-allowed"
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
                                  {(item as any).approver_id ? (
                                    (item as any).approval_status === 'approved' ? (
                                      <CheckCircle2 className="w-5 h-5 text-green-500 mx-auto" />
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
                                      <MinusCircle className="w-5 h-5 text-yellow-500 mx-auto" />
                                    ) : null
                                  ) : null}
                                </TableCell>
                              )}
                            </>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            {/* Raw Text Section (collapsible) */}
            {/* {invoice.raw_text && (
              <details className="group">
                <summary className="cursor-pointer text-sm font-semibold font-medium mr-2 hover:text-foreground px-3">
                  Raw Extracted Text (click to expand)
                </summary>
                <div className="mt-2 p-3 bg-muted/30 rounded-lg">
                  <pre className="text-xs whitespace-pre-wrap font-mono font-medium mr-2 max-h-48 overflow-y-auto">
                    {invoice.raw_text}
                  </pre>
                </div>
              </details>
            )} */}
          </div>
        </ScrollArea>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t bg-muted/30 flex items-center justify-end gap-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleUpdate}
            disabled={isUpdating}
            className="bg-indigo-600 hover:bg-indigo-700"
          >
            {isUpdating ? 'Updating...' : 'Update'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
