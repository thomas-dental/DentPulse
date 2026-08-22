import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import { useOrganization } from './useOrganization';
import { parseTreatmentFile } from '@/utils/fileParser';
import { processAndSaveTreatments } from '@/utils/treatmentProcessor';
import { toast } from 'sonner';

export function useTreatmentUploads(organizationId?: string) {
  const { user } = useAuth();
  const { organizationId: orgIdFromHook } = useOrganization(organizationId);
  const queryClient = useQueryClient();
  const currentOrgId = organizationId || orgIdFromHook;

  // Validate and prepare file for processing (no database storage)
  const uploadFile = async (
    file: File,
    practiceId?: string | null,
    locationId?: string | null
  ): Promise<{ file: File }> => {
    if (!currentOrgId) throw new Error('No organization selected');
    if (!user?.id) throw new Error('Not authenticated');

    // Validate file type
    const fileExtension = file.name.split('.').pop()?.toLowerCase();
    if (!fileExtension || !['csv', 'xlsx', 'xls'].includes(fileExtension)) {
      throw new Error('Invalid file type. Only CSV, XLSX, and XLS files are allowed.');
    }

    // Validate file size (max 10MB)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      throw new Error('File size exceeds 10MB limit.');
    }

    // Return file object for processing (no database storage)
    return { file };
  };

  // Process file - parse and save treatments directly (no upload record)
  const processUpload = async (
    file: File,
    categoryId?: string | null,
    locationId?: string | null,
    regionId?: string | null
  ): Promise<{ success: boolean; processedRows: number; totalRows: number; errors: string[] }> => {
    if (!currentOrgId) throw new Error('No organization selected');
    if (!user?.id) throw new Error('Not authenticated');

    try {
      // Parse file
      toast.info('Parsing file...');
      const parseResult = await parseTreatmentFile(file);

      // Process and save treatments
      toast.info(`Processing ${parseResult.totalRows} treatments...`);
      const processResult = await processAndSaveTreatments(
        parseResult.data,
        currentOrgId,
        categoryId || null,
        locationId || null,
        regionId || null,
        user.id
      );

      // Invalidate treatments query to refresh the list
      queryClient.invalidateQueries({ queryKey: ['treatments', currentOrgId] });

      if (processResult.processedRows > 0) {
        toast.success(
          `Successfully processed ${processResult.processedRows} out of ${processResult.totalRows} treatments`
        );
      } else {
        const errorMessage = [
          ...parseResult.errors,
          ...processResult.errors,
        ].join('; ');
        toast.error(`Failed to process treatments. ${errorMessage}`);
      }

      return {
        success: processResult.processedRows > 0,
        processedRows: processResult.processedRows,
        totalRows: processResult.totalRows,
        errors: [...parseResult.errors, ...processResult.errors],
      };
    } catch (error: any) {
      console.error('Error processing file:', error);
      toast.error(`Failed to process file: ${error.message}`);
      throw error;
    }
  };

  return {
    uploadFile,
    processUpload,
    organizationId: currentOrgId,
    hasOrganization: !!currentOrgId,
  };
}
