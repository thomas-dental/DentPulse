export type TreatmentUploadStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type TreatmentUploadFileType = 'csv' | 'xlsx' | 'xls';

export interface TreatmentUpload {
  id: string;
  organization_id: string;
  practice_id: string | null;
  location_id: string | null;
  file_name: string;
  file_path: string;
  file_type: TreatmentUploadFileType;
  file_size: number;
  status: TreatmentUploadStatus;
  total_rows: number | null;
  processed_rows: number | null;
  failed_rows: number | null;
  error_message: string | null;
  uploaded_by: string;
  created_at: string;
  updated_at: string;
  processed_at: string | null;
}

export interface TreatmentUploadInsert {
  organization_id: string;
  practice_id?: string | null;
  location_id?: string | null;
  file_name: string;
  file_path: string;
  file_type: TreatmentUploadFileType;
  file_size: number;
  status?: TreatmentUploadStatus;
  total_rows?: number | null;
  processed_rows?: number | null;
  failed_rows?: number | null;
  error_message?: string | null;
  uploaded_by: string;
}

export interface TreatmentUploadUpdate {
  status?: TreatmentUploadStatus;
  total_rows?: number | null;
  processed_rows?: number | null;
  failed_rows?: number | null;
  error_message?: string | null;
  processed_at?: string | null;
}

export interface TreatmentUploadProgress {
  totalRows: number;
  processedRows: number;
  failedRows: number;
  percentage: number;
}
