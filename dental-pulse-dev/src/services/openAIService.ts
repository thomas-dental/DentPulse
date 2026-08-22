/**
 * OpenAI Service
 * Handles invoice extraction from PDF and images using OpenAI API
 */

import * as pdfjsLib from 'pdfjs-dist';
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { supabase } from '@/integrations/supabase/client';
import { getAnthropicKey } from '@/lib/aiKey';

// Set the worker source for PDF.js using local import
pdfjsLib.GlobalWorkerOptions.workerSrc = PdfWorker;

/**
 * Run a chat-completion via the `ai-invoice-extract` edge function.
 *
 * The browser must NOT call api.anthropic.com directly (no CORS). The edge
 * function runs the call server-side; its Anthropic key now comes from the
 * backend (per-user / tenant key via getAnthropicKey), not a Supabase secret.
 */
async function callInvoiceAI(
  messages: unknown[],
  opts?: { response_format?: unknown; max_tokens?: number; temperature?: number },
): Promise<string> {
  const apiKey = await getAnthropicKey();
  const { data, error } = await supabase.functions.invoke('ai-invoice-extract', {
    body: { messages, apiKey, ...(opts || {}) },
  });
  if (error) {
    throw new Error(error.message || 'AI extraction request failed');
  }
  if (data?.error) {
    throw new Error(data.error);
  }
  return data?.content ?? '';
}

export interface InvoiceExtractionResult {
  parsed: InvoiceParsedData;
  raw_text: string;
  confidence_scores?: Record<string, number>;
}

export interface InvoiceParsedData {
  // Main invoice fields
  vendor_name?: string | null;
  customer_name?: string | null;
  invoice_number?: string | null;
  invoice_date?: string | null; // ISO format YYYY-MM-DD
  due_date?: string | null; // ISO format YYYY-MM-DD
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
  date_delivered?: string | null; // ISO format YYYY-MM-DD
  payment_due_by?: string | null; // ISO format YYYY-MM-DD
  amount?: number | null;
  total_no_vat?: number | null;
  total_gbp?: number | null;
  brand_id?: string | null;
  vendor_address?: string | null;
  vendor_phone?: string | null;
  vendor_email?: string | null;
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

  // Items array
  items?: InvoiceItem[];

  // Other data
  other_data?: string[];

  // Confidence scores
  confidence_scores?: Record<string, number>;
}

export interface InvoiceItem {
  description?: string;
  quantity?: number;
  unit_price?: number;
  tax_amount?: number;
  line_total?: number;
  item?: string;
  location?: string;
}

/**
 * Extract text from PDF file
 * Uses OpenAI Vision API for PDF extraction (works for both text-based and image-based PDFs)
 * Alternative: Can use pdfjs-dist library for client-side parsing if needed
 */
async function extractTextFromPdf(file: File): Promise<string> {
  // For now, use OpenAI Vision API directly for PDFs
  // This works well for both text-based and image-based PDFs
  // If you want to use pdfjs-dist for faster/cheaper extraction, uncomment the code below
  return await extractTextFromPdfViaVision(file);

  /* 
  Alternative: Use pdfjs-dist for client-side PDF parsing (requires: npm install pdfjs-dist)
  
  Example code:
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  // ... extract text from pages
  */
}

/**
 * Fallback: Extract text from PDF using OpenAI Vision API
 * This converts PDF pages to images and uses Vision API
 */
/**
 * Convert PDF file to array of base64 encoded PNG images
 * Uses pdf.js to render each page to canvas, then converts to base64
 */
async function convertPdfToImages(file: File): Promise<string[]> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const images: string[] = [];

  // Process each page (limit to first 5 pages for complete data)
  const numPages = Math.min(pdf.numPages, 5);

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);

    // Set scale for good quality (2x for clarity)
    const scale = 2;
    const viewport = page.getViewport({ scale });

    // Create canvas element
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');

    if (!context) {
      throw new Error('Could not create canvas context');
    }

    canvas.height = viewport.height;
    canvas.width = viewport.width;

    // Render PDF page to canvas
    await page.render({
      canvas: canvas,
      canvasContext: context,
      viewport: viewport,
    }).promise;

    // Convert canvas to base64 PNG (without data URL prefix)
    const dataUrl = canvas.toDataURL('image/png');
    const base64 = dataUrl.split(',')[1];
    images.push(base64);
  }

  return images;
}

async function extractTextFromPdfViaVision(file: File): Promise<string> {
  try {
    // Convert PDF pages to images
    console.log('[OpenAI Service] Converting PDF to images...');
    const pageImages = await convertPdfToImages(file);
    console.log(`[OpenAI Service] Converted ${pageImages.length} page(s) to images`);

    if (pageImages.length === 0) {
      throw new Error('No pages could be extracted from the PDF');
    }

    // Build content array with all page images
    const content: any[] = [
      {
        type: 'text',
        text: `You are an expert invoice data extractor. Extract ALL text and data from this invoice document.

        Instructions:
        1. Extract every piece of text visible in the document
        2. Preserve the structure (headers, line items, totals)
        3. Include all numbers, dates, addresses, and reference numbers
        4. Return the raw text in a structured format

        Return the complete extracted text from the invoice.`
      }
    ];

    // Add each page image (using 'high' detail for complete data extraction)
    for (const base64Image of pageImages) {
      content.push({
        type: 'image_url',
        image_url: {
          url: `data:image/png;base64,${base64Image}`,
          detail: 'high'
        }
      });
    }

    // Run the Vision call server-side via the ai-invoice-extract edge function
    return await callInvoiceAI(
      [{ role: 'user', content }],
      { max_tokens: 4096, temperature: 0.1 },
    );
  } catch (error: any) {
    console.error('Error extracting text from PDF via Vision API:', error);
    throw new Error(`Failed to extract text from PDF: ${error.message}`);
  }
}

/**
 * Extract text from image using OpenAI Vision API
 */
async function extractTextFromImage(file: File): Promise<string> {
  // Convert file to base64
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Remove data URL prefix
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  // Get MIME type
  const mimeType = file.type || 'image/jpeg';

  try {
    return await callInvoiceAI(
      [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Extract all text from this invoice image. Return only the raw text, no formatting or interpretation.'
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:${mimeType};base64,${base64}`,
                detail: 'high'
              }
            }
          ]
        }
      ],
      { max_tokens: 4000 },
    );
  } catch (error: any) {
    console.error('Error extracting text from image:', error);
    throw new Error(`Failed to extract text from image: ${error.message}`);
  }
}

/**
 * Extract invoice data from PDF or image using OpenAI
 */
export async function extractFromPdfOrImage(file: File): Promise<InvoiceExtractionResult> {
  let extractedText = '';

  // Determine file type and extract text
  const fileExtension = file.name.split('.').pop()?.toLowerCase();
  const isImage = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'tiff', 'webp'].includes(fileExtension || '');
  const isPdf = fileExtension === 'pdf';

  if (isPdf) {
    // Extract text from PDF
    extractedText = await extractTextFromPdf(file);
  } else if (isImage) {
    // Extract text from image using OpenAI Vision
    extractedText = await extractTextFromImage(file);
  } else {
    throw new Error(`Unsupported file type: ${fileExtension}. Only PDF and image files are supported.`);
  }

  if (!extractedText || extractedText.trim().length === 0) {
    throw new Error('No text could be extracted from the file');
  }

  // Call OpenAI to parse the extracted text
  try {
    const content = await callInvoiceAI(
      [
          {
            role: 'system',
            content: 'You are an expert invoice parser. Always return valid JSON only, no extra text.'
          },
          {
            role: 'user',
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
                            - vendor_address (full address of the vendor/supplier — the "From" block on the invoice, street/city/postcode/country only, NOT including phone or email)
                            - vendor_phone (vendor/supplier phone number from the "From" block, digits only, no formatting)
                            - vendor_email (vendor/supplier email address from the "From" block)
                            - billed_to (full "To" or "Bill To" address — who the invoice is addressed to, including name, street, city, postcode)
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
                            - tax_amount (tax/VAT for this line item if available, else 0)
                            - line_total (net amount excluding tax)
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
                            \"vendor_name\": \"...\",
                            \"customer_name\": \"...\",
                            \"invoice_number\": \"...\",
                            \"invoice_date\": \"YYYY-MM-DD\" or null,
                            \"due_date\": \"YYYY-MM-DD\" or null,
                            \"currency\": \"GBP\" or null,
                            \"subtotal\": 123.45,
                            \"tax\": 12.34,
                            \"total_amount\": 135.79,

                            \"account\": \"...\",
                            \"purchase_order\": \"...\",
                            \"amount_due\": 135.79,
                            \"account_number\": \"...\",
                            \"order_number\": \"...\",
                            \"patient\": \"...\",
                            \"date_delivered\": \"YYYY-MM-DD\" or null,
                            \"payment_due_by\": \"YYYY-MM-DD\" or null,
                            \"amount\": 135.79,
                            \"total_no_vat\": 120.00,
                            \"total_gbp\": 135.79,
                            \"brand_id\": 123,
                            \"vendor_address\": \"123 Supplier Street, London, EC1A 1BB, UK\",
                            \"vendor_phone\": \"01343542729\",
                            \"vendor_email\": \"info@supplier.co.uk\",
                            \"billed_to\": \"Customer Name, 456 Customer Road, Birmingham, B1 1AA\",
                            \"charged\": true,
                            \"customer_reference\": \"...\",
                            \"supply_address\": \"...\",
                            \"supply_point_id\": \"...\",
                            \"previous_balance\": 0,
                            \"payments_received\": 0,
                            \"balance_brought_forward\": 0,
                            \"account_balance\": 135.79,

                            \"items\": [
                                {
                                \"description\": \"Widget A\",
                                \"quantity\": 1,
                                \"unit_price\": 10.00,
                                \"tax_amount\": 2.00,
                                \"line_total\": 10.00,
                                \"item\": \"A123\",
                                \"location\": \"Store 1\"
                                }
                            ],

                            \"other_data\": [\"...\"],

                            \"confidence_scores\": {
                                \"vendor_name\": 0,
                                \"customer_name\": 0,
                                \"invoice_number\": 0,
                                \"invoice_date\": 0,
                                \"due_date\": 0,
                                \"currency\": 0,
                                \"subtotal\": 0,
                                \"tax\": 0,
                                \"total_amount\": 0,
                                \"account\": 0,
                                \"purchase_order\": 0,
                                \"amount_due\": 0,
                                \"account_number\": 0,
                                \"order_number\": 0,
                                \"patient\": 0,
                                \"date_delivered\": 0,
                                \"payment_due_by\": 0,
                                \"amount\": 0,
                                \"total_no_vat\": 0,
                                \"total_gbp\": 0,
                                \"brand_id\": 0,
                                \"vendor_address\": 0,
                                \"vendor_phone\": 0,
                                \"vendor_email\": 0,
                                \"billed_to\": 0,
                                \"charged\": 0,
                                \"customer_reference\": 0,
                                \"supply_address\": 0,
                                \"supply_point_id\": 0,
                                \"previous_balance\": 0,
                                \"payments_received\": 0,
                                \"balance_brought_forward\": 0,
                                \"account_balance\": 0
                            }
                            }

              TEXT:
              """${extractedText}"""`
          }
      ],
      { response_format: { type: 'json_object' }, temperature: 0.1, max_tokens: 4000 },
    );

    if (!content) {
      throw new Error('No content returned from the AI service');
    }

    // Parse JSON response. Models occasionally wrap the JSON in ```json
    // fences or add stray prose — strip fences and take the outermost
    // { ... } block so parsing is robust regardless of response_format.
    let parsed: InvoiceParsedData;
    try {
      let cleaned = String(content).trim();
      const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
      if (fence) cleaned = fence[1].trim();
      const firstBrace = cleaned.indexOf('{');
      const lastBrace = cleaned.lastIndexOf('}');
      if (firstBrace >= 0 && lastBrace > firstBrace) {
        cleaned = cleaned.slice(firstBrace, lastBrace + 1);
      }
      parsed = JSON.parse(cleaned);
    } catch (parseError: any) {
      throw new Error(`Failed to parse AI response as JSON: ${parseError.message}`);
    }

    // Calculate overall confidence score (average of all confidence scores)
    const confidenceScores = parsed.confidence_scores || {};
    const scores = Object.values(confidenceScores).filter((v): v is number => typeof v === 'number');
    const overallConfidence = scores.length > 0
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      : 0;

    return {
      parsed,
      raw_text: extractedText,
      confidence_scores: {
        ...confidenceScores,
        overall: overallConfidence,
      },
    };
  } catch (error: any) {
    console.error('Error calling OpenAI API:', error);
    throw new Error(`Failed to extract invoice data: ${error.message}`);
  }
}
