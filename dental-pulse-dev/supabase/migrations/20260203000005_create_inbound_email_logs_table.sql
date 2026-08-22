-- ============================================================================
-- INBOUND EMAIL LOGS TABLE
-- Stores logs for all inbound email operations
-- ============================================================================

CREATE TABLE IF NOT EXISTS inbound_email_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Organization and User context
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Log details
  action VARCHAR(100) NOT NULL,  -- 'create_address', 'receive_email', 'process_attachment', 'create_invoice', etc.
  status VARCHAR(50) NOT NULL,   -- 'success', 'failed', 'pending'

  -- Request/Response data
  request_payload JSONB,
  response_payload JSONB,

  -- Error details
  error_message TEXT,
  error_code VARCHAR(50),

  -- Related entities
  inbound_email_id UUID REFERENCES inbound_emails(id) ON DELETE SET NULL,
  invoice_id UUID,

  -- Additional metadata
  ip_address VARCHAR(45),
  user_agent TEXT,
  metadata JSONB,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Organization index
CREATE INDEX idx_inbound_email_logs_organization_id ON inbound_email_logs(organization_id);

-- User index
CREATE INDEX idx_inbound_email_logs_user_id ON inbound_email_logs(user_id);

-- Action index for filtering by operation type
CREATE INDEX idx_inbound_email_logs_action ON inbound_email_logs(action);

-- Status index for filtering by result
CREATE INDEX idx_inbound_email_logs_status ON inbound_email_logs(status);

-- Created at for time-based queries
CREATE INDEX idx_inbound_email_logs_created_at ON inbound_email_logs(created_at DESC);

-- Inbound email reference
CREATE INDEX idx_inbound_email_logs_inbound_email_id ON inbound_email_logs(inbound_email_id);

-- Composite index for common queries
CREATE INDEX idx_inbound_email_logs_org_action_created ON inbound_email_logs(organization_id, action, created_at DESC);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE inbound_email_logs ENABLE ROW LEVEL SECURITY;

-- Authenticated users can view logs
CREATE POLICY "Users can view inbound_email_logs"
ON inbound_email_logs FOR SELECT TO authenticated
USING (true);

-- Authenticated users can insert logs
CREATE POLICY "Users can insert inbound_email_logs"
ON inbound_email_logs FOR INSERT TO authenticated
WITH CHECK (true);

-- Service role full access
CREATE POLICY "Service role has full access to inbound_email_logs"
ON inbound_email_logs FOR ALL TO service_role
USING (true) WITH CHECK (true);

-- Anonymous can insert (for webhook logging)
CREATE POLICY "Anonymous can insert inbound_email_logs"
ON inbound_email_logs FOR INSERT TO anon
WITH CHECK (true);

-- Anonymous can view (for debugging)
CREATE POLICY "Anonymous can view inbound_email_logs"
ON inbound_email_logs FOR SELECT TO anon
USING (true);

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE inbound_email_logs IS 'Logs for all inbound email operations';
COMMENT ON COLUMN inbound_email_logs.action IS 'Operation type: create_address, receive_email, process_attachment, create_invoice, api_call, etc.';
COMMENT ON COLUMN inbound_email_logs.status IS 'Result status: success, failed, pending';
COMMENT ON COLUMN inbound_email_logs.request_payload IS 'Request data sent to API';
COMMENT ON COLUMN inbound_email_logs.response_payload IS 'Response received from API';
COMMENT ON COLUMN inbound_email_logs.error_message IS 'Error message if operation failed';
COMMENT ON COLUMN inbound_email_logs.metadata IS 'Additional context data';
