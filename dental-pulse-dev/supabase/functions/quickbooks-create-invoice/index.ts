import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// quickbooks-create-invoice — pushes an Accounts Payable invoice to QuickBooks
// Online as a BILL (the QBO equivalent of a Xero ACCPAY invoice). Mirrors
// xero-create-invoice; adapted for Intuit:
//   • credentials are PER-ORG (client_id/client_secret on platform_integrations)
//   • the company is identified by realmId (platform_org_id), not a tenant id
//   • the supplier is a QBO Vendor; the document is a QBO Bill
//   • when status is PAID, a QBO BillPayment links a bank account to the bill

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const INTUIT_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const MINOR_VERSION = "65";

// QBO has two completely separate API hosts. A token issued for a sandbox
// company only works against the sandbox host, and vice-versa — calling the
// wrong one returns 403 ApplicationAuthorizationFailed (errorCode 3100).
// We probe to find the host this connection actually belongs to, so the
// function works for sandbox and production without env juggling.
const QBO_PROD = "https://quickbooks.api.intuit.com";
const QBO_SANDBOX = "https://sandbox-quickbooks.api.intuit.com";
const QBO_API_BASE_ENV = Deno.env.get("QUICKBOOKS_API_BASE") || "";

// Candidate hosts to probe, in order: the configured one first (if any),
// then production, then sandbox — deduped.
function qboBaseCandidates(): string[] {
  const list = [QBO_API_BASE_ENV, QBO_PROD, QBO_SANDBOX].filter(Boolean);
  return [...new Set(list)];
}

// Find the QBO API host this realm's token is authorised for, by hitting the
// CompanyInfo endpoint. Returns null if none work (genuine token/scope issue).
async function resolveQboBase(accessToken: string, realmId: string): Promise<string | null> {
  for (const base of qboBaseCandidates()) {
    try {
      const res = await fetch(
        `${base}/v3/company/${realmId}/companyinfo/${realmId}?minorversion=${MINOR_VERSION}`,
        { headers: { "Authorization": `Bearer ${accessToken}`, "Accept": "application/json" } },
      );
      if (res.ok) return base;
      console.warn(`[quickbooks] base probe ${base} → ${res.status}`);
    } catch (e) {
      console.warn(`[quickbooks] base probe ${base} threw:`, e);
    }
  }
  return null;
}

interface CreateInvoiceRequest {
  invoiceId: string;
  bankAccountId?: string; // QBO bank account qb_account_id, for the BillPayment when PAID
  invoice: {
    invoice_number: string;
    customer_name: string;
    vendor_name: string;
    currency: string;
    invoice_date: string;
    due_date: string;
    subtotal: number;
    tax: number;
    total_amount: number;
    status?: string; // DRAFT / SUBMITTED / AUTHORISED / PAID
    line_items: Array<{
      description: string;
      quantity: number;
      unit_price: number;
      line_total: number;
      tax_amount?: number;         // Tax amount for this line (like Xero)
      item?: string;
      account_code?: string;       // QBO AcctNum (often null in QBO)
      platform_account_id?: string; // QBO Account.Id (qb_account_id) — the AccountRef
    }>;
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// QBO expects 'YYYY-MM-DD'.
function formatDate(dateStr: string | null): string {
  if (!dateStr) return new Date().toISOString().split("T")[0];
  try {
    return new Date(dateStr).toISOString().split("T")[0];
  } catch {
    return new Date().toISOString().split("T")[0];
  }
}

// Escape a value for embedding in a QBO query-language string literal.
function qboEscape(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

// Refresh the Intuit access token using the app-level env client creds
// (QUICKBOOKS_CLIENT_ID/QUICKBOOKS_CLIENT_SECRET), mirroring Xero.
// Intuit rotates the refresh token on every refresh, so persist the new one.
//
// Uses the same platform_integrations.refresh_lock_at mutex as
// quickbooks-refresh-token and the Node sync backend, so this user-triggered
// invoice push can't race a sync refresh and burn the rotating refresh_token.
async function refreshAccessToken(
  supabase: any,
  integration: any,
): Promise<{ accessToken: string | null; error: string | null }> {
  if (!integration.refresh_token) {
    return { accessToken: null, error: "No refresh token. Please reconnect QuickBooks." };
  }
  const clientId = Deno.env.get("QUICKBOOKS_CLIENT_ID");
  const clientSecret = Deno.env.get("QUICKBOOKS_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    return { accessToken: null, error: "QuickBooks integration not configured. Please contact support." };
  }

  // Acquire the refresh lock (atomic; lock older than 60s is stealable).
  // Two standalone conditional UPDATEs ("free" then "stale") — NOT a single
  // .or(`refresh_lock_at.is.null,refresh_lock_at.lt.${ts}`), which PostgREST
  // mis-parses for timestamp values ("column does not exist"), making
  // acquisition silently always fail.
  const staleBefore = new Date(Date.now() - 60_000).toISOString();
  const nowIso = new Date().toISOString();
  let lockRes = await supabase
    .from("platform_integrations")
    .update({ refresh_lock_at: nowIso })
    .eq("id", integration.id)
    .is("refresh_lock_at", null)
    .select("id");
  if (lockRes.error) console.error("[quickbooks-create-invoice] lock acquire (free) error:", lockRes.error);
  let didAcquire = Array.isArray(lockRes.data) && lockRes.data.length > 0;
  if (!didAcquire) {
    lockRes = await supabase
      .from("platform_integrations")
      .update({ refresh_lock_at: nowIso })
      .eq("id", integration.id)
      .lt("refresh_lock_at", staleBefore)
      .select("id");
    if (lockRes.error) console.error("[quickbooks-create-invoice] lock acquire (stale) error:", lockRes.error);
    didAcquire = Array.isArray(lockRes.data) && lockRes.data.length > 0;
  }

  if (!didAcquire) {
    // Another caller is refreshing — wait, then reuse whatever they wrote.
    await new Promise((r) => setTimeout(r, 3_000));
    const { data: freshRow } = await supabase
      .from("platform_integrations")
      .select("access_token, token_expires_at")
      .eq("id", integration.id)
      .single();
    if (freshRow?.access_token && !isTokenExpired(freshRow.token_expires_at)) {
      return { accessToken: freshRow.access_token, error: null };
    }
    return { accessToken: null, error: "QuickBooks token refresh is in progress — please retry." };
  }

  try {
    // Re-read for the latest refresh_token (it may have rotated before we locked).
    const { data: locked } = await supabase
      .from("platform_integrations")
      .select("refresh_token, access_token, token_expires_at")
      .eq("id", integration.id)
      .single();
    if (locked?.access_token && !isTokenExpired(locked.token_expires_at)) {
      return { accessToken: locked.access_token, error: null };
    }
    const refreshToken = locked?.refresh_token || integration.refresh_token;

    const credentials = btoa(`${clientId}:${clientSecret}`);
    const response = await fetch(INTUIT_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
        "Authorization": `Basic ${credentials}`,
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }).toString(),
    });
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[quickbooks] Token refresh failed: ${response.status} - ${errorText}`);
      return { accessToken: null, error: "QuickBooks token refresh failed. Please reconnect QuickBooks." };
    }
    const tokenData = await response.json();
    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();
    const { error: updateError } = await supabase
      .from("platform_integrations")
      .update({
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token, // Intuit rotates this — persist it
        token_expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq("id", integration.id);
    if (updateError) {
      console.error("[quickbooks] Failed to save refreshed tokens:", updateError);
      return { accessToken: null, error: "Failed to save refreshed QuickBooks tokens." };
    }
    return { accessToken: tokenData.access_token, error: null };
  } catch (error: any) {
    console.error("[quickbooks] Token refresh error:", error);
    return { accessToken: null, error: error?.message || "Token refresh failed" };
  } finally {
    // Always release the lock we hold.
    await supabase
      .from("platform_integrations")
      .update({ refresh_lock_at: null })
      .eq("id", integration.id);
  }
}

function isTokenExpired(tokenExpiresAt: string | null): boolean {
  if (!tokenExpiresAt) return true;
  return new Date() >= new Date(new Date(tokenExpiresAt).getTime() - 5 * 60 * 1000); // 5-min buffer
}

// Resolve the QBO company (realmId) for a location via the platform mapping.
async function getQuickBooksRealm(
  supabase: any,
  organizationId: string,
  locationId: string | null,
): Promise<{ realmId: string | null; companyName: string | null }> {
  const pickQuickBooks = (rows: any[] | null) => {
    const m = (rows || []).find(
      (r: any) => r.platform_integration_organizations?.platform_name === "quickbooks",
    );
    const org = m?.platform_integration_organizations;
    return org ? { realmId: org.platform_org_id, companyName: org.platform_org_name } : null;
  };
  const selectShape = `
    platform_integration_id,
    platform_integration_organizations_id,
    platform_integration_organizations!inner (
      id, platform_integration_id, platform_org_id, platform_org_name, platform_name
    )`;

  if (locationId) {
    const { data } = await supabase
      .from("platform_integration_organization_mapping")
      .select(selectShape)
      .eq("location_id", locationId)
      .eq("organization_id", organizationId);
    const hit = pickQuickBooks(data);
    if (hit) return hit;
  }

  const { data: anyMapping } = await supabase
    .from("platform_integration_organization_mapping")
    .select(selectShape)
    .eq("organization_id", organizationId);
  const anyHit = pickQuickBooks(anyMapping);
  if (anyHit) return anyHit;

  // Last fallback: first active QuickBooks company for the org.
  const { data: firstOrg } = await supabase
    .from("platform_integration_organizations")
    .select("platform_org_id, platform_org_name")
    .eq("organization_id", organizationId)
    .eq("platform_name", "quickbooks")
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  return {
    realmId: firstOrg?.platform_org_id || null,
    companyName: firstOrg?.platform_org_name || null,
  };
}

// QBO query API — returns the QueryResponse object.
async function qboQuery(base: string, accessToken: string, realmId: string, query: string): Promise<any> {
  const url = `${base}/v3/company/${realmId}/query?query=${encodeURIComponent(query)}&minorversion=${MINOR_VERSION}`;
  const res = await fetch(url, {
    headers: { "Authorization": `Bearer ${accessToken}`, "Accept": "application/json" },
  });
  if (!res.ok) {
    throw new Error(`QBO query failed (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  return data.QueryResponse || {};
}

// Vendor details for creation (optional fields from invoice).
interface VendorDetails {
  address?: string | null;
  phone?: string | null;
  email?: string | null;
}

// Find a Vendor by display name, creating it if absent.
// If creating, includes address/phone/email from vendorDetails.
async function findOrCreateVendor(
  base: string,
  accessToken: string,
  realmId: string,
  vendorName: string,
  vendorDetails?: VendorDetails,
): Promise<{ vendorId: string | null; error: string | null }> {
  const name = (vendorName || "").trim().replace(/\s+/g, " ").slice(0, 100) || "Unknown Vendor";
  try {
    const qr = await qboQuery(
      base,
      accessToken,
      realmId,
      `select * from Vendor where DisplayName = '${qboEscape(name)}'`,
    );
    if (qr.Vendor && qr.Vendor.length > 0) {
      const existingVendor = qr.Vendor[0];
      const vendorId = String(existingVendor.Id);

      // Update existing vendor with address/phone/email if provided
      if (vendorDetails?.address || vendorDetails?.phone || vendorDetails?.email) {
        const updatePayload: Record<string, any> = {
          Id: vendorId,
          SyncToken: existingVendor.SyncToken,
          sparse: true, // Only update fields we provide
        };

        // Build BillAddr without vendor name
        if (vendorDetails?.address) {
          const addr = vendorDetails.address.trim();
          let parts = addr.split(/[,\n]+/).map(p => p.trim()).filter(Boolean);
          const nameLower = name.toLowerCase();
          parts = parts.filter(p => {
            const partLower = p.toLowerCase();
            if (partLower === nameLower) return false;
            if (nameLower.includes(partLower) && partLower.length > 3) return false;
            if (partLower.includes(nameLower) && nameLower.length > 3) return false;
            return true;
          });
          if (parts.length >= 1) {
            updatePayload.BillAddr = { Line1: parts[0] };
            if (parts.length >= 2) updatePayload.BillAddr.Line2 = parts[1];
            if (parts.length >= 3) updatePayload.BillAddr.City = parts[2];
            if (parts.length >= 4) updatePayload.BillAddr.PostalCode = parts[3];
            if (parts.length >= 5) updatePayload.BillAddr.Country = parts[4];
          }
        }

        if (vendorDetails?.phone) {
          updatePayload.PrimaryPhone = { FreeFormNumber: vendorDetails.phone.trim() };
        }

        if (vendorDetails?.email) {
          const email = vendorDetails.email.trim();
          if (email.includes("@") && email.includes(".")) {
            updatePayload.PrimaryEmailAddr = { Address: email };
          }
        }

        // Update vendor in QuickBooks
        try {
          const updateRes = await fetch(
            `${base}/v3/company/${realmId}/vendor?minorversion=${MINOR_VERSION}`,
            {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${accessToken}`,
                "Content-Type": "application/json",
                "Accept": "application/json",
              },
              body: JSON.stringify(updatePayload),
            }
          );
          if (updateRes.ok) {
            console.log(`[quickbooks] Updated existing vendor ${vendorId} with new details`);
          } else {
            console.warn(`[quickbooks] Failed to update vendor ${vendorId}: ${updateRes.status}`);
          }
        } catch (updateErr) {
          console.warn(`[quickbooks] Error updating vendor:`, updateErr);
        }
      }

      return { vendorId, error: null };
    }
    // Not found — create it with address/phone/email if available.
    const vendorPayload: Record<string, any> = { DisplayName: name };

    // Add BillAddr (mailing address) if address provided
    if (vendorDetails?.address) {
      const addr = vendorDetails.address.trim();
      // Try to parse address into components (Line1, City, PostalCode, Country)
      // Format might be: "123 Main St, London, SW1A 1AA, UK" or just a single line
      let parts = addr.split(/[,\n]+/).map(p => p.trim()).filter(Boolean);

      // Filter out vendor name from address parts (avoid duplicate name in mailing address)
      const nameLower = name.toLowerCase();
      parts = parts.filter(p => {
        const partLower = p.toLowerCase();
        // Skip if part matches vendor name or is very similar (>80% match)
        if (partLower === nameLower) return false;
        // Skip if vendor name contains this part or vice versa (partial match)
        if (nameLower.includes(partLower) && partLower.length > 3) return false;
        if (partLower.includes(nameLower) && nameLower.length > 3) return false;
        return true;
      });

      if (parts.length >= 1) {
        vendorPayload.BillAddr = { Line1: parts[0] };
        if (parts.length >= 2) vendorPayload.BillAddr.Line2 = parts[1];
        if (parts.length >= 3) vendorPayload.BillAddr.City = parts[2];
        if (parts.length >= 4) vendorPayload.BillAddr.PostalCode = parts[3];
        if (parts.length >= 5) vendorPayload.BillAddr.Country = parts[4];
      }
    }

    // Add PrimaryPhone if phone provided
    if (vendorDetails?.phone) {
      vendorPayload.PrimaryPhone = { FreeFormNumber: vendorDetails.phone.trim() };
    }

    // Add PrimaryEmailAddr if email provided
    if (vendorDetails?.email) {
      const email = vendorDetails.email.trim();
      // Basic email validation (must contain @ and .)
      if (email.includes("@") && email.includes(".")) {
        vendorPayload.PrimaryEmailAddr = { Address: email };
      }
    }

    console.log(`[quickbooks] Creating vendor: ${name}`, vendorDetails ? JSON.stringify(vendorDetails) : "no details");

    const res = await fetch(
      `${base}/v3/company/${realmId}/vendor?minorversion=${MINOR_VERSION}`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        body: JSON.stringify(vendorPayload),
      },
    );
    if (!res.ok) {
      const errText = await res.text();
      // A duplicate-name fault means the vendor exists under a slightly
      // different record — fall back to a contains search.
      if (errText.includes("Duplicate Name") || res.status === 400) {
        const retry = await qboQuery(
          base,
          accessToken,
          realmId,
          `select * from Vendor where DisplayName like '%${qboEscape(name.slice(0, 40))}%'`,
        );
        if (retry.Vendor && retry.Vendor.length > 0) {
          return { vendorId: String(retry.Vendor[0].Id), error: null };
        }
      }
      return { vendorId: null, error: `Failed to create QuickBooks vendor: ${errText}` };
    }
    const created = await res.json();
    console.log(`[quickbooks] Vendor created: ${created.Vendor.Id} - ${name}`);
    return { vendorId: String(created.Vendor.Id), error: null };
  } catch (error: any) {
    return { vendorId: null, error: error?.message || "Vendor lookup failed" };
  }
}

// Parse a QBO Fault payload into a readable message.
function parseQboError(text: string, status: number): string {
  try {
    const json = JSON.parse(text);
    const errors = json?.Fault?.Error;
    if (Array.isArray(errors) && errors.length > 0) {
      return errors.map((e: any) => e.Detail || e.Message).filter(Boolean).join("; ");
    }
  } catch { /* fall through */ }
  return text.length < 500 ? text : `QuickBooks request failed (${status})`;
}

// Resolve a QBO purchase TaxCode whose effective rate matches `targetRate`
// (e.g. 20 for UK standard VAT). Returns the TaxCode Id, or null if none match /
// tax isn't enabled. Used so a bill posts WITH VAT and its total matches the
// supplier invoice. Best-effort: any failure → null (post without tax).
async function findQboPurchaseTaxCode(
  base: string,
  accessToken: string,
  realmId: string,
  targetRate: number,
): Promise<string | null> {
  if (!(targetRate > 0)) return null;
  try {
    const [codeQr, rateQr] = await Promise.all([
      qboQuery(base, accessToken, realmId, "select * from TaxCode maxresults 1000"),
      qboQuery(base, accessToken, realmId, "select * from TaxRate maxresults 1000"),
    ]);
    const rateValueById = new Map<string, number>();
    for (const r of (rateQr.TaxRate || []) as any[]) {
      rateValueById.set(String(r.Id), Number(r.RateValue) || 0);
    }
    for (const c of (codeQr.TaxCode || []) as any[]) {
      if (c.Active === false) continue;
      const details = c.PurchaseTaxRateList?.TaxRateDetail || [];
      if (!details.length) continue;
      let rate = 0;
      for (const d of details) rate += rateValueById.get(String(d.TaxRateRef?.value)) || 0;
      if (Math.abs(rate - targetRate) < 0.5) return String(c.Id);
    }
  } catch (e) {
    console.warn("[quickbooks] tax code lookup failed:", e);
  }
  return null;
}

// Delete existing attachments from a QBO Bill (to avoid duplicates on update).
async function deleteExistingBillAttachments(
  base: string,
  accessToken: string,
  realmId: string,
  qbBillId: string
): Promise<number> {
  let deletedCount = 0;
  try {
    // Query all Attachables linked to this Bill
    const query = `select * from Attachable where AttachableRef.EntityRef.Type = 'Bill' and AttachableRef.EntityRef.value = '${qbBillId}'`;
    const queryUrl = `${base}/v3/company/${realmId}/query?query=${encodeURIComponent(query)}&minorversion=${MINOR_VERSION}`;

    const queryRes = await fetch(queryUrl, {
      headers: { "Authorization": `Bearer ${accessToken}`, "Accept": "application/json" },
    });

    if (!queryRes.ok) {
      console.warn(`[quickbooks] Failed to query attachments: ${queryRes.status}`);
      return 0;
    }

    const queryData = await queryRes.json();
    const attachables = queryData?.QueryResponse?.Attachable || [];

    if (attachables.length === 0) {
      console.log(`[quickbooks] No existing attachments on Bill ${qbBillId}`);
      return 0;
    }

    console.log(`[quickbooks] Found ${attachables.length} existing attachment(s) on Bill ${qbBillId}, deleting...`);

    // Delete each attachment
    for (const att of attachables) {
      try {
        const deleteRes = await fetch(
          `${base}/v3/company/${realmId}/attachable?operation=delete&minorversion=${MINOR_VERSION}`,
          {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${accessToken}`,
              "Content-Type": "application/json",
              "Accept": "application/json",
            },
            body: JSON.stringify({ Id: att.Id, SyncToken: att.SyncToken }),
          }
        );
        if (deleteRes.ok) {
          deletedCount++;
          console.log(`[quickbooks] Deleted attachment ${att.Id}`);
        } else {
          console.warn(`[quickbooks] Failed to delete attachment ${att.Id}: ${deleteRes.status}`);
        }
      } catch (delErr) {
        console.warn(`[quickbooks] Error deleting attachment ${att.Id}:`, delErr);
      }
    }
  } catch (err) {
    console.error("[quickbooks] Error querying/deleting attachments:", err);
  }
  return deletedCount;
}

// Attach the invoice PDF to an existing QBO Bill. Returns a status string for logging.
// Uses the QBO Attachable API with multipart/form-data upload.
// Deletes existing attachments first to avoid duplicates.
async function attachPdfToQuickBooks(
  base: string,
  accessToken: string,
  realmId: string,
  qbBillId: string,
  dbInvoice: any,
  supabase: any
): Promise<string> {
  const BACKEND_URL = Deno.env.get("BACKEND_URL") ?? "https://dent-enterprise-api.dentpulse.com";

  // Safely get pdf_path
  const directPath = dbInvoice?.pdf_path || dbInvoice?.invoice_pdf_url || null;
  console.log(`[quickbooks] PDF attachment — pdf_path=${dbInvoice?.pdf_path}, invoice_pdf_url=${dbInvoice?.invoice_pdf_url}`);

  // Delete existing attachments first to avoid duplicates
  const deletedCount = await deleteExistingBillAttachments(base, accessToken, realmId, qbBillId);
  if (deletedCount > 0) {
    console.log(`[quickbooks] Deleted ${deletedCount} existing attachment(s) before uploading new one`);
  }

  if (!directPath) {
    console.log("[quickbooks] No PDF path on invoice — skipping attachment");
    return "skipped:no_path";
  }

  let pdfUrl: string | null = null;
  let fileName = "invoice.pdf";

  try {
    if (directPath.startsWith("http")) {
      pdfUrl = directPath;
      fileName = directPath.split("/").pop() || "invoice.pdf";
    } else if (directPath.startsWith("AP-Invoices/")) {
      fileName = directPath.split("/").pop() || "invoice.pdf";
      pdfUrl = `${BACKEND_URL}/api/inbound-email-webhook/view-pdf/${fileName}`;
    } else if (dbInvoice?.source === "email") {
      const { data: attachment } = await supabase
        .from("inbound_email_attachments")
        .select("stored_path, storage_bucket")
        .eq("invoice_id", dbInvoice.id)
        .maybeSingle();
      if (attachment?.stored_path) {
        const bucket = attachment.storage_bucket || "inbound-attechments";
        if (attachment.stored_path.startsWith("AP-Invoices/")) {
          fileName = attachment.stored_path.split("/").pop() || "invoice.pdf";
          pdfUrl = `${BACKEND_URL}/api/inbound-email-webhook/view-pdf/${fileName}`;
        } else {
          const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(attachment.stored_path);
          pdfUrl = urlData?.publicUrl ?? null;
          fileName = attachment.stored_path.split("/").pop() || "invoice.pdf";
        }
      }
    } else {
      const { data: urlData } = supabase.storage.from("account-payable-attechments").getPublicUrl(directPath);
      pdfUrl = urlData?.publicUrl ?? null;
      fileName = directPath.split("/").pop() || "invoice.pdf";
    }
  } catch (urlErr: any) {
    console.error("[quickbooks] Error resolving PDF URL:", urlErr?.message || urlErr);
    return `url_error:${urlErr?.message}`;
  }

  if (!pdfUrl) {
    console.log("[quickbooks] Could not resolve PDF URL — skipping attachment");
    return "skipped:no_url";
  }

  if (!fileName.toLowerCase().endsWith(".pdf")) fileName += ".pdf";

  console.log(`[quickbooks] Fetching PDF for attachment: ${pdfUrl}`);

  try {
    const pdfResponse = await fetch(pdfUrl);
    if (!pdfResponse.ok) {
      console.error(`[quickbooks] ❌ Failed to fetch PDF (${pdfUrl}): ${pdfResponse.status}`);
      return `fetch_failed:${pdfResponse.status}`;
    }

    const pdfBuffer = await pdfResponse.arrayBuffer();
    console.log(`[quickbooks] PDF fetched, size=${pdfBuffer.byteLength}, uploading to QuickBooks...`);

    // QBO Attachable API uses multipart/form-data
    // AttachableRef links the file to the Bill entity
    // IncludeOnSend ensures it shows as linked in QB UI
    const attachablePayload = {
      AttachableRef: [
        {
          EntityRef: {
            type: "Bill",
            value: String(qbBillId),
          },
          IncludeOnSend: true,
        }
      ],
      FileName: fileName,
      ContentType: "application/pdf",
      Category: "Other",
    };

    const boundary = `----QBOBoundary${Date.now()}`;
    const metadataJson = JSON.stringify(attachablePayload);

    // Build multipart body
    const encoder = new TextEncoder();
    const parts: Uint8Array[] = [];

    // Part 1: file_metadata_01 (JSON)
    parts.push(encoder.encode(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file_metadata_01"\r\n` +
      `Content-Type: application/json\r\n\r\n` +
      `${metadataJson}\r\n`
    ));

    // Part 2: file_content_01 (PDF binary)
    parts.push(encoder.encode(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file_content_01"; filename="${fileName}"\r\n` +
      `Content-Type: application/pdf\r\n\r\n`
    ));
    parts.push(new Uint8Array(pdfBuffer));
    parts.push(encoder.encode(`\r\n--${boundary}--\r\n`));

    // Combine all parts
    const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
    const body = new Uint8Array(totalLength);
    let offset = 0;
    for (const part of parts) {
      body.set(part, offset);
      offset += part.length;
    }

    const uploadResponse = await fetch(
      `${base}/v3/company/${realmId}/upload?minorversion=${MINOR_VERSION}`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Accept": "application/json",
        },
        body: body,
      }
    );

    if (uploadResponse.ok) {
      const uploadData = await uploadResponse.json();
      const attachable = uploadData?.AttachableResponse?.[0]?.Attachable;
      const attachId = attachable?.Id;
      const attachRef = attachable?.AttachableRef;

      // Verify the attachment is properly linked to the Bill
      const isLinked = attachRef?.some((ref: any) =>
        ref?.EntityRef?.type === "Bill" && ref?.EntityRef?.value === String(qbBillId)
      );

      console.log(`[quickbooks] ✅ PDF attached to Bill: ${fileName}`);
      console.log(`[quickbooks]    AttachableId: ${attachId}`);
      console.log(`[quickbooks]    Linked to Bill: ${isLinked ? "YES" : "NO"}`);
      console.log(`[quickbooks]    AttachableRef: ${JSON.stringify(attachRef)}`);

      if (!isLinked) {
        console.warn(`[quickbooks] ⚠️ Attachment created but may not be linked properly`);
      }

      return isLinked ? "ok:linked" : "ok:unlinked";
    } else {
      const err = await uploadResponse.text();
      console.error(`[quickbooks] ❌ PDF attachment failed: ${uploadResponse.status} - ${err}`);
      return `qbo_error:${uploadResponse.status}`;
    }
  } catch (e: any) {
    console.error("[quickbooks] ❌ PDF attachment error:", e?.message || e);
    return `exception:${e?.message}`;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseServiceKey) {
      return jsonResponse({ success: false, error: "Server configuration error" }, 500);
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let body: CreateInvoiceRequest;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ success: false, error: "Invalid request body" }, 400);
    }

    const { invoiceId, bankAccountId, invoice } = body;
    if (!invoiceId) {
      return jsonResponse({ success: false, error: "invoiceId is required" }, 400);
    }

    // Load the AP invoice for organization_id / location_id / status.
    const { data: dbInvoice, error: invoiceError } = await supabase
      .from("accounts_payable_invoice")
      .select("*")
      .eq("id", invoiceId)
      .single();
    if (invoiceError || !dbInvoice) {
      return jsonResponse(
        { success: false, error: "Invoice not found", details: invoiceError?.message },
        404,
      );
    }
    if (dbInvoice.status === "paid") {
      return jsonResponse(
        { success: false, error: "Paid invoices cannot be updated or sent to QuickBooks" },
        400,
      );
    }

    // Check if this invoice was already pushed to QuickBooks — if so, we UPDATE
    // instead of CREATE. This allows users to sync changes back to QBO.
    const existingQbBillId = dbInvoice.platform_invoice_id && dbInvoice.platform_name === "quickbooks"
      ? dbInvoice.platform_invoice_id
      : null;
    const isUpdate = !!existingQbBillId;

    const organizationId = dbInvoice.organization_id;
    const locationId = dbInvoice.location_id || null;

    // Resolve the QBO company (realmId) for this location.
    const { realmId, companyName } = await getQuickBooksRealm(supabase, organizationId, locationId);
    if (!realmId) {
      return jsonResponse(
        {
          success: false,
          error: "No QuickBooks company found. Map this location to a QuickBooks company in Settings > Accounting Integrations.",
        },
        400,
      );
    }

    // Find the connected QuickBooks integration that owns this realm.
    let integration: any = null;
    const { data: realmOrg } = await supabase
      .from("platform_integration_organizations")
      .select("platform_integration_id")
      .eq("organization_id", organizationId)
      .eq("platform_name", "quickbooks")
      .eq("platform_org_id", realmId)
      .limit(1)
      .maybeSingle();
    if (realmOrg?.platform_integration_id) {
      const { data: ownerIntegration } = await supabase
        .from("platform_integrations")
        .select("*")
        .eq("id", realmOrg.platform_integration_id)
        .eq("is_connected", true)
        .maybeSingle();
      integration = ownerIntegration || null;
    }
    if (!integration) {
      const { data: fallbackIntegration } = await supabase
        .from("platform_integrations")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("platform_name", "quickbooks")
        .eq("is_connected", true)
        .limit(1)
        .maybeSingle();
      integration = fallbackIntegration || null;
    }
    if (!integration) {
      return jsonResponse(
        {
          success: false,
          error: "No connected QuickBooks account found. Please connect QuickBooks in Settings > Accounting Integrations.",
        },
        404,
      );
    }

    // Obtain a valid access token (refresh if expired).
    let accessToken = integration.access_token as string | null;
    if (!accessToken || isTokenExpired(integration.token_expires_at)) {
      const refresh = await refreshAccessToken(supabase, integration);
      if (refresh.error || !refresh.accessToken) {
        return jsonResponse({ success: false, error: refresh.error || "QuickBooks auth failed" }, 401);
      }
      accessToken = refresh.accessToken;
    }

    // Resolve which QBO API host (production vs sandbox) this connection's
    // token is authorised for. A wrong host → 403 ApplicationAuthorizationFailed.
    const base = await resolveQboBase(accessToken!, realmId);
    if (!base) {
      return jsonResponse(
        {
          success: false,
          error: "QuickBooks rejected the request (403). The connection is not authorised for this company — reconnect QuickBooks in Settings > Accounting Integrations, ensuring accounting access is granted.",
        },
        403,
      );
    }

    // Find or create the supplier (Vendor).
    const vendorName = invoice.vendor_name || invoice.customer_name || "Unknown Vendor";
    const vendorDetails: VendorDetails = {
      address: dbInvoice.vendor_address || null,
      phone: dbInvoice.vendor_phone || null,
      email: dbInvoice.vendor_email || null,
    };
    const { vendorId, error: vendorError } = await findOrCreateVendor(base, accessToken!, realmId, vendorName, vendorDetails);
    if (vendorError || !vendorId) {
      return jsonResponse({ success: false, error: vendorError || "Failed to resolve vendor" }, 400);
    }

    // Fetch the company's accounts once — used to (a) supply a default
    // expense account for any unmapped line and (b) validate the account each
    // line is mapped to. A QBO Bill detail line REQUIRES an account, and QBO
    // rejects Accounts Payable / Accounts Receivable accounts on a bill line
    // ("You can't use an Accounts Payable account on the detail portion").
    const accountById = new Map<string, { type: string; name: string }>();
    let defaultExpenseAccountId: string | null = null;
    try {
      const qr = await qboQuery(
        base,
        accessToken!,
        realmId,
        "select * from Account where Active = true maxresults 1000",
      );
      for (const a of (qr.Account || []) as any[]) {
        accountById.set(String(a.Id), { type: a.AccountType || "", name: a.Name || "" });
        if (!defaultExpenseAccountId && a.AccountType === "Expense") {
          defaultExpenseAccountId = String(a.Id);
        }
      }
    } catch (e) {
      console.warn("[quickbooks] account lookup failed:", e);
    }

    // Tax handling: Only apply tax if line items have tax_amount > 0 (manually set by user).
    // By default, NO tax is sent to QuickBooks. User must manually set tax on line items.
    const hasAnyLineTax = (invoice.line_items || []).some(li => (Number(li.tax_amount) || 0) > 0);

    let taxCodeId: string | null = null;
    if (hasAnyLineTax) {
      // Only look for tax code if at least one line has tax
      const invoiceNet = Number(invoice.subtotal) ||
        ((Number(invoice.total_amount) || 0) - (Number(invoice.tax) || 0));
      const targetTaxRate = invoiceNet > 0 && Number(invoice.tax) > 0
        ? Math.round((Number(invoice.tax) / invoiceNet) * 100)
        : 20; // Default to 20% VAT if we have line tax but no invoice-level tax
      taxCodeId = await findQboPurchaseTaxCode(base, accessToken!, realmId, targetTaxRate);
      console.log(`[quickbooks] Line items have tax, found tax code: ${taxCodeId}`);
    } else {
      console.log("[quickbooks] No tax on line items - bill will be created without tax");
    }

    // A QBO Bill detail line cannot post to an Accounts Payable / Receivable
    // account — those are the bill's own liability side / a customer account.
    const isBillLineAccountInvalid = (type: string) =>
      /accounts\s+(payable|receivable)/i.test(type);

    // Build the Bill lines, collecting any lines mapped to an invalid account.
    const billLines: any[] = [];
    const badLines: string[] = [];
    for (const li of invoice.line_items || []) {
      const accountId = li.platform_account_id || defaultExpenseAccountId;
      if (!accountId) {
        return jsonResponse(
          {
            success: false,
            error: "Each line needs an expense account, and no default expense account exists in QuickBooks. Map an account to each line.",
          },
          400,
        );
      }
      const acct = accountById.get(String(accountId));
      if (acct && isBillLineAccountInvalid(acct.type)) {
        badLines.push(`"${li.description || "item"}" → "${acct.name}" (${acct.type})`);
        continue;
      }
      const amount = Number(li.line_total) ||
        (Number(li.quantity) || 1) * (Number(li.unit_price) || 0);
      const lineDetail: Record<string, any> = { AccountRef: { value: accountId } };

      // Tax handling (like Xero): only apply tax code if this line has tax_amount > 0
      // This allows per-line tax control matching Xero's behavior
      const lineTax = Number(li.tax_amount) || 0;
      if (lineTax > 0 && taxCodeId) {
        lineDetail.TaxCodeRef = { value: taxCodeId };
      }
      // If no tax on this line, QBO will treat it as tax-exempt

      billLines.push({
        DetailType: "AccountBasedExpenseLineDetail",
        Amount: Number(amount.toFixed(2)),
        Description: li.description || "Item",
        AccountBasedExpenseLineDetail: lineDetail,
      });
    }
    if (badLines.length > 0) {
      return jsonResponse(
        {
          success: false,
          error: `QuickBooks does not allow an Accounts Payable or Accounts Receivable account on a bill line. Re-map ${badLines.length === 1 ? "this line" : "these lines"} to an expense account: ${badLines.join("; ")}.`,
        },
        400,
      );
    }
    if (billLines.length === 0) {
      return jsonResponse(
        { success: false, error: "At least one line item is required to create a bill in QuickBooks" },
        400,
      );
    }

    // Build the Bill payload.
    const billPayload: Record<string, any> = {
      VendorRef: { value: vendorId },
      TxnDate: formatDate(invoice.invoice_date),
      DueDate: formatDate(invoice.due_date),
      Line: billLines,
    };
    if (invoice.invoice_number && invoice.invoice_number.trim()) {
      billPayload.DocNumber = invoice.invoice_number.trim().slice(0, 21); // QBO DocNumber max 21
    }
    if (taxCodeId) {
      // Line amounts are net; QBO adds each line's tax code on top.
      billPayload.GlobalTaxCalculation = "TaxExcluded";
    }

    // If updating an existing bill, fetch it first to get the SyncToken (required for updates).
    let existingSyncToken: string | null = null;
    if (isUpdate && existingQbBillId) {
      try {
        const existingBillRes = await fetch(
          `${base}/v3/company/${realmId}/bill/${existingQbBillId}?minorversion=${MINOR_VERSION}`,
          {
            headers: {
              "Authorization": `Bearer ${accessToken}`,
              "Accept": "application/json",
            },
          }
        );
        if (existingBillRes.ok) {
          const existingBillData = await existingBillRes.json();
          existingSyncToken = existingBillData.Bill?.SyncToken || null;
          console.log(`[quickbooks] Fetched existing bill ${existingQbBillId}, SyncToken: ${existingSyncToken}`);
        } else {
          const errText = await existingBillRes.text();
          console.warn(`[quickbooks] Could not fetch existing bill ${existingQbBillId}: ${existingBillRes.status} - ${errText}`);
          // Bill might have been deleted in QBO — proceed to create a new one
        }
      } catch (fetchErr) {
        console.warn(`[quickbooks] Error fetching existing bill:`, fetchErr);
      }
    }

    // If we have an existing bill with SyncToken, include Id and SyncToken for update
    if (isUpdate && existingQbBillId && existingSyncToken) {
      billPayload.Id = existingQbBillId;
      billPayload.SyncToken = existingSyncToken;
      billPayload.sparse = true; // Sparse update — only update fields we provide
    }

    const postBill = () =>
      fetch(`${base}/v3/company/${realmId}/bill?minorversion=${MINOR_VERSION}`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        body: JSON.stringify(billPayload),
      });

    let billResponse = await postBill();
    // Defensive: if posting WITH tax fails, strip the tax fields and retry once,
    // so a tax-config problem falls back to the prior no-tax behaviour rather
    // than failing the whole share.
    if (!billResponse.ok && taxCodeId) {
      const peek = await billResponse.clone().text();
      console.warn(`[quickbooks] bill ${isUpdate ? 'update' : 'create'} with tax failed (${billResponse.status}); retrying without tax: ${peek.slice(0, 300)}`);
      for (const l of billPayload.Line as any[]) {
        if (l.AccountBasedExpenseLineDetail) delete l.AccountBasedExpenseLineDetail.TaxCodeRef;
      }
      delete billPayload.GlobalTaxCalculation;
      billResponse = await postBill();
    }
    if (!billResponse.ok) {
      const errText = await billResponse.text();
      console.error(`[quickbooks] Bill ${isUpdate ? 'update' : 'create'} failed: ${billResponse.status} - ${errText}`);
      return jsonResponse(
        { success: false, error: parseQboError(errText, billResponse.status) },
        400,
      );
    }
    const billData = await billResponse.json();
    const createdBill = billData.Bill;
    if (!createdBill?.Id) {
      return jsonResponse({ success: false, error: "QuickBooks returned an empty bill response" }, 500);
    }
    const qbBillId = String(createdBill.Id);
    const billTotal = Number(createdBill.TotalAmt) || invoice.total_amount;

    // Attach PDF to the bill (best-effort — does not block the response)
    let pdfAttachStatus = "skipped";
    try {
      pdfAttachStatus = await attachPdfToQuickBooks(base, accessToken!, realmId, qbBillId, dbInvoice, supabase);
      console.log(`[quickbooks] PDF attachment result: ${pdfAttachStatus}`);
    } catch (attachErr: any) {
      console.error("[quickbooks] PDF attachment error (non-fatal):", attachErr?.message || attachErr);
      pdfAttachStatus = `error:${attachErr?.message || "unknown"}`;
    }

    // When PAID, record a BillPayment against the chosen bank account.
    let paymentSucceeded = false;
    let paymentWarning: string | null = null;
    if (invoice.status === "PAID") {
      if (!bankAccountId) {
        paymentWarning = "Status is PAID but no bank account was selected — bill created unpaid.";
      } else {
        try {
          const paymentPayload = {
            VendorRef: { value: vendorId },
            TotalAmt: billTotal,
            PayType: "Check",
            CheckPayment: { BankAccountRef: { value: bankAccountId } },
            TxnDate: formatDate(invoice.invoice_date),
            Line: [
              {
                Amount: billTotal,
                LinkedTxn: [{ TxnId: qbBillId, TxnType: "Bill" }],
              },
            ],
          };
          const payRes = await fetch(
            `${base}/v3/company/${realmId}/billpayment?minorversion=${MINOR_VERSION}`,
            {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${accessToken}`,
                "Content-Type": "application/json",
                "Accept": "application/json",
              },
              body: JSON.stringify(paymentPayload),
            },
          );
          if (payRes.ok) {
            paymentSucceeded = true;
          } else {
            paymentWarning = parseQboError(await payRes.text(), payRes.status);
            console.error("[quickbooks] BillPayment failed:", paymentWarning);
          }
        } catch (payErr: any) {
          paymentWarning = payErr?.message || "BillPayment failed";
          console.error("[quickbooks] BillPayment error:", paymentWarning);
        }
      }
    }

    // Persist the QuickBooks bill id back onto the AP invoice.
    const updateData: Record<string, any> = {
      platform_invoice_id: qbBillId,
      platform_name: "quickbooks",
      platform_status: paymentSucceeded ? "PAID" : (invoice.status || "AUTHORISED"),
      is_from_platform: true,
      updated_at: new Date().toISOString(),
    };
    if (paymentSucceeded) {
      updateData.paid_at = new Date().toISOString();
      updateData.status = "paid";
      updateData.bank_account_id = bankAccountId;
    }
    await supabase.from("accounts_payable_invoice").update(updateData).eq("id", invoiceId);

    const actionVerb = isUpdate && existingSyncToken ? "updated" : "created";
    return jsonResponse({
      success: true,
      platformInvoiceId: qbBillId,
      quickbooksBillId: qbBillId,
      quickbooksDocNumber: createdBill.DocNumber || null,
      quickbooksCompany: companyName,
      paymentCreated: paymentSucceeded,
      isUpdate: isUpdate && !!existingSyncToken,
      pdfAttached: pdfAttachStatus === "ok",
      pdfAttachStatus: pdfAttachStatus,
      warning: paymentWarning || undefined,
      message: `Invoice ${actionVerb} in QuickBooks${companyName ? ` (${companyName})` : ""} as a bill`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[quickbooks] Unexpected error:", message);
    return jsonResponse({ success: false, error: "Internal server error", details: message }, 500);
  }
});
