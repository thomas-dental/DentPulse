import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ---------------------------------------------------------------------------
// sage-create-invoice
//
// Push an uploaded Accounts-Payable invoice into Sage Business Cloud Accounting
// as a PURCHASE INVOICE (Accounts Payable / supplier bill), and attach the
// original PDF.
//
// Mirrors the Xero flow (supabase/functions/xero-create-invoice/index.ts):
//   1. Resolve the Sage connection for this invoice's location (multi-account
//      ready: location mapping → fallback any connected Sage).
//   2. Refresh the Sage access token.
//   3. Find or create the supplier (VENDOR contact) → contact_id.
//   4. Build invoice_lines (ledger_account_id + tax_rate_id from synced data).
//   5. POST /purchase_invoices.
//   6. If PAID + bank account → record a contact payment (best-effort).
//   7. Attach the original PDF via POST /attachments (best-effort).
//   8. Write platform_invoice_id / platform_status / shared_at back onto the
//      accounts_payable_invoice row.
//
// Sage API quick facts (see backend/api/sage/client.js):
//   - API base:  https://api.accounting.sage.com/v3.1
//   - Token URL: https://oauth.accounting.sage.com/token (form-encoded refresh)
//   - Auth:      Bearer token only (no tenant header — token is scoped to one
//                business, unlike Xero's Xero-tenant-id).
//   - Scope:     full_access (required for writes).
// ---------------------------------------------------------------------------

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SAGE_API_BASE = "https://api.accounting.sage.com/v3.1";
const SAGE_TOKEN_URL = "https://oauth.accounting.sage.com/token";

// The bucket where manually-uploaded AP invoice PDFs live (see InvoiceDetailsDrawer).
const AP_PDF_BUCKET = "account-payable-attechments";

interface CreateInvoiceRequest {
  invoiceId: string;
  bankAccountId?: string; // Sage bank account id (sage_bank_account_id) for payment when status is PAID
  invoice: {
    invoice_number?: string;
    customer_name?: string;
    vendor_name?: string;
    currency?: string;
    invoice_date?: string;
    due_date?: string;
    subtotal?: number;
    tax?: number;
    total_amount?: number;
    status?: string; // DRAFT, SUBMITTED, AUTHORISED, PAID
    line_items: Array<{
      description?: string;
      quantity?: number;
      unit_price?: number;
      line_total?: number;
      item?: string;
      tax_amount?: number;
      account_code?: string;        // Sage nominal code (display only)
      platform_account_id?: string; // Sage ledger_account_id (GUID) — resolved client-side
    }>;
  };
}

// ── Token refresh (mirrors backend/api/sage/client.js refreshAccessToken) ──
async function refreshAccessToken(
  supabase: any,
  integration: any,
): Promise<{ access_token: string | null; error: string | null }> {
  if (!integration.refresh_token) {
    return { access_token: null, error: "No Sage refresh token available. Please reconnect Sage." };
  }

  const clientId = Deno.env.get("SAGE_CLIENT_ID");
  const clientSecret = Deno.env.get("SAGE_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    return { access_token: null, error: "Sage credentials not configured (SAGE_CLIENT_ID / SAGE_CLIENT_SECRET)" };
  }

  try {
    const response = await fetch(SAGE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: integration.refresh_token,
      }).toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[sage] Token refresh failed:", errorText);
      return { access_token: null, error: `Token refresh failed: ${response.status}` };
    }

    const tokenData = await response.json();
    const tokenExpiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

    const { error: updateError } = await supabase
      .from("platform_integrations")
      .update({
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token || integration.refresh_token,
        token_expires_at: tokenExpiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq("id", integration.id);

    if (updateError) {
      console.error("[sage] Failed to save refreshed tokens:", updateError);
      return { access_token: null, error: "Failed to save refreshed tokens" };
    }

    return { access_token: tokenData.access_token, error: null };
  } catch (error: any) {
    console.error("[sage] Token refresh error:", error);
    return { access_token: null, error: error.message || "Token refresh failed" };
  }
}

function isTokenExpired(tokenExpiresAt: string | null): boolean {
  if (!tokenExpiresAt) return true;
  const expiresAt = new Date(tokenExpiresAt);
  return new Date() >= new Date(expiresAt.getTime() - 60 * 1000); // 60s buffer (Sage tokens last 5 min)
}

// ── Resolve which Sage integration to use, based on location mapping ──
// Mirrors getXeroTenantId, but Sage has no tenant header so we only need the
// platform_integrations row (its token is scoped to one business). Location-
// aware now so Feature 2 (multi-account per location) needs no change here.
async function getSageIntegration(
  supabase: any,
  organizationId: string,
  locationId: string | null,
): Promise<{ integration: any | null; businessId: string | null }> {
  // 1. Try the location → Sage business mapping. The mapped PIO's
  //    platform_org_id IS the Sage business GUID (used as X-Business).
  if (locationId) {
    const { data: mappingData } = await supabase
      .from("platform_integration_organization_mapping")
      .select(`
        platform_integration_id,
        platform_integration_organizations!inner ( platform_name, platform_org_id )
      `)
      .eq("location_id", locationId)
      .eq("organization_id", organizationId);

    const sageMapping = (mappingData || []).find(
      (m: any) => m.platform_integration_organizations?.platform_name === "sage",
    );

    if (sageMapping?.platform_integration_id) {
      const { data: mapped } = await supabase
        .from("platform_integrations")
        .select("*")
        .eq("id", sageMapping.platform_integration_id)
        .eq("platform_name", "sage")
        .eq("is_connected", true)
        .maybeSingle();
      if (mapped) {
        const businessId = sageMapping.platform_integration_organizations?.platform_org_id || null;
        console.log(`[sage] Using mapped integration ${mapped.id}, business ${businessId} for location ${locationId}`);
        return { integration: mapped, businessId };
      }
    }
  }

  // 2. Fallback: any connected Sage integration for this org (lead business).
  const { data: fallback } = await supabase
    .from("platform_integrations")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("platform_name", "sage")
    .eq("is_connected", true)
    .limit(1)
    .maybeSingle();

  if (fallback) {
    // Try to resolve a business id from this integration's PIO (first one).
    const { data: pio } = await supabase
      .from("platform_integration_organizations")
      .select("platform_org_id")
      .eq("platform_integration_id", fallback.id)
      .eq("platform_name", "sage")
      .limit(1)
      .maybeSingle();
    console.log(`[sage] Using fallback integration ${fallback.id}, business ${pio?.platform_org_id || "lead"}`);
    return { integration: fallback, businessId: pio?.platform_org_id || null };
  }

  return { integration: null, businessId: null };
}

// Build the Sage auth headers, adding X-Business when targeting a specific
// business (multi-business orgs). Without it, Sage uses the "lead" business.
function sageHeaders(accessToken: string, businessId: string | null, withJson = false): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
  };
  if (withJson) h["Content-Type"] = "application/json";
  if (businessId) h["X-Business"] = businessId;
  return h;
}

// ── Find or create a Sage VENDOR contact by name → contact_id ──
async function findOrCreateContact(
  accessToken: string,
  contactName: string,
  reference: string | null,
  businessId: string | null,
): Promise<{ contactId: string | null; error: string | null }> {
  const name = (contactName || "").trim().replace(/\s+/g, " ").substring(0, 255) || "Unknown Vendor";

  try {
    // Search existing vendors by name.
    const searchUrl =
      `${SAGE_API_BASE}/contacts?contact_type_id=VENDOR&search=${encodeURIComponent(name)}&items_per_page=100`;
    const searchResponse = await fetch(searchUrl, {
      headers: sageHeaders(accessToken, businessId),
    });

    if (searchResponse.ok) {
      const searchData = await searchResponse.json();
      const items = searchData?.$items || [];
      const match = items.find(
        (c: any) =>
          (c.name || c.displayed_as || "").trim().toLowerCase() === name.toLowerCase(),
      ) || (items.length === 1 ? items[0] : null);
      if (match?.id) {
        console.log(`[sage] Found existing contact: ${match.id}`);
        return { contactId: match.id, error: null };
      }
    } else {
      console.log(`[sage] Contact search returned ${searchResponse.status}`);
    }

    // Not found → create.
    console.log(`[sage] Creating new VENDOR contact: "${name}"`);
    const createBody: Record<string, any> = {
      contact: {
        name,
        contact_type_ids: ["VENDOR"],
      },
    };
    if (reference) createBody.contact.reference = reference.substring(0, 100);

    const createResponse = await fetch(`${SAGE_API_BASE}/contacts`, {
      method: "POST",
      headers: sageHeaders(accessToken, businessId, true),
      body: JSON.stringify(createBody),
    });

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      if (createResponse.status === 401) {
        return { contactId: null, error: "Sage authorization expired. Please reconnect Sage in Settings > Accounting Integrations." };
      }
      return { contactId: null, error: `Failed to create Sage contact: ${createResponse.status} - ${errorText.substring(0, 300)}` };
    }

    const created = await createResponse.json();
    if (created?.id) {
      console.log(`[sage] Created contact: ${created.id}`);
      return { contactId: created.id, error: null };
    }
    return { contactId: null, error: "Sage contact creation returned no id" };
  } catch (error: any) {
    console.error("[sage] Contact operation error:", error);
    return { contactId: null, error: error.message || "Contact operation failed" };
  }
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return new Date().toISOString().split("T")[0];
  try {
    return new Date(dateStr).toISOString().split("T")[0];
  } catch {
    return new Date().toISOString().split("T")[0];
  }
}

// Resolve a default tax rate (id + percentage) from the synced sage_tax_rates
// table (UK VAT). Sage requires BOTH tax_rate_id AND the line tax amount
// (currency_tax_amount) whenever tax applies — so we need the percentage too.
async function resolveDefaultTaxRate(
  supabase: any,
  organizationId: string,
  integrationId: string,
  businessId: string | null,
): Promise<{ id: string | null; percentage: number }> {
  let q = supabase
    .from("sage_tax_rates")
    .select("sage_tax_rate_id, is_default, percentage, name")
    .eq("organization_id", organizationId)
    .eq("platform_integration_id", integrationId);
  // Scope to the location's business (multi-business orgs).
  if (businessId) q = q.eq("sage_business_id", businessId);
  const { data } = await q;
  if (!data || data.length === 0) return { id: null, percentage: 0 };
  // Prefer the explicit default, else the STANDARD rate, else the first row.
  const def =
    data.find((t: any) => t.is_default) ||
    data.find((t: any) => /standard/i.test(t.name || "") || /standard/i.test(t.sage_tax_rate_id || "")) ||
    data[0];
  return { id: def?.sage_tax_rate_id || null, percentage: Number(def?.percentage) || 0 };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ success: false, error: "Server configuration error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let body: CreateInvoiceRequest;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid request body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { invoiceId, bankAccountId, invoice } = body;
    if (!invoiceId) {
      return new Response(
        JSON.stringify({ success: false, error: "invoiceId is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Load the AP invoice for org/location and PDF path.
    const { data: dbInvoice, error: invoiceError } = await supabase
      .from("accounts_payable_invoice")
      .select("*")
      .eq("id", invoiceId)
      .single();

    if (invoiceError || !dbInvoice) {
      return new Response(
        JSON.stringify({ success: false, error: "Invoice not found", details: invoiceError?.message }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (dbInvoice.status === "paid") {
      return new Response(
        JSON.stringify({ success: false, error: "Paid invoices cannot be updated or sent to Sage" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Idempotency guard — this invoice was already pushed to Sage. Creating it
    // again would make a DUPLICATE purchase invoice (this function only creates,
    // never updates), so stop here. To change it, edit the invoice in Sage.
    if (dbInvoice.platform_invoice_id && dbInvoice.platform_name === "sage") {
      return new Response(
        JSON.stringify({
          success: false,
          alreadyShared: true,
          platformInvoiceId: dbInvoice.platform_invoice_id,
          error: `This invoice was already sent to Sage (ID ${dbInvoice.platform_invoice_id}). It was not sent again to avoid creating a duplicate. To change it, edit the invoice directly in Sage.`,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const organizationId = dbInvoice.organization_id;
    const locationId = dbInvoice.location_id || null;

    // 1. Resolve the Sage connection + which business to target (X-Business).
    const { integration, businessId } = await getSageIntegration(supabase, organizationId, locationId);
    if (!integration) {
      return new Response(
        JSON.stringify({ success: false, error: "No connected Sage account found. Please connect Sage in Settings > Accounting Integrations." }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 2. Get a valid access token (refresh first; fall back to existing if still valid).
    let accessToken: string;
    const refreshResult = await refreshAccessToken(supabase, integration);
    if (refreshResult.error || !refreshResult.access_token) {
      if (integration.access_token && !isTokenExpired(integration.token_expires_at)) {
        accessToken = integration.access_token;
        console.log("[sage] Using existing non-expired token as fallback");
      } else {
        return new Response(
          JSON.stringify({ success: false, error: refreshResult.error || "Sage token refresh failed. Please reconnect Sage." }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    } else {
      accessToken = refreshResult.access_token;
    }

    // 3. Find or create the supplier (VENDOR contact).
    const contactName = invoice.vendor_name || invoice.customer_name || dbInvoice.vendor_name || "Unknown Vendor";
    const { contactId, error: contactError } = await findOrCreateContact(
      accessToken,
      contactName,
      invoice.invoice_number || dbInvoice.invoice_number || null,
      businessId,
    );
    if (contactError || !contactId) {
      return new Response(
        JSON.stringify({ success: false, error: contactError || "Failed to find or create Sage contact" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 4. Build invoice_lines. ledger_account_id is required by Sage; if a line
    //    has no mapped account we cannot post it.
    const defaultTaxRate = await resolveDefaultTaxRate(supabase, organizationId, integration.id, businessId);

    // Resolve ledger account ids. A line's platform_account_id may hold EITHER
    // the internal sage_chart_of_accounts.id (a dashed UUID) OR the real Sage
    // sage_account_id (32-hex GUID) — Sage only accepts the latter. Build a
    // lookup over THIS business's synced COA keyed by both, so we always send
    // the real GUID and reject accounts that don't belong to the mapped business.
    const acctMap: Record<string, string> = {};
    {
      let coaQ = supabase
        .from("sage_chart_of_accounts")
        .select("id, sage_account_id")
        .eq("organization_id", organizationId)
        .eq("platform_integration_id", integration.id);
      if (businessId) coaQ = coaQ.eq("sage_business_id", businessId);
      const { data: coaRows } = await coaQ;
      for (const r of coaRows || []) {
        if (!r.sage_account_id) continue;
        acctMap[r.sage_account_id] = r.sage_account_id; // already a Sage GUID → passthrough
        if (r.id) acctMap[r.id] = r.sage_account_id;     // internal id → Sage GUID
      }
    }

    const invoiceLines: Array<Record<string, any>> = [];
    const missingAccountLines: number[] = [];
    (invoice.line_items || []).forEach((item, idx) => {
      const rawAccount = item.platform_account_id || null;
      // Map to the real Sage ledger GUID; null if it isn't in this business's COA.
      const ledgerAccountId = rawAccount ? (acctMap[rawAccount] || null) : null;
      if (!ledgerAccountId) {
        missingAccountLines.push(idx + 1);
        return;
      }
      const quantity = Number(item.quantity) || 1;
      const unitPrice = Number(item.unit_price) || 0;
      const line: Record<string, any> = {
        description: item.description || "Item",
        ledger_account_id: ledgerAccountId,
        quantity,
        unit_price: unitPrice,
      };
      // Tax handling, driven by the LINE's own tax (not a blanket default):
      //  • A VAT-registered business needs BOTH tax_rate_id AND the per-line
      //    tax amount (currency_tax_amount) — sending only the rate id returns
      //    422 "This field is required (line_items.currency_tax_amount)".
      //  • A business that is NOT VAT-registered rejects ANY tax with
      //    422 "You cannot add tax, your business is not registered for tax".
      // So only attach tax when this line actually carries tax.
      const lineTax = Number(item.tax_amount) || 0;
      if (defaultTaxRate.id && lineTax > 0) {
        line.tax_rate_id = defaultTaxRate.id;
        const net = quantity * unitPrice;
        line.tax_amount = defaultTaxRate.percentage > 0
          ? Math.round(net * (defaultTaxRate.percentage / 100) * 100) / 100
          : Math.round(lineTax * 100) / 100;
      }
      invoiceLines.push(line);
    });

    if (missingAccountLines.length > 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `All line items must have a ledger account selected for Sage. Missing on line(s): ${missingAccountLines.join(", ")}.`,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (invoiceLines.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: "At least one line item is required to create a purchase invoice in Sage." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 5. POST /purchase_invoices.
    const purchaseInvoicePayload: Record<string, any> = {
      purchase_invoice: {
        contact_id: contactId,
        date: formatDate(invoice.invoice_date),
        due_date: formatDate(invoice.due_date),
        invoice_lines: invoiceLines,
      },
    };
    // Supplier's own bill number → vendor_reference (Sage has no invoice_number field).
    const vendorRef = (invoice.invoice_number || dbInvoice.invoice_number || "").trim();
    if (vendorRef) {
      purchaseInvoicePayload.purchase_invoice.vendor_reference = vendorRef;
      purchaseInvoicePayload.purchase_invoice.reference = vendorRef.substring(0, 50);
    }
    if (dbInvoice.private_note || dbInvoice.notes) {
      purchaseInvoicePayload.purchase_invoice.notes = dbInvoice.private_note || dbInvoice.notes;
    }

    console.log("[sage] Creating purchase invoice:", JSON.stringify(purchaseInvoicePayload));
    let createResponse = await fetch(`${SAGE_API_BASE}/purchase_invoices`, {
      method: "POST",
      headers: sageHeaders(accessToken, businessId, true),
      body: JSON.stringify(purchaseInvoicePayload),
    });

    // Defensive retry: if the business isn't VAT-registered it rejects ANY tax.
    // Strip tax fields from every line and post once more (belt-and-suspenders
    // on top of the per-line tax gate above — handles header-tax-only invoices).
    if (!createResponse.ok && createResponse.status === 422) {
      const peek = await createResponse.clone().text();
      if (/not registered for tax/i.test(peek)) {
        console.log("[sage] business not VAT-registered — retrying without tax");
        purchaseInvoicePayload.purchase_invoice.invoice_lines = invoiceLines.map((l) => {
          const { tax_rate_id, tax_amount, ...rest } = l;
          return rest;
        });
        createResponse = await fetch(`${SAGE_API_BASE}/purchase_invoices`, {
          method: "POST",
          headers: sageHeaders(accessToken, businessId, true),
          body: JSON.stringify(purchaseInvoicePayload),
        });
      }
    }

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      // Log the full Sage error + the payload we sent so the exact failing field
      // is visible in the edge-function logs.
      console.error(`[sage] ❌ purchase_invoice ${createResponse.status} — Sage said: ${errorText}`);
      console.error(`[sage] payload was: ${JSON.stringify(purchaseInvoicePayload)}`);
      let errorMessage = `Failed to create purchase invoice in Sage: ${createResponse.status}`;
      try {
        const errorJson = JSON.parse(errorText);
        // Sage returns [{ "$severity": "error", "$message": "...", "$dataPath": "..." }] items.
        // Include $dataPath so the caller knows WHICH field failed.
        const fmt = (e: any) => {
          const m = e["$message"] || e.message || "";
          const p = e["$dataPath"] || e.dataPath || e["$source"] || "";
          return p ? `${m} (field: ${p})` : m;
        };
        if (Array.isArray(errorJson)) {
          const msgs = errorJson.map(fmt).filter(Boolean);
          if (msgs.length) errorMessage = msgs.join("; ");
        } else if (errorJson["$message"]) {
          errorMessage = fmt(errorJson);
        } else if (errorJson.message) {
          errorMessage = errorJson.message;
        }
      } catch {
        if (errorText.length < 500) errorMessage = errorText;
      }
      return new Response(
        JSON.stringify({ success: false, error: errorMessage }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const createdInvoice = await createResponse.json();
    const sageInvoiceId = createdInvoice?.id;
    if (!sageInvoiceId) {
      return new Response(
        JSON.stringify({ success: false, error: "Sage returned no invoice id" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    console.log(`[sage] ✅ Purchase invoice created: ${sageInvoiceId}`);

    // 6. Record a payment if status is PAID and a bank account was chosen.
    //    NOTE: verify the exact contact_payment shape against a live tenant —
    //    this is best-effort and never fails the invoice creation.
    let paymentSucceeded = false;
    if (invoice.status === "PAID" && bankAccountId) {
      try {
        const paymentPayload = {
          contact_payment: {
            transaction_type_id: "PURCHASE_PAYMENT",
            contact_id: contactId,
            bank_account_id: bankAccountId,
            date: formatDate(invoice.invoice_date),
            total_amount: invoice.total_amount,
            allocated_artefacts: [
              { artefact_id: sageInvoiceId, amount: invoice.total_amount },
            ],
          },
        };
        console.log("[sage] Creating contact payment:", JSON.stringify(paymentPayload));
        const paymentResponse = await fetch(`${SAGE_API_BASE}/contact_payments`, {
          method: "POST",
          headers: sageHeaders(accessToken, businessId, true),
          body: JSON.stringify(paymentPayload),
        });
        if (paymentResponse.ok) {
          paymentSucceeded = true;
          console.log("[sage] ✅ Payment recorded");
        } else {
          console.error(`[sage] ❌ Payment failed: ${paymentResponse.status} - ${(await paymentResponse.text()).substring(0, 300)}`);
        }
      } catch (paymentErr: any) {
        console.error("[sage] ❌ Payment error:", paymentErr?.message || paymentErr);
      }
    } else if (invoice.status === "PAID" && !bankAccountId) {
      console.warn("[sage] Status PAID but no bankAccountId — skipping payment");
    }

    // 7. Attach the original PDF (best-effort — never fails the invoice).
    let attachmentSucceeded = false;
    try {
      const pdfBase64 = await loadInvoicePdfBase64(supabase, dbInvoice);
      if (pdfBase64) {
        attachmentSucceeded = await attachPdfToInvoice(
          accessToken,
          createdInvoice,
          pdfBase64.base64,
          pdfBase64.fileName,
          businessId,
        );
      } else {
        console.warn("[sage] No PDF found for invoice — skipping attachment");
      }
    } catch (attachErr: any) {
      console.error("[sage] ❌ Attachment error:", attachErr?.message || attachErr);
    }

    // 8. Write back onto the AP invoice.
    const updateData: Record<string, any> = {
      platform_invoice_id: sageInvoiceId,
      platform_name: "sage",
      platform_status: paymentSucceeded ? "PAID" : (invoice.status || "AUTHORISED"),
      platform_integration_id: integration.id,
      is_from_platform: true,
      shared_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (paymentSucceeded) {
      updateData.paid_at = new Date().toISOString();
      updateData.status = "paid";
      updateData.bank_account_id = bankAccountId;
    }

    await supabase.from("accounts_payable_invoice").update(updateData).eq("id", invoiceId);

    return new Response(
      JSON.stringify({
        success: true,
        platformInvoiceId: sageInvoiceId,
        sageInvoiceId,
        sageInvoiceNumber: createdInvoice?.displayed_as || createdInvoice?.vendor_reference || null,
        message: "Invoice created successfully in Sage",
        paymentCreated: paymentSucceeded,
        attachmentCreated: attachmentSucceeded,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[sage] Internal error:", errorMessage);
    return new Response(
      JSON.stringify({ success: false, error: "Internal server error", details: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

// ── Download the invoice PDF from storage and return base64 ──
async function loadInvoicePdfBase64(
  supabase: any,
  dbInvoice: any,
): Promise<{ base64: string; fileName: string } | null> {
  const directPath: string | null = dbInvoice.pdf_path || dbInvoice.invoice_pdf_url || null;
  if (!directPath) return null;

  let bytes: Uint8Array | null = null;
  const fileName =
    (directPath.split("/").pop() || `invoice-${dbInvoice.id}.pdf`).split("?")[0] || `invoice-${dbInvoice.id}.pdf`;

  if (/^https?:\/\//i.test(directPath)) {
    // Full URL — fetch directly.
    const res = await fetch(directPath);
    if (!res.ok) return null;
    bytes = new Uint8Array(await res.arrayBuffer());
  } else {
    // Storage object path inside the AP bucket.
    const { data, error } = await supabase.storage.from(AP_PDF_BUCKET).download(directPath);
    if (error || !data) {
      console.warn(`[sage] Could not download PDF from ${AP_PDF_BUCKET}/${directPath}: ${error?.message}`);
      return null;
    }
    bytes = new Uint8Array(await data.arrayBuffer());
  }

  if (!bytes) return null;

  // Base64-encode in chunks (avoid call-stack overflow on large files).
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return { base64: btoa(binary), fileName };
}

// ── Attach a base64 PDF to the created purchase invoice ──
// Sage links attachments via the transaction's context. The created invoice
// carries a `displayed_as`/`id` and a transaction reference; per Sage docs the
// context id should be the transaction's `origin_id`. We read both off the
// created object and fall back to the invoice id. Verify against a live tenant.
async function attachPdfToInvoice(
  accessToken: string,
  createdInvoice: any,
  base64: string,
  fileName: string,
  businessId: string | null,
): Promise<boolean> {
  const transactionId =
    createdInvoice?.transaction?.id || createdInvoice?.transaction_id || createdInvoice?.id;
  const contextId =
    createdInvoice?.origin_id || createdInvoice?.transaction?.origin_id || createdInvoice?.id;

  const attachmentPayload = {
    attachment: {
      file: base64,
      file_name: fileName,
      mime_type: "application/pdf",
      file_extension: "pdf",
      description: "Original supplier invoice (DentPulse)",
      attachment_context_type_id: "PURCHASE_INVOICE",
      attachment_context_id: contextId,
      transaction_id: transactionId,
    },
  };

  const response = await fetch(`${SAGE_API_BASE}/attachments`, {
    method: "POST",
    headers: sageHeaders(accessToken, businessId, true),
    body: JSON.stringify(attachmentPayload),
  });

  if (response.ok) {
    console.log("[sage] ✅ PDF attached to purchase invoice");
    return true;
  }
  console.error(`[sage] ❌ Attachment failed: ${response.status} - ${(await response.text()).substring(0, 300)}`);
  return false;
}
