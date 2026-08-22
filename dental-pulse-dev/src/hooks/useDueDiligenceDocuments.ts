import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useFilters } from '@/contexts/FilterContext';
import { toast } from 'sonner';

export type DocumentTag =
  | 'xero-export'
  | 'associate-contracts'
  | 'nhs-reports'
  | 'lab-invoices'
  | 'bank-statements';

export const DOCUMENT_TAGS: { label: string; value: DocumentTag }[] = [
  { label: 'Xero Export', value: 'xero-export' },
  { label: 'Associate Contracts', value: 'associate-contracts' },
  { label: 'NHS Reports', value: 'nhs-reports' },
  { label: 'Lab Invoices', value: 'lab-invoices' },
  { label: 'Bank Statements', value: 'bank-statements' },
];

export interface DueDiligenceDocument {
  id: string;
  organization_id: string;
  location_id: string | null;
  user_id: string | null;
  file_name: string;
  file_path: string;
  file_size: number | null;
  file_type: string | null;
  document_tag: DocumentTag;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

const STORAGE_BUCKET = 'uploads';
const STORAGE_PREFIX = 'due-diligence';

export function useDueDiligenceDocuments(activeTag?: DocumentTag | null) {
  const { user, profile } = useAuth();
  const { selectedLocationId } = useFilters();
  const queryClient = useQueryClient();
  const organizationId = profile?.current_organization_id;

  // Fetch documents
  const {
    data: documents = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ['due-diligence-documents', organizationId, selectedLocationId, activeTag],
    queryFn: async () => {
      if (!organizationId) return [];

      let query = supabase
        .from('due_diligence_documents')
        .select('*')
        .eq('organization_id', organizationId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      if (selectedLocationId) {
        query = query.eq('location_id', selectedLocationId);
      }

      if (activeTag) {
        query = query.eq('document_tag', activeTag);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as DueDiligenceDocument[];
    },
    enabled: !!organizationId && !!user?.id,
  });

  // Count documents per tag
  const {
    data: tagCounts = {} as Record<DocumentTag, number>,
  } = useQuery({
    queryKey: ['due-diligence-tag-counts', organizationId, selectedLocationId],
    queryFn: async () => {
      if (!organizationId) return {} as Record<DocumentTag, number>;

      let query = supabase
        .from('due_diligence_documents')
        .select('document_tag')
        .eq('organization_id', organizationId)
        .is('deleted_at', null);

      if (selectedLocationId) {
        query = query.eq('location_id', selectedLocationId);
      }

      const { data, error } = await query;
      if (error) throw error;

      const counts: Record<string, number> = {};
      (data ?? []).forEach((row: any) => {
        counts[row.document_tag] = (counts[row.document_tag] || 0) + 1;
      });
      return counts as Record<DocumentTag, number>;
    },
    enabled: !!organizationId && !!user?.id,
  });

  // Upload mutation
  const uploadMutation = useMutation({
    mutationFn: async ({ file, tag }: { file: File; tag: DocumentTag }) => {
      if (!organizationId || !user?.id) throw new Error('Not authenticated');

      // Upload to storage
      const fileExt = file.name.split('.').pop();
      const fileName = `${organizationId}/${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
      const filePath = `${STORAGE_PREFIX}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(filePath, file, { cacheControl: '3600', upsert: false });

      if (uploadError) throw uploadError;

      // Insert metadata row
      const { data, error: insertError } = await supabase
        .from('due_diligence_documents')
        .insert({
          organization_id: organizationId,
          location_id: selectedLocationId || null,
          user_id: user.id,
          file_name: file.name,
          file_path: filePath,
          file_size: file.size,
          file_type: file.type,
          document_tag: tag,
        })
        .select()
        .single();

      if (insertError) {
        // Cleanup uploaded file on DB insert failure
        await supabase.storage.from(STORAGE_BUCKET).remove([filePath]);
        throw insertError;
      }

      return data as DueDiligenceDocument;
    },
    onSuccess: () => {
      toast.success('Document uploaded successfully');
      queryClient.invalidateQueries({ queryKey: ['due-diligence-documents'] });
      queryClient.invalidateQueries({ queryKey: ['due-diligence-tag-counts'] });
    },
    onError: (error: Error) => {
      toast.error(`Upload failed: ${error.message}`);
    },
  });

  // Delete mutation (soft delete + remove from storage)
  const deleteMutation = useMutation({
    mutationFn: async (doc: DueDiligenceDocument) => {
      // Soft delete in DB
      const { error: dbError } = await supabase
        .from('due_diligence_documents')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', doc.id);

      if (dbError) throw dbError;

      // Remove from storage
      await supabase.storage.from(STORAGE_BUCKET).remove([doc.file_path]);
    },
    onSuccess: () => {
      toast.success('Document deleted');
      queryClient.invalidateQueries({ queryKey: ['due-diligence-documents'] });
      queryClient.invalidateQueries({ queryKey: ['due-diligence-tag-counts'] });
    },
    onError: (error: Error) => {
      toast.error(`Delete failed: ${error.message}`);
    },
  });

  // Download helper
  const downloadDocument = async (doc: DueDiligenceDocument) => {
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(doc.file_path, 60);

    if (error || !data?.signedUrl) {
      toast.error('Failed to generate download link');
      return;
    }

    window.open(data.signedUrl, '_blank');
  };

  return {
    documents,
    tagCounts,
    isLoading,
    error,
    uploadDocument: uploadMutation.mutate,
    isUploading: uploadMutation.isPending,
    deleteDocument: deleteMutation.mutate,
    isDeleting: deleteMutation.isPending,
    downloadDocument,
  };
}
