import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Helper function to log to database
async function logToDatabase(
  supabase: any,
  params: {
    organizationId?: string | null;
    userId?: number | null;
    action: string;
    status: string;
    requestPayload?: any;
    responsePayload?: any;
    errorMessage?: string;
    errorCode?: string;
    inboundEmailId?: number;
    invoiceId?: string;
    metadata?: any;
  }
) {
  try {
    await supabase.from("inbound_email_logs").insert({
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
    console.error("Failed to write log:", error);
  }
}

// Types
interface InboundEmailPayload {
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

interface InboundAttachment {
  filename: string;
  contentType: string;
  size: number;
  downloadUrl: string;
}

// Match the exact format used in openAIService.ts
interface ExtractedInvoiceData {
  // Main invoice fields
  vendor_name?: string | null;
  customer_name?: string | null;
  invoice_number?: string | null;
  invoice_date?: string | null;
  due_date?: string | null;
  currency?: string | null;
  subtotal?: number | null;
  tax?: number | null;
  total_amount?: number | null;

  // Extra fields
  account?: string | null;
  purchase_order?: string | null;
  amount_due?: number | null;
  account_number?: string | null;
  order_number?: string | null;
  patient?: string | null;
  date_delivered?: string | null;
  payment_due_by?: string | null;
  amount?: number | null;
  total_no_vat?: number | null;
  total_gbp?: number | null;
  brand_id?: string | null;
  billed_to?: string | null;
  charged?: boolean | null;
  customer_reference?: string | null;
  supply_address?: string | null;
  supply_point_id?: string | null;
  previous_balance?: number | null;
  payments_received?: number | null;
  balance_brought_forward?: number | null;
  account_balance?: number | null;
  vat_no?: string | null;

  // Line items
  items?: Array<{
    description?: string;
    quantity?: number;
    unit_price?: number;
    line_total?: number;
    item?: string;
    location?: string;
  }>;

  // Other data
  other_data?: string[];

  // Confidence scores
  confidence_scores?: Record<string, number>;
}

interface ResolvedRecipient {
  userId: number | null;
  organizationId: string | null;
  emailType: 'cost' | 'sales' | 'personal' | null;
  ruleId?: string;
  folderId?: string | null;
  chartOfAccountId?: string | null;
  locationId?: string | null;
}

/**
 * Extract invoice data from PDF using OpenAI
 * Uses the same approach and prompts as openAIService.ts for consistency
 *
 * IMPORTANT: OpenAI Vision API only supports images (PNG, JPEG, GIF, WEBP), NOT PDF directly.
 * We send the PDF as image/png which tells GPT-4o to process it visually.
 */
async function extractInvoiceDataFromPdf(
  pdfBuffer: ArrayBuffer,
  filename: string
): Promise<{ extracted: ExtractedInvoiceData; raw_text: string } | null> {
  const openaiApiKey = Deno.env.get("OPENAI_API_KEY");

  if (!openaiApiKey) {
    console.log("OPENAI_API_KEY not set, skipping automatic extraction");
    return null;
  }

  try {
    // Convert PDF buffer to base64
    const uint8Array = new Uint8Array(pdfBuffer);
    let binary = '';
    for (let i = 0; i < uint8Array.length; i++) {
      binary += String.fromCharCode(uint8Array[i]);
    }
    const base64Pdf = btoa(binary);

    console.log("[inbound-email] Sending PDF to OpenAI for extraction", { filename, size: pdfBuffer.byteLength });

    // Step 1: Extract raw text AND parse in a single call using GPT-4o
    // This is more reliable than two separate calls and matches the frontend approach
    const extractionResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "You are an expert invoice data extractor and parser. Extract all data from the invoice image and return valid JSON only."
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Extract ALL invoice data from this document and return as JSON.

RULES:
- Always include ALL fields mentioned below, even if value is null.
- Use null for missing/unknown values.
- Numbers should be numeric (no currency symbols).
- Dates should be ISO 'YYYY-MM-DD' if possible, else null.
- 'charged' should be boolean true/false if possible.
- IMPORTANT: Extract ALL line items/products from the invoice into the 'items' array.

1) Main invoice fields (top-level):
- vendor_name
- customer_name
- invoice_number
- invoice_date
- due_date
- currency
- subtotal
- tax
- total_amount

// EXTRA FIELDS (header):
- account
- purchase_order
- amount_due
- account_number
- order_number
- patient
- date_delivered
- payment_due_by
- amount
- total_no_vat
- total_gbp
- brand_id
- billed_to
- charged
- customer_reference
- supply_address
- supply_point_id
- previous_balance
- payments_received
- balance_brought_forward
- account_balance
- vat_no

2) Items (CRITICAL - extract ALL line items):
'items' should be an array of objects with:
- description (product/service name)
- quantity (number)
- unit_price (number)
- line_total (number)
- item (item code if available)
- location (if available)

3) Also return a 'confidence_scores' object with a numeric 0–100 score
for each TOP-LEVEL field above (invoice fields only).

Confidence meaning:
- 80–100: high confidence (green)
- 50–79: medium confidence (orange)
- 0–49 or missing: low confidence (red)

JSON SHAPE (example):
{
  "vendor_name": "...",
  "customer_name": "...",
  "invoice_number": "...",
  "invoice_date": "YYYY-MM-DD",
  "due_date": "YYYY-MM-DD",
  "currency": "GBP",
  "subtotal": 123.45,
  "tax": 12.34,
  "total_amount": 135.79,
  "account": "...",
  "purchase_order": "...",
  "amount_due": 135.79,
  "account_number": "...",
  "order_number": "...",
  "patient": "...",
  "date_delivered": null,
  "payment_due_by": null,
  "amount": 135.79,
  "total_no_vat": 120.00,
  "total_gbp": 135.79,
  "brand_id": null,
  "billed_to": "...",
  "charged": true,
  "customer_reference": "...",
  "supply_address": "...",
  "supply_point_id": "...",
  "previous_balance": 0,
  "payments_received": 0,
  "balance_brought_forward": 0,
  "account_balance": 135.79,
  "vat_no": "...",
  "items": [
    {
      "description": "Product Name",
      "quantity": 1,
      "unit_price": 10.00,
      "line_total": 10.00,
      "item": "SKU123",
      "location": "Store 1"
    }
  ],
  "other_data": [],
  "confidence_scores": {
    "vendor_name": 95,
    "customer_name": 90,
    "invoice_number": 100,
    "invoice_date": 95,
    "due_date": 85,
    "currency": 100,
    "subtotal": 90,
    "tax": 90,
    "total_amount": 95
  }
}`
              },
              {
                type: "image_url",
                image_url: {
                  // Use image/png to ensure GPT-4o processes it visually
                  url: `data:image/png;base64,${base64Pdf}`,
                  detail: "high"
                }
              }
            ]
          }
        ],
        max_tokens: 4096,
        temperature: 0.1
      }),
    });

    if (!extractionResponse.ok) {
      const errorText = await extractionResponse.text();
      console.error("[inbound-email] OpenAI extraction API error", { status: extractionResponse.status, error: errorText });

      // Fallback: Try with a simpler text-based approach
      console.log("[inbound-email] Trying fallback extraction method...");
      return await extractInvoiceDataFallback(base64Pdf, openaiApiKey);
    }

    const extractionResult = await extractionResponse.json();
    const content = extractionResult.choices?.[0]?.message?.content;

    if (!content) {
      console.error("[inbound-email] No content in OpenAI extraction response");
      return await extractInvoiceDataFallback(base64Pdf, openaiApiKey);
    }

    console.log("[inbound-email] OpenAI extraction response received", { contentLength: content.length });

    // Parse the JSON response
    const extractedData: ExtractedInvoiceData = JSON.parse(content);

    console.log("[inbound-email] Invoice data extracted successfully", {
      vendor_name: extractedData.vendor_name,
      invoice_number: extractedData.invoice_number,
      total_amount: extractedData.total_amount,
      items_count: extractedData.items?.length || 0
    });

    // Generate raw_text from extracted data for consistency
    const rawText = `Invoice: ${extractedData.invoice_number || 'N/A'}
Vendor: ${extractedData.vendor_name || 'N/A'}
Customer: ${extractedData.customer_name || 'N/A'}
Date: ${extractedData.invoice_date || 'N/A'}
Due: ${extractedData.due_date || 'N/A'}
Total: ${extractedData.total_amount || 0}
Items: ${extractedData.items?.length || 0}`;

    return { extracted: extractedData, raw_text: rawText };
  } catch (error) {
    console.error("[inbound-email] Error extracting invoice data with OpenAI", error);
    return null;
  }
}

/**
 * Fallback extraction method using text-based approach
 * Used when the primary image-based extraction fails
 */
async function extractInvoiceDataFallback(
  base64Pdf: string,
  openaiApiKey: string
): Promise<{ extracted: ExtractedInvoiceData; raw_text: string } | null> {
  try {
    console.log("[inbound-email] Using fallback text extraction method");

    // First, extract text from the PDF
    const textExtractionResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `You are an expert invoice data extractor. Extract ALL text and data from this invoice document.

Instructions:
1. Extract every piece of text visible in the document
2. Preserve the structure (headers, line items, totals)
3. Include all numbers, dates, addresses, and reference numbers
4. IMPORTANT: Make sure to extract ALL line items/products with their descriptions, quantities, and prices
5. Return the raw text in a structured format

Return the complete extracted text from the invoice.`
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/png;base64,${base64Pdf}`,
                  detail: "high"
                }
              }
            ]
          }
        ],
        max_tokens: 4096,
        temperature: 0.1
      }),
    });

    if (!textExtractionResponse.ok) {
      console.error("[inbound-email] Fallback text extraction failed");
      return null;
    }

    const textResult = await textExtractionResponse.json();
    const rawText = textResult.choices?.[0]?.message?.content || '';

    if (!rawText || rawText.trim().length === 0) {
      console.error("[inbound-email] No text extracted from PDF in fallback");
      return null;
    }

    console.log("[inbound-email] Fallback raw text extracted", { length: rawText.length });

    // Now parse the extracted text - EXACT same prompt as openAIService.ts
    const parsingResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "You are an expert invoice parser. Always return valid JSON only, no extra text."
          },
          {
            role: "user",
            content: `Extract invoice data from this text and return JSON.

RULES:
- Always include ALL fields mentioned below, even if value is null.
- Use null for missing/unknown values.
- Numbers should be numeric (no currency symbols).
- Dates should be ISO 'YYYY-MM-DD' if possible, else null.
- 'charged' should be boolean true/false if possible.

1) Main invoice fields (top-level):
- vendor_name
- customer_name
- invoice_number
- invoice_date
- due_date
- currency
- subtotal
- tax
- total_amount

// NEW EXTRA FIELDS (header):
- account
- purchase_order
- amount_due
- account_number
- order_number
- patient
- date_delivered
- payment_due_by
- amount
- total_no_vat
- total_gbp
- brand_id
- billed_to
- charged
- customer_reference
- supply_address
- supply_point_id
- previous_balance
- payments_received
- balance_brought_forward
- account_balance

2) Items:
'items' should be an array of objects with:
- description
- quantity
- unit_price
- line_total
- item
- location

3) Also return a 'confidence_scores' object with a numeric 0–100 score
for each TOP-LEVEL field above (invoice fields only).

Confidence meaning:
- 80–100: high confidence (green)
- 50–79: medium confidence (orange)
- 0–49 or missing: low confidence (red)

JSON SHAPE (example):

{
"vendor_name": "...",
"customer_name": "...",
"invoice_number": "...",
"invoice_date": "YYYY-MM-DD" or null,
"due_date": "YYYY-MM-DD" or null,
"currency": "GBP" or null,
"subtotal": 123.45,
"tax": 12.34,
"total_amount": 135.79,

"account": "...",
"purchase_order": "...",
"amount_due": 135.79,
"account_number": "...",
"order_number": "...",
"patient": "...",
"date_delivered": "YYYY-MM-DD" or null,
"payment_due_by": "YYYY-MM-DD" or null,
"amount": 135.79,
"total_no_vat": 120.00,
"total_gbp": 135.79,
"brand_id": 123,
"billed_to": "...",
"charged": true,
"customer_reference": "...",
"supply_address": "...",
"supply_point_id": "...",
"previous_balance": 0,
"payments_received": 0,
"balance_brought_forward": 0,
"account_balance": 135.79,

"items": [
    {
    "description": "Widget A",
    "quantity": 1,
    "unit_price": 10.00,
    "line_total": 10.00,
    "item": "A123",
    "location": "Store 1"
    }
],

"other_data": ["..."],

"confidence_scores": {
    "vendor_name": 0,
    "customer_name": 0,
    "invoice_number": 0,
    "invoice_date": 0,
    "due_date": 0,
    "currency": 0,
    "subtotal": 0,
    "tax": 0,
    "total_amount": 0,
    "account": 0,
    "purchase_order": 0,
    "amount_due": 0,
    "account_number": 0,
    "order_number": 0,
    "patient": 0,
    "date_delivered": 0,
    "payment_due_by": 0,
    "amount": 0,
    "total_no_vat": 0,
    "total_gbp": 0,
    "brand_id": 0,
    "billed_to": 0,
    "charged": 0,
    "customer_reference": 0,
    "supply_address": 0,
    "supply_point_id": 0,
    "previous_balance": 0,
    "payments_received": 0,
    "balance_brought_forward": 0,
    "account_balance": 0
}
}

TEXT:
"""${rawText}"""`
          }
        ],
        temperature: 0.1,
        max_tokens: 4000,
      }),
    });

    if (!parsingResponse.ok) {
      const errorText = await parsingResponse.text();
      console.error("[inbound-email] Fallback parsing API error", { status: parsingResponse.status, error: errorText });
      return null;
    }

    const parseResult = await parsingResponse.json();
    const content = parseResult.choices?.[0]?.message?.content;

    if (!content) {
      console.error("[inbound-email] No content in fallback parsing response");
      return null;
    }

    const extractedData: ExtractedInvoiceData = JSON.parse(content);

    console.log("[inbound-email] Fallback extraction successful", {
      vendor_name: extractedData.vendor_name,
      invoice_number: extractedData.invoice_number,
      items_count: extractedData.items?.length || 0
    });

    return { extracted: extractedData, raw_text: rawText };
  } catch (error) {
    console.error("[inbound-email] Fallback extraction error", error);
    return null;
  }
}

serve(async (req) => {
  // Handle CORS preflight request
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  // Create Supabase client with service role key (early initialization for logging)
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const inboundApiKey = Deno.env.get("INBOUND_API_KEY");

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const payload: InboundEmailPayload = await req.json();

    console.log("Inbound email webhook hit", { event: payload.event });

    // Log webhook received
    await logToDatabase(supabase, {
      action: "webhook_received",
      status: "pending",
      requestPayload: { event: payload.event, recipient: payload.email?.recipient },
      metadata: { step: "webhook_hit" },
    });

    // Validate event type
    if (payload.event !== "email.received") {
      await logToDatabase(supabase, {
        action: "webhook_received",
        status: "ignored",
        requestPayload: { event: payload.event },
        metadata: { step: "invalid_event_type", reason: "not an email.received event" },
      });

      return new Response(
        JSON.stringify({
          status: "ignored",
          reason: "not an email.received event",
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const emailData = payload.email;
    if (!emailData) {
      await logToDatabase(supabase, {
        action: "webhook_received",
        status: "ignored",
        metadata: { step: "missing_email_data", reason: "missing email data" },
      });

      return new Response(
        JSON.stringify({
          status: "ignored",
          reason: "missing email data",
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Resolve recipient to user/organization
    const recipient = emailData.recipient;
    const resolved = await resolveRecipient(supabase, recipient);

    if (!resolved.userId && !resolved.organizationId) {
      console.warn("Inbound email for unknown recipient", { recipient });

      await logToDatabase(supabase, {
        action: "receive_email",
        status: "ignored",
        requestPayload: { recipient },
        metadata: { step: "unknown_recipient", reason: "No matching user or organization" },
      });

      return new Response(
        JSON.stringify({
          status: "ignored",
          reason: "No matching user or organization",
          recipient,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Log recipient resolved
    await logToDatabase(supabase, {
      organizationId: resolved.organizationId,
      userId: resolved.userId,
      action: "receive_email",
      status: "pending",
      requestPayload: { recipient, from: emailData.from?.addresses?.[0]?.address },
      metadata: { step: "recipient_resolved", emailType: resolved.emailType, ruleId: resolved.ruleId },
    });

    // Extract email fields
    const fromAddresses = emailData.from?.addresses || [];
    const toAddresses = emailData.to?.addresses || [];
    const cleaned = emailData.cleanedContent || {};

    const fromEmail = fromAddresses[0]?.address || null;
    const fromName = fromAddresses[0]?.name || null;
    const toEmail = toAddresses[0]?.address || recipient;

    const subject = emailData.subject || "";
    const receivedAt = emailData.receivedAt || null;
    const messageId = emailData.messageId || null;
    const threadId = emailData.threadId || null;

    const htmlBody = cleaned.html || emailData.parsedData?.htmlBody || null;
    const textBody = cleaned.text || emailData.parsedData?.textBody || null;
    const attachments = cleaned.attachments || emailData.parsedData?.attachments || [];

    // Format received_at for database
    const receivedAtFormatted = receivedAt
      ? new Date(receivedAt).toISOString()
      : null;

    // Save email to database
    const { data: email, error: emailError } = await supabase
      .from("inbound_emails")
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
        status: "received",
      })
      .select()
      .single();

    if (emailError) {
      console.error("Error saving inbound email", emailError);

      await logToDatabase(supabase, {
        organizationId: resolved.organizationId,
        userId: resolved.userId,
        action: "receive_email",
        status: "failed",
        errorMessage: emailError.message,
        errorCode: "DB_INSERT_FAILED",
        metadata: { step: "save_email_failed" },
      });

      return new Response(
        JSON.stringify({
          status: "error",
          reason: emailError.message,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Log email saved
    await logToDatabase(supabase, {
      organizationId: resolved.organizationId,
      userId: resolved.userId,
      action: "receive_email",
      status: "success",
      inboundEmailId: email.id,
      responsePayload: { emailId: email.id, fromEmail, subject, attachmentsCount: attachments.length },
      metadata: { step: "email_saved", hasAttachments: attachments.length > 0 },
    });

    // Create notification for email received
    await createEmailNotification(supabase, {
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
      const result = await processAttachment(supabase, {
        emailId: email.id,
        attachment,
        resolved,
        fromEmail,
        inboundApiKey,
      });
      if (result.invoiceId) {
        invoiceId = result.invoiceId;
      }
    }

    // Update email status and invoice_id
    await supabase
      .from("inbound_emails")
      .update({
        status: "processed",
        invoice_id: invoiceId || null,
      })
      .eq("id", email.id);

    // Log processing completed
    await logToDatabase(supabase, {
      organizationId: resolved.organizationId,
      userId: resolved.userId,
      action: "process_email",
      status: "success",
      inboundEmailId: email.id,
      invoiceId: invoiceId,
      responsePayload: { emailId: email.id, invoiceId },
      metadata: { step: "processing_completed", attachmentsProcessed: attachments.length },
    });

    return new Response(
      JSON.stringify({
        status: "success",
        emailId: email.id,
        invoiceId,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error processing inbound email:", error);

    await logToDatabase(supabase, {
      action: "receive_email",
      status: "failed",
      errorMessage: error.message || "Internal server error",
      errorCode: "EXCEPTION",
      metadata: { step: "exception", error: String(error) },
    });

    return new Response(
      JSON.stringify({
        status: "error",
        reason: error.message || "Internal server error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

/**
 * Resolve recipient email to user/organization
 */
async function resolveRecipient(
  supabase: any,
  recipient: string
): Promise<ResolvedRecipient> {
  const result: ResolvedRecipient = {
    userId: null,
    organizationId: null,
    emailType: null,
  };

  if (!recipient) return result;

  // Normalize recipient to lowercase for case-insensitive matching
  const recipientLower = recipient.toLowerCase();

  // Check rules mapping table for matching inbound email address (highest priority)
  const { data: rule } = await supabase
    .from("accounts_payable_invoice_rules_mapping")
    .select("*")
    .ilike("inbound_email_address", recipientLower)
    .eq("is_active", true)
    .limit(1)
    .single();

  if (rule) {
    result.userId = rule.user_id;
    result.organizationId = rule.organization_id;
    result.emailType = "cost";
    result.ruleId = rule.id;
    result.folderId = rule.folder_id;
    result.chartOfAccountId = rule.chart_of_account_id;
    result.locationId = rule.location_id;

    console.log("Inbound email matched rule", {
      recipient,
      ruleId: rule.id,
      organizationId: rule.organization_id,
      locationId: rule.location_id,
    });

    return result;
  }

  // Check location_inbound_emails table for auto-generated inbound email address
  const { data: orgInbound, error: orgInboundError } = await supabase
    .from("location_inbound_emails")
    .select("organization_id, user_id, location_id, email_type")
    .ilike("inbound_email_address", recipientLower)
    .eq("inbound_created", 1)
    .limit(1)
    .single();

  console.log("location_inbound_emails lookup:", {
    recipient: recipientLower,
    found: !!orgInbound,
    error: orgInboundError?.message,
    data: orgInbound,
  });

  if (orgInbound) {
    result.userId = orgInbound.user_id;
    result.organizationId = orgInbound.organization_id;
    result.emailType = orgInbound.email_type || "cost";
    result.locationId = orgInbound.location_id || null;

    console.log("Inbound email matched organization inbound email", {
      recipient,
      organizationId: orgInbound.organization_id,
      locationId: orgInbound.location_id,
      emailType: orgInbound.email_type,
    });

    return result;
  }

  // Check profiles for personal inbound email address
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, current_organization_id")
    .eq("inbound_email_address", recipient)
    .limit(1)
    .single();

  if (profile) {
    result.userId = profile.id;
    result.organizationId = profile.current_organization_id;
    result.emailType = "personal";

    console.log("Inbound email matched user profile", {
      recipient,
      userId: profile.id,
    });

    return result;
  }

  return result;
}

/**
 * Match rule by sender email to get folder and COA assignment
 * This is called after resolveRecipient to find more specific folder/COA based on sender
 */
async function matchRuleBySender(
  supabase: any,
  senderEmail: string | null,
  organizationId: string | null
): Promise<{ folderId: string | null; chartOfAccountId: string | null; locationId: string | null }> {
  if (!senderEmail || !organizationId) {
    return { folderId: null, chartOfAccountId: null, locationId: null };
  }

  const { data: rule } = await supabase
    .from("accounts_payable_invoice_rules_mapping")
    .select("folder_id, chart_of_account_id, location_id")
    .eq("email", senderEmail)
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .limit(1)
    .single();

  if (rule) {
    console.log("Matched rule by sender email", {
      senderEmail,
      organizationId,
      folderId: rule.folder_id,
      chartOfAccountId: rule.chart_of_account_id,
      locationId: rule.location_id,
    });
    return {
      folderId: rule.folder_id,
      chartOfAccountId: rule.chart_of_account_id,
      locationId: rule.location_id,
    };
  }

  return { folderId: null, chartOfAccountId: null, locationId: null };
}

/**
 * Create notification for received email
 */
async function createEmailNotification(
  supabase: any,
  params: {
    userId: number | null;
    organizationId: string | null;
    emailId: number;
    fromEmail: string | null;
    fromName: string | null;
    subject: string;
    attachmentsCount: number;
  }
) {
  const {
    userId,
    organizationId,
    emailId,
    fromEmail,
    fromName,
    subject,
    attachmentsCount,
  } = params;

  const message = `New email received from ${fromName || "Unknown"} (${
    fromEmail || "unknown"
  })${attachmentsCount > 0 ? ` with ${attachmentsCount} attachment(s)` : ""}`;

  await supabase.from("general_notification").insert({
    user_id: userId,
    organization_id: organizationId,
    notification_type: "email_received",
    title: "New Email Received",
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
 * Process email attachment
 */
async function processAttachment(
  supabase: any,
  params: {
    emailId: number;
    attachment: InboundAttachment;
    resolved: ResolvedRecipient;
    fromEmail: string | null;
    inboundApiKey?: string;
  }
): Promise<{ attachmentId: number; invoiceId?: string }> {
  const { emailId, attachment, resolved, fromEmail, inboundApiKey } = params;

  const isPdf = attachment.filename?.toLowerCase().endsWith(".pdf");

  // Save attachment record
  const { data: attachmentRecord, error } = await supabase
    .from("inbound_email_attachments")
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
    console.error("Error saving attachment", error);
    return { attachmentId: 0 };
  }

  // If it's a PDF, download and store it, then create invoice
  if (isPdf && attachment.downloadUrl) {
    const invoiceId = await processPdfInvoice(supabase, {
      attachmentId: attachmentRecord.id,
      downloadUrl: attachment.downloadUrl,
      filename: attachment.filename,
      resolved,
      fromEmail,
      inboundApiKey,
    });

    if (invoiceId) {
      // Update attachment with invoice ID
      await supabase
        .from("inbound_email_attachments")
        .update({ invoice_id: invoiceId })
        .eq("id", attachmentRecord.id);

      return { attachmentId: attachmentRecord.id, invoiceId };
    }
  }

  return { attachmentId: attachmentRecord.id };
}

/**
 * Process PDF invoice attachment
 */
async function processPdfInvoice(
  supabase: any,
  params: {
    attachmentId: number;
    downloadUrl: string;
    filename: string;
    resolved: ResolvedRecipient;
    fromEmail: string | null;
    inboundApiKey?: string;
  }
): Promise<string | null> {
  const { attachmentId, downloadUrl, filename, resolved, fromEmail, inboundApiKey } =
    params;

  try {
    // Download PDF from the provided URL (with API key if available)
    const headers: Record<string, string> = {};
    if (inboundApiKey) {
      headers["Authorization"] = `Bearer ${inboundApiKey}`;
    }

    console.log("Downloading PDF", {
      downloadUrl,
      hasApiKey: !!inboundApiKey,
      attachmentId,
      filename
    });

    // Log the download attempt
    await logToDatabase(supabase, {
      organizationId: resolved.organizationId,
      userId: resolved.userId,
      action: "download_attachment",
      status: "pending",
      metadata: {
        step: "download_start",
        attachmentId,
        filename,
        hasApiKey: !!inboundApiKey,
        downloadUrl: downloadUrl.substring(0, 100) // Truncate for logging
      },
    });

    const response = await fetch(downloadUrl, { headers });
    if (!response.ok) {
      console.error("Failed to download PDF", { status: response.status, statusText: response.statusText });

      // Log the download failure
      await logToDatabase(supabase, {
        organizationId: resolved.organizationId,
        userId: resolved.userId,
        action: "download_attachment",
        status: "failed",
        errorMessage: `HTTP ${response.status}: ${response.statusText}`,
        errorCode: `HTTP_${response.status}`,
        metadata: {
          step: "download_failed",
          attachmentId,
          filename,
          httpStatus: response.status,
          httpStatusText: response.statusText
        },
      });

      return null;
    }

    const pdfBuffer = await response.arrayBuffer();

    console.log("PDF downloaded successfully", { size: pdfBuffer.byteLength, filename });

    // Log download success
    await logToDatabase(supabase, {
      organizationId: resolved.organizationId,
      userId: resolved.userId,
      action: "download_attachment",
      status: "success",
      metadata: {
        step: "download_complete",
        attachmentId,
        filename,
        fileSize: pdfBuffer.byteLength
      },
    });

    // Generate unique filename with timestamp to avoid conflicts
    const timestamp = Date.now();
    const storagePath = `${timestamp}_${filename}`;

    console.log("Uploading to storage", { storagePath, bucket: "inbound-attechments" });

    // Upload to Supabase Storage (inbound-attechments bucket)
    const { error: uploadError } = await supabase.storage
      .from("inbound-attechments")
      .upload(storagePath, pdfBuffer, {
        contentType: "application/pdf",
        upsert: false,
      });

    if (uploadError) {
      console.error("Failed to upload PDF to storage", uploadError);

      // Log upload failure
      await logToDatabase(supabase, {
        organizationId: resolved.organizationId,
        userId: resolved.userId,
        action: "upload_attachment",
        status: "failed",
        errorMessage: uploadError.message,
        errorCode: "STORAGE_UPLOAD_FAILED",
        metadata: {
          step: "upload_failed",
          attachmentId,
          filename,
          storagePath,
          error: uploadError
        },
      });

      return null;
    }

    console.log("PDF uploaded successfully", { storagePath });

    // Log upload success
    await logToDatabase(supabase, {
      organizationId: resolved.organizationId,
      userId: resolved.userId,
      action: "upload_attachment",
      status: "success",
      metadata: {
        step: "upload_complete",
        attachmentId,
        filename,
        storagePath
      },
    });

    // Get public URL
    const { data: urlData } = supabase.storage
      .from("inbound-attechments")
      .getPublicUrl(storagePath);

    // Update attachment with stored path and bucket
    await supabase
      .from("inbound_email_attachments")
      .update({
        stored_path: storagePath,
        storage_bucket: "inbound-attechments",
      })
      .eq("id", attachmentId);

    // Extract invoice data using OpenAI
    console.log("Starting automatic invoice extraction", { filename, attachmentId });

    await logToDatabase(supabase, {
      organizationId: resolved.organizationId,
      userId: resolved.userId,
      action: "extract_invoice",
      status: "pending",
      metadata: {
        step: "extraction_start",
        attachmentId,
        filename
      },
    });

    const extractionResult = await extractInvoiceDataFromPdf(pdfBuffer, filename);
    const extractedData = extractionResult?.extracted || null;
    const rawText = extractionResult?.raw_text || null;

    if (extractedData) {
      await logToDatabase(supabase, {
        organizationId: resolved.organizationId,
        userId: resolved.userId,
        action: "extract_invoice",
        status: "success",
        metadata: {
          step: "extraction_complete",
          attachmentId,
          filename,
          invoice_number: extractedData.invoice_number,
          vendor_name: extractedData.vendor_name,
          total_amount: extractedData.total_amount,
          items_count: extractedData.items?.length || 0
        },
      });
    } else {
      await logToDatabase(supabase, {
        organizationId: resolved.organizationId,
        userId: resolved.userId,
        action: "extract_invoice",
        status: "skipped",
        metadata: {
          step: "extraction_skipped",
          attachmentId,
          filename,
          reason: "No OPENAI_API_KEY or extraction failed"
        },
      });
    }

    // Calculate overall confidence score
    const confidenceScores = extractedData?.confidence_scores || {};
    const scores = Object.values(confidenceScores).filter((v): v is number => typeof v === 'number');
    const overallConfidence = scores.length > 0
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      : 0;

    // Match rule by sender email to get folder/COA/location if not already set from recipient match
    let finalFolderId = resolved.folderId;
    let finalChartOfAccountId = resolved.chartOfAccountId;
    let finalLocationId = resolved.locationId;

    if (!finalFolderId || !finalChartOfAccountId || !finalLocationId) {
      const senderMatch = await matchRuleBySender(supabase, fromEmail, resolved.organizationId);
      if (senderMatch.folderId) finalFolderId = senderMatch.folderId;
      if (senderMatch.chartOfAccountId) finalChartOfAccountId = senderMatch.chartOfAccountId;
      if (senderMatch.locationId) finalLocationId = senderMatch.locationId;
    }

    // Create invoice record with extracted data (matching Upload Supplier Invoice format)
    const { data: invoice, error: invoiceError } = await supabase
      .from("accounts_payable_invoice")
      .insert({
        organization_id: resolved.organizationId,
        user_id: resolved.userId,
        folder_id: finalFolderId || null,
        chart_of_account_id: finalChartOfAccountId || null,
        location_id: finalLocationId || null,
        // Main invoice fields
        vendor_name: extractedData?.vendor_name || fromEmail || "Unknown Supplier",
        customer_name: extractedData?.customer_name || null,
        invoice_number: extractedData?.invoice_number || null,
        invoice_date: extractedData?.invoice_date || null,
        due_date: extractedData?.due_date || null,
        currency: extractedData?.currency || "AUD",
        subtotal: extractedData?.subtotal || null,
        tax: extractedData?.tax || null,
        total_amount: extractedData?.total_amount || null,
        // Extra fields
        account: extractedData?.account || null,
        purchase_order: extractedData?.purchase_order || null,
        amount_due: extractedData?.amount_due || null,
        account_number: extractedData?.account_number || null,
        order_number: extractedData?.order_number || null,
        patient: extractedData?.patient || null,
        date_delivered: extractedData?.date_delivered || null,
        payment_due_by: extractedData?.payment_due_by || null,
        amount: extractedData?.amount || null,
        total_no_vat: extractedData?.total_no_vat || null,
        total_gbp: extractedData?.total_gbp || null,
        brand_id: extractedData?.brand_id || null,
        billed_to: extractedData?.billed_to || null,
        charged: typeof extractedData?.charged === 'boolean' ? (extractedData.charged ? 1 : 0) : null,
        customer_reference: extractedData?.customer_reference || null,
        supply_address: extractedData?.supply_address || null,
        supply_point_id: extractedData?.supply_point_id || null,
        previous_balance: extractedData?.previous_balance || null,
        payments_received: extractedData?.payments_received || null,
        balance_brought_forward: extractedData?.balance_brought_forward || null,
        account_balance: extractedData?.account_balance || null,
        vat_no: extractedData?.vat_no || null,
        // Storage and metadata
        pdf_path: urlData.publicUrl,
        raw_json: extractedData || null,
        raw_text: rawText || null,
        confidence_score: overallConfidence,
        status: "pending_review",
        source: "email",
        created_by: resolved.userId ? String(resolved.userId) : null,
      })
      .select()
      .single();

    if (invoiceError) {
      console.error("Failed to create invoice record", invoiceError);
      return null;
    }

    // Insert line items if present
    if (extractedData?.items && extractedData.items.length > 0) {
      const lineItemsData = extractedData.items.map((item) => ({
        accounts_payable_invoice_id: invoice.id,
        description: item.description || null,
        quantity: item.quantity || null,
        unit_price: item.unit_price || null,
        line_total: item.line_total || null,
        item: item.item || null,
        location: item.location || null,
        raw_item_json: item,
        created_by: resolved.userId ? String(resolved.userId) : null,
      }));

      const { error: lineItemsError } = await supabase
        .from("accounts_payable_invoice_line_item")
        .insert(lineItemsData);

      if (lineItemsError) {
        console.error("Line items insert error:", lineItemsError);
        // Don't throw - invoice was saved successfully
      } else {
        console.log("Line items saved", { count: lineItemsData.length });
      }
    }

    // Create notification for new invoice with extraction status
    const notificationMessage = extractedData
      ? `Invoice #${extractedData.invoice_number || 'N/A'} from ${extractedData.vendor_name || fromEmail || "Unknown"} - $${extractedData.total_amount?.toFixed(2) || '0.00'} (auto-extracted)`
      : `Invoice received from ${fromEmail || "Unknown"} via email (pending extraction)`;

    await supabase.from("general_notification").insert({
      user_id: resolved.userId,
      organization_id: resolved.organizationId,
      notification_type: "invoice",
      title: extractedData ? "Invoice Auto-Extracted" : "New Invoice Received",
      message: notificationMessage,
      data: {
        invoice_id: invoice.id,
        source: "email",
        from_email: fromEmail,
        extraction_status: extractedData ? "completed" : "not_extracted",
        invoice_number: extractedData?.invoice_number || null,
        total_amount: extractedData?.total_amount || null,
        vendor_name: extractedData?.vendor_name || null,
        items_count: extractedData?.items?.length || 0,
        confidence_score: overallConfidence,
      },
    });

    console.log("Invoice created from email attachment", {
      invoiceId: invoice.id,
      filename,
      extracted: !!extractedData,
      invoice_number: extractedData?.invoice_number,
      total_amount: extractedData?.total_amount,
    });

    return invoice.id;
  } catch (error) {
    console.error("Error processing PDF invoice", error);
    return null;
  }
}
