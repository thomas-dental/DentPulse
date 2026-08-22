/**
 * useApproverInvoiceItems Hook
 * Fetches invoice line items assigned to the current user (as approver)
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface ApproverLineItem {
  id: string;
  accounts_payable_invoice_id: string;
  description: string | null;
  quantity: number | null;
  unit_price: number | null;
  line_total: number | null;
  approval_status: 'pending' | 'approved' | 'rejected' | null;
  approver_id: string | null;
  assigned_at: string | null;
  approver_amount: number | null;
  approver_percentage: number | null;
  approved_at: string | null;
  approval_notes: string | null;
  // Invoice details (joined)
  invoice?: {
    id: string;
    invoice_number: string | null;
    vendor_name: string | null;
    invoice_date: string | null;
    due_date: string | null;
    currency: string | null;
    total_amount: number | null;
  };
}

export function useApproverInvoiceItems() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Get the provider ID for the current user
  const { data: providerId, isLoading: isLoadingProvider } = useQuery({
    queryKey: ['provider-id-for-user', user?.id],
    queryFn: async () => {
      if (!user?.id) return null;

      // First try to find provider by user_id
      const { data: providerByUserId, error: error1 } = await supabase
        .from('providers')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (providerByUserId?.id) {
        return providerByUserId.id;
      }

      // If not found, try to find by email
      const { data: providerByEmail, error: error2 } = await supabase
        .from('providers')
        .select('id')
        .eq('email', user.email)
        .maybeSingle();

      return providerByEmail?.id || null;
    },
    enabled: !!user?.id,
  });

  // Fetch all line items assigned to this approver
  const {
    data: allItems,
    isLoading: isLoadingItems,
    error: itemsError,
    refetch: refetchItems,
  } = useQuery({
    queryKey: ['approver-invoice-items', providerId],
    queryFn: async () => {
      if (!providerId) return [];

      const { data, error } = await (supabase as any)
        .from('accounts_payable_invoice_line_item')
        .select(`
          *,
          invoice:accounts_payable_invoice(
            id,
            invoice_number,
            vendor_name,
            invoice_date,
            due_date,
            currency,
            total_amount
          )
        `)
        .eq('approver_id', providerId)
        .not('approval_status', 'is', null)
        .order('assigned_at', { ascending: false });

      if (error) {
        console.error('Error fetching approver items:', error);
        throw error;
      }

      return data as ApproverLineItem[];
    },
    enabled: !!providerId,
  });

  // Filter items by status
  const pendingItems = allItems?.filter(item => item.approval_status === 'pending') || [];
  const approvedItems = allItems?.filter(item => item.approval_status === 'approved') || [];
  const rejectedItems = allItems?.filter(item => item.approval_status === 'rejected') || [];

  // Approve item mutation
  const approveItemMutation = useMutation({
    mutationFn: async ({ itemId, notes }: { itemId: string; notes?: string }) => {
      const { data, error } = await (supabase as any)
        .from('accounts_payable_invoice_line_item')
        .update({
          approval_status: 'approved',
          approved_at: new Date().toISOString(),
          approval_notes: notes || null,
        })
        .eq('id', itemId)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['approver-invoice-items'] });
    },
  });

  // Reject item mutation
  const rejectItemMutation = useMutation({
    mutationFn: async ({ itemId, notes }: { itemId: string; notes?: string }) => {
      const { data, error } = await (supabase as any)
        .from('accounts_payable_invoice_line_item')
        .update({
          approval_status: 'rejected',
          approved_at: new Date().toISOString(),
          approval_notes: notes || null,
        })
        .eq('id', itemId)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['approver-invoice-items'] });
    },
  });

  // Bulk approve items
  const bulkApproveItems = async (itemIds: string[], notes?: string) => {
    const promises = itemIds.map(id => approveItemMutation.mutateAsync({ itemId: id, notes }));
    return Promise.all(promises);
  };

  // Bulk reject items
  const bulkRejectItems = async (itemIds: string[], notes?: string) => {
    const promises = itemIds.map(id => rejectItemMutation.mutateAsync({ itemId: id, notes }));
    return Promise.all(promises);
  };

  return {
    // Data
    allItems: allItems || [],
    pendingItems,
    approvedItems,
    rejectedItems,
    providerId,

    // Loading states
    isLoading: isLoadingProvider || isLoadingItems,
    error: itemsError,

    // Actions
    approveItem: approveItemMutation.mutateAsync,
    rejectItem: rejectItemMutation.mutateAsync,
    bulkApproveItems,
    bulkRejectItems,
    refetchItems,

    // Mutation states
    isApproving: approveItemMutation.isPending,
    isRejecting: rejectItemMutation.isPending,
  };
}
