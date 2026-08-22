/**
 * Sync Job Types
 */

export type SyncJobType = 'full_sync' | 'entity_sync' | 'scheduled_sync';

export type SyncJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface SyncJob {
  id: string;
  organization_id: string;
  integration_id: string;
  job_type: SyncJobType;
  entity_alias: string | null;
  status: SyncJobStatus;
  progress_percentage: number;
  current_page: number;
  total_pages: number | null;
  records_processed: number;
  records_failed: number;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  retry_count: number;
  max_retries: number;
  created_at: string;
  updated_at: string;
}

export interface SyncJobInsert {
  organization_id: string;
  integration_id: string;
  job_type: SyncJobType;
  entity_alias?: string | null;
  status?: SyncJobStatus;
  progress_percentage?: number;
  current_page?: number;
  total_pages?: number | null;
  records_processed?: number;
  records_failed?: number;
  retry_count?: number;
  max_retries?: number;
}

export interface SyncJobUpdate {
  status?: SyncJobStatus;
  progress_percentage?: number;
  current_page?: number;
  total_pages?: number;
  records_processed?: number;
  records_failed?: number;
  error_message?: string | null;
  started_at?: string;
  completed_at?: string;
}
