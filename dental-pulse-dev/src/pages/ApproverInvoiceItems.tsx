import { useState, useMemo, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Eye, Clock, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { useApproverInvoiceItems, ApproverLineItem } from '@/hooks/useApproverInvoiceItems';
import { ApprovalDetailModal } from '@/components/accounts-payable/ApprovalDetailModal';

export default function ApproverInvoiceItems() {
  const { invoiceId: urlInvoiceId } = useParams<{ invoiceId?: string }>();
  const [activeTab, setActiveTab] = useState('pending');
  const [entriesPerPage, setEntriesPerPage] = useState('25');
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const {
    pendingItems,
    approvedItems,
    rejectedItems,
    isLoading,
    error,
    approveItem,
    rejectItem,
    bulkApproveItems,
    bulkRejectItems,
  } = useApproverInvoiceItems();

  // Auto-open modal if invoice ID is in URL (from email link)
  useEffect(() => {
    if (urlInvoiceId && !isLoading && pendingItems.length > 0) {
      const hasItemsForInvoice = pendingItems.some(
        item => item.accounts_payable_invoice_id === urlInvoiceId
      );
      if (hasItemsForInvoice) {
        setSelectedInvoiceId(urlInvoiceId);
        setIsModalOpen(true);
      }
    }
  }, [urlInvoiceId, isLoading, pendingItems]);

  // Get current items based on active tab
  const currentItems = useMemo(() => {
    switch (activeTab) {
      case 'pending':
        return pendingItems;
      case 'approved':
        return approvedItems;
      case 'rejected':
        return rejectedItems;
      default:
        return [];
    }
  }, [activeTab, pendingItems, approvedItems, rejectedItems]);

  // Group items by invoice for display
  const groupedItems = useMemo(() => {
    const grouped: Record<string, ApproverLineItem[]> = {};
    currentItems.forEach(item => {
      const invoiceId = item.accounts_payable_invoice_id;
      if (!grouped[invoiceId]) {
        grouped[invoiceId] = [];
      }
      grouped[invoiceId].push(item);
    });
    return grouped;
  }, [currentItems]);

  // Flatten for table display (each line item is a row)
  const tableItems = useMemo(() => {
    const limit = parseInt(entriesPerPage);
    return currentItems.slice(0, limit);
  }, [currentItems, entriesPerPage]);

  // Get items for selected invoice (for modal)
  const selectedInvoiceItems = useMemo(() => {
    if (!selectedInvoiceId) return [];
    return pendingItems.filter(item => item.accounts_payable_invoice_id === selectedInvoiceId);
  }, [selectedInvoiceId, pendingItems]);

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

  // Handle view click
  const handleViewClick = (invoiceId: string) => {
    setSelectedInvoiceId(invoiceId);
    setIsModalOpen(true);
  };

  // Get status badge
  const getStatusBadge = (status: string | null) => {
    switch (status) {
      case 'pending':
        return <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200">Pending</Badge>;
      case 'approved':
        return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">Approved</Badge>;
      case 'rejected':
        return <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">Rejected</Badge>;
      default:
        return <Badge variant="outline">Unknown</Badge>;
    }
  };

  if (isLoading) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
          <span className="ml-2 text-gray-600">Loading your assigned items...</span>
        </div>
      </MainLayout>
    );
  }

  if (error) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center h-64">
          <p className="text-red-500">Error loading items: {(error as Error).message}</p>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <Helmet>
        <title>Approve Invoice Line Items</title>
        <meta
          name="description"
          content="Manage pending, approved, and rejected invoice line items with detailed approval and bulk action capabilities."
        />
      </Helmet>
      <div className="space-y-6">
        {/* Page Header */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Approval Items</h1>
          <p className="text-gray-500 mt-1">Review and approve invoice items assigned to you</p>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="border-b w-full justify-start rounded-none bg-transparent p-0">
            <TabsTrigger
              value="pending"
              className="relative rounded-none border-b-2 border-transparent data-[state=active]:border-indigo-600 data-[state=active]:text-indigo-600 data-[state=active]:shadow-none bg-transparent px-4 py-2"
            >
              <Clock className="w-4 h-4 mr-2" />
              Pending Invoice Items
              {pendingItems.length > 0 && (
                <Badge className="ml-2 bg-yellow-100 text-yellow-800 hover:bg-yellow-100">
                  {pendingItems.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger
              value="approved"
              className="relative rounded-none border-b-2 border-transparent data-[state=active]:border-green-600 data-[state=active]:text-green-600 data-[state=active]:shadow-none bg-transparent px-4 py-2"
            >
              <CheckCircle2 className="w-4 h-4 mr-2" />
              Approved Invoice Items
              {approvedItems.length > 0 && (
                <Badge className="ml-2 bg-green-100 text-green-800 hover:bg-green-100">
                  {approvedItems.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger
              value="rejected"
              className="relative rounded-none border-b-2 border-transparent data-[state=active]:border-red-600 data-[state=active]:text-red-600 data-[state=active]:shadow-none bg-transparent px-4 py-2"
            >
              <XCircle className="w-4 h-4 mr-2" />
              Rejected Items
              {rejectedItems.length > 0 && (
                <Badge className="ml-2 bg-red-100 text-red-800 hover:bg-red-100">
                  {rejectedItems.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value={activeTab} className="mt-4">
            <Card>
              <CardContent className="pt-6">
                {/* Entries Per Page */}
                <div className="flex items-center gap-2 mb-4">
                  <span className="text-sm text-gray-600">Show</span>
                  <Select value={entriesPerPage} onValueChange={setEntriesPerPage}>
                    <SelectTrigger className="w-20">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="10">10</SelectItem>
                      <SelectItem value="25">25</SelectItem>
                      <SelectItem value="50">50</SelectItem>
                      <SelectItem value="100">100</SelectItem>
                    </SelectContent>
                  </Select>
                  <span className="text-sm text-gray-600">entries</span>
                </div>

                {/* Table */}
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-gray-50">
                        <TableHead className="font-semibold text-gray-600 w-12">#</TableHead>
                        <TableHead className="font-semibold text-gray-600">Invoice</TableHead>
                        <TableHead className="font-semibold text-gray-600">Vendor</TableHead>
                        <TableHead className="font-semibold text-gray-600">Line Items</TableHead>
                        <TableHead className="font-semibold text-gray-600">Approver Amount</TableHead>
                        <TableHead className="font-semibold text-gray-600 text-center">Status</TableHead>
                        <TableHead className="font-semibold text-gray-600">
                          {activeTab === 'pending' ? 'Assigned At' : 'Approved At'}
                        </TableHead>
                        <TableHead className="font-semibold text-gray-600 text-center">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {tableItems.length > 0 ? (
                        tableItems.map((item, index) => (
                          <TableRow key={item.id} className="hover:bg-gray-50">
                            <TableCell className="font-medium">{index + 1}</TableCell>
                            <TableCell>
                              <a
                                href="#"
                                onClick={(e) => {
                                  e.preventDefault();
                                  handleViewClick(item.accounts_payable_invoice_id);
                                }}
                                className="text-indigo-600 hover:text-indigo-800 hover:underline font-medium"
                              >
                                {item.invoice?.invoice_number || item.accounts_payable_invoice_id.slice(0, 8)}
                              </a>
                            </TableCell>
                            <TableCell>{item.invoice?.vendor_name || 'Unknown'}</TableCell>
                            <TableCell className="max-w-xs">
                              <div className="line-clamp-1">{item.description || 'No description'}</div>
                              {item.description && item.description.length > 50 && (
                                <button
                                  onClick={() => handleViewClick(item.accounts_payable_invoice_id)}
                                  className="text-indigo-600 text-xs hover:underline"
                                >
                                  Show more
                                </button>
                              )}
                            </TableCell>
                            <TableCell>{formatCurrency(item.approver_amount)}</TableCell>
                            <TableCell className="text-center">{getStatusBadge(item.approval_status)}</TableCell>
                            <TableCell>
                              {activeTab === 'pending'
                                ? formatDate(item.assigned_at)
                                : formatDate(item.approved_at)
                              }
                            </TableCell>
                            <TableCell className="text-center">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleViewClick(item.accounts_payable_invoice_id)}
                                className="text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50"
                              >
                                <Eye className="w-4 h-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell colSpan={8} className="text-center py-12 text-gray-500">
                            {activeTab === 'pending' && 'No pending items to approve'}
                            {activeTab === 'approved' && 'No approved items yet'}
                            {activeTab === 'rejected' && 'No rejected items'}
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>

                {/* Items count */}
                <div className="mt-4 text-sm text-gray-500">
                  Showing {Math.min(tableItems.length, parseInt(entriesPerPage))} of {currentItems.length} entries
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Approval Detail Modal */}
      <ApprovalDetailModal
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        items={selectedInvoiceId ? currentItems.filter(item => item.accounts_payable_invoice_id === selectedInvoiceId) : []}
        invoiceId={selectedInvoiceId || ''}
        onApprove={approveItem}
        onReject={rejectItem}
        onBulkApprove={bulkApproveItems}
        onBulkReject={bulkRejectItems}
      />
    </MainLayout>
  );
}
