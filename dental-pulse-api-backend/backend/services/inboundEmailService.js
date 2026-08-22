const { supabaseAdmin } = require('../config/supabase');
const fs = require('fs');
const path = require('path');

// Inbound email service API key (for downloading attachments from inbound.new)
const INBOUND_API_KEY = process.env.INBOUND_API_KEY;

// Base path for storing AP invoices locally
const AP_INVOICES_BASE_PATH = path.join(__dirname, '..', 'AP-Invoices');

/**
 * Ensure directory exists, create if not
 */
function ensureDirectoryExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Get the local storage path for an invoice PDF
 * @param {string} filename - The filename
 * @returns {{ fullPath: string, relativePath: string }}
 */
function getLocalStoragePath(filename) {
  ensureDirectoryExists(AP_INVOICES_BASE_PATH);

  const timestamp = Date.now();
  const safeFilename = `${timestamp}_${filename.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
  const fullPath = path.join(AP_INVOICES_BASE_PATH, safeFilename);
  const relativePath = `AP-Invoices/${safeFilename}`;

  return { fullPath, relativePath, dirPath: AP_INVOICES_BASE_PATH };
}

/**
 * Process inbound email webhook
 */
async function processInboundEmailWebhook(payload) {
  console.log('[InboundEmail] Webhook received');

  // Log webhook received
  await logToDatabase({
    action: 'webhook_received',
    status: 'pending',
    requestPayload: { event: payload.event, recipient: payload.email?.recipient },
    metadata: { step: 'webhook_hit' },
  });

  // Validate event type
  if (payload.event !== 'email.received') {
    console.log('[InboundEmail] Ignoring event:', payload.event);
    await logToDatabase({
      action: 'webhook_received',
      status: 'ignored',
      requestPayload: { event: payload.event },
      metadata: { step: 'invalid_event_type', reason: 'not an email.received event' },
    });
    return { status: 'ignored', reason: 'not an email.received event' };
  }

  const emailData = payload.email;
  if (!emailData) {
    console.log('[InboundEmail] Missing email data');
    await logToDatabase({
      action: 'webhook_received',
      status: 'ignored',
      metadata: { step: 'missing_email_data', reason: 'missing email data' },
    });
    return { status: 'ignored', reason: 'missing email data' };
  }

  // Resolve recipient to user/organization/location
  const recipient = emailData.recipient;
  console.log('[InboundEmail] Processing email for recipient:', recipient);

  const resolved = await resolveRecipient(recipient);

  if (!resolved.userId && !resolved.organizationId) {
    console.warn('[InboundEmail] Unknown recipient:', recipient);
    await logToDatabase({
      action: 'receive_email',
      status: 'ignored',
      requestPayload: { recipient },
      metadata: { step: 'unknown_recipient', reason: 'No matching user or organization' },
    });
    return { status: 'ignored', reason: 'No matching user or organization', recipient };
  }

  console.log('[InboundEmail] Recipient resolved:', {
    organizationId: resolved.organizationId,
    locationId: resolved.locationId,
    emailType: resolved.emailType,
  });

  // Log recipient resolved
  await logToDatabase({
    organizationId: resolved.organizationId,
    userId: resolved.userId,
    action: 'receive_email',
    status: 'pending',
    requestPayload: { recipient, from: emailData.from?.addresses?.[0]?.address },
    metadata: { step: 'recipient_resolved', emailType: resolved.emailType, ruleId: resolved.ruleId },
  });

  // Extract email fields
  const fromAddresses = emailData.from?.addresses || [];
  const toAddresses = emailData.to?.addresses || [];
  const cleaned = emailData.cleanedContent || {};

  const fromEmail = fromAddresses[0]?.address || null;
  const fromName = fromAddresses[0]?.name || null;
  const toEmail = toAddresses[0]?.address || recipient;

  const subject = emailData.subject || '';
  const receivedAt = emailData.receivedAt || null;
  const messageId = emailData.messageId || null;
  const threadId = emailData.threadId || null;

  const htmlBody = cleaned.html || emailData.parsedData?.htmlBody || null;
  const textBody = cleaned.text || emailData.parsedData?.textBody || null;
  const attachments = cleaned.attachments || emailData.parsedData?.attachments || [];

  // Format received_at for database
  const receivedAtFormatted = receivedAt ? new Date(receivedAt).toISOString() : null;

  // Save email to database
  const { data: email, error: emailError } = await supabaseAdmin
    .from('inbound_emails')
    .insert({
      user_id: resolved.userId,
      organization_id: resolved.organizationId,
      location_id: resolved.locationId || null,
      message_id: messageId,
      thread_id: threadId,
      from_email: fromEmail,
      from_name: fromName,
      to_email: toEmail,
      subject: subject,
      text_body: textBody,
      html_body: htmlBody,
      received_at: receivedAtFormatted,
      raw_payload: JSON.stringify(payload),
      has_attachments: attachments.length > 0,
      status: 'received',
    })
    .select()
    .single();

  if (emailError) {
    console.error('[InboundEmail] Error saving email:', emailError);
    await logToDatabase({
      organizationId: resolved.organizationId,
      userId: resolved.userId,
      action: 'receive_email',
      status: 'failed',
      errorMessage: emailError.message,
      errorCode: 'DB_INSERT_FAILED',
      metadata: { step: 'save_email_failed' },
    });
    throw new Error(emailError.message);
  }

  console.log('[InboundEmail] Email saved with ID:', email.id);

  // Log email saved
  await logToDatabase({
    organizationId: resolved.organizationId,
    userId: resolved.userId,
    action: 'receive_email',
    status: 'success',
    inboundEmailId: email.id,
    responsePayload: { emailId: email.id, fromEmail, subject, attachmentsCount: attachments.length },
    metadata: { step: 'email_saved', hasAttachments: attachments.length > 0 },
  });

  // Create notification for email received
  await createEmailNotification({
    userId: resolved.userId,
    organizationId: resolved.organizationId,
    emailId: email.id,
    fromEmail,
    fromName,
    subject,
    attachmentsCount: attachments.length,
  });

  // Process attachments (PDF invoices)
  let invoiceId = null;
  for (const attachment of attachments) {
    const result = await processAttachment({
      emailId: email.id,
      attachment,
      resolved,
      fromEmail,
    });
    if (result.invoiceId) {
      invoiceId = result.invoiceId;
    }
  }

  // Update email status and invoice_id
  await supabaseAdmin
    .from('inbound_emails')
    .update({
      status: 'processed',
      invoice_id: invoiceId || null,
    })
    .eq('id', email.id);

  // Log processing completed
  await logToDatabase({
    organizationId: resolved.organizationId,
    userId: resolved.userId,
    action: 'process_email',
    status: 'success',
    inboundEmailId: email.id,
    invoiceId: invoiceId,
    responsePayload: { emailId: email.id, invoiceId },
    metadata: { step: 'processing_completed', attachmentsProcessed: attachments.length },
  });

  console.log('[InboundEmail] Processing completed:', { emailId: email.id, invoiceId });

  return { status: 'success', emailId: email.id, invoiceId };
}

/**
 * Resolve recipient email to user/organization/location
 */
async function resolveRecipient(recipient) {
  const result = {
    userId: null,
    organizationId: null,
    emailType: null,
    ruleId: null,
    folderId: null,
    chartOfAccountId: null,
    locationId: null,
  };

  if (!recipient) return result;

  const recipientLower = recipient.toLowerCase();

  // 1. Check rules mapping table for matching inbound email address (highest priority)
  const { data: rule } = await supabaseAdmin
    .from('accounts_payable_invoice_rules_mapping')
    .select('*')
    .ilike('inbound_email_address', recipientLower)
    .eq('is_active', true)
    .limit(1)
    .single();

  if (rule) {
    console.log('[InboundEmail] Matched rule:', { ruleId: rule.id, organizationId: rule.organization_id });
    result.userId = rule.user_id;
    result.organizationId = rule.organization_id;
    result.emailType = 'cost';
    result.ruleId = rule.id;
    result.folderId = rule.folder_id;
    result.chartOfAccountId = rule.chart_of_account_id;
    result.locationId = rule.location_id;
    return result;
  }

  // 2. Check location_inbound_emails table for auto-generated inbound email address
  const { data: locInbound, error: locError } = await supabaseAdmin
    .from('location_inbound_emails')
    .select('organization_id, user_id, location_id, email_type')
    .ilike('inbound_email_address', recipientLower)
    .eq('inbound_created', 1)
    .limit(1)
    .single();

  console.log('[InboundEmail] location_inbound_emails lookup:', {
    recipient: recipientLower,
    found: !!locInbound,
    error: locError?.message,
  });

  if (locInbound) {
    console.log('[InboundEmail] Matched location inbound email:', {
      organizationId: locInbound.organization_id,
      locationId: locInbound.location_id,
    });
    result.userId = locInbound.user_id;
    result.organizationId = locInbound.organization_id;
    result.emailType = locInbound.email_type || 'cost';
    result.locationId = locInbound.location_id || null;
    return result;
  }

  // 3. Check profiles for personal inbound email address
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, current_organization_id')
    .eq('inbound_email_address', recipient)
    .limit(1)
    .single();

  if (profile) {
    console.log('[InboundEmail] Matched user profile:', { userId: profile.id });
    result.userId = profile.id;
    result.organizationId = profile.current_organization_id;
    result.emailType = 'personal';
    return result;
  }

  return result;
}

/**
 * Match rule by sender email to get folder and COA assignment
 */
async function matchRuleBySender(senderEmail, organizationId) {
  if (!senderEmail || !organizationId) {
    return { folderId: null, chartOfAccountId: null, locationId: null };
  }

  const { data: rule } = await supabaseAdmin
    .from('accounts_payable_invoice_rules_mapping')
    .select('folder_id, chart_of_account_id, location_id')
    .eq('email', senderEmail)
    .eq('organization_id', organizationId)
    .eq('is_active', true)
    .limit(1)
    .single();

  if (rule) {
    console.log('[InboundEmail] Matched sender rule:', { senderEmail, folderId: rule.folder_id });
    return {
      folderId: rule.folder_id,
      chartOfAccountId: rule.chart_of_account_id,
      locationId: rule.location_id,
    };
  }

  return { folderId: null, chartOfAccountId: null, locationId: null };
}

/**
 * Process email attachment (PDF invoice)
 */
async function processAttachment({ emailId, attachment, resolved, fromEmail }) {
  const isPdf = attachment.filename?.toLowerCase().endsWith('.pdf');

  // Save attachment record
  const { data: attachmentRecord, error } = await supabaseAdmin
    .from('inbound_email_attachments')
    .insert({
      inbound_email_id: emailId,
      filename: attachment.filename,
      mime_type: attachment.contentType,
      size: attachment.size,
      download_url: attachment.downloadUrl,
      is_invoice_pdf: isPdf,
    })
    .select()
    .single();

  if (error) {
    console.error('[InboundEmail] Error saving attachment:', error);
    return { attachmentId: null };
  }

  console.log('[InboundEmail] Attachment saved:', { attachmentId: attachmentRecord.id, filename: attachment.filename });

  // If it's a PDF, download and process it
  if (isPdf && attachment.downloadUrl) {
    const invoiceId = await processPdfInvoice({
      attachmentId: attachmentRecord.id,
      downloadUrl: attachment.downloadUrl,
      filename: attachment.filename,
      resolved,
      fromEmail,
    });

    if (invoiceId) {
      // Update attachment with invoice ID
      await supabaseAdmin
        .from('inbound_email_attachments')
        .update({ invoice_id: invoiceId })
        .eq('id', attachmentRecord.id);

      return { attachmentId: attachmentRecord.id, invoiceId };
    }
  }

  return { attachmentId: attachmentRecord.id };
}

/**
 * Process PDF invoice attachment
 */
/**
 * Process PDF invoice attachment - ONLY stores PDF, NO extraction
 * Extraction is handled by frontend when user clicks "Extract Invoice"
 */
async function processPdfInvoice({ attachmentId, downloadUrl, filename, resolved, fromEmail }) {
  try {
    console.log('[InboundEmail] Downloading PDF:', { filename, attachmentId });

    // Download PDF - use API key for inbound.new URLs
    const fetchOptions = {};
    if (downloadUrl.includes('inbound.new') && INBOUND_API_KEY) {
      fetchOptions.headers = {
        'Authorization': `Bearer ${INBOUND_API_KEY}`,
      };
    }

    const response = await fetch(downloadUrl, fetchOptions);
    if (!response.ok) {
      console.error('[InboundEmail] Failed to download PDF:', response.status);
      await logToDatabase({
        organizationId: resolved.organizationId,
        userId: resolved.userId,
        action: 'download_attachment',
        status: 'failed',
        errorMessage: `HTTP ${response.status}`,
        metadata: { step: 'download_failed', attachmentId, filename },
      });
      return null;
    }

    const pdfBuffer = await response.arrayBuffer();
    console.log('[InboundEmail] PDF downloaded:', { size: pdfBuffer.byteLength });

    // Save to local folder: backend/AP-Invoices/
    const { fullPath, relativePath } = getLocalStoragePath(filename);

    try {
      fs.writeFileSync(fullPath, Buffer.from(pdfBuffer));
      console.log('[InboundEmail] PDF saved locally:', fullPath);
    } catch (writeError) {
      console.error('[InboundEmail] Failed to save PDF locally:', writeError);
      await logToDatabase({
        organizationId: resolved.organizationId,
        userId: resolved.userId,
        action: 'upload_attachment',
        status: 'failed',
        errorMessage: writeError.message,
        metadata: { step: 'local_save_failed', attachmentId, filename },
      });
      return null;
    }

    // Update attachment with stored path (local path)
    await supabaseAdmin
      .from('inbound_email_attachments')
      .update({
        stored_path: relativePath,
        storage_bucket: 'backend-storage',
      })
      .eq('id', attachmentId);

    // Log successful PDF storage
    await logToDatabase({
      organizationId: resolved.organizationId,
      userId: resolved.userId,
      action: 'store_pdf',
      status: 'success',
      metadata: { step: 'pdf_stored', attachmentId, filename, storedPath: relativePath },
    });

    console.log('[InboundEmail] PDF stored successfully:', { attachmentId, storedPath: relativePath });

    // Note: Invoice extraction is done by frontend when user clicks "Extract Invoice"
    return null; // No invoice ID - frontend will create invoice after extraction
  } catch (error) {
    console.error('[InboundEmail] Error processing PDF:', error);
    return null;
  }
}

/**
 * Create notification for received email
 */
async function createEmailNotification({ userId, organizationId, emailId, fromEmail, fromName, subject, attachmentsCount }) {
  const message = `New email received from ${fromName || 'Unknown'} (${fromEmail || 'unknown'})${
    attachmentsCount > 0 ? ` with ${attachmentsCount} attachment(s)` : ''
  }`;

  await supabaseAdmin.from('general_notification').insert({
    user_id: userId,
    organization_id: organizationId,
    notification_type: 'email_received',
    title: 'New Email Received',
    message,
    data: {
      inbound_email_id: emailId,
      from_email: fromEmail,
      from_name: fromName,
      subject,
      has_attachments: attachmentsCount > 0,
      attachments_count: attachmentsCount,
    },
  });
}

/**
 * Log to inbound_email_logs table
 */
async function logToDatabase(params) {
  try {
    await supabaseAdmin.from('inbound_email_logs').insert({
      organization_id: params.organizationId || null,
      user_id: params.userId || null,
      action: params.action,
      status: params.status,
      request_payload: params.requestPayload || null,
      response_payload: params.responsePayload || null,
      error_message: params.errorMessage || null,
      error_code: params.errorCode || null,
      inbound_email_id: params.inboundEmailId || null,
      invoice_id: params.invoiceId || null,
      metadata: params.metadata || null,
    });
  } catch (error) {
    console.error('[InboundEmail] Failed to write log:', error);
  }
}

/**
 * Store PDF file only (no extraction, no Supabase insert)
 * Used when frontend handles extraction
 * @param {Object} params
 * @param {Buffer} params.fileBuffer - PDF file buffer
 * @param {string} params.filename - Original filename
 * @param {string} params.locationId - Location ID for folder structure
 * @returns {{ status: string, pdfPath: string }}
 */
function storePdfOnly({ fileBuffer, filename }) {
  console.log('[InboundEmail] Storing PDF only:', { filename });

  // Save PDF to local folder: backend/AP-Invoices/
  const { fullPath, relativePath } = getLocalStoragePath(filename);

  try {
    fs.writeFileSync(fullPath, fileBuffer);
    console.log('[InboundEmail] PDF saved locally:', fullPath);

    return {
      status: 'success',
      pdfPath: relativePath,
      fullPath: fullPath,
    };
  } catch (writeError) {
    console.error('[InboundEmail] Failed to save PDF locally:', writeError);
    throw new Error('Failed to save PDF file');
  }
}

/**
 * Stream PDF file to response (for viewing without authentication)
 * @param {string} filename - PDF filename
 * @param {object} res - Express response object
 */
function streamPdfFile(filename, res) {
  try {
    const filePath = path.join(AP_INVOICES_BASE_PATH, filename);

    console.log('[InboundEmail] Streaming PDF:', { filename, filePath, exists: fs.existsSync(filePath) });

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      console.error('[InboundEmail] PDF not found:', filePath);
      return res.status(404).json({ status: 'error', reason: 'File not found' });
    }

    // Set headers for PDF viewing in browser/iframe
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-cache');

    // Stream the file
    const fileStream = fs.createReadStream(filePath);
    fileStream.on('error', (err) => {
      console.error('[InboundEmail] Error streaming PDF:', err);
      if (!res.headersSent) {
        res.status(500).json({ status: 'error', reason: 'Error reading file' });
      }
    });
    fileStream.pipe(res);
  } catch (error) {
    console.error('[InboundEmail] View PDF error:', error);
    if (!res.headersSent) {
      res.status(500).json({ status: 'error', reason: error.message });
    }
  }
}

module.exports = {
  processInboundEmailWebhook,
  resolveRecipient,
  matchRuleBySender,
  processAttachment,
  processPdfInvoice,
  createEmailNotification,
  logToDatabase,
  storePdfOnly,
  streamPdfFile,
};
