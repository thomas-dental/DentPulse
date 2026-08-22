/**
 * Inbound Email Service
 * Handles processing of inbound emails received via webhook
 */

import { supabase } from '@/integrations/supabase/client';
import { extractFromPdfOrImage, type InvoiceExtractionResult } from '@/services/openAIService';

// Types
export interface InboundEmailPayload {
  event: string;
  email: {
    recipient: string;
    from: {
      addresses: Array<{
        address: string;
        name?: string;
      }>;
    };
    to: {
      addresses: Array<{
        address: string;
        name?: string;
      }>;
    };
    subject?: string;
    receivedAt?: string;
    messageId?: string;
    threadId?: string;
    cleanedContent?: {
      html?: string;
      text?: string;
      attachments?: InboundAttachment[];
    };
    parsedData?: {
      htmlBody?: string;
      textBody?: string;
      attachments?: InboundAttachment[];
    };
  };
}

export interface InboundAttachment {
  filename: string;
  contentType: string;
  size: number;
  downloadUrl: string;
}

export interface InboundEmailResult {
  status: 'success' | 'ignored' | 'error';
  reason?: string;
  emailId?: string;
  invoiceId?: string;
}

export interface ResolvedRecipient {
  userId: string | null;
  organizationId: string | null;
  emailType: 'cost' | 'sales' | 'personal' | null;
  ruleId?: string;
  folderId?: string | null;
  chartOfAccountId?: string | null;
  locationId?: string | null;
}

// =============================================================================
// DEPRECATED: The following functions have been moved to Node.js backend
// Backend handles webhook processing with local file storage + OpenAI extraction
// Keeping commented for reference - DO NOT USE
// =============================================================================

/*
// MOVED TO BACKEND: processInboundEmail
// Backend endpoint: POST /api/inbound-email-webhook/webhook
export async function processInboundEmail(payload: InboundEmailPayload): Promise<InboundEmailResult> {
  console.log('Processing inbound email webhook', { event: payload.event });

  // Validate event type
  if (payload.event !== 'email.received') {
    return {
      status: 'ignored',
      reason: 'not an email.received event',
    };
  }

  const emailData = payload.email;
  if (!emailData) {
    return {
      status: 'ignored',
      reason: 'missing email data',
    };
  }

  // Resolve recipient to user/organization
  const recipient = emailData.recipient;
  const resolved = await resolveRecipient(recipient);

  if (!resolved.userId && !resolved.organizationId) {
    console.warn('Inbound email for unknown recipient', { recipient });
    return {
      status: 'ignored',
      reason: 'No matching user or organization',
    };
  }

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

  // Save email to database
  const { data: email, error: emailError } = await supabase
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
      received_at: receivedAt,
      raw_payload: payload,
      has_attachments: attachments.length > 0,
      status: 'received',
    })
    .select()
    .single();

  if (emailError) {
    console.error('Error saving inbound email', emailError);
    return {
      status: 'error',
      reason: emailError.message,
    };
  }

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

  // Process attachments
  let invoiceId: string | undefined;
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

  // Update email status
  await supabase
    .from('inbound_emails')
    .update({ status: 'processed' })
    .eq('id', email.id);

  return {
    status: 'success',
    emailId: email.id,
    invoiceId,
  };
}
*/

/*
// MOVED TO BACKEND: resolveRecipient
async function resolveRecipient(recipient: string): Promise<ResolvedRecipient> {
  const result: ResolvedRecipient = {
    userId: null,
    organizationId: null,
    emailType: null,
    locationId: null,
  };

  if (!recipient) return result;

  // Check rules mapping table for matching inbound email address
  const { data: rule } = await supabase
    .from('accounts_payable_invoice_rules_mapping' as any)
    .select('*')
    .eq('inbound_email_address', recipient)
    .eq('is_active', true)
    .single();

  if (rule) {
    result.userId = rule.user_id;
    result.organizationId = rule.organization_id;
    result.emailType = 'cost';
    result.ruleId = rule.id;
    result.folderId = rule.folder_id;
    result.chartOfAccountId = rule.chart_of_account_id;
    result.locationId = rule.location_id || null;

    console.log('Inbound email matched rule', {
      recipient,
      ruleId: rule.id,
      organizationId: rule.organization_id,
      locationId: rule.location_id,
      folderId: rule.folder_id,
      chartOfAccountId: rule.chart_of_account_id,
    });

    return result;
  }

  // Check location_inbound_emails table for matching inbound email address
  const { data: orgInboundEmail } = await supabase
    .from('location_inbound_emails' as any)
    .select('*')
    .eq('inbound_email_address', recipient)
    .single();

  if (orgInboundEmail) {
    result.userId = orgInboundEmail.user_id || null;
    result.organizationId = orgInboundEmail.organization_id;
    result.emailType = orgInboundEmail.email_type || 'cost';
    result.locationId = orgInboundEmail.location_id || null;

    console.log('Inbound email matched organization inbound email', {
      recipient,
      organizationId: orgInboundEmail.organization_id,
      locationId: orgInboundEmail.location_id,
      folderId: orgInboundEmail.folder_id,
      chartOfAccountId: orgInboundEmail.chart_of_account_id,
      emailType: orgInboundEmail.email_type,
    });

    return result;
  }

  // Check profiles for personal inbound email address
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, current_organization_id')
    .eq('inbound_email_address', recipient)
    .single();

  if (profile) {
    result.userId = profile.id;
    result.organizationId = profile.current_organization_id;
    result.emailType = 'personal';

    console.log('Inbound email matched user profile', {
      recipient,
      userId: profile.id,
    });

    return result;
  }

  return result;
}
*/

/*
// MOVED TO BACKEND: createEmailNotification
async function createEmailNotification(params: {
  userId: string | null;
  organizationId: string | null;
  emailId: string;
  fromEmail: string | null;
  fromName: string | null;
  subject: string;
  attachmentsCount: number;
}) {
  const { userId, organizationId, emailId, fromEmail, fromName, subject, attachmentsCount } = params;

  const message = `New email received from ${fromName || 'Unknown'} (${fromEmail || 'unknown'})${
    attachmentsCount > 0 ? ` with ${attachmentsCount} attachment(s)` : ''
  }`;

  await supabase.from('general_notification').insert({
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

// MOVED TO BACKEND: processAttachment
async function processAttachment(params: {
  emailId: string;
  attachment: InboundAttachment;
  resolved: ResolvedRecipient;
  fromEmail: string | null;
}): Promise<{ attachmentId: string; invoiceId?: string }> {
  const { emailId, attachment, resolved, fromEmail } = params;

  const isPdf = attachment.filename?.toLowerCase().endsWith('.pdf');

  // Save attachment record
  const { data: attachmentRecord, error } = await supabase
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
    console.error('Error saving attachment', error);
    return { attachmentId: '' };
  }

  // If it's a PDF, download and store it, then create invoice
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
      await supabase
        .from('inbound_email_attachments')
        .update({ invoice_id: invoiceId })
        .eq('id', attachmentRecord.id);

      return { attachmentId: attachmentRecord.id, invoiceId };
    }
  }

  return { attachmentId: attachmentRecord.id };
}
*/

/*
// MOVED TO BACKEND: processPdfInvoice
// Backend now:
// 1. Saves PDF to local folder: backend/AP-Invoices/{location_id}/
// 2. Extracts invoice data using OpenAI GPT-4o
// 3. Creates invoice + line items in database
async function processPdfInvoice(params: {
  attachmentId: string;
  downloadUrl: string;
  filename: string;
  resolved: ResolvedRecipient;
  fromEmail: string | null;
}): Promise<string | null> {
  const { attachmentId, downloadUrl, filename, resolved, fromEmail } = params;

  try {
    // Download PDF from the provided URL
    const response = await fetch(downloadUrl);
    if (!response.ok) {
      console.error('Failed to download PDF', { status: response.status });
      return null;
    }

    const pdfBuffer = await response.arrayBuffer();
    const pdfBlob = new Blob([pdfBuffer], { type: 'application/pdf' });

    // Generate storage path: {timestamp}_{filename}
    // Using timestamp prefix to avoid filename conflicts
    const timestamp = Date.now();
    const storagePath = `${timestamp}_${filename}`;

    // Upload to Supabase Storage (inbound-attechments bucket)
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('inbound-attechments')
      .upload(storagePath, pdfBlob, {
        contentType: 'application/pdf',
        upsert: false,
      });

    if (uploadError) {
      console.error('Failed to upload PDF to storage', uploadError);
      return null;
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('inbound-attechments')
      .getPublicUrl(storagePath);

    // Update attachment with stored path
    await supabase
      .from('inbound_email_attachments')
      .update({
        stored_path: storagePath,
        storage_bucket: 'inbound-attechments',
      })
      .eq('id', attachmentId);

    // Create invoice record
    const { data: invoice, error: invoiceError } = await supabase
      .from('accounts_payable_invoice')
      .insert({
        organization_id: resolved.organizationId,
        user_id: resolved.userId,
        folder_id: resolved.folderId || null,
        chart_of_account_id: resolved.chartOfAccountId || null,
        location_id: resolved.locationId || null,
        supplier_name: fromEmail || 'Unknown Supplier',
        invoice_pdf_url: urlData.publicUrl,
        status: 'pending',
        source: 'email',
        // Additional fields can be extracted via OCR/AI later
      })
      .select()
      .single();

    if (invoiceError) {
      console.error('Failed to create invoice record', invoiceError);
      return null;
    }

    // Create notification for new invoice
    await supabase.from('general_notification').insert({
      user_id: resolved.userId,
      organization_id: resolved.organizationId,
      notification_type: 'invoice',
      title: 'New Invoice Received',
      message: `Invoice received from ${fromEmail || 'Unknown'} via email`,
      data: {
        invoice_id: invoice.id,
        source: 'email',
        from_email: fromEmail,
      },
    });

    console.log('Invoice created from email attachment', {
      invoiceId: invoice.id,
      filename,
    });

    return invoice.id;
  } catch (error) {
    console.error('Error processing PDF invoice', error);
    return null;
  }
}
*/
// =============================================================================
// END OF DEPRECATED FUNCTIONS
// =============================================================================

// Backend API URL for inbound email processing
const INBOUND_EMAIL_API_URL = 'https://dent-enterprise-api.dentpulse.com/api/inbound-email-webhook';

/**
 * Extract invoice from attachment using backend API
 */
export async function extractInvoiceFromAttachment(
  attachmentId: string,
  pdfUrl?: string
): Promise<{
  status: 'success' | 'exists' | 'error';
  invoiceId?: string;
  invoice?: {
    id: string;
    invoice_number?: string;
    vendor_name?: string;
    total_amount?: number;
    confidence_score?: number;
  };
  error?: string;
}> {
  try {
    const response = await fetch(`${INBOUND_EMAIL_API_URL}/extract-invoice`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        attachmentId,
        pdfUrl,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Extract invoice API error:', response.status, errorText);
      return {
        status: 'error',
        error: `API error: ${response.status}`,
      };
    }

    const result = await response.json();
    return result;
  } catch (error) {
    console.error('Extract invoice error:', error);
    return {
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Extract invoice from attachment using FRONTEND OpenAI service
 * This downloads the PDF, extracts data via openAIService.ts, and saves to Supabase directly
 * No backend API needed - all processing happens in the browser
 */
export async function extractInvoiceFromAttachmentFrontend(
  attachmentId: string,
  pdfUrl: string,
  organizationId?: string | null,
  userId?: string | null,
  locationId?: string | null
): Promise<{
  status: 'success' | 'exists' | 'error';
  invoiceId?: string;
  invoice?: {
    id: string;
    invoice_number?: string;
    vendor_name?: string;
    total_amount?: number;
    confidence_score?: number;
  };
  error?: string;
}> {
  try {
    console.log('[Frontend Extraction] Starting extraction for attachment:', attachmentId);

    // Check if attachment already has invoice and get stored path info
    const { data: existingAttachment } = await supabase
      .from('inbound_email_attachments')
      .select('invoice_id, filename, stored_path, storage_bucket, download_url, inbound_email:inbound_emails(id, organization_id, user_id, location_id, from_email)')
      .eq('id', attachmentId)
      .single();

    if (existingAttachment?.invoice_id) {
      console.log('[Frontend Extraction] Invoice already exists:', existingAttachment.invoice_id);
      return { status: 'exists', invoiceId: existingAttachment.invoice_id };
    }

    // Use attachment data for organization/user/location if not provided
    const emailData = existingAttachment?.inbound_email as any;
    const finalOrgId = organizationId || emailData?.organization_id;
    const finalUserId = userId || emailData?.user_id;
    const finalLocationId = locationId || emailData?.location_id;
    const fromEmail = emailData?.from_email;

    // Step 1: Download PDF - try multiple sources
    let pdfBlob: Blob | null = null;
    const filename = existingAttachment?.filename || 'invoice.pdf';

    // Priority 1: Backend storage (no CORS issues)
    if (existingAttachment?.stored_path && existingAttachment?.storage_bucket === 'backend-storage') {
      const pathParts = existingAttachment.stored_path.split('/');
      if (pathParts.length >= 2) {
        // stored_path format: AP-Invoices/{filename}
        const fname = pathParts[pathParts.length - 1]; // Get last part (filename)
        const backendPdfUrl = `${INBOUND_EMAIL_API_URL}/view-pdf/${fname}`;
        console.log('[Frontend Extraction] Downloading from backend storage:', backendPdfUrl);

        try {
          const response = await fetch(backendPdfUrl);
          if (response.ok) {
            pdfBlob = await response.blob();
            console.log('[Frontend Extraction] PDF downloaded from backend, size:', pdfBlob.size);
          }
        } catch (e) {
          console.warn('[Frontend Extraction] Backend download failed, trying next source');
        }
      }
    }

    // Priority 2: Supabase storage
    if (!pdfBlob && existingAttachment?.stored_path && existingAttachment?.storage_bucket && existingAttachment.storage_bucket !== 'backend-storage') {
      const { data: urlData } = supabase.storage
        .from(existingAttachment.storage_bucket)
        .getPublicUrl(existingAttachment.stored_path);

      if (urlData?.publicUrl) {
        console.log('[Frontend Extraction] Downloading from Supabase storage:', urlData.publicUrl);
        try {
          const response = await fetch(urlData.publicUrl);
          if (response.ok) {
            pdfBlob = await response.blob();
            console.log('[Frontend Extraction] PDF downloaded from Supabase, size:', pdfBlob.size);
          }
        } catch (e) {
          console.warn('[Frontend Extraction] Supabase download failed, trying next source');
        }
      }
    }

    // Priority 3: Use download-attachment edge function to store and get public URL
    // This handles authentication with inbound.new API server-side
    if (!pdfBlob) {
      console.log('[Frontend Extraction] Calling download-attachment edge function to store attachment...');
      try {
        const { data: downloadResult, error: downloadError } = await supabase.functions.invoke('download-attachment', {
          body: { attachmentId }
        });

        if (downloadError) {
          console.error('[Frontend Extraction] download-attachment error:', downloadError);
        } else if (downloadResult?.publicUrl) {
          console.log('[Frontend Extraction] Attachment stored, downloading from:', downloadResult.publicUrl);
          const response = await fetch(downloadResult.publicUrl);
          if (response.ok) {
            pdfBlob = await response.blob();
            console.log('[Frontend Extraction] PDF downloaded from stored URL, size:', pdfBlob.size);
          }
        }
      } catch (e) {
        console.error('[Frontend Extraction] download-attachment failed:', e);
      }
    }

    // Priority 4: Original download URL (fallback - may fail due to CORS/auth)
    if (!pdfBlob && pdfUrl) {
      console.log('[Frontend Extraction] Downloading from original URL (fallback):', pdfUrl);
      try {
        const response = await fetch(pdfUrl);
        if (response.ok) {
          pdfBlob = await response.blob();
          console.log('[Frontend Extraction] PDF downloaded from URL, size:', pdfBlob.size);
        }
      } catch (e) {
        console.error('[Frontend Extraction] Original URL download failed (CORS/auth?):', e);
      }
    }

    if (!pdfBlob || pdfBlob.size === 0) {
      throw new Error('Failed to download PDF from any source. The file may not be accessible.');
    }

    const pdfFile = new File([pdfBlob], filename, { type: 'application/pdf' });
    console.log('[Frontend Extraction] PDF downloaded, size:', pdfFile.size);

    // Step 2: Extract invoice data using OpenAI (frontend service)
    console.log('[Frontend Extraction] Extracting invoice data with OpenAI...');
    const extractionResult: InvoiceExtractionResult = await extractFromPdfOrImage(pdfFile);
    console.log('[Frontend Extraction] Extraction complete:', {
      vendor: extractionResult.parsed.vendor_name,
      invoiceNumber: extractionResult.parsed.invoice_number,
      total: extractionResult.parsed.total_amount,
    });

    const extracted = extractionResult.parsed;
    const rawText = extractionResult.raw_text;

    // Calculate confidence score
    const confidenceScores = extracted.confidence_scores || {};
    const scores = Object.values(confidenceScores).filter((v): v is number => typeof v === 'number');
    const overallConfidence = scores.length > 0
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      : 0;

    // Get PDF path from attachment (already stored by webhook)
    const pdfPath = existingAttachment?.stored_path || null;

    // Match an automation rule (Location → Rules tab) so the extracted invoice
    // is auto-filed into the configured folder / COA — same as a manual upload.
    // Rules are keyed on the sender email; fall back to the extracted vendor email.
    let matchedRule = fromEmail ? await matchEmailToRule(fromEmail, finalOrgId) : null;
    if (!matchedRule) {
      const vendorEmail = (extracted as any).vendor_email || (extracted as any).supplier_email || null;
      if (vendorEmail) {
        matchedRule = await matchEmailToRule(vendorEmail, finalOrgId);
      }
    }
    if (matchedRule) {
      console.log('[Frontend Extraction] Matched rule:', matchedRule);
    }

    // Step 3: Create invoice record in Supabase
    console.log('[Frontend Extraction] Creating invoice in database...');
    const { data: invoice, error: invoiceError } = await supabase
      .from('accounts_payable_invoice')
      .insert({
        organization_id: finalOrgId || null,
        user_id: finalUserId || null,
        location_id: finalLocationId || null,
        folder_id: matchedRule?.folderId || null,
        pdf_path: pdfPath,
        vendor_name: extracted.vendor_name || fromEmail || 'Unknown Supplier',
        customer_name: extracted.customer_name || null,
        invoice_number: extracted.invoice_number || null,
        invoice_date: extracted.invoice_date || null,
        due_date: extracted.due_date || null,
        currency: extracted.currency || 'GBP',
        subtotal: extracted.subtotal || null,
        tax: extracted.tax || null,
        total_amount: extracted.total_amount || null,
        account: extracted.account || null,
        purchase_order: extracted.purchase_order || null,
        amount_due: extracted.amount_due || null,
        account_number: extracted.account_number || null,
        order_number: extracted.order_number || null,
        patient: extracted.patient || null,
        date_delivered: extracted.date_delivered || null,
        payment_due_by: extracted.payment_due_by || null,
        amount: extracted.amount || null,
        total_no_vat: extracted.total_no_vat || null,
        total_gbp: extracted.total_gbp || null,
        brand_id: extracted.brand_id || null,
        billed_to: extracted.billed_to || null,
        charged: typeof extracted.charged === 'boolean' ? (extracted.charged ? 1 : 0) : null,
        customer_reference: extracted.customer_reference || null,
        supply_address: extracted.supply_address || null,
        supply_point_id: extracted.supply_point_id || null,
        previous_balance: extracted.previous_balance || null,
        payments_received: extracted.payments_received || null,
        balance_brought_forward: extracted.balance_brought_forward || null,
        account_balance: extracted.account_balance || null,
        vat_no: extracted.vat_no || null,
        raw_json: extracted || null,
        raw_text: rawText || null,
        confidence_score: overallConfidence,
        status: 'pending_review',
        source: 'email',
        created_by: finalUserId ? String(finalUserId) : null,
      } as any)
      .select()
      .single();

    if (invoiceError) {
      console.error('[Frontend Extraction] Failed to create invoice:', invoiceError);
      throw new Error(`Failed to create invoice: ${invoiceError.message}`);
    }

    console.log('[Frontend Extraction] Invoice created:', invoice.id);

    // Step 4: Update attachment with invoice ID
    await supabase
      .from('inbound_email_attachments')
      .update({ invoice_id: invoice.id })
      .eq('id', attachmentId);

    // Step 5: Update email with invoice ID
    if (emailData?.id) {
      await supabase
        .from('inbound_emails')
        .update({ invoice_id: invoice.id, status: 'processed' })
        .eq('id', emailData.id);
    }

    // Step 6: Insert line items if present
    if (extracted.items && extracted.items.length > 0) {
      const lineItemsData = extracted.items.map((item) => ({
        accounts_payable_invoice_id: invoice.id,
        description: item.description || null,
        quantity: item.quantity || null,
        unit_price: item.unit_price || null,
        line_total: item.line_total || null,
        item: item.item || null,
        location: item.location || null,
        platform_account_id: matchedRule?.chartOfAccountId || null, // Apply COA from rule
        raw_item_json: item,
        created_by: finalUserId ? String(finalUserId) : null,
      }));

      const { error: lineItemsError } = await supabase
        .from('accounts_payable_invoice_line_item')
        .insert(lineItemsData as any);

      if (lineItemsError) {
        console.error('[Frontend Extraction] Error inserting line items:', lineItemsError);
      } else {
        console.log('[Frontend Extraction] Line items saved:', lineItemsData.length);
      }
    }

    return {
      status: 'success',
      invoiceId: invoice.id,
      invoice: {
        id: invoice.id,
        invoice_number: extracted.invoice_number || undefined,
        vendor_name: extracted.vendor_name || undefined,
        total_amount: extracted.total_amount || undefined,
        confidence_score: overallConfidence,
      },
    };
  } catch (error) {
    console.error('[Frontend Extraction] Error:', error);
    return {
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Reprocess attachment to re-extract invoice data using backend API
 */
export async function reprocessAttachment(
  attachmentId: string
): Promise<{
  status: 'success' | 'error';
  invoiceId?: string;
  invoice?: {
    id: string;
    invoice_number?: string;
    vendor_name?: string;
    total_amount?: number;
    confidence_score?: number;
  };
  error?: string;
}> {
  try {
    const response = await fetch(`${INBOUND_EMAIL_API_URL}/reprocess-attachment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        attachmentId,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Reprocess attachment API error:', response.status, errorText);
      return {
        status: 'error',
        error: `API error: ${response.status}`,
      };
    }

    const result = await response.json();
    return result;
  } catch (error) {
    console.error('Reprocess attachment error:', error);
    return {
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Upload invoice PDF to backend server
 */
export async function uploadInvoicePdf(
  file: File,
  options: {
    locationId?: string;
    organizationId?: string;
    userId?: string;
  }
): Promise<{
  status: 'success' | 'error';
  invoiceId?: string;
  pdfPath?: string;
  invoice?: {
    id: string;
    invoice_number?: string;
    vendor_name?: string;
    total_amount?: number;
    confidence_score?: number;
  };
  error?: string;
}> {
  try {
    const formData = new FormData();
    formData.append('file', file);
    if (options.locationId) formData.append('locationId', options.locationId);
    if (options.organizationId) formData.append('organizationId', options.organizationId);
    if (options.userId) formData.append('userId', options.userId);

    const response = await fetch(`${INBOUND_EMAIL_API_URL}/upload-invoice`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Upload invoice API error:', response.status, errorText);
      return {
        status: 'error',
        error: `API error: ${response.status}`,
      };
    }

    const result = await response.json();
    return result;
  } catch (error) {
    console.error('Upload invoice error:', error);
    return {
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Match email sender against rules
 */
export async function matchEmailToRule(
  fromEmail: string,
  organizationId: string | null
): Promise<{
  ruleId: string;
  folderId: string | null;
  chartOfAccountId: string | null;
  locationId: string | null;
} | null> {
  if (!fromEmail) return null;

  const query = supabase
    .from('accounts_payable_invoice_rules_mapping' as any)
    .select('id, folder_id, chart_of_account_id, location_id')
    .eq('email', fromEmail)
    .eq('is_active', true);

  if (organizationId) {
    query.eq('organization_id', organizationId);
  }

  const { data: rule } = await query.maybeSingle();

  if (rule) {
    return {
      ruleId: rule.id,
      folderId: rule.folder_id,
      chartOfAccountId: rule.chart_of_account_id,
      locationId: rule.location_id,
    };
  }

  return null;
}
