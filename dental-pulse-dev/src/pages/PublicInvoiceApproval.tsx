import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Check, X, Loader2, CheckCircle2, XCircle, AlertTriangle, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast, Toaster } from 'sonner';
import { createClient } from '@supabase/supabase-js';

// Create anonymous Supabase client for public access (no session persistence)
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const anonSupabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  }
});

interface LineItem {
  id: string;
  description: string | null;
  line_total: number | null;
  approval_status: 'pending' | 'approved' | 'rejected' | null;
  approver_id: string | null;
  approver_amount: number | null;
  approver_percentage: number | null;
  approved_at: string | null;
  approval_notes: string | null;
}

// Helper function to create notification
const createNotification = async (params: {
  title: string;
  message: string;
  notificationType: string;
  moduleType: string;
  associateId: string;
  organizationId?: string | null;
  userId?: string | null;
  reason?: string;
  data: Record<string, any>;
}) => {
  try {
    const { error } = await anonSupabase
      .from('general_notification')
      .insert({
        title: params.title,
        message: params.message,
        notification_type: params.notificationType,
        module_type: params.moduleType,
        associate_id: params.associateId,
        organization_id: params.organizationId || null,
        user_id: params.userId || null,
        reason: params.reason,
        data: params.data,
      });

    if (error) {
      console.error('Error creating notification:', error);
    }
  } catch (err) {
    console.error('Failed to create notification:', err);
  }
};

interface Invoice {
  id: string;
  invoice_number: string | null;
  vendor_name: string | null;
  invoice_date: string | null;
  due_date: string | null;
  currency: string | null;
  total_amount: number | null;
  organization_id: string | null;
  user_id: string | null;
}

export default function PublicInvoiceApproval() {
  const { invoiceId, approverId } = useParams<{ invoiceId: string; approverId: string }>();
  const navigate = useNavigate();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [approverName, setApproverName] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isApproving, setIsApproving] = useState<Record<string, boolean>>({});
  const [isRejecting, setIsRejecting] = useState<Record<string, boolean>>({});
  const [isBulkApproving, setIsBulkApproving] = useState(false);
  const [isBulkRejecting, setIsBulkRejecting] = useState(false);

  // Rejection modal state
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectingItemId, setRejectingItemId] = useState<string | null>(null);
  const [rejectingBulk, setRejectingBulk] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [reasonError, setReasonError] = useState('');

  // Fetch invoice and line items using direct Supabase queries
  useEffect(() => {
    const fetchData = async () => {
      if (!invoiceId || !approverId) {
        setError('Invalid invoice link');
        setIsLoading(false);
        return;
      }

      try {
        // Fetch invoice
        const { data: invoiceData, error: invoiceError } = await anonSupabase
          .from('accounts_payable_invoice')
          .select('id, invoice_number, vendor_name, invoice_date, due_date, currency, total_amount, organization_id, user_id')
          .eq('id', invoiceId)
          .single();

        if (invoiceError) {
          console.error('Invoice error:', invoiceError);
          throw new Error('Invoice not found');
        }

        setInvoice(invoiceData);

        // Fetch approver name
        const { data: approverData } = await anonSupabase
          .from('provider')
          .select('name')
          .eq('id', approverId)
          .single();

        if (approverData) {
          setApproverName(approverData.name);
        }

        // Fetch ONLY line items assigned to THIS specific approver
        const { data: itemsData, error: itemsError } = await anonSupabase
          .from('accounts_payable_invoice_line_item')
          .select('id, description, line_total, approval_status, approver_id, approver_amount, approver_percentage, approved_at, approval_notes')
          .eq('accounts_payable_invoice_id', invoiceId)
          .eq('approver_id', approverId)
          .order('created_at', { ascending: true });

        if (itemsError) {
          console.error('Error fetching line items:', itemsError);
        }

        setLineItems(itemsData || []);
      } catch (err: any) {
        console.error('Error:', err);
        setError(err.message || 'Failed to load invoice');
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [invoiceId, approverId]);

  // Format currency
  const formatCurrency = (amount: number | null | undefined) => {
    if (amount === null || amount === undefined) return '£0.00';
    return `£${amount.toFixed(2)}`;
  };

  // Format date
  const formatDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return 'N/A';
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

  // Calculate totals
  const pendingItems = lineItems.filter(item => item.approval_status === 'pending');
  const totalApproverAmount = lineItems.reduce((sum, item) => sum + (item.approver_amount || 0), 0);

  // Approve single item
  const handleApprove = async (itemId: string) => {
    setIsApproving(prev => ({ ...prev, [itemId]: true }));
    try {
      const { error } = await anonSupabase
        .from('accounts_payable_invoice_line_item')
        .update({
          approval_status: 'approved',
          approved_at: new Date().toISOString(),
        })
        .eq('id', itemId)
        .eq('approver_id', approverId); // Security: only update if approver matches

      if (error) throw error;

      // Get the item details for notification
      const approvedItem = lineItems.find(item => item.id === itemId);

      setLineItems(prev =>
        prev.map(item =>
          item.id === itemId
            ? { ...item, approval_status: 'approved' as const, approved_at: new Date().toISOString() }
            : item
        )
      );

      // Create notification
      await createNotification({
        title: 'Invoice Item Approved',
        message: `Invoice item has been approved by ${approverName || 'Approver'} for invoice #${invoice?.invoice_number || invoiceId?.slice(0, 8)}`,
        notificationType: 'approver_status_change',
        moduleType: 'approver_line_item',
        associateId: invoiceId!,
        organizationId: invoice?.organization_id,
        userId: invoice?.user_id,
        data: {
          entity_type: 'invoice',
          entity_id: invoiceId,
          entity_name: `Invoice #${invoice?.invoice_number || invoiceId?.slice(0, 8)}`,
          action: 'approved',
          action_by_id: approverId,
          action_by_name: approverName || 'Approver',
          amount: approvedItem?.approver_amount,
          currency: invoice?.currency || 'GBP',
          line_item_id: itemId,
          url: '/accounts-payable',
        },
      });

      toast.success('Item approved successfully');
    } catch (err) {
      console.error('Error approving:', err);
      toast.error('Failed to approve item');
    } finally {
      setIsApproving(prev => ({ ...prev, [itemId]: false }));
    }
  };

  // Open reject modal for single item
  const openRejectModal = (itemId: string) => {
    setRejectingItemId(itemId);
    setRejectingBulk(false);
    setRejectionReason('');
    setReasonError('');
    setRejectModalOpen(true);
  };

  // Open reject modal for bulk
  const openBulkRejectModal = () => {
    setRejectingItemId(null);
    setRejectingBulk(true);
    setRejectionReason('');
    setReasonError('');
    setRejectModalOpen(true);
  };

  // Confirm rejection with reason
  const confirmRejection = async () => {
    if (!rejectionReason.trim()) {
      setReasonError('Rejection reason is required');
      return;
    }

    if (rejectingBulk) {
      await handleBulkReject(rejectionReason);
    } else if (rejectingItemId) {
      await handleReject(rejectingItemId, rejectionReason);
    }

    setRejectModalOpen(false);
    setRejectionReason('');
    setRejectingItemId(null);
    setRejectingBulk(false);
  };

  // Reject single item
  const handleReject = async (itemId: string, reason: string) => {
    setIsRejecting(prev => ({ ...prev, [itemId]: true }));
    try {
      const { error } = await anonSupabase
        .from('accounts_payable_invoice_line_item')
        .update({
          approval_status: 'rejected',
          approved_at: new Date().toISOString(),
          approval_notes: reason,
        })
        .eq('id', itemId)
        .eq('approver_id', approverId); // Security: only update if approver matches

      if (error) throw error;

      // Get the item details for notification
      const rejectedItem = lineItems.find(item => item.id === itemId);

      setLineItems(prev =>
        prev.map(item =>
          item.id === itemId
            ? { ...item, approval_status: 'rejected' as const, approved_at: new Date().toISOString(), approval_notes: reason }
            : item
        )
      );

      // Create notification
      await createNotification({
        title: 'Invoice Item Rejected',
        message: `Invoice item has been rejected by ${approverName || 'Approver'} for invoice #${invoice?.invoice_number || invoiceId?.slice(0, 8)}. Reason: ${reason}`,
        notificationType: 'approver_status_change',
        moduleType: 'approver_line_item',
        associateId: invoiceId!,
        organizationId: invoice?.organization_id,
        userId: invoice?.user_id,
        reason: reason,
        data: {
          entity_type: 'invoice',
          entity_id: invoiceId,
          entity_name: `Invoice #${invoice?.invoice_number || invoiceId?.slice(0, 8)}`,
          action: 'rejected',
          action_by_id: approverId,
          action_by_name: approverName || 'Approver',
          amount: rejectedItem?.approver_amount,
          currency: invoice?.currency || 'GBP',
          notes: reason,
          line_item_id: itemId,
          url: '/accounts-payable',
        },
      });

      toast.success('Item rejected');
    } catch (err) {
      console.error('Error rejecting:', err);
      toast.error('Failed to reject item');
    } finally {
      setIsRejecting(prev => ({ ...prev, [itemId]: false }));
    }
  };

  // Bulk approve
  const handleBulkApprove = async () => {
    if (pendingItems.length === 0) return;
    setIsBulkApproving(true);
    try {
      const itemIds = pendingItems.map(item => item.id);
      const totalAmount = pendingItems.reduce((sum, item) => sum + (item.approver_amount || 0), 0);

      const { error } = await anonSupabase
        .from('accounts_payable_invoice_line_item')
        .update({
          approval_status: 'approved',
          approved_at: new Date().toISOString(),
        })
        .in('id', itemIds)
        .eq('approver_id', approverId); // Security: only update if approver matches

      if (error) throw error;

      setLineItems(prev =>
        prev.map(item =>
          itemIds.includes(item.id)
            ? { ...item, approval_status: 'approved' as const, approved_at: new Date().toISOString() }
            : item
        )
      );

      // Create notification
      await createNotification({
        title: 'Multiple Invoice Items Approved',
        message: `${itemIds.length} item(s) have been approved by ${approverName || 'Approver'} for invoice #${invoice?.invoice_number || invoiceId?.slice(0, 8)}`,
        notificationType: 'approver_status_change',
        moduleType: 'approver_line_item',
        associateId: invoiceId!,
        organizationId: invoice?.organization_id,
        userId: invoice?.user_id,
        data: {
          entity_type: 'invoice',
          entity_id: invoiceId,
          entity_name: `Invoice #${invoice?.invoice_number || invoiceId?.slice(0, 8)}`,
          action: 'approved',
          action_by_id: approverId,
          action_by_name: approverName || 'Approver',
          amount: totalAmount,
          currency: invoice?.currency || 'GBP',
          items_count: itemIds.length,
          line_item_ids: itemIds,
          url: '/accounts-payable',
        },
      });

      toast.success(`${itemIds.length} items approved successfully`);
    } catch (err) {
      console.error('Error bulk approving:', err);
      toast.error('Failed to approve items');
    } finally {
      setIsBulkApproving(false);
    }
  };

  // Bulk reject
  const handleBulkReject = async (reason: string) => {
    if (pendingItems.length === 0) return;
    setIsBulkRejecting(true);
    try {
      const itemIds = pendingItems.map(item => item.id);
      const totalAmount = pendingItems.reduce((sum, item) => sum + (item.approver_amount || 0), 0);

      const { error } = await anonSupabase
        .from('accounts_payable_invoice_line_item')
        .update({
          approval_status: 'rejected',
          approved_at: new Date().toISOString(),
          approval_notes: reason,
        })
        .in('id', itemIds)
        .eq('approver_id', approverId); // Security: only update if approver matches

      if (error) throw error;

      setLineItems(prev =>
        prev.map(item =>
          itemIds.includes(item.id)
            ? { ...item, approval_status: 'rejected' as const, approved_at: new Date().toISOString(), approval_notes: reason }
            : item
        )
      );

      // Create notification
      await createNotification({
        title: 'Multiple Invoice Items Rejected',
        message: `${itemIds.length} item(s) have been rejected by ${approverName || 'Approver'} for invoice #${invoice?.invoice_number || invoiceId?.slice(0, 8)}. Reason: ${reason}`,
        notificationType: 'approver_status_change',
        moduleType: 'approver_line_item',
        associateId: invoiceId!,
        organizationId: invoice?.organization_id,
        userId: invoice?.user_id,
        reason: reason,
        data: {
          entity_type: 'invoice',
          entity_id: invoiceId,
          entity_name: `Invoice #${invoice?.invoice_number || invoiceId?.slice(0, 8)}`,
          action: 'rejected',
          action_by_id: approverId,
          action_by_name: approverName || 'Approver',
          amount: totalAmount,
          currency: invoice?.currency || 'GBP',
          notes: reason,
          items_count: itemIds.length,
          line_item_ids: itemIds,
          url: '/accounts-payable',
        },
      });

      toast.success(`${itemIds.length} items rejected`);
    } catch (err) {
      console.error('Error bulk rejecting:', err);
      toast.error('Failed to reject items');
    } finally {
      setIsBulkRejecting(false);
    }
  };

  // Get status badge
  const getStatusBadge = (status: string | null) => {
    switch (status) {
      case 'pending':
        return <Badge variant="outline" className="bg-amber-50 text-amber-600 border-amber-200 text-[10px] sm:text-xs">Pending</Badge>;
      case 'approved':
        return <Badge variant="outline" className="bg-emerald-50 text-emerald-600 border-emerald-200 text-[10px] sm:text-xs">Approved</Badge>;
      case 'rejected':
        return <Badge variant="outline" className="bg-red-50 text-red-600 border-red-200 text-[10px] sm:text-xs">Rejected</Badge>;
      default:
        return <Badge variant="outline" className="text-gray-500 text-[10px] sm:text-xs">Unknown</Badge>;
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#f8fafc] flex items-center justify-center px-4">
        <div className="flex items-center gap-2">
          <Loader2 className="w-5 h-5 sm:w-6 sm:h-6 animate-spin text-indigo-600" />
          <span className="text-sm sm:text-base text-gray-600">Loading invoice...</span>
        </div>
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div className="min-h-screen bg-[#f8fafc] flex items-center justify-center px-3 sm:px-4">
        <Card className="max-w-md w-full bg-white border border-gray-200 shadow-sm">
          <CardContent className="pt-6 text-center px-4 sm:px-6">
            <XCircle className="w-10 h-10 sm:w-12 sm:h-12 text-red-500 mx-auto mb-3 sm:mb-4" />
            <h2 className="text-lg sm:text-xl font-semibold text-gray-900 mb-2">Invoice Not Found</h2>
            <p className="text-sm sm:text-base text-gray-500">{error || 'The invoice you are looking for does not exist or has been removed.'}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Check if no items assigned
  if (lineItems.length === 0) {
    return (
      <div className="min-h-screen bg-[#f8fafc]">
        <Toaster position="top-center" />
        <div className="bg-[#1e293b] text-white py-3 sm:py-4">
          <div className="max-w-4xl mx-auto px-3 sm:px-4 lg:px-6 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <div className="w-7 h-7 sm:w-8 sm:h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-xs sm:text-sm font-bold shrink-0">DP</div>
              <h1 className="text-sm sm:text-lg font-semibold truncate">DentPulse Invoice Approval</h1>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate(`/approver-dashboard/${approverId}`)}
              className="border-amber-500 text-amber-500 hover:bg-amber-500/10 hover:border-amber-400 hover:text-amber-400 bg-transparent transition-colors shrink-0 text-xs sm:text-sm h-8 sm:h-9 px-2 sm:px-3"
            >
              <ArrowLeft className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1 sm:mr-2" />
              <span className="hidden xs:inline">Back</span>
            </Button>
          </div>
        </div>
        <div className="max-w-4xl mx-auto px-3 sm:px-4 lg:px-6 py-4 sm:py-8">
          <Card className="bg-white border border-gray-200 shadow-sm">
            <CardContent className="pt-6 text-center py-8 sm:py-12 px-4">
              <AlertTriangle className="w-10 h-10 sm:w-12 sm:h-12 text-yellow-500 mx-auto mb-3 sm:mb-4" />
              <h2 className="text-lg sm:text-xl font-semibold text-gray-900 mb-2">No Items Assigned</h2>
              <p className="text-sm sm:text-base text-gray-500">There are no items assigned for approval on this invoice.</p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const allApproved = lineItems.length > 0 && lineItems.every(item => item.approval_status === 'approved');
  const allRejected = lineItems.length > 0 && lineItems.every(item => item.approval_status === 'rejected');

  return (
    <div className="min-h-screen bg-[#f8fafc]">
      <Helmet>
        <title>Public Invoice Approval</title>
        <meta name="description" content="Secure public invoice approval interface for external approvers to review and approve invoice line items." />
      </Helmet>
      <Toaster position="top-center" />

      {/* Header - matches admin panel sidebar color */}
      <div className="bg-[#1e293b] text-white py-3 sm:py-4">
        <div className="max-w-4xl mx-auto px-3 sm:px-4 lg:px-6 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <div className="w-7 h-7 sm:w-8 sm:h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-xs sm:text-sm font-bold shrink-0">DP</div>
            <h1 className="text-sm sm:text-lg font-semibold truncate">DentPulse Invoice Approval</h1>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate(`/approver-dashboard/${approverId}`)}
            className="border-amber-500 text-amber-500 hover:bg-amber-500/10 hover:border-amber-400 hover:text-amber-400 bg-transparent transition-colors shrink-0 text-xs sm:text-sm h-8 sm:h-9 px-2 sm:px-3"
          >
            <ArrowLeft className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1 sm:mr-2" />
            Back
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-4xl mx-auto px-3 sm:px-4 lg:px-6 py-4 sm:py-6 lg:py-8">
        <Card className="bg-white border border-gray-200 shadow-sm">
          <CardContent className="p-3 sm:p-4 lg:p-6">
            {/* Invoice Header */}
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-4 mb-4 sm:mb-6">
              <div>
                <h2 className="text-xl sm:text-2xl font-bold text-gray-900">Invoice Details</h2>
                <p className="text-sm sm:text-base text-gray-500">Invoice #{invoice.invoice_number || invoiceId?.slice(0, 8)}</p>
              </div>
              <div className="self-start">
                {pendingItems.length > 0 ? (
                  <Badge className="bg-amber-100 text-amber-700 border border-amber-200 hover:bg-amber-100 text-xs sm:text-sm px-2 sm:px-3 py-0.5 sm:py-1">
                    {pendingItems.length} Pending
                  </Badge>
                ) : allApproved ? (
                  <Badge className="bg-emerald-100 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 text-xs sm:text-sm px-2 sm:px-3 py-0.5 sm:py-1">
                    <CheckCircle2 className="w-3 h-3 sm:w-4 sm:h-4 mr-1" />
                    All Approved
                  </Badge>
                ) : allRejected ? (
                  <Badge className="bg-red-100 text-red-700 border border-red-200 hover:bg-red-100 text-xs sm:text-sm px-2 sm:px-3 py-0.5 sm:py-1">
                    <XCircle className="w-3 h-3 sm:w-4 sm:h-4 mr-1" />
                    All Rejected
                  </Badge>
                ) : null}
              </div>
            </div>

            {/* Invoice Info */}
            <div className="bg-gray-50 rounded-lg p-3 sm:p-4 mb-4 sm:mb-6 border border-gray-100">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
                <div>
                  <p className="text-[10px] sm:text-xs font-medium text-gray-500 uppercase tracking-wide">Vendor</p>
                  <p className="text-xs sm:text-sm font-medium text-gray-900 mt-0.5 sm:mt-1">{invoice.vendor_name || 'Unknown'}</p>
                </div>
                <div>
                  <p className="text-[10px] sm:text-xs font-medium text-gray-500 uppercase tracking-wide">Invoice Date</p>
                  <p className="text-xs sm:text-sm text-gray-900 mt-0.5 sm:mt-1">{formatDate(invoice.invoice_date)}</p>
                </div>
                <div>
                  <p className="text-[10px] sm:text-xs font-medium text-gray-500 uppercase tracking-wide">Due Date</p>
                  <p className="text-xs sm:text-sm text-gray-900 mt-0.5 sm:mt-1">{formatDate(invoice.due_date)}</p>
                </div>
              </div>
            </div>

            {/* Total Amount Display */}
            <div className="bg-indigo-50 rounded-lg p-4 sm:p-6 mb-4 sm:mb-6 text-center border border-indigo-100">
              <p className="text-xs sm:text-sm text-indigo-600 mb-0.5 sm:mb-1">Total Amount</p>
              <p className="text-2xl sm:text-3xl lg:text-4xl font-bold text-indigo-600">{formatCurrency(totalApproverAmount)}</p>
            </div>

            {/* Invoice Items Section */}
            <div>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4 mb-3 sm:mb-4">
                <div>
                  <h3 className="text-base sm:text-lg font-semibold text-gray-900">Invoice Items</h3>
                  <p className="text-xs sm:text-sm text-gray-500">Review and approve individual items</p>
                </div>
                {pendingItems.length > 0 && (
                  <div className="flex gap-2">
                    <Button
                      onClick={handleBulkApprove}
                      disabled={isBulkApproving || isBulkRejecting}
                      size="sm"
                      className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm h-8 sm:h-9 px-2.5 sm:px-3"
                    >
                      {isBulkApproving ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <>
                          <Check className="w-4 h-4 mr-1" />
                          Approve All
                        </>
                      )}
                    </Button>
                    <Button
                      onClick={openBulkRejectModal}
                      disabled={isBulkApproving || isBulkRejecting}
                      size="sm"
                      className="bg-red-500 hover:bg-red-600 text-white text-xs sm:text-sm h-8 sm:h-9 px-2.5 sm:px-3"
                    >
                      {isBulkRejecting ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <>
                          <X className="w-4 h-4 mr-1" />
                          Reject All
                        </>
                      )}
                    </Button>
                  </div>
                )}
              </div>

              {/* Items Table - Desktop */}
              <div className="hidden sm:block border border-gray-200 rounded-lg overflow-hidden">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-[#1e293b] hover:bg-[#1e293b]">
                        <TableHead className="text-white font-medium w-12 sm:w-16 text-xs sm:text-sm">#</TableHead>
                        <TableHead className="text-white font-medium text-xs sm:text-sm">Description</TableHead>
                        <TableHead className="text-white font-medium text-right text-xs sm:text-sm whitespace-nowrap">Amount</TableHead>
                        <TableHead className="text-white font-medium text-center text-xs sm:text-sm">Status</TableHead>
                        <TableHead className="text-white font-medium text-center text-xs sm:text-sm">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {lineItems.map((item, index) => (
                        <TableRow key={item.id} className={`border-b border-gray-100 ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                          <TableCell className="font-medium text-indigo-600 text-xs sm:text-sm">{index + 1}</TableCell>
                          <TableCell className="max-w-[150px] sm:max-w-xs text-gray-700 text-xs sm:text-sm">
                            <div className="line-clamp-2">{item.description || 'No description'}</div>
                            {item.approval_status === 'rejected' && item.approval_notes && (
                              <p className="text-[10px] sm:text-xs text-red-500 mt-1">
                                Reason: {item.approval_notes}
                              </p>
                            )}
                          </TableCell>
                          <TableCell className="text-right font-medium text-gray-900 text-xs sm:text-sm whitespace-nowrap">{formatCurrency(item.approver_amount)}</TableCell>
                          <TableCell className="text-center">{getStatusBadge(item.approval_status)}</TableCell>
                          <TableCell className="text-center">
                            {item.approval_status === 'pending' ? (
                              <div className="flex justify-center gap-1.5 sm:gap-2">
                                <Button
                                  size="sm"
                                  onClick={() => handleApprove(item.id)}
                                  disabled={isApproving[item.id] || isRejecting[item.id]}
                                  className="bg-emerald-600 hover:bg-emerald-700 text-white h-7 sm:h-8 text-xs px-2 sm:px-2.5"
                                >
                                  {isApproving[item.id] ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    <>
                                      <Check className="w-3.5 h-3.5 mr-1" />
                                      Approve
                                    </>
                                  )}
                                </Button>
                                <Button
                                  size="sm"
                                  onClick={() => openRejectModal(item.id)}
                                  disabled={isApproving[item.id] || isRejecting[item.id]}
                                  className="bg-red-500 hover:bg-red-600 text-white h-7 sm:h-8 text-xs px-2 sm:px-2.5"
                                >
                                  {isRejecting[item.id] ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    <>
                                      <X className="w-3.5 h-3.5 mr-1" />
                                      Reject
                                    </>
                                  )}
                                </Button>
                              </div>
                            ) : (
                              <span className="text-xs sm:text-sm text-gray-500">
                                {formatDate(item.approved_at)}
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>

              {/* Items Cards - Mobile */}
              <div className="sm:hidden space-y-3">
                {lineItems.map((item, index) => (
                  <div key={item.id} className="bg-white border border-gray-200 rounded-lg p-3 shadow-sm">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <span className="w-6 h-6 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-xs font-medium">
                          {index + 1}
                        </span>
                        <span className="text-sm font-medium text-gray-900">{formatCurrency(item.approver_amount)}</span>
                      </div>
                      {getStatusBadge(item.approval_status)}
                    </div>
                    <p className="text-xs text-gray-600 mb-3 line-clamp-2">{item.description || 'No description'}</p>
                    {item.approval_status === 'rejected' && item.approval_notes && (
                      <p className="text-[10px] text-red-500 mb-3 bg-red-50 p-2 rounded">
                        Reason: {item.approval_notes}
                      </p>
                    )}
                    {item.approval_status === 'pending' ? (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() => handleApprove(item.id)}
                          disabled={isApproving[item.id] || isRejecting[item.id]}
                          className="bg-emerald-600 hover:bg-emerald-700 text-white h-8 text-xs flex-1"
                        >
                          {isApproving[item.id] ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <>
                              <Check className="w-3 h-3 mr-1" />
                              Approve
                            </>
                          )}
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => openRejectModal(item.id)}
                          disabled={isApproving[item.id] || isRejecting[item.id]}
                          className="bg-red-500 hover:bg-red-600 text-white h-8 text-xs flex-1"
                        >
                          {isRejecting[item.id] ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <>
                              <X className="w-3 h-3 mr-1" />
                              Reject
                            </>
                          )}
                        </Button>
                      </div>
                    ) : (
                      <p className="text-xs text-gray-500 text-center">
                        Processed on {formatDate(item.approved_at)}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Footer */}
            <div className="mt-6 sm:mt-8 pt-4 sm:pt-6 border-t border-gray-200 text-center text-xs sm:text-sm text-gray-500 px-2">
              <p>This is an automated approval request from DentPulse.</p>
              <p className="mt-1">If you have any questions, please contact your administrator.</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Rejection Reason Modal */}
      <Dialog open={rejectModalOpen} onOpenChange={setRejectModalOpen}>
        <DialogContent className="w-[calc(100%-24px)] sm:max-w-md bg-white border-gray-200 rounded-lg mx-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-gray-900 text-base sm:text-lg">
              <XCircle className="w-4 h-4 sm:w-5 sm:h-5 text-red-500" />
              Rejection Reason
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 sm:space-y-4 py-3 sm:py-4">
            <p className="text-xs sm:text-sm text-gray-500">
              Please provide a reason for rejecting {rejectingBulk ? `${pendingItems.length} items` : 'this item'}. This is required.
            </p>
            <div className="space-y-2">
              <Label htmlFor="rejection-reason" className="text-gray-700 text-xs sm:text-sm">Reason <span className="text-red-500">*</span></Label>
              <Textarea
                id="rejection-reason"
                placeholder="Enter the reason for rejection..."
                value={rejectionReason}
                onChange={(e) => {
                  setRejectionReason(e.target.value);
                  if (e.target.value.trim()) setReasonError('');
                }}
                className={`bg-white border-gray-300 text-gray-900 placeholder:text-gray-400 focus:border-indigo-500 focus:ring-indigo-500 text-sm ${reasonError ? 'border-red-500' : ''}`}
                rows={3}
              />
              {reasonError && (
                <p className="text-xs sm:text-sm text-red-500">{reasonError}</p>
              )}
            </div>
          </div>
          <DialogFooter className="gap-2 flex-col sm:flex-row">
            <Button
              variant="outline"
              onClick={() => setRejectModalOpen(false)}
              className="border-gray-300 text-gray-700 hover:bg-gray-50 text-xs sm:text-sm h-8 sm:h-9 w-full sm:w-auto order-2 sm:order-1"
            >
              Cancel
            </Button>
            <Button
              onClick={confirmRejection}
              disabled={isBulkRejecting || (rejectingItemId && isRejecting[rejectingItemId])}
              className="bg-red-500 hover:bg-red-600 text-white text-xs sm:text-sm h-8 sm:h-9 w-full sm:w-auto order-1 sm:order-2"
            >
              {(isBulkRejecting || (rejectingItemId && isRejecting[rejectingItemId])) ? (
                <Loader2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1.5 sm:mr-2 animate-spin" />
              ) : (
                <X className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1.5 sm:mr-2" />
              )}
              Confirm Rejection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
