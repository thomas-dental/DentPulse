/**
 * Patient Economics — membership CSV import via Edge Function.
 *
 * Pattern (Day 1 audit): upload file to Supabase Storage, then
 * supabase.functions.invoke with the storage path.
 */

import { supabase } from '@/integrations/supabase/client';

const BUCKET = 'membership-imports';
const FUNCTION_NAME = 'patient-economics-membership-import';

export interface MembershipImportUnmatched {
  row: number;
  surname: string;
  exportPatientId: string | null;
  reason: string;
}

export interface MembershipImportResult {
  success: boolean;
  processed: number;
  matched: number;
  unmatchedCount: number;
  unmatched: MembershipImportUnmatched[];
  unmatchedTruncated?: boolean;
  errors: Array<{ row: number; message: string }>;
  duplicatesDropped: number;
  inserted: number;
  facilityId: string | null;
  uploadMonth: number;
  uploadYear: number;
  message?: string;
  error?: string;
}

export async function uploadMembershipExport(
  file: File,
  organizationId: string,
): Promise<string> {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `${organizationId}/${Date.now()}_${safeName}`;

  const { error } = await supabase.storage.from(BUCKET).upload(storagePath, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type || 'text/csv',
  });

  if (error) {
    throw new Error(`Storage upload failed: ${error.message}`);
  }

  return storagePath;
}

export async function invokeMembershipImport(params: {
  organizationId: string;
  locationId?: string | null;
  uploadMonth: number;
  uploadYear: number;
  storagePath: string;
  fileName: string;
}): Promise<MembershipImportResult> {
  const { data, error } = await supabase.functions.invoke(FUNCTION_NAME, {
    body: {
      organizationId: params.organizationId,
      locationId: params.locationId ?? null,
      uploadMonth: params.uploadMonth,
      uploadYear: params.uploadYear,
      storagePath: params.storagePath,
      fileName: params.fileName,
    },
  });

  if (error) {
    throw new Error(error.message || 'Membership import Edge Function failed');
  }

  if (data?.error) {
    throw new Error(String(data.error));
  }

  return data as MembershipImportResult;
}

/**
 * Upload one CSV to Storage and run the membership-import Edge Function.
 */
export async function importMembershipCsvViaEdgeFunction(params: {
  file: File;
  organizationId: string;
  locationId?: string | null;
  uploadMonth: number;
  uploadYear: number;
}): Promise<MembershipImportResult> {
  const storagePath = await uploadMembershipExport(params.file, params.organizationId);
  try {
    return await invokeMembershipImport({
      organizationId: params.organizationId,
      locationId: params.locationId,
      uploadMonth: params.uploadMonth,
      uploadYear: params.uploadYear,
      storagePath,
      fileName: params.file.name,
    });
  } catch (err) {
    // Best-effort cleanup if invoke failed before EF deleted the object
    try {
      await supabase.storage.from(BUCKET).remove([storagePath]);
    } catch {
      /* ignore */
    }
    throw err;
  }
}
