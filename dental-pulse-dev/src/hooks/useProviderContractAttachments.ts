import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { toast } from 'sonner';

export interface ProviderContractAttachment {
  id: string;
  organization_id: string;
  provider_id: string;
  uploaded_by: string | null;
  file_name: string;
  file_path: string;
  file_size: number | null;
  file_type: string | null;
  created_at: string;
  deleted_at: string | null;
}

const STORAGE_BUCKET = 'uploads';
const STORAGE_PREFIX = 'contract-attachments';

const ALLOWED_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];
const ALLOWED_EXTENSIONS = ['.pdf', '.doc', '.docx'];
const MAX_SIZE = 10 * 1024 * 1024; // 10MB

export function isAllowedContractAttachment(file: File) {
  if (ALLOWED_TYPES.includes(file.type)) return true;
  const lowerName = file.name.toLowerCase();
  return ALLOWED_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
}

export function useProviderContractAttachments(providerId: string | undefined) {
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const organizationId = profile?.current_organization_id;

  const {
    data: attachments = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ['provider-contract-attachments', providerId],
    queryFn: async () => {
      if (!providerId) return [];

      const { data, error } = await supabase
        .from('provider_contract_attachments')
        .select('*')
        .eq('provider_id', providerId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data ?? []) as ProviderContractAttachment[];
    },
    enabled: !!providerId && !!organizationId,
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!organizationId || !user?.id) throw new Error('Not authenticated');
      if (!providerId) throw new Error('No provider selected');

      if (!isAllowedContractAttachment(file)) {
        throw new Error('Only PDF and Word (.doc, .docx) files are allowed');
      }
      if (file.size > MAX_SIZE) {
        throw new Error('File is too large. Maximum size is 10MB');
      }

      const fileExt = file.name.split('.').pop();
      const uniqueName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
      const filePath = `${STORAGE_PREFIX}/${organizationId}/${providerId}/${uniqueName}`;

      const { error: uploadError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(filePath, file, { cacheControl: '3600', upsert: false });

      if (uploadError) throw uploadError;

      const { data, error: insertError } = await supabase
        .from('provider_contract_attachments')
        .insert({
          organization_id: organizationId,
          provider_id: providerId,
          uploaded_by: user.id,
          file_name: file.name,
          file_path: filePath,
          file_size: file.size,
          file_type: file.type || null,
        })
        .select()
        .single();

      if (insertError) {
        await supabase.storage.from(STORAGE_BUCKET).remove([filePath]);
        throw insertError;
      }

      return data as ProviderContractAttachment;
    },
    onSuccess: () => {
      toast.success('Contract attachment uploaded');
      queryClient.invalidateQueries({ queryKey: ['provider-contract-attachments', providerId] });
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Upload failed');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (attachment: ProviderContractAttachment) => {
      const { error: dbError } = await supabase
        .from('provider_contract_attachments')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', attachment.id);

      if (dbError) throw dbError;

      await supabase.storage.from(STORAGE_BUCKET).remove([attachment.file_path]);
    },
    onSuccess: () => {
      toast.success('Attachment deleted');
      queryClient.invalidateQueries({ queryKey: ['provider-contract-attachments', providerId] });
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete attachment: ${error.message}`);
    },
  });

  const downloadAttachment = async (attachment: ProviderContractAttachment) => {
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(attachment.file_path, 60);

    if (error || !data?.signedUrl) {
      toast.error('Failed to generate download link');
      return;
    }

    window.open(data.signedUrl, '_blank');
  };

  return {
    attachments,
    isLoading,
    error,
    uploadAttachment: uploadMutation.mutate,
    isUploading: uploadMutation.isPending,
    deleteAttachment: deleteMutation.mutate,
    isDeleting: deleteMutation.isPending,
    downloadAttachment,
  };
}
