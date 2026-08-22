import { useState } from 'react';
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Check, X, Loader2 } from 'lucide-react';
import { ApproverLineItem } from '@/hooks/useApproverInvoiceItems';
import { toast } from 'sonner';

interface ApprovalDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: ApproverLineItem[];
  invoiceId: string;
  onApprove: (itemId: string, notes?: string) => Promise<any>;
  onReject: (itemId: string, notes?: string) => Promise<any>;
  onBulkApprove: (itemIds: string[], notes?: string) => Promise<any>;
  onBulkReject: (itemIds: string[], notes?: string) => Promise<any>;
}

export function ApprovalDetailModal({
  open,
  onOpenChange,
  items,
  invoiceId,
  onApprove,
  onReject,
  onBulkApprove,
  onBulkReject,
}: ApprovalDetailModalProps) {
  const [isApproving, setIsApproving] = useState<Record<string, boolean>>({});
  const [isRejecting, setIsRejecting] = useState<Record<string, boolean>>({});
  const [isBulkApproving, setIsBulkApproving] = useState(false);
  const [isBulkRejecting, setIsBulkRejecting] = useState(false);

  if (!items.length) return null;

  const invoice = items[0]?.invoice;
  const pendingItems = items.filter(item => item.approval_status === 'pending');
  const pendingCount = pendingItems.length;

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

  // Calculate total approver amount
  const totalApproverAmount = items.reduce((sum, item) => sum + (item.approver_amount || 0), 0);

  // Handle single item approve
  const handleApprove = async (itemId: string) => {
    setIsApproving(prev => ({ ...prev, [itemId]: true }));
    try {
      await onApprove(itemId);
      toast.success('Item approved successfully');
    } catch (error) {
      console.error('Error approving item:', error);
      toast.error('Failed to approve item');
    } finally {
      setIsApproving(prev => ({ ...prev, [itemId]: false }));
    }
  };

  // Handle single item reject
  const handleReject = async (itemId: string) => {
    setIsRejecting(prev => ({ ...prev, [itemId]: true }));
    try {
      await onReject(itemId);
      toast.success('Item rejected');
    } catch (error) {
      console.error('Error rejecting item:', error);
      toast.error('Failed to reject item');
    } finally {
      setIsRejecting(prev => ({ ...prev, [itemId]: false }));
    }
  };

  // Handle bulk approve
  const handleBulkApprove = async () => {
    if (pendingItems.length === 0) return;
    setIsBulkApproving(true);
    try {
      const itemIds = pendingItems.map(item => item.id);
      await onBulkApprove(itemIds);
      toast.success(`${itemIds.length} items approved successfully`);
    } catch (error) {
      console.error('Error bulk approving:', error);
      toast.error('Failed to approve items');
    } finally {
      setIsBulkApproving(false);
    }
  };

  // Handle bulk reject
  const handleBulkReject = async () => {
    if (pendingItems.length === 0) return;
    setIsBulkRejecting(true);
    try {
      const itemIds = pendingItems.map(item => item.id);
      await onBulkReject(itemIds);
      toast.success(`${itemIds.length} items rejected`);
    } catch (error) {
      console.error('Error bulk rejecting:', error);
      toast.error('Failed to reject items');
    } finally {
      setIsBulkRejecting(false);
    }
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto p-0">
        <div className="p-6">
          {/* Header */}
          <div className="flex items-start justify-between mb-6">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">Invoice Details</h2>
              <p className="text-gray-500">Invoice #{invoice?.invoice_number || invoiceId.slice(0, 8)}</p>
            </div>
            {pendingCount > 0 && (
              <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100">
                {pendingCount} Pending
              </Badge>
            )}
          </div>

          {/* Invoice Info Card */}
          <div className="bg-gray-50 rounded-lg p-4 mb-6">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Vendor</p>
                <p className="text-sm font-medium text-gray-900 mt-1">{invoice?.vendor_name || 'Unknown'}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Invoice Date</p>
                <p className="text-sm text-gray-900 mt-1">{formatDate(invoice?.invoice_date)}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Due Date</p>
                <p className="text-sm text-gray-900 mt-1">{formatDate(invoice?.due_date)}</p>
              </div>
            </div>
          </div>

          {/* Total Amount Display */}
          <div className="bg-indigo-50 rounded-lg p-6 mb-6 text-center">
            <p className="text-4xl font-bold text-indigo-600">{formatCurrency(totalApproverAmount)}</p>
          </div>

          {/* Invoice Items Section */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Invoice Items</h3>
                <p className="text-sm text-gray-500">Review and approve individual items</p>
              </div>
              {pendingCount > 0 && (
                <div className="flex gap-2">
                  <Button
                    onClick={handleBulkApprove}
                    disabled={isBulkApproving || isBulkRejecting}
                    className="bg-green-600 hover:bg-green-700 text-white"
                  >
                    {isBulkApproving ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Check className="w-4 h-4 mr-2" />
                    )}
                    Approve All
                  </Button>
                  <Button
                    onClick={handleBulkReject}
                    disabled={isBulkApproving || isBulkRejecting}
                    variant="destructive"
                  >
                    {isBulkRejecting ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <X className="w-4 h-4 mr-2" />
                    )}
                    Reject All
                  </Button>
                </div>
              )}
            </div>

            {/* Items Table */}
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-indigo-600 hover:bg-indigo-600">
                    <TableHead className="text-white font-medium w-16">Item</TableHead>
                    <TableHead className="text-white font-medium">Description</TableHead>
                    <TableHead className="text-white font-medium text-right">Approver Amount</TableHead>
                    <TableHead className="text-white font-medium text-center">Status</TableHead>
                    <TableHead className="text-white font-medium text-center">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item, index) => (
                    <TableRow key={item.id} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <TableCell className="font-medium">{index + 1}</TableCell>
                      <TableCell className="max-w-xs">
                        <div className="line-clamp-2">{item.description || 'No description'}</div>
                      </TableCell>
                      <TableCell className="text-right">{formatCurrency(item.approver_amount)}</TableCell>
                      <TableCell className="text-center">{getStatusBadge(item.approval_status)}</TableCell>
                      <TableCell className="text-center">
                        {item.approval_status === 'pending' ? (
                          <div className="flex justify-center gap-2">
                            <Button
                              size="sm"
                              onClick={() => handleApprove(item.id)}
                              disabled={isApproving[item.id] || isRejecting[item.id]}
                              className="bg-green-600 hover:bg-green-700 text-white h-8"
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
                              variant="destructive"
                              onClick={() => handleReject(item.id)}
                              disabled={isApproving[item.id] || isRejecting[item.id]}
                              className="h-8"
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
                          <span className="text-sm text-gray-500">
                            {item.approved_at ? formatDate(item.approved_at) : '-'}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
