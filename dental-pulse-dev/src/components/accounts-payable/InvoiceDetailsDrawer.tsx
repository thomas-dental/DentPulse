import { useState, useEffect, useCallback, useRef } from 'react';
import { usePlaidLink } from 'react-plaid-link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import {
  FileText,
  Save,
  Send,
  Loader2,
  Plus,
  Trash2,
  ChevronsUpDown,
  ChevronRight,
  ExternalLink,
  CheckCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { AccountsPayableInvoice } from '@/hooks/useAccountsPayableInvoices';
import { InvoiceFolder } from '@/hooks/useInvoiceFolders';
import { useOrganization } from '@/hooks/useOrganization';
import { useLocations } from '@/hooks/useLocations';
import { supabase } from '@/integrations/supabase/client';
import { TagSelector } from './TagSelector';
import { toast } from 'sonner';
import { fetchCoaLabelsByIds } from '@/utils/fetchCoaLabelsByIds';
import { persistInvoiceLineItems } from '@/utils/persistInvoiceLineItems';
import { PayInvoiceDialog } from './PayInvoiceDialog';

interface InvoiceDetailsDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: AccountsPayableInvoice | null;
  onSave?: (invoice: AccountsPayableInvoice) => void;
  onSendToAccounting?: (invoice: AccountsPayableInvoice) => void;
  onTagsUpdate?: () => void;
  selectedLocationId?: string | null; // Global location from header filter
  inline?: boolean; // When true, renders content without Sheet wrapper (for 3-panel layout)
  hidePdfToggle?: boolean; // When true, hides the PDF toggle switch (PDF shown in separate panel)
  folders?: InvoiceFolder[];
  onFolderAssign?: (invoiceId: string, folderId: string | null) => Promise<void>;
}

// Status options for accounting platforms
const STATUS_OPTIONS = [
  { value: 'DRAFT', label: 'Draft' },
  { value: 'SUBMITTED', label: 'Awaiting Approval' },
  { value: 'AUTHORISED', label: 'Awaiting Payment' },
  { value: 'PAID', label: 'Paid' },
];

// QuickBooks only supports Draft and Paid (no approval workflow via API)
const QUICKBOOKS_STATUS_OPTIONS = [
  { value: 'DRAFT', label: 'Draft' },
  { value: 'PAID', label: 'Paid' },
];

// Status badge component
const getStatusBadge = (status: string) => {
  switch (status) {
    case 'pending_review':
      return <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/30">Pending Review</Badge>;
    case 'pending_approval':
      return <Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-500/30">Pending Approval</Badge>;
    case 'approved':
      return <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30">Approved</Badge>;
    case 'paid':
      return <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/30">Paid</Badge>;
    case 'rejected':
      return <Badge variant="outline" className="bg-red-500/10 text-red-600 border-red-500/30">Rejected</Badge>;
    case 'exception':
      return <Badge variant="outline" className="bg-orange-500/10 text-orange-600 border-orange-500/30">Exception</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
};

// Currency symbol helper
const getCurrencySymbol = (currency: string | null | undefined): string => {
  switch (currency?.toUpperCase()) {
    case 'GBP': return '£';
    case 'USD': return '$';
    case 'EUR': return '€';
    case 'AUD': return 'A$';
    case 'CAD': return 'C$';
    default: return '£';
  }
};

// Format date for input
const formatDateForInput = (dateStr: string | null | undefined): string => {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    return date.toISOString().split('T')[0];
  } catch {
    return dateStr;
  }
};

// Format date for display
const formatDateForDisplay = (dateStr: string | null | undefined): string => {
  if (!dateStr) return '-';
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return dateStr;
  }
};

// Platform display names and colors
const PLATFORM_CONFIG: Record<string, { name: string; color: string; hoverColor: string }> = {
  xero: { name: 'Xero', color: 'bg-[#13B5EA]', hoverColor: 'hover:bg-[#0e9ac7]' },
  iplicit: { name: 'iplicit', color: 'bg-[#6366F1]', hoverColor: 'hover:bg-[#4F46E5]' },
  quickbooks: { name: 'QuickBooks', color: 'bg-[#2CA01C]', hoverColor: 'hover:bg-[#238c16]' },
  sage: { name: 'Sage', color: 'bg-[#00D639]', hoverColor: 'hover:bg-[#00b82f]' },
};

// Line item with platform account
interface LineItemWithAccount {
  id?: string;
  description: string;
  quantity: number;
  unit_price: number;
  tax_amount: number;
  line_total: number;
  item?: string;
  location?: string;
  platform_account_id?: string;
}

export function InvoiceDetailsDrawer({
  open,
  onOpenChange,
  invoice,
  onSave,
  onSendToAccounting,
  onTagsUpdate,
  selectedLocationId,
  inline = false,
  hidePdfToggle = false,
  folders = [],
  onFolderAssign,
}: InvoiceDetailsDrawerProps) {
  const queryClient = useQueryClient();
  const plaidSuccessFired = useRef(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSendingToAccounting, setIsSendingToAccounting] = useState(false);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [plaidLinkToken, setPlaidLinkToken] = useState<string | null>(null);
  const [pendingXeroBankId, setPendingXeroBankId] = useState<string>('');
  const [pendingXeroBankCode, setPendingXeroBankCode] = useState<string>('');
  // Post-payment overrides — holds the fresh DB values after a payment so the UI reflects the latest state
  // without waiting for the parent to re-pass a new invoice prop.
  const [postPaymentPatch, setPostPaymentPatch] = useState<{ amount_due?: number | null; status?: string; platform_status?: string; paid_at?: string | null } | null>(null);
  const [openCoaPopover, setOpenCoaPopover] = useState<number | null>(null);
  const [coaSearchTerm, setCoaSearchTerm] = useState('');
  const [selectedBankAccountId, setSelectedBankAccountId] = useState<string>('');
  const [payDialogOpen, setPayDialogOpen] = useState(false);
  const [showPdf, setShowPdf] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfNotFound, setPdfNotFound] = useState(false);
  const [lineItemErrors, setLineItemErrors] = useState<number[]>([]); // Indices of line items with errors
  const [dueDateError, setDueDateError] = useState(false); // Due date validation error
  const [localFolderId, setLocalFolderId] = useState<string | null>(invoice?.folder_id ?? null);

  const { organizationId } = useOrganization();
  const { locations } = useLocations();

  // Get PDF URL - handle both manual uploads and email extractions
  // For email-sourced invoices: query inbound_email_attachments to get stored_path and storage_bucket
  // For manual uploads: use pdf_path with account-payable-attechments bucket
  useEffect(() => {
    const getPdfUrl = async () => {
      setPdfNotFound(false);

      if (!invoice?.id) {
        setPdfUrl(null);
        return;
      }

      let finalUrl: string | null = null;

      // Check if already a full URL in pdf_path or invoice_pdf_url
      const directPath = invoice?.pdf_path || invoice?.invoice_pdf_url;

      console.log('[PDF Debug] Getting PDF URL:', {
        invoiceId: invoice.id,
        pdf_path: invoice?.pdf_path,
        invoice_pdf_url: invoice?.invoice_pdf_url,
        source: invoice?.source,
        directPath,
      });
      if (directPath?.startsWith('http')) {
        // Full URL - use directly
        console.log('[PDF Debug] Using full URL directly:', directPath);
        finalUrl = directPath;
      } else if (directPath?.startsWith('AP-Invoices/')) {
        // Manual upload stored on backend server (AP-Invoices folder)
        const pathParts = directPath.split('/');
        const filename = pathParts[pathParts.length - 1]; // Get last part (filename)
        const backendUrl = 'https://dent-enterprise-api.dentpulse.com';
        finalUrl = `${backendUrl}/api/inbound-email-webhook/view-pdf/${filename}`;

        console.log('[PDF Debug] Manual upload - using backend storage:', {
          invoiceId: invoice.id,
          pdf_path: directPath,
          url: finalUrl,
        });
      } else if (invoice?.source === 'email') {
        // For email-sourced invoices, get the attachment record which has correct stored_path and storage_bucket
        const { data: attachment } = await supabase
          .from('inbound_email_attachments')
          .select('stored_path, storage_bucket')
          .eq('invoice_id', invoice.id)
          .maybeSingle();

        if (attachment?.stored_path) {
          const bucketName = attachment.storage_bucket || 'inbound-attechments';

          // Check if stored on backend server (AP-Invoices folder)
          if (bucketName === 'backend-storage') {
            // Use backend API endpoint to serve PDF
            // stored_path format: AP-Invoices/{filename}
            const pathParts = attachment.stored_path.split('/');
            const filename = pathParts[pathParts.length - 1]; // Get last part (filename)
            const backendUrl = 'https://dent-enterprise-api.dentpulse.com';
            finalUrl = `${backendUrl}/api/inbound-email-webhook/view-pdf/${filename}`;

            console.log('[PDF Debug] Email invoice - using backend storage:', {
              invoiceId: invoice.id,
              stored_path: attachment.stored_path,
              url: finalUrl,
            });
          } else {
            // Use Supabase storage
            const { data: urlData } = supabase.storage
              .from(bucketName)
              .getPublicUrl(attachment.stored_path);

            console.log('[PDF Debug] Email invoice - using Supabase storage:', {
              invoiceId: invoice.id,
              stored_path: attachment.stored_path,
              bucket: bucketName,
              url: urlData?.publicUrl,
            });

            finalUrl = urlData?.publicUrl || null;
          }
        }
      } else if (directPath) {
        // For Supabase storage uploads (invoices/ or other paths)
        const bucketName = directPath.startsWith('invoices/')
          ? 'account-payable-attechments'
          : 'inbound-attechments';

        const { data: urlData } = supabase.storage
          .from(bucketName)
          .getPublicUrl(directPath);

        console.log('[PDF Debug] Manual/fallback - using Supabase storage:', {
          invoiceId: invoice.id,
          pdf_path: directPath,
          bucket: bucketName,
          url: urlData?.publicUrl,
        });

        finalUrl = urlData?.publicUrl || null;
      }

      // Set the PDF URL
      if (finalUrl) {
        // For backend URLs, skip HEAD check (CORS issues with HEAD requests)
        // The PDF will show an error in iframe if it doesn't exist
        const isBackendUrl = finalUrl.includes('/api/inbound-email-webhook/view-pdf/');

        if (isBackendUrl) {
          // Trust backend URLs - they're from our server
          console.log('[PDF Debug] Using backend URL directly (skipping HEAD check):', finalUrl);
          setPdfUrl(finalUrl);
          setPdfNotFound(false);
        } else {
          // For external URLs, verify they exist
          try {
            const response = await fetch(finalUrl, { method: 'HEAD' });
            if (response.ok) {
              setPdfUrl(finalUrl);
              setPdfNotFound(false);
            } else {
              console.log('[PDF Debug] PDF not found:', response.status);
              setPdfUrl(null);
              setPdfNotFound(true);
            }
          } catch (error) {
            console.error('[PDF Debug] Error checking PDF:', error);
            setPdfUrl(null);
            setPdfNotFound(true);
          }
        }
      } else {
        setPdfUrl(null);
        setPdfNotFound(true);
      }
    };

    getPdfUrl();
  }, [invoice?.id, invoice?.pdf_path, invoice?.invoice_pdf_url, invoice?.source]);

  // Form state (without xero_account_id - now on line items)
  const [formData, setFormData] = useState({
    invoice_number: '',
    customer_name: '',
    vendor_name: '',
    currency: 'GBP',
    invoice_date: '',
    due_date: '',
    location_id: '',
    subtotal: 0,
    tax: 0,
    total_amount: 0,
    accounting_status: 'DRAFT',
    vendor_address: '',
    vendor_phone: '',
    vendor_email: '',
    billed_to: '',
  });

  const [lineItems, setLineItems] = useState<LineItemWithAccount[]>([]);
  const [showApprovePrompt, setShowApprovePrompt] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [isMarkingPaid, setIsMarkingPaid] = useState(false);

  // Use invoice's location_id, or fall back to global selectedLocationId from header
  const effectiveLocationId = invoice?.location_id || selectedLocationId;

  // Fetch connected accounting platform based on location mapping
  // This ensures the correct platform (xero/quickbooks/iplicit) button is shown based on location's mapping
  // IMPORTANT: Returns null if no location selected or location not mapped - button will be hidden
  const { data: connectedPlatform, isLoading: isLoadingPlatform } = useQuery({
    queryKey: ['connected-accounting-platform-for-location', organizationId, effectiveLocationId],
    queryFn: async () => {
      if (!organizationId) return null;

      // No location selected = no button should show
      if (!effectiveLocationId) {
        return null;
      }

      // Look up which platform this location is mapped to
      const { data: mapping, error: mapError } = await (supabase as any)
        .from('platform_integration_organization_mapping')
        .select('platform_integration_id, platform_integration_organizations_id')
        .eq('organization_id', organizationId)
        .eq('location_id', effectiveLocationId)
        .limit(1)
        .maybeSingle();

      if (mapError || !mapping?.platform_integration_id) {
        // Location not mapped = no button should show
        return null;
      }

      // Fetch the specific platform integration for this mapping
      const { data: platform, error: platError } = await (supabase as any)
        .from('platform_integrations')
        .select('id, platform_name, is_connected')
        .eq('id', mapping.platform_integration_id)
        .eq('is_connected', true)
        .maybeSingle();

      if (platError || !platform) {
        return null;
      }

      return platform;
    },
    enabled: !!organizationId && open,
  });

  // Fetch mapped platform organization based on location (for COA filtering)
  const { data: mappedPlatformOrg } = useQuery({
    queryKey: ['mapped-platform-org', effectiveLocationId, organizationId],
    queryFn: async () => {
      if (!effectiveLocationId || !organizationId) return null;

      const { data: mappingData, error: mappingError } = await (supabase as any)
        .from('platform_integration_organization_mapping')
        .select('platform_integration_organizations_id')
        .eq('organization_id', organizationId)
        .eq('location_id', effectiveLocationId)
        .limit(1)
        .maybeSingle();

      if (mappingError) {
        console.error('Error fetching mapped platform org:', mappingError);
        return null;
      }

      if (!mappingData?.platform_integration_organizations_id) {
        return null;
      }

      // Get the platform organization details
      const { data: platformOrgData, error: platformOrgError } = await (supabase as any)
        .from('platform_integration_organizations')
        .select('id, platform_org_id, platform_org_name, platform_name, platform_integration_id')
        .eq('id', mappingData.platform_integration_organizations_id)
        .single();

      if (platformOrgError) {
        console.error('Error fetching platform org:', platformOrgError);
        return null;
      }

      return {
        platformOrgDbId: platformOrgData.id,
        platformOrgId: platformOrgData.platform_org_id,
        platformOrgName: platformOrgData.platform_org_name,
        platformName: platformOrgData.platform_name,
        platformIntegrationId: platformOrgData.platform_integration_id,
      };
    },
    enabled: !!effectiveLocationId && !!organizationId && open,
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
    queryKey: ['chart-of-accounts-drawer', organizationId, mappedPlatformOrg?.platformOrgDbId, mappedPlatformOrg?.platformName, mappedPlatformOrg?.platformIntegrationId],
    queryFn: async () => {
      if (!organizationId) return [];

      // Use platform name from the location mapping (most reliable with multi-account)
      let platformName = mappedPlatformOrg?.platformName?.toLowerCase();
      let integrationId = mappedPlatformOrg?.platformIntegrationId || null;

      // Fallback: query platform_integrations if no mapping available
      if (!platformName) {
        const { data: platforms } = await (supabase as any)
          .from('platform_integrations')
          .select('id, platform_name')
          .eq('organization_id', organizationId)
          .eq('is_connected', true)
          .in('platform_name', ['xero', 'iplicit', 'quickbooks', 'sage'])
          .limit(1);
        if (platforms?.[0]) {
          platformName = platforms[0].platform_name.toLowerCase();
          integrationId = platforms[0].id;
        }
      }

      let coaData: any[] = [];

      if (platformName === 'iplicit') {
        // Fetch from iplicit_chart_of_accounts table
        // Filter by ap_flag = true to only show accounts valid for purchase invoices
        let iplicitQuery = (supabase as any)
          .from('iplicit_chart_of_accounts')
          .select('*')
          .eq('organization_id', organizationId)
          .eq('is_active', true)
          .eq('ap_flag', true);

        // Scope to specific iplicit connection if mapped
        if (integrationId) {
          iplicitQuery = iplicitQuery.eq('platform_integration_id', integrationId);
        }

        const { data, error } = await iplicitQuery
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

        if (integrationId) {
          quickbooksQuery = quickbooksQuery.eq('platform_integration_id', integrationId);
        }
        // Scope to the SPECIFIC connected company mapped to this location.
        // One integration can hold several companies, so platform_integration_id
        // alone leaks other locations' accounts. quickbooks_company_id is the
        // platform_integration_organizations row id (= platformOrgDbId).
        if (mappedPlatformOrg?.platformOrgDbId) {
          quickbooksQuery = quickbooksQuery.eq('quickbooks_company_id', mappedPlatformOrg.platformOrgDbId);
        }

        const { data, error } = await quickbooksQuery
          .order('account_type', { ascending: true })
          .order('account_number', { ascending: true });

        if (error) {
          console.error('Error fetching quickbooks chart of accounts:', error);
          return [];
        }

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
        const buildXeroQuery = (scopeToTenant: boolean) => {
          let q = (supabase as any)
            .from('xero_chart_of_accounts')
            .select('*')
            .eq('organization_id', organizationId)
            .eq('is_active', true);
          if (integrationId) q = q.eq('platform_integration_id', integrationId);
          if (scopeToTenant && mappedPlatformOrg?.platformOrgDbId) {
            q = q.or(`xero_tenant_id.eq.${mappedPlatformOrg.platformOrgDbId},xero_tenant_id.is.null`);
          }
          return q.order('account_type', { ascending: true }).order('account_code', { ascending: true });
        };

        let { data, error } = await buildXeroQuery(true);
        // Fall back to the org's connected Xero accounts when the location-scoped
        // query is empty (the mapped entity has no synced COA, or a tenant-id
        // mismatch). Otherwise the dropdown shows "No accounts found" even though
        // valid bill accounts exist for this Xero connection.
        if (!error && (!data || data.length === 0) && mappedPlatformOrg?.platformOrgDbId) {
          const fb = await buildXeroQuery(false);
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
      } else if (platformName === 'sage') {
        // Fetch from sage_chart_of_accounts table (dedicated Sage COA table).
        // The Sage ledger account GUID is `sage_account_id` — used as
        // ledger_account_id when pushing a purchase invoice to Sage.
        let sageQuery = (supabase as any)
          .from('sage_chart_of_accounts')
          .select('*')
          .eq('organization_id', organizationId)
          .eq('is_active', true);

        // Scope to the specific Sage connection mapped to this location.
        if (integrationId) {
          sageQuery = sageQuery.eq('platform_integration_id', integrationId);
        }
        // Scope to the SPECIFIC Sage business mapped to this location — one
        // connection can access several businesses (X-Business). The mapped
        // PIO's platform_org_id IS the Sage business GUID (= sage_business_id).
        if (mappedPlatformOrg?.platformOrgId) {
          sageQuery = sageQuery.eq('sage_business_id', mappedPlatformOrg.platformOrgId);
        }

        const { data, error } = await sageQuery
          .order('account_type', { ascending: true })
          .order('account_code', { ascending: true });

        if (error) {
          console.error('Error fetching sage chart of accounts:', error);
          return [];
        }

        // Map Sage fields to common format (preserve sage_account_id via spread)
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
          .eq('coa_is_active', true);

        // Filter by mapped platform organization if available
        if (mappedPlatformOrg?.platformOrgId) {
          query = query.eq('platform_integration_organization_id', mappedPlatformOrg.platformOrgId);
        } else if (integrationId) {
          query = query.eq('platform_integration_id', integrationId);
        }

        const { data, error } = await query
          .order('coa_account_type', { ascending: true })
          .order('coa_account_code', { ascending: true });

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

      const filteredData = coaData.filter((account: any) => {
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

      return filteredData;
    },
    enabled: !!organizationId && open,
  });

  // Labels for line-item accounts that fall OUTSIDE the scoped options above
  // (saved against another entity, or before a COA re-sync). Looked up by id so
  // the saved value still renders instead of showing "Select Account".
  const savedLineItemAccountIds = (invoice?.line_items || [])
    .map((li: any) => li.platform_account_id)
    .filter(Boolean) as string[];

  const { data: outOfScopeCoaLabels } = useQuery({
    queryKey: ['coa-fallback-labels-drawer', mappedPlatformOrg?.platformName, savedLineItemAccountIds.sort().join(',')],
    queryFn: () => fetchCoaLabelsByIds(mappedPlatformOrg?.platformName, savedLineItemAccountIds),
    enabled: open && savedLineItemAccountIds.length > 0,
  });

  // Fetch bank accounts based on platform type (xero or iplicit)
  const { data: bankAccounts = [], isLoading: isLoadingBankAccounts } = useQuery({
    queryKey: ['bank-accounts-from-coa', organizationId, mappedPlatformOrg?.platformOrgDbId, mappedPlatformOrg?.platformName, mappedPlatformOrg?.platformIntegrationId],
    queryFn: async () => {
      if (!organizationId) return [];

      // Use platform name from the location mapping (most reliable with multi-account)
      let platformName = mappedPlatformOrg?.platformName?.toLowerCase();
      let integrationId = mappedPlatformOrg?.platformIntegrationId || null;

      // Fallback: query platform_integrations if no mapping available
      if (!platformName) {
        const { data: platforms } = await (supabase as any)
          .from('platform_integrations')
          .select('id, platform_name')
          .eq('organization_id', organizationId)
          .eq('is_connected', true)
          .in('platform_name', ['xero', 'iplicit', 'quickbooks', 'sage'])
          .limit(1);
        if (platforms?.[0]) {
          platformName = platforms[0].platform_name.toLowerCase();
          integrationId = platforms[0].id;
        }
      }

      if (platformName === 'iplicit') {
        // Fetch from iplicit_chart_of_accounts table - filter by account_type for bank accounts
        let iplicitQuery = (supabase as any)
          .from('iplicit_chart_of_accounts')
          .select('id, account_id, code, name, description, account_type')
          .eq('organization_id', organizationId)
          .eq('account_type', 'BS') // Balance Sheet accounts include bank accounts
          .eq('is_active', true);

        if (integrationId) {
          iplicitQuery = iplicitQuery.eq('platform_integration_id', integrationId);
        }

        const { data, error } = await iplicitQuery.order('code', { ascending: true });

        if (error) {
          console.error('Error fetching iplicit bank accounts:', error);
          return [];
        }

        // Map Iplicit fields to common format
        return ((data || []) as any[]).map((account: any) => ({
          id: account.id,
          coa_account_id: account.account_id,
          coa_account_code: account.code,
          coa_account_name: account.name || account.description,
          coa_account_type: account.account_type,
        }));
      } else if (platformName === 'quickbooks') {
        // QuickBooks bank accounts
        let bankQuery = (supabase as any)
          .from('quickbooks_chart_of_accounts')
          .select('id, qb_account_id, account_number, account_name, account_type')
          .eq('organization_id', organizationId)
          .eq('account_type', 'Bank')
          .eq('is_active', true);

        if (integrationId) {
          bankQuery = bankQuery.eq('platform_integration_id', integrationId);
        }
        // Scope to the SPECIFIC connected company mapped to this location.
        if (mappedPlatformOrg?.platformOrgDbId) {
          bankQuery = bankQuery.eq('quickbooks_company_id', mappedPlatformOrg.platformOrgDbId);
        }

        const { data, error } = await bankQuery.order('account_number', { ascending: true });

        if (error) {
          console.error('Error fetching quickbooks bank accounts:', error);
          return [];
        }

        return ((data || []) as any[]).map((account: any) => ({
          id: account.id,
          coa_account_id: account.qb_account_id,
          coa_account_code: account.account_number,
          coa_account_name: account.account_name,
          coa_account_type: account.account_type,
        }));
      } else if (platformName === 'xero') {
        // Xero bank accounts from xero_chart_of_accounts.
        // No is_active filter — archived bank accounts are still valid for recording payments.
        let xeroQuery = (supabase as any)
          .from('xero_chart_of_accounts')
          .select('id, xero_account_id, account_code, account_name, account_type, bank_account_type')
          .eq('organization_id', organizationId)
          .eq('account_type', 'BANK');

        if (integrationId) {
          xeroQuery = xeroQuery.eq('platform_integration_id', integrationId);
        }

        // Scope to the correct Xero tenant.
        // xero_tenant_id stores platform_integration_organizations.id (internal UUID).
        // Look it up via platform_org_id (external Xero UUID) to handle row recreations.
        // Also include rows where xero_tenant_id IS NULL (accounts synced before tenant
        // tracking was added). Accounts from other tenants have a non-null, non-matching
        // xero_tenant_id and are correctly excluded.
        if (mappedPlatformOrg?.platformOrgId && integrationId) {
          const { data: orgRows } = await (supabase as any)
            .from('platform_integration_organizations')
            .select('id')
            .eq('platform_integration_id', integrationId)
            .eq('platform_org_id', mappedPlatformOrg.platformOrgId);
          const orgIds = ((orgRows || []) as any[]).map((r: any) => r.id).filter(Boolean);
          if (orgIds.length === 1) {
            xeroQuery = xeroQuery.or(`xero_tenant_id.eq.${orgIds[0]},xero_tenant_id.is.null`);
          } else if (orgIds.length > 1) {
            xeroQuery = xeroQuery.or(`xero_tenant_id.in.(${orgIds.join(',')}),xero_tenant_id.is.null`);
          }
          // If orgIds is empty (no mapping found), show all accounts for this integration
          // rather than blocking the user entirely
        }

        const { data: xeroData, error: xeroError } = await xeroQuery.order('account_code', { ascending: true });
        if (xeroError) {
          console.error('Error fetching xero bank accounts:', xeroError);
          return [];
        }

        return ((xeroData || []) as any[]).map((account: any) => ({
          id: account.id,
          coa_account_id: account.xero_account_id,
          coa_account_code: account.account_code,
          coa_account_name: account.account_name,
          coa_account_type: account.account_type,
        }));
      } else if (platformName === 'sage') {
        // Sage bank accounts from the dedicated sage_bank_accounts table.
        // coa_account_id = sage_bank_account_id (used for the contact payment).
        let sageBankQuery = (supabase as any)
          .from('sage_bank_accounts')
          .select('id, sage_bank_account_id, account_name, account_number, displayed_as')
          .eq('organization_id', organizationId)
          .eq('is_active', true);

        if (integrationId) {
          sageBankQuery = sageBankQuery.eq('platform_integration_id', integrationId);
        }
        // Scope to the location's specific Sage business (multi-business).
        if (mappedPlatformOrg?.platformOrgId) {
          sageBankQuery = sageBankQuery.eq('sage_business_id', mappedPlatformOrg.platformOrgId);
        }

        const { data, error } = await sageBankQuery.order('account_name', { ascending: true });

        if (error) {
          console.error('Error fetching sage bank accounts:', error);
          return [];
        }

        return ((data || []) as any[]).map((account: any) => ({
          id: account.id,
          coa_account_id: account.sage_bank_account_id,
          coa_account_code: account.account_number,
          coa_account_name: account.account_name || account.displayed_as,
          coa_account_type: 'BANK',
        }));
      } else {
        // Fallback: platform_integration_chart_of_accounts (legacy)
        let query = (supabase as any)
          .from('platform_integration_chart_of_accounts')
          .select('id, coa_account_id, coa_account_code, coa_account_name, coa_account_type')
          .eq('organization_id', organizationId)
          .eq('coa_account_type', 'BANK')
          .eq('coa_is_active', true);

        // Filter by mapped platform organization if available
        if (mappedPlatformOrg?.platformOrgId) {
          query = query.eq('platform_integration_organization_id', mappedPlatformOrg.platformOrgId);
        } else if (integrationId) {
          query = query.eq('platform_integration_id', integrationId);
        }

        const { data, error } = await query.order('coa_account_code', { ascending: true });

        if (error) {
          console.error('Error fetching bank accounts:', error);
          return [];
        }

        return data || [];
      }
    },
    enabled: !!organizationId && open,
  });

  // Initialize form data when invoice changes
  useEffect(() => {
    if (invoice) {
      setFormData({
        invoice_number: invoice.invoice_number || '',
        customer_name: invoice.customer_name || '',
        vendor_name: invoice.vendor_name || '',
        currency: invoice.currency || 'GBP',
        invoice_date: formatDateForInput(invoice.invoice_date),
        due_date: formatDateForInput(invoice.due_date),
        location_id: invoice.location_id || '',
        subtotal: invoice.subtotal || 0,
        tax: invoice.tax || 0,
        total_amount: invoice.total_amount || 0,
        accounting_status: invoice.platform_status || 'DRAFT',
        vendor_address: (invoice as any).vendor_address || '',
        vendor_phone: (invoice as any).vendor_phone || '',
        vendor_email: (invoice as any).vendor_email || '',
        billed_to: invoice.billed_to || '',
      });
      // Clear post-payment patch when a different invoice is loaded
      setPostPaymentPatch(null);
      // Clear any previous errors
      setDueDateError(false);
      setLineItemErrors([]);
      // Load saved bank account if exists
      setSelectedBankAccountId(invoice.bank_account_id || '');
      // Map line items with platform_account_id
      setLineItems((invoice.line_items || []).map(item => {
        const qty = item.quantity !== null && item.quantity !== undefined ? item.quantity : 1;
        const unitPrice = item.unit_price || 0;
        const lineTotal = item.line_total || (qty * unitPrice);
        return {
          id: item.id,
          description: item.description || '',
          quantity: qty,
          unit_price: unitPrice,
          tax_amount: item.tax_amount || 0,
          line_total: lineTotal,
          item: item.item,
          location: item.location,
          platform_account_id: item.platform_account_id || '',
        };
      }));
      setLocalFolderId(invoice.folder_id ?? null);
    }
  }, [invoice]);

  // Auto-calculate total amount when subtotal or tax changes
  useEffect(() => {
    const newTotal = (formData.subtotal || 0) + (formData.tax || 0);
    if (newTotal !== formData.total_amount) {
      setFormData(prev => ({ ...prev, total_amount: newTotal }));
    }
  }, [formData.subtotal, formData.tax]);

  // Auto-calculate subtotal when line items change
  // Tax: Only update from line items if they actually have tax_amount values,
  // otherwise preserve the original invoice.tax (from AI extraction or header-level tax)
  useEffect(() => {
    if (lineItems.length > 0) {
      const newSubtotal = lineItems.reduce((sum, item) => {
        return sum + ((item.quantity || 0) * (item.unit_price || 0));
      }, 0);

      // Check if any line item has tax_amount > 0
      const hasLineItemTax = lineItems.some(item => (item.tax_amount || 0) > 0);
      const lineItemsTax = lineItems.reduce((sum, item) => sum + (item.tax_amount || 0), 0);

      const updates: any = {};
      if (newSubtotal !== formData.subtotal) updates.subtotal = newSubtotal;

      // Only update tax from line items if they have tax values
      // Otherwise preserve the original invoice-level tax
      if (hasLineItemTax && lineItemsTax !== formData.tax) {
        updates.tax = lineItemsTax;
      }

      if (Object.keys(updates).length > 0) {
        setFormData(prev => ({ ...prev, ...updates }));
      }
    }
  }, [lineItems.map(i => `${i.quantity}-${i.unit_price}-${i.tax_amount}`).join(',')]);

  // Handle input change
  const handleInputChange = (field: string, value: string | number) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  // Handle location change with auto-save to DB (same pattern as InvoiceDetailModal)
  const handleLocationChange = async (locationId: string) => {
    if (!invoice) return;

    const newLocationId = locationId === "__none__" ? null : locationId;
    setFormData(prev => ({ ...prev, location_id: newLocationId || '' }));

    try {
      const { error } = await supabase
        .from('accounts_payable_invoice')
        .update({ location_id: newLocationId })
        .eq('id', invoice.id);

      if (error) throw error;
      toast.success('Location updated');
    } catch (error) {
      toast.error('Failed to update location');
    }
  };

  // Handle line item change
  const handleLineItemChange = (index: number, field: string, value: string | number) => {
    setLineItems(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      // Recalculate line total
      if (field === 'quantity' || field === 'unit_price') {
        const qty = field === 'quantity' ? Number(value) : Number(updated[index].quantity || 0);
        const price = field === 'unit_price' ? Number(value) : Number(updated[index].unit_price || 0);
        updated[index].line_total = qty * price;
      }
      return updated;
    });
  };

  // Add new line item
  const handleAddLineItem = () => {
    setLineItems(prev => [...prev, {
      description: '',
      quantity: 1,
      unit_price: 0,
      tax_amount: 0,
      line_total: 0,
      item: '',
      location: '',
      platform_account_id: '',
    }]);
  };

  // Remove line item
  const handleRemoveLineItem = (index: number) => {
    setLineItems(prev => prev.filter((_, i) => i !== index));
  };

  // Get COA name for a line item
  const getLineItemCoaName = (accountId: string | undefined) => {
    if (!accountId) return 'Select Account';
    const coa = chartOfAccounts.find((a: any) => a.id === accountId);
    if (coa) {
      // QuickBooks accounts have no account number — show name only rather
      // than "null - <name>".
      return coa.coa_account_code
        ? `${coa.coa_account_code} - ${coa.coa_account_name}`
        : coa.coa_account_name;
    }
    // Not in the scoped options — fall back to the unscoped label lookup so an
    // account saved against another entity still shows.
    const fb = outOfScopeCoaLabels?.get(accountId);
    if (fb) {
      const label = fb.code ? `${fb.code} - ${fb.name}` : fb.name;
      return `${label} (other entity)`;
    }
    return 'Select Account';
  };

  // Get COA code for a line item
  const getLineItemCoaCode = (accountId: string | undefined) => {
    if (!accountId) return null;
    const coa = chartOfAccounts.find((a: any) => a.id === accountId);
    return coa ? coa.coa_account_code : null;
  };

  // Get actual platform account ID for API calls
  // Iplicit: account_id, Xero: coa_account_id, QuickBooks: qb_account_id
  const getLineItemPlatformAccountId = (accountId: string | undefined) => {
    if (!accountId) return null;
    const coa = chartOfAccounts.find((a: any) => a.id === accountId);
    if (!coa) return null;
    // Iplicit → account_id, Xero → coa_account_id, QuickBooks → qb_account_id,
    // Sage → sage_account_id (used as the purchase invoice line's ledger_account_id).
    // (quickbooks-create-invoice uses this as the Bill line's AccountRef.)
    return coa.account_id || coa.coa_account_id || coa.qb_account_id || coa.sage_account_id || null;
  };

  // Get platform config
  const platformConfig = connectedPlatform?.platform_name
    ? PLATFORM_CONFIG[connectedPlatform.platform_name]
    : null;

  // Handle save
  const handleSave = async () => {
    if (!invoice) return;

    setIsSaving(true);
    try {
      // Prepare update data
      // NOTE: platform_status is NOT saved here - it should only be updated via
      // "Send to Xero/QuickBooks" button (share invoice flow)
      const updateData: any = {
        invoice_number: formData.invoice_number,
        customer_name: formData.customer_name,
        vendor_name: formData.vendor_name,
        currency: formData.currency,
        invoice_date: formData.invoice_date || null,
        due_date: formData.due_date || null,
        location_id: formData.location_id || null,
        subtotal: formData.subtotal,
        tax: formData.tax,
        total_amount: formData.total_amount,
        vendor_address: formData.vendor_address || null,
        vendor_phone: formData.vendor_phone || null,
        vendor_email: formData.vendor_email || null,
        billed_to: formData.billed_to || null,
        // platform_status is intentionally excluded - only updated via share invoice
        updated_at: new Date().toISOString(),
      };

      // Update invoice (without xero_account_id and platform_status)
      const { error: invoiceError } = await (supabase as any)
        .from('accounts_payable_invoice')
        .update(updateData)
        .eq('id', invoice.id);

      if (invoiceError) throw invoiceError;

      // Persist line items in place — update existing rows, insert new, delete
      // removed — so approver/approval columns (and tax_amount) are preserved.
      await persistInvoiceLineItems(invoice.id, invoice.line_items || [], lineItems);

      toast.success('Invoice saved successfully');
      onSave?.({ ...invoice, ...formData, line_items: lineItems });
      if (invoice.status === 'pending_review') {
        setShowApprovePrompt(true);
      }
    } catch (error: any) {
      console.error('Error saving invoice:', error);
      toast.error(error.message || 'Failed to save invoice');
    } finally {
      setIsSaving(false);
    }
  };

  // ── Plaid Link for Payment Initiation (drawer-level to avoid competing modal overlays) ────────

  const onPlaidSuccess = useCallback(async (_publicToken: string) => {
    // Plaid can fire onSuccess more than once — guard against double-processing
    if (plaidSuccessFired.current) return;
    plaidSuccessFired.current = true;

    setPlaidLinkToken(null);
    setIsProcessingPayment(true);
    try {
      await handleSendToAccounting('PAID', pendingXeroBankId, pendingXeroBankCode);
      toast.success('Payment authorized and recorded successfully');
      // Refresh invoice list so Pay button disappears immediately on paid invoices
      queryClient.invalidateQueries({ queryKey: ['accounts-payable-invoices'] });
      // Fetch fresh invoice from DB so the drawer shows updated amount_due / status immediately
      // without waiting for the parent to re-pass a new invoice prop.
      if (invoice?.id) {
        const { data: fresh } = await supabase
          .from('accounts_payable_invoice')
          .select('status, platform_status, paid_at, amount_due')
          .eq('id', invoice.id)
          .single();
        if (fresh) {
          setPostPaymentPatch({
            status: fresh.status ?? undefined,
            platform_status: fresh.platform_status ?? undefined,
            paid_at: fresh.paid_at ?? null,
            amount_due: fresh.amount_due ?? null,
          });
        }
      }
    } catch (e: any) {
      toast.error('Payment authorized but recording failed', { description: (e as any).message });
      plaidSuccessFired.current = false; // allow retry if the recording step failed
    } finally {
      setIsProcessingPayment(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingXeroBankId]);

  const onPlaidExit = useCallback((err: any) => {
    setPlaidLinkToken(null);
    setIsProcessingPayment(false);
    if (err) toast.error('Payment cancelled');
  }, []);

  const { open: openPlaidLink, ready: plaidLinkReady } = usePlaidLink({
    token: plaidLinkToken,
    onSuccess: onPlaidSuccess,
    onExit: onPlaidExit,
  });

  useEffect(() => {
    if (plaidLinkToken && plaidLinkReady) {
      // Radix Dialog (Sheet) sets document.body.style.pointerEvents='none' when modal.
      // The Plaid iframe (appended to body) inherits this and becomes unclickable.
      // Temporarily override to 'auto' while Plaid Link is open, then restore.
      const prev = document.body.style.pointerEvents;
      document.body.style.pointerEvents = 'auto';
      openPlaidLink();
      return () => { document.body.style.pointerEvents = prev; };
    }
  }, [plaidLinkToken, plaidLinkReady, openPlaidLink]);

  // ─────────────────────────────────────────────────────────────────────────────

  // Handle send to accounting platform
  // statusOverride: when provided (e.g. 'PAID' from the Pay button), overrides formData.accounting_status
  // bankAccountIdOverride: when provided (from PayInvoiceDialog), overrides selectedBankAccountId
  // bankAccountCodeOverride: account code sent as fallback for live Xero lookup when cached UUID is stale
  const handleSendToAccounting = async (statusOverride?: string, bankAccountIdOverride?: string, bankAccountCodeOverride?: string) => {
    if (!invoice || !connectedPlatform) return;
    const effectiveBankAccountId = bankAccountIdOverride ?? selectedBankAccountId;

    const effectiveStatus = statusOverride ?? formData.accounting_status;

    // Validate location is selected
    if (!formData.location_id) {
      toast.error('Please select location to send invoice');
      return;
    }

    // Check if this is an update (invoice already exists in Xero)
    const isUpdate = !!invoice.platform_invoice_id;

    // Statuses that require account codes on line items
    const statusesRequiringAccounts = ['SUBMITTED', 'AUTHORISED', 'PAID'];

    // Validate line items have account codes for certain statuses
    if (statusesRequiringAccounts.includes(effectiveStatus)) {
      const errorIndices: number[] = [];
      lineItems.forEach((item, index) => {
        if (!item.platform_account_id) {
          errorIndices.push(index);
        }
      });

      if (errorIndices.length > 0) {
        setLineItemErrors(errorIndices);
        const statusLabel = effectiveStatus === 'PAID' ? 'Paid' :
          effectiveStatus === 'AUTHORISED' ? 'Awaiting Payment' : 'Awaiting Approval';

        toast.error(
          `All line items must have an Account selected for "${statusLabel}" status. ${errorIndices.length} line item(s) missing account.`,
          { duration: 5000 }
        );
        return;
      }
    }

    // Clear any previous errors
    setLineItemErrors([]);

    // If "Paid" status is selected from the dropdown and the user clicks "Send to Xero"
    // (not from the Pay button flow), redirect them through the Pay dialog so payment
    // is always explicit and goes through Plaid. Never create a Xero payment silently.
    if (effectiveStatus === 'PAID' && !bankAccountIdOverride) {
      setPayDialogOpen(true);
      return;
    }

    // Validate bank account selection for Xero/Sage/QuickBooks PAID status
    if ((connectedPlatform.platform_name === 'xero' || connectedPlatform.platform_name === 'sage' || connectedPlatform.platform_name === 'quickbooks') && effectiveStatus === 'PAID') {
      if (!effectiveBankAccountId) {
        toast.error('Please select a bank account for payment');
        return;
      }
    }

    // Validate due date is not in the past for PAID status (skip when paying via PayInvoiceDialog)
    if (effectiveStatus === 'PAID' && !bankAccountIdOverride && formData.due_date) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const dueDate = new Date(formData.due_date);
      dueDate.setHours(0, 0, 0, 0);

      if (dueDate < today) {
        setDueDateError(true);
        toast.error('Cannot mark as Paid: Due Date must not be in the past. Please update the Due Date first.');
        return;
      }
    }

    // Clear due date error if validation passes
    setDueDateError(false);

    // Iplicit requires account on all line items
    if (connectedPlatform.platform_name?.toLowerCase() === 'iplicit') {
      const errorIndices: number[] = [];
      lineItems.forEach((item, index) => {
        if (!item.platform_account_id) {
          errorIndices.push(index);
        }
      });

      if (errorIndices.length > 0) {
        setLineItemErrors(errorIndices);
        toast.error(
          `All line items must have an Account selected for Iplicit. ${errorIndices.length} line item(s) missing account.`,
          { duration: 5000 }
        );
        return;
      }
    }

    // Sage requires a ledger account on every purchase invoice line.
    if (connectedPlatform.platform_name?.toLowerCase() === 'sage') {
      const errorIndices: number[] = [];
      lineItems.forEach((item, index) => {
        if (!item.platform_account_id) {
          errorIndices.push(index);
        }
      });

      if (errorIndices.length > 0) {
        setLineItemErrors(errorIndices);
        toast.error(
          `All line items must have an Account selected for Sage. ${errorIndices.length} line item(s) missing account.`,
          { duration: 5000 }
        );
        return;
      }
    }

    // Validate due date must be future date for Iplicit
    if (connectedPlatform.platform_name?.toLowerCase() === 'iplicit') {
      if (!formData.due_date) {
        toast.error('Due date is required for Iplicit');
        return;
      }
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const dueDate = new Date(formData.due_date);
      if (dueDate <= today) {
        toast.error('Due date must be a future date');
        return;
      }
    }

    // Guard against accounts the platform rejects on a purchase bill, so the
    // user gets ONE clear message instead of cryptic per-line errors. Flags a
    // line when its saved account is either out-of-scope (not in this entity's
    // chart of accounts → resolves to no code → "Account code or ID must be
    // specified") or an Accounts Receivable/Payable account ("…not a valid code
    // for this document"). Both must be re-mapped to a valid expense account.
    {
      const badIdx: number[] = [];
      lineItems.forEach((item, index) => {
        if (!item.platform_account_id) return; // missing-account handled above
        const coa = chartOfAccounts.find((a: any) => a.id === item.platform_account_id);
        const t = coa ? `${coa.coa_account_type || ''} ${coa.coa_account_name || ''}`.toLowerCase() : '';
        if (!coa || /(receivable|payable)/.test(t)) badIdx.push(index);
      });
      if (badIdx.length > 0) {
        setLineItemErrors(badIdx);
        toast.error(
          `Line(s) ${badIdx.map((i) => i + 1).join(', ')} use an account that can't be posted to a purchase bill (it belongs to another entity, or is an Accounts Receivable/Payable/Bank account). Re-select a valid expense/cost account for ${platformConfig?.name || connectedPlatform.platform_name}.`,
          { duration: 9000 },
        );
        return;
      }
    }

    setIsSendingToAccounting(true);
    try {
      // Note: Chart of Account selection is optional - Xero will use default if not selected

      // First, save the invoice data to database
      const { error: invoiceError } = await (supabase as any)
        .from('accounts_payable_invoice')
        .update({
          invoice_number: formData.invoice_number,
          customer_name: formData.customer_name,
          vendor_name: formData.vendor_name,
          currency: formData.currency,
          invoice_date: formData.invoice_date || null,
          due_date: formData.due_date || null,
          subtotal: formData.subtotal,
          tax: formData.tax,
          total_amount: formData.total_amount,
          updated_at: new Date().toISOString(),
        })
        .eq('id', invoice.id);

      if (invoiceError) throw invoiceError;

      // Persist line items in place — update existing rows, insert new, delete
      // removed — so approver/approval columns (and tax_amount) are preserved.
      await persistInvoiceLineItems(invoice.id, invoice.line_items || [], lineItems);

      // Now send to accounting platform
      const platform = connectedPlatform.platform_name;

      // Build line items with account codes and platform account IDs
      const lineItemsWithCodes = lineItems.map(item => ({
        ...item,
        account_code: getLineItemCoaCode(item.platform_account_id),
        // Actual platform account ID (Iplicit: account_id, Xero: coa_account_id)
        platform_account_id: getLineItemPlatformAccountId(item.platform_account_id),
      }));

      // Call platform-specific API
      let data: any = null;
      let error: any = null;

      if (platform?.toLowerCase() === 'iplicit') {
        // Call backend API for Iplicit
        const token = (await supabase.auth.getSession()).data.session?.access_token;
        const isIplicitUpdate = !!invoice?.platform_invoice_id;
        const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        const backendUrl = import.meta.env.VITE_SYNC_BACKEND_URL || (isLocal ? 'http://localhost:4000' : 'https://dent-enterprise-api.dentpulse.com');

        const requestBody = {
          invoiceId: invoice.id,
          invoice: {
            ...formData,
            line_items: lineItemsWithCodes,
            status: effectiveStatus,
          },
        };

        // Use update endpoint if invoice already exists in Iplicit
        const endpoint = isIplicitUpdate ? `${backendUrl}/api/iplicit-invoice/update` : `${backendUrl}/api/iplicit-invoice/create`;
        const method = 'POST'; // Always POST to our backend, backend uses PATCH for Iplicit API

        const response = await fetch(endpoint, {
          method: method,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify(requestBody),
        });

        data = await response.json();
        if (!response.ok) {
          error = new Error(data?.error || `Failed to ${isIplicitUpdate ? 'update' : 'create'} invoice in Iplicit`);
        }
      } else {
        // Use edge function for Xero/QuickBooks
        let functionName = '';
        if (platform === 'xero') {
          functionName = 'xero-create-invoice';
        } else if (platform === 'quickbooks') {
          functionName = 'quickbooks-create-invoice';
        } else if (platform === 'sage') {
          functionName = 'sage-create-invoice';
        }

        if (!functionName) {
          throw new Error('Unsupported accounting platform');
        }

        const requestBody = {
          invoiceId: invoice.id,
          bankAccountId: effectiveBankAccountId || undefined,
          bankAccountCode: bankAccountCodeOverride || undefined,
          xeroInvoiceId: isUpdate ? invoice.platform_invoice_id : undefined,
          invoice: {
            ...formData,
            line_items: lineItemsWithCodes,
            status: effectiveStatus,
          },
        };

        // Debug: Log what's being sent to Xero
        console.log('[AP Drawer] Sending to Xero:', {
          lineItemsCount: lineItemsWithCodes.length,
          lineItems: lineItemsWithCodes,
          formData,
          requestBody,
        });

        const result = await supabase.functions.invoke(functionName, {
          body: requestBody,
        });
        data = result.data;
        error = result.error;

        console.log('[AP Drawer] Edge function result:', {
          data,
          error,
          errorMessage: error?.message,
          errorContext: error?.context,
          hasError: !!error,
          hasData: !!data
        });

        // If edge function returned error, extract detailed message
        if (error) {
          let errorMessage = error.message || 'Failed to send invoice';

          // Try to get error message from response data first
          if (data?.error) {
            errorMessage = data.error;
            if (data.validationErrors?.length > 0) {
              errorMessage = data.validationErrors.join('; ');
            }
          }
          // Try to parse error context if available
          else if (error.context) {
            try {
              // Try to get response text from context
              const responseText = await error.context.text?.() || error.context.body;
              if (responseText) {
                const errorBody = typeof responseText === 'string' ? JSON.parse(responseText) : responseText;
                if (errorBody?.error) {
                  errorMessage = errorBody.error;
                  if (errorBody.validationErrors?.length > 0) {
                    errorMessage = errorBody.validationErrors.join('; ');
                  }
                }
              }
            } catch (parseError) {
              console.log('[AP Drawer] Could not parse error context:', parseError);
            }
          }

          throw new Error(errorMessage);
        }
      }

      // Check if data indicates failure even without error object
      if (data && data.success === false) {
        let errorMessage = data.error || `Failed to create invoice in ${platformConfig?.name || platform}`;
        if (data.validationErrors && data.validationErrors.length > 0) {
          errorMessage = data.validationErrors.join('; ');
        }
        throw new Error(errorMessage);
      }

      if (data?.success) {
        // Check different response scenarios
        if (data.alreadyPaid) {
          // Invoice was already paid - just show info
          toast.info('Invoice is already marked as PAID in Xero', {
            duration: 3000,
          });
        } else if (data.paymentError) {
          // Payment creation failed — surface the exact Xero error and throw
          // so the caller (onPlaidSuccess) does NOT show the green success toast
          toast.error('Payment failed in Xero', {
            duration: 10000,
            description: data.paymentError,
          });
          throw new Error(data.paymentError);
        } else if (data.warning) {
          // Payment failed but invoice created
          toast.warning(`Invoice created but payment failed: ${data.warning}`, {
            duration: 8000,
            description: 'Please add the payment manually in Xero.',
          });
        } else {
          const actionText = isUpdate ? 'updated in' : 'sent to';
          toast.success(`Invoice ${actionText} ${platformConfig?.name || platform} successfully`);
        }

        // For Iplicit, backend already updates the invoice - skip duplicate update here
        if (platform?.toLowerCase() === 'iplicit') {
          // Just notify parent with response data from backend
          onSendToAccounting?.({
            ...invoice,
            status: data.data?.status === 'PAID' ? 'paid' : 'approved',
            platform_name: 'iplicit',
            platform_invoice_id: data.iplicitInvoiceId || data.platformInvoiceId,
            platform_status: formData.accounting_status,
          });
        } else {
          // Update invoice with platform invoice ID and name (Xero/QuickBooks)
          const updateData: any = {
            status: 'approved',
            platform_name: platform,
            updated_at: new Date().toISOString(),
          };

          // Set shared_at only if not already set (first time sharing)
          if (!invoice.shared_at) {
            updateData.shared_at = new Date().toISOString();
          }

          // Set paid_at and status to 'paid' if payment was created OR if already paid in Xero
          if (data.paymentCreated || data.alreadyPaid) {
            updateData.paid_at = invoice.paid_at || new Date().toISOString();
            updateData.status = 'paid';
            updateData.platform_status = 'PAID';
            // Save the bank account used for payment
            if (effectiveBankAccountId) {
              updateData.bank_account_id = effectiveBankAccountId;
            }
          } else {
            // Payment not created - set status based on Xero's actual status (AUTHORISED = awaiting payment)
            updateData.platform_status = data.warning ? 'AUTHORISED' : formData.accounting_status;
          }

          if (data.platformInvoiceId) {
            updateData.platform_invoice_id = data.platformInvoiceId;
          } else if (data.xeroInvoiceId) {
            updateData.platform_invoice_id = data.xeroInvoiceId;
          }

          await (supabase as any)
            .from('accounts_payable_invoice')
            .update(updateData)
            .eq('id', invoice.id);

          onSendToAccounting?.({ ...invoice, ...updateData });
        }

        // Close the drawer after successful send so user can navigate freely
        onOpenChange(false);
      } else {
        // Build detailed error message including validation errors
        let errorMessage = data?.error || `Failed to create invoice in ${platformConfig?.name || platform}`;
        if (data?.validationErrors && data.validationErrors.length > 0) {
          errorMessage = data.validationErrors.join('; ');
        }
        throw new Error(errorMessage);
      }
    } catch (error: any) {
      console.error('Error sending to accounting platform:', error);
      // Show detailed error in toast
      const errorMsg = error.message || 'Failed to send invoice';
      toast.error(errorMsg, {
        duration: 5000, // Show longer for validation errors
      });
    } finally {
      setIsSendingToAccounting(false);
    }
  };

  if (!invoice) return null;

  // Expose pdfUrl for parent components (3-panel layout)
  const exposedPdfUrl = pdfUrl;

  // Flatten folder tree with depth for indented dropdown
  const flatFolders: { id: string; name: string; depth: number }[] = [];
  if (folders.length) {
    const walk = (items: InvoiceFolder[], d: number) => {
      items.forEach((f) => {
        flatFolders.push({ id: f.id, name: f.name, depth: d });
        const children = folders.filter((c) => c.parent_id === f.id);
        if (children.length) walk(children, d + 1);
      });
    };
    walk(folders.filter((f) => !f.parent_id), 0);
  }

  const innerContent = (
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="p-6 border-b flex-shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <FileText className="w-5 h-5 text-primary" />
                <h2 className="text-lg font-semibold">Invoice Details</h2>
                {getStatusBadge(invoice.status)}
              </div>
            </div>
            <div className="flex items-center justify-between mt-1">
              <p className="text-sm text-muted-foreground">
                Invoice #{formData.invoice_number || invoice.id?.slice(0, 8)}
              </p>
              {!hidePdfToggle && (invoice.pdf_path || invoice.invoice_pdf_url || pdfUrl) && (
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-sm text-muted-foreground">Show PDF</span>
                  <Switch
                    checked={showPdf}
                    onCheckedChange={setShowPdf}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Content */}
          <ScrollArea className="flex-1">
            {showPdf ? (
              pdfUrl ? (
                <div className="h-full p-4 flex flex-col">
                  <iframe
                    src={`${pdfUrl}#toolbar=1&navpanes=0`}
                    className="w-full flex-1 rounded-lg border bg-gray-100"
                    title="Invoice PDF"
                    style={{ minHeight: 'calc(100vh - 250px)' }}
                  />
                </div>
              ) : pdfNotFound ? (
                <div className="h-full p-4 flex items-center justify-center" style={{ minHeight: 'calc(100vh - 250px)' }}>
                  <div className="text-center">
                    <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                    <p className="text-lg font-medium text-muted-foreground">PDF not found</p>
                    <p className="text-sm text-muted-foreground mt-2">The PDF file for this invoice is not available.</p>
                  </div>
                </div>
              ) : (
                <div className="h-full p-4 flex items-center justify-center">
                  <div className="text-center">
                    <Loader2 className="w-8 h-8 animate-spin text-muted-foreground mx-auto mb-4" />
                    <p className="text-muted-foreground">Loading PDF...</p>
                  </div>
                </div>
              )
            ) : (
            <div className="p-6 space-y-6">
              {/* Folder Selector — always first */}
              {onFolderAssign && (
                <div>
                  <h3 className="text-sm font-semibold mb-3">Folder</h3>
                  <Select
                    value={localFolderId ?? 'none'}
                    onValueChange={(val) => {
                      const folderId = val === 'none' ? null : val;
                      setLocalFolderId(folderId);
                      onFolderAssign(invoice.id, folderId);
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="No folder" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No folder</SelectItem>
                      {flatFolders.map((f) => (
                        <SelectItem key={f.id} value={f.id}>
                          <span style={{ paddingLeft: `${f.depth * 16}px` }}>{f.name}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Location Selector - Show only when All Locations selected in header */}
              {!selectedLocationId && (
                <div>
                  <h3 className="text-sm font-semibold mb-4">Location</h3>
                  <Select
                    value={formData.location_id || "__none__"}
                    onValueChange={handleLocationChange}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select Location" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Select Location</SelectItem>
                      {locations.map((location) => (
                        <SelectItem key={location.id} value={location.id}>
                          {location.location_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Additional Details Section */}
              <div>
                <h3 className="text-sm font-semibold mb-4">Additional Details</h3>
                <div className="grid grid-cols-2 gap-x-8 gap-y-4">
                  {/* Left Column - Editable */}
                  <div className="space-y-4">
                    <div className="grid grid-cols-[140px_1fr] items-center gap-2">
                      <Label className="text-sm text-muted-foreground">Invoice Number</Label>
                      <Input
                        value={formData.invoice_number}
                        onChange={(e) => handleInputChange('invoice_number', e.target.value)}
                        className="h-9"
                        autoFocus={false}
                      />
                    </div>
                    <div className="grid grid-cols-[140px_1fr] items-center gap-2">
                      <Label className="text-sm text-muted-foreground">Customer Name</Label>
                      <Input
                        value={formData.customer_name}
                        onChange={(e) => handleInputChange('customer_name', e.target.value)}
                        className="h-9"
                      />
                    </div>
                    <div className="grid grid-cols-[140px_1fr] items-center gap-2">
                      <Label className="text-sm text-muted-foreground">Vendor Name</Label>
                      <Input
                        value={formData.vendor_name}
                        onChange={(e) => handleInputChange('vendor_name', e.target.value)}
                        className="h-9"
                      />
                    </div>
                    <div className="grid grid-cols-[140px_1fr] items-center gap-2">
                      <Label className="text-sm text-muted-foreground">Currency</Label>
                      <Input
                        value={formData.currency}
                        onChange={(e) => handleInputChange('currency', e.target.value)}
                        className="h-9"
                      />
                    </div>
                    <div className="grid grid-cols-[140px_1fr] items-center gap-2">
                      <Label className="text-sm text-muted-foreground">Invoice Date</Label>
                      <Input
                        type="date"
                        value={formData.invoice_date}
                        onChange={(e) => handleInputChange('invoice_date', e.target.value)}
                        className="h-9"
                      />
                    </div>
                    <div className="grid grid-cols-[140px_1fr] items-center gap-2">
                      <Label className={`text-sm ${dueDateError ? 'text-red-500' : 'text-muted-foreground'}`}>Due Date</Label>
                      <Input
                        type="date"
                        value={formData.due_date}
                        onChange={(e) => {
                          handleInputChange('due_date', e.target.value);
                          setDueDateError(false); // Clear error when date changes
                        }}
                        className={`h-9 ${dueDateError ? 'border-red-500 ring-1 ring-red-500' : ''}`}
                      />
                    </div>
                  </div>

                  {/* Right Column */}
                  <div className="space-y-4">
                    <div className="grid grid-cols-[140px_1fr] items-center gap-2">
                      <Label className="text-sm text-muted-foreground">Status</Label>
                      <span className="text-sm font-medium capitalize">{invoice.status?.replace('_', ' ') || 'Unpaid'}</span>
                    </div>
                    <div className="grid grid-cols-[140px_1fr] items-center gap-2">
                      <Label className="text-sm text-muted-foreground">Invoice Uploaded Date</Label>
                      <span className="text-sm font-medium">{formatDateForDisplay(invoice.created_at)}</span>
                    </div>
                    <div className="grid grid-cols-[140px_1fr] items-center gap-2">
                      <Label className="text-sm text-muted-foreground">Subtotal</Label>
                      <div className="flex items-center gap-1">
                        <span className="text-sm text-muted-foreground">{getCurrencySymbol(formData.currency)}</span>
                        <Input
                          type="number"
                          value={formData.subtotal ?? ''}
                          readOnly
                          className="h-9 bg-muted cursor-not-allowed"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-[140px_1fr] items-center gap-2">
                      <Label className="text-sm text-muted-foreground">Tax</Label>
                      <div className="flex items-center gap-1">
                        <span className="text-sm text-muted-foreground">{getCurrencySymbol(formData.currency)}</span>
                        <Input
                          type="number"
                          value={formData.tax ?? ''}
                          onChange={(e) => {
                            const newTax = parseFloat(e.target.value) || 0;
                            const totalAmount = formData.total_amount || 0;

                            // Validate: Tax cannot be greater than Total Amount
                            if (newTax > totalAmount) {
                              toast.error('Tax cannot be greater than Total Amount');
                              return;
                            }

                            // Keep Total Amount same, adjust Subtotal (round to 2 decimal places)
                            const newSubtotal = Math.round((totalAmount - newTax) * 100) / 100;
                            setFormData(prev => ({
                              ...prev,
                              tax: newTax,
                              subtotal: newSubtotal
                            }));
                          }}
                          className="h-9"
                          min="0"
                          max={formData.total_amount || 0}
                          step="0.01"
                          disabled={invoice?.status === 'paid' || invoice?.platform_status === 'PAID'}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-[140px_1fr] items-center gap-2">
                      <Label className="text-sm text-muted-foreground">Total Amount</Label>
                      <span className="text-sm font-bold">{getCurrencySymbol(formData.currency)}{formData.total_amount?.toLocaleString()}</span>
                    </div>
                    <div className="grid grid-cols-[140px_1fr] items-center gap-2">
                      <Label className="text-sm text-muted-foreground">Platform Status</Label>
                      <Select
                        value={formData.accounting_status}
                        onValueChange={(value) => handleInputChange('accounting_status', value)}
                        disabled={invoice?.status === 'paid' || invoice?.platform_status === 'PAID'}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="-- Select Status --" />
                        </SelectTrigger>
                        <SelectContent>
                          {(connectedPlatform?.platform_name === 'quickbooks' ? QUICKBOOKS_STATUS_OPTIONS : STATUS_OPTIONS).map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {/* Bank Account dropdown - show for Xero/Sage/QuickBooks and PAID status */}
                    {(connectedPlatform?.platform_name === 'xero' || connectedPlatform?.platform_name === 'sage' || connectedPlatform?.platform_name === 'quickbooks') && (formData.accounting_status === 'PAID' || invoice?.platform_status === 'PAID') && (
                      <div className="grid grid-cols-[140px_1fr] items-center gap-2">
                        <Label className="text-sm text-muted-foreground">Bank Account *</Label>
                        <Select
                          value={selectedBankAccountId}
                          onValueChange={setSelectedBankAccountId}
                          disabled={invoice?.status === 'paid' || invoice?.platform_status === 'PAID'}
                        >
                          <SelectTrigger className="h-9">
                            <SelectValue placeholder={isLoadingBankAccounts ? "Loading..." : "-- Select Bank Account --"} />
                          </SelectTrigger>
                          <SelectContent>
                            {bankAccounts.length > 0 ? (
                              bankAccounts.map((account: any) => (
                                <SelectItem key={account.id} value={account.coa_account_id}>
                                  {account.coa_account_code
                                    ? `${account.coa_account_code} - ${account.coa_account_name}`
                                    : account.coa_account_name}
                                </SelectItem>
                              ))
                            ) : !isLoadingBankAccounts ? (
                              <div className="px-2 py-1.5 text-sm text-muted-foreground">
                                No bank accounts found. Sync Chart of Accounts first.
                              </div>
                            ) : null}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    {/* Xero Bill Link */}
                    {invoice?.platform_invoice_id && invoice?.platform_name === 'xero' && (
                      <div className="grid grid-cols-[140px_1fr] items-center gap-2">
                        <Label className="text-sm text-muted-foreground">Xero Bill</Label>
                        <a
                          href={`https://go.xero.com/AccountsPayable/View.aspx?InvoiceID=${invoice.platform_invoice_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-sm text-emerald-700 hover:text-emerald-800 hover:underline font-medium"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          View in Xero
                        </a>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Payment Summary — shown when invoice is fully paid */}
              {(() => {
                const effectiveInvoice = postPaymentPatch ? { ...invoice, ...postPaymentPatch } : invoice;
                const isFullyPaid = effectiveInvoice?.status === 'paid';
                if (!isFullyPaid) return null;

                const total = formData.total_amount || invoice?.total_amount || 0;
                const currSym = getCurrencySymbol(formData.currency);
                const fmt2 = (n: number) => n.toLocaleString('en-GB', { minimumFractionDigits: 2 });

                return (
                  <div className="rounded-lg border p-4 bg-green-50 border-green-200">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm font-bold text-foreground flex items-center gap-1.5">
                        <CheckCircle className="w-4 h-4 text-green-600" />
                        Payment Summary
                      </span>
                      <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-green-100 text-green-800">
                        Fully Paid
                      </span>
                    </div>
                    <div className="h-2 bg-gray-200 rounded-full overflow-hidden mb-3">
                      <div className="h-full bg-green-500 rounded-full" style={{ width: '100%' }} />
                    </div>
                    <div className="flex justify-between text-xs text-muted-foreground mb-2">
                      <span>Paid: <strong className="text-green-700">{currSym}{fmt2(total)}</strong></span>
                      <span>Remaining: <strong className="text-green-700">{currSym}0.00</strong></span>
                    </div>
                    {effectiveInvoice?.paid_at && (
                      <div className="border-t border-green-200 pt-2 mt-1">
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>
                            {new Date(effectiveInvoice.paid_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                            {effectiveInvoice.invoice_number ? ` — Payment for ${effectiveInvoice.invoice_number}` : ' — Payment'}
                          </span>
                          <span className="font-semibold text-foreground">{currSym}{fmt2(total)}</span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Address Block */}
              <div className="grid grid-cols-2 gap-x-8 gap-y-3 p-3 rounded-lg border bg-muted/20">
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground block">From Address</Label>
                  <Textarea
                    value={formData.vendor_address}
                    onChange={(e) => handleInputChange('vendor_address', e.target.value)}
                    placeholder="Vendor / supplier address"
                    className="text-sm resize-none min-h-[80px]"
                    disabled={invoice?.status === 'paid' || invoice?.platform_status === 'PAID'}
                  />
                  <Input
                    value={formData.vendor_phone}
                    onChange={(e) => handleInputChange('vendor_phone', e.target.value)}
                    placeholder="Phone"
                    className="h-8 text-sm"
                    disabled={invoice?.status === 'paid' || invoice?.platform_status === 'PAID'}
                  />
                  <Input
                    value={formData.vendor_email}
                    onChange={(e) => handleInputChange('vendor_email', e.target.value)}
                    placeholder="Email"
                    className="h-8 text-sm"
                    disabled={invoice?.status === 'paid' || invoice?.platform_status === 'PAID'}
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">Billed To</Label>
                  <Textarea
                    value={formData.billed_to}
                    onChange={(e) => handleInputChange('billed_to', e.target.value)}
                    placeholder="Bill-to address"
                    className="text-sm resize-none min-h-[80px]"
                    disabled={invoice?.status === 'paid' || invoice?.platform_status === 'PAID'}
                  />
                </div>
              </div>

              {/* Tags — shown compactly below address */}
              {invoice && (
                <div className="flex items-center gap-3 w-fit">
                  <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">Tags</span>
                  <div className="w-64">
                    <TagSelector
                      invoiceId={invoice.id}
                      locationId={effectiveLocationId}
                      onTagsUpdate={onTagsUpdate}
                    />
                  </div>
                </div>
              )}

              {/* Line Items Section with Account Selection */}
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold">Line Items ({lineItems.length})</h3>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleAddLineItem}
                    className="gap-1"
                    disabled={invoice?.status === 'paid' || invoice?.platform_status === 'PAID'}
                  >
                    <Plus className="w-4 h-4" />
                    Add Item
                  </Button>
                </div>
                <div className="border rounded-lg overflow-hidden">
                  <Table className="table-fixed w-full">
                    <TableHeader>
                      <TableRow className="bg-muted/30">
                        <TableHead className="text-xs" style={{ width: '20%' }}>Description</TableHead>
                        <TableHead className="text-xs" style={{ width: '28%' }}>Expense Account</TableHead>
                        <TableHead className="text-xs text-center" style={{ width: '9%' }}>Qty</TableHead>
                        <TableHead className="text-xs text-right" style={{ width: '13%' }}>Unit Price</TableHead>
                        <TableHead className="text-xs text-right" style={{ width: '10%' }}>Tax</TableHead>
                        <TableHead className="text-xs text-right" style={{ width: '13%' }}>Total</TableHead>
                        <TableHead style={{ width: '7%' }}></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {lineItems.length > 0 ? (
                        lineItems.map((item: LineItemWithAccount, idx: number) => (
                          <TableRow key={idx}>
                            <TableCell className="py-2">
                              <Input
                                value={item.description || ''}
                                onChange={(e) => handleLineItemChange(idx, 'description', e.target.value)}
                                className="h-8 text-xs"
                                placeholder="Description"
                                disabled={invoice?.status === 'paid' || invoice?.platform_status === 'PAID'}
                              />
                            </TableCell>
                            <TableCell className="py-2">
                              <Popover
                                open={openCoaPopover === idx}
                                onOpenChange={(open) => {
                                  setOpenCoaPopover(open ? idx : null);
                                  if (!open) setCoaSearchTerm('');
                                }}
                              >
                                <PopoverTrigger asChild>
                                  <Button
                                    variant="outline"
                                    role="combobox"
                                    className={cn(
                                      "justify-between h-8 w-full text-xs",
                                      lineItemErrors.includes(idx) && "border-red-500 text-red-500 hover:border-red-600"
                                    )}
                                    disabled={invoice?.status === 'paid' || invoice?.platform_status === 'PAID'}
                                  >
                                    <span className="truncate">
                                      {item.platform_account_id
                                        ? getLineItemCoaName(item.platform_account_id)
                                        : lineItemErrors.includes(idx)
                                          ? 'Account Required'
                                          : 'Select Account'}
                                    </span>
                                    <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent
                                  className="w-[300px] p-0"
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
                                  <ScrollArea className="h-[250px]">
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
                                                handleLineItemChange(idx, 'platform_account_id', account.id);
                                                // Clear error for this line item when account is selected
                                                setLineItemErrors(prev => prev.filter(i => i !== idx));
                                                setOpenCoaPopover(null);
                                                setCoaSearchTerm('');
                                              }}
                                              className={cn(
                                                "flex items-center px-2 py-1.5 cursor-pointer rounded-md hover:bg-accent transition-colors text-xs",
                                                item.platform_account_id === account.id && "bg-accent"
                                              )}
                                            >
                                              {account.coa_account_code && (
                                                <span className="font-medium mr-2">{account.coa_account_code}</span>
                                              )}
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
                            <TableCell className="py-2">
                              <Input
                                type="number"
                                value={item.quantity === 0 ? '0' : (item.quantity || 1)}
                                onChange={(e) => handleLineItemChange(idx, 'quantity', parseFloat(e.target.value) || 0)}
                                className="h-8 text-xs text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                min="0"
                                step="1"
                                disabled={invoice?.status === 'paid' || invoice?.platform_status === 'PAID'}
                              />
                            </TableCell>
                            <TableCell className="py-2">
                              <Input
                                type="number"
                                value={item.unit_price === 0 ? '0' : (item.unit_price || '')}
                                onChange={(e) => handleLineItemChange(idx, 'unit_price', parseFloat(e.target.value) || 0)}
                                className="h-8 text-xs text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                min="0"
                                step="0.01"
                                disabled={invoice?.status === 'paid' || invoice?.platform_status === 'PAID'}
                              />
                            </TableCell>
                            <TableCell className="py-2 text-right">
                              <span className="text-xs text-muted-foreground">
                                {getCurrencySymbol(formData.currency)}{(item.tax_amount || 0).toFixed(2)}
                              </span>
                            </TableCell>
                            <TableCell className="py-2 text-right">
                              <span className="text-xs font-medium">
                                {getCurrencySymbol(formData.currency)}{(item.line_total || 0).toLocaleString()}
                              </span>
                            </TableCell>
                            <TableCell className="py-2">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-red-500 hover:text-red-600"
                                onClick={() => handleRemoveLineItem(idx)}
                                disabled={invoice?.status === 'paid' || invoice?.platform_status === 'PAID'}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell colSpan={7} className="text-center py-8 text-muted-foreground text-sm">
                            No line items. Click "Add Item" to add one.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>

              {/* Confidence Score */}
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <div className={`w-2 h-2 rounded-full ${(invoice.confidence_score || 0) >= 80 ? 'bg-emerald-500' : (invoice.confidence_score || 0) >= 50 ? 'bg-amber-500' : 'bg-red-500'}`} />
                <span>Confidence: {invoice.confidence_score || 0}%</span>
              </div>
            </div>
            )}
          </ScrollArea>

          {/* Footer Actions */}
          <div className="p-6 border-t bg-background flex-shrink-0">
            <div className="flex justify-end gap-3">
              {/* Pay button — only when invoice is actually saved as AUTHORISED in DB (sent to Xero) and not already paid */}
              {invoice?.platform_status === 'AUTHORISED' && invoice?.status !== 'paid' && invoice?.platform_status !== 'PAID' && (
                <Button
                  className="min-w-[100px] gap-2 bg-green-600 hover:bg-green-700 text-white"
                  disabled={isProcessingPayment || isSendingToAccounting}
                  onClick={() => setPayDialogOpen(true)}
                >
                  {isProcessingPayment
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <CheckCircle className="w-4 h-4" />}
                  {isProcessingPayment ? 'Paying…' : 'Pay'}
                </Button>
              )}
              {(() => {
                // Disable Save button if invoice is already paid
                const isInvoicePaid = invoice?.status === 'paid' || invoice?.platform_status === 'PAID';
                return (
                  <Button
                    variant="default"
                    onClick={handleSave}
                    disabled={isSaving || isInvoicePaid}
                    className="min-w-[100px]"
                    title={isInvoicePaid ? 'This invoice is already paid and cannot be modified' : undefined}
                  >
                    {isSaving ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <Save className="w-4 h-4 mr-2" />
                        Save
                      </>
                    )}
                  </Button>
                );
              })()}
              {/* Show message if no location selected or location not mapped */}
              {!effectiveLocationId && (
                <span className="text-xs text-muted-foreground italic">
                  Select a location to send to accounting
                </span>
              )}
              {effectiveLocationId && !connectedPlatform && !isLoadingPlatform && (
                <span className="text-xs text-muted-foreground italic">
                  Location not mapped to accounting platform
                </span>
              )}
              {connectedPlatform && platformConfig && invoice?.status !== 'pending_review' && (() => {
                // Disable button if invoice is already paid
                const isAlreadyPaid = invoice?.status === 'paid' || invoice?.platform_status === 'PAID';
                const shouldDisable = isSendingToAccounting || isAlreadyPaid;

                return (
                  <Button
                    variant="default"
                    onClick={() => handleSendToAccounting()}
                    disabled={shouldDisable}
                    className={cn("min-w-[140px]", platformConfig.color, platformConfig.hoverColor)}
                    title={isAlreadyPaid ? `This invoice is already paid in ${platformConfig.name}` : undefined}
                  >
                    {isSendingToAccounting ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Sending...
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4 mr-2" />
                        {invoice?.platform_invoice_id ? `Update in ${platformConfig.name}` : `Send to ${platformConfig.name}`}
                      </>
                    )}
                  </Button>
                );
              })()}
            </div>
          </div>
        </div>
  );

  const approvePromptDialog = (
    <AlertDialog open={showApprovePrompt} onOpenChange={setShowApprovePrompt}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Invoice ready to approve</AlertDialogTitle>
          <AlertDialogDescription>
            This invoice has been saved. Would you like to approve it now so it can be sent to your accounting platform?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button
            variant="outline"
            onClick={() => setShowApprovePrompt(false)}
            disabled={isApproving}
          >
            Later
          </Button>
          <Button
            disabled={isApproving}
            className="bg-green-600 hover:bg-green-700 text-white"
            onClick={async () => {
              if (!invoice?.id) return;
              setIsApproving(true);
              try {
                const { error } = await (supabase as any)
                  .from('accounts_payable_invoice')
                  .update({ status: 'approved', updated_at: new Date().toISOString() })
                  .eq('id', invoice.id);
                if (error) throw error;
                toast.success('Invoice approved successfully');
                setShowApprovePrompt(false);
                onSave?.({ ...invoice, status: 'approved' });
              } catch (err: any) {
                toast.error(err.message || 'Failed to approve invoice');
              } finally {
                setIsApproving(false);
              }
            }}
          >
            {isApproving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Approve Now
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  const payInvoiceDialog = invoice ? (
    <PayInvoiceDialog
      open={payDialogOpen}
      onOpenChange={setPayDialogOpen}
      invoice={invoice}
      orgId={organizationId ?? ''}
      platformName={connectedPlatform?.platform_name}
      bankAccounts={bankAccounts}
      isLoadingBankAccounts={isLoadingBankAccounts}
      onConfirmPay={(bankAccountId, bankAccountCode, linkToken) => {
        // Dialog closes first, then Plaid Link opens from drawer level (no competing overlays)
        setPendingXeroBankId(bankAccountId);
        setPendingXeroBankCode(bankAccountCode);
        setPayDialogOpen(false);
        plaidSuccessFired.current = false; // reset guard for fresh payment attempt
        setPlaidLinkToken(linkToken);
      }}
    />
  ) : null;

  if (inline) {
    return <>{innerContent}{approvePromptDialog}{payInvoiceDialog}</>;
  }

  return (
    <>
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="w-[calc(100vw-185px)] sm:max-w-[calc(100vw-185px)] overflow-hidden p-0"
        side="right"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <SheetHeader className="sr-only">
          <SheetTitle>Invoice Details</SheetTitle>
        </SheetHeader>
        <div className="flex h-full">
          {/* Left: PDF Preview — uses the extra drawer width */}
          <div className="flex-1 min-w-0 flex flex-col bg-muted/40 border-r relative">
            {/* Slide-off handle — close the drawer */}
            <button
              onClick={() => onOpenChange(false)}
              className="absolute left-0 top-1/2 -translate-y-1/2 z-10 bg-primary text-primary-foreground rounded-r-xl shadow-xl w-7 h-16 flex items-center justify-center hover:bg-primary/90 active:scale-95 transition-all"
              title="Close panel"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <div className="px-4 py-3 border-b flex items-center gap-2 flex-shrink-0 bg-background">
              <FileText className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-semibold">Document Preview</span>
            </div>
            <div className="flex-1 p-3 min-h-0">
              {pdfUrl ? (
                <iframe
                  src={`${pdfUrl}#toolbar=1&navpanes=0`}
                  className="w-full h-full rounded-lg border bg-white"
                  title="Invoice PDF"
                />
              ) : pdfNotFound ? (
                <div className="h-full flex items-center justify-center">
                  <div className="text-center">
                    <FileText className="w-16 h-16 text-muted-foreground/30 mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">No document available for this invoice</p>
                  </div>
                </div>
              ) : invoice?.id ? (
                <div className="h-full flex items-center justify-center">
                  <div className="text-center">
                    <Loader2 className="w-8 h-8 animate-spin text-muted-foreground/60 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">Loading document...</p>
                  </div>
                </div>
              ) : (
                <div className="h-full flex items-center justify-center">
                  <div className="text-center">
                    <FileText className="w-16 h-16 text-muted-foreground/30 mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">No document to preview</p>
                  </div>
                </div>
              )}
            </div>
          </div>
          {/* Right: Invoice Details Form — 820px gives the 2-col form enough room */}
          <div className="w-[820px] flex-shrink-0 overflow-y-auto overflow-x-hidden">
            {innerContent}
          </div>
        </div>
      </SheetContent>
    </Sheet>
    {approvePromptDialog}
    {payInvoiceDialog}
    </>
  );
}

// Export a helper to get PDF URL for an invoice (used by 3-panel layout)
export function useInvoicePdfUrl(invoice: AccountsPayableInvoice | null) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfNotFound, setPdfNotFound] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const getPdfUrl = async () => {
      setPdfNotFound(false);
      setIsLoading(true);

      if (!invoice?.id) {
        setPdfUrl(null);
        setIsLoading(false);
        return;
      }

      let finalUrl: string | null = null;
      const directPath = invoice?.pdf_path || invoice?.invoice_pdf_url;

      if (directPath?.startsWith('http')) {
        finalUrl = directPath;
      } else if (directPath?.startsWith('AP-Invoices/')) {
        const pathParts = directPath.split('/');
        const filename = pathParts[pathParts.length - 1];
        const backendUrl = 'https://dent-enterprise-api.dentpulse.com';
        finalUrl = `${backendUrl}/api/inbound-email-webhook/view-pdf/${filename}`;
      } else if (invoice?.source === 'email') {
        const { data: attachment } = await supabase
          .from('inbound_email_attachments')
          .select('stored_path, storage_bucket')
          .eq('invoice_id', invoice.id)
          .maybeSingle();

        if (attachment?.stored_path) {
          const bucketName = attachment.storage_bucket || 'inbound-attechments';
          if (bucketName === 'backend-storage') {
            const pathParts = attachment.stored_path.split('/');
            const filename = pathParts[pathParts.length - 1];
            const backendUrl = 'https://dent-enterprise-api.dentpulse.com';
            finalUrl = `${backendUrl}/api/inbound-email-webhook/view-pdf/${filename}`;
          } else {
            const { data: urlData } = supabase.storage
              .from(bucketName)
              .getPublicUrl(attachment.stored_path);
            finalUrl = urlData?.publicUrl || null;
          }
        }
      } else if (directPath) {
        const bucketName = directPath.startsWith('invoices/')
          ? 'account-payable-attechments'
          : 'inbound-attechments';
        const { data: urlData } = supabase.storage
          .from(bucketName)
          .getPublicUrl(directPath);
        finalUrl = urlData?.publicUrl || null;
      }

      if (finalUrl) {
        const isBackendUrl = finalUrl.includes('/api/inbound-email-webhook/view-pdf/');
        if (isBackendUrl) {
          setPdfUrl(finalUrl);
          setPdfNotFound(false);
        } else {
          try {
            const response = await fetch(finalUrl, { method: 'HEAD' });
            if (response.ok) {
              setPdfUrl(finalUrl);
              setPdfNotFound(false);
            } else {
              setPdfUrl(null);
              setPdfNotFound(true);
            }
          } catch {
            setPdfUrl(null);
            setPdfNotFound(true);
          }
        }
      } else {
        setPdfUrl(null);
        setPdfNotFound(true);
      }
      setIsLoading(false);
    };

    getPdfUrl();
  }, [invoice?.id, invoice?.pdf_path, invoice?.invoice_pdf_url, invoice?.source]);

  return { pdfUrl, pdfNotFound, isLoading };
}
