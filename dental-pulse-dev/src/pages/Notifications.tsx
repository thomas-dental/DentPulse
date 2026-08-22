import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Bell, CheckCircle2, XCircle, Mail, FileText, AlertCircle, Eye, Send, Search, ChevronLeft, ChevronRight, Loader2, Check, ChevronsUpDown } from 'lucide-react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
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
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useProviders } from '@/hooks/useProviders';
import { useAuth } from '@/hooks/useAuth';

// Notification type definition from database
interface NotificationData {
  id: string;
  title: string;
  message: string | null;
  notification_type: string;
  module_type: string | null;
  reason: string | null;
  read_at: string | null;
  created_at: string;
  data: Record<string, any> | null;
  associate_id: string | null;
}

// Line item interface for the modal
interface LineItemData {
  id: string;
  description: string | null;
  quantity: number | null;
  unit_price: number | null;
  line_total: number | null;
  approval_status: string | null;
  approval_notes: string | null;
}

// Items per page
const ITEMS_PER_PAGE = 10;

// Filter tabs
type FilterTab = 'all' | 'unread' | 'read';

// Helper function to format time ago
const formatTimeAgo = (dateStr: string): string => {
  const date = new Date(dateStr);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days > 1 ? 's' : ''} ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks} week${weeks > 1 ? 's' : ''} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months > 1 ? 's' : ''} ago`;
  const years = Math.floor(days / 365);
  return `${years} year${years > 1 ? 's' : ''} ago`;
};

// Format date time
const formatDateTime = (dateStr: string): string => {
  const date = new Date(dateStr);
  return date.toLocaleString('en-GB', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).replace(',', '');
};

// Get icon config based on notification type and action
const getIconConfig = (type: string, data?: Record<string, any> | null) => {
  // For approver_status_change, check the action in data
  if (type === 'approver_status_change' && data?.action) {
    if (data.action === 'approved') {
      return { icon: CheckCircle2, bg: 'bg-emerald-100', color: 'text-emerald-600' };
    } else if (data.action === 'rejected') {
      return { icon: XCircle, bg: 'bg-red-100', color: 'text-red-600' };
    }
  }

  switch (type) {
    case 'approved':
      return { icon: CheckCircle2, bg: 'bg-emerald-100', color: 'text-emerald-600' };
    case 'rejected':
      return { icon: XCircle, bg: 'bg-red-100', color: 'text-red-600' };
    case 'invoice':
      return { icon: FileText, bg: 'bg-blue-100', color: 'text-blue-600' };
    case 'email':
      return { icon: Mail, bg: 'bg-blue-100', color: 'text-blue-600' };
    case 'reminder':
      return { icon: AlertCircle, bg: 'bg-amber-100', color: 'text-amber-600' };
    case 'approver_status_change':
      return { icon: CheckCircle2, bg: 'bg-indigo-100', color: 'text-indigo-600' };
    default:
      return { icon: Bell, bg: 'bg-gray-100', color: 'text-gray-600' };
  }
};

export default function Notifications() {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<NotificationData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  // Detail Modal state
  const [selectedNotification, setSelectedNotification] = useState<NotificationData | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [lineItems, setLineItems] = useState<LineItemData[]>([]);
  const [isLoadingItems, setIsLoadingItems] = useState(false);

  // Resend Modal state
  const [isResendModalOpen, setIsResendModalOpen] = useState(false);
  const [resendNotification, setResendNotification] = useState<NotificationData | null>(null);
  const [selectedApproverId, setSelectedApproverId] = useState<string>('');
  const [approverPercentage, setApproverPercentage] = useState<string>('10.00');
  const [lineItemTotal, setLineItemTotal] = useState<number>(0);
  const [isResending, setIsResending] = useState(false);
  const [approverDropdownOpen, setApproverDropdownOpen] = useState(false);

  // Use providers hook to fetch providers
  const { providers, isLoading: isLoadingProviders } = useProviders();

  // Get organization ID and user ID from auth
  const { user, profile } = useAuth();
  const organizationId = profile?.current_organization_id;
  const userId = user?.id;

  // Fetch notifications from database
  useEffect(() => {
    if (organizationId && userId) {
      fetchNotifications();
    }
  }, [organizationId, userId]);

  const fetchNotifications = async () => {
    if (!organizationId || !userId) return;

    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('general_notification')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching notifications:', error);
        toast.error('Failed to load notifications');
        return;
      }

      setNotifications(data || []);
    } catch (err) {
      console.error('Failed to fetch notifications:', err);
      toast.error('Failed to load notifications');
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch line items for the notification
  const fetchLineItems = async (notification: NotificationData) => {
    if (!notification.data?.line_item_id && !notification.data?.line_item_ids) {
      setLineItems([]);
      return;
    }

    setIsLoadingItems(true);
    try {
      let query = supabase
        .from('accounts_payable_invoice_line_item')
        .select('id, description, quantity, unit_price, line_total, approval_status, approval_notes');

      if (notification.data?.line_item_ids) {
        query = query.in('id', notification.data.line_item_ids);
      } else if (notification.data?.line_item_id) {
        query = query.eq('id', notification.data.line_item_id);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching line items:', error);
        return;
      }

      setLineItems(data || []);
    } catch (err) {
      console.error('Failed to fetch line items:', err);
    } finally {
      setIsLoadingItems(false);
    }
  };

  // Fetch line item details for resend modal (total, percentage, approver)
  const fetchLineItemDetails = async (notification: NotificationData) => {
    const lineItemId = notification.data?.line_item_id;
    if (!lineItemId) {
      setLineItemTotal(0);
      setApproverPercentage('10.00');
      setSelectedApproverId('');
      return;
    }

    try {
      const { data, error } = await supabase
        .from('accounts_payable_invoice_line_item')
        .select('line_total, approver_percentage, approver_id')
        .eq('id', lineItemId)
        .single();

      if (error) {
        console.error('Error fetching line item:', error);
        return;
      }

      setLineItemTotal(data?.line_total || 0);
      // Pre-populate with existing values
      if (data?.approver_percentage) {
        setApproverPercentage(data.approver_percentage.toFixed(2));
      } else {
        setApproverPercentage('10.00');
      }
      if (data?.approver_id) {
        setSelectedApproverId(data.approver_id);
      } else {
        setSelectedApproverId('');
      }
    } catch (err) {
      console.error('Failed to fetch line item:', err);
    }
  };

  // Filter notifications based on tab and search
  const filteredNotifications = useMemo(() => {
    let filtered = notifications;

    if (activeTab === 'unread') {
      filtered = filtered.filter(n => !n.read_at);
    } else if (activeTab === 'read') {
      filtered = filtered.filter(n => n.read_at);
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(n =>
        n.title.toLowerCase().includes(query) ||
        (n.message && n.message.toLowerCase().includes(query))
      );
    }

    return filtered;
  }, [notifications, activeTab, searchQuery]);

  // Pagination
  const totalPages = Math.ceil(filteredNotifications.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const paginatedNotifications = filteredNotifications.slice(startIndex, endIndex);

  // Calculate approver amount
  const approverAmount = useMemo(() => {
    const percentage = parseFloat(approverPercentage) || 0;
    return (lineItemTotal * percentage / 100).toFixed(2);
  }, [lineItemTotal, approverPercentage]);

  // Mark all as read
  const handleMarkAllAsRead = async () => {
    try {
      const unreadIds = notifications.filter(n => !n.read_at).map(n => n.id);
      if (unreadIds.length === 0) return;

      const { error } = await supabase
        .from('general_notification')
        .update({ read_at: new Date().toISOString() })
        .in('id', unreadIds);

      if (error) throw error;

      setNotifications(notifications.map(n => ({
        ...n,
        read_at: n.read_at || new Date().toISOString()
      })));
      toast.success('All notifications marked as read');
    } catch (err) {
      console.error('Error marking all as read:', err);
      toast.error('Failed to mark all as read');
    }
  };

  // Mark single as read
  const handleMarkAsRead = async (id: string) => {
    const notification = notifications.find(n => n.id === id);
    if (notification?.read_at) return;

    try {
      const { error } = await supabase
        .from('general_notification')
        .update({ read_at: new Date().toISOString() })
        .eq('id', id);

      if (error) throw error;

      setNotifications(notifications.map(n =>
        n.id === id ? { ...n, read_at: new Date().toISOString() } : n
      ));
    } catch (err) {
      console.error('Error marking as read:', err);
    }
  };

  // Handle view click - open modal
  const handleView = async (notification: NotificationData) => {
    handleMarkAsRead(notification.id);
    setSelectedNotification(notification);
    setIsModalOpen(true);
    await fetchLineItems(notification);
  };

  // Handle resend click - open resend modal
  const handleResend = async (notification: NotificationData) => {
    setResendNotification(notification);
    setApproverDropdownOpen(false);
    await fetchLineItemDetails(notification);
    setIsResendModalOpen(true);
  };

  // Handle resend email submission
  const handleResendEmail = async () => {
    if (!selectedApproverId) {
      toast.error('Please select an approver');
      return;
    }

    if (!approverPercentage || parseFloat(approverPercentage) <= 0) {
      toast.error('Please enter a valid percentage');
      return;
    }

    const lineItemId = resendNotification?.data?.line_item_id;
    if (!lineItemId) {
      toast.error('Line item not found');
      return;
    }

    setIsResending(true);
    try {
      const percentage = parseFloat(approverPercentage);
      const amount = parseFloat(approverAmount);

      // Update the line item with new approver
      const { error: updateError } = await supabase
        .from('accounts_payable_invoice_line_item')
        .update({
          approver_id: selectedApproverId,
          approver_percentage: percentage,
          approver_amount: amount,
          approval_status: 'pending',
          approval_notes: null,
          approved_at: null,
        })
        .eq('id', lineItemId);

      if (updateError) throw updateError;

      // Get approver details for email
      const selectedProvider = providers.find(p => p.id === selectedApproverId);

      // Get invoice details
      const invoiceId = resendNotification?.associate_id || resendNotification?.data?.entity_id;

      if (invoiceId && selectedProvider?.email) {
        // Fetch invoice details for the email
        const { data: invoiceData } = await supabase
          .from('accounts_payable_invoice')
          .select('invoice_number, invoice_date, vendor_name, currency')
          .eq('id', invoiceId)
          .single();

        // Fetch the updated line item
        const { data: lineItemData } = await supabase
          .from('accounts_payable_invoice_line_item')
          .select('id, description, line_total, approval_status, approver_amount')
          .eq('id', lineItemId)
          .single();

        // Build the approval link (format: /approve/{invoiceId}/{approverId})
        const baseUrl = window.location.origin;
        const approvalLink = `${baseUrl}/approve/${invoiceId}/${selectedApproverId}`;

        // Build email payload
        const emailPayload = {
          approver_name: selectedProvider.name,
          approver_email: selectedProvider.email,
          invoice_number: invoiceData?.invoice_number || 'N/A',
          invoice_date: invoiceData?.invoice_date || new Date().toISOString().split('T')[0],
          vendor_name: invoiceData?.vendor_name || 'N/A',
          line_items: lineItemData ? [{
            item_number: 1,
            description: lineItemData.description || 'N/A',
            status: 'Pending',
            approver_amount: amount,
          }] : [],
          total_approver_amount: amount,
          currency: invoiceData?.currency || 'GBP',
          approval_link: approvalLink,
        };

        // Call the send-approver-notification edge function
        const { error: emailError } = await supabase.functions.invoke('send-approver-notification', {
          body: emailPayload,
        });

        if (emailError) {
          console.error('Error sending email:', emailError);
          toast.warning('Approver updated but email failed to send');
        } else {
          toast.success('Email sent successfully to ' + selectedProvider.name);
        }
      } else {
        toast.success('Approver updated successfully');
      }

      setIsResendModalOpen(false);
      fetchNotifications(); // Refresh notifications
    } catch (err) {
      console.error('Error resending:', err);
      toast.error('Failed to resend email');
    } finally {
      setIsResending(false);
    }
  };

  // Get status badge
  const getStatusBadge = (status: string | null) => {
    switch (status) {
      case 'approved':
        return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-100">approved</Badge>;
      case 'rejected':
        return <Badge className="bg-red-100 text-red-700 border-red-200 hover:bg-red-100">rejected</Badge>;
      case 'pending':
        return <Badge className="bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-100">pending</Badge>;
      default:
        return <Badge variant="outline">{status || '-'}</Badge>;
    }
  };

  // Count unread
  const unreadCount = notifications.filter(n => !n.read_at).length;

  // Extract invoice number from notification data or message
  const getInvoiceNumber = (notification: NotificationData) => {
    if (notification.data?.entity_name) {
      const match = notification.data.entity_name.match(/#(\d+)/);
      return match ? match[1] : '-';
    }
    if (notification.message) {
      const match = notification.message.match(/#(\d+)/);
      return match ? match[1] : '-';
    }
    return '-';
  };

  if (isLoading) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <Helmet>
        <title>Notifications</title>
        <meta name="description" content="Manage system notifications, alerts, and email settings for practice updates and approvals." />
      </Helmet>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">Notifications</h1>
          <Button
            onClick={handleMarkAllAsRead}
            className="bg-indigo-600 hover:bg-indigo-700 text-white gap-2"
            disabled={unreadCount === 0}
          >
            <CheckCircle2 className="w-4 h-4" />
            Mark All as Read
          </Button>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          {/* Tabs */}
          <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-lg">
            <button
              onClick={() => { setActiveTab('all'); setCurrentPage(1); }}
              className={cn(
                'flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-colors',
                activeTab === 'all'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              )}
            >
              <Bell className="w-4 h-4" />
              All
            </button>
            <button
              onClick={() => { setActiveTab('unread'); setCurrentPage(1); }}
              className={cn(
                'flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-colors',
                activeTab === 'unread'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              )}
            >
              <span className="w-2 h-2 bg-indigo-600 rounded-full" />
              Unread
              {unreadCount > 0 && (
                <span className="text-xs bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded-full">
                  {unreadCount}
                </span>
              )}
            </button>
            <button
              onClick={() => { setActiveTab('read'); setCurrentPage(1); }}
              className={cn(
                'flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-colors',
                activeTab === 'read'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              )}
            >
              <CheckCircle2 className="w-4 h-4" />
              Read
            </button>
          </div>

          {/* Search */}
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              type="search"
              placeholder="Search notifications..."
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
              className="pl-10 h-10 border-gray-200"
            />
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          {/* Table Header */}
          <div className="grid grid-cols-[auto_1fr_2fr_auto_auto] gap-4 px-4 py-3 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wider">
            <div className="w-10 flex items-center justify-center">
              <Bell className="w-4 h-4" />
            </div>
            <div>Title</div>
            <div>Message</div>
            <div className="text-right">Update Time</div>
            <div className="w-20 text-center">View</div>
          </div>

          {/* Table Body */}
          {paginatedNotifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Bell className="w-12 h-12 text-gray-300 mb-3" />
              <p className="text-gray-500">No notifications found</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {paginatedNotifications.map((notification) => {
                const iconConfig = getIconConfig(notification.notification_type, notification.data);
                const IconComponent = iconConfig.icon;
                const isRead = !!notification.read_at;
                const isRejected = notification.notification_type === 'rejected' || notification.data?.action === 'rejected';

                return (
                  <div
                    key={notification.id}
                    className={cn(
                      'grid grid-cols-[auto_1fr_2fr_auto_auto] gap-4 px-4 py-4 items-center transition-colors hover:bg-gray-50',
                      !isRead && 'bg-indigo-50/30'
                    )}
                  >
                    {/* Icon */}
                    <div className="w-10 flex items-center justify-center">
                      <div className={cn(
                        'w-9 h-9 rounded-full flex items-center justify-center',
                        iconConfig.bg
                      )}>
                        <IconComponent className={cn('w-5 h-5', iconConfig.color)} />
                      </div>
                    </div>

                    {/* Title */}
                    <div className={cn(
                      'text-sm truncate',
                      !isRead ? 'font-semibold text-gray-900' : 'font-medium text-gray-700'
                    )}>
                      {notification.title}
                    </div>

                    {/* Message */}
                    <div className={cn(
                      'text-sm truncate',
                      isRejected ? 'text-red-600' : 'text-gray-500'
                    )}>
                      {notification.message || 'No message'}
                    </div>

                    {/* Time */}
                    <div className="text-sm text-gray-400 text-right whitespace-nowrap">
                      {formatTimeAgo(notification.created_at)}
                    </div>

                    {/* Actions */}
                    <div className="w-20 flex items-center justify-center gap-2">
                      <button
                        onClick={() => handleView(notification)}
                        className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors"
                        title="View"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      {isRejected && (
                        <button
                          onClick={() => handleResend(notification)}
                          className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors"
                          title="Resend"
                        >
                          <Send className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Pagination */}
          {filteredNotifications.length > ITEMS_PER_PAGE && (
            <div className="flex items-center justify-center gap-4 px-4 py-3 border-t border-gray-200 bg-gray-50">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="gap-1"
              >
                <ChevronLeft className="w-4 h-4" />
                Previous
              </Button>
              <span className="text-sm text-gray-500">
                Showing {startIndex + 1}-{Math.min(endIndex, filteredNotifications.length)} of {filteredNotifications.length}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="gap-1"
              >
                Next
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Notification Detail Modal */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-2xl bg-white">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold text-gray-900">
              {selectedNotification?.title}
            </DialogTitle>
          </DialogHeader>

          {selectedNotification && (
            <div className="space-y-4">
              {/* Details Grid */}
              <div className="space-y-3">
                <div className="flex">
                  <span className="w-32 text-sm font-medium text-gray-500">Title:</span>
                  <span className="text-sm text-indigo-600">{selectedNotification.title}</span>
                </div>
                <div className="flex">
                  <span className="w-32 text-sm font-medium text-gray-500">Message:</span>
                  <span className="text-sm text-indigo-600 flex-1">{selectedNotification.message || '-'}</span>
                </div>
                <div className="flex">
                  <span className="w-32 text-sm font-medium text-gray-500">Invoice Number:</span>
                  <span className="text-sm text-indigo-600">{getInvoiceNumber(selectedNotification)}</span>
                </div>
                <div className="flex">
                  <span className="w-32 text-sm font-medium text-gray-500">Approver:</span>
                  <span className="text-sm text-indigo-600">{selectedNotification.data?.action_by_name || '-'}</span>
                </div>
                {(selectedNotification.reason || selectedNotification.data?.notes) && (
                  <div className="flex">
                    <span className="w-32 text-sm font-medium text-gray-500">Reason:</span>
                    <span className="text-sm text-indigo-600">{selectedNotification.reason || selectedNotification.data?.notes}</span>
                  </div>
                )}
                <div className="flex">
                  <span className="w-32 text-sm font-medium text-gray-500">Date:</span>
                  <span className="text-sm text-indigo-600">{formatDateTime(selectedNotification.created_at)}</span>
                </div>
              </div>

              {/* Items Table */}
              <div className="mt-6">
                <h4 className="text-sm font-semibold text-gray-900 mb-3">
                  Items ({lineItems.length})
                </h4>

                {isLoadingItems ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
                  </div>
                ) : lineItems.length === 0 ? (
                  <div className="text-center py-4 text-gray-500 text-sm">
                    No items found
                  </div>
                ) : (
                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-gray-50">
                          <TableHead className="text-xs font-semibold text-gray-600">Description</TableHead>
                          <TableHead className="text-xs font-semibold text-gray-600 text-center">Quantity</TableHead>
                          <TableHead className="text-xs font-semibold text-gray-600 text-right">Unit Price</TableHead>
                          <TableHead className="text-xs font-semibold text-gray-600 text-right">Total</TableHead>
                          <TableHead className="text-xs font-semibold text-gray-600 text-center">Status</TableHead>
                          <TableHead className="text-xs font-semibold text-gray-600">Notes</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {lineItems.map((item) => (
                          <TableRow key={item.id}>
                            <TableCell className="text-sm text-gray-700">
                              {item.description || '-'}
                            </TableCell>
                            <TableCell className="text-sm text-gray-700 text-center">
                              {item.quantity?.toFixed(3) || '-'}
                            </TableCell>
                            <TableCell className="text-sm text-gray-700 text-right">
                              {item.unit_price?.toFixed(2) || '-'}
                            </TableCell>
                            <TableCell className="text-sm text-gray-700 text-right">
                              {item.line_total?.toFixed(2) || '-'}
                            </TableCell>
                            <TableCell className="text-center">
                              {getStatusBadge(item.approval_status)}
                            </TableCell>
                            <TableCell className="text-sm text-gray-500">
                              {item.approval_notes || '-'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Resend Approver Email Modal */}
      <Dialog open={isResendModalOpen} onOpenChange={setIsResendModalOpen}>
        <DialogContent className="max-w-md bg-white">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold text-gray-900">
              Resend Approver Email
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Select Approver */}
            <div className="space-y-2">
              <Label htmlFor="approver" className="text-sm font-medium text-gray-700">
                Select Approver <span className="text-red-500">*</span>
              </Label>
              <Popover open={approverDropdownOpen} onOpenChange={setApproverDropdownOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={approverDropdownOpen}
                    className="w-full justify-between border-gray-300 font-normal"
                  >
                    {selectedApproverId
                      ? providers.find((p) => p.id === selectedApproverId)?.name
                      : "Select approver..."}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[360px] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search approver..." />
                    <CommandList>
                      {isLoadingProviders ? (
                        <div className="flex items-center justify-center py-6">
                          <Loader2 className="w-5 h-5 animate-spin text-indigo-600" />
                        </div>
                      ) : providers.length === 0 ? (
                        <CommandEmpty>No approver found.</CommandEmpty>
                      ) : (
                        <CommandGroup>
                          {providers.map((provider) => (
                            <CommandItem
                              key={provider.id}
                              value={provider.name}
                              onSelect={() => {
                                setSelectedApproverId(provider.id);
                                setApproverDropdownOpen(false);
                              }}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  selectedApproverId === provider.id ? "opacity-100" : "opacity-0"
                                )}
                              />
                              {provider.name}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      )}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            {/* Approver Percentage */}
            <div className="space-y-2">
              <Label htmlFor="percentage" className="text-sm font-medium text-gray-700">
                Approver Percentage <span className="text-red-500">*</span>
              </Label>
              <div className="relative">
                <Input
                  id="percentage"
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={approverPercentage}
                  onChange={(e) => setApproverPercentage(e.target.value)}
                  className="pr-8 border-gray-300"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">%</span>
              </div>
            </div>

            {/* Approver Amount (Read-only) */}
            <div className="space-y-2">
              <Label className="text-sm font-medium text-gray-700">
                Approver Amount
              </Label>
              <Input
                type="text"
                value={approverAmount}
                readOnly
                className="bg-gray-50 border-gray-300 text-gray-700"
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setIsResendModalOpen(false)}
              disabled={isResending}
              className="border-gray-300"
            >
              Cancel
            </Button>
            <Button
              onClick={handleResendEmail}
              disabled={isResending || !selectedApproverId}
              className="bg-indigo-600 hover:bg-indigo-700 text-white gap-2"
            >
              {isResending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              Resend Email
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
