import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  syncCanonicalFinanceFromXeroJournals,
  type XeroJournal,
} from "./canonicalFinanceFromXero.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const XERO_API_BASE_URL = "https://api.xero.com/api.xro/2.0";
const XERO_MAX_RETRIES = 5;
const XERO_BASE_BACKOFF_MS = 1_000;
const XERO_MAX_BACKOFF_MS = 15_000;
const XERO_TENANT_REQUEST_COOLDOWN_MS = 750;

interface XeroDataRequest {
  organization_id: string;
  endpoint: "profit-and-loss" | "balance-sheet" | "accounts" | "invoices" | "journals" | "all" | "sync-all" | "bank-accounts";
  from_date?: string;
  to_date?: string;
  filters?: Record<string, string>;
  save_to_db?: boolean; // Option to save invoices to database
  integration_id?: string; // Specific Xero connection ID (for multi-account support)
  tenant_ids?: string[]; // Specific tenant IDs to sync (for per-connection sync)
  /** When true with save_to_db, paginates Journals and materializes finance_journal_* (canonical). sync-all sets this implicitly. */
  materialize_canonical?: boolean;
  /** Optional Xero Tracking Category/Option IDs for location-scoped Reports API calls. */
  tracking_category_id?: string;
  tracking_option_id?: string;
}

interface XeroAccount {
  AccountID: string;
  Code: string;
  Name: string;
  Type: string;
  Status: string;
  Description?: string;
  TaxType?: string;
  EnablePaymentsToAccount?: boolean;
  ShowInExpenseClaims?: boolean;
  Class?: string;
  BankAccountNumber?: string;
  BankAccountType?: string;
  CurrencyCode?: string;
  ReportingCode?: string;
  ReportingCodeName?: string;
  UpdatedDateUTC?: string;
  SystemAccount?: string;
}

interface XeroOrganisation {
  OrganisationID: string;
  Name: string;
  LegalName?: string;
  ShortCode?: string;
  PaysTax?: boolean;
  Version?: string;
  OrganisationType?: string;
  BaseCurrency?: string;
  CountryCode?: string;
  IsDemoCompany?: boolean;
  OrganisationStatus?: string;
  TaxNumber?: string;
  FinancialYearEndDay?: number;
  FinancialYearEndMonth?: number;
  LineOfBusiness?: string;
  Addresses?: Array<{
    AddressType: string;
    AddressLine1?: string;
    AddressLine2?: string;
    City?: string;
    Region?: string;
    PostalCode?: string;
    Country?: string;
  }>;
  Phones?: Array<{
    PhoneType: string;
    PhoneNumber?: string;
    PhoneAreaCode?: string;
    PhoneCountryCode?: string;
  }>;
}

interface XeroInvoice {
  InvoiceID: string;
  InvoiceNumber: string;
  Type: string;
  Contact: {
    ContactID: string;
    Name: string;
  };
  Date: string;
  DueDate: string;
  Status: string;
  LineAmountTypes: string;
  SubTotal: number;
  TotalTax: number;
  Total: number;
  AmountDue: number;
  AmountPaid: number;
  CurrencyCode: string;
  UpdatedDateUTC: string;
  LineItems?: Array<{
    LineItemID: string;
    Description: string;
    Quantity: number;
    UnitAmount: number;
    AccountCode: string;
    AccountID?: string; // UUID of the account
    TaxType: string;
    TaxAmount: number;
    LineAmount: number;
    ItemCode?: string;
    Tracking?: Array<{ Name: string; Option: string }>;
  }>;
}

// Refresh Xero access token by delegating to the dedicated xero-refresh-token
// edge function. Centralising the refresh there gives us a single mutex
// (`platform_integrations.refresh_lock_at`) and a single retry policy — so
// concurrent calls from multiple pages can't each burn the rotating
// refresh_token and invalidate the chain.
async function refreshAccessToken(
  _supabase: any,
  integration: { id: string }
): Promise<{ access_token: string | null; error: string | null }> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseServiceKey) {
    return { access_token: null, error: "Server configuration error" };
  }

  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/xero-refresh-token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${supabaseServiceKey}`,
      },
      body: JSON.stringify({ integrationId: integration.id }),
    });

    const data = await response.json().catch(() => null);

    if (!response.ok || !data?.access_token) {
      const errMsg = data?.error || data?.details || `Refresh failed: HTTP ${response.status}`;
      console.error("[xero-data] xero-refresh-token rejected:", errMsg);
      return { access_token: null, error: errMsg };
    }

    return { access_token: data.access_token, error: null };
  } catch (error: any) {
    console.error("[xero-data] Token refresh delegation error:", error);
    return { access_token: null, error: error.message || "Token refresh failed" };
  }
}

// Check if token is expired
function isTokenExpired(tokenExpiresAt: string | null): boolean {
  if (!tokenExpiresAt) return true;
  const expiresAt = new Date(tokenExpiresAt);
  return new Date() >= new Date(expiresAt.getTime() - 5 * 60 * 1000); // 5 min buffer
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

// Make Xero API request
async function makeXeroRequest(
  accessToken: string,
  tenantId: string,
  endpoint: string,
  params?: URLSearchParams
): Promise<{ success: boolean; data?: any; error?: string; status?: number }> {
  let url = `${XERO_API_BASE_URL}/${endpoint}`;
  if (params && params.toString()) {
    url += `?${params.toString()}`;
  }

  console.log(`Making Xero request to: ${url}`);

  const getRetryDelayMs = (response: Response, attempt: number): number => {
    const retryAfter = response.headers.get("retry-after");
    if (retryAfter) {
      const parsedSeconds = Number.parseInt(retryAfter, 10);
      if (Number.isFinite(parsedSeconds) && parsedSeconds >= 0) {
        return parsedSeconds * 1000;
      }
    }
    const exponential = Math.min(XERO_BASE_BACKOFF_MS * (2 ** attempt), XERO_MAX_BACKOFF_MS);
    const jitter = Math.floor(Math.random() * 250);
    return exponential + jitter;
  };

  for (let attempt = 0; attempt <= XERO_MAX_RETRIES; attempt++) {
    const response = await fetch(url, {
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Xero-tenant-id": tenantId,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
    });

    if (response.ok) {
      const data = await response.json();
      return { success: true, data, status: response.status };
    }

    const errorText = await response.text();
    const isRetryable = response.status === 429 || response.status >= 500;
    if (isRetryable && attempt < XERO_MAX_RETRIES) {
      const delayMs = getRetryDelayMs(response, attempt);
      console.warn(
        `[xero-data] Retryable Xero API error (${endpoint}) status=${response.status} ` +
          `attempt=${attempt + 1}/${XERO_MAX_RETRIES} delayMs=${delayMs}`
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      continue;
    }

    console.error(`Xero API error (${endpoint}):`, response.status, errorText);
    return { success: false, error: `Xero API error: ${response.status}`, status: response.status };
  }

  return { success: false, error: "Xero API error: retry attempts exhausted", status: 429 };
}

/**
 * Paginated Journals fetch. Xero `offset` is the last **JournalNumber** from the previous page
 * (journals with JournalNumber *greater than* offset are returned), NOT a row skip — see OpenAPI
 * getJournals. Using 0,100,200… breaks pagination and can yield empty/wrong pages for some tenants.
 */
async function fetchAllJournalsForTenant(
  accessToken: string,
  tenantId: string
): Promise<{ journals: XeroJournal[]; fetchError?: string; fetchStatus?: number }> {
  const all: XeroJournal[] = [];
  const pageSize = 100;
  /** `null` = first request (omit query offset); thereafter last JournalNumber from prior page */
  let cursor: number | null = null;

  while (true) {
    const params = new URLSearchParams();
    if (cursor !== null) {
      params.set("offset", String(cursor));
    }
    const result = await makeXeroRequest(accessToken, tenantId, "Journals", params);
    if (!result.success || !result.data?.Journals) {
      if (!result.success) {
        console.error(`[xero-data] Journals page failed (cursor=${cursor ?? "none"}):`, result.error);
        return {
          journals: all,
          fetchError: result.error || "Journals request failed",
          fetchStatus: result.status,
        };
      }
      break;
    }
    const batch = result.data.Journals as XeroJournal[];
    if (!batch.length) break;
    all.push(...batch);
    if (batch.length < pageSize) break;

    const last = batch[batch.length - 1] as XeroJournal | undefined;
    const lastNum = last?.JournalNumber;
    if (lastNum == null || typeof lastNum !== "number") {
      console.warn(
        "[xero-data] Journals pagination stopped: last row has no numeric JournalNumber; " +
          `got ${all.length} journal(s) in total`
      );
      break;
    }
    cursor = lastNum;
  }
  return { journals: all };
}

// Fetch individual invoice with line items
async function fetchInvoiceWithLineItems(
  accessToken: string,
  tenantId: string,
  invoiceId: string
): Promise<XeroInvoice | null> {
  const result = await makeXeroRequest(accessToken, tenantId, `Invoices/${invoiceId}`);
  if (result.success && result.data?.Invoices?.[0]) {
    return result.data.Invoices[0];
  }
  return null;
}

// Map Xero invoice status to our status
function mapXeroStatus(xeroStatus: string): string {
  const statusMap: Record<string, string> = {
    "DRAFT": "draft",
    "SUBMITTED": "pending",
    "AUTHORISED": "outstanding",
    "PAID": "paid",
    "VOIDED": "voided",
    "DELETED": "deleted",
  };
  return statusMap[xeroStatus] || "outstanding";
}

// Parse Xero .NET JSON date format to ISO string
// Xero returns dates like "/Date(1767872555853+0000)/" which need to be converted
function parseXeroDate(xeroDate: string | null | undefined): string | null {
  if (!xeroDate) return null;

  // Check if it's already a valid ISO date
  if (!xeroDate.startsWith("/Date(")) {
    // Try to parse as regular date
    const parsed = new Date(xeroDate);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
    return null;
  }

  // Parse .NET JSON date format: /Date(1767872555853+0000)/
  const match = xeroDate.match(/\/Date\((-?\d+)([+-]\d{4})?\)\//);
  if (!match) {
    console.warn(`[xero-data] Could not parse Xero date: ${xeroDate}`);
    return null;
  }

  const timestamp = parseInt(match[1], 10);
  const date = new Date(timestamp);

  if (isNaN(date.getTime())) {
    console.warn(`[xero-data] Invalid timestamp in Xero date: ${xeroDate}`);
    return null;
  }

  return date.toISOString();
}

// Save invoices to database
async function saveInvoicesToDatabase(
  supabase: any,
  organizationId: string,
  invoices: XeroInvoice[],
  accessToken: string,
  tenantId: string
): Promise<{ invoicesSaved: number; lineItemsSaved: number; errors: string[] }> {
  const errors: string[] = [];
  let invoicesSaved = 0;
  let lineItemsSaved = 0;

  console.log(`[xero-data] Saving ${invoices.length} invoices to database...`);

  for (const invoice of invoices) {
    try {
      // Fetch full invoice details with line items
      const fullInvoice = await fetchInvoiceWithLineItems(accessToken, tenantId, invoice.InvoiceID);
      if (!fullInvoice) {
        console.warn(`[xero-data] Could not fetch details for invoice ${invoice.InvoiceID}`);
        continue;
      }

      // Determine if paid
      const isPaid = fullInvoice.Status === "PAID" || fullInvoice.AmountDue === 0;

      // Prepare invoice data for upsert
      // Parse Xero date formats to ISO strings for PostgreSQL
      const invoiceData: Record<string, any> = {
        organization_id: organizationId,
        platform_type: "xero",
        platform_invoice_id: fullInvoice.InvoiceID,
        invoice_number: fullInvoice.InvoiceNumber || null,
        contact_id: fullInvoice.Contact?.ContactID || null,
        contact_name: fullInvoice.Contact?.Name || null,
        invoice_type: fullInvoice.Type || null,
        status: mapXeroStatus(fullInvoice.Status),
        is_paid: isPaid,
        currency: fullInvoice.CurrencyCode || "GBP",
        subtotal: fullInvoice.SubTotal || 0,
        tax_amount: fullInvoice.TotalTax || 0,
        total_amount: fullInvoice.Total || 0,
        amount_paid: fullInvoice.AmountPaid || 0,
        amount_outstanding: fullInvoice.AmountDue || 0,
        invoice_date: parseXeroDate(fullInvoice.Date),
        due_date: parseXeroDate(fullInvoice.DueDate),
        api_record_updated_at: parseXeroDate(fullInvoice.UpdatedDateUTC),
        updated_at: new Date().toISOString(),
      };

      // Upsert invoice
      const { data: upsertedInvoice, error: invoiceError } = await supabase
        .from("platform_integration_invoices")
        .upsert(invoiceData, {
          onConflict: "organization_id,platform_invoice_id",
        })
        .select("id, platform_invoice_id")
        .single();

      if (invoiceError) {
        console.error(`[xero-data] Error saving invoice ${fullInvoice.InvoiceID}:`, invoiceError);
        errors.push(`Invoice ${fullInvoice.InvoiceNumber || fullInvoice.InvoiceID}: ${invoiceError.message}`);
        continue;
      }

      const internalInvoiceId = upsertedInvoice?.id as string;
      if (!internalInvoiceId) {
        console.error(`[xero-data] Upsert invoice returned no id for ${fullInvoice.InvoiceID}`);
        errors.push(`Invoice ${fullInvoice.InvoiceNumber || fullInvoice.InvoiceID}: missing internal id after upsert`);
        continue;
      }

      invoicesSaved++;
      console.log(`[xero-data] Saved invoice: ${fullInvoice.InvoiceNumber || fullInvoice.InvoiceID}`);

      // Save line items if available (FK invoice_id → platform_integration_invoices.id, not Xero InvoiceID)
      if (fullInvoice.LineItems && fullInvoice.LineItems.length > 0) {
        const lineItemsToUpsert = fullInvoice.LineItems.map((item, index) => ({
          organization_id: organizationId,
          platform_line_id: item.LineItemID || `${fullInvoice.InvoiceID}_${index}`,
          invoice_id: internalInvoiceId,
          description: item.Description || null,
          quantity: item.Quantity || 0,
          unit_amount: item.UnitAmount || 0,
          account_code: item.AccountCode || null,
          item_code: item.ItemCode || null,
          tax_type: item.TaxType || null,
          tax_amount: item.TaxAmount || 0,
          line_amount: item.LineAmount || 0,
          gross: item.LineAmount || 0,
          net: (item.LineAmount || 0) - (item.TaxAmount || 0),
          tax: item.TaxAmount || 0,
        }));

        const { error: lineItemsError, count } = await supabase
          .from("platform_integration_invoice_line_items")
          .upsert(lineItemsToUpsert, {
            onConflict: "organization_id,platform_line_id",
            count: "exact",
          });

        if (lineItemsError) {
          console.error(`[xero-data] Error saving line items for invoice ${fullInvoice.InvoiceID}:`, lineItemsError);
          errors.push(`Line items for ${fullInvoice.InvoiceNumber || fullInvoice.InvoiceID}: ${lineItemsError.message}`);
        } else {
          lineItemsSaved += count || lineItemsToUpsert.length;
          console.log(`[xero-data] Saved ${count || lineItemsToUpsert.length} line items for invoice ${fullInvoice.InvoiceNumber}`);
        }
      }

      // Small delay to avoid rate limiting
      await delay(100);

    } catch (err: any) {
      console.error(`[xero-data] Error processing invoice ${invoice.InvoiceID}:`, err);
      errors.push(`Invoice ${invoice.InvoiceID}: ${err.message}`);
    }
  }

  return { invoicesSaved, lineItemsSaved, errors };
}

// Save Chart of Accounts to database
async function saveChartOfAccountsToDatabase(
  supabase: any,
  organizationId: string,
  platformIntegrationId: string,
  accounts: XeroAccount[],
  tenantId: string,
  userId: string | null,
  locationId: string | null
): Promise<{ accountsSaved: number; errors: string[] }> {
  const errors: string[] = [];
  let accountsSaved = 0;

  console.log(`[xero-data] Saving ${accounts.length} chart of accounts to database...`);

  // Use the Xero tenant ID directly as platform_integration_organization_id
  // (column was migrated from UUID FK to TEXT storing platform_org_id)
  const platformOrgId = tenantId;

  for (const account of accounts) {
    try {
      const accountData = {
        organization_id: organizationId,
        platform_integration_id: platformIntegrationId,
        platform_integration_organization_id: platformOrgId,
        user_id: userId, // Get from mapping table
        location_id: locationId, // Get from mapping table
        platform_name: "xero", // Required field
        coa_account_id: account.AccountID,
        coa_account_code: account.Code || "",
        coa_account_name: account.Name || "",
        coa_account_type: account.Type || "",
        coa_account_sub_type: account.Class || null,
        coa_description: account.Description || null,
        coa_tax_type: account.TaxType || null,
        coa_bank_account_type: account.BankAccountType || null,
        coa_reporting_code: account.ReportingCode || null,
        coa_reporting_name: account.ReportingCodeName || null,
        coa_system_account: account.SystemAccount || null,
        coa_is_active: account.Status === "ACTIVE",
        updated_at: new Date().toISOString(),
      };

      // Upsert to avoid duplicates - use column names matching the unique constraint
      console.log(`[xero-data] Upserting account: ${account.Code} - ${account.Name} (SystemAccount: ${account.SystemAccount || 'none'})`);

      const { data: upsertedData, error: accountError } = await supabase
        .from("platform_integration_chart_of_accounts")
        .upsert(accountData, {
          onConflict: 'organization_id,platform_integration_id,coa_account_id',
        })
        .select('id');

      if (accountError) {
        console.error(`[xero-data] Error saving account ${account.Code}:`, JSON.stringify(accountError));
        errors.push(`Account ${account.Code}: ${accountError.message}`);
        continue;
      }

      console.log(`[xero-data] Successfully saved account ${account.Code}, result:`, upsertedData);
      accountsSaved++;
    } catch (err: any) {
      console.error(`[xero-data] Error processing account ${account.AccountID}:`, err);
      errors.push(`Account ${account.AccountID}: ${err.message}`);
    }
  }

  console.log(`[xero-data] Saved ${accountsSaved} chart of accounts`);
  return { accountsSaved, errors };
}

// Save/Update Organization data to database
async function saveOrganizationToDatabase(
  supabase: any,
  organizationId: string,
  platformIntegrationId: string,
  xeroOrg: XeroOrganisation,
  tenantId: string
): Promise<{ success: boolean; error?: string }> {
  console.log(`[xero-data] Saving organization data: ${xeroOrg.Name}`);

  try {
    const orgData = {
      organization_id: organizationId,
      platform_integration_id: platformIntegrationId,
      platform_name: "xero",
      platform_org_id: tenantId,
      platform_org_name: xeroOrg.Name || "",
      platform_org_legal_name: xeroOrg.LegalName || xeroOrg.Name || "",
      platform_org_short_code: xeroOrg.ShortCode || null,
      platform_org_base_currency: xeroOrg.BaseCurrency || "GBP",
      platform_org_country_code: xeroOrg.CountryCode || null,
      platform_org_type: xeroOrg.OrganisationType || null,
      platform_org_tax_number: xeroOrg.TaxNumber || null,
      platform_org_is_demo: xeroOrg.IsDemoCompany || false,
      status: xeroOrg.OrganisationStatus === "ACTIVE" ? "active" : "inactive",
      updated_at: new Date().toISOString(),
    };

    // Upsert to avoid duplicates - use organization_id + platform_org_id as unique key
    const { error: orgError } = await supabase
      .from("platform_integration_organizations")
      .upsert(orgData, {
        onConflict: "organization_id,platform_org_id",
      });

    if (orgError) {
      console.error(`[xero-data] Error saving organization:`, orgError);
      return { success: false, error: orgError.message };
    }

    console.log(`[xero-data] Organization saved/updated: ${xeroOrg.Name}`);
    return { success: true };
  } catch (err: any) {
    console.error(`[xero-data] Error processing organization:`, err);
    return { success: false, error: err.message };
  }
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
    let body: XeroDataRequest;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid request body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { organization_id, endpoint, from_date, to_date, filters, save_to_db, integration_id, tenant_ids: requestedTenantIds } = body;

    console.log(`[xero-data] Request: endpoint=${endpoint}, integration_id=${integration_id}, tenant_ids=${JSON.stringify(requestedTenantIds)}, save_to_db=${save_to_db}`);

    if (!organization_id) {
      return new Response(
        JSON.stringify({ success: false, error: "organization_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[xero-data] Fetching ${endpoint} for org: ${organization_id}, save_to_db: ${save_to_db}`);

    // Get Xero credentials (support multi-account via integration_id)
    let integrationQuery = supabase
      .from("platform_integrations")
      .select("*")
      .eq("organization_id", organization_id)
      .eq("platform_name", "xero");

    if (integration_id) {
      integrationQuery = integrationQuery.eq("id", integration_id);
    } else {
      // Backward compatibility: pick first connected integration
      integrationQuery = integrationQuery.eq("is_connected", true);
    }

    const { data: integration, error: integrationError } = await integrationQuery.limit(1).single();

    if (integrationError || !integration) {
      console.error("Failed to get Xero integration:", integrationError);
      return new Response(
        JSON.stringify({ success: false, error: "Xero integration not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!integration.is_connected) {
      return new Response(
        JSON.stringify({ success: false, error: "Xero is not connected" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get access token (refresh if needed)
    let accessToken = integration.access_token;
    if (isTokenExpired(integration.token_expires_at)) {
      console.log("[xero-data] Token expired, refreshing...");
      const refreshResult = await refreshAccessToken(supabase, integration);
      if (refreshResult.error || !refreshResult.access_token) {
        return new Response(
          JSON.stringify({ success: false, error: refreshResult.error || "Failed to refresh token" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      accessToken = refreshResult.access_token;
    }

    // Resolve which Xero tenants to sync
    const uniqueTenantMappings = new Map<string, {
      tenantId: string;
      tenantName: string;
      userId: string | null;
      locationId: string | null;
      platformOrgId: string;
    }>();

    // If explicit tenant_ids were provided, use them directly (most reliable for per-connection sync)
    if (requestedTenantIds && Array.isArray(requestedTenantIds) && requestedTenantIds.length > 0) {
      console.log(`[xero-data] Using ${requestedTenantIds.length} explicitly requested tenant IDs`);

      // Look up tenant details from platform_integration_organizations
      const { data: tenantOrgs } = await supabase
        .from("platform_integration_organizations")
        .select("id, platform_org_id, platform_org_name")
        .eq("organization_id", organization_id)
        .eq("platform_name", "xero")
        .in("platform_org_id", requestedTenantIds);

      for (const org of (tenantOrgs || [])) {
        if (org.platform_org_id && !uniqueTenantMappings.has(org.platform_org_id)) {
          uniqueTenantMappings.set(org.platform_org_id, {
            tenantId: org.platform_org_id,
            tenantName: org.platform_org_name || 'Unknown',
            userId: integration.user_id,
            locationId: null,
            platformOrgId: org.id,
          });
        }
      }

      // Add any requested IDs not found in DB (sync them anyway)
      for (const tid of requestedTenantIds) {
        if (!uniqueTenantMappings.has(tid)) {
          uniqueTenantMappings.set(tid, {
            tenantId: tid,
            tenantName: 'Unknown',
            userId: integration.user_id,
            locationId: null,
            platformOrgId: '',
          });
        }
      }
    } else {
      // No explicit tenant_ids: resolve from location mappings
      console.log("[xero-data] Resolving tenants from location mappings...", integration_id ? `scoped to integration ${integration_id}` : "all");

      let mappingQuery = supabase
        .from("platform_integration_organization_mapping")
        .select(`
          location_id,
          user_id,
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
        .eq("organization_id", organization_id);

      if (integration_id) {
        mappingQuery = mappingQuery.eq("platform_integration_id", integration_id);
      }

      const { data: mappingData, error: mappingError } = await mappingQuery;

      if (mappingError) {
        console.error("[xero-data] Error fetching mapping:", mappingError);
      }

      const xeroMappings = (mappingData || []).filter(
        (m: any) => m.platform_integration_organizations?.platform_name === "xero"
      );

      console.log(`[xero-data] Found ${xeroMappings.length} Xero organization mapping(s)`);

      if (xeroMappings.length === 0) {
        console.error("[xero-data] No Xero organization mapped to any location");
        return new Response(
          JSON.stringify({
            success: false,
            error: "No Xero organization mapped. Please map a location to a Xero organization first.",
            hint: "Go to Organization & Location Mapping section and select a Xero organization for your location."
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      for (const mapping of xeroMappings) {
        const tenantId = mapping.platform_integration_organizations?.platform_org_id;
        if (tenantId && !uniqueTenantMappings.has(tenantId)) {
          uniqueTenantMappings.set(tenantId, {
            tenantId,
            tenantName: mapping.platform_integration_organizations?.platform_org_name || 'Unknown',
            userId: mapping.user_id,
            locationId: mapping.location_id,
            platformOrgId: mapping.platform_integration_organizations?.id,
          });
        }
      }
    }

    console.log(`[xero-data] Will sync ${uniqueTenantMappings.size} unique Xero tenant(s):`, [...uniqueTenantMappings.keys()]);

    // Prepare date parameters
    const toDate = to_date || new Date().toISOString().split("T")[0];
    const fromDate = from_date || new Date(new Date().setFullYear(new Date().getFullYear() - 1)).toISOString().split("T")[0];

    const results: Record<string, any> = {};
    let syncResults: {
      invoicesSaved: number;
      lineItemsSaved: number;
      accountsSaved: number;
      organizationSynced: boolean;
      tenantsSynced: number;
      canonicalJournalEntriesUpserted: number;
      canonicalJournalLinesUpserted: number;
      canonicalAccountsUpserted: number;
      canonicalJournalsProcessed: number;
      errors: string[]
    } = {
      invoicesSaved: 0,
      lineItemsSaved: 0,
      accountsSaved: 0,
      organizationSynced: false,
      tenantsSynced: 0,
      canonicalJournalEntriesUpserted: 0,
      canonicalJournalLinesUpserted: 0,
      canonicalAccountsUpserted: 0,
      canonicalJournalsProcessed: 0,
      errors: []
    };

    // For "sync-all" endpoint, sync COA and Invoices (Organizations are fetched during OAuth connect)
    const isSyncAll = endpoint === "sync-all";
    const shouldSaveToDb = save_to_db || isSyncAll;
    /** Full journal pagination + finance_* materialization (heavy); on for sync-all or explicit flag. */
    const shouldMaterializeCanonical =
      shouldSaveToDb && (isSyncAll || body.materialize_canonical === true);

    // Note: Organization data is now fetched during OAuth callback (xero-callback)
    // This endpoint only syncs Chart of Accounts and Invoices
    console.log(`[xero-data] Sync mode: ${isSyncAll ? 'sync-all (COA + Invoices)' : endpoint}`);

    // Loop through ALL unique tenants and sync data for each
    for (const [tenantId, tenantInfo] of uniqueTenantMappings) {
      console.log(`[xero-data] ========== Syncing tenant: ${tenantInfo.tenantName} (${tenantId}) ==========`);
      console.log(`[xero-data] user_id: ${tenantInfo.userId}, location_id: ${tenantInfo.locationId}`);

      // Fetch requested data for this tenant
      if (endpoint === "profit-and-loss" || endpoint === "all") {
        const params = new URLSearchParams();
        params.append("fromDate", fromDate);
        params.append("toDate", toDate);
        // Without this, Xero applies whatever custom Report Layout the org has
        // saved as default (e.g. a management-style layout that regroups accounts
        // into custom headings) instead of the plain COA-section report seen in
        // Xero's own UI — standardLayout=true forces that plain structure.
        params.append("standardLayout", "true");
        const trackingCategoryId = body.tracking_category_id ? String(body.tracking_category_id).trim() : "";
        const trackingOptionId = body.tracking_option_id ? String(body.tracking_option_id).trim() : "";
        if (trackingCategoryId && trackingOptionId) {
          params.append("trackingCategoryID", trackingCategoryId);
          params.append("trackingOptionID", trackingOptionId);
        }
        const plResult = await makeXeroRequest(accessToken, tenantId, "Reports/ProfitAndLoss", params);
        // Store with tenant ID for multi-tenant support
        results[`profitAndLoss_${tenantId}`] = plResult;
        // Also store as main result for backward compatibility (last tenant wins)
        results.profitAndLoss = plResult;
      }

      if (endpoint === "balance-sheet" || endpoint === "all") {
        const params = new URLSearchParams();
        params.append("date", toDate);
        params.append("standardLayout", "true");
        const trackingCategoryId = body.tracking_category_id ? String(body.tracking_category_id).trim() : "";
        const trackingOptionId = body.tracking_option_id ? String(body.tracking_option_id).trim() : "";
        if (trackingCategoryId && trackingOptionId) {
          // Xero's BalanceSheet report has no trackingCategoryID param (unlike
          // ProfitAndLoss) — it takes the option ID directly as trackingOptionID1.
          params.append("trackingOptionID1", trackingOptionId);
        }
        const bsResult = await makeXeroRequest(accessToken, tenantId, "Reports/BalanceSheet", params);
        // Store with tenant ID for multi-tenant support
        results[`balanceSheet_${tenantId}`] = bsResult;
        // Also store as main result for backward compatibility (last tenant wins)
        results.balanceSheet = bsResult;
      }

      // Fetch and sync Chart of Accounts for this tenant
      if (endpoint === "accounts" || endpoint === "all" || isSyncAll) {
        console.log(`[xero-data] Fetching chart of accounts for tenant: ${tenantInfo.tenantName}...`);
        const accountsResult = await makeXeroRequest(accessToken, tenantId, "Accounts");

        console.log(`[xero-data] Accounts API response success: ${accountsResult?.success}`);
        console.log(`[xero-data] Number of accounts returned: ${accountsResult?.data?.Accounts?.length || 0}`);

        // Store with tenant ID for multi-tenant support
        results[`accounts_${tenantId}`] = accountsResult;
        // Also store as main result for backward compatibility (last tenant wins)
        results.accounts = accountsResult;

        if (!accountsResult?.success) {
          console.error(`[xero-data] Failed to fetch accounts for ${tenantInfo.tenantName}:`, accountsResult?.error);
          syncResults.errors.push(`${tenantInfo.tenantName}: Failed to fetch COA - ${accountsResult?.error || 'Unknown error'}`);
        }

        // Save Chart of Accounts to database if requested
        if (shouldSaveToDb && accountsResult?.success && accountsResult?.data?.Accounts) {
          const accountsToSave = accountsResult.data.Accounts;
          console.log(`[xero-data] Saving ${accountsToSave.length} accounts for ${tenantInfo.tenantName}...`);

          const coaResult = await saveChartOfAccountsToDatabase(
            supabase,
            organization_id,
            integration.id,
            accountsToSave,
            tenantId,
            tenantInfo.userId,
            tenantInfo.locationId
          );
          syncResults.accountsSaved += coaResult.accountsSaved;
          syncResults.errors.push(...coaResult.errors);

          console.log(`[xero-data] COA save complete for ${tenantInfo.tenantName}: ${coaResult.accountsSaved} saved`);
        } else if (shouldSaveToDb) {
          console.warn(`[xero-data] No accounts to save for ${tenantInfo.tenantName} - either API failed or returned empty array`);
        }
      }

      // Fetch and sync Invoices for this tenant
      if (endpoint === "invoices" || endpoint === "all" || isSyncAll) {
        const params = new URLSearchParams();
        if (filters?.where) {
          params.append("where", filters.where);
        } else {
          params.append("where", 'Type=="ACCPAY"'); // Default to bills/accounts payable
        }

        console.log(`[xero-data] Fetching invoices for tenant: ${tenantInfo.tenantName}...`);
        const invoicesResult = await makeXeroRequest(accessToken, tenantId, "Invoices", params);

        // Store with tenant ID for multi-tenant support
        results[`invoices_${tenantId}`] = invoicesResult;

        // IMPORTANT: Fetch line items for each invoice individually
        // Xero's bulk invoice endpoint does NOT return LineItems - must call individual invoice API
        if (invoicesResult?.success && invoicesResult?.data?.Invoices) {
          const invoicesList = invoicesResult.data.Invoices;
          const invoicesWithLineItems: XeroInvoice[] = [];

          console.log(`[xero-data] Total invoices from bulk fetch for ${tenantInfo.tenantName}: ${invoicesList.length}`);

          // Limit to first 100 invoices per tenant to avoid timeout
          const maxInvoices = Math.min(invoicesList.length, 100);
          console.log(`[xero-data] Will fetch details for ${maxInvoices} invoices`);

          for (let i = 0; i < maxInvoices; i++) {
            const invoice = invoicesList[i];
            try {
              const fullInvoice = await fetchInvoiceWithLineItems(accessToken, tenantId, invoice.InvoiceID);

              if (fullInvoice) {
                invoicesWithLineItems.push(fullInvoice);
              } else {
                invoicesWithLineItems.push(invoice);
              }

              // Small delay to avoid Xero rate limiting (60 calls/minute)
              await delay(100);
            } catch (err: any) {
              console.error(`[xero-data] Error fetching invoice ${invoice.InvoiceID}:`, err.message);
              invoicesWithLineItems.push(invoice);
            }
          }

          // Update result with detailed invoices for backward compatibility
          results.invoices = { success: true, data: { Invoices: invoicesWithLineItems } };

          // Save invoices to database if requested
          if (shouldSaveToDb && invoicesWithLineItems.length > 0) {
            console.log(`[xero-data] Saving ${invoicesWithLineItems.length} invoices for ${tenantInfo.tenantName}...`);
            const invoiceSyncResult = await saveInvoicesToDatabase(
              supabase,
              organization_id,
              invoicesWithLineItems,
              accessToken,
              tenantId
            );
            syncResults.invoicesSaved += invoiceSyncResult.invoicesSaved;
            syncResults.lineItemsSaved += invoiceSyncResult.lineItemsSaved;
            syncResults.errors.push(...invoiceSyncResult.errors);
            console.log(`[xero-data] Invoice sync complete for ${tenantInfo.tenantName}: ${invoiceSyncResult.invoicesSaved} invoices saved`);
          }
        }
      }

      // Fetch journals for this tenant (included in sync-all for canonical cashflow)
      if (endpoint === "journals" || endpoint === "all" || isSyncAll) {
        // Cooldown after potentially heavy invoice/account calls to reduce Journals 429 bursts.
        await delay(XERO_TENANT_REQUEST_COOLDOWN_MS);
        if (shouldMaterializeCanonical) {
          console.log(
            `[xero-data] Fetching all journal pages for ${tenantInfo.tenantName} (canonical materialize)...`
          );
          let journalFetch = await fetchAllJournalsForTenant(accessToken, tenantId);
          let allJournals = journalFetch.journals;

          // After many invoice GETs, Xero sometimes returns 401 on Journals; refresh token once and retry.
          if (journalFetch.fetchStatus === 401) {
            console.warn("[xero-data] Journals 401 — refreshing OAuth token and retrying journals fetch");
            const { data: integRow } = await supabase
              .from("platform_integrations")
              .select("*")
              .eq("id", integration.id)
              .maybeSingle();
            const rr = await refreshAccessToken(supabase, integRow || integration);
            if (!rr.error && rr.access_token) {
              accessToken = rr.access_token;
              journalFetch = await fetchAllJournalsForTenant(accessToken, tenantId);
              allJournals = journalFetch.journals;
            } else {
              console.error("[xero-data] Token refresh after Journals 401 failed:", rr.error);
            }
          }

          if (journalFetch.fetchError) {
            syncResults.errors.push(
              `${tenantInfo.tenantName}: Journals API — ${journalFetch.fetchError}` +
                (journalFetch.fetchStatus != null ? ` (HTTP ${journalFetch.fetchStatus})` : "")
            );
          }

          const journalsResult = {
            success: !journalFetch.fetchError,
            data: { Journals: allJournals },
            status: journalFetch.fetchStatus ?? 200,
            error: journalFetch.fetchError,
          };
          results[`journals_${tenantId}`] = journalsResult;
          results.journals = journalsResult;

          const { data: xeroOrgCurrency } = await supabase
            .from("platform_integration_organizations")
            .select("platform_org_base_currency")
            .eq("organization_id", organization_id)
            .eq("platform_org_id", tenantId)
            .maybeSingle();
          const baseCur =
            (xeroOrgCurrency?.platform_org_base_currency as string | undefined)?.slice(0, 3) || "GBP";

          const canon = await syncCanonicalFinanceFromXeroJournals(
            supabase,
            organization_id,
            integration.id,
            tenantId,
            allJournals,
            { baseCurrency: baseCur, fromYmd: fromDate, toYmd: toDate }
          );

          if (canon.error) {
            const msg = `Canonical finance (${tenantInfo.tenantName}): ${canon.error}`;
            syncResults.errors.push(msg);
            console.error("[xero-data]", msg);
          } else {
            syncResults.canonicalJournalEntriesUpserted += canon.journalEntriesUpserted;
            syncResults.canonicalJournalLinesUpserted += canon.journalLinesUpserted;
            syncResults.canonicalAccountsUpserted += canon.accountsUpserted;
            syncResults.canonicalJournalsProcessed += canon.journalsProcessed;
            if (canon.skippedReason) {
              console.warn(`[xero-data] Canonical sync skipped: ${canon.skippedReason}`);
              if (!journalFetch.fetchError) {
                syncResults.errors.push(
                  `${tenantInfo.tenantName}: ${canon.skippedReason} (journal date window: ${fromDate} … ${toDate})`
                );
              }
            } else {
              console.log(
                `[xero-data] Canonical finance materialized for ${tenantInfo.tenantName}: ` +
                  `${canon.journalEntriesUpserted} entries, ${canon.journalLinesUpserted} lines ` +
                  `(${canon.journalsProcessed} journals in range)`
              );
            }
          }
        } else {
          const journalsResult = await makeXeroRequest(accessToken, tenantId, "Journals");
          results[`journals_${tenantId}`] = journalsResult;
          results.journals = journalsResult;
        }
      }

      syncResults.tenantsSynced++;
      console.log(`[xero-data] ========== Completed tenant: ${tenantInfo.tenantName} ==========`);
    } // End of tenant loop

    // Fetch bank accounts (for payment dropdown) - uses first tenant for simplicity
    if (endpoint === "bank-accounts") {
      const firstTenant = Array.from(uniqueTenantMappings.values())[0];
      console.log("[xero-data] Fetching bank accounts from Xero...");
      const bankAccountsData = await makeXeroRequest(
        accessToken,
        firstTenant.tenantId,
        "Accounts",
        new URLSearchParams({ where: 'Type=="BANK"&&Status=="ACTIVE"' })
      );

      // Transform bank accounts for easy use in UI
      const bankAccounts = (bankAccountsData?.data?.Accounts || []).map((account: XeroAccount) => ({
        id: account.AccountID,
        code: account.Code,
        name: account.Name,
        type: account.BankAccountType || "BANK",
        currency: account.CurrencyCode,
      }));

      console.log(`[xero-data] Found ${bankAccounts.length} bank accounts`);

      return new Response(
        JSON.stringify({
          success: true,
          bankAccounts,
          meta: {
            organization_id,
            tenant_id: firstTenant.tenantId,
          },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[xero-data] Fetch complete");
    console.log(
      `[xero-data] Sync summary: Tenants: ${syncResults.tenantsSynced}, Accounts: ${syncResults.accountsSaved}, ` +
        `Invoices: ${syncResults.invoicesSaved}, Line Items: ${syncResults.lineItemsSaved}, ` +
        `Canonical JE: ${syncResults.canonicalJournalEntriesUpserted}, Canonical JL: ${syncResults.canonicalJournalLinesUpserted}`
    );

    // Get all tenant IDs that were synced
    const syncedTenantIds = Array.from(uniqueTenantMappings.keys());

    return new Response(
      JSON.stringify({
        success: true,
        data: results,
        sync: syncResults,
        meta: {
          organization_id,
          tenant_ids: syncedTenantIds,
          tenants_count: syncedTenantIds.length,
          from_date: fromDate,
          to_date: toDate,
          saved_to_db: shouldSaveToDb,
          sync_type: isSyncAll ? "sync-all" : endpoint,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[xero-data] Unexpected error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ success: false, error: "Internal server error", details: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
