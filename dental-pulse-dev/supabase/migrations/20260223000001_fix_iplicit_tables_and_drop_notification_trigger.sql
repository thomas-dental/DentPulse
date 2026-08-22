-- Add user_id to iplicit_coa_account_groups
ALTER TABLE public.iplicit_coa_account_groups
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Add user_id to iplicit_chart_of_accounts
ALTER TABLE public.iplicit_chart_of_accounts
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Drop the sync notification trigger (not in use)
DROP TRIGGER IF EXISTS sync_job_completion_notification_trigger ON public.sync_jobs;
