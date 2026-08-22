-- Create sync_jobs table for background sync operations
-- This table tracks all background data sync operations from integrations

CREATE TABLE IF NOT EXISTS public.sync_jobs (
  -- Primary key
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- References
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  integration_id UUID NOT NULL REFERENCES public.integrations(id) ON DELETE CASCADE,

  -- Job metadata
  job_type VARCHAR(50) NOT NULL, -- 'full_sync', 'entity_sync', 'scheduled_sync'
  entity_alias VARCHAR(50), -- 'appointments', 'treatments', 'practitioners', 'payment_plans', etc.

  -- Status tracking
  status VARCHAR(20) NOT NULL DEFAULT 'queued', -- queued, running, completed, failed, cancelled
  progress_percentage INTEGER DEFAULT 0 CHECK (progress_percentage >= 0 AND progress_percentage <= 100),

  -- Pagination tracking
  current_page INTEGER DEFAULT 1,
  total_pages INTEGER,
  records_processed INTEGER DEFAULT 0,
  records_failed INTEGER DEFAULT 0,

  -- Timing
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  -- Error handling
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,

  -- Audit fields
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_sync_jobs_organization_id
  ON public.sync_jobs(organization_id);

CREATE INDEX IF NOT EXISTS idx_sync_jobs_integration_id
  ON public.sync_jobs(integration_id);

CREATE INDEX IF NOT EXISTS idx_sync_jobs_status
  ON public.sync_jobs(status);

CREATE INDEX IF NOT EXISTS idx_sync_jobs_job_type
  ON public.sync_jobs(job_type);

CREATE INDEX IF NOT EXISTS idx_sync_jobs_entity_alias
  ON public.sync_jobs(entity_alias);

CREATE INDEX IF NOT EXISTS idx_sync_jobs_created_at
  ON public.sync_jobs(created_at DESC);

-- Create composite index for active jobs query
CREATE INDEX IF NOT EXISTS idx_sync_jobs_active
  ON public.sync_jobs(organization_id, status)
  WHERE status IN ('queued', 'running');

-- Add comments
COMMENT ON TABLE public.sync_jobs IS 'Tracks background sync operations from integrations (e.g., Dentally)';
COMMENT ON COLUMN public.sync_jobs.id IS 'Primary key (auto-generated UUID)';
COMMENT ON COLUMN public.sync_jobs.job_type IS 'Type of sync job: full_sync, entity_sync, or scheduled_sync';
COMMENT ON COLUMN public.sync_jobs.entity_alias IS 'Entity being synced: appointments, treatments, practitioners, payment_plans, etc.';
COMMENT ON COLUMN public.sync_jobs.status IS 'Current status: queued, running, completed, failed, or cancelled';
COMMENT ON COLUMN public.sync_jobs.progress_percentage IS 'Sync progress from 0-100%';

-- Enable Row Level Security (RLS)
ALTER TABLE public.sync_jobs ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for organization access
CREATE POLICY sync_jobs_org_isolation
  ON public.sync_jobs
  FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id
      FROM public.user_roles
      WHERE user_id = auth.uid()
    )
  );

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_sync_jobs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-update updated_at
CREATE TRIGGER sync_jobs_updated_at_trigger
  BEFORE UPDATE ON public.sync_jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_sync_jobs_updated_at();
