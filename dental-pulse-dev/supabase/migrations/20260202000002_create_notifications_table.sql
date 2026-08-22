-- Create general_notification table for application-wide notifications
-- This is a COMMON table used for ALL notification types across the entire project

-- Create general_notification table
CREATE TABLE IF NOT EXISTS general_notification (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- User who receives the notification
  user_id UUID,

  -- Associated entity ID (e.g., invoice_id, task_id, report_id, etc.)
  associate_id UUID,

  -- Type of notification
  notification_type VARCHAR(100) NOT NULL DEFAULT 'general',

  -- Module/Feature area for filtering
  module_type VARCHAR(100),

  -- Organization context for multi-tenant support
  organization_id UUID,

  -- Notification content
  title VARCHAR(255) NOT NULL,
  message TEXT,
  reason TEXT,

  -- Additional data stored as JSON
  data JSONB DEFAULT '{}',

  -- Read status (NULL = unread, timestamp = when it was read)
  read_at TIMESTAMP WITH TIME ZONE,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_general_notification_user_id ON general_notification(user_id);
CREATE INDEX IF NOT EXISTS idx_general_notification_organization_id ON general_notification(organization_id);
CREATE INDEX IF NOT EXISTS idx_general_notification_associate_id ON general_notification(associate_id);
CREATE INDEX IF NOT EXISTS idx_general_notification_notification_type ON general_notification(notification_type);
CREATE INDEX IF NOT EXISTS idx_general_notification_module_type ON general_notification(module_type);
CREATE INDEX IF NOT EXISTS idx_general_notification_created_at ON general_notification(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_general_notification_user_unread ON general_notification(user_id, read_at) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_general_notification_user_org_module ON general_notification(user_id, organization_id, module_type, created_at DESC);

-- Create trigger function
CREATE OR REPLACE FUNCTION update_general_notification_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
DROP TRIGGER IF EXISTS general_notification_updated_at_trigger ON general_notification;
CREATE TRIGGER general_notification_updated_at_trigger
  BEFORE UPDATE ON general_notification
  FOR EACH ROW
  EXECUTE FUNCTION update_general_notification_updated_at();

-- Enable Row Level Security
ALTER TABLE general_notification ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Allow authenticated users to view all notifications (for admin dashboard)
CREATE POLICY "Users can view general_notification"
ON general_notification FOR SELECT TO authenticated
USING (true);

-- Allow authenticated users to update notifications (mark as read)
CREATE POLICY "Users can update general_notification"
ON general_notification FOR UPDATE TO authenticated
USING (true);

CREATE POLICY "Anonymous can view general_notification"
ON general_notification FOR SELECT TO anon
USING (true);

CREATE POLICY "Anonymous can insert general_notification"
ON general_notification FOR INSERT TO anon
WITH CHECK (true);

CREATE POLICY "Service role has full access to general_notification"
ON general_notification FOR ALL TO service_role
USING (true) WITH CHECK (true);

CREATE POLICY "Allow insert general_notification"
ON general_notification FOR INSERT TO authenticated
WITH CHECK (true);
