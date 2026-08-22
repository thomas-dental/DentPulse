-- Add date range fields to sync_jobs table
-- Supports filtering syncs by date range for initial 12-month sync and custom date range syncs

ALTER TABLE public.sync_jobs
ADD COLUMN start_date TIMESTAMPTZ,
ADD COLUMN end_date TIMESTAMPTZ;

-- Add comments
COMMENT ON COLUMN public.sync_jobs.start_date IS 'Start date for sync filter (null = no start filter)';
COMMENT ON COLUMN public.sync_jobs.end_date IS 'End date for sync filter (null = no end filter)';

-- Create index for date range queries
CREATE INDEX IF NOT EXISTS idx_sync_jobs_date_range
  ON public.sync_jobs(start_date, end_date)
  WHERE start_date IS NOT NULL OR end_date IS NOT NULL;
