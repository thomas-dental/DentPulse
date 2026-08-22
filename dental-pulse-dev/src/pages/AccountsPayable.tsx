import { useState, useEffect, useMemo } from 'react';
import { usePermissions } from '@/hooks/usePermissions';
import { useTabPermissions } from '@/hooks/useTabPermissions';
import { cn } from '@/lib/utils';
import { Helmet } from 'react-helmet-async';
import { MainLayout } from '@/components/layout/MainLayout';
import { useAccountsPayableInvoices, AccountsPayableInvoice } from '@/hooks/useAccountsPayableInvoices';
import { useInvoiceFolders, InvoiceFolder } from '@/hooks/useInvoiceFolders';
import { useInvoiceTags, InvoiceTag } from '@/hooks/useInvoiceTags';
import { useChartAccountPayableAnalytics } from '@/hooks/useChartAccountPayableAnalytics';
import { useChartAccountPayableSupplier } from '@/hooks/useChartAccountPayableSupplier';
import { useChartAccountPayableAnalyticsAutomation } from '@/hooks/useChartAccountPayableAnalyticsAutomation';
import { useProcessingEfficiencyMetrics } from '@/hooks/useProcessingEfficiencyMetrics';
import { ChartDateFilter, useChartDateFilter } from '@/components/ui/chart-date-filter';
import { useFilters } from '@/contexts/FilterContext';
import { useLocations } from '@/hooks/useLocations';
import { useAuth } from '@/hooks/useAuth';
import { useAccountsPayablePermissions } from '@/hooks/useAccountsPayablePermissions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AISummaryCard } from '@/components/ai/AISummaryCard';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { InvoiceFileUpload } from '@/components/accounts-payable/InvoiceFileUpload';
import { InvoiceDetailModal } from '@/components/accounts-payable/InvoiceDetailModal';
import { InvoiceFolderSidebar } from '@/components/accounts-payable/InvoiceFolderSidebar';
import { NewFolderModal } from '@/components/accounts-payable/NewFolderModal';
import { DeleteFolderModal } from '@/components/accounts-payable/DeleteFolderModal';
import { InvoiceDetailsDrawer, useInvoicePdfUrl } from '@/components/accounts-payable/InvoiceDetailsDrawer';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { format } from 'date-fns';
import { Upload, FileText, CheckCircle, Clock, AlertCircle, Search, Download, Eye, Edit, Send, Zap, TrendingUp, Building2, Mail, Paperclip, Loader2, FileSearch, ChevronRight, ChevronDown, List, Columns3, Folder, PanelLeftOpen, ExternalLink } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, Legend } from 'recharts';

// Chart colors for pie chart
const CHART_COLORS = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
];

const getStatusBadge = (invoice: { status: string; platform_status?: string | null }) => {
  const base = "text-[10px] px-1.5 py-0.5 whitespace-nowrap";
  const ps = invoice.platform_status;
  const s = invoice.status;

  // Paid — highest priority (DB paid or Xero PAID)
  if (s === 'paid' || ps === 'PAID') {
    return <Badge variant="outline" className={`${base} bg-emerald-500/10 text-emerald-600 border-emerald-500/20`}><CheckCircle className="w-2.5 h-2.5 mr-0.5" />Paid</Badge>;
  }

  // Platform/Xero statuses (invoice has been sent to accounting)
  if (ps === 'AUTHORISED') {
    return <Badge variant="outline" className={`${base} bg-indigo-500/10 text-indigo-600 border-indigo-500/20`}><Clock className="w-2.5 h-2.5 mr-0.5" />Awaiting Payment</Badge>;
  }
  if (ps === 'SUBMITTED') {
    return <Badge variant="outline" className={`${base} bg-orange-500/10 text-orange-600 border-orange-500/20`}><Eye className="w-2.5 h-2.5 mr-0.5" />Awaiting Approval</Badge>;
  }
  if (ps === 'DRAFT') {
    return <Badge variant="outline" className={`${base} bg-slate-500/10 text-slate-500 border-slate-400/20`}><Clock className="w-2.5 h-2.5 mr-0.5" />Draft</Badge>;
  }

  // Internal document statuses (not yet sent to accounting)
  switch (s) {
    case 'pending_review':
    case 'pending_approval':
      return <Badge variant="outline" className={`${base} bg-amber-500/10 text-amber-600 border-amber-500/20`}><Clock className="w-2.5 h-2.5 mr-0.5" />Pending</Badge>;
    case 'approved':
      return <Badge variant="outline" className={`${base} bg-emerald-500/10 text-emerald-600 border-emerald-500/20`}><CheckCircle className="w-2.5 h-2.5 mr-0.5" />Approved</Badge>;
    case 'exception':
      return <Badge variant="outline" className={`${base} bg-red-500/10 text-red-600 border-red-500/20`}><AlertCircle className="w-2.5 h-2.5 mr-0.5" />Exception</Badge>;
    default:
      return <Badge variant="outline" className={base}>{s}</Badge>;
  }
};

function matchesStatusFilter(inv: { status: string; platform_status?: string | null }, filter: string): boolean {
  if (filter === 'all') return true;
  if (filter === 'pending') return inv.status === 'pending_review' || inv.status === 'pending_approval';
  if (filter === 'paid') return inv.status === 'paid' || inv.platform_status === 'PAID';
  if (filter === 'awaiting_payment') return inv.platform_status === 'AUTHORISED';
  if (filter === 'awaiting_approval_xero') return inv.platform_status === 'SUBMITTED';
  if (filter === 'xero_draft') return inv.platform_status === 'DRAFT';
  return inv.status === filter;
}

// Currency code to symbol mapping
const getCurrencySymbol = (currency: string | null | undefined): string => {
  const currencyMap: Record<string, string> = {
    'GBP': '£',
    'EUR': '€',
    'USD': '$',
    'gbp': '£',
    'eur': '€',
    'usd': '$',
    '£': '£',
    '€': '€',
    '$': '$',
  };
  return currencyMap[currency || 'GBP'] || currency || '£';
};

// Folder Display Cell Component
function FolderAssignCell({
  invoice,
  folders,
}: {
  invoice: AccountsPayableInvoice;
  folders: InvoiceFolder[];
  onAssign?: (folderId: string | null) => Promise<void>;
}) {
  const currentFolder = folders.find((f) => f.id === invoice.folder_id);

  return (
    <span className="text-sm">
      {currentFolder ? currentFolder.name : '-'}
    </span>
  );
}

export default function AccountsPayable() {
  const { can } = usePermissions();
  const { canViewTab, defaultTab } = useTabPermissions('accounts_payable');
  const apPermissions = useAccountsPayablePermissions();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [tagFilter, setTagFilter] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [activeTab, setActiveTab] = useState(defaultTab || 'invoice-capture');

  useEffect(() => {
    if (defaultTab && !canViewTab(activeTab)) {
      setActiveTab(defaultTab);
    }
  }, [defaultTab]);

  // Processing Queue tab pagination
  const [queuePage, setQueuePage] = useState(1);
  const [queueItemsPerPage, setQueueItemsPerPage] = useState(10);
  const [processedPage, setProcessedPage] = useState(1);
  const [processedItemsPerPage, setProcessedItemsPerPage] = useState(10);

  // Recently Captured Invoices pagination (Invoice Capture tab)
  const [capturedPage, setCapturedPage] = useState(1);
  const [capturedItemsPerPage, setCapturedItemsPerPage] = useState(10);

  // Top Suppliers pagination (Suppliers tab)
  const [suppliersPage, setSuppliersPage] = useState(1);
  const [suppliersItemsPerPage, setSuppliersItemsPerPage] = useState(10);

  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<AccountsPayableInvoice | null>(null);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [detailInvoice, setDetailInvoice] = useState<AccountsPayableInvoice | null>(null);
  const [approveConfirmInvoice, setApproveConfirmInvoice] = useState<AccountsPayableInvoice | null>(null);

  // Folder state
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [newFolderModalOpen, setNewFolderModalOpen] = useState(false);
  const [editFolder, setEditFolder] = useState<InvoiceFolder | null>(null);
  const [deleteFolderModalOpen, setDeleteFolderModalOpen] = useState(false);
  const [folderToDelete, setFolderToDelete] = useState<InvoiceFolder | null>(null);

  // Invoice tags state - stores tags for each invoice
  const [invoiceTagsMap, setInvoiceTagsMap] = useState<Record<string, InvoiceTag[]>>({});

  // Track which invoices have expanded tags in the table
  const [expandedTagsInvoices, setExpandedTagsInvoices] = useState<Set<string>>(new Set());

  // Toggle expanded tags for an invoice
  const toggleExpandedTags = (invoiceId: string) => {
    setExpandedTagsInvoices(prev => {
      const newSet = new Set(prev);
      if (newSet.has(invoiceId)) {
        newSet.delete(invoiceId);
      } else {
        newSet.add(invoiceId);
      }
      return newSet;
    });
  };

  // Inbound emails state
  const [inboundEmails, setInboundEmails] = useState<any[]>([]);
  const [isLoadingEmails, setIsLoadingEmails] = useState(false);
  const [emailSearchTerm, setEmailSearchTerm] = useState('');
  const [selectedEmail, setSelectedEmail] = useState<any | null>(null);
  const [downloadingAttachment, setDownloadingAttachment] = useState<string | null>(null);
  const [extractingAttachment, setExtractingAttachment] = useState<string | null>(null);
  const [expandedEmailLocations, setExpandedEmailLocations] = useState<Set<string>>(new Set());

  // Invoice share drawer state
  const [shareDrawerOpen, setShareDrawerOpen] = useState(false);
  const [shareInvoice, setShareInvoice] = useState<AccountsPayableInvoice | null>(null);

  // View mode: 'list' (table) or 'split' (3-panel)
  const [viewMode, setViewMode] = useState<'list' | 'split'>('list');
  const [folderSidebarCollapsed, setFolderSidebarCollapsed] = useState(false);

  // PDF URL for 3-panel layout
  const { pdfUrl: sharePdfUrl, pdfNotFound: sharePdfNotFound, isLoading: sharePdfLoading } = useInvoicePdfUrl(shareDrawerOpen ? shareInvoice : null);

  // Get auth and filter context
  const { user, profile } = useAuth();
  const { selectedLocationId, dateRange: globalDateRange } = useFilters();
  const { locations } = useLocations();

  // Helper to get location name by ID
  const getLocationName = (locationId: string | null): string => {
    if (!locationId) return '-';
    const location = locations.find(l => l.id === locationId);
    return location?.location_name || '-';
  };

  // Open the invoice PDF in a new browser tab
  const handleViewPdf = async (invoice: AccountsPayableInvoice) => {
    const directPath = invoice.pdf_path || invoice.invoice_pdf_url;
    if (!directPath) {
      toast.error('No PDF available for this invoice');
      return;
    }
    let url: string | null = null;
    if (directPath.startsWith('http')) {
      url = directPath;
    } else if (directPath.startsWith('AP-Invoices/')) {
      const filename = directPath.split('/').pop();
      url = `https://dent-enterprise-api.dentpulse.com/api/inbound-email-webhook/view-pdf/${filename}`;
    } else if (invoice.source === 'email') {
      const { data: attachment } = await supabase
        .from('inbound_email_attachments')
        .select('stored_path, storage_bucket')
        .eq('invoice_id', invoice.id)
        .maybeSingle();
      if (attachment?.stored_path) {
        const bucket = attachment.storage_bucket || 'inbound-attechments';
        if (attachment.stored_path.startsWith('AP-Invoices/')) {
          const filename = attachment.stored_path.split('/').pop();
          url = `https://dent-enterprise-api.dentpulse.com/api/inbound-email-webhook/view-pdf/${filename}`;
        } else {
          const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(attachment.stored_path);
          url = urlData?.publicUrl || null;
        }
      }
    } else {
      const bucket = 'account-payable-attechments';
      const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(directPath);
      url = urlData?.publicUrl || null;
    }
    if (url) {
      window.open(url, '_blank');
    } else {
      toast.error('Could not load PDF for this invoice');
    }
  };

  // Handle opening the review modal
  const handleReviewInvoice = async (invoice: AccountsPayableInvoice) => {
    // Fetch invoice with line items
    const { data: invoiceWithLineItems } = await (supabase as any)
      .from('accounts_payable_invoice')
      .select(`
        *,
        line_items:accounts_payable_invoice_line_item(*)
      `)
      .eq('id', invoice.id)
      .single();

    // Sort line items by created_at for consistent ordering across modals
    if (invoiceWithLineItems?.line_items) {
      invoiceWithLineItems.line_items.sort((a: any, b: any) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
    }

    setSelectedInvoice(invoiceWithLineItems || invoice);
    setReviewModalOpen(true);
  };

  // Handle opening the detail modal (for viewing/editing)
  const handleViewInvoiceDetail = async (invoice: AccountsPayableInvoice) => {
    // Fetch invoice with line items
    const { data: invoiceWithLineItems } = await (supabase as any)
      .from('accounts_payable_invoice')
      .select(`
        *,
        line_items:accounts_payable_invoice_line_item(*)
      `)
      .eq('id', invoice.id)
      .single();

    // Sort line items by created_at for consistent ordering across modals
    if (invoiceWithLineItems?.line_items) {
      invoiceWithLineItems.line_items.sort((a: any, b: any) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
    }

    setDetailInvoice(invoiceWithLineItems || invoice);
    setDetailModalOpen(true);
  };

  // Handle opening the share drawer
  const handleShareInvoice = async (invoice: AccountsPayableInvoice) => {
    // Fetch the invoice with fresh line items (same as the Detail/Review modals)
    // so the drawer reflects the latest saved accounts instead of stale list
    // data. Without this the drawer lagged behind those modals after an edit.
    const { data: invoiceWithLineItems } = await (supabase as any)
      .from('accounts_payable_invoice')
      .select(`
        *,
        line_items:accounts_payable_invoice_line_item(*)
      `)
      .eq('id', invoice.id)
      .single();

    // Sort line items by created_at for consistent ordering across modals
    if (invoiceWithLineItems?.line_items) {
      invoiceWithLineItems.line_items.sort((a: any, b: any) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
    }

    setShareInvoice(invoiceWithLineItems || invoice);
    setShareDrawerOpen(true);
  };

  // Handle approving an invoice
  const handleApproveInvoice = async (invoiceId: string) => {
    try {
      await updateInvoiceStatus({ invoiceId, status: 'approved' });
      toast.success('Invoice approved successfully');
    } catch (error) {
      toast.error('Failed to approve invoice');
    }
  };

  // Handle folder edit
  const handleEditFolder = (folder: InvoiceFolder) => {
    setEditFolder(folder);
    setNewFolderModalOpen(true);
  };

  // Handle folder delete
  const handleDeleteFolder = (folder: InvoiceFolder) => {
    setFolderToDelete(folder);
    setDeleteFolderModalOpen(true);
  };

  // Confirm folder deletion
  const handleConfirmDeleteFolder = () => {
    if (folderToDelete) {
      deleteFolder(folderToDelete.id);
      setDeleteFolderModalOpen(false);
      setFolderToDelete(null);
      // Reset selected folder if we deleted the selected one
      if (selectedFolderId === folderToDelete.id) {
        setSelectedFolderId(null);
      }
    }
  };

  // Handle viewing attachment - downloads and stores if not already stored
  const handleViewAttachment = async (attachment: any) => {
    // If already stored, use the stored path
    if (attachment.stored_path) {
      const storageType = attachment.storage_bucket || 'inbound-attechments';

      // Check if stored on backend server (AP-Invoices folder)
      if (storageType === 'backend-storage') {
        // Use API endpoint to serve PDF without authentication
        // stored_path format: AP-Invoices/{filename}
        const pathParts = attachment.stored_path.split('/');
        if (pathParts.length >= 2) {
          const filename = pathParts[pathParts.length - 1]; // Get last part (filename)
          const backendUrl = 'https://dent-enterprise-api.dentpulse.com';
          const pdfUrl = `${backendUrl}/api/inbound-email-webhook/view-pdf/${filename}`;
          window.open(pdfUrl, '_blank');
        } else {
          toast.error('Invalid file path');
        }
        return;
      }

      // Otherwise use Supabase storage
      const { data } = supabase.storage
        .from(storageType)
        .getPublicUrl(attachment.stored_path);
      if (data?.publicUrl) {
        window.open(data.publicUrl, '_blank');
      } else {
        toast.error('Failed to get attachment URL');
      }
      return;
    }

    // If not stored, call the edge function to download and store
    if (!attachment.download_url) {
      toast.error('Attachment not available - no download URL');
      return;
    }

    setDownloadingAttachment(attachment.id);
    try {
      const { data, error } = await supabase.functions.invoke('download-attachment', {
        body: { attachmentId: attachment.id },
      });

      if (error) throw error;

      if (data?.publicUrl) {
        // Update the attachment in local state so subsequent views don't re-download
        if (selectedEmail) {
          setSelectedEmail({
            ...selectedEmail,
            inbound_email_attachments: selectedEmail.inbound_email_attachments.map((att: any) =>
              att.id === attachment.id
                ? { ...att, stored_path: data.storagePath }
                : att
            ),
          });
        }
        window.open(data.publicUrl, '_blank');
      } else {
        toast.error('Failed to download attachment');
      }
    } catch (error: any) {
      console.error('Error downloading attachment:', error);
      toast.error(error.message || 'Failed to download attachment');
    } finally {
      setDownloadingAttachment(null);
    }
  };

  // Handle extracting invoice from attachment using FRONTEND OpenAI Service
  // No backend API needed - extraction happens directly in browser
  const handleExtractInvoice = async (attachment: any) => {
    setExtractingAttachment(attachment.id);

    try {
      toast.info('Extracting invoice data with AI...', { duration: 10000 });

      // Use frontend extraction - calls OpenAI directly from browser
      const { extractInvoiceFromAttachmentFrontend } = await import('@/services/inboundEmailService');
      // Use location from email (set by inbound email rules) or fall back to global filter
      const emailLocationId = selectedEmail?.location_id || selectedLocationId;
      const result = await extractInvoiceFromAttachmentFrontend(
        attachment.id,
        attachment.download_url,
        organizationId,
        user?.id,
        emailLocationId
      );

      if (result.status === 'error') {
        throw new Error(result.error || 'Failed to extract invoice');
      }

      if (result.status === 'exists') {
        toast.info('Invoice already extracted for this attachment');
        // Update local state with existing invoice_id so the button gets hidden
        if (selectedEmail && result.invoiceId) {
          setSelectedEmail({
            ...selectedEmail,
            inbound_email_attachments: selectedEmail.inbound_email_attachments.map((att: any) =>
              att.id === attachment.id
                ? { ...att, invoice_id: result.invoiceId }
                : att
            ),
          });
        }
        return;
      }

      const invoiceId = result.invoiceId;

      if (!invoiceId) {
        throw new Error('No invoice ID returned from extraction');
      }

      // Update local state with invoice_id
      if (selectedEmail) {
        setSelectedEmail({
          ...selectedEmail,
          inbound_email_attachments: selectedEmail.inbound_email_attachments.map((att: any) =>
            att.id === attachment.id
              ? { ...att, invoice_id: invoiceId }
              : att
          ),
        });
      }

      // Refetch invoices to include the new one
      refetchInvoices();

      toast.success('Invoice extracted successfully!');

      // Fetch the invoice with line items before opening modal
      const { data: invoiceWithLineItems, error: fetchError } = await (supabase as any)
        .from('accounts_payable_invoice')
        .select(`
          *,
          line_items:accounts_payable_invoice_line_item(*)
        `)
        .eq('id', invoiceId)
        .single();

      console.log('[Invoice Extraction] Fetched invoice with line items:', {
        invoiceId,
        fetchError,
        hasLineItems: !!invoiceWithLineItems?.line_items,
        lineItemsCount: invoiceWithLineItems?.line_items?.length || 0,
      });

      // Sort line items by created_at for consistent ordering across modals
      if (invoiceWithLineItems?.line_items) {
        invoiceWithLineItems.line_items.sort((a: any, b: any) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
      }

      // Open the review modal with the created invoice including line items
      setSelectedInvoice(invoiceWithLineItems);
      setReviewModalOpen(true);

    } catch (error: any) {
      console.error('Error extracting invoice:', error);
      toast.error(error.message || 'Failed to extract invoice');
    } finally {
      setExtractingAttachment(null);
    }
  };

  // Use the accounts payable hook
  const {
    invoices,
    isLoading,
    isUploading,
    uploadInvoice,
    uploadMultipleInvoices,
    updateInvoiceStatus,
    updateInvoice,
    deleteInvoice,
    refetchInvoices,
    organizationId,
  } = useAccountsPayableInvoices({
    locationId: selectedLocationId,
    startDate: globalDateRange.startDate,
    endDate: globalDateRange.endDate,
  });

  // Track which charts have been manually overridden (using their own filter instead of global)
  const [chartFilterOverridden, setChartFilterOverridden] = useState(false);
  const [supplierFilterOverridden, setSupplierFilterOverridden] = useState(false);
  const [topSuppliersFilterOverridden, setTopSuppliersFilterOverridden] = useState(false);
  const [automationFilterOverridden, setAutomationFilterOverridden] = useState(false);
  const [efficiencyFilterOverridden, setEfficiencyFilterOverridden] = useState(false);

  // When global date filter changes from header, reset all chart overrides so they use the new global filter
  useEffect(() => {
    setChartFilterOverridden(false);
    setSupplierFilterOverridden(false);
    setTopSuppliersFilterOverridden(false);
    setAutomationFilterOverridden(false);
    setEfficiencyFilterOverridden(false);
  }, [globalDateRange.startDate.getTime(), globalDateRange.endDate.getTime()]);

  // Monthly Invoice Volume chart date filter
  const {
    filter: chartFilter,
    setFilter: setChartFilterInternal,
    customRange: chartCustomRange,
    setCustomRange: setChartCustomRangeInternal,
    dateRange: chartDateRange,
  } = useChartDateFilter('this-year');

  // Wrapper to track when user manually changes chart filter
  const setChartFilter = (filter: any) => {
    setChartFilterOverridden(true);
    setChartFilterInternal(filter);
  };
  const setChartCustomRange = (range: any) => {
    setChartFilterOverridden(true);
    setChartCustomRangeInternal(range);
  };

  // Effective date range for monthly volume chart: use individual if overridden, otherwise global
  const effectiveChartDateRange = chartFilterOverridden ? chartDateRange : globalDateRange;

  // Fetch monthly invoice volume from stored procedure
  const {
    data: chartData,
    isLoading: isChartLoading,
    isFetching: isChartFetching,
    isError: isChartError,
  } = useChartAccountPayableAnalytics(effectiveChartDateRange.startDate, effectiveChartDateRange.endDate, activeTab === 'analytics');

  // Transform chart data for the BarChart component
  const monthlyVolume = useMemo(() => {
    if (!chartData || chartData.length === 0) {
      return [];
    }

    return chartData.map(item => ({
      month: item.month_name,
      invoices: item.invoice_count,
      amount: Math.round(item.total_amount),
    }));
  }, [chartData]);

  // Supplier chart date filter
  const {
    filter: supplierFilter,
    setFilter: setSupplierFilterInternal,
    customRange: supplierCustomRange,
    setCustomRange: setSupplierCustomRangeInternal,
    dateRange: supplierDateRange,
  } = useChartDateFilter('this-year');

  // Wrapper to track when user manually changes supplier filter
  const setSupplierFilter = (filter: any) => {
    setSupplierFilterOverridden(true);
    setSupplierFilterInternal(filter);
  };
  const setSupplierCustomRange = (range: any) => {
    setSupplierFilterOverridden(true);
    setSupplierCustomRangeInternal(range);
  };

  // Effective date range for supplier chart: use individual if overridden, otherwise global
  const effectiveSupplierDateRange = supplierFilterOverridden ? supplierDateRange : globalDateRange;

  // Fetch supplier analytics from stored procedure
  const {
    data: supplierData,
    isLoading: isSupplierLoading,
    isFetching: isSupplierFetching,
    isError: isSupplierError,
  } = useChartAccountPayableSupplier(effectiveSupplierDateRange.startDate, effectiveSupplierDateRange.endDate, activeTab === 'suppliers', selectedLocationId);

  // Transform supplier data for the PieChart component
  const supplierBreakdown = useMemo(() => {
    if (!supplierData || supplierData.length === 0) {
      return [];
    }

    // Take top 5 suppliers and group the rest as "Other"
    const top5 = supplierData.slice(0, 5);
    const others = supplierData.slice(5);
    const otherTotal = others.reduce((sum, item) => sum + item.total_amount, 0);

    const result = top5.map((item, index) => ({
      name: item.vendor_name,
      value: Math.round(item.total_amount),
      invoices: item.invoice_count,
      color: CHART_COLORS[index % CHART_COLORS.length],
    }));

    if (otherTotal > 0) {
      result.push({
        name: 'Other',
        value: Math.round(otherTotal),
        invoices: others.reduce((sum, item) => sum + item.invoice_count, 0),
        color: CHART_COLORS[4],
      });
    }

    return result;
  }, [supplierData]);

  // Top Suppliers list date filter (separate from Spend by Supplier chart)
  const {
    filter: topSuppliersFilter,
    setFilter: setTopSuppliersFilterInternal,
    customRange: topSuppliersCustomRange,
    setCustomRange: setTopSuppliersCustomRangeInternal,
    dateRange: topSuppliersDateRange,
  } = useChartDateFilter('this-year');

  // Wrapper to track when user manually changes top suppliers filter
  const setTopSuppliersFilter = (filter: any) => {
    setTopSuppliersFilterOverridden(true);
    setTopSuppliersFilterInternal(filter);
  };
  const setTopSuppliersCustomRange = (range: any) => {
    setTopSuppliersFilterOverridden(true);
    setTopSuppliersCustomRangeInternal(range);
  };

  // Effective date range for top suppliers: use individual if overridden, otherwise global
  const effectiveTopSuppliersDateRange = topSuppliersFilterOverridden ? topSuppliersDateRange : globalDateRange;

  // Fetch top suppliers data from stored procedure (separate query)
  const {
    data: topSuppliersData,
    isLoading: isTopSuppliersLoading,
    isFetching: isTopSuppliersFetching,
    isError: isTopSuppliersError,
  } = useChartAccountPayableSupplier(effectiveTopSuppliersDateRange.startDate, effectiveTopSuppliersDateRange.endDate, activeTab === 'suppliers', selectedLocationId);

  // Top suppliers list (all suppliers sorted by amount)
  const topSuppliers = useMemo(() => {
    if (!topSuppliersData || topSuppliersData.length === 0) {
      return [];
    }

    return topSuppliersData.map(item => ({
      name: item.vendor_name,
      spend: Math.round(item.total_amount),
      invoices: item.invoice_count,
      status: 'active',
    }));
  }, [topSuppliersData]);

  // Automation progress date filter state
  const {
    filter: automationFilter,
    setFilter: setAutomationFilterInternal,
    customRange: automationCustomRange,
    setCustomRange: setAutomationCustomRangeInternal,
    dateRange: automationDateRange,
  } = useChartDateFilter('this-year');

  // Wrapper to track when user manually changes automation filter
  const setAutomationFilter = (filter: any) => {
    setAutomationFilterOverridden(true);
    setAutomationFilterInternal(filter);
  };
  const setAutomationCustomRange = (range: any) => {
    setAutomationFilterOverridden(true);
    setAutomationCustomRangeInternal(range);
  };

  // Effective date range for automation chart: use individual if overridden, otherwise global
  const effectiveAutomationDateRange = automationFilterOverridden ? automationDateRange : globalDateRange;

  // Fetch automation progress data
  const {
    data: automationData,
    isLoading: isAutomationLoading,
    isFetching: isAutomationFetching,
    isError: isAutomationError,
  } = useChartAccountPayableAnalyticsAutomation(
    effectiveAutomationDateRange.startDate,
    effectiveAutomationDateRange.endDate,
    activeTab === 'analytics'
  );

  // Transform automation data for the LineChart component
  const automationMetrics = useMemo(() => {
    if (!automationData || automationData.length === 0) {
      return [];
    }

    // Calculate percentages like the original static data
    return automationData.map(item => {
      const total = item.total_count || 1; // Avoid division by zero
      return {
        month: item.month_name,
        manual: Math.round((item.manual_count / total) * 100),
        automated: Math.round((item.email_count / total) * 100),
      };
    });
  }, [automationData]);

  // Processing efficiency metrics date filter state
  const {
    filter: efficiencyFilter,
    setFilter: setEfficiencyFilterInternal,
    customRange: efficiencyCustomRange,
    setCustomRange: setEfficiencyCustomRangeInternal,
    dateRange: efficiencyDateRange,
  } = useChartDateFilter('this-month');

  // Wrapper to track when user manually changes efficiency filter
  const setEfficiencyFilter = (filter: any) => {
    setEfficiencyFilterOverridden(true);
    setEfficiencyFilterInternal(filter);
  };
  const setEfficiencyCustomRange = (range: any) => {
    setEfficiencyFilterOverridden(true);
    setEfficiencyCustomRangeInternal(range);
  };

  // Effective date range for efficiency chart: use individual if overridden, otherwise global
  const effectiveEfficiencyDateRange = efficiencyFilterOverridden ? efficiencyDateRange : globalDateRange;

  // Fetch processing efficiency metrics
  const {
    data: efficiencyMetrics,
    isLoading: isEfficiencyLoading,
    isFetching: isEfficiencyFetching,
  } = useProcessingEfficiencyMetrics(
    effectiveEfficiencyDateRange.startDate,
    effectiveEfficiencyDateRange.endDate,
    activeTab === 'analytics'
  );

  // Use the invoice folders hook - pass selectedLocationId for filtering
  const {
    folders,
    folderTree,
    isLoading: isFoldersLoading,
    createFolder,
    updateFolder,
    deleteFolder,
    moveInvoiceToFolder,
    isCreating: isCreatingFolder,
    isUpdating: isUpdatingFolder,
    isDeleting: isDeletingFolder,
  } = useInvoiceFolders({ selectedLocationId });

  // Fetch tags for the organization (filtered by location if selected)
  const { tags, isLoading: isTagsLoading } = useInvoiceTags();

  // Filter tags by selected location
  const filteredTags = useMemo(() => {
    if (!selectedLocationId) return tags;
    return tags.filter(tag => !tag.location_id || tag.location_id === selectedLocationId);
  }, [tags, selectedLocationId]);

  // Filter invoices uploaded today for Recently Captured Invoices section
  const todayInvoices = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return invoices.filter(invoice => {
      const invoiceDate = new Date(invoice.created_at);
      invoiceDate.setHours(0, 0, 0, 0);
      return invoiceDate.getTime() === today.getTime();
    });
  }, [invoices]);

  // Reset pagination when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, statusFilter, tagFilter, selectedFolderId]);

  // Function to fetch tags for all invoices
  const fetchInvoiceTags = async () => {
    if (!invoices.length) return;

    const invoiceIds = invoices.map(inv => inv.id);
    const { data, error } = await supabase
      .from('invoice_tag_assignments')
      .select('invoice_id, tag_id, invoice_tags(*)')
      .in('invoice_id', invoiceIds);

    if (error) {
      console.error('Error fetching invoice tags:', error);
      return;
    }

    // Group tags by invoice_id
    const tagsMap: Record<string, InvoiceTag[]> = {};
    (data || []).forEach((item: any) => {
      if (!tagsMap[item.invoice_id]) {
        tagsMap[item.invoice_id] = [];
      }
      if (item.invoice_tags) {
        tagsMap[item.invoice_id].push(item.invoice_tags);
      }
    });
    setInvoiceTagsMap(tagsMap);
  };

  // Fetch tags for all invoices when invoices change
  useEffect(() => {
    fetchInvoiceTags();
  }, [invoices]);

  // Export filtered invoices to CSV
  const handleExportInvoices = () => {
    // Apply all filters to get the export data
    const filteredData = folderFilteredInvoices.filter(inv => {
      // Status filter
      if (!matchesStatusFilter(inv, statusFilter)) {
        return false;
      }
      // Tag filter
      if (tagFilter !== 'all') {
        const invoiceTags = invoiceTagsMap[inv.id] || [];
        if (!invoiceTags.some(tag => tag.id === tagFilter)) {
          return false;
        }
      }
      // Search filter
      const searchLower = searchTerm.toLowerCase();
      const locationName = getLocationName(inv.location_id);
      const amountStr = (inv.total_amount || 0).toString();
      return (
        (inv.vendor_name?.toLowerCase() || '').includes(searchLower) ||
        (inv.invoice_number?.toLowerCase() || '').includes(searchLower) ||
        (inv.customer_name?.toLowerCase() || '').includes(searchLower) ||
        (locationName?.toLowerCase() || '').includes(searchLower) ||
        amountStr.includes(searchLower)
      );
    });

    if (filteredData.length === 0) {
      toast.error('No invoices to export');
      return;
    }

    // Get location names map
    const locationMap: Record<string, string> = {};
    locations.forEach((loc: any) => {
      locationMap[loc.id] = loc.location_name;
    });

    // Get folder names map
    const folderMap: Record<string, string> = {};
    folders.forEach((folder: InvoiceFolder) => {
      folderMap[folder.id] = folder.name;
    });

    // Get tag names for each invoice
    const getTagNames = (invoiceId: string) => {
      const tags = invoiceTagsMap[invoiceId] || [];
      return tags.map(t => t.name).join(', ');
    };

    // Create CSV headers
    const headers = [
      'Invoice #',
      'Vendor',
      'Customer',
      'Location',
      'Tags',
      'Folder',
      'Amount',
      'Currency',
      'Invoice Date',
      'Due Date',
      'Status'
    ];

    // Create CSV rows
    const rows = filteredData.map(inv => [
      inv.invoice_number || '',
      inv.vendor_name || '',
      inv.customer_name || '',
      inv.location_id ? (locationMap[inv.location_id] || '') : '',
      getTagNames(inv.id),
      inv.folder_id ? (folderMap[inv.folder_id] || '') : '',
      inv.total_amount?.toFixed(2) || '',
      inv.currency || 'GBP',
      inv.invoice_date || '',
      inv.due_date || '',
      inv.status || ''
    ]);

    // Escape CSV values
    const escapeCSV = (value: string) => {
      if (value.includes(',') || value.includes('"') || value.includes('\n')) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return value;
    };

    // Build CSV content
    const csvContent = [
      headers.map(escapeCSV).join(','),
      ...rows.map(row => row.map(escapeCSV).join(','))
    ].join('\n');

    // Create blob and download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;

    // Generate filename with date and filters
    const dateStr = new Date().toISOString().split('T')[0];
    const filterInfo = [
      selectedLocationId ? 'location' : 'all-locations',
      statusFilter !== 'all' ? statusFilter : '',
      tagFilter !== 'all' ? 'tagged' : '',
      searchTerm ? 'search' : ''
    ].filter(Boolean).join('-');

    link.download = `invoices-export-${dateStr}${filterInfo ? '-' + filterInfo : ''}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast.success(`Exported ${filteredData.length} invoices`);
  };

  // Export only recently processed (approved/paid/rejected) invoices to CSV
  const handleExportProcessedInvoices = () => {
    if (processedInvoicesFromDB.length === 0) {
      toast.error('No processed invoices to export');
      return;
    }

    const locationMap: Record<string, string> = {};
    locations.forEach((loc: any) => { locationMap[loc.id] = loc.location_name; });

    const headers = ['Invoice #', 'Vendor', 'Customer', 'Location', 'Amount', 'Currency', 'Invoice Date', 'Due Date', 'Status'];
    const rows = processedInvoicesFromDB.map(inv => [
      inv.invoice_number || '',
      inv.vendor_name || '',
      inv.customer_name || '',
      inv.location_id ? (locationMap[inv.location_id] || '') : '',
      inv.total_amount?.toFixed(2) || '',
      inv.currency || 'GBP',
      inv.invoice_date || '',
      inv.due_date || '',
      inv.status || '',
    ]);

    const escapeCSV = (value: string) =>
      value.includes(',') || value.includes('"') || value.includes('\n')
        ? `"${value.replace(/"/g, '""')}"` : value;

    const csvContent = [headers.map(escapeCSV).join(','), ...rows.map(row => row.map(escapeCSV).join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `processed-invoices-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success(`Exported ${processedInvoicesFromDB.length} processed invoices`);
  };

  // Fetch inbound emails when tab is active - filtered by user_id or location_id based on selection
  useEffect(() => {
    // Reset selected email when location changes
    setSelectedEmail(null);

    const fetchInboundEmails = async () => {
      if (activeTab !== 'email-inbox') return;
      if (!user?.id) return;

      setIsLoadingEmails(true);
      try {
        let query = supabase
          .from('inbound_emails')
          .select('*, inbound_email_attachments(*)');

        // When "All Locations" is selected, fetch by user_id
        // When specific location is selected, fetch by location_id
        if (selectedLocationId) {
          query = query.eq('location_id', selectedLocationId);
        } else {
          // All locations - fetch by user_id
          query = query.eq('user_id', user.id);
        }

        // Filter by date range from global header filter
        if (globalDateRange.startDate && globalDateRange.endDate) {
          // Use full ISO format with timezone
          const startDateStr = globalDateRange.startDate.toISOString();
          const endDateStr = globalDateRange.endDate.toISOString();
          query = query.gte('created_at', startDateStr);
          query = query.lte('created_at', endDateStr);
        }

        const { data, error } = await query.order('created_at', { ascending: false });

        console.log('[Email Inbox] Query result:', {
          loggedInUserId: user.id,
          selectedLocationId,
          dateRange: {
            start: globalDateRange.startDate?.toISOString(),
            end: globalDateRange.endDate?.toISOString(),
          },
          emailCount: data?.length || 0,
          emails: data,
          error,
        });

        if (error) throw error;
        setInboundEmails(data || []);
      } catch (error) {
        console.error('Error fetching inbound emails:', error);
        toast.error('Failed to load inbound emails');
      } finally {
        setIsLoadingEmails(false);
      }
    };

    fetchInboundEmails();
  }, [activeTab, user?.id, selectedLocationId, globalDateRange.startDate, globalDateRange.endDate]);

  // Filter invoices by status
  const pendingInvoicesFromDB = invoices.filter(inv =>
    ['pending_review', 'pending_approval', 'exception', 'processing'].includes(inv.status)
  );
  const processedInvoicesFromDB = invoices.filter(inv =>
    ['approved', 'paid', 'rejected'].includes(inv.status)
  );

  // Filter by search term and status
  const filteredPending = pendingInvoicesFromDB.filter(inv => {
    // Apply status filter
    if (!matchesStatusFilter(inv, statusFilter)) return false;

    // Apply search filter
    const searchLower = searchTerm.toLowerCase();
    return (inv.vendor_name?.toLowerCase() || '').includes(searchLower) ||
           (inv.invoice_number?.toLowerCase() || '').includes(searchLower);
  });

  // Count unassigned invoices (no folder)
  const unassignedCount = invoices.filter(inv => !inv.folder_id).length;

  // Calculate folder invoice counts using the same status+tag filters as the invoice list
  // so the badge accurately reflects what you'd see when clicking a folder.
  const folderInvoiceCounts = invoices.reduce((acc, inv) => {
    if (!inv.folder_id) return acc;
    if (!matchesStatusFilter(inv, statusFilter)) return acc;
    if (tagFilter !== 'all') {
      const tags = invoiceTagsMap[inv.id] || [];
      if (!tags.some(t => t.id === tagFilter)) return acc;
    }
    acc[inv.folder_id] = (acc[inv.folder_id] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // Helper function to get all descendant folder IDs (children, grandchildren, etc.)
  const getAllDescendantFolderIds = (parentId: string): string[] => {
    const descendants: string[] = [];
    const children = folders.filter(f => f.parent_id === parentId);

    for (const child of children) {
      descendants.push(child.id);
      descendants.push(...getAllDescendantFolderIds(child.id));
    }

    return descendants;
  };

  // Filter invoices by selected folder (including sub-folders)
  const getFilteredInvoicesByFolder = () => {
    if (selectedFolderId === null) {
      // Show all invoices when "All Documents" is selected
      return invoices;
    }

    // Get selected folder and all its descendant folder IDs
    const folderIdsToInclude = [selectedFolderId, ...getAllDescendantFolderIds(selectedFolderId)];

    // Show invoices in the selected folder OR any of its sub-folders
    return invoices.filter(inv => inv.folder_id && folderIdsToInclude.includes(inv.folder_id));
  };

  const folderFilteredInvoices = getFilteredInvoicesByFolder();

  // Calculate real stats from DB data
  const pendingCount = pendingInvoicesFromDB.length;
  const pendingValue = pendingInvoicesFromDB.reduce((sum, inv) => sum + (inv.total_amount || 0), 0);
  const exceptionsCount = invoices.filter(i => i.status === 'exception').length;

  // Calculate processed invoices for this month vs last month
  const now = new Date();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const thisMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

  // Filter processed invoices by month (using paid_at or updated_at as the processed date)
  const thisMonthProcessed = processedInvoicesFromDB.filter(inv => {
    const processedDate = new Date(inv.paid_at || inv.updated_at || inv.created_at);
    return processedDate >= thisMonthStart && processedDate <= thisMonthEnd;
  });

  const lastMonthProcessed = processedInvoicesFromDB.filter(inv => {
    const processedDate = new Date(inv.paid_at || inv.updated_at || inv.created_at);
    return processedDate >= lastMonthStart && processedDate <= lastMonthEnd;
  });

  const processedCount = thisMonthProcessed.length;
  const lastMonthProcessedCount = lastMonthProcessed.length;

  // Calculate percentage change vs last month
  let processedPercentageChange = 0;
  let showProcessedComparison = false;

  if (lastMonthProcessedCount > 0 && processedCount > 0) {
    processedPercentageChange = Math.round(((processedCount - lastMonthProcessedCount) / lastMonthProcessedCount) * 100);
    showProcessedComparison = true;
  } else if (processedCount > 0 && lastMonthProcessedCount === 0) {
    // New activity this month but nothing last month - show as increase
    showProcessedComparison = false; // Can't calculate percentage from 0
  }

  // Calculate Automation Rate: (email-sourced invoices / total invoices) × 100
  const emailSourcedCount = invoices.filter(inv => inv.source === 'email').length;
  const automationRate = invoices.length > 0
    ? Math.round((emailSourcedCount / invoices.length) * 100)
    : 0;

  // Calculate Avg Processing Time: average days from created_at to paid_at/shared_at
  const processedWithDates = processedInvoicesFromDB.filter(inv => {
    const endDate = inv.paid_at || inv.shared_at;
    return endDate && inv.created_at;
  });

  const avgProcessingTime = processedWithDates.length > 0
    ? (() => {
        const totalDays = processedWithDates.reduce((sum, inv) => {
          const startDate = new Date(inv.created_at);
          const endDate = new Date(inv.paid_at || inv.shared_at);
          const diffInDays = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
          return sum + Math.max(0, diffInDays);
        }, 0);
        return Math.round((totalDays / processedWithDates.length) * 10) / 10; // Round to 1 decimal
      })()
    : 0;

  // AI context data
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const todayMs = Date.now();
  const dayMs = 1000 * 60 * 60 * 24;

  const selectedLocationName = selectedLocationId
    ? (locations.find((l: any) => l.id === selectedLocationId)?.location_name ?? 'Selected Location')
    : 'All Locations';

  const pendingApproval = invoices.filter((inv: any) => inv.status === 'pending_approval').length;

  // Oldest/overdue: invoices not yet paid, ordered by age (created_at)
  const unpaidInvoices = invoices.filter((inv: any) =>
    inv.status && !['paid', 'rejected'].includes(inv.status)
  );

  const overdueRows = unpaidInvoices
    .map((inv: any) => {
      const created = inv.created_at ? new Date(inv.created_at).getTime() : todayMs;
      const ageDays = Math.max(0, Math.floor((todayMs - created) / dayMs));
      return {
        invoiceNumber: inv.invoice_number ?? null,
        vendor: inv.vendor_name ?? null,
        amount: round2(Number(inv.total_amount) || 0),
        status: inv.status,
        createdAt: inv.created_at ?? null,
        ageDays,
      };
    })
    .sort((a: any, b: any) => b.ageDays - a.ageDays)
    .slice(0, 50);

  const supplierRows = (topSuppliers || []).slice(0, 50).map((s: any) => ({
    supplier: s.name,
    spend: round2(s.spend ?? 0),
    invoices: s.invoices ?? 0,
  }));

  const apData = {
    pendingInvoices: pendingCount,
    pendingValue: round2(pendingValue),
    processedThisMonth: processedCount,
    automationRate: automationRate,
    avgProcessingTime: avgProcessingTime,
    exceptionsCount: exceptionsCount,
    pendingApprovalCount: pendingApproval,
    selectedLocationName,
    period: {
      from: globalDateRange.startDate.toISOString().slice(0, 10),
      to: globalDateRange.endDate.toISOString().slice(0, 10),
    },
    rows: {
      overdueOrAgingInvoices: overdueRows,
      topSuppliers: supplierRows,
    },
    rankings: {
      topSuppliersByOutstanding: [...supplierRows].sort((a, b) => b.spend - a.spend).slice(0, 10),
      oldestUnpaidInvoices: overdueRows.slice(0, 10),
    },
  };

  return (
    <MainLayout userRole="admin" aiContext={{ page: 'accounts-payable', data: apData }}>
      <Helmet>
        <title>Accounts Payable</title>
        <meta
          name="description"
          content="Manage vendor invoices, track payments, and organize accounts payable with AI-powered insights for dental practices."
        />
      </Helmet>
      <div className="space-y-6">
        {/* Page Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Accounts Payable Automation</h1>
            <p className="text-muted-foreground mt-1">Capture, process and approve supplier invoices</p>
          </div>
          {/* <Button className="gap-2">
            <Upload className="w-4 h-4" />
            Upload Invoices
          </Button> */}
        </div>

        {/* AI Summary */}
        <AISummaryCard page="accounts-payable" data={apData} />

        {/* Summary KPIs */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Review & Approval</p>
                  <p className="text-2xl font-bold text-foreground mt-1">{pendingCount}</p>
                  <p className="text-xs text-amber-600 mt-1">£{Math.round(pendingValue).toLocaleString()} total value</p>
                </div>
                <div className="w-12 h-12 rounded-lg bg-amber-500/10 flex items-center justify-center">
                  <Clock className="w-6 h-6 text-amber-600" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Processed This Month</p>
                  <p className="text-2xl font-bold text-foreground mt-1">{processedCount}</p>
                  {showProcessedComparison ? (
                    processedPercentageChange >= 0 ? (
                      <p className="text-xs text-emerald-600 mt-1">↑ {processedPercentageChange}% vs last month</p>
                    ) : (
                      <p className="text-xs text-red-600 mt-1">↓ {Math.abs(processedPercentageChange)}% vs last month</p>
                    )
                  ) : processedCount > 0 && lastMonthProcessedCount === 0 ? (
                    <p className="text-xs text-emerald-600 mt-1">New activity this month</p>
                  ) : (
                    <p className="text-xs text-muted-foreground mt-1">{lastMonthProcessedCount} last month</p>
                  )}
                </div>
                <div className="w-12 h-12 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                  <CheckCircle className="w-6 h-6 text-emerald-600" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Automation Rate</p>
                  <p className="text-2xl font-bold text-foreground mt-1">{automationRate}%</p>
                  <p className="text-xs text-muted-foreground mt-1">{emailSourcedCount} of {invoices.length} invoices</p>
                </div>
                <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Zap className="w-6 h-6 text-primary" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Avg Days to Payment</p>
                  <p className="text-2xl font-bold text-foreground mt-1">{avgProcessingTime} days</p>
                  <p className="text-xs text-muted-foreground mt-1">{processedWithDates.length} invoices processed</p>
                </div>
                <div className="w-12 h-12 rounded-lg bg-blue-500/10 flex items-center justify-center">
                  <TrendingUp className="w-6 h-6 text-blue-600" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Main Content Tabs */}
        <Tabs value={activeTab} onValueChange={(tab) => { if (tab === 'processing-queue') setStatusFilter('all'); setActiveTab(tab); }} className="space-y-4">
          <div className="flex items-center justify-between">
            <TabsList>
              {canViewTab('invoice-capture') && (
                <TabsTrigger value="invoice-capture">Invoice Capture</TabsTrigger>
              )}
              {canViewTab('all-invoices') && (
                <TabsTrigger value="all-invoices">All Invoices</TabsTrigger>
              )}
              {canViewTab('email-inbox') && (
                <TabsTrigger value="email-inbox">Email Inbox</TabsTrigger>
              )}
              {canViewTab('processing-queue') && (
                <TabsTrigger value="processing-queue">Processing Queue</TabsTrigger>
              )}
              {canViewTab('suppliers') && (
                <TabsTrigger value="suppliers">Suppliers</TabsTrigger>
              )}
              {canViewTab('analytics') && (
                <TabsTrigger value="analytics">Analytics</TabsTrigger>
              )}
            </TabsList>
            <span className="text-sm text-muted-foreground">
              {format(globalDateRange.startDate, 'd MMM yyyy')} – {format(globalDateRange.endDate, 'd MMM yyyy')}
            </span>
          </div>

          {/* Invoice Capture Tab */}
          <TabsContent value="invoice-capture" className="space-y-4">
            {/* Upload Area */}
            <Card>
              <CardContent className="pt-6">
                <div className="border-2 border-dashed border-border rounded-lg p-8 text-center hover:border-primary/50 transition-colors cursor-pointer">
                  <Upload className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-foreground mb-2">Upload Supplier Invoices</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Drag and drop PDF, image files or click to browse
                  </p>
                  <div className="flex items-center justify-center gap-4">
                    {can('accounts_payable', 'add', 'invoice_capture_tab') && (
                      <Button
                        variant="outline"
                        className="gap-2"
                        onClick={() => setUploadModalOpen(true)}
                      >
                        <FileText className="w-4 h-4" />
                        Browse Files
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Recent Captures */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">Recently Captured Invoices</CardTitle>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setActiveTab('invoices')}
                    className="gap-2"
                  >
                    <Eye className="w-4 h-4" />
                    View All
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {isLoading ? (
                    <div className="text-center py-8 text-muted-foreground">Loading invoices...</div>
                  ) : todayInvoices.length > 0 ? (
                    <>
                      {todayInvoices.slice((capturedPage - 1) * capturedItemsPerPage, capturedPage * capturedItemsPerPage).map((invoice) => (
                        <div key={invoice.id} className="flex items-center justify-between p-4 bg-muted/30 rounded-lg">
                          <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                              <FileText className="w-5 h-5 text-primary" />
                            </div>
                            <div>
                              <p className="font-medium text-foreground">
                                {invoice.invoice_number || invoice.pdf_path?.split('/').pop() || 'Invoice'}
                              </p>
                              <p className="text-sm text-muted-foreground">
                                Detected: {invoice.vendor_name || 'Unknown'} • {getCurrencySymbol(invoice.currency)}{(invoice.total_amount || 0).toLocaleString()}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-4">
                            <div className="text-right">
                              <p className="text-sm text-muted-foreground">
                                {new Date(invoice.created_at).toLocaleDateString()}
                              </p>
                              <p className={`text-xs ${(invoice.confidence_score || 0) >= 80 ? 'text-emerald-600' : 'text-amber-600'}`}>
                                {invoice.confidence_score || 0}% confidence
                              </p>
                            </div>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleReviewInvoice(invoice)}
                            >
                              Review
                            </Button>
                          </div>
                        </div>
                      ))}
                      {/* Pagination for Recently Captured Invoices */}
                      {todayInvoices.length > capturedItemsPerPage && (
                        <div className="flex items-center justify-between pt-4 border-t">
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-muted-foreground">Show</span>
                            <Select
                              value={capturedItemsPerPage.toString()}
                              onValueChange={(value) => {
                                setCapturedItemsPerPage(Number(value));
                                setCapturedPage(1);
                              }}
                            >
                              <SelectTrigger className="w-[70px] h-8">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="5">5</SelectItem>
                                <SelectItem value="10">10</SelectItem>
                                <SelectItem value="25">25</SelectItem>
                                <SelectItem value="50">50</SelectItem>
                              </SelectContent>
                            </Select>
                            <span className="text-sm text-muted-foreground">per page</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-muted-foreground">
                              {Math.min((capturedPage - 1) * capturedItemsPerPage + 1, todayInvoices.length)} - {Math.min(capturedPage * capturedItemsPerPage, todayInvoices.length)} of {todayInvoices.length}
                            </span>
                            <div className="flex gap-1">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setCapturedPage(Math.max(1, capturedPage - 1))}
                                disabled={capturedPage === 1}
                              >
                                Previous
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setCapturedPage(Math.min(Math.ceil(todayInvoices.length / capturedItemsPerPage), capturedPage + 1))}
                                disabled={capturedPage >= Math.ceil(todayInvoices.length / capturedItemsPerPage)}
                              >
                                Next
                              </Button>
                            </div>
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground">
                      <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
                      <p className="font-medium">No invoices captured today</p>
                      <p className="text-sm mt-1">Upload invoices to get started</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* All Invoices Tab */}
          <TabsContent value="all-invoices" className="space-y-4">
            <div className="flex gap-0 h-[calc(100vh-320px)]">
              {/* Folder Sidebar - collapsible */}
              <div className={cn(
                "flex-shrink-0 transition-all duration-300 h-full",
                folderSidebarCollapsed ? "w-12" : "w-64"
              )}>
                <Card className="h-full overflow-hidden">
                  {folderSidebarCollapsed ? (
                    <div className="flex flex-col items-center py-2 gap-1 h-full">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-gray-500 hover:text-indigo-600"
                            onClick={() => setFolderSidebarCollapsed(false)}
                          >
                            <PanelLeftOpen className="w-4 h-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="right"><p>Expand folders</p></TooltipContent>
                      </Tooltip>
                      <div className="w-8 border-t border-gray-200 my-1" />
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className={cn(
                              "h-8 w-8 rounded-md",
                              selectedFolderId === null ? "bg-indigo-100 text-indigo-600" : "text-gray-500 hover:text-indigo-600"
                            )}
                            onClick={() => setSelectedFolderId(null)}
                          >
                            <FileText className="w-4 h-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="right"><p>All Documents</p></TooltipContent>
                      </Tooltip>
                      {folderTree.filter(f => !f.parent_id).map((folder) => (
                        <Tooltip key={folder.id}>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className={cn(
                                "h-8 w-8 rounded-md",
                                selectedFolderId === folder.id ? "bg-indigo-100 text-indigo-600" : "text-gray-500 hover:text-indigo-600"
                              )}
                              onClick={() => setSelectedFolderId(folder.id)}
                            >
                              <Folder className="w-4 h-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="right"><p>{folder.name}</p></TooltipContent>
                        </Tooltip>
                      ))}
                    </div>
                  ) : (
                    <InvoiceFolderSidebar
                      folders={folders}
                      folderTree={folderTree}
                      selectedFolderId={selectedFolderId}
                      onSelectFolder={setSelectedFolderId}
                      onCreateFolder={apPermissions.canPerformAction('create_folder') ? () => {
                        setEditFolder(null);
                        setNewFolderModalOpen(true);
                      } : undefined}
                      onEditFolder={apPermissions.canPerformAction('edit_folder') ? handleEditFolder : undefined}
                      onDeleteFolder={apPermissions.canPerformAction('delete_folder') ? handleDeleteFolder : undefined}
                      totalAllInvoicesCount={invoices.length}
                      unassignedCount={unassignedCount}
                      folderInvoiceCounts={folderInvoiceCounts}
                      isLoading={isFoldersLoading}
                      selectedLocationId={selectedLocationId}
                      locations={locations}
                      onCollapse={() => setFolderSidebarCollapsed(true)}
                    />
                  )}
                </Card>
              </div>

              {/* Main Content Area */}
              <div className="flex-1 min-w-0 overflow-hidden">
                {viewMode === 'split' ? (
                  /* Split View: 3-Panel Resizable Layout */
                  <Card className="overflow-hidden h-full">
                    {/* Split View Header */}
                    <CardHeader className="py-3 px-4">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-lg">
                          {selectedFolderId
                            ? folders.find(f => f.id === selectedFolderId)?.name || 'Invoices'
                            : 'All Documents'}
                        </CardTitle>
                        <div className="flex items-center gap-2">
                          <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                            <Input
                              placeholder="Search invoices..."
                              className="pl-9 w-48"
                              value={searchTerm}
                              onChange={(e) => setSearchTerm(e.target.value)}
                            />
                          </div>
                          {/* View Mode Toggle */}
                          <div className="flex items-center border rounded-md">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant={viewMode === 'list' ? 'default' : 'ghost'}
                                  size="icon"
                                  className="h-8 w-8 rounded-r-none"
                                  onClick={() => { setViewMode('list'); setShareDrawerOpen(false); setShareInvoice(null); }}
                                >
                                  <List className="w-4 h-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent><p>List View</p></TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant={viewMode === 'split' ? 'default' : 'ghost'}
                                  size="icon"
                                  className="h-8 w-8 rounded-l-none"
                                  onClick={() => setViewMode('split')}
                                >
                                  <Columns3 className="w-4 h-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent><p>Split View</p></TooltipContent>
                            </Tooltip>
                          </div>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="p-0 h-[calc(100%-60px)]">
                      <ResizablePanelGroup direction="horizontal" className="h-full">
                        {/* Panel 1: Invoice List */}
                        <ResizablePanel defaultSize={25} minSize={15} maxSize={40}>
                          <div className="flex flex-col h-full border-r">
                            <div className="flex-1 overflow-y-auto">
                              {(() => {
                                const filteredInvoices = folderFilteredInvoices.filter(inv => {
                                  if (!matchesStatusFilter(inv, statusFilter)) return false;
                                  if (tagFilter !== 'all') {
                                    const invoiceTags = invoiceTagsMap[inv.id] || [];
                                    if (!invoiceTags.some(tag => tag.id === tagFilter)) return false;
                                  }
                                  const searchLower = searchTerm.toLowerCase();
                                  return (
                                    (inv.vendor_name?.toLowerCase() || '').includes(searchLower) ||
                                    (inv.invoice_number?.toLowerCase() || '').includes(searchLower) ||
                                    (inv.customer_name?.toLowerCase() || '').includes(searchLower)
                                  );
                                });

                                if (isLoading) {
                                  return <div className="p-4 text-center text-muted-foreground text-sm">Loading...</div>;
                                }

                                if (filteredInvoices.length === 0) {
                                  return <div className="p-4 text-center text-muted-foreground text-sm">No invoices found</div>;
                                }

                                return filteredInvoices.map((invoice) => (
                                  <div
                                    key={invoice.id}
                                    className={`p-3 border-b cursor-pointer hover:bg-muted/50 transition-colors ${
                                      shareInvoice?.id === invoice.id ? 'bg-primary/5 border-l-2 border-l-primary' : ''
                                    }`}
                                    onClick={() => handleShareInvoice(invoice)}
                                  >
                                    <div className="flex items-center justify-between">
                                      <span className="text-sm font-medium truncate max-w-[120px]">
                                        {invoice.vendor_name || 'Unknown'}
                                      </span>
                                      <span className="text-sm font-semibold">
                                        {getCurrencySymbol(invoice.currency)}{(invoice.total_amount || 0).toLocaleString()}
                                      </span>
                                    </div>
                                    <div className="flex items-center justify-between mt-1">
                                      <span className="text-xs text-muted-foreground truncate max-w-[100px]">
                                        #{invoice.invoice_number || invoice.id.slice(0, 8)}
                                      </span>
                                      <span className="text-xs text-muted-foreground">
                                        {invoice.invoice_date || '-'}
                                      </span>
                                    </div>
                                    <div className="mt-1">
                                      {getStatusBadge(invoice)}
                                    </div>
                                  </div>
                                ));
                              })()}
                            </div>
                          </div>
                        </ResizablePanel>

                        <ResizableHandle withHandle />

                        {/* Panel 2: PDF Viewer */}
                        <ResizablePanel defaultSize={20} minSize={10}>
                          <div className="flex flex-col h-full bg-muted/10">
                            <div className="p-3 border-b bg-muted/30">
                              <h3 className="text-sm font-semibold">Document Preview</h3>
                            </div>
                            <div className="flex-1 p-2">
                              {!shareInvoice ? (
                                <div className="h-full flex items-center justify-center">
                                  <div className="text-center">
                                    <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-50" />
                                    <p className="text-sm font-medium text-muted-foreground">Select an invoice to preview</p>
                                  </div>
                                </div>
                              ) : sharePdfLoading ? (
                                <div className="h-full flex items-center justify-center">
                                  <div className="text-center">
                                    <Loader2 className="w-8 h-8 animate-spin text-muted-foreground mx-auto mb-2" />
                                    <p className="text-sm text-muted-foreground">Loading PDF...</p>
                                  </div>
                                </div>
                              ) : sharePdfUrl ? (
                                <iframe
                                  src={`${sharePdfUrl}#toolbar=1&navpanes=0`}
                                  className="w-full h-full rounded border bg-white"
                                  title="Invoice PDF"
                                />
                              ) : (
                                <div className="h-full flex items-center justify-center">
                                  <div className="text-center">
                                    <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-50" />
                                    <p className="text-sm font-medium text-muted-foreground">
                                      {sharePdfNotFound ? 'PDF not available' : 'No document to preview'}
                                    </p>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        </ResizablePanel>

                        <ResizableHandle withHandle />

                        {/* Panel 3: Invoice Details Form */}
                        <ResizablePanel defaultSize={35} minSize={20} maxSize={50}>
                          <div className="h-full overflow-hidden">
                            {shareInvoice ? (
                              <InvoiceDetailsDrawer
                                open={shareDrawerOpen}
                                onOpenChange={setShareDrawerOpen}
                                invoice={shareInvoice}
                                onSave={() => {
                                  refetchInvoices();
                                }}
                                onSendToAccounting={() => {
                                  refetchInvoices();
                                }}
                                onTagsUpdate={fetchInvoiceTags}
                                selectedLocationId={selectedLocationId}
                                inline={true}
                                hidePdfToggle={true}
                                folders={folders}
                                onFolderAssign={moveInvoiceToFolder}
                              />
                            ) : (
                              <div className="h-full flex items-center justify-center">
                                <div className="text-center">
                                  <Eye className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-50" />
                                  <p className="text-sm font-medium text-muted-foreground">Select an invoice to view details</p>
                                </div>
                              </div>
                            )}
                          </div>
                        </ResizablePanel>
                      </ResizablePanelGroup>
                    </CardContent>
                  </Card>
                ) : (
                /* List View: Normal Table */
                <Card className="h-full flex flex-col overflow-hidden">
                  <CardHeader className="flex-shrink-0">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg">
                        {selectedFolderId
                          ? folders.find(f => f.id === selectedFolderId)?.name || 'Invoices'
                          : 'All Documents'}
                      </CardTitle>
                      <div className="flex items-center gap-2">
                        <Select value={tagFilter} onValueChange={setTagFilter}>
                          <SelectTrigger className="w-[180px]">
                            <SelectValue placeholder="Tags" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All Tags</SelectItem>
                            {filteredTags.map((tag) => (
                              <SelectItem key={tag.id} value={tag.id}>
                                <div className="flex items-center gap-2">
                                  <span
                                    className="w-2 h-2 rounded-full"
                                    style={{ backgroundColor: tag.color }}
                                  />
                                  {tag.name}
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select value={statusFilter} onValueChange={setStatusFilter}>
                          <SelectTrigger className="w-[180px]">
                            <SelectValue placeholder="Status" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All Status</SelectItem>
                            <SelectItem value="pending">Pending</SelectItem>
                            <SelectItem value="approved">Approved</SelectItem>
                            <SelectItem value="xero_draft">Draft (Sent to Xero)</SelectItem>
                            <SelectItem value="awaiting_approval_xero">Awaiting Approval</SelectItem>
                            <SelectItem value="awaiting_payment">Awaiting Payment</SelectItem>
                            <SelectItem value="paid">Paid</SelectItem>
                          </SelectContent>
                        </Select>
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                          <Input
                            placeholder="Search invoices..."
                            className="pl-9 w-64"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                          />
                        </div>
                        {can('accounts_payable', 'export', 'all_invoices_tab') && (
                          <Button variant="outline" size="sm" className="gap-2" onClick={handleExportInvoices}>
                            <Download className="w-4 h-4" />
                            Export
                          </Button>
                        )}
                        {/* View Mode Toggle */}
                        <div className="flex items-center border rounded-md">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant={viewMode === 'list' ? 'default' : 'ghost'}
                                size="icon"
                                className="h-8 w-8 rounded-r-none"
                                onClick={() => setViewMode('list')}
                              >
                                <List className="w-4 h-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent><p>List View</p></TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant={viewMode === 'split' ? 'default' : 'ghost'}
                                size="icon"
                                className="h-8 w-8 rounded-l-none"
                                onClick={() => setViewMode('split')}
                              >
                                <Columns3 className="w-4 h-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent><p>Split View</p></TooltipContent>
                          </Tooltip>
                        </div>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0 flex-1 min-h-0 overflow-auto [&>div]:!overflow-visible">
                    <Table className="w-full table-fixed min-w-[1000px] border-collapse [&_th]:px-2.5 [&_th]:py-2 [&_th]:h-auto [&_td]:px-2.5 [&_td]:py-1.5 [&_th]:border [&_th]:border-border [&_td]:border [&_td]:border-border [&_th]:bg-muted/40 [&_th]:text-xs [&_th]:font-semibold">
                      <colgroup>
                        <col style={{ width: '8%' }} />
                        <col style={{ width: '14%' }} />
                        <col style={{ width: '12%' }} />
                        {!selectedLocationId && <col style={{ width: '9%' }} />}
                        <col style={{ width: '6%' }} />
                        <col style={{ width: '10%' }} />
                        <col style={{ width: '7%' }} />
                        <col style={{ width: '9%' }} />
                        <col style={{ width: '8%' }} />
                        <col style={{ width: '12%' }} />
                        <col style={{ width: '9%' }} />
                      </colgroup>
                      <TableHeader className="sticky top-0 z-10">
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="bg-muted/90 backdrop-blur-sm">Invoice #</TableHead>
                          <TableHead className="bg-muted/90 backdrop-blur-sm">Vendor</TableHead>
                          <TableHead className="bg-muted/90 backdrop-blur-sm">Customer</TableHead>
                          {!selectedLocationId && <TableHead className="bg-muted/90 backdrop-blur-sm">Location</TableHead>}
                          <TableHead className="bg-muted/90 backdrop-blur-sm">Tags</TableHead>
                          <TableHead className="bg-muted/90 backdrop-blur-sm">Assign folder</TableHead>
                          <TableHead className="text-right bg-muted/90 backdrop-blur-sm">Amount</TableHead>
                          <TableHead className="bg-muted/90 backdrop-blur-sm">Invoice Date</TableHead>
                          <TableHead className="bg-muted/90 backdrop-blur-sm">Due Date</TableHead>
                          <TableHead className="text-center bg-muted/90 backdrop-blur-sm">Status</TableHead>
                          <TableHead className="text-center bg-muted/90 backdrop-blur-sm">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(() => {
                          // Apply filters
                          const filteredInvoices = folderFilteredInvoices.filter(inv => {
                            // Status filter
                            if (!matchesStatusFilter(inv, statusFilter)) {
                              return false;
                            }
                            // Tag filter
                            if (tagFilter !== 'all') {
                              const invoiceTags = invoiceTagsMap[inv.id] || [];
                              if (!invoiceTags.some(tag => tag.id === tagFilter)) {
                                return false;
                              }
                            }
                            // Search filter
                            const searchLower = searchTerm.toLowerCase();
                            const locationName = getLocationName(inv.location_id);
                            const amountStr = (inv.total_amount || 0).toString();
                            return (
                              (inv.vendor_name?.toLowerCase() || '').includes(searchLower) ||
                              (inv.invoice_number?.toLowerCase() || '').includes(searchLower) ||
                              (inv.customer_name?.toLowerCase() || '').includes(searchLower) ||
                              (locationName?.toLowerCase() || '').includes(searchLower) ||
                              amountStr.includes(searchLower)
                            );
                          });

                          // Pagination
                          const totalPages = Math.ceil(filteredInvoices.length / itemsPerPage);
                          const startIndex = (currentPage - 1) * itemsPerPage;
                          const paginatedInvoices = filteredInvoices.slice(startIndex, startIndex + itemsPerPage);

                          const columnCount = selectedLocationId ? 10 : 11; // Extra column for Location when All Locations

                          if (isLoading) {
                            return (
                              <TableRow>
                                <TableCell colSpan={columnCount} className="text-center py-8 text-muted-foreground">
                                  Loading invoices...
                                </TableCell>
                              </TableRow>
                            );
                          }

                          if (filteredInvoices.length === 0) {
                            return (
                              <TableRow>
                                <TableCell colSpan={columnCount} className="text-center py-8 text-muted-foreground">
                                  No invoices found
                                </TableCell>
                              </TableRow>
                            );
                          }

                          return paginatedInvoices.map((invoice) => (
                              <TableRow key={invoice.id} className="text-[13px]">
                                <TableCell className="font-medium">
                                  <span className="truncate block" title={invoice.invoice_number || invoice.id.slice(0, 8)}>
                                    {invoice.invoice_number || invoice.id.slice(0, 8)}
                                  </span>
                                </TableCell>
                                <TableCell>
                                  <span className="truncate block" title={invoice.vendor_name || 'Unknown'}>
                                    {invoice.vendor_name || 'Unknown'}
                                  </span>
                                </TableCell>
                                <TableCell>
                                  <span className="truncate block" title={invoice.customer_name || '-'}>
                                    {invoice.customer_name || '-'}
                                  </span>
                                </TableCell>
                                {!selectedLocationId && (
                                  <TableCell>
                                    <span className="truncate block" title={getLocationName(invoice.location_id)}>
                                      {getLocationName(invoice.location_id)}
                                    </span>
                                  </TableCell>
                                )}
                                <TableCell>
                                  {(() => {
                                    const tags = invoiceTagsMap[invoice.id] || [];
                                    const isExpanded = expandedTagsInvoices.has(invoice.id);
                                    const hasMoreTags = tags.length > 2;
                                    const displayTags = isExpanded ? tags : tags.slice(0, 2);

                                    if (tags.length === 0) {
                                      return <span className="text-xs text-muted-foreground">-</span>;
                                    }

                                    return (
                                      <div className={`flex flex-wrap items-start gap-1 ${isExpanded ? 'max-w-[200px]' : 'max-w-[100px]'}`}>
                                        {displayTags.map((tag) => (
                                          <span
                                            key={tag.id}
                                            className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-indigo-50 text-indigo-700 border border-indigo-200 truncate max-w-[90px]"
                                            title={tag.name}
                                          >
                                            {tag.name}
                                          </span>
                                        ))}
                                        {hasMoreTags && (
                                          <span
                                            className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-600 cursor-pointer hover:bg-gray-200 transition-colors"
                                            title={isExpanded ? 'Show less' : tags.slice(2).map(t => t.name).join(', ')}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              toggleExpandedTags(invoice.id);
                                            }}
                                          >
                                            {isExpanded ? '-' : `+${tags.length - 2}`}
                                          </span>
                                        )}
                                      </div>
                                    );
                                  })()}
                                </TableCell>
                                <TableCell>
                                  <FolderAssignCell
                                    invoice={invoice}
                                    folders={folders}
                                  />
                                </TableCell>
                                <TableCell className="text-right font-medium">
                                  {getCurrencySymbol(invoice.currency)}{(invoice.total_amount || 0).toLocaleString()}
                                </TableCell>
                                <TableCell>
                                  {invoice.invoice_date || '-'}
                                </TableCell>
                                <TableCell>
                                  {invoice.due_date || '-'}
                                </TableCell>
                                <TableCell className="text-center">{getStatusBadge(invoice)}</TableCell>
                                <TableCell className="text-center whitespace-nowrap">
                                  <div className="flex items-center justify-center gap-0">
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-6 w-6"
                                          onClick={() => handleViewPdf(invoice)}
                                        >
                                          <Eye className="w-3 h-3" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        <p>View PDF</p>
                                      </TooltipContent>
                                    </Tooltip>
                                    {can('accounts_payable', 'action', 'all_invoices_tab') && invoice.status !== 'approved' && invoice.status !== 'paid' && (
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-6 w-6 text-emerald-600"
                                            onClick={() => setApproveConfirmInvoice(invoice)}
                                          >
                                            <CheckCircle className="w-3 h-3" />
                                          </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                          <p>Approve</p>
                                        </TooltipContent>
                                      </Tooltip>
                                    )}
                                    {can('accounts_payable', 'action', 'all_invoices_tab') && (invoice.status === 'approved' || invoice.status === 'paid' || invoice.platform_status === 'PAID') && (
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-6 w-6 text-blue-600"
                                            onClick={() => handleShareInvoice(invoice)}
                                          >
                                            <Send className="w-3 h-3" />
                                          </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                          <p>{invoice.status === 'paid' || invoice.platform_status === 'PAID' ? 'View Invoice (Paid)' : 'Share Invoice'}</p>
                                        </TooltipContent>
                                      </Tooltip>
                                    )}
                                    {invoice.platform_invoice_id && invoice.platform_name === 'xero' && (
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-6 w-6 text-emerald-700"
                                            onClick={() => window.open(`https://go.xero.com/AccountsPayable/View.aspx?InvoiceID=${invoice.platform_invoice_id}`, '_blank')}
                                          >
                                            <ExternalLink className="w-3 h-3" />
                                          </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                          <p>View Bill in Xero</p>
                                        </TooltipContent>
                                      </Tooltip>
                                    )}
                                  </div>
                                </TableCell>
                              </TableRow>
                            ));
                        })()}
                      </TableBody>
                    </Table>
                  </CardContent>

                  {/* Pagination - fixed at bottom */}
                  {(() => {
                      const filteredInvoices = folderFilteredInvoices.filter(inv => {
                        // Status filter
                        if (!matchesStatusFilter(inv, statusFilter)) return false;
                        // Tag filter
                        if (tagFilter !== 'all') {
                          const invoiceTags = invoiceTagsMap[inv.id] || [];
                          if (!invoiceTags.some(tag => tag.id === tagFilter)) {
                            return false;
                          }
                        }
                        // Search filter
                        const searchLower = searchTerm.toLowerCase();
                        const locationName = getLocationName(inv.location_id);
                        const amountStr = (inv.total_amount || 0).toString();
                        return (
                          (inv.vendor_name?.toLowerCase() || '').includes(searchLower) ||
                          (inv.invoice_number?.toLowerCase() || '').includes(searchLower) ||
                          (inv.customer_name?.toLowerCase() || '').includes(searchLower) ||
                          (locationName?.toLowerCase() || '').includes(searchLower) ||
                          amountStr.includes(searchLower)
                        );
                      });
                      const totalPages = Math.ceil(filteredInvoices.length / itemsPerPage);
                      const startIndex = (currentPage - 1) * itemsPerPage;
                      const endIndex = Math.min(startIndex + itemsPerPage, filteredInvoices.length);

                      if (filteredInvoices.length === 0) return null;

                      // Generate page numbers to display
                      const getPageNumbers = () => {
                        const pages: (number | string)[] = [];
                        if (totalPages <= 7) {
                          for (let i = 1; i <= totalPages; i++) pages.push(i);
                        } else {
                          if (currentPage <= 3) {
                            pages.push(1, 2, 3, '...', totalPages);
                          } else if (currentPage >= totalPages - 2) {
                            pages.push(1, '...', totalPages - 2, totalPages - 1, totalPages);
                          } else {
                            pages.push(1, '...', currentPage - 1, currentPage, currentPage + 1, '...', totalPages);
                          }
                        }
                        return pages;
                      };

                      return (
                        <div className="flex items-center justify-between px-4 py-3 border-t flex-shrink-0 bg-background">
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <span>Showing {startIndex + 1} to {endIndex} of {filteredInvoices.length} invoices</span>
                            <Select value={String(itemsPerPage)} onValueChange={(v) => { setItemsPerPage(Number(v)); setCurrentPage(1); }}>
                              <SelectTrigger className="w-[70px] h-8">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="10">10</SelectItem>
                                <SelectItem value="20">20</SelectItem>
                                <SelectItem value="50">50</SelectItem>
                                <SelectItem value="100">100</SelectItem>
                              </SelectContent>
                            </Select>
                            <span>per page</span>
                          </div>
                          <div className="flex items-center gap-1">
                            {/* Previous Button */}
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                              disabled={currentPage === 1}
                            >
                              <span className="text-lg">‹</span>
                            </Button>

                            {/* Page Numbers */}
                            {getPageNumbers().map((page, idx) => (
                              page === '...' ? (
                                <span key={`ellipsis-${idx}`} className="px-2 text-muted-foreground">...</span>
                              ) : (
                                <Button
                                  key={page}
                                  variant={currentPage === page ? 'default' : 'outline'}
                                  size="icon"
                                  className={`h-8 w-8 ${currentPage === page ? 'bg-primary text-primary-foreground' : ''}`}
                                  onClick={() => setCurrentPage(page as number)}
                                >
                                  {page}
                                </Button>
                              )
                            ))}

                            {/* Next Button */}
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                              disabled={currentPage === totalPages}
                            >
                              <span className="text-lg">›</span>
                            </Button>
                          </div>
                        </div>
                      );
                    })()}
                </Card>
                )}
              </div>
            </div>
          </TabsContent>

          {/* Index Tab - Inbound Emails */}
          <TabsContent value="email-inbox" className="space-y-4">
            <div className="flex gap-4 h-[calc(100vh-320px)]">
              {/* Email List - Left Side */}
              <Card className="w-[380px] flex-shrink-0 flex flex-col overflow-hidden">
                {/* All Button & Search */}
                <div className="p-3 border-b border-border">
                  <div className="flex items-center gap-2 mb-3">
                    <Button
                      variant="default"
                      size="sm"
                      className="bg-indigo-600 hover:bg-indigo-700"
                    >
                      All
                    </Button>
                    <div className="relative flex-1">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        placeholder="Search..."
                        className="pl-9 h-8"
                        value={emailSearchTerm}
                        onChange={(e) => setEmailSearchTerm(e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                {/* Email List */}
                <div className="flex-1 overflow-y-auto">
                  {isLoadingEmails ? (
                    <div className="text-center py-8 text-muted-foreground">Loading emails...</div>
                  ) : inboundEmails.length > 0 ? (
                    <div>
                      {(() => {
                        // Filter emails by search term
                        const filteredEmails = inboundEmails.filter(email =>
                          (email.subject?.toLowerCase() || '').includes(emailSearchTerm.toLowerCase()) ||
                          (email.from_email?.toLowerCase() || '').includes(emailSearchTerm.toLowerCase())
                        );

                        // Toggle location expand/collapse (accordion behavior - only one open at a time)
                        const toggleLocationExpand = (locId: string) => {
                          setExpandedEmailLocations((prev) => {
                            const next = new Set<string>();
                            // If clicking on already expanded location, collapse it
                            // Otherwise, expand only the clicked location (close others)
                            if (!prev.has(locId)) {
                              next.add(locId);
                            }
                            return next;
                          });
                        };

                        // When All Locations is selected, group emails by location
                        if (!selectedLocationId) {
                          // Group emails by location_id
                          const emailsByLocation = filteredEmails.reduce((acc, email) => {
                            const locId = email.location_id || 'unassigned';
                            if (!acc[locId]) {
                              acc[locId] = [];
                            }
                            acc[locId].push(email);
                            return acc;
                          }, {} as Record<string, typeof filteredEmails>);

                          // Sort location IDs by location name
                          const sortedLocationIds = Object.keys(emailsByLocation).sort((a, b) => {
                            if (a === 'unassigned') return 1;
                            if (b === 'unassigned') return -1;
                            return getLocationName(a).localeCompare(getLocationName(b));
                          });

                          return sortedLocationIds.map((locId) => {
                            const isExpanded = expandedEmailLocations.has(locId);
                            return (
                              <div key={locId}>
                                {/* Location Header - Clickable to toggle */}
                                <div
                                  className="flex items-center gap-2 px-3 py-2.5 cursor-pointer transition-colors hover:bg-gray-50"
                                  onClick={() => toggleLocationExpand(locId)}
                                >
                                  {isExpanded ? (
                                    <ChevronDown className="w-4 h-4 text-indigo-600" />
                                  ) : (
                                    <ChevronRight className="w-4 h-4 text-gray-400" />
                                  )}
                                  <span className={`text-sm font-medium flex-1 uppercase tracking-wide ${
                                    isExpanded ? 'text-indigo-700' : 'text-gray-600'
                                  }`}>
                                    {locId === 'unassigned' ? 'Unassigned' : getLocationName(locId)}
                                  </span>
                                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                                    isExpanded
                                      ? 'bg-indigo-200 text-indigo-700'
                                      : 'bg-gray-200 text-gray-600'
                                  }`}>
                                    {emailsByLocation[locId].length}
                                  </span>
                                </div>
                                {/* Emails for this location - Only show when expanded */}
                                {isExpanded && (
                                  <div className="divide-y divide-border">
                                    {emailsByLocation[locId].map((email) => (
                                      <div
                                        key={email.id}
                                        className={`flex items-start gap-3 p-3 pl-8 cursor-pointer transition-colors hover:bg-muted/50 border-l-4 ${
                                          selectedEmail?.id === email.id
                                            ? 'bg-indigo-50 border-l-indigo-600'
                                            : 'border-l-transparent'
                                        }`}
                                        onClick={() => setSelectedEmail(email)}
                                      >
                                        <div className="w-10 h-10 rounded-lg bg-teal-500 flex items-center justify-center flex-shrink-0 mt-1">
                                          <Mail className="w-5 h-5 text-white" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                          <p className="font-semibold text-foreground truncate text-sm">
                                            {email.subject || '(No Subject)'}
                                          </p>
                                          <p className="text-sm text-muted-foreground truncate">
                                            From: {email.from_email || '-'}
                                          </p>
                                          <p className="text-xs text-muted-foreground mt-1">
                                            {email.created_at
                                              ? new Date(email.created_at).toLocaleString('en-GB', {
                                                  day: '2-digit',
                                                  month: 'short',
                                                  year: 'numeric',
                                                  hour: '2-digit',
                                                  minute: '2-digit',
                                                })
                                              : '-'}
                                          </p>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          });
                        }

                        // When specific location is selected, show flat list
                        return (
                          <div className="divide-y divide-border">
                            {filteredEmails.map((email) => (
                              <div
                                key={email.id}
                                className={`flex items-start gap-3 p-3 cursor-pointer transition-colors hover:bg-muted/50 border-l-4 ${
                                  selectedEmail?.id === email.id
                                    ? 'bg-indigo-50 border-l-indigo-600'
                                    : 'border-l-transparent'
                                }`}
                                onClick={() => setSelectedEmail(email)}
                              >
                                <div className="w-10 h-10 rounded-lg bg-teal-500 flex items-center justify-center flex-shrink-0 mt-1">
                                  <Mail className="w-5 h-5 text-white" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="font-semibold text-foreground truncate text-sm">
                                    {email.subject || '(No Subject)'}
                                  </p>
                                  <p className="text-sm text-muted-foreground truncate">
                                    From: {email.from_email || '-'}
                                  </p>
                                  <p className="text-xs text-muted-foreground mt-1">
                                    {email.created_at
                                      ? new Date(email.created_at).toLocaleString('en-GB', {
                                          day: '2-digit',
                                          month: 'short',
                                          year: 'numeric',
                                          hour: '2-digit',
                                          minute: '2-digit',
                                        })
                                      : '-'}
                                  </p>
                                </div>
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  ) : (
                    <div className="text-center py-12 text-muted-foreground">
                      <Mail className="w-12 h-12 mx-auto mb-4 opacity-50" />
                      <p className="font-medium">No emails yet</p>
                    </div>
                  )}
                </div>
              </Card>

              {/* Email Details - Right Side */}
              <Card className="flex-1 overflow-hidden">
                <CardHeader className="border-b border-border pb-4">
                  <CardTitle className="text-lg">Email Details</CardTitle>
                </CardHeader>
                <CardContent className="p-6 overflow-y-auto h-[calc(100%-70px)]">
                  {selectedEmail ? (
                    <div className="space-y-2">
                      {/* Subject */}
                      <h2 className="text-xl font-semibold text-foreground">
                        {selectedEmail.subject || '(No Subject)'}
                      </h2>

                      {/* From */}
                      <div>
                        <span className="font-semibold text-foreground">From: </span>
                        <span className="text-foreground">{selectedEmail.from_email || '-'}</span>
                      </div>

                      {/* To */}
                      <div>
                        <span className="font-semibold text-foreground">To: </span>
                        <span className="text-foreground">{selectedEmail.to_email || '-'}</span>
                      </div>

                      {/* Date */}
                      <div>
                        <span className="font-semibold text-foreground">Date: </span>
                        <span className="text-foreground">
                          {selectedEmail.created_at
                            ? new Date(selectedEmail.created_at).toLocaleString('en-GB', {
                                day: '2-digit',
                                month: 'short',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })
                            : '-'}
                        </span>
                      </div>

                      {/* Message */}
                      <div>
                        <h3 className="font-semibold text-foreground mb-2">Message</h3>
                        <div className="border border-border rounded-md p-4 min-h-[100px] bg-muted/20">
                          {selectedEmail.text_body || selectedEmail.html_body ? (
                            <div
                              className="text-sm text-foreground whitespace-pre-wrap"
                              dangerouslySetInnerHTML={{
                                __html: selectedEmail.html_body || selectedEmail.text_body || ''
                              }}
                            />
                          ) : (
                            <span className="text-muted-foreground text-sm">No message content</span>
                          )}
                        </div>
                      </div>

                      {/* Attachments */}
                      <div>
                        <h3 className="font-semibold text-foreground mb-2">Attachments</h3>
                        {selectedEmail.inbound_email_attachments && selectedEmail.inbound_email_attachments.length > 0 ? (
                          <div className="space-y-2">
                            {selectedEmail.inbound_email_attachments.map((attachment: any) => (
                              <div key={attachment.id} className="flex items-center gap-3 flex-wrap">
                                <Paperclip className="w-4 h-4 text-muted-foreground" />
                                <span className="text-sm text-foreground">{attachment.filename}</span>
                                <Button
                                  variant="link"
                                  size="sm"
                                  className="text-indigo-600 p-0 h-auto"
                                  disabled={downloadingAttachment === attachment.id}
                                  onClick={() => handleViewAttachment(attachment)}
                                >
                                  {downloadingAttachment === attachment.id ? 'Loading...' : 'View'}
                                </Button>
                                {/* Extract Invoice button - show only for PDFs without existing invoice */}
                                {attachment.is_invoice_pdf && !attachment.invoice_id && (
                                  <Button
                                    variant="link"
                                    size="sm"
                                    className="text-amber-600 p-0 h-auto gap-1"
                                    disabled={extractingAttachment === attachment.id}
                                    onClick={() => handleExtractInvoice(attachment)}
                                  >
                                    {extractingAttachment === attachment.id ? (
                                      <>
                                        <Loader2 className="w-3 h-3 animate-spin" />
                                        Extracting...
                                      </>
                                    ) : (
                                      <>
                                        <FileSearch className="w-3 h-3" />
                                        Extract Invoice
                                      </>
                                    )}
                                  </Button>
                                )}
                                {/* Show extracted status if invoice exists */}
                                {attachment.is_invoice_pdf && attachment.invoice_id && (
                                  <span className="flex items-center gap-1 text-sm">
                                    <CheckCircle className="w-4 h-4 text-emerald-600" />
                                    <span className="text-emerald-600">Extracted</span>
                                    <span className="text-muted-foreground">—</span>
                                    <Button
                                      variant="link"
                                      size="sm"
                                      className="text-emerald-600 p-0 h-auto"
                                      onClick={() => {
                                        // Navigate to the invoice in All Invoices tab
                                        setActiveTab('invoices');
                                        // Could also open invoice detail modal if needed
                                      }}
                                    >
                                      View Invoice
                                    </Button>
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-sm">No attachments</span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-full text-muted-foreground">
                      <div className="text-center">
                        <Mail className="w-16 h-16 mx-auto mb-4 opacity-30" />
                        <p className="text-lg font-medium">Select an email to view details</p>
                        <p className="text-sm mt-1">Click on an email from the list to see its content</p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Processing Queue Tab */}
          <TabsContent value="processing-queue" className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">Invoice Processing Queue</CardTitle>
                  <div className="flex items-center gap-2">
                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                      <SelectTrigger className="w-[180px]">
                        <SelectValue placeholder="Status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Status</SelectItem>
                        <SelectItem value="pending">Pending</SelectItem>
                        <SelectItem value="approved">Approved</SelectItem>
                        <SelectItem value="xero_draft">Draft (Sent to Xero)</SelectItem>
                        <SelectItem value="awaiting_approval_xero">Awaiting Approval</SelectItem>
                        <SelectItem value="awaiting_payment">Awaiting Payment</SelectItem>
                        <SelectItem value="paid">Paid</SelectItem>
                      </SelectContent>
                    </Select>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        placeholder="Search invoices..."
                        className="pl-9 w-64"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invoice ID</TableHead>
                      <TableHead>Supplier</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Due Date</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Confidence</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(() => {
                      const queueTotalPages = Math.ceil(filteredPending.length / queueItemsPerPage);
                      const queueStartIndex = (queuePage - 1) * queueItemsPerPage;
                      const paginatedQueue = filteredPending.slice(queueStartIndex, queueStartIndex + queueItemsPerPage);

                      if (isLoading) {
                        return (
                          <TableRow>
                            <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                              Loading invoices...
                            </TableCell>
                          </TableRow>
                        );
                      }

                      if (filteredPending.length === 0) {
                        return (
                          <TableRow>
                            <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                              No invoices in processing queue
                            </TableCell>
                          </TableRow>
                        );
                      }

                      return paginatedQueue.map((invoice) => (
                        <TableRow key={invoice.id}>
                          <TableCell className="font-medium">{invoice.invoice_number || invoice.id.slice(0, 8)}</TableCell>
                          <TableCell>{invoice.vendor_name || 'Unknown'}</TableCell>
                          <TableCell>
                            {invoice.account ? <Badge variant="outline">{invoice.account}</Badge> : '-'}
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {getCurrencySymbol(invoice.currency)}{(invoice.total_amount || 0).toLocaleString()}
                          </TableCell>
                          <TableCell>{invoice.due_date || '-'}</TableCell>
                          <TableCell>{getStatusBadge(invoice)}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <div className={`w-2 h-2 rounded-full ${(invoice.confidence_score || 0) >= 95 ? 'bg-emerald-500' : (invoice.confidence_score || 0) >= 85 ? 'bg-amber-500' : 'bg-red-500'}`} />
                              <span className="text-sm">{invoice.confidence_score || 0}%</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              {can('accounts_payable', 'action', 'processing_queue_tab') && (
                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleViewInvoiceDetail(invoice)}>
                                  <Edit className="w-4 h-4" />
                                </Button>
                              )}
                              {can('accounts_payable', 'action', 'processing_queue_tab') && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-emerald-600"
                                  onClick={() => setApproveConfirmInvoice(invoice)}
                                >
                                  <CheckCircle className="w-4 h-4" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ));
                    })()}
                  </TableBody>
                </Table>
                {/* Queue Pagination */}
                {filteredPending.length > 0 && (
                  <div className="flex items-center justify-between px-4 py-4 border-t">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <span>Showing {((queuePage - 1) * queueItemsPerPage) + 1} to {Math.min(queuePage * queueItemsPerPage, filteredPending.length)} of {filteredPending.length} invoices</span>
                      <Select value={String(queueItemsPerPage)} onValueChange={(v) => { setQueueItemsPerPage(Number(v)); setQueuePage(1); }}>
                        <SelectTrigger className="w-[70px] h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="10">10</SelectItem>
                          <SelectItem value="20">20</SelectItem>
                          <SelectItem value="50">50</SelectItem>
                        </SelectContent>
                      </Select>
                      <span>per page</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => setQueuePage(p => Math.max(1, p - 1))}
                        disabled={queuePage === 1}
                      >
                        <span className="text-lg">‹</span>
                      </Button>
                      {(() => {
                        const totalPages = Math.ceil(filteredPending.length / queueItemsPerPage);
                        const pages: (number | string)[] = [];
                        if (totalPages <= 5) {
                          for (let i = 1; i <= totalPages; i++) pages.push(i);
                        } else {
                          if (queuePage <= 3) {
                            pages.push(1, 2, 3, '...', totalPages);
                          } else if (queuePage >= totalPages - 2) {
                            pages.push(1, '...', totalPages - 2, totalPages - 1, totalPages);
                          } else {
                            pages.push(1, '...', queuePage, '...', totalPages);
                          }
                        }
                        return pages.map((page, idx) => (
                          page === '...' ? (
                            <span key={`ellipsis-${idx}`} className="px-2 text-muted-foreground">...</span>
                          ) : (
                            <Button
                              key={page}
                              variant={queuePage === page ? 'default' : 'outline'}
                              size="icon"
                              className={`h-8 w-8 ${queuePage === page ? 'bg-primary text-primary-foreground' : ''}`}
                              onClick={() => setQueuePage(page as number)}
                            >
                              {page}
                            </Button>
                          )
                        ));
                      })()}
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => setQueuePage(p => Math.min(Math.ceil(filteredPending.length / queueItemsPerPage), p + 1))}
                        disabled={queuePage === Math.ceil(filteredPending.length / queueItemsPerPage)}
                      >
                        <span className="text-lg">›</span>
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Processed Invoices */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">Recently Processed</CardTitle>
                  {apPermissions.canPerformAction('export_invoices') && (
                    <Button variant="outline" size="sm" className="gap-2" onClick={handleExportProcessedInvoices}>
                      <Download className="w-4 h-4" />
                      Export
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invoice ID</TableHead>
                      <TableHead>Supplier</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Processed</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(() => {
                      const processedStartIndex = (processedPage - 1) * processedItemsPerPage;
                      const paginatedProcessed = processedInvoicesFromDB.slice(processedStartIndex, processedStartIndex + processedItemsPerPage);

                      if (isLoading) {
                        return (
                          <TableRow>
                            <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                              Loading invoices...
                            </TableCell>
                          </TableRow>
                        );
                      }

                      if (processedInvoicesFromDB.length === 0) {
                        return (
                          <TableRow>
                            <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                              No processed invoices yet
                            </TableCell>
                          </TableRow>
                        );
                      }

                      return paginatedProcessed.map((invoice) => (
                        <TableRow key={invoice.id}>
                          <TableCell className="font-medium">{invoice.invoice_number || invoice.id.slice(0, 8)}</TableCell>
                          <TableCell>{invoice.vendor_name || 'Unknown'}</TableCell>
                          <TableCell>
                            {invoice.account ? <Badge variant="outline">{invoice.account}</Badge> : '-'}
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {getCurrencySymbol(invoice.currency)}{(invoice.total_amount || 0).toLocaleString()}
                          </TableCell>
                          <TableCell>{invoice.updated_at ? new Date(invoice.updated_at).toLocaleDateString() : '-'}</TableCell>
                          <TableCell>{getStatusBadge(invoice)}</TableCell>
                        </TableRow>
                      ));
                    })()}
                  </TableBody>
                </Table>
                {/* Processed Pagination */}
                {processedInvoicesFromDB.length > 0 && (
                  <div className="flex items-center justify-between px-4 py-4 border-t">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <span>Showing {((processedPage - 1) * processedItemsPerPage) + 1} to {Math.min(processedPage * processedItemsPerPage, processedInvoicesFromDB.length)} of {processedInvoicesFromDB.length} invoices</span>
                      <Select value={String(processedItemsPerPage)} onValueChange={(v) => { setProcessedItemsPerPage(Number(v)); setProcessedPage(1); }}>
                        <SelectTrigger className="w-[70px] h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="10">10</SelectItem>
                          <SelectItem value="20">20</SelectItem>
                          <SelectItem value="50">50</SelectItem>
                        </SelectContent>
                      </Select>
                      <span>per page</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => setProcessedPage(p => Math.max(1, p - 1))}
                        disabled={processedPage === 1}
                      >
                        <span className="text-lg">‹</span>
                      </Button>
                      {(() => {
                        const totalPages = Math.ceil(processedInvoicesFromDB.length / processedItemsPerPage);
                        const pages: (number | string)[] = [];
                        if (totalPages <= 5) {
                          for (let i = 1; i <= totalPages; i++) pages.push(i);
                        } else {
                          if (processedPage <= 3) {
                            pages.push(1, 2, 3, '...', totalPages);
                          } else if (processedPage >= totalPages - 2) {
                            pages.push(1, '...', totalPages - 2, totalPages - 1, totalPages);
                          } else {
                            pages.push(1, '...', processedPage, '...', totalPages);
                          }
                        }
                        return pages.map((page, idx) => (
                          page === '...' ? (
                            <span key={`ellipsis-${idx}`} className="px-2 text-muted-foreground">...</span>
                          ) : (
                            <Button
                              key={page}
                              variant={processedPage === page ? 'default' : 'outline'}
                              size="icon"
                              className={`h-8 w-8 ${processedPage === page ? 'bg-primary text-primary-foreground' : ''}`}
                              onClick={() => setProcessedPage(page as number)}
                            >
                              {page}
                            </Button>
                          )
                        ));
                      })()}
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => setProcessedPage(p => Math.min(Math.ceil(processedInvoicesFromDB.length / processedItemsPerPage), p + 1))}
                        disabled={processedPage === Math.ceil(processedInvoicesFromDB.length / processedItemsPerPage)}
                      >
                        <span className="text-lg">›</span>
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Suppliers Tab */}
          <TabsContent value="suppliers" className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="text-lg">Spend by Supplier</CardTitle>
                  <ChartDateFilter
                    filter={supplierFilter}
                    onFilterChange={setSupplierFilter}
                    customRange={supplierCustomRange}
                    onCustomRangeChange={setSupplierCustomRange}
                  />
                </CardHeader>
                <CardContent>
                  <div className="h-[300px]">
                    {(isSupplierLoading || isSupplierFetching || supplierData === undefined) ? (
                      <div className="flex items-center justify-center h-full">
                        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                      </div>
                    ) : isSupplierError ? (
                      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                        <AlertCircle className="w-12 h-12 mb-2 opacity-50 text-red-500" />
                        <p>Failed to load supplier data</p>
                      </div>
                    ) : supplierBreakdown.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                        <Building2 className="w-12 h-12 mb-2 opacity-50" />
                        <p>No supplier data available</p>
                        <p className="text-sm">Upload invoices to see supplier breakdown</p>
                      </div>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={supplierBreakdown}
                            cx="30%"
                            cy="50%"
                            innerRadius={50}
                            outerRadius={85}
                            paddingAngle={2}
                            dataKey="value"
                            label={false}
                          >
                            {supplierBreakdown.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={entry.color} />
                            ))}
                          </Pie>
                          <RechartsTooltip formatter={(value: number) => `£${value.toLocaleString()}`} />
                          <Legend
                            layout="vertical"
                            align="right"
                            verticalAlign="middle"
                            iconType="square"
                            iconSize={10}
                            wrapperStyle={{ right: 0, paddingLeft: '10px' }}
                            formatter={(value: string) => {
                              const item = supplierBreakdown.find(s => s.name === value);
                              const total = supplierBreakdown.reduce((sum, s) => sum + s.value, 0);
                              const percent = item ? ((item.value / total) * 100).toFixed(0) : 0;
                              return <span style={{ color: 'hsl(var(--foreground))', fontSize: '13px' }}>{value} ({percent}%)</span>;
                            }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="text-lg">Top Suppliers</CardTitle>
                  <ChartDateFilter
                    filter={topSuppliersFilter}
                    onFilterChange={setTopSuppliersFilter}
                    customRange={topSuppliersCustomRange}
                    onCustomRangeChange={setTopSuppliersCustomRange}
                  />
                </CardHeader>
                <CardContent>
                  <div className="space-y-4 max-h-[300px] overflow-y-auto">
                    {(isTopSuppliersLoading || isTopSuppliersFetching || topSuppliersData === undefined) ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                      </div>
                    ) : isTopSuppliersError ? (
                      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                        <AlertCircle className="w-12 h-12 mb-2 opacity-50 text-red-500" />
                        <p>Failed to load suppliers</p>
                      </div>
                    ) : topSuppliers.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                        <Building2 className="w-12 h-12 mb-2 opacity-50" />
                        <p>No suppliers found</p>
                        <p className="text-sm">Upload invoices to see top suppliers</p>
                      </div>
                    ) : (
                      <>
                        {topSuppliers.slice((suppliersPage - 1) * suppliersItemsPerPage, suppliersPage * suppliersItemsPerPage).map((supplier, idx) => (
                          <div key={idx} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                                <Building2 className="w-5 h-5 text-primary" />
                              </div>
                              <div>
                                <p className="font-medium text-foreground">{supplier.name}</p>
                                <p className="text-sm text-muted-foreground">{supplier.invoices} invoices</p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="font-semibold text-foreground">£{supplier.spend.toLocaleString()}</p>
                              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                                {supplier.status}
                              </Badge>
                            </div>
                          </div>
                        ))}
                        {/* Pagination for Top Suppliers */}
                        {topSuppliers.length > suppliersItemsPerPage && (
                          <div className="flex items-center justify-between pt-4 border-t">
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-muted-foreground">Show</span>
                              <Select
                                value={suppliersItemsPerPage.toString()}
                                onValueChange={(value) => {
                                  setSuppliersItemsPerPage(Number(value));
                                  setSuppliersPage(1);
                                }}
                              >
                                <SelectTrigger className="w-[70px] h-8">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="5">5</SelectItem>
                                  <SelectItem value="10">10</SelectItem>
                                  <SelectItem value="25">25</SelectItem>
                                  <SelectItem value="50">50</SelectItem>
                                </SelectContent>
                              </Select>
                              <span className="text-sm text-muted-foreground">per page</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-muted-foreground">
                                {Math.min((suppliersPage - 1) * suppliersItemsPerPage + 1, topSuppliers.length)} - {Math.min(suppliersPage * suppliersItemsPerPage, topSuppliers.length)} of {topSuppliers.length}
                              </span>
                              <div className="flex gap-1">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setSuppliersPage(Math.max(1, suppliersPage - 1))}
                                  disabled={suppliersPage === 1}
                                >
                                  Previous
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setSuppliersPage(Math.min(Math.ceil(topSuppliers.length / suppliersItemsPerPage), suppliersPage + 1))}
                                  disabled={suppliersPage >= Math.ceil(topSuppliers.length / suppliersItemsPerPage)}
                                >
                                  Next
                                </Button>
                              </div>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Analytics Tab */}
          <TabsContent value="analytics" className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-lg">Monthly Invoice Volume</CardTitle>
                  <ChartDateFilter
                    filter={chartFilter}
                    onFilterChange={setChartFilter}
                    customRange={chartCustomRange}
                    onCustomRangeChange={setChartCustomRange}
                  />
                </CardHeader>
                <CardContent>
                  <div className="h-[300px]">
                    {(isChartLoading || isChartFetching || chartData === undefined) ? (
                      <div className="flex items-center justify-center h-full">
                        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                      </div>
                    ) : isChartError ? (
                      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                        <AlertCircle className="w-12 h-12 mb-2 opacity-50 text-red-500" />
                        <p>Failed to load chart data</p>
                        <p className="text-sm">Please try again later</p>
                      </div>
                    ) : monthlyVolume.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                        <FileText className="w-12 h-12 mb-2 opacity-50" />
                        <p>No invoice data available</p>
                        <p className="text-sm">Upload invoices to see monthly volume</p>
                      </div>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={monthlyVolume}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                          <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                          <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                          <RechartsTooltip
                            contentStyle={{
                              backgroundColor: 'hsl(var(--card))',
                              border: '1px solid hsl(var(--border))',
                              borderRadius: '8px',
                            }}
                            formatter={(value: number, name: string) => [
                              name === 'invoices' ? value : `£${value.toLocaleString()}`,
                              name === 'invoices' ? 'Invoices' : 'Amount'
                            ]}
                          />
                          <Bar dataKey="invoices" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="text-lg">Automation Progress</CardTitle>
                  <ChartDateFilter
                    filter={automationFilter}
                    onFilterChange={setAutomationFilter}
                    customRange={automationCustomRange}
                    onCustomRangeChange={setAutomationCustomRange}
                  />
                </CardHeader>
                <CardContent>
                  <div className="h-[300px]">
                    {(isAutomationLoading || isAutomationFetching || automationData === undefined) ? (
                      <div className="flex items-center justify-center h-full">
                        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                      </div>
                    ) : isAutomationError ? (
                      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                        <AlertCircle className="w-12 h-12 mb-2 opacity-50 text-red-500" />
                        <p>Failed to load automation data</p>
                        <p className="text-sm">Please try again later</p>
                      </div>
                    ) : automationMetrics.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                        <Zap className="w-12 h-12 mb-2 opacity-50" />
                        <p>No automation data available</p>
                        <p className="text-sm">Upload invoices to track automation progress</p>
                      </div>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={automationMetrics}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                          <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                          <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} unit="%" />
                          <RechartsTooltip
                            contentStyle={{
                              backgroundColor: 'hsl(var(--card))',
                              border: '1px solid hsl(var(--border))',
                              borderRadius: '8px',
                            }}
                            formatter={(value: number) => [`${value}%`]}
                          />
                          <Line type="monotone" dataKey="automated" stroke="hsl(var(--chart-1))" strokeWidth={2} name="Automated" />
                          <Line type="monotone" dataKey="manual" stroke="hsl(var(--chart-3))" strokeWidth={2} name="Manual" />
                        </LineChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Processing Efficiency Metrics */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-lg">Processing Efficiency Metrics</CardTitle>
                <ChartDateFilter
                  filter={efficiencyFilter}
                  onFilterChange={setEfficiencyFilter}
                  customRange={efficiencyCustomRange}
                  onCustomRangeChange={setEfficiencyCustomRange}
                />
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="p-4 bg-muted/30 rounded-lg text-center">
                    {(isEfficiencyLoading || isEfficiencyFetching) ? (
                      <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
                    ) : (
                      <p className="text-3xl font-bold text-foreground">{efficiencyMetrics?.autoProcessedPercentage ?? 0}%</p>
                    )}
                    <p className="text-sm text-muted-foreground mt-1">Auto-Processed</p>
                  </div>
                  <div className="p-4 bg-muted/30 rounded-lg text-center">
                    {(isEfficiencyLoading || isEfficiencyFetching) ? (
                      <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
                    ) : (
                      <p className="text-3xl font-bold text-foreground">
                        {efficiencyMetrics?.avgDaysToPay == null ? '—' : efficiencyMetrics.avgDaysToPay}
                      </p>
                    )}
                    <p className="text-sm text-muted-foreground mt-1">Avg Days to Pay</p>
                  </div>
                  <div className="p-4 bg-muted/30 rounded-lg text-center">
                    {(isEfficiencyLoading || isEfficiencyFetching) ? (
                      <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
                    ) : (
                      <p className="text-3xl font-bold text-foreground">{efficiencyMetrics?.dataAccuracy ?? 0}%</p>
                    )}
                    <p className="text-sm text-muted-foreground mt-1">Data Accuracy</p>
                  </div>
                  <div className="p-4 bg-muted/30 rounded-lg text-center">
                    {(isEfficiencyLoading || isEfficiencyFetching) ? (
                      <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
                    ) : (
                      <p className="text-3xl font-bold text-foreground">
                        £{(efficiencyMetrics?.totalPaidAmount ?? 0) >= 1000
                          ? `${((efficiencyMetrics?.totalPaidAmount ?? 0) / 1000).toFixed(1)}K`
                          : (efficiencyMetrics?.totalPaidAmount ?? 0).toFixed(2)
                        }
                      </p>
                    )}
                    <p className="text-sm text-muted-foreground mt-1">Monthly Expense</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* File Upload Modal */}
        <Dialog 
          open={uploadModalOpen} 
          onOpenChange={(open) => {
            setUploadModalOpen(open);
            if (!open) {
              // Reset selected files and preview when modal closes
              setSelectedFiles([]);
              setPdfPreviewUrl(null);
            }
          }}
        >
          <DialogContent className={pdfPreviewUrl ? "max-w-5xl" : "max-w-2xl"}>
            <DialogHeader>
              <DialogTitle>Upload Supplier Invoice</DialogTitle>
              <DialogDescription>
                Select a PDF file to upload. The file will be automatically processed and extracted.
              </DialogDescription>
            </DialogHeader>
            <div className={`py-4 ${pdfPreviewUrl ? 'grid grid-cols-2 gap-6' : ''}`}>
              {/* Left side - Upload area */}
              <div>
                <InvoiceFileUpload
                  onFileSelected={(files) => {
                    setSelectedFiles(files);
                  }}
                  onPreviewUrlChange={(url) => {
                    setPdfPreviewUrl(url);
                  }}
                  multiple={false}
                  isUploading={isUploading}
                  hideInternalPreview={true}
                />
              </div>
              {/* Right side - PDF Preview */}
              {pdfPreviewUrl && (
                <div className="border rounded-lg overflow-hidden flex flex-col">
                  <div className="bg-muted/30 px-3 py-2 border-b flex-shrink-0">
                    <p className="text-sm font-medium text-foreground">PDF Preview</p>
                  </div>
                  <iframe
                    src={`${pdfPreviewUrl}#toolbar=1&navpanes=0`}
                    className="w-full flex-1 bg-gray-100"
                    style={{ minHeight: '450px' }}
                    title="PDF Preview"
                  />
                </div>
              )}
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setUploadModalOpen(false);
                  setSelectedFiles([]);
                  setPdfPreviewUrl(null);
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={async () => {
                  if (selectedFiles.length === 0) {
                    toast.error('Please select at least one file to upload');
                    return;
                  }

                  if (!organizationId) {
                    toast.error('Organization not found. Please refresh the page.');
                    return;
                  }

                  toast.info(`Processing ${selectedFiles.length} file${selectedFiles.length > 1 ? 's' : ''}...`);

                  try {
                    const results = await uploadMultipleInvoices(selectedFiles);

                    const successful = results.filter(r => r.success);
                    const failed = results.filter(r => !r.success);

                    if (successful.length > 0) {
                      toast.success(
                        `Successfully processed ${successful.length} invoice${successful.length > 1 ? 's' : ''}`
                      );

                      // Close modal and reset
                      setUploadModalOpen(false);
                      setSelectedFiles([]);

                      // Refresh the invoice list
                      await refetchInvoices();

                      // Open review modal for the first successfully uploaded invoice
                      const firstSuccessful = successful[0];
                      if (firstSuccessful.invoice) {
                        // Fetch the invoice with line items
                        const { data: invoiceWithLineItems } = await (supabase as any)
                          .from('accounts_payable_invoice')
                          .select(`
                            *,
                            line_items:accounts_payable_invoice_line_item(*)
                          `)
                          .eq('id', firstSuccessful.invoice.id)
                          .single();

                        if (invoiceWithLineItems) {
                          // Sort line items by created_at for consistent ordering across modals
                          if (invoiceWithLineItems.line_items) {
                            invoiceWithLineItems.line_items.sort((a: any, b: any) =>
                              new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
                            );
                          }
                          setSelectedInvoice(invoiceWithLineItems);
                          setReviewModalOpen(true);
                        }
                      }
                    }

                    if (failed.length > 0) {
                      toast.error(`Failed to process ${failed.length} file(s)`);
                      failed.forEach(f => console.error('Upload failed:', f.error));
                    }
                  } catch (error: any) {
                    toast.error(`Failed to process files: ${error.message}`);
                    console.error('Upload error:', error);
                  }
                }}
                disabled={selectedFiles.length === 0 || isUploading}
              >
                {isUploading ? (
                  <>
                    <Clock className="w-4 h-4 mr-2 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4 mr-2" />
                    Upload File
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Invoice Review Modal */}
        {/* Approve confirmation dialog */}
        <Dialog open={!!approveConfirmInvoice} onOpenChange={(open) => { if (!open) setApproveConfirmInvoice(null); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Approve Invoice</DialogTitle>
              <DialogDescription>
                Are you sure you want to approve invoice{' '}
                <span className="font-bold">#{approveConfirmInvoice?.invoice_number || approveConfirmInvoice?.id?.slice(0, 8)}</span>
                {approveConfirmInvoice?.vendor_name ? ` from ${approveConfirmInvoice.vendor_name}` : ''}? This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 flex-wrap">
              <Button variant="outline" onClick={() => setApproveConfirmInvoice(null)}>Cancel</Button>
              <Button
                variant="secondary"
                onClick={() => {
                  const inv = approveConfirmInvoice;
                  setApproveConfirmInvoice(null);
                  if (inv) handleReviewInvoice(inv);
                }}
              >
                Edit Invoice
              </Button>
              <Button
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={async () => {
                  if (!approveConfirmInvoice) return;
                  try {
                    await updateInvoiceStatus({ invoiceId: approveConfirmInvoice.id, status: 'approved' });
                    toast.success('Invoice approved');
                  } catch {
                    toast.error('Failed to approve invoice');
                  } finally {
                    setApproveConfirmInvoice(null);
                  }
                }}
              >
                Approve
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <InvoiceDetailsDrawer
          open={reviewModalOpen}
          onOpenChange={(open) => {
            setReviewModalOpen(open);
            if (!open) setSelectedInvoice(null);
          }}
          invoice={selectedInvoice}
          onSave={() => {
            refetchInvoices();
            setReviewModalOpen(false);
          }}
          onSendToAccounting={() => {
            refetchInvoices();
            setReviewModalOpen(false);
          }}
          onTagsUpdate={fetchInvoiceTags}
          selectedLocationId={selectedLocationId}
          hidePdfToggle={true}
          folders={folders}
          onFolderAssign={moveInvoiceToFolder}
        />

        {/* Invoice Detail Modal */}
        <InvoiceDetailModal
          open={detailModalOpen}
          onOpenChange={(open) => {
            setDetailModalOpen(open);
            if (!open) {
              // Clear detailInvoice when modal closes to ensure fresh data on reopen
              setDetailInvoice(null);
            }
          }}
          invoice={detailInvoice}
          selectedLocationId={selectedLocationId}
          onUpdate={async (invoiceId, updates) => {
            await updateInvoice({ invoiceId, updates });
            // Mutation's onSuccess auto-invalidates query - triggers instant background refetch
          }}
          onTagsUpdate={fetchInvoiceTags}
        />

        {/* New/Edit Folder Modal */}
        <NewFolderModal
          open={newFolderModalOpen}
          onOpenChange={(open) => {
            setNewFolderModalOpen(open);
            if (!open) setEditFolder(null);
          }}
          onCreateFolder={(input) => {
            createFolder(input, {
              onSuccess: () => {
                setNewFolderModalOpen(false);
              },
            });
          }}
          isCreating={isCreatingFolder}
          folders={folders}
          editFolder={editFolder}
          onUpdateFolder={(input) => {
            updateFolder(input, {
              onSuccess: () => {
                setNewFolderModalOpen(false);
                setEditFolder(null);
              },
            });
          }}
          isUpdating={isUpdatingFolder}
          selectedLocationId={selectedLocationId}
          locations={locations}
        />

        {/* Delete Folder Modal */}
        <DeleteFolderModal
          open={deleteFolderModalOpen}
          onOpenChange={setDeleteFolderModalOpen}
          folder={folderToDelete}
          onConfirm={handleConfirmDeleteFolder}
          isDeleting={isDeletingFolder}
        />

        {/* Invoice Details Drawer - used in list view */}
        {viewMode === 'list' && (
          <InvoiceDetailsDrawer
            open={shareDrawerOpen}
            onOpenChange={setShareDrawerOpen}
            invoice={shareInvoice}
            onSave={() => {
              refetchInvoices();
              setShareDrawerOpen(false);
            }}
            onSendToAccounting={() => {
              refetchInvoices();
              setShareDrawerOpen(false);
            }}
            onTagsUpdate={fetchInvoiceTags}
            selectedLocationId={selectedLocationId}
            hidePdfToggle={true}
            folders={folders}
            onFolderAssign={moveInvoiceToFolder}
          />
        )}
      </div>
    </MainLayout>
  );
}
