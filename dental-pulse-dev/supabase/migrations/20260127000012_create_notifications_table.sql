-- Create notifications table
-- Stores user notifications for sync completions, errors, and other events

CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- User and organization
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- Notification details
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  type VARCHAR(50) NOT NULL DEFAULT 'info', -- 'success', 'info', 'warning', 'error'

  -- Related entities (optional)
  related_entity_type VARCHAR(50), -- 'sync_job', 'integration', etc.
  related_entity_id UUID, -- ID of the related entity

  -- Status
  is_read BOOLEAN DEFAULT FALSE,
  read_at TIMESTAMPTZ,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_notifications_user_id
  ON public.notifications(user_id);

CREATE INDEX IF NOT EXISTS idx_notifications_organization_id
  ON public.notifications(organization_id);

CREATE INDEX IF NOT EXISTS idx_notifications_is_read
  ON public.notifications(is_read);

CREATE INDEX IF NOT EXISTS idx_notifications_created_at
  ON public.notifications(created_at DESC);

-- Composite index for unread notifications query
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON public.notifications(user_id, is_read, created_at DESC)
  WHERE is_read = FALSE;

-- Add comments
COMMENT ON TABLE public.notifications IS 'User notifications for sync completions, errors, and other events';
COMMENT ON COLUMN public.notifications.type IS 'Notification type: success, info, warning, error';
COMMENT ON COLUMN public.notifications.related_entity_type IS 'Type of related entity: sync_job, integration, etc.';

-- Enable Row Level Security (RLS)
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Create RLS policy - users can only see their own notifications
CREATE POLICY notifications_user_isolation
  ON public.notifications
  FOR ALL
  USING (user_id = auth.uid());

-- Create trigger function to update updated_at
CREATE OR REPLACE FUNCTION update_notifications_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
CREATE TRIGGER notifications_updated_at_trigger
  BEFORE UPDATE ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION update_notifications_updated_at();

-- Create function to create notification when sync job completes
CREATE OR REPLACE FUNCTION create_sync_completion_notification()
RETURNS TRIGGER AS $$
DECLARE
  integration_name TEXT;
  entity_display_name TEXT;
  notification_title TEXT;
  notification_message TEXT;
  notification_type TEXT;
  org_user_id UUID;
BEGIN
  -- Only create notification when status changes to 'completed' or 'failed'
  IF (NEW.status = 'completed' OR NEW.status = 'failed') AND
     (OLD.status IS NULL OR OLD.status != NEW.status) THEN

    -- Get integration name
    SELECT i.integration_name INTO integration_name
    FROM integrations i
    WHERE i.id = NEW.integration_id;

    -- Format entity name
    entity_display_name := CASE NEW.entity_alias
      WHEN 'appointments' THEN 'Appointments'
      WHEN 'practitioners' THEN 'Practitioners'
      WHEN 'payment_plans' THEN 'Payment Plans'
      WHEN 'treatment_plans' THEN 'Treatment Plans'
      WHEN 'treatment_plan_items' THEN 'Treatment Plan Items'
      WHEN 'treatment_appointments' THEN 'Treatment Appointments'
      WHEN 'treatments' THEN 'Treatments'
      WHEN 'treatment_category' THEN 'Treatment Categories'
      WHEN 'locations' THEN 'Locations'
      WHEN 'patients' THEN 'Patients'
      ELSE COALESCE(NEW.entity_alias, 'Data')
    END;

    -- Get user_id from organization (creator/owner)
    SELECT o.created_by INTO org_user_id
    FROM organizations o
    WHERE o.id = NEW.organization_id;

    -- Build notification based on status
    IF NEW.status = 'completed' THEN
      notification_type := 'success';
      notification_title := entity_display_name || ' synced successfully';
      notification_message := 'Synced ' || NEW.records_processed || ' records from ' || integration_name || '.';
    ELSE -- failed
      notification_type := 'error';
      notification_title := entity_display_name || ' sync failed';
      notification_message := COALESCE(NEW.error_message, 'An error occurred during sync.');
    END IF;

    -- Create notification
    INSERT INTO public.notifications (
      user_id,
      organization_id,
      title,
      message,
      type,
      related_entity_type,
      related_entity_id,
      is_read
    ) VALUES (
      org_user_id,
      NEW.organization_id,
      notification_title,
      notification_message,
      notification_type,
      'sync_job',
      NEW.id,
      FALSE
    );

  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger on sync_jobs table
CREATE TRIGGER sync_job_completion_notification_trigger
  AFTER UPDATE ON public.sync_jobs
  FOR EACH ROW
  EXECUTE FUNCTION create_sync_completion_notification();
