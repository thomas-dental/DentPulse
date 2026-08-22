import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const XERO_API_BASE_URL = "https://api.xero.com/api.xro/2.0";
const XERO_IDENTITY_URL = "https://identity.xero.com/connect/token";

interface CreateInvoiceRequest {
  invoiceId: string;
  bankAccountId?: string; // Bank account GUID (coa_account_id from platform_integration_chart_of_accounts) for payment creation when status is PAID
  bankAccountCode?: string; // Account code fallback for live Xero lookup when cached UUID is stale
  action?: string; // Optional action: 'getBankAccounts' returns live Xero bank accounts without creating/updating invoice
  invoice?: {
    invoice_number: string;
    customer_name: string;
    vendor_name: string;
    currency: string;
    invoice_date: string;
    due_date: string;
    subtotal: number;
    tax: number;
    total_amount: number;
    account_code?: string; // Chart of Account code for Xero
    status?: string; // Platform status: DRAFT, SUBMITTED, AUTHORISED, PAID
    line_items: Array<{
      id?: string;
      description: string;
      quantity: number;
      unit_price: number;
      line_total: number;
      item?: string;
      account_code?: string;
    }>;
  };
}

interface XeroTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

// Refresh Xero access token using environment credentials.
//
// Uses the same platform_integrations.refresh_lock_at mutex as
// xero-refresh-token and the Node sync backend, so this user-triggered invoice
// push can't race a sync/initial-sync refresh and burn the rotating
// refresh_token (Xero rotates it on every refresh → a race causes
// invalid_grant → daily disconnect). Mirrors quickbooks-create-invoice.
async function refreshAccessToken(
  supabase: any,
  integration: any
): Promise<{ access_token: string | null; error: string | null }> {
  if (!integration.refresh_token) {
    return { access_token: null, error: "No refresh token available" };
  }

  const xeroClientId = Deno.env.get("XERO_CLIENT_ID");
  const xeroClientSecret = Deno.env.get("XERO_CLIENT_SECRET");

  if (!xeroClientId || !xeroClientSecret) {
    return { access_token: null, error: "Xero credentials not configured" };
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
  if (lockRes.error) console.error("[xero-create-invoice] lock acquire (free) error:", lockRes.error);
  let didAcquire = Array.isArray(lockRes.data) && lockRes.data.length > 0;
  if (!didAcquire) {
    lockRes = await supabase
      .from("platform_integrations")
      .update({ refresh_lock_at: nowIso })
      .eq("id", integration.id)
      .lt("refresh_lock_at", staleBefore)
      .select("id");
    if (lockRes.error) console.error("[xero-create-invoice] lock acquire (stale) error:", lockRes.error);
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
      return { access_token: freshRow.access_token, error: null };
    }
    return { access_token: null, error: "Xero token refresh is in progress — please retry." };
  }

  try {
    // Re-read for the latest refresh_token (it may have rotated before we locked).
    const { data: locked } = await supabase
      .from("platform_integrations")
      .select("refresh_token, access_token, token_expires_at")
      .eq("id", integration.id)
      .single();
    if (locked?.access_token && !isTokenExpired(locked.token_expires_at)) {
      return { access_token: locked.access_token, error: null };
    }
    const refreshToken = locked?.refresh_token || integration.refresh_token;

    const credentials = btoa(`${xeroClientId}:${xeroClientSecret}`);

    const response = await fetch(XERO_IDENTITY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": `Basic ${credentials}`,
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }).toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Token refresh failed:", errorText);
      return { access_token: null, error: `Token refresh failed: ${response.status}` };
    }

    const tokenData: XeroTokenResponse = await response.json();
    const tokenExpiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

    // Update credentials in database
    const { error: updateError } = await supabase
      .from("platform_integrations")
      .update({
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        token_expires_at: tokenExpiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq("id", integration.id);

    if (updateError) {
      console.error("Failed to save refreshed tokens:", updateError);
      return { access_token: null, error: "Failed to save refreshed tokens" };
    }

    return { access_token: tokenData.access_token, error: null };
  } catch (error: any) {
    console.error("Token refresh error:", error);
    return { access_token: null, error: error.message || "Token refresh failed" };
  } finally {
    // Always release the lock we hold.
    await supabase
      .from("platform_integrations")
      .update({ refresh_lock_at: null })
      .eq("id", integration.id);
  }
}

// Check if token is expired
function isTokenExpired(tokenExpiresAt: string | null): boolean {
  if (!tokenExpiresAt) return true;
  const expiresAt = new Date(tokenExpiresAt);
  return new Date() >= new Date(expiresAt.getTime() - 5 * 60 * 1000); // 5 min buffer
}

// Get Xero tenant ID based on location mapping
async function getXeroTenantId(
  supabase: any,
  organizationId: string,
  locationId: string | null
): Promise<{ tenantId: string | null; xeroOrgName: string | null; integrationId: string | null }> {
  // If we have a location_id, find the mapped Xero organization for that location
  if (locationId) {
    const { data: mappingData } = await supabase
      .from("platform_integration_organization_mapping")
      .select(`
        platform_integration_id,
        platform_integration_organizations_id,
        platform_integration_organizations!inner (
          id,
          platform_integration_id,
          platform_org_id,
          platform_org_name,
          platform_name
        )
      `)
      .eq("location_id", locationId)
      .eq("organization_id", organizationId);

    if (mappingData && mappingData.length > 0) {
      const xeroMapping = mappingData.find(
        (m: any) => m.platform_integration_organizations?.platform_name === "xero"
      );

      if (xeroMapping?.platform_integration_organizations) {
        const xeroOrg = xeroMapping.platform_integration_organizations;
        return {
          tenantId: xeroOrg.platform_org_id,
          xeroOrgName: xeroOrg.platform_org_name,
          integrationId: xeroMapping.platform_integration_id || xeroOrg.platform_integration_id || null
        };
      }
    }
  }

  // Fallback: Try to find any mapping for this organization
  const { data: anyMapping } = await supabase
    .from("platform_integration_organization_mapping")
    .select(`
      platform_integration_id,
      platform_integration_organizations_id,
      platform_integration_organizations!inner (
        id,
        platform_integration_id,
        platform_org_id,
        platform_org_name,
        platform_name
      )
    `)
    .eq("organization_id", organizationId);

  if (anyMapping && anyMapping.length > 0) {
    const xeroMapping = anyMapping.find(
      (m: any) => m.platform_integration_organizations?.platform_name === "xero"
    );

    if (xeroMapping?.platform_integration_organizations) {
      const xeroOrg = xeroMapping.platform_integration_organizations;
      return {
        tenantId: xeroOrg.platform_org_id,
        xeroOrgName: xeroOrg.platform_org_name,
        integrationId: xeroMapping.platform_integration_id || xeroOrg.platform_integration_id || null
      };
    }
  }

  // Last fallback: get first active Xero organization
  const { data: firstOrg } = await supabase
    .from("platform_integration_organizations")
    .select("platform_integration_id, platform_org_id, platform_org_name")
    .eq("organization_id", organizationId)
    .eq("platform_name", "xero")
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  return {
    tenantId: firstOrg?.platform_org_id || null,
    xeroOrgName: firstOrg?.platform_org_name || null,
    integrationId: firstOrg?.platform_integration_id || null
  };
}

// Sanitize contact name for Xero (remove problematic characters)
function sanitizeContactName(name: string): string {
  // Trim whitespace and normalize multiple spaces
  let sanitized = name.trim().replace(/\s+/g, ' ');
  // Remove characters that Xero doesn't allow in contact names
  // Xero allows alphanumeric, spaces, and common punctuation
  sanitized = sanitized.replace(/[<>]/g, '');
  // Limit length (Xero max is 255 characters)
  if (sanitized.length > 255) {
    sanitized = sanitized.substring(0, 255);
  }
  return sanitized || 'Unknown Vendor';
}

// Attach the invoice PDF to an existing Xero bill. Returns a status string for logging.
async function attachPdfToXero(
  accessToken: string,
  tenantId: string,
  xeroInvoiceId: string,
  dbInvoice: any,
  supabase: any
): Promise<string> {
  const BACKEND_URL = Deno.env.get("BACKEND_URL") ?? "https://dent-enterprise-api.dentpulse.com";
  const directPath = dbInvoice.pdf_path || dbInvoice.invoice_pdf_url;
  console.log(`[xero] PDF attachment — pdf_path=${dbInvoice.pdf_path}, invoice_pdf_url=${dbInvoice.invoice_pdf_url}`);
  if (!directPath) {
    console.log("[xero] No PDF path on invoice — skipping attachment");
    return "skipped:no_path";
  }

  let pdfUrl: string | null = null;
  let fileName = "invoice.pdf";

  if (directPath.startsWith("http")) {
    pdfUrl = directPath;
    fileName = directPath.split("/").pop() || "invoice.pdf";
  } else if (directPath.startsWith("AP-Invoices/")) {
    fileName = directPath.split("/").pop() || "invoice.pdf";
    pdfUrl = `${BACKEND_URL}/api/inbound-email-webhook/view-pdf/${fileName}`;
  } else if (dbInvoice.source === "email") {
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

  if (!pdfUrl) {
    console.log("[xero] Could not resolve PDF URL — skipping attachment");
    return "skipped:no_url";
  }

  if (!fileName.toLowerCase().endsWith(".pdf")) fileName += ".pdf";

  console.log(`[xero] Fetching PDF for attachment: ${pdfUrl}`);
  try {
    const pdfResponse = await fetch(pdfUrl);
    if (!pdfResponse.ok) {
      const msg = `fetch_failed:${pdfResponse.status}`;
      console.error(`[xero] ❌ Failed to fetch PDF (${pdfUrl}): ${pdfResponse.status}`);
      return msg;
    }
    const pdfBuffer = await pdfResponse.arrayBuffer();
    console.log(`[xero] PDF fetched, size=${pdfBuffer.byteLength}, uploading to Xero...`);

    const attachResponse = await fetch(
      `${XERO_API_BASE_URL}/Invoices/${xeroInvoiceId}/Attachments/${encodeURIComponent(fileName)}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Xero-tenant-id": tenantId,
          "Content-Type": "application/pdf",
        },
        body: pdfBuffer,
      }
    );

    if (attachResponse.ok) {
      console.log(`[xero] ✅ PDF attached to Xero bill: ${fileName}`);
      return "ok";
    } else {
      const err = await attachResponse.text();
      console.error(`[xero] ❌ PDF attachment failed: ${attachResponse.status} - ${err}`);
      return `xero_error:${attachResponse.status}`;
    }
  } catch (e: any) {
    console.error("[xero] ❌ PDF attachment error:", e?.message || e);
    return `exception:${e?.message}`;
  }
}

// Parse a free-text address string into a Xero POBOX address object.
// Uses AddressLine1-4 so every part renders on its own line in Xero bills.
function buildXeroAddress(vendorAddress: string): Record<string, string> {
  const parts = vendorAddress.split(/\n|,\s*/).map((p: string) => p.trim()).filter(Boolean);
  const addr: Record<string, string> = { AddressType: "POBOX" };
  parts.slice(0, 4).forEach((part, i) => {
    addr[`AddressLine${i + 1}`] = part;
  });
  return addr;
}

// Update an existing Xero contact with address / phone / email (best-effort)
async function updateContactDetails(
  accessToken: string,
  tenantId: string,
  contactId: string,
  vendorAddress?: string | null,
  vendorPhone?: string | null,
  vendorEmail?: string | null
): Promise<void> {
  if (!vendorAddress && !vendorPhone && !vendorEmail) return;

  const update: Record<string, unknown> = { ContactID: contactId };

  if (vendorAddress) {
    update.Addresses = [buildXeroAddress(vendorAddress)];
  }
  if (vendorEmail) update.EmailAddress = vendorEmail;
  if (vendorPhone) update.Phones = [{ PhoneType: "DEFAULT", PhoneNumber: vendorPhone }];

  try {
    const res = await fetch(`${XERO_API_BASE_URL}/Contacts/${contactId}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Xero-tenant-id": tenantId,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ Contacts: [update] }),
    });
    if (res.ok) {
      console.log(`[xero] ✅ Contact ${contactId} updated with address/phone/email`);
    } else {
      const err = await res.text();
      console.error(`[xero] ❌ Contact update failed: ${res.status} - ${err}`);
    }
  } catch (e: any) {
    console.error("[xero] ❌ Contact update error:", e?.message || e);
  }
}

// Find or create a Xero contact by name
async function findOrCreateContact(
  accessToken: string,
  tenantId: string,
  contactName: string,
  vendorAddress?: string | null,
  vendorPhone?: string | null,
  vendorEmail?: string | null
): Promise<{ contactId: string | null; error: string | null }> {
  if (!contactName) {
    return { contactId: null, error: "Contact name is required" };
  }

  // Sanitize the contact name
  const sanitizedName = sanitizeContactName(contactName);
  console.log(`[xero] Finding/creating contact: "${sanitizedName}" (original: "${contactName}")`);

  try {
    // First, test basic Contacts API access
    console.log(`[xero] Testing Contacts API access...`);
    const testContactsResponse = await fetch(`${XERO_API_BASE_URL}/Contacts?page=1&pageSize=1`, {
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Xero-tenant-id": tenantId,
        "Accept": "application/json",
      },
    });

    if (!testContactsResponse.ok) {
      const testErr = await testContactsResponse.text();
      console.error(`[xero] Contacts API NOT accessible: ${testContactsResponse.status} - ${testErr}`);
      console.error(`[xero] This is likely a Xero app scope issue. Ensure OAuth includes accounting.contacts (and invoice scopes such as accounting.invoices), then reconnect Xero.`);
      console.error(`[xero] Or the Xero organization may be a trial/demo with restricted API access.`);

      // Try Invoices endpoint to compare
      const testInvoicesResponse = await fetch(`${XERO_API_BASE_URL}/Invoices?page=1&pageSize=1`, {
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Xero-tenant-id": tenantId,
          "Accept": "application/json",
        },
      });
      console.log(`[xero] Invoices API test: ${testInvoicesResponse.status}`);

      return {
        contactId: null,
        error: `Xero Contacts API returned ${testContactsResponse.status}. Check the Xero Developer Portal app scopes match your OAuth request (e.g. accounting.contacts, accounting.invoices), then disconnect and reconnect Xero.`
      };
    }
    console.log(`[xero] Contacts API accessible ✓`);

    // Search for existing contact by name
    const whereClause = `Name=="${sanitizedName}"`;
    const searchUrl = `${XERO_API_BASE_URL}/Contacts?where=${encodeURIComponent(whereClause)}`;
    console.log(`[xero] Searching for contact: ${whereClause}`);

    const searchResponse = await fetch(searchUrl, {
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Xero-tenant-id": tenantId,
        "Accept": "application/json",
      },
    });

    if (searchResponse.ok) {
      const searchData = await searchResponse.json();
      if (searchData.Contacts && searchData.Contacts.length > 0) {
        const existingContact = searchData.Contacts[0];
        console.log(`[xero] Found existing contact: ${existingContact.ContactID}`);
        await updateContactDetails(accessToken, tenantId, existingContact.ContactID, vendorAddress, vendorPhone, vendorEmail);
        return { contactId: existingContact.ContactID, error: null };
      }
    } else {
      const searchErr = await searchResponse.text();
      console.log(`[xero] Filtered search failed with status ${searchResponse.status}: ${searchErr}`);
    }

    // Try contains search if exact match fails
    const containsClause = `Name.Contains("${sanitizedName.substring(0, 50)}")`;
    const containsSearchUrl = `${XERO_API_BASE_URL}/Contacts?where=${encodeURIComponent(containsClause)}`;
    const containsResponse = await fetch(containsSearchUrl, {
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Xero-tenant-id": tenantId,
        "Accept": "application/json",
      },
    });

    if (containsResponse.ok) {
      const containsData = await containsResponse.json();
      if (containsData.Contacts && containsData.Contacts.length > 0) {
        // Find best match (case-insensitive)
        const exactMatch = containsData.Contacts.find(
          (c: any) => c.Name.toLowerCase() === sanitizedName.toLowerCase()
        );
        if (exactMatch) {
          console.log(`[xero] Found contact via contains search: ${exactMatch.ContactID}`);
          await updateContactDetails(accessToken, tenantId, exactMatch.ContactID, vendorAddress, vendorPhone, vendorEmail);
          return { contactId: exactMatch.ContactID, error: null };
        }
      }
    }

    // Contact not found, create new one
    console.log(`[xero] Contact not found, creating new contact: "${sanitizedName}"`);

    // Build addresses array from vendor address string if available
    const xeroContact: Record<string, unknown> = { Name: sanitizedName };
    if (vendorAddress) {
      xeroContact.Addresses = [buildXeroAddress(vendorAddress)];  // POBOX = billing address
    }
    if (vendorEmail) {
      xeroContact.EmailAddress = vendorEmail;
    }
    if (vendorPhone) {
      xeroContact.Phones = [{ PhoneType: "DEFAULT", PhoneNumber: vendorPhone }];
    }

    const createResponse = await fetch(`${XERO_API_BASE_URL}/Contacts`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Xero-tenant-id": tenantId,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        Contacts: [xeroContact],
      }),
    });

    if (!createResponse.ok) {
      // Get the actual error from Xero
      const errorText = await createResponse.text();
      console.error(`[xero] Failed to create contact. Status: ${createResponse.status}, Error: ${errorText}`);

      // If 403, it might be a duplicate or permission issue
      if (createResponse.status === 403) {
        console.log(`[xero] 403 error - checking if contact exists with different casing...`);
        // Try one more search with just the first word
        const firstName = sanitizedName.split(' ')[0];
        const fallbackClause = `Name.StartsWith("${firstName}")`;
        const fallbackUrl = `${XERO_API_BASE_URL}/Contacts?where=${encodeURIComponent(fallbackClause)}`;
        const fallbackResponse = await fetch(fallbackUrl, {
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Xero-tenant-id": tenantId,
            "Accept": "application/json",
          },
        });

        if (fallbackResponse.ok) {
          const fallbackData = await fallbackResponse.json();
          if (fallbackData.Contacts && fallbackData.Contacts.length > 0) {
            // Use the first matching contact
            console.log(`[xero] Found similar contact via fallback: ${fallbackData.Contacts[0].ContactID} (${fallbackData.Contacts[0].Name})`);
            return { contactId: fallbackData.Contacts[0].ContactID, error: null };
          }
        }

        return { contactId: null, error: `Contact creation blocked (403). This may be a permission issue or the contact may already exist with different formatting. Error: ${errorText}` };
      }

      if (createResponse.status === 401) {
        return { contactId: null, error: `Xero authorization expired. Please reconnect your Xero account in Settings > Accounting Integrations.` };
      }

      return { contactId: null, error: `Failed to create contact: ${createResponse.status} - ${errorText}` };
    }

    const createData = await createResponse.json();
    if (createData.Contacts && createData.Contacts.length > 0) {
      console.log(`[xero] Successfully created contact: ${createData.Contacts[0].ContactID}`);
      return { contactId: createData.Contacts[0].ContactID, error: null };
    }

    return { contactId: null, error: "Failed to create contact - no data returned" };
  } catch (error: any) {
    console.error(`[xero] Contact operation error:`, error);
    return { contactId: null, error: error.message || "Contact operation failed" };
  }
}

// Format date for Xero (YYYY-MM-DD)
function formatDateForXero(dateStr: string | null): string {
  if (!dateStr) {
    return new Date().toISOString().split("T")[0];
  }
  try {
    const date = new Date(dateStr);
    return date.toISOString().split("T")[0];
  } catch {
    return new Date().toISOString().split("T")[0];
  }
}

// Normalize a line item description into a valid Xero ItemCode.
// Xero codes: alphanumeric + hyphen, max 30 chars, must be unique per org.
function descriptionToItemCode(description: string): string {
  return description
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 30)
    .replace(/-+$/, '');
}

// For each line item that lacks a stored xero_item_id, check Xero for an
// existing item with that code (by fetching all items once) and create it if
// missing. Saves both xero_item_code (slug) and xero_item_id (Xero UUID) to
// the DB row so subsequent sends are instant.
// Returns a map of line_item_id → { itemId: string; itemCode: string }.
async function ensureXeroItemsForLineItems(
  accessToken: string,
  tenantId: string,
  supabase: any,
  lineItems: Array<{ id?: string; description: string }>,
): Promise<Map<string, { itemId: string; itemCode: string }>> {
  const result = new Map<string, { itemId: string; itemCode: string }>();
  const lineItemIds = lineItems.map((i) => i.id).filter(Boolean) as string[];
  if (lineItemIds.length === 0) return result;

  // 1. Read stored xero_item_id from DB (skip Xero API for already-synced items)
  const { data: dbRows } = await supabase
    .from("accounts_payable_invoice_line_item")
    .select("id, xero_item_id, xero_item_code")
    .in("id", lineItemIds);

  const alreadyHaveId = new Set<string>();
  for (const row of dbRows || []) {
    if (row.xero_item_id) {
      result.set(row.id, { itemId: row.xero_item_id, itemCode: row.xero_item_code ?? "" });
      alreadyHaveId.add(row.id);
    }
  }

  // 2. Items that still need a Xero item
  const needsItem = lineItems.filter(
    (i) => i.id && !alreadyHaveId.has(i.id) && i.description?.trim(),
  );
  if (needsItem.length === 0) return result;

  // 3. Fetch all existing Xero items once — build lookup: normalised-code → { ItemID, Code }
  const xeroItemsResp = await fetch(`${XERO_API_BASE_URL}/Items`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Xero-tenant-id": tenantId,
      Accept: "application/json",
    },
  });
  const xeroItemsData = xeroItemsResp.ok ? await xeroItemsResp.json() : { Items: [] };
  const existingItems = new Map<string, { ItemID: string; Code: string }>();
  for (const xi of xeroItemsData.Items || []) {
    if (xi.Code && xi.ItemID) {
      existingItems.set(xi.Code.toLowerCase(), { ItemID: xi.ItemID, Code: xi.Code });
    }
  }

  // 4. For each item needing a Xero item: reuse existing or create new
  for (const item of needsItem) {
    const code = descriptionToItemCode(item.description);
    if (!code) continue;

    let xeroItemId: string;
    let xeroItemCode: string;

    if (existingItems.has(code)) {
      const existing = existingItems.get(code)!;
      xeroItemId = existing.ItemID;
      xeroItemCode = existing.Code;
      console.log(`[xero] Reusing existing item: ${xeroItemCode} (${xeroItemId}) for "${item.description}"`);
    } else {
      // Create new Xero item
      const createResp = await fetch(`${XERO_API_BASE_URL}/Items`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Xero-tenant-id": tenantId,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          Items: [{
            Code: code,
            Name: item.description.substring(0, 50),
            Description: item.description,
            IsPurchased: true,
          }],
        }),
      });

      if (!createResp.ok) {
        const err = await createResp.text();
        console.error(`[xero] Failed to create item "${code}": ${err}`);
        continue; // non-fatal — line item sent without item reference
      }

      const createData = await createResp.json();
      const created = createData.Items?.[0];
      if (!created?.ItemID) {
        console.error(`[xero] Xero item create response missing ItemID for "${code}"`);
        continue;
      }
      xeroItemId = created.ItemID;
      xeroItemCode = created.Code ?? code;
      existingItems.set(code, { ItemID: xeroItemId, Code: xeroItemCode }); // prevent duplicates within batch
      console.log(`[xero] Created Xero item: ${xeroItemCode} (${xeroItemId}) for "${item.description}"`);
    }

    // 5. Persist both ItemID (UUID) and Code (slug) to DB for future sends
    if (item.id) {
      await supabase
        .from("accounts_payable_invoice_line_item")
        .update({ xero_item_id: xeroItemId, xero_item_code: xeroItemCode })
        .eq("id", item.id);
      result.set(item.id, { itemId: xeroItemId, itemCode: xeroItemCode });
    }
  }

  return result;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ success: false, error: "Server configuration error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Parse request body
    let body: CreateInvoiceRequest;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid request body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { invoiceId, bankAccountId: rawBankAccountId, bankAccountCode, invoice, action } = body;
    let bankAccountId = rawBankAccountId;

    if (!invoiceId) {
      return new Response(
        JSON.stringify({ success: false, error: "invoiceId is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get the invoice from database to get organization_id and location_id
    const { data: dbInvoice, error: invoiceError } = await supabase
      .from("accounts_payable_invoice")
      .select("*")
      .eq("id", invoiceId)
      .single();

    if (invoiceError || !dbInvoice) {
      return new Response(
        JSON.stringify({ success: false, error: "Invoice not found", details: invoiceError?.message }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Prevent updating paid invoices
    if (dbInvoice.status === 'paid') {
      return new Response(
        JSON.stringify({ success: false, error: "Paid invoices cannot be updated or sent to Xero" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if this is an update (invoice already exists in Xero)
    let isUpdate = !!(dbInvoice.platform_invoice_id && dbInvoice.platform_name === "xero");
    let existingXeroInvoiceId = isUpdate ? dbInvoice.platform_invoice_id : null;

    if (isUpdate) {
      console.log(`[xero] Updating existing invoice in Xero: ${existingXeroInvoiceId}`);
    }

    const organizationId = dbInvoice.organization_id;
    const locationId = dbInvoice.location_id || null;

    // Resolve which Xero tenant to use based on location mapping
    const tenantResult = await getXeroTenantId(supabase, organizationId, locationId);

    // Find the CONNECTED integration that owns this tenant
    // Don't rely on mapping's integrationId — it may be stale
    // Instead, look up which connected integration has this tenant in platform_integration_organizations
    let integration: any = null;

    if (tenantResult.tenantId) {
      // Find the integration that owns this tenant
      const { data: tenantOrg } = await supabase
        .from("platform_integration_organizations")
        .select("platform_integration_id")
        .eq("organization_id", organizationId)
        .eq("platform_name", "xero")
        .eq("platform_org_id", tenantResult.tenantId)
        .limit(1)
        .maybeSingle();

      if (tenantOrg?.platform_integration_id) {
        const { data: ownerIntegration } = await supabase
          .from("platform_integrations")
          .select("*")
          .eq("id", tenantOrg.platform_integration_id)
          .eq("is_connected", true)
          .maybeSingle();

        if (ownerIntegration) {
          integration = ownerIntegration;
          console.log(`[xero] Found integration ${ownerIntegration.id} that owns tenant ${tenantResult.tenantId}`);
        }
      }
    }

    // Fallback: get any connected Xero integration
    if (!integration) {
      const { data: fallbackIntegration } = await supabase
        .from("platform_integrations")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("platform_name", "xero")
        .eq("is_connected", true)
        .limit(1)
        .maybeSingle();

      integration = fallbackIntegration;
      if (integration) {
        console.log(`[xero] Using fallback integration ${integration.id}`);
      }
    }

    if (!integration) {
      return new Response(
        JSON.stringify({ success: false, error: "No connected Xero account found. Please connect to Xero in Settings > Accounting Integrations." }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Always refresh the access token to ensure it's valid
    // Xero access tokens last 30 min but can be invalidated by re-auth
    if (!integration.refresh_token) {
      return new Response(
        JSON.stringify({ success: false, error: "Xero session expired. No refresh token available. Please reconnect your Xero account in Settings > Accounting Integrations." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[xero] Refreshing access token before API calls...");
    const refreshResult = await refreshAccessToken(supabase, integration);
    let accessToken: string;

    if (refreshResult.error || !refreshResult.access_token) {
      console.error("[xero] Token refresh failed:", refreshResult.error);
      // If refresh fails but we have an existing token, try it as last resort
      if (integration.access_token && !isTokenExpired(integration.token_expires_at)) {
        console.log("[xero] Using existing non-expired token as fallback");
        accessToken = integration.access_token;
      } else {
        return new Response(
          JSON.stringify({ success: false, error: "Xero token refresh failed. Please reconnect your Xero account in Settings > Accounting Integrations." }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } else {
      accessToken = refreshResult.access_token;
      console.log("[xero] Token refreshed successfully");
    }

    // Use the tenant ID already resolved from location mapping
    const { tenantId, xeroOrgName } = tenantResult;
    console.log(`[xero] Using integration: ${integration.id}, tenant: ${tenantId} (${xeroOrgName})`);

    // ── GET BANK ACCOUNTS (fast path) ────────────────────────────────────────────
    // Handle before health/connections checks — those gates are irrelevant for a read-only account list.
    if (action === "getBankAccounts") {
      if (!tenantId) {
        return new Response(
          JSON.stringify({ success: false, error: "No Xero organization mapped to this invoice's location" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      try {
        const xeroHeaders = {
          Authorization: `Bearer ${accessToken}`,
          "Xero-tenant-id": tenantId,
          Accept: "application/json",
        };

        // First try: active BANK accounts only
        console.log(`[xero] getBankAccounts: fetching BANK accounts for tenant ${tenantId}`);
        const activeFilter = encodeURIComponent(`Type=="BANK"&&Status=="ACTIVE"`);
        let acctResp = await fetch(`${XERO_API_BASE_URL}/Accounts?where=${activeFilter}`, { headers: xeroHeaders });
        console.log(`[xero] getBankAccounts: active BANK status ${acctResp.status}`);
        let acctData = acctResp.ok ? await acctResp.json() : null;
        let rawAccounts: any[] = acctData?.Accounts || [];

        // Fallback: any BANK accounts regardless of status (catches archived/inactive)
        if (rawAccounts.length === 0) {
          console.log(`[xero] getBankAccounts: no active BANK accounts — retrying without status filter`);
          const bankFilter = encodeURIComponent(`Type=="BANK"`);
          acctResp = await fetch(`${XERO_API_BASE_URL}/Accounts?where=${bankFilter}`, { headers: xeroHeaders });
          console.log(`[xero] getBankAccounts: any BANK status ${acctResp.status}`);
          acctData = acctResp.ok ? await acctResp.json() : null;
          rawAccounts = acctData?.Accounts || [];
        }

        if (rawAccounts.length === 0) {
          console.warn(`[xero] getBankAccounts: no BANK accounts found in Xero org — user must add one`);
        }

        const bankAccounts = rawAccounts.map((a: any) => ({
          coa_account_id: a.AccountID,
          coa_account_code: a.Code || null,
          coa_account_name: a.Name,
          coa_account_type: a.Type,
        }));
        console.log(`[xero] getBankAccounts: returning ${bankAccounts.length} bank accounts`);
        return new Response(
          JSON.stringify({ success: true, bankAccounts }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (e: any) {
        console.error("[xero] getBankAccounts exception:", e?.message);
        return new Response(
          JSON.stringify({ success: false, error: e?.message || "Failed to fetch bank accounts" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }
    // ── END GET BANK ACCOUNTS (fast path) ────────────────────────────────────────

    // Quick API health check - test if we can actually access this tenant
    const healthCheck = await fetch(`${XERO_API_BASE_URL}/Organisation`, {
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Xero-tenant-id": tenantId,
        "Accept": "application/json",
      },
    });
    if (!healthCheck.ok) {
      const healthError = await healthCheck.text();
      console.error(`[xero] Tenant health check FAILED: ${healthCheck.status} - ${healthError}`);

      if (healthCheck.status === 401 || healthCheck.status === 403) {
        return new Response(
          JSON.stringify({
            success: false,
            error: `Cannot access Xero organization "${xeroOrgName}". This may be a Demo Company (read-only) or the app needs re-authorization. Please disconnect and reconnect Xero, ensuring you grant access to all organizations.`,
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } else {
      const orgData = await healthCheck.json();
      const orgName = orgData?.Organisations?.[0]?.Name || 'Unknown';
      const orgType = orgData?.Organisations?.[0]?.OrganisationType || 'Unknown';
      const isDemoCompany = orgData?.Organisations?.[0]?.IsDemoCompany || false;
      console.log(`[xero] Tenant verified: ${orgName} (type: ${orgType}, isDemoCompany: ${isDemoCompany})`);

      if (isDemoCompany) {
        return new Response(
          JSON.stringify({
            success: false,
            error: `"${orgName}" is a Xero Demo Company. Demo companies are read-only and cannot receive invoices via API. Please map this location to a real Xero organization.`,
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    if (!tenantId) {
      return new Response(
        JSON.stringify({ success: false, error: "No Xero organization found. Please map a location to a Xero organization first." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify the tenant is accessible with this token before making API calls
    const connectionsResponse = await fetch("https://api.xero.com/connections", {
      headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" },
    });
    if (connectionsResponse.ok) {
      const authorizedTenants = await connectionsResponse.json();
      const authorizedIds = authorizedTenants.map((t: any) => t.tenantId);
      console.log(`[xero] Authorized tenants: ${JSON.stringify(authorizedIds)}, target: ${tenantId} (${xeroOrgName})`);

      if (!authorizedIds.includes(tenantId)) {
        // Target tenant not accessible — try to use the first authorized tenant instead
        console.warn(`[xero] Tenant ${tenantId} (${xeroOrgName}) not authorized. Available: ${authorizedIds.join(', ')}`);

        // Check if any authorized tenant is mapped to this location
        const authorizedTenantNames = authorizedTenants.map((t: any) => t.tenantName).join(', ');
        return new Response(
          JSON.stringify({
            success: false,
            error: `Location "${locationId}" is mapped to "${xeroOrgName}" but your Xero account only has access to: ${authorizedTenantNames}. Please update the mapping in Settings > Accounting Integrations > Configure Mapping.`
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }


    // If no Xero ID in DB but invoice has a number, search Xero for it — it may have been sent
    // previously without the ID being saved back. If found, switch to update mode and save the ID.
    if (!isUpdate && invoice.invoice_number?.trim()) {
      try {
        const searchResp = await fetch(
          `${XERO_API_BASE_URL}/Invoices?InvoiceNumbers=${encodeURIComponent(invoice.invoice_number.trim())}`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Xero-tenant-id": tenantId,
              Accept: "application/json",
            },
          }
        );
        if (searchResp.ok) {
          const searchData = await searchResp.json();
          const foundInXero = searchData.Invoices?.[0];
          if (foundInXero?.InvoiceID) {
            console.log(`[xero] Found existing invoice in Xero by number "${invoice.invoice_number}" — InvoiceID=${foundInXero.InvoiceID}. Switching to update mode.`);
            isUpdate = true;
            existingXeroInvoiceId = foundInXero.InvoiceID;
            // Persist to DB so future sends use the update path directly
            await supabase
              .from("accounts_payable_invoice")
              .update({ platform_invoice_id: foundInXero.InvoiceID, platform_name: "xero" })
              .eq("id", invoiceId);
          }
        }
      } catch (e: any) {
        console.warn(`[xero] InvoiceNumber lookup failed (non-fatal): ${e?.message}`);
      }
    }

    // COMMENTED OUT: Invoice status check before update
    // This was blocking updates to non-DRAFT invoices. Xero will return its own error if update fails.
    /*
    if (isUpdate && existingXeroInvoiceId) {
      console.log(`[xero] Checking existing invoice status before update: ${existingXeroInvoiceId}`);
      const checkResponse = await fetch(`${XERO_API_BASE_URL}/Invoices/${existingXeroInvoiceId}`, {
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Xero-tenant-id": tenantId,
          "Accept": "application/json",
        },
      });

      if (checkResponse.ok) {
        const checkData = await checkResponse.json();
        const xeroInvoice = checkData?.Invoices?.[0];
        const xeroStatus = xeroInvoice?.Status;
        console.log(`[xero] Existing invoice status in Xero: ${xeroStatus}`);

        // Only DRAFT invoices can be modified in Xero
        if (xeroStatus && xeroStatus !== 'DRAFT') {
          const statusMap: Record<string, string> = {
            'SUBMITTED': 'Awaiting Approval',
            'AUTHORISED': 'Approved/Awaiting Payment',
            'PAID': 'Paid',
            'VOIDED': 'Voided',
            'DELETED': 'Deleted',
          };
          const friendlyStatus = statusMap[xeroStatus] || xeroStatus;

          return new Response(
            JSON.stringify({
              success: false,
              error: `Cannot update invoice in Xero. The invoice is currently "${friendlyStatus}" status. Only Draft invoices can be modified. To make changes, you must void this invoice in Xero and create a new one.`,
              xeroStatus: xeroStatus,
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      } else {
        // Invoice not found in Xero - treat as new invoice
        console.log(`[xero] Invoice ${existingXeroInvoiceId} not found in Xero, will create new`);
      }
    }
    */
    
    // ── PAYMENT-ONLY FAST PATH ──
    // When an invoice is already AUTHORISED in Xero and we just need to mark it paid,
    // skip the invoice update entirely — updating disrupts AUTHORISED status and causes
    // "Payments can only be made against Authorised documents" from Xero.
    if (isUpdate && existingXeroInvoiceId && invoice.status === "PAID" && bankAccountId) {
      let paymentSucceeded = false;
      let paymentError: string | null = null;

      console.log(`[xero] Payment fast path: InvoiceID=${existingXeroInvoiceId}, AccountID=${bankAccountId}, Amount=${invoice.total_amount}, TenantID=${tenantId}`);

      // Validate the bank account exists in this Xero tenant before attempting payment.
      // If the cached UUID is stale (account from wrong tenant or deleted), fall back to
      // a live lookup by account code to find the correct current AccountID.
      try {
        const accountCheckResp = await fetch(`${XERO_API_BASE_URL}/Accounts/${bankAccountId}`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Xero-tenant-id": tenantId,
            Accept: "application/json",
          },
        });
        if (!accountCheckResp.ok) {
          console.warn(`[xero] Cached AccountID ${bankAccountId} not found in tenant ${tenantId}. Attempting code-based lookup...`);

          // Try to find the correct AccountID using the account code
          if (bankAccountCode) {
            const codeFilter = encodeURIComponent(`Type=="BANK"&&Code=="${bankAccountCode}"&&Status=="ACTIVE"`);
            const codeResp = await fetch(`${XERO_API_BASE_URL}/Accounts?where=${codeFilter}`, {
              headers: {
                Authorization: `Bearer ${accessToken}`,
                "Xero-tenant-id": tenantId,
                Accept: "application/json",
              },
            });
            if (codeResp.ok) {
              const codeData = await codeResp.json();
              const match = codeData?.Accounts?.[0];
              if (match?.AccountID) {
                console.log(`[xero] Code fallback found account: ${match.Name} (${match.AccountID})`);
                bankAccountId = match.AccountID;
              } else {
                paymentError = `Bank account with code "${bankAccountCode}" was not found in your Xero organisation. Please re-sync your accounts from Settings.`;
              }
            } else {
              paymentError = `The selected bank account was not found in your Xero organisation. Please re-sync your accounts and try again.`;
            }
          } else {
            paymentError = `The selected bank account (${bankAccountId}) was not found in your Xero organisation. Please re-sync your accounts and select a valid bank account.`;
          }
        } else {
          const accountData = await accountCheckResp.json();
          const account = accountData?.Accounts?.[0];
          console.log(`[xero] Bank account validated: ${account?.Name} (${account?.Type}, ${account?.Status})`);
          if (account?.Type !== "BANK") {
            paymentError = `The selected account "${account?.Name}" is not a bank account in Xero. Please select a bank account.`;
          }
        }
      } catch (e: any) {
        console.warn(`[xero] Bank account pre-check failed (non-fatal): ${e?.message}`);
        // Non-fatal — proceed; let Xero return the real error
      }

      // Ensure the Xero invoice is AUTHORISED before attempting payment.
      // Xero rejects payments against DRAFT invoices with "Payments can only be made against Authorised documents".
      if (!paymentError) {
        try {
          const invoiceCheckResp = await fetch(`${XERO_API_BASE_URL}/Invoices/${existingXeroInvoiceId}`, {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Xero-tenant-id": tenantId,
              Accept: "application/json",
            },
          });
          if (invoiceCheckResp.ok) {
            const invoiceCheckData = await invoiceCheckResp.json();
            const xeroInvoice = invoiceCheckData?.Invoices?.[0];
            const currentXeroStatus = xeroInvoice?.Status;
            console.log(`[xero] Current Xero invoice status: ${currentXeroStatus}`);

            if (currentXeroStatus === "DRAFT") {
              // Promote to AUTHORISED so payment can be applied
              console.log(`[xero] Promoting invoice ${existingXeroInvoiceId} from DRAFT to AUTHORISED`);
              const authoriseResp = await fetch(`${XERO_API_BASE_URL}/Invoices/${existingXeroInvoiceId}`, {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                  "Xero-tenant-id": tenantId,
                  "Content-Type": "application/json",
                  Accept: "application/json",
                },
                body: JSON.stringify({ Invoices: [{ InvoiceID: existingXeroInvoiceId, Status: "AUTHORISED" }] }),
              });
              if (!authoriseResp.ok) {
                const errText = await authoriseResp.text();
                console.error(`[xero] Failed to authorise invoice: ${errText}`);
                paymentError = "Could not authorise the invoice in Xero before payment. Please authorise it manually in Xero and try again.";
              } else {
                console.log(`[xero] Invoice promoted to AUTHORISED`);
              }
            } else if (currentXeroStatus === "PAID" || currentXeroStatus === "VOIDED" || currentXeroStatus === "DELETED") {
              paymentError = `Invoice is already ${currentXeroStatus.toLowerCase()} in Xero and cannot be paid again.`;
            }
          } else {
            console.warn(`[xero] Could not fetch invoice status (non-fatal), proceeding with payment attempt`);
          }
        } catch (e: any) {
          console.warn(`[xero] Invoice status check failed (non-fatal): ${e?.message}`);
        }
      }

      if (!paymentError) {
        try {
          const paymentDate = new Date().toISOString().split("T")[0];
          const paymentPayload = {
            Payments: [{
              Invoice: { InvoiceID: existingXeroInvoiceId },
              Account: { AccountID: bankAccountId },
              Date: paymentDate,
              Amount: invoice.total_amount,
            }],
          };
          const paymentResp = await fetch(`${XERO_API_BASE_URL}/Payments`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Xero-tenant-id": tenantId,
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify(paymentPayload),
          });
          if (paymentResp.ok) {
            paymentSucceeded = true;
          } else {
            const errText = await paymentResp.text();
            try {
              const j = JSON.parse(errText);
              paymentError = j?.Elements?.[0]?.ValidationErrors?.[0]?.Message || j?.Message || errText;
            } catch {
              paymentError = errText;
            }
          }
        } catch (e: any) {
          paymentError = e?.message || "Unknown payment error";
        }
      }

      const updateData: Record<string, any> = {
        platform_invoice_id: existingXeroInvoiceId,
        platform_name: "xero",
        updated_at: new Date().toISOString(),
      };
      if (paymentSucceeded) {
        updateData.platform_status = "PAID";
        updateData.paid_at = new Date().toISOString();
        updateData.status = "paid";
        updateData.bank_account_id = bankAccountId;
      } else {
        updateData.platform_status = "AUTHORISED";
      }
      await supabase.from("accounts_payable_invoice").update(updateData).eq("id", invoiceId);

      return new Response(
        JSON.stringify({
          success: true,
          platformInvoiceId: existingXeroInvoiceId,
          xeroInvoiceId: existingXeroInvoiceId,
          message: paymentSucceeded ? "Payment created successfully in Xero" : "Payment failed",
          paymentCreated: paymentSucceeded,
          paymentError: paymentError ?? undefined,
          wasUpdate: true,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    // ── END PAYMENT-ONLY FAST PATH ──

    // Find or create the contact (vendor)
    const contactName = invoice.vendor_name || invoice.customer_name || "Unknown Vendor";
    const vendorAddress = (invoice as any).vendor_address || null;
    const vendorPhone = (invoice as any).vendor_phone || null;
    const vendorEmail = (invoice as any).vendor_email || null;
    const { contactId, error: contactError } = await findOrCreateContact(accessToken, tenantId, contactName, vendorAddress, vendorPhone, vendorEmail);

    if (contactError || !contactId) {
      return new Response(
        JSON.stringify({ success: false, error: contactError || "Failed to find or create contact" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Ensure a Xero Item exists for every line item (create if missing, reuse if exists).
    // Stores xero_item_id + xero_item_code on the DB row so subsequent sends are instant.
    const xeroItemCodeMap = await ensureXeroItemsForLineItems(
      accessToken,
      tenantId,
      supabase,
      invoice.line_items.map((li) => ({ id: li.id, description: li.description || "Item" })),
    );

    // Build Xero line item payloads
    const xeroLineItems: Array<{
      Description: string;
      Quantity: number;
      UnitAmount: number;
      ItemCode?: string;
      AccountCode?: string;
      TaxType?: string;
    }> = [];

    for (let i = 0; i < invoice.line_items.length; i++) {
      const item = invoice.line_items[i];

      const lineItem: {
        Description: string;
        Quantity: number;
        UnitAmount: number;
        ItemCode?: string;
        AccountCode?: string;
        TaxType?: string;
      } = {
        Description: item.description || "Item",
        Quantity: item.quantity || 1,
        UnitAmount: item.unit_price || 0,
      };

      // Xero POST uses ItemCode (string) to link an item; ItemID only appears in GET responses
      const xeroItem = item.id ? xeroItemCodeMap.get(item.id) : undefined;
      if (xeroItem?.itemCode) {
        lineItem.ItemCode = xeroItem.itemCode;
      }

      // Only add AccountCode if provided (Xero will use default expense account if not specified)
      if (item.account_code) {
        lineItem.AccountCode = item.account_code;
      }

      // Tax: previously every line was hard-coded TaxType "NONE", which posted
      // the bill with ZERO VAT so its total didn't match the supplier invoice.
      // Now, when a line carries no tax we keep "NONE"; when it DOES carry tax we
      // leave TaxType unset so Xero applies the account's own default tax rate
      // (e.g. "20% VAT on Expenses"), with LineAmountTypes "Exclusive" adding the
      // tax on top. This makes the Xero total include VAT and match the invoice.
      const lineTax = Number((item as any).tax_amount) || 0;
      if (lineTax <= 0) {
        lineItem.TaxType = "NONE";
      }

      xeroLineItems.push(lineItem);
    }

    // If no line items, return error
    if (xeroLineItems.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "At least one line item is required to create an invoice in Xero",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Determine Xero status - valid values: DRAFT, SUBMITTED, AUTHORISED
    // Note: PAID status cannot be set directly when creating an invoice
    // We must create as AUTHORISED first, then add a payment
    let xeroStatus = invoice.status || "DRAFT";
    if (xeroStatus === "PAID") {
      xeroStatus = "AUTHORISED";
    }

    // Create the invoice (ACCPAY type for Accounts Payable) in Xero
    // Build the invoice object, only including fields with values
    const xeroInvoice: Record<string, any> = {
      Type: "ACCPAY", // Accounts Payable (bills/purchase invoices)
      Contact: {
        ContactID: contactId,
      },
      Date: formatDateForXero(invoice.invoice_date),
      DueDate: formatDateForXero(invoice.due_date),
      Status: xeroStatus,
      LineItems: xeroLineItems,
      LineAmountTypes: "Exclusive", // Amounts are exclusive of tax
    };

    // NOTE: CurrencyCode is NOT included - Xero will use the organization's base currency automatically
    // This avoids "Organisation is not subscribed to currency" errors

    // Only add InvoiceNumber if it has a value (Xero treats empty string as invalid)
    if (invoice.invoice_number && invoice.invoice_number.trim()) {
      xeroInvoice.InvoiceNumber = invoice.invoice_number.trim();
    }

    // Add Reference if we have a vendor name (helps identify the bill in Xero)
    if (invoice.vendor_name) {
      xeroInvoice.Reference = invoice.vendor_name;
    }

    // If updating an existing invoice: include InvoiceID, fetch the current Xero invoice to:
    //   1. Resolve LineItemIDs (required by Xero when the invoice has payments/credits allocated)
    //   2. Conditionally skip Status — only omit it when AmountPaid > 0 or Status is PAID,
    //      so normal status changes (DRAFT → AUTHORISED) still work.
    if (isUpdate && existingXeroInvoiceId) {
      xeroInvoice.InvoiceID = existingXeroInvoiceId;
      console.log(`[xero] Update mode — InvoiceID=${existingXeroInvoiceId}`);

      // Safe default: if GET fails assume payments exist so we don't send locked fields
      let hasPaymentsOrCredits = true;

      try {
        const existingResp = await fetch(`${XERO_API_BASE_URL}/Invoices/${existingXeroInvoiceId}`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Xero-tenant-id": tenantId,
            Accept: "application/json",
          },
        });

        if (existingResp.ok) {
          const existingData = await existingResp.json();
          const existingXeroInv = existingData.Invoices?.[0];
          const existingLineItems: any[] = existingXeroInv?.LineItems || [];
          console.log(`[xero] Fetched existing invoice — Status=${existingXeroInv?.Status}, AmountPaid=${existingXeroInv?.AmountPaid}, AmountCredited=${existingXeroInv?.AmountCredited}, lineItems=${existingLineItems.length}`);

          // Match by position (index) — reliable even when descriptions are duplicated
          for (let i = 0; i < xeroLineItems.length; i++) {
            const existingLineItemId = existingLineItems[i]?.LineItemID;
            if (existingLineItemId) {
              (xeroLineItems[i] as any).LineItemID = existingLineItemId;
            }
          }
          console.log(`[xero] Injected LineItemIDs into ${Math.min(xeroLineItems.length, existingLineItems.length)} line items`);

          const amountPaid = existingXeroInv?.AmountPaid ?? 0;
          const amountCredited = existingXeroInv?.AmountCredited ?? 0;
          const xeroIsPaid = existingXeroInv?.Status === "PAID";
          hasPaymentsOrCredits = amountPaid > 0 || amountCredited > 0 || xeroIsPaid;
        } else {
          const errText = await existingResp.text();
          console.error(`[xero] GET /Invoices/${existingXeroInvoiceId} failed: ${existingResp.status} — ${errText}. Assuming payments exist (safe fallback).`);
          // hasPaymentsOrCredits stays true (safe fallback)
        }
      } catch (e: any) {
        console.error(`[xero] Failed to fetch existing invoice for update resolution: ${e?.message}. Assuming payments exist (safe fallback).`);
        // hasPaymentsOrCredits stays true (safe fallback)
      }

      // Xero rejects Status, Date, and DueDate changes on invoices with payments/credits
      if (hasPaymentsOrCredits) {
        delete xeroInvoice.Status;
        delete xeroInvoice.Date;
        delete xeroInvoice.DueDate;
        console.log(`[xero] Skipping Status/Date/DueDate — invoice has payments/credits allocated`);
      }
    }

    // Build the full request payload
    const requestPayload = {
      Invoices: [xeroInvoice],
    };

    const createResponse = await fetch(`${XERO_API_BASE_URL}/Invoices`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Xero-tenant-id": tenantId,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(requestPayload),
    });

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      // Try to parse Xero error message - capture ALL validation errors
      const action = isUpdate ? "update" : "create";
      let errorMessage = `Failed to ${action} invoice in Xero: ${createResponse.status}`;
      const validationErrors: string[] = [];

      try {
        const errorJson = JSON.parse(errorText);

        // Collect all validation errors from Elements array
        if (errorJson.Elements && Array.isArray(errorJson.Elements)) {
          for (const element of errorJson.Elements) {
            if (element.ValidationErrors && Array.isArray(element.ValidationErrors)) {
              for (const validationError of element.ValidationErrors) {
                if (validationError.Message) {
                  validationErrors.push(validationError.Message);
                }
              }
            }
          }
        }

        // If we found validation errors, use them
        if (validationErrors.length > 0) {
          errorMessage = validationErrors.join('; ');
        } else if (errorJson.Message) {
          errorMessage = errorJson.Message;
        }
      } catch {
        // Use raw error text if parsing fails
        if (errorText.length < 500) {
          errorMessage = errorText;
        }
      }

      return new Response(
        JSON.stringify({
          success: false,
          error: errorMessage,
          validationErrors: validationErrors.length > 0 ? validationErrors : undefined,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const createData = await createResponse.json();

    if (!createData.Invoices || createData.Invoices.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: "Xero returned empty response" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const createdInvoice = createData.Invoices[0];

    // Check if the invoice has validation errors (Xero sometimes returns 200 with errors)
    if (createdInvoice.HasErrors || createdInvoice.ValidationErrors?.length > 0) {
      const validationErrors = createdInvoice.ValidationErrors?.map((e: any) => e.Message) || [];
      return new Response(
        JSON.stringify({
          success: false,
          error: validationErrors.length > 0 ? validationErrors.join('; ') : "Invoice has validation errors",
          validationErrors,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const xeroInvoiceId = createdInvoice.InvoiceID;

    // Attach original PDF to the Xero bill (best-effort — failure won't block the response)
    const pdfAttachStatus = await attachPdfToXero(accessToken, tenantId, xeroInvoiceId, dbInvoice, supabase);

    // Create payment if status is PAID
    let paymentSucceeded = false;
    let paymentError: string | null = null;

    if (invoice.status === "PAID" && bankAccountId) {
      try {
        // Use today as the payment date — invoice_date can be in a locked Xero period
        const paymentDate = new Date().toISOString().split("T")[0];
        const paymentPayload = {
          Payments: [
            {
              Invoice: { InvoiceID: xeroInvoiceId },
              Account: { AccountID: bankAccountId },
              Date: paymentDate,
              Amount: invoice.total_amount,
            },
          ],
        };

        console.log("[xero] Creating payment with payload:", JSON.stringify(paymentPayload));

        const paymentResponse = await fetch(`${XERO_API_BASE_URL}/Payments`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Xero-tenant-id": tenantId,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(paymentPayload),
        });

        if (paymentResponse.ok) {
          paymentSucceeded = true;
          console.log("[xero] ✅ Payment created successfully");
        } else {
          const errText = await paymentResponse.text();
          console.error(`[xero] ❌ Payment failed: ${paymentResponse.status} - ${errText}`);
          // Extract a readable message from Xero's error JSON if possible
          try {
            const errJson = JSON.parse(errText);
            paymentError = errJson?.Elements?.[0]?.ValidationErrors?.[0]?.Message
              || errJson?.Message
              || errText;
          } catch {
            paymentError = errText;
          }
        }
      } catch (paymentErr: any) {
        paymentError = paymentErr?.message || "Unknown payment error";
        console.error("[xero] ❌ Payment error:", paymentError);
      }
    } else if (invoice.status === "PAID" && !bankAccountId) {
      console.warn("[xero] Status is PAID but no bankAccountId provided - skipping payment creation");
      paymentError = "No bank account selected for payment";
    }

    // Update the accounts_payable_invoice with the platform invoice ID
    // If payment succeeded, update platform_status to PAID and set paid_at timestamp
    const updateData: Record<string, any> = {
      platform_invoice_id: xeroInvoiceId,
      platform_name: "xero",
      is_from_platform: true,
      updated_at: new Date().toISOString(),
    };

    if (paymentSucceeded) {
      updateData.platform_status = "PAID";
      updateData.paid_at = new Date().toISOString();
      updateData.status = "paid";
      updateData.bank_account_id = bankAccountId;
    } else {
      updateData.platform_status = xeroStatus;
    }

    await supabase
      .from("accounts_payable_invoice")
      .update(updateData)
      .eq("id", invoiceId);

    const actionText = isUpdate ? "updated" : "created";
    return new Response(
      JSON.stringify({
        success: true,
        platformInvoiceId: xeroInvoiceId,
        xeroInvoiceId,
        xeroInvoiceNumber: createdInvoice.InvoiceNumber,
        xeroOrganization: xeroOrgName,
        message: `Invoice ${actionText} successfully in Xero (${xeroOrgName})`,
        paymentCreated: paymentSucceeded,
        paymentError: paymentError ?? undefined,
        wasUpdate: isUpdate,
        pdfAttachStatus,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ success: false, error: "Internal server error", details: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
