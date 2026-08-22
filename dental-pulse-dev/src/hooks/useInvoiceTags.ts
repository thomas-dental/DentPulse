import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { toast } from 'sonner';

export interface InvoiceTag {
  id: string;
  organization_id: string;
  location_id: string | null;
  name: string;
  color: string;
  created_at: string;
  updated_at: string;
}

export interface CreateTagInput {
  name: string;
  color?: string;
  location_id?: string | null;
}

export interface UpdateTagInput {
  name?: string;
  color?: string;
}

export function useInvoiceTags() {
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const [organizationId, setOrganizationId] = useState<string | null>(null);

  // Get organization ID
  useEffect(() => {
    const getOrganizationId = async () => {
      if (profile?.current_organization_id) {
        setOrganizationId(profile.current_organization_id);
        return;
      }

      if (user?.id) {
        const { data } = await supabase
          .from('user_roles')
          .select('organization_id')
          .eq('user_id', user.id)
          .limit(1)
          .maybeSingle();

        if (data?.organization_id) {
          setOrganizationId(data.organization_id);
        }
      }
    };

    if (user?.id) {
      getOrganizationId();
    }
  }, [user?.id, profile?.current_organization_id]);

  // Fetch all tags for the organization
  const {
    data: tags = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['invoice-tags', organizationId],
    queryFn: async () => {
      if (!organizationId) return [];

      const { data, error } = await supabase
        .from('invoice_tags')
        .select('*')
        .eq('organization_id', organizationId)
        .order('name', { ascending: true });

      if (error) throw error;
      return data as InvoiceTag[];
    },
    enabled: !!organizationId,
  });

  // Create tag mutation
  const createMutation = useMutation({
    mutationFn: async (input: CreateTagInput) => {
      if (!organizationId) throw new Error('No organization selected');

      const { data, error } = await supabase
        .from('invoice_tags')
        .insert({
          organization_id: organizationId,
          location_id: input.location_id || null,
          name: input.name,
          color: input.color || '#6366f1',
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoice-tags', organizationId] });
      toast.success('Tag created successfully');
    },
    onError: (error: Error) => {
      toast.error(`Failed to create tag: ${error.message}`);
    },
  });

  // Update tag mutation
  const updateMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: UpdateTagInput }) => {
      const { data, error } = await supabase
        .from('invoice_tags')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoice-tags', organizationId] });
      toast.success('Tag updated successfully');
    },
    onError: (error: Error) => {
      toast.error(`Failed to update tag: ${error.message}`);
    },
  });

  // Delete tag mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('invoice_tags')
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoice-tags', organizationId] });
      toast.success('Tag deleted successfully');
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete tag: ${error.message}`);
    },
  });

  // Get tags for a specific invoice
  const getInvoiceTags = async (invoiceId: string): Promise<InvoiceTag[]> => {
    const { data, error } = await supabase
      .from('invoice_tag_assignments')
      .select('tag_id, invoice_tags(*)')
      .eq('invoice_id', invoiceId);

    if (error) {
      console.error('Error fetching invoice tags:', error);
      return [];
    }

    return (data || []).map((item: any) => item.invoice_tags).filter(Boolean);
  };

  // Assign tags to an invoice (replaces all existing tags)
  const assignTagsToInvoice = async (invoiceId: string, tagIds: string[]) => {
    // First, remove all existing tag assignments for this invoice
    const { error: deleteError } = await supabase
      .from('invoice_tag_assignments')
      .delete()
      .eq('invoice_id', invoiceId);

    if (deleteError) {
      toast.error('Failed to update tags');
      throw deleteError;
    }

    // Then, insert new tag assignments
    if (tagIds.length > 0) {
      const assignments = tagIds.map(tagId => ({
        invoice_id: invoiceId,
        tag_id: tagId,
      }));

      const { error: insertError } = await supabase
        .from('invoice_tag_assignments')
        .insert(assignments);

      if (insertError) {
        toast.error('Failed to assign tags');
        throw insertError;
      }
    }

    queryClient.invalidateQueries({ queryKey: ['invoice-tags-for-invoice', invoiceId] });
  };

  // Add a single tag to an invoice
  const addTagToInvoice = async (invoiceId: string, tagId: string) => {
    const { error } = await supabase
      .from('invoice_tag_assignments')
      .insert({ invoice_id: invoiceId, tag_id: tagId });

    if (error) {
      if (error.code === '23505') {
        // Unique constraint violation - tag already assigned
        return;
      }
      toast.error('Failed to add tag');
      throw error;
    }

    queryClient.invalidateQueries({ queryKey: ['invoice-tags-for-invoice', invoiceId] });
  };

  // Remove a single tag from an invoice
  const removeTagFromInvoice = async (invoiceId: string, tagId: string) => {
    const { error } = await supabase
      .from('invoice_tag_assignments')
      .delete()
      .eq('invoice_id', invoiceId)
      .eq('tag_id', tagId);

    if (error) {
      toast.error('Failed to remove tag');
      throw error;
    }

    queryClient.invalidateQueries({ queryKey: ['invoice-tags-for-invoice', invoiceId] });
  };

  return {
    tags,
    isLoading,
    error,
    refetch,
    createTag: createMutation.mutate,
    updateTag: updateMutation.mutate,
    deleteTag: deleteMutation.mutate,
    getInvoiceTags,
    assignTagsToInvoice,
    addTagToInvoice,
    removeTagFromInvoice,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
    organizationId,
  };
}

// Hook to get tags for a specific invoice
export function useInvoiceTagsForInvoice(invoiceId: string | null) {
  const { tags } = useInvoiceTags();

  const {
    data: assignedTags = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['invoice-tags-for-invoice', invoiceId],
    queryFn: async () => {
      if (!invoiceId) return [];

      const { data, error } = await supabase
        .from('invoice_tag_assignments')
        .select('tag_id, invoice_tags(*)')
        .eq('invoice_id', invoiceId);

      if (error) throw error;
      return (data || []).map((item: any) => item.invoice_tags).filter(Boolean) as InvoiceTag[];
    },
    enabled: !!invoiceId,
  });

  return {
    assignedTags,
    assignedTagIds: assignedTags.map(t => t.id),
    allTags: tags,
    isLoading,
    refetch,
  };
}
