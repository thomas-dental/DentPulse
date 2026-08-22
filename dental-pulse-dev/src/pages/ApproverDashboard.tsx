import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, Eye, XCircle } from 'lucide-react';
import { Toaster } from 'sonner';
import { createClient } from '@supabase/supabase-js';

// Create anonymous Supabase client for public access
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const anonSupabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  }
});

interface InvoiceWithItems {
  id: string;
  invoice_number: string | null;
  vendor_name: string | null;
  invoice_date: string | null;
  due_date: string | null;
  currency: string | null;
  total_amount: number | null;
  pending_count: number;
  total_approver_amount: number;
}

export default function ApproverDashboard() {
  const { approverId } = useParams<{ approverId: string }>();
  const navigate = useNavigate();
  const [invoices, setInvoices] = useState<InvoiceWithItems[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [approverName, setApproverName] = useState<string>('');

  // Fetch invoices assigned to this approver
  useEffect(() => {
    const fetchData = async () => {
      if (!approverId) {
        setError('Invalid approver link');
        setIsLoading(false);
        return;
      }

      try {
        // Fetch approver name
        const { data: providerData } = await anonSupabase
          .from('provider')
          .select('name')
          .eq('id', approverId)
          .single();

        if (providerData) {
          setApproverName(providerData.name);
        }

        // Fetch all line items assigned to this approver
        const { data: lineItems, error: itemsError } = await anonSupabase
          .from('accounts_payable_invoice_line_item')
          .select(`
            id,
            accounts_payable_invoice_id,
            approval_status,
            approver_amount,
            accounts_payable_invoice:accounts_payable_invoice_id (
              id,
              invoice_number,
              vendor_name,
              invoice_date,
              due_date,
              currency,
              total_amount
            )
          `)
          .eq('approver_id', approverId);

        if (itemsError) {
          console.error('Error fetching line items:', itemsError);
          throw new Error('Failed to load invoices');
        }

        // Group by invoice and calculate totals
        const invoiceMap = new Map<string, InvoiceWithItems>();

        (lineItems || []).forEach((item: any) => {
          if (!item.accounts_payable_invoice) return;

          const invoice = item.accounts_payable_invoice;
          const invoiceId = invoice.id;

          if (!invoiceMap.has(invoiceId)) {
            invoiceMap.set(invoiceId, {
              id: invoice.id,
              invoice_number: invoice.invoice_number,
              vendor_name: invoice.vendor_name,
              invoice_date: invoice.invoice_date,
              due_date: invoice.due_date,
              currency: invoice.currency,
              total_amount: invoice.total_amount,
              pending_count: 0,
              total_approver_amount: 0,
            });
          }

          const existing = invoiceMap.get(invoiceId)!;
          existing.total_approver_amount += item.approver_amount || 0;
          if (item.approval_status === 'pending') {
            existing.pending_count += 1;
          }
        });

        setInvoices(Array.from(invoiceMap.values()));
      } catch (err: any) {
        console.error('Error:', err);
        setError(err.message || 'Failed to load invoices');
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [approverId]);

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

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#f8fafc] flex items-center justify-center px-4">
        <div className="flex items-center gap-2">
          <Loader2 className="w-5 h-5 sm:w-6 sm:h-6 animate-spin text-indigo-600" />
          <span className="text-sm sm:text-base text-gray-600">Loading dashboard...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#f8fafc] flex items-center justify-center px-3 sm:px-4">
        <Card className="max-w-md w-full bg-white border border-gray-200 shadow-sm">
          <CardContent className="pt-6 text-center px-4 sm:px-6">
            <XCircle className="w-10 h-10 sm:w-12 sm:h-12 text-red-500 mx-auto mb-3 sm:mb-4" />
            <h2 className="text-lg sm:text-xl font-semibold text-gray-900 mb-2">Error</h2>
            <p className="text-sm sm:text-base text-gray-500">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8fafc]">
      <Helmet>
        <title>Invoice Approval Dashboard</title>
        <meta name="description" content="Review and approve pending invoices assigned to you with detailed line item breakdown and approver controls." />
      </Helmet>
      <Toaster position="top-center" />

      {/* Header */}
      <div className="bg-[#1e293b] text-white py-3 sm:py-4">
        <div className="max-w-6xl mx-auto px-3 sm:px-4 lg:px-6 flex items-center gap-2 sm:gap-3">
          <div className="w-7 h-7 sm:w-8 sm:h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-xs sm:text-sm font-bold shrink-0">DP</div>
          <div className="min-w-0">
            <h1 className="text-base sm:text-lg font-semibold truncate">DentPulse Approver Dashboard</h1>
            {approverName && <p className="text-xs sm:text-sm text-gray-400 truncate">Welcome, {approverName}</p>}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-3 sm:px-4 lg:px-6 py-4 sm:py-6 lg:py-8">
        <div className="mb-4 sm:mb-6">
          <h2 className="text-xl sm:text-2xl font-bold text-gray-900">Your Assigned Invoices</h2>
          <p className="text-sm sm:text-base text-gray-500">Review and approve invoice items assigned to you</p>
        </div>

        {invoices.length === 0 ? (
          <Card className="bg-white border border-gray-200 shadow-sm">
            <CardContent className="pt-6 text-center py-8 sm:py-12 px-4">
              <div className="text-gray-400 mb-3 sm:mb-4">
                <svg className="w-12 h-12 sm:w-16 sm:h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <h3 className="text-base sm:text-lg font-medium text-gray-900 mb-2">No Pending Invoices</h3>
              <p className="text-sm sm:text-base text-gray-500">No invoices are currently assigned to you for approval.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 lg:gap-6">
            {invoices.map((invoice) => (
              <Card key={invoice.id} className="bg-white border border-gray-200 shadow-sm hover:shadow-md transition-all hover:border-indigo-200">
                <CardContent className="p-3 sm:p-4 lg:p-5">
                  {/* Header with vendor and badge */}
                  <div className="flex items-start justify-between mb-2 sm:mb-3 gap-2">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-sm sm:text-base text-gray-900 truncate">
                        {invoice.vendor_name || 'Unknown Vendor'}
                      </h3>
                      <p className="text-xs sm:text-sm text-gray-500 truncate">
                        Invoice #{invoice.invoice_number || invoice.id.slice(0, 8)}
                      </p>
                    </div>
                    {invoice.pending_count > 0 ? (
                      <Badge variant="outline" className="bg-amber-50 text-amber-600 border-amber-200 shrink-0 text-xs">
                        {invoice.pending_count} Pending
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="bg-emerald-50 text-emerald-600 border-emerald-200 shrink-0 text-xs">
                        Completed
                      </Badge>
                    )}
                  </div>

                  {/* Invoice details */}
                  <div className="bg-gray-50 rounded-lg p-2 sm:p-3 mb-3 sm:mb-4 border border-gray-100">
                    <div className="space-y-1.5 sm:space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] sm:text-xs font-medium text-gray-500 uppercase tracking-wide">Date</span>
                        <span className="text-xs sm:text-sm text-gray-900">{formatDate(invoice.invoice_date)}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] sm:text-xs font-medium text-gray-500 uppercase tracking-wide">Due Date</span>
                        <span className="text-xs sm:text-sm text-gray-900">{formatDate(invoice.due_date)}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] sm:text-xs font-medium text-gray-500 uppercase tracking-wide">Pending Items</span>
                        <span className="text-xs sm:text-sm font-medium text-indigo-600">{invoice.pending_count}</span>
                      </div>
                    </div>
                  </div>

                  {/* Amount */}
                  <div className="bg-indigo-50 rounded-lg p-2 sm:p-3 mb-3 sm:mb-4 text-center border border-indigo-100">
                    <p className="text-[10px] sm:text-xs text-indigo-600 mb-0.5 sm:mb-1">Total Amount</p>
                    <p className="text-xl sm:text-2xl font-bold text-indigo-600">{formatCurrency(invoice.total_approver_amount)}</p>
                  </div>

                  {/* View button */}
                  <Button
                    onClick={() => navigate(`/approve/${invoice.id}/${approverId}`)}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-white text-sm sm:text-base h-9 sm:h-10"
                  >
                    <Eye className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1.5 sm:mr-2" />
                    View Items
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="mt-8 sm:mt-12 pt-4 sm:pt-6 border-t border-gray-200 text-center text-xs sm:text-sm text-gray-500 px-2">
          <p>This is an automated approval dashboard from DentPulse.</p>
          <p className="mt-1">If you have any questions, please contact your administrator.</p>
        </div>
      </div>
    </div>
  );
}
