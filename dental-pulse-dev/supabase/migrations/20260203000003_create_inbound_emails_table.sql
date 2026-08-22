-- ============================================================================
-- INBOUND EMAILS & ATTACHMENTS - Fresh Migration
-- Creates tables for storing emails received via inbound email webhook
-- ============================================================================

-- ============================================================================
-- DROP EXISTING TABLES (if any)
-- ============================================================================
DROP TABLE IF EXISTS inbound_email_attachments CASCADE;
DROP TABLE IF EXISTS inbound_emails CASCADE;

-- ============================================================================
-- CREATE INBOUND_EMAILS TABLE
-- ============================================================================
CREATE TABLE inbound_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- User who received the email
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Organization context
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,

  -- Email identifiers
  message_id VARCHAR(500),
  thread_id VARCHAR(500),

  -- Sender info
  from_email VARCHAR(255),
  from_name VARCHAR(255),

  -- Recipient info
  to_email VARCHAR(255),

  -- Email content
  subject TEXT,
  text_body TEXT,
  html_body TEXT,

  -- Metadata
  received_at TIMESTAMP WITH TIME ZONE,
  raw_payload JSONB,
  has_attachments BOOLEAN DEFAULT false,

  -- Processing status: 'received', 'processing', 'processed', 'failed'
  status VARCHAR(50) DEFAULT 'received',
  error_message TEXT,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================================
-- CREATE INBOUND_EMAIL_ATTACHMENTS TABLE
-- ============================================================================
CREATE TABLE inbound_email_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Reference to parent email
  inbound_email_id UUID NOT NULL REFERENCES inbound_emails(id) ON DELETE CASCADE,

  -- Attachment info
  filename VARCHAR(500),
  mime_type VARCHAR(255),
  size BIGINT,
  download_url TEXT,

  -- Storage info
  stored_path TEXT,

  -- Invoice linking
  is_invoice_pdf BOOLEAN DEFAULT false,
  invoice_id UUID,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================================
-- INDEXES FOR INBOUND_EMAILS
-- ============================================================================

-- Organization index for filtering by organization
CREATE INDEX idx_inbound_emails_organization_id ON inbound_emails(organization_id);

-- User index for filtering by user
CREATE INDEX idx_inbound_emails_user_id ON inbound_emails(user_id);

-- From email index for searching/filtering by sender
CREATE INDEX idx_inbound_emails_from_email ON inbound_emails(from_email);

-- To email index for searching/filtering by recipient
CREATE INDEX idx_inbound_emails_to_email ON inbound_emails(to_email);

-- Message ID index for duplicate detection
CREATE INDEX idx_inbound_emails_message_id ON inbound_emails(message_id);

-- Status index for filtering by processing status
CREATE INDEX idx_inbound_emails_status ON inbound_emails(status);

-- Received at index for date range queries (descending for recent first)
CREATE INDEX idx_inbound_emails_received_at ON inbound_emails(received_at DESC);

-- Created at index for sorting
CREATE INDEX idx_inbound_emails_created_at ON inbound_emails(created_at DESC);

-- Composite index for common queries: organization + status + created_at
CREATE INDEX idx_inbound_emails_org_status_created ON inbound_emails(organization_id, status, created_at DESC);

-- Composite index for user + organization filtering
CREATE INDEX idx_inbound_emails_user_org ON inbound_emails(user_id, organization_id);

-- ============================================================================
-- INDEXES FOR INBOUND_EMAIL_ATTACHMENTS
-- ============================================================================

-- Email ID index for joining with parent email
CREATE INDEX idx_inbound_email_attachments_email_id ON inbound_email_attachments(inbound_email_id);

-- Invoice ID index for linking to invoices
CREATE INDEX idx_inbound_email_attachments_invoice_id ON inbound_email_attachments(invoice_id);

-- Is invoice PDF index for filtering invoice attachments
CREATE INDEX idx_inbound_email_attachments_is_invoice_pdf ON inbound_email_attachments(is_invoice_pdf);

-- Filename index for searching attachments
CREATE INDEX idx_inbound_email_attachments_filename ON inbound_email_attachments(filename);

-- Composite index: email_id + is_invoice_pdf for finding invoice attachments
CREATE INDEX idx_inbound_email_attachments_email_invoice ON inbound_email_attachments(inbound_email_id, is_invoice_pdf);

-- ============================================================================
-- TRIGGER FUNCTIONS FOR UPDATED_AT
-- ============================================================================

-- Trigger function for inbound_emails updated_at
CREATE OR REPLACE FUNCTION update_inbound_emails_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger function for inbound_email_attachments updated_at
CREATE OR REPLACE FUNCTION update_inbound_email_attachments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Trigger for inbound_emails
CREATE TRIGGER inbound_emails_updated_at_trigger
  BEFORE UPDATE ON inbound_emails
  FOR EACH ROW
  EXECUTE FUNCTION update_inbound_emails_updated_at();

-- Trigger for inbound_email_attachments
CREATE TRIGGER inbound_email_attachments_updated_at_trigger
  BEFORE UPDATE ON inbound_email_attachments
  FOR EACH ROW
  EXECUTE FUNCTION update_inbound_email_attachments_updated_at();

-- ============================================================================
-- ROW LEVEL SECURITY - INBOUND_EMAILS
-- ============================================================================

-- Enable RLS
ALTER TABLE inbound_emails ENABLE ROW LEVEL SECURITY;

-- SELECT: Authenticated users can view emails
CREATE POLICY "Users can view inbound_emails"
ON inbound_emails FOR SELECT TO authenticated
USING (true);

-- INSERT: Authenticated users can insert emails
CREATE POLICY "Users can insert inbound_emails"
ON inbound_emails FOR INSERT TO authenticated
WITH CHECK (true);

-- UPDATE: Authenticated users can update emails
CREATE POLICY "Users can update inbound_emails"
ON inbound_emails FOR UPDATE TO authenticated
USING (true);

-- DELETE: Authenticated users can delete emails
CREATE POLICY "Users can delete inbound_emails"
ON inbound_emails FOR DELETE TO authenticated
USING (true);

-- Service role: Full access
CREATE POLICY "Service role has full access to inbound_emails"
ON inbound_emails FOR ALL TO service_role
USING (true) WITH CHECK (true);

-- Anonymous: Can insert (for webhook)
CREATE POLICY "Anonymous can insert inbound_emails"
ON inbound_emails FOR INSERT TO anon
WITH CHECK (true);

-- Anonymous: Can view (for webhook verification)
CREATE POLICY "Anonymous can view inbound_emails"
ON inbound_emails FOR SELECT TO anon
USING (true);

-- ============================================================================
-- ROW LEVEL SECURITY - INBOUND_EMAIL_ATTACHMENTS
-- ============================================================================

-- Enable RLS
ALTER TABLE inbound_email_attachments ENABLE ROW LEVEL SECURITY;

-- SELECT: Authenticated users can view attachments
CREATE POLICY "Users can view inbound_email_attachments"
ON inbound_email_attachments FOR SELECT TO authenticated
USING (true);

-- INSERT: Authenticated users can insert attachments
CREATE POLICY "Users can insert inbound_email_attachments"
ON inbound_email_attachments FOR INSERT TO authenticated
WITH CHECK (true);

-- UPDATE: Authenticated users can update attachments
CREATE POLICY "Users can update inbound_email_attachments"
ON inbound_email_attachments FOR UPDATE TO authenticated
USING (true);

-- DELETE: Authenticated users can delete attachments
CREATE POLICY "Users can delete inbound_email_attachments"
ON inbound_email_attachments FOR DELETE TO authenticated
USING (true);

-- Service role: Full access
CREATE POLICY "Service role has full access to inbound_email_attachments"
ON inbound_email_attachments FOR ALL TO service_role
USING (true) WITH CHECK (true);

-- Anonymous: Can insert (for webhook)
CREATE POLICY "Anonymous can insert inbound_email_attachments"
ON inbound_email_attachments FOR INSERT TO anon
WITH CHECK (true);

-- Anonymous: Can view (for webhook verification)
CREATE POLICY "Anonymous can view inbound_email_attachments"
ON inbound_email_attachments FOR SELECT TO anon
USING (true);

-- ============================================================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================================================

COMMENT ON TABLE inbound_emails IS 'Stores emails received via inbound email webhook';
COMMENT ON COLUMN inbound_emails.id IS 'Unique identifier for the email';
COMMENT ON COLUMN inbound_emails.user_id IS 'User who received/owns this email';
COMMENT ON COLUMN inbound_emails.organization_id IS 'Organization this email belongs to';
COMMENT ON COLUMN inbound_emails.message_id IS 'Unique message ID from email provider';
COMMENT ON COLUMN inbound_emails.thread_id IS 'Thread/conversation ID for grouping';
COMMENT ON COLUMN inbound_emails.from_email IS 'Sender email address';
COMMENT ON COLUMN inbound_emails.from_name IS 'Sender display name';
COMMENT ON COLUMN inbound_emails.to_email IS 'Recipient email address';
COMMENT ON COLUMN inbound_emails.subject IS 'Email subject line';
COMMENT ON COLUMN inbound_emails.text_body IS 'Plain text email body';
COMMENT ON COLUMN inbound_emails.html_body IS 'HTML email body';
COMMENT ON COLUMN inbound_emails.received_at IS 'When the email was received';
COMMENT ON COLUMN inbound_emails.raw_payload IS 'Raw webhook payload as JSON';
COMMENT ON COLUMN inbound_emails.has_attachments IS 'Whether email has attachments';
COMMENT ON COLUMN inbound_emails.status IS 'Processing status: received, processing, processed, failed';
COMMENT ON COLUMN inbound_emails.error_message IS 'Error message if processing failed';

COMMENT ON TABLE inbound_email_attachments IS 'Stores attachments from inbound emails';
COMMENT ON COLUMN inbound_email_attachments.id IS 'Unique identifier for the attachment';
COMMENT ON COLUMN inbound_email_attachments.inbound_email_id IS 'Parent email reference';
COMMENT ON COLUMN inbound_email_attachments.filename IS 'Original filename of attachment';
COMMENT ON COLUMN inbound_email_attachments.mime_type IS 'MIME type of attachment';
COMMENT ON COLUMN inbound_email_attachments.size IS 'File size in bytes';
COMMENT ON COLUMN inbound_email_attachments.download_url IS 'URL to download from email provider';
COMMENT ON COLUMN inbound_email_attachments.stored_path IS 'Storage path in Supabase Storage';
COMMENT ON COLUMN inbound_email_attachments.is_invoice_pdf IS 'Whether this attachment is a PDF invoice';
COMMENT ON COLUMN inbound_email_attachments.invoice_id IS 'Linked invoice if created from this attachment';
