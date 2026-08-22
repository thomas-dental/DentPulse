import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { syncCanonicalFinanceFromIplicitEdge } from "./canonicalFinanceFromIplicit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface IplicitSessionResponse {
  tokenDue: string;
  sessionToken: string;
  domain: string;
  apiVer: string;
}

interface ConnectionRecord {
  id: string;
  organization_id: string;
  client_id: string | null; // iplicit domain
  client_secret: string | null; // username|apiKey
  access_token: string | null;
  token_expires_at: string | null;
  is_connected: boolean;
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;
const MAX_INVOICES_PER_SYNC = 500; // Limit invoices per sync to avoid timeout
const MAX_DOCS_PER_GL_SOURCE = 100; // Limit documents fetched per source (list returns summary; need detail for lines)
const BATCH_SIZE = 50; // Batch size for database upserts

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries: number = MAX_RETRIES
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetch(url, options);
      if (response.ok) {
        return response;
      }

      // Don't retry on auth errors
      if (response.status === 401 || response.status === 403) {
        return response;
      }

      lastError = new Error(`HTTP ${response.status}: ${await response.text()}`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }

    if (attempt < retries - 1) {
      console.log(`Retry attempt ${attempt + 1}/${retries - 1} after ${RETRY_DELAY_MS}ms`);
      await sleep(RETRY_DELAY_MS * (attempt + 1));
    }
  }

  throw lastError || new Error("Request failed after retries");
}

/**
 * iplicit API may return a raw array or a wrapped object (e.g. { value: [] }).
 * Normalize to an array and log when response shape is unexpected (helps debug "no records").
 */
// deno-lint-ignore no-explicit-any
function parseApiArrayResponse(body: any, logLabel: string): any[] {
  if (Array.isArray(body)) return body;
  if (body && typeof body === "object") {
    const arr = body.value ?? body.data ?? body.items ?? body.results ?? body.entries;
    if (Array.isArray(arr)) {
      console.log(`${logLabel}: API returned wrapped array (key: value/data/items), length=${arr.length}`);
      return arr;
    }
    console.warn(
      `${logLabel}: API response is object but no array found. Keys: ${Object.keys(body).join(", ")}. ` +
      "If iplicit returns a different wrapper, add it in parseApiArrayResponse."
    );
  }
  return [];
}

// deno-lint-ignore no-explicit-any
async function getSessionToken(
  supabase: SupabaseClient<any>,
  connection: ConnectionRecord,
  connectionId: string
): Promise<{ sessionToken: string; tokenExpiry: string } | null> {
  const { client_id: iplicitDomain, client_secret, access_token, token_expires_at } = connection;

  // Parse username and apiKey from client_secret (format: username|apiKey)
  const [iplicitUsername, iplicitApiKey] = (client_secret || '').split('|');

  if (!iplicitDomain || !iplicitUsername || !iplicitApiKey) {
    console.error("Missing iplicit credentials in connection");
    return null;
  }

  // Check if token is expired or about to expire (within 5 minutes)
  const tokenExpiry = token_expires_at ? new Date(token_expires_at) : null;
  const now = new Date();
  const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);

  // If token is valid, use it
  if (tokenExpiry && tokenExpiry > fiveMinutesFromNow && access_token) {
    console.log(`Using existing token, valid until: ${token_expires_at}`);
    return { sessionToken: access_token, tokenExpiry: token_expires_at! };
  }

  console.log("Token expired or expiring soon, refreshing...");

  try {
    const sessionResponse = await fetchWithRetry(
      "https://api.iplicit.com/api/session/create/api",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Domain": iplicitDomain,
        },
        body: JSON.stringify({
          username: iplicitUsername,
          userApiKey: iplicitApiKey,
        }),
      }
    );

    if (!sessionResponse.ok) {
      const errorText = await sessionResponse.text();
      console.error(`iplicit session refresh failed: ${errorText}`);

      await supabase
        .from("platform_integrations")
        .update({ is_connected: false })
        .eq("id", connectionId);

      return null;
    }

    const sessionData: IplicitSessionResponse = await sessionResponse.json();
    console.log(`Session refreshed successfully, new expiry: ${sessionData.tokenDue}`);

    // Save the new token immediately to database
    const { error: updateError } = await supabase
      .from("platform_integrations")
      .update({
        access_token: sessionData.sessionToken,
        token_expires_at: sessionData.tokenDue,
        updated_at: new Date().toISOString(),
      })
      .eq("id", connectionId);

    if (updateError) {
      console.error("Failed to save refreshed token:", updateError);
      // Continue anyway - token is still valid for this sync
    } else {
      console.log("Refreshed token saved to database");
    }

    return {
      sessionToken: sessionData.sessionToken,
      tokenExpiry: sessionData.tokenDue
    };
  } catch (error) {
    console.error("Session refresh error:", error);
    return null;
  }
}

// ============================================
// STEP 1: Fetch Legal Entities and save to platform_integration_organizations
// ============================================
// deno-lint-ignore no-explicit-any
async function syncLegalEntities(
  supabase: SupabaseClient<any>,
  domain: string,
  sessionToken: string,
  connectionId: string,
  organizationId: string,
  userId: string | null
): Promise<{ count: number; data: any[]; savedCount: number; savedIds: string[] }> {
  console.log("Syncing Legal Entities...");

  try {
    const response = await fetchWithRetry(
      "https://api.iplicit.com/api/LegalEntity",
      {
        method: "GET",
        headers: {
          "Domain": domain,
          "Authorization": `Bearer ${sessionToken}`,
        },
      }
    );

    if (!response.ok) {
      console.error(`Failed to fetch Legal Entities: ${response.status}`, await response.text());
      return { count: 0, data: [], savedCount: 0, savedIds: [] };
    }

    const entityArray = parseApiArrayResponse(await response.json(), "LegalEntity");
    if (entityArray.length === 0) {
      console.warn("LegalEntity: API returned 200 but 0 entities. Check Domain header and iplicit tenant has legal entities.");
    }

    console.log(`Fetched ${entityArray.length} legal entities from iplicit`);

    // Prepare batch data
    const batchData = entityArray.map((entity: any) => ({
      organization_id: organizationId,
      platform_integration_id: connectionId,
      user_id: userId,
      platform_name: "iplicit",
      platform_org_id: entity.id || entity.legalEntityId,
      platform_org_name: entity.description || entity.name || entity.legalEntityName || entity.code || "Unknown",
      platform_org_code: entity.code || entity.legalEntityCode || null,
      currency: entity.currency || entity.baseCurrency || null,
      country: entity.country || entity.countryCode || null,
      status: "active",
      is_selected: entityArray.length === 1,
      raw_data: entity,
      meta_data: {
        domain: domain,
        isActive: entity.isActive,
      },
      updated_at: new Date().toISOString(),
    }));

    // Batch upsert all entities
    const { data: upsertData, error: upsertError } = await supabase
      .from("platform_integration_organizations")
      .upsert(batchData, {
        onConflict: "platform_integration_id,platform_org_id",
      })
      .select("id");

    if (upsertError) {
      console.error("Batch upsert error for legal entities:", upsertError);
      return { count: entityArray.length, data: entityArray, savedCount: 0, savedIds: [] };
    }

    const savedIds = upsertData?.map((d: any) => d.id) || [];
    const savedCount = savedIds.length;

    console.log(`Saved ${savedCount}/${entityArray.length} legal entities to database`);
    console.log(`[DB SAVED] Legal Entities data:`, JSON.stringify(batchData, null, 2));
    return { count: entityArray.length, data: entityArray, savedCount, savedIds };
  } catch (error) {
    console.error("Legal Entity sync error:", error);
    return { count: 0, data: [], savedCount: 0, savedIds: [] };
  }
}

// ============================================
// STEP 2: Fetch Chart of Accounts and save to platform_integration_chart_of_accounts
// ============================================
// deno-lint-ignore no-explicit-any
async function syncChartOfAccounts(
  supabase: SupabaseClient<any>,
  domain: string,
  sessionToken: string,
  connectionId: string,
  organizationId: string,
  userId: string | null,
  platformIntegrationOrgId: string | null
): Promise<{ count: number; data: any[]; savedCount: number }> {
  console.log("Syncing Chart of Accounts...");

  try {
    const response = await fetchWithRetry(
      "https://api.iplicit.com/api/Catalog/Account",
      {
        method: "GET",
        headers: {
          "Domain": domain,
          "Authorization": `Bearer ${sessionToken}`,
        },
      }
    );

    if (!response.ok) {
      console.error(`Failed to fetch Chart of Accounts: ${response.status}`, await response.text());
      return { count: 0, data: [], savedCount: 0 };
    }

    const accountArray = parseApiArrayResponse(await response.json(), "Chart of Accounts");
    if (accountArray.length === 0) {
      console.warn("Chart of Accounts: API returned 200 but 0 accounts. Check iplicit catalog has accounts.");
    }

    console.log(`Fetched ${accountArray.length} accounts from iplicit Catalog`);

    // Prepare batch data – use account type from iplicit API when available (e.g. Balance Sheet, Profit & Loss)
    const batchData = accountArray.map((account: any) => {
      const apiAccountType =
        account.accountType ??
        account.type ??
        account.account_type ??
        account.AccountType;
      const coaAccountType =
        apiAccountType && String(apiAccountType).trim()
          ? String(apiAccountType).trim()
          : "Account";

      return {
        organization_id: organizationId,
        platform_integration_id: connectionId,
        platform_integration_organization_id: platformIntegrationOrgId,
        user_id: userId,
        platform_name: "iplicit",
        coa_account_id: account.id,
        coa_account_code: account.code || null,
        coa_account_name: account.description || account.code || "Unknown",
        coa_account_type: coaAccountType,
        coa_description: account.description || null,
        coa_is_active: account.isActive !== undefined ? account.isActive : true,
      };
    });

    // Batch upsert in chunks
    let savedCount = 0;
    for (let i = 0; i < batchData.length; i += BATCH_SIZE) {
      const batch = batchData.slice(i, i + BATCH_SIZE);

      const { error: upsertError } = await supabase
        .from("platform_integration_chart_of_accounts")
        .upsert(batch, {
          onConflict: "organization_id,platform_integration_id,coa_account_id",
        });

      if (!upsertError) {
        savedCount += batch.length;
        console.log(`[DB SAVED] Chart of Accounts batch: ${batch.length} records saved`);
        console.log(`[DB SAVED] Chart of Accounts data:`, JSON.stringify(batch, null, 2));
      } else {
        console.error("Batch upsert error for accounts:", upsertError);
      }
    }

    console.log(`Saved ${savedCount}/${accountArray.length} accounts to database`);
    return { count: accountArray.length, data: accountArray, savedCount };
  } catch (error) {
    console.error("Chart of Accounts sync error:", error);
    return { count: 0, data: [], savedCount: 0 };
  }
}

// ============================================
// STEP 3: Fetch Purchase Invoices (catalog + detail) and save to
//         platform_integration_invoices & platform_integration_invoice_line_items
// ============================================
// deno-lint-ignore no-explicit-any
function mapIplicitInvoiceStatus(statusList: string[]): string {
  if (!statusList || statusList.length === 0) return "draft";
  if (statusList.includes("voided")) return "voided";
  if (statusList.includes("paid")) return "paid";
  if (statusList.includes("posted") || statusList.includes("approved")) return "authorised";
  if (statusList.includes("draft")) return "draft";
  return statusList[0] || "draft";
}

// Helper function to batch upsert data
// deno-lint-ignore no-explicit-any
async function batchUpsert(
  supabase: SupabaseClient<any>,
  tableName: string,
  data: Record<string, unknown>[],
  onConflict: string
): Promise<number> {
  if (data.length === 0) return 0;

  let savedCount = 0;

  // Process in batches
  for (let i = 0; i < data.length; i += BATCH_SIZE) {
    const batch = data.slice(i, i + BATCH_SIZE);

    const { error } = await supabase
      .from(tableName)
      .upsert(batch, { onConflict });

    if (error) {
      console.error(`Batch upsert error for ${tableName}:`, error);
    } else {
      savedCount += batch.length;
      console.log(`[DB SAVED] ${tableName}: ${batch.length} records saved`);
      console.log(`[DB SAVED] ${tableName} data:`, JSON.stringify(batch, null, 2));
    }
  }

  return savedCount;
}


// Helper function to batch insert data (no upsert/conflict)
// deno-lint-ignore no-explicit-any
async function batchInsert(
  supabase: SupabaseClient<any>,
  tableName: string,
  data: Record<string, unknown>[]
): Promise<number> {
  if (data.length === 0) return 0;

  let savedCount = 0;

  for (let i = 0; i < data.length; i += BATCH_SIZE) {
    const batch = data.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from(tableName).insert(batch);

    if (error) {
      console.error(`Batch insert error for ${tableName}:`, error);
    } else {
      savedCount += batch.length;
    }
  }

  return savedCount;
}

// deno-lint-ignore no-explicit-any
async function syncPurchaseInvoices(
  supabase: SupabaseClient<any>,
  domain: string,
  sessionToken: string,
  connectionId: string,
  organizationId: string,
  userId: string | null,
  legalEntityId: string | null,
  accountIdToCodeMap?: Map<string, string>,
  accountIdToNameMap?: Map<string, string>,
  knownAccountCodes?: Set<string>
): Promise<{ catalogCount: number; detailsFetched: number; invoicesSaved: number; lineItemsSaved: number; invoicesData: any[]; lineItemsData: any[] }> {
  console.log("Syncing Purchase Invoices...");

  const result = { catalogCount: 0, detailsFetched: 0, invoicesSaved: 0, lineItemsSaved: 0, invoicesData: [] as any[], lineItemsData: [] as any[] };

  try {
    // --- 3a: Fetch invoice catalog ---
    // Try filtering by legalEntityId at the API level first
    let catalogUrl = "https://api.iplicit.com/api/Catalog/PurchaseInvoice";
    if (legalEntityId) {
      catalogUrl += `?legalEntityId=${encodeURIComponent(legalEntityId)}`;
      console.log(`Fetching Purchase Invoice catalog filtered by legalEntityId: ${legalEntityId}`);
    }

    const catalogResponse = await fetchWithRetry(
      catalogUrl,
      {
        method: "GET",
        headers: {
          "Domain": domain,
          "Authorization": `Bearer ${sessionToken}`,
        },
      }
    );

    if (!catalogResponse.ok) {
      console.error(`Failed to fetch Purchase Invoice catalog: ${catalogResponse.status}`, await catalogResponse.text());
      return result;
    }

    let catalogArray = parseApiArrayResponse(await catalogResponse.json(), "PurchaseInvoice catalog");
    if (catalogArray.length === 0) {
      console.warn("PurchaseInvoice catalog: API returned 200 but 0 invoices.");
    }
    result.catalogCount = catalogArray.length;

    console.log(`Fetched ${catalogArray.length} purchase invoices from catalog`);

    // Log first catalog entry structure for debugging
    if (catalogArray.length > 0) {
      console.log(`[DEBUG] Catalog entry[0] keys:`, Object.keys(catalogArray[0]));
      console.log(`[DEBUG] Catalog entry[0] sample:`, JSON.stringify(catalogArray[0]).substring(0, 500));
    }

    if (catalogArray.length === 0) {
      return result;
    }

    // If catalog entries contain legalEntityId, filter locally to the mapped entity
    if (legalEntityId && catalogArray.length > 0 && catalogArray[0].legalEntityId) {
      const beforeFilter = catalogArray.length;
      catalogArray = catalogArray.filter((entry: any) =>
        entry.legalEntityId === legalEntityId
      );
      console.log(`Filtered catalog by legalEntityId ${legalEntityId}: ${catalogArray.length} of ${beforeFilter} invoices match`);
    }

    // Limit invoices to avoid timeout
    const invoicesToProcess = catalogArray.slice(0, MAX_INVOICES_PER_SYNC);
    console.log(`Processing ${invoicesToProcess.length} invoices (limited from ${catalogArray.length})`);

    // --- 3b: Collect all invoice data first, then batch save ---
    const allInvoiceData: Record<string, unknown>[] = [];
    const allLineItemData: Record<string, unknown>[] = [];

    for (const entry of invoicesToProcess) {
      const invoiceId = entry.id;
      if (!invoiceId) continue;

      try {
        const detailResponse = await fetchWithRetry(
          `https://api.iplicit.com/api/PurchaseInvoice/${invoiceId}`,
          {
            method: "GET",
            headers: {
              "Domain": domain,
              "Authorization": `Bearer ${sessionToken}`,
            },
          }
        );

        if (!detailResponse.ok) {
          console.error(`Failed to fetch invoice detail ${invoiceId}: ${detailResponse.status}`);
          continue;
        }

        const inv = await detailResponse.json();
        result.detailsFetched++;

        // --- Map to platform_integration_invoices ---
        const isPaid = inv.outstandingAmount === 0 || inv.outstandingCurrencyAmount === 0;
        const statusText = mapIplicitInvoiceStatus(inv.statusList || []);

        const invoiceData: Record<string, unknown> = {
          organization_id: organizationId,
          user_id: userId,
          platform_type: "iplicit",
          platform_invoice_id: inv.id,
          invoice_number: inv.docNo || null,
          invoice_type: "ACCPAY", // Purchase Invoice = Accounts Payable
          reference: inv.theirDocNo || null,
          invoice_date: inv.docDate ? inv.docDate.split("T")[0] : null,
          due_date: inv.dueDate ? inv.dueDate.split("T")[0] : null,
          status: statusText,
          is_paid: isPaid,
          currency: inv.currency || inv.baseCurrency || "GBP",
          currency_rate: inv.currencyRate || 1,
          subtotal: inv.netAmount || 0,
          tax_amount: inv.taxAmount || 0,
          total_amount: inv.grossAmount || 0,
          amount_paid: (inv.grossCurrencyAmount || 0) - (inv.outstandingCurrencyAmount || 0),
          amount_outstanding: inv.outstandingCurrencyAmount || inv.outstandingAmount || 0,
          contact_id: inv.contactAccountId || null,
          contact_name:
            inv.contactDescription ||
            inv.contactName ||
            inv.supplierName ||
            (inv.contact?.name && typeof inv.contact.name === "string" ? inv.contact.name : null) ||
            (inv.contact?.description && typeof inv.contact.description === "string" ? inv.contact.description : null) ||
            (inv.contactAccount?.description && typeof inv.contactAccount.description === "string" ? inv.contactAccount.description : null) ||
            (inv.supplier?.name && typeof inv.supplier.name === "string" ? inv.supplier.name : null) ||
            inv.contactAccountDescription ||
            null,
          site_id: (inv.legalEntityId ? String(inv.legalEntityId).trim() : null)
            || (inv.locationId ? String(inv.locationId).trim() : null)
            || null,
          line_amount_types: inv.isNetEntry ? "Exclusive" : "Inclusive",
          api_record_created_at: inv.createdDate || null,
          api_record_updated_at: inv.lastModified || null,
          last_synced_at: new Date().toISOString(),
          sync_status: "synced",
          updated_at: new Date().toISOString(),
        };

        allInvoiceData.push(invoiceData);

        // --- Collect line items ---
        const details = Array.isArray(inv.details) ? inv.details : [];

        // Log invoice-level and line item fields to diagnose field names
        if (result.detailsFetched <= 2) {
          console.log(`[DEBUG] Invoice ${inv.docNo} top-level keys:`, Object.keys(inv));
          console.log(`[DEBUG] Invoice ${inv.docNo} contact fields: contactAccountId=${inv.contactAccountId}, contactAccountDescription=${inv.contactAccountDescription}, contactDescription=${inv.contactDescription}, contactName=${inv.contactName}, supplierName=${inv.supplierName}, description=${inv.description}, contact=${JSON.stringify(inv.contact)?.substring(0, 200)}, contactAccount=${JSON.stringify(inv.contactAccount)?.substring(0, 200)}, supplier=${JSON.stringify(inv.supplier)?.substring(0, 200)}`);
          if (details.length > 0) {
            console.log(`[DEBUG] Invoice ${inv.docNo} line item[0] keys:`, Object.keys(details[0]));
            console.log(`[DEBUG] Invoice ${inv.docNo} line item[0] sample:`, JSON.stringify(details[0]).substring(0, 500));
          }
        }

        for (let index = 0; index < details.length; index++) {
          const item = details[index] as Record<string, unknown>;
          // Use invoice_id + index to guarantee uniqueness (iplicit can reuse item.id across invoices)
          const platformLineId = `${inv.id}_${index}`;

          // Get raw account ID value - handle different types (string, number, object)
          let rawAccountId: unknown = item.accountId ?? item.nominalAccountId ?? item.glAccountId ?? null;
          if (rawAccountId && typeof rawAccountId === 'object') {
            rawAccountId = (rawAccountId as Record<string, unknown>).id ?? (rawAccountId as Record<string, unknown>).code ?? null;
          }
          const itemAccountId = rawAccountId != null && rawAccountId !== '' ? String(rawAccountId).trim() : null;

          // Try to get account code directly from item fields
          const directAccountCode =
            (item.accountCode != null ? String(item.accountCode).trim() : null)
            || (item.nominalCode != null ? String(item.nominalCode).trim() : null)
            || (item.glCode != null ? String(item.glCode).trim() : null)
            || (typeof item.account === 'string' ? String(item.account).trim() : null)
            || (item.account && typeof item.account === 'object' && (item.account as Record<string, unknown>).code
              ? String((item.account as Record<string, unknown>).code).trim()
              : null)
            || null;

          // Resolve account code using multiple strategies
          let resolvedAccountCode: string | null = directAccountCode;

          // Strategy 1: Map lookup (accountId → code)
          if (!resolvedAccountCode && itemAccountId && accountIdToCodeMap) {
            resolvedAccountCode = accountIdToCodeMap.get(itemAccountId) || null;
          }

          // Strategy 2: If accountId IS itself a known account code, use directly
          if (!resolvedAccountCode && itemAccountId && knownAccountCodes && knownAccountCodes.has(itemAccountId)) {
            resolvedAccountCode = itemAccountId;
          }

          // Resolve account name for additional matching
          const resolvedAccountName: string | null =
            (itemAccountId && accountIdToNameMap ? accountIdToNameMap.get(itemAccountId) || null : null)
            || (item.accountDescription != null ? String(item.accountDescription).trim() : null)
            || (item.nominalAccountDescription != null ? String(item.nominalAccountDescription).trim() : null)
            || null;

          if (index === 0 && result.detailsFetched <= 2) {
            console.log(`[DEBUG] Line item account resolution: rawAccountId=${rawAccountId}, itemAccountId=${itemAccountId}, directCode=${directAccountCode}, resolvedCode=${resolvedAccountCode}, resolvedName=${resolvedAccountName}`);
          }

          const lineData: Record<string, unknown> = {
            organization_id: organizationId,
            platform_line_id: platformLineId,
            invoice_id: inv.id as string,
            line_number: (item.orderIndex as number) || index + 1,
            description: (item.description as string) || null,
            quantity: (item.quantity as number) || 0,
            unit_amount: (item.netCurrencyUnitPrice as number) || 0,
            line_amount: (item.netCurrencyAmount as number) || 0,
            tax_amount: (item.taxCurrencyAmount as number) || 0,
            tax_rate: (item.taxRate as number) || 0,
            account_id: itemAccountId,
            account_code: resolvedAccountCode,
            account_name: resolvedAccountName,
          };

          allLineItemData.push(lineData);
        }

        console.log(`Collected invoice ${inv.docNo}: ${details.length} line items`);
      } catch (detailError) {
        console.error(`Error processing invoice ${invoiceId}:`, detailError);
      }
    }

    // Log account resolution summary
    const withAccountId = allLineItemData.filter((li: Record<string, unknown>) => li.account_id).length;
    const withAccountCode = allLineItemData.filter((li: Record<string, unknown>) => li.account_code).length;
    const withAccountName = allLineItemData.filter((li: Record<string, unknown>) => li.account_name).length;
    console.log(`Line items account resolution: ${withAccountId}/${allLineItemData.length} have account_id, ${withAccountCode}/${allLineItemData.length} have account_code, ${withAccountName}/${allLineItemData.length} have account_name`);

    // --- 3c: Batch save all invoices ---
    console.log(`Batch saving ${allInvoiceData.length} invoices...`);
    result.invoicesSaved = await batchUpsert(
      supabase,
      "platform_integration_invoices",
      allInvoiceData,
      "organization_id,platform_type,platform_invoice_id"
    );
    result.invoicesData = allInvoiceData;

    // --- 3d: Batch save all line items ---
    // invoice_id MUST be the UUID from platform_integration_invoices.id (FK constraint), not platform_invoice_id
    if (allLineItemData.length > 0) {
      const platformInvoiceIds = [...new Set(allLineItemData.map((li: Record<string, unknown>) => li.invoice_id as string))];
      const { data: invoiceRows, error: fetchError } = await supabase
        .from("platform_integration_invoices")
        .select("id, platform_invoice_id")
        .eq("organization_id", organizationId)
        .eq("platform_type", "iplicit")
        .in("platform_invoice_id", platformInvoiceIds);

      if (fetchError || !invoiceRows?.length) {
        console.error("Failed to fetch invoice IDs for line items:", fetchError);
      } else {
        const platformInvoiceIdToUuid = new Map<string, string>();
        for (const row of invoiceRows as { id: string; platform_invoice_id: string }[]) {
          platformInvoiceIdToUuid.set(row.platform_invoice_id, row.id);
        }

        // Remap line items to use actual invoice UUID (FK requires platform_integration_invoices.id)
        const lineItemsWithUuid: Record<string, unknown>[] = [];
        for (const li of allLineItemData) {
          const platformInvId = li.invoice_id as string;
          const invoiceUuid = platformInvoiceIdToUuid.get(platformInvId);
          if (invoiceUuid) {
            lineItemsWithUuid.push({ ...li, invoice_id: invoiceUuid });
          } else {
            console.warn(`No invoice UUID found for platform_invoice_id=${platformInvId}, skipping line item`);
          }
        }

        const invoiceUuids = [...new Set(lineItemsWithUuid.map((li) => li.invoice_id as string))];

        const { error: deleteError } = await supabase
          .from("platform_integration_invoice_line_items")
          .delete()
          .eq("organization_id", organizationId)
          .in("invoice_id", invoiceUuids);

        if (deleteError) {
          console.error("Failed to delete existing line items before insert:", deleteError);
        } else {
          console.log(`Deleted existing line items for ${invoiceUuids.length} invoices, inserting ${lineItemsWithUuid.length} line items...`);
          result.lineItemsSaved = await batchInsert(
            supabase,
            "platform_integration_invoice_line_items",
            lineItemsWithUuid
          );
        }
      }
    }

    console.log(
      `Purchase Invoices sync complete: ${result.invoicesSaved}/${result.catalogCount} invoices, ${result.lineItemsSaved} line items`
    );
    return result;
  } catch (error) {
    console.error("Purchase Invoice sync error:", error);
    return result;
  }
}

// ============================================
// STEP 4: Fetch GL Entries and save to
//         iplicit_gl_entries
// ============================================
// deno-lint-ignore no-explicit-any
async function syncGlEntries(
  supabase: SupabaseClient<any>,
  domain: string,
  sessionToken: string,
  connectionId: string,
  organizationId: string
): Promise<{ count: number; savedCount: number }> {
  console.log("Syncing GL Entries...");

  const result = { count: 0, savedCount: 0 };

  // Fetch GL entries from all iplicit document types
  // Use Catalog endpoints for listing (same pattern as syncPurchaseInvoices)
  // and direct endpoints for fetching detail by ID
  const sources = [
    { sourceType: "SaleInvoice", catalogPath: "api/Catalog/SaleInvoice", detailPath: "api/SaleInvoice" },
    { sourceType: "SaleOrder", catalogPath: "api/Catalog/SaleOrder", detailPath: "api/SaleOrder" },
    { sourceType: "SaleQuote", catalogPath: "api/Catalog/SaleQuote", detailPath: "api/SaleQuote" },
    { sourceType: "PurchaseOrder", catalogPath: "api/Catalog/PurchaseOrder", detailPath: "api/PurchaseOrder" },
    { sourceType: "PurchaseInvoice", catalogPath: "api/Catalog/PurchaseInvoice", detailPath: "api/PurchaseInvoice" },
    { sourceType: "Payment", catalogPath: "api/Catalog/Payment", detailPath: "api/Payment" },
    { sourceType: "Receipt", catalogPath: "api/Catalog/Receipt", detailPath: "api/Receipt" },
  ];

  const allRecords: Record<string, unknown>[] = [];
  const nowIso = new Date().toISOString();

  for (const src of sources) {
    try {
      // List via Catalog endpoint (returns summary), then fetch detail by ID for line-level data
      const listResponse = await fetchWithRetry(
        `https://api.iplicit.com/${src.catalogPath}`,
        {
          method: "GET",
          headers: {
            "Domain": domain,
            "Authorization": `Bearer ${sessionToken}`,
          },
        }
      );

      if (!listResponse.ok) {
        console.error(
          `Failed to fetch GL source ${src.sourceType}: ${listResponse.status}`
        );
        continue;
      }

      const listItems = parseApiArrayResponse(await listResponse.json(), `${src.sourceType} (GL list)`);
      result.count += listItems.length;

      console.log(
        `Fetched ${listItems.length} ${src.sourceType} from list, fetching details for line-level entries...`
      );

      if (listItems.length === 0) continue;

      const toFetch = listItems.slice(0, MAX_DOCS_PER_GL_SOURCE);
      if (listItems.length > MAX_DOCS_PER_GL_SOURCE) {
        console.log(`Limiting to ${MAX_DOCS_PER_GL_SOURCE} docs per source (${listItems.length} total)`);
      }

      for (const item of toFetch as any[]) {
        const docId = item.id || item.documentId || item.paymentId || item.receiptId;
        if (!docId) continue;

        let doc: any;
        try {
          const detailResponse = await fetchWithRetry(
            `https://api.iplicit.com/${src.detailPath}/${docId}`,
            {
              method: "GET",
              headers: {
                "Domain": domain,
                "Authorization": `Bearer ${sessionToken}`,
              },
            }
          );
          if (!detailResponse.ok) {
            console.warn(`Failed to fetch ${src.sourceType} detail ${docId}: ${detailResponse.status}`);
            continue;
          }
          doc = await detailResponse.json();
        } catch (err) {
          console.warn(`Error fetching ${src.sourceType} detail ${docId}:`, err);
          continue;
        }

        const externalId = doc.id || doc.documentId || doc.paymentId || doc.receiptId;
        if (!externalId) continue;

        const docDateStr =
          typeof doc.docDate === "string"
            ? doc.docDate
            : typeof doc.date === "string"
            ? doc.date
            : undefined;
        const docDate =
          docDateStr && docDateStr.includes("T")
            ? docDateStr.split("T")[0]
            : docDateStr || null;

        const sourceRef = doc.docNo || doc.reference || doc.bankRef || doc.code || null;
        const docClass =
          doc.docClass ||
          doc.documentClass ||
          doc.type ||
          doc.documentType ||
          null;

        const currency =
          doc.currency || doc.currencyCode || doc.baseCurrency || "GBP";

        // For PurchaseInvoice/SaleInvoice, prefer doc.details (invoice line items)
        // over doc.lines (GL postings) to avoid double-counting.
        // doc.lines may contain BOTH the nominal analysis AND the accounting entries,
        // causing 2x the correct amount when both hit the same account.
        const isPurchaseOrSaleInvoice = src.sourceType === "PurchaseInvoice" || src.sourceType === "SaleInvoice";
        const lines = isPurchaseOrSaleInvoice
          ? (Array.isArray(doc.details) && doc.details.length > 0 && doc.details) ||
            (Array.isArray(doc.lines) && doc.lines.length > 0 && doc.lines) ||
            (Array.isArray(doc.entries) && doc.entries.length > 0 && doc.entries) ||
            [doc]
          : (Array.isArray(doc.lines) && doc.lines.length > 0 && doc.lines) ||
            (Array.isArray(doc.details) && doc.details.length > 0 && doc.details) ||
            (Array.isArray(doc.entries) && doc.entries.length > 0 && doc.entries) ||
            [doc];

        lines.forEach((line: any, idx: number) => {
          const lineNumber =
            line.lineNumber ||
            line.lineNo ||
            line.orderIndex ||
            line.sequence ||
            idx + 1;

          const debitRaw =
            line.debitAmount ??
            line.debit ??
            line.debitValue ??
            0;
          const creditRaw =
            line.creditAmount ??
            line.credit ??
            line.creditValue ??
            0;

          let debit = typeof debitRaw === "number" ? debitRaw : Number(debitRaw) || 0;
          let credit = typeof creditRaw === "number" ? creditRaw : Number(creditRaw) || 0;

          // Derive debit/credit from amount/netAmount when not split (iplicit API variants)
          const amountRaw = line.amount ?? line.value ?? line.netAmount ?? line.lineAmount ?? line.total;
          if (debit === 0 && credit === 0 && amountRaw != null) {
            const amount = typeof amountRaw === "number" ? amountRaw : Number(amountRaw) || 0;
            if (amount !== 0) {
              if (amount > 0) {
                debit = Math.abs(amount);
              } else {
                credit = Math.abs(amount);
              }
            }
          }

          const netAmount = debit - credit;

          // Tax fields – iplicit provides taxRate, taxCurrencyAmount/taxAmount on line items
          const taxAmountRaw =
            line.taxCurrencyAmount ??
            line.taxAmount ??
            line.tax_amount ??
            line.vatAmount ??
            0;
          const taxAmount = typeof taxAmountRaw === "number" ? taxAmountRaw : Number(taxAmountRaw) || 0;

          const taxRateRaw =
            line.taxRate ??
            line.tax_rate ??
            line.vatRate ??
            0;
          const taxRate = typeof taxRateRaw === "number" ? taxRateRaw : Number(taxRateRaw) || 0;

          const taxType =
            line.taxType ||
            line.taxCode ||
            line.taxName ||
            line.tax_type ||
            line.vatCode ||
            (line.tax && typeof line.tax === "object"
              ? (line.tax as Record<string, unknown>).code || (line.tax as Record<string, unknown>).name
              : null) ||
            null;

          const entryDateStr =
            typeof line.entryDate === "string"
              ? line.entryDate
              : typeof line.date === "string"
              ? line.date
              : undefined;

          const entryDate =
            entryDateStr && entryDateStr.includes("T")
              ? entryDateStr.split("T")[0]
              : entryDateStr || docDate;

          const accountId =
            line.accountId ??
            line.account_id ??
            line.glAccountId ??
            (line.account && typeof line.account === "object"
              ? (line.account as Record<string, unknown>).id
              : null) ??
            null;

          const accountCode =
            line.accountCode ||
            line.nominalCode ||
            line.glAccountCode ||
            (line.account && typeof line.account === "object"
              ? (line.account as Record<string, unknown>).code
              : null) ||
            null;

          const accountName =
            line.accountName ||
            line.accountDescription ||
            (line.account && typeof line.account === "object"
              ? (line.account as Record<string, unknown>).description
              : null) ||
            null;

          const lineDescription =
            line.description ||
            line.lineDescription ||
            line.narrative ||
            null;

          allRecords.push({
            organization_id: organizationId,
            connection_id: connectionId,
            external_id: externalId,
            source_type: src.sourceType,
            source_ref: sourceRef,
            doc_class: docClass,
            doc_date: docDate,
            account_id: accountId,
            account_code: accountCode,
            account_name: accountName,
            entry_date: entryDate,
            description: doc.description || null,
            narrative: doc.narrative || line.narrative || null,
            debit_amount: debit,
            credit_amount: credit,
            net_amount: netAmount,
            tax_amount: taxAmount,
            tax_rate: taxRate,
            tax_type: taxType,
            gross_amount: netAmount + taxAmount,
            currency_code: currency,
            line_number: lineNumber,
            line_description: lineDescription,
            counterparty_name:
              doc.counterpartyName ||
              doc.contactName ||
              doc.customerName ||
              doc.supplierName ||
              (doc.contact?.name && typeof doc.contact.name === "string" ? doc.contact.name : null) ||
              (doc.contact?.description && typeof doc.contact.description === "string" ? doc.contact.description : null) ||
              (doc.contactAccount?.description && typeof doc.contactAccount.description === "string" ? doc.contactAccount.description : null) ||
              (doc.supplier?.name && typeof doc.supplier.name === "string" ? doc.supplier.name : null) ||
              null,
            counterparty_ref:
              doc.counterpartyRef ||
              doc.contactRef ||
              doc.customerRef ||
              doc.supplierRef ||
              null,
            synced_at: nowIso,
            updated_at: nowIso,
          });
        });
      }
    } catch (error) {
      console.error(
        `GL Entries sync error for source ${src.sourceType}:`,
        error
      );
    }
  }

  if (allRecords.length === 0) {
    try {
      const { count: existingCount, error: countErr } = await supabase
        .from("iplicit_gl_entries")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .eq("connection_id", connectionId);

      if (countErr) {
        console.warn("Could not count existing iplicit_gl_entries:", countErr.message);
      } else {
        console.log(
          `No GL rows from iplicit API this run — existing iplicit_gl_entries in DB for this connection: ${existingCount ?? 0}`
        );
      }
    } catch (e) {
      console.warn("Existing GL count failed:", e);
    }
    console.log("No GL entries to save from API");
    return result;
  }

  // Deduplicate by (connection_id, external_id, line_number) - same doc can appear in multiple sources (e.g. PurchaseInvoice + Document)
  const seen = new Set<string>();
  const deduped: Record<string, unknown>[] = [];
  for (const r of allRecords) {
    const key = `${r.connection_id}|${r.external_id}|${r.line_number ?? 0}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(r);
  }
  if (deduped.length < allRecords.length) {
    console.log(`Deduplicated GL entries: ${allRecords.length} -> ${deduped.length} (removed ${allRecords.length - deduped.length} duplicates)`);
  }

  console.log(
    `Saving ${deduped.length} GL entry rows to iplicit_gl_entries...`
  );

  // Delete existing GL entries for this connection before re-inserting
  // to clear any previously duplicated data from doc.lines overlap
  try {
    const { error: deleteError } = await supabase
      .from("iplicit_gl_entries")
      .delete()
      .eq("connection_id", connectionId)
      .eq("organization_id", organizationId);

    if (deleteError) {
      console.warn("Failed to delete existing GL entries (will upsert instead):", deleteError.message);
    } else {
      console.log(`Cleared existing GL entries for connection ${connectionId}`);
    }
  } catch (delErr) {
    console.warn("GL entries delete exception (non-fatal):", delErr);
  }

  result.savedCount = await batchUpsert(
    supabase,
    "iplicit_gl_entries",
    deduped,
    "connection_id,external_id,line_number"
  );

  console.log(
    `GL Entries sync complete: ${result.savedCount} rows saved (from ${result.count} source records)`
  );

  return result;
}

// ============================================
// STEP 4: Fetch Leases from iplicit Lease module and save to lease_master
// ============================================

function determineLeaseCategoryFromDescription(description: string): string {
  const text = (description || '').toLowerCase();
  if (/property|building|premises|office|rent|occupancy/.test(text)) return 'building';
  if (/equipment|machine|dental|chair|autoclave|x-ray/.test(text)) return 'equipment';
  if (/vehicle|car|van|motor|transport/.test(text)) return 'vehicle';
  if (/software|it|computer|license|saas|cloud/.test(text)) return 'it_software';
  return 'other';
}

function computeLeaseStatus(startDate: string | null, endDate: string | null): string {
  if (!endDate) return 'active';
  const now = new Date();
  const end = new Date(endDate);
  const start = startDate ? new Date(startDate) : null;

  if (end < now) return 'expired';
  const threeMonthsFromNow = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
  if (end <= threeMonthsFromNow) return 'expiring_soon';
  if (start && start > now) return 'active'; // future lease
  return 'active';
}

// deno-lint-ignore no-explicit-any
async function syncLeases(
  supabase: SupabaseClient<any>,
  domain: string,
  sessionToken: string,
  organizationId: string
): Promise<{ catalogCount: number; detailsFetched: number; leasesSaved: number }> {
  console.log("Syncing Leases...");

  const result = { catalogCount: 0, detailsFetched: 0, leasesSaved: 0 };

  try {
    // 4a: Fetch lease catalog
    const catalogResponse = await fetchWithRetry(
      "https://api.iplicit.com/api/Catalog/Lease",
      {
        method: "GET",
        headers: {
          "Domain": domain,
          "Authorization": `Bearer ${sessionToken}`,
        },
      }
    );

    if (!catalogResponse.ok) {
      console.error(`Failed to fetch Lease catalog: ${catalogResponse.status}`);
      return result;
    }

    const catalog = await catalogResponse.json();
    const catalogArray = Array.isArray(catalog) ? catalog : [];
    result.catalogCount = catalogArray.length;

    console.log(`Fetched ${catalogArray.length} leases from catalog`);

    if (catalogArray.length === 0) {
      return result;
    }

    // 4b: Fetch detail for each lease and collect data
    const allLeaseData: Record<string, unknown>[] = [];

    for (const entry of catalogArray) {
      const leaseId = entry.id;
      if (!leaseId) continue;

      try {
        const detailResponse = await fetchWithRetry(
          `https://api.iplicit.com/api/Lease/${leaseId}`,
          {
            method: "GET",
            headers: {
              "Domain": domain,
              "Authorization": `Bearer ${sessionToken}`,
            },
          }
        );

        if (!detailResponse.ok) {
          console.error(`Failed to fetch lease detail ${leaseId}: ${detailResponse.status}`);
          continue;
        }

        const lease = await detailResponse.json();
        result.detailsFetched++;

        // Log first two leases for debugging
        if (result.detailsFetched <= 2) {
          console.log(`[DEBUG] Lease ${leaseId} keys:`, Object.keys(lease));
          console.log(`[DEBUG] Lease ${leaseId} sample:`, JSON.stringify(lease).substring(0, 800));
        }

        // Map iplicit lease fields to lease_master columns
        const leaseCode = lease.code || lease.leaseCode || entry.code || `LEASE-${leaseId}`;
        const leaseName = lease.propertyName || lease.property || lease.description || lease.name || entry.description || leaseCode;
        const leaseDescription = lease.description || lease.leaseDescription || entry.description || '';
        const contactName = lease.contactAccountDescription || lease.contactDescription || lease.supplierName || lease.landlord || null;
        const contactId = lease.contactAccountId || lease.contactId || null;
        const startDate = lease.startDate ? lease.startDate.split("T")[0] : null;
        const endDate = lease.endDate ? lease.endDate.split("T")[0] : null;
        const amount = lease.amount || lease.rentAmount || lease.leaseAmount || lease.value || 0;
        const currency = lease.currency || lease.baseCurrency || "GBP";

        // Determine category from description
        const category = determineLeaseCategoryFromDescription(leaseDescription || leaseName);

        // Compute status from dates
        const status = computeLeaseStatus(startDate, endDate);

        const leaseData: Record<string, unknown> = {
          organization_id: organizationId,
          lease_reference: leaseCode,
          lease_name: leaseName,
          lease_description: leaseDescription,
          lease_category: category,
          xero_contact_id: contactId,
          xero_contact_name: contactName,
          lease_start_date: startDate,
          lease_end_date: endDate,
          monthly_rent: amount,
          currency: currency,
          status: status,
          updated_at: new Date().toISOString(),
        };

        allLeaseData.push(leaseData);

        console.log(`Collected lease: ${leaseCode} - ${leaseName} (${status})`);
      } catch (detailError) {
        console.error(`Error processing lease ${leaseId}:`, detailError);
      }
    }

    // 4c: Batch upsert all leases to lease_master
    if (allLeaseData.length > 0) {
      console.log(`Batch saving ${allLeaseData.length} leases...`);
      result.leasesSaved = await batchUpsert(
        supabase,
        "lease_master",
        allLeaseData,
        "organization_id,lease_reference"
      );
    }

    console.log(`Lease sync complete: ${result.leasesSaved}/${result.catalogCount} leases saved`);
    return result;
  } catch (error) {
    console.error("Lease sync error:", error);
    return result;
  }
}

// ============================================
// STEP 5: Log service cost accounts found in Chart of Accounts (info only)
// Staff Costs page uses the same ACCPAY purchase invoices filtered by account codes.
// No extra API calls needed — the data is already in purchase invoice line items.
// ============================================
// deno-lint-ignore no-explicit-any
function getServiceCostAccountsSummary(
  chartOfAccountsData: any[]
): { serviceCostAccounts: number; codes: string[] } {
  const serviceCostAccounts = chartOfAccountsData.filter((acct: any) => {
    const code = String(acct.code || "").trim();
    return code.match(/^[45]\d{2,}/);
  });
  const codes = serviceCostAccounts.map((a: any) => `${a.code}: ${a.description}`);
  console.log(`Service cost accounts in CoA (4xxx/5xxx): ${serviceCostAccounts.length}`, codes);
  return { serviceCostAccounts: serviceCostAccounts.length, codes };
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // Get authorization header
    const authHeader = req.headers.get("Authorization");

    const body = await req.json();
    const { connectionId, organizationId, isScheduled = false }: { connectionId?: string; organizationId?: string; isScheduled?: boolean } = body;

    // For scheduled syncs, we use service role; for manual, verify user JWT
    if (!isScheduled) {
      if (!authHeader) {
        console.error("Missing authorization header");
        return new Response(
          JSON.stringify({ error: "Missing authorization header" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const token = authHeader.replace("Bearer ", "");
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);

      if (authError || !user) {
        console.error("Auth error:", authError);
        return new Response(
          JSON.stringify({ error: "Invalid authentication" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    if (!connectionId && !organizationId) {
      return new Response(
        JSON.stringify({ error: "Missing connectionId or organizationId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[IPLICIT SYNC START] connectionId: ${connectionId}, orgId: ${organizationId}, scheduled: ${isScheduled}`);

    // Get the connection details from platform_integrations table
    let connection = null;
    let fetchError = null;

    // Try by connectionId first
    if (connectionId) {
      const result = await supabase
        .from("platform_integrations")
        .select("*")
        .eq("id", connectionId)
        .maybeSingle();
      connection = result.data;
      fetchError = result.error;
    }

    // Fallback: lookup by organizationId + platform_name
    if (!connection && organizationId) {
      console.log("Fallback: looking up by organizationId and platform_name");
      const result = await supabase
        .from("platform_integrations")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("platform_name", "iplicit")
        .maybeSingle();
      connection = result.data;
      fetchError = result.error;
    }

    if (!connection) {
      console.error("Connection not found:", fetchError);
      return new Response(
        JSON.stringify({ error: "Connection not found. Please add iplicit credentials first." }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const connRecord = connection as ConnectionRecord;
    const resolvedConnectionId = connRecord.id;
    const { client_id: iplicitDomain, client_secret } = connRecord;

    if (!iplicitDomain || !client_secret) {
      return new Response(
        JSON.stringify({ error: "Invalid connection configuration" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get session token with retry
    const sessionResult = await getSessionToken(supabase, connRecord, resolvedConnectionId);

    if (!sessionResult) {
      return new Response(
        JSON.stringify({ error: "Failed to authenticate with iplicit" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { sessionToken, tokenExpiry } = sessionResult;

    // Get user_id from connection record
    const userId = (connection as any).user_id || null;
    const resolvedOrgId = connRecord.organization_id;

    // STEP 1: Fetch Legal Entities and save to platform_integration_organizations
    const legalEntitiesResult = await syncLegalEntities(
      supabase,
      iplicitDomain,
      sessionToken,
      resolvedConnectionId,
      resolvedOrgId,
      userId
    );

    // Use the first saved organization ID for linking chart of accounts (DB UUID)
    const platformIntegrationOrgId = legalEntitiesResult.savedIds.length > 0
      ? legalEntitiesResult.savedIds[0]
      : null;

    // Resolve the MAPPED legal entity's iplicit platform_org_id for invoice filtering
    // This is the actual iplicit entity ID (e.g. "5c6c8c77-..."), NOT a DB UUID
    let mappedIplicitEntityId: string | null = null;
    try {
      const { data: mappingData } = await supabase
        .from("platform_integration_organization_mapping")
        .select("platform_integration_organizations_id")
        .eq("organization_id", resolvedOrgId)
        .limit(1);

      if (mappingData && mappingData.length > 0) {
        const { data: platformOrg } = await supabase
          .from("platform_integration_organizations")
          .select("platform_org_id")
          .eq("id", mappingData[0].platform_integration_organizations_id)
          .eq("platform_name", "iplicit")
          .maybeSingle();

        if (platformOrg?.platform_org_id) {
          mappedIplicitEntityId = String(platformOrg.platform_org_id).trim();
          console.log(`Resolved mapped iplicit entity ID: ${mappedIplicitEntityId}`);
        }
      }

      if (!mappedIplicitEntityId) {
        console.log("No organization mapping found — will sync invoices from all entities");
      }
    } catch (mappingErr) {
      console.warn("Error resolving organization mapping:", mappingErr);
    }

    // STEP 2: Fetch Chart of Accounts and save to platform_integration_chart_of_accounts
    const chartOfAccountsResult = await syncChartOfAccounts(
      supabase,
      iplicitDomain,
      sessionToken,
      resolvedConnectionId,
      resolvedOrgId,
      userId,
      platformIntegrationOrgId
    );

    // Build accountId → code, accountId → name, and known codes lookups
    const accountIdToCodeMap = new Map<string, string>();
    const accountIdToNameMap = new Map<string, string>();
    const knownAccountCodes = new Set<string>();
    if (chartOfAccountsResult.data && chartOfAccountsResult.data.length > 0) {
      for (const account of chartOfAccountsResult.data) {
        const id = account.id ? String(account.id).trim() : '';
        const code = account.code ? String(account.code).trim() : '';
        const desc = account.description ? String(account.description).trim() : '';
        if (id && code) {
          accountIdToCodeMap.set(id, code);
          knownAccountCodes.add(code);
        }
        if (id && desc) {
          accountIdToNameMap.set(id, desc);
        }
      }
      console.log(`Built account lookup map with ${accountIdToCodeMap.size} entries, ${knownAccountCodes.size} unique codes`);
    }

    // STEP 3: Fetch Purchase Invoices and save to platform_integration_invoices & line items
    // Pass the actual iplicit entity ID (not DB UUID) for API-level filtering
    const purchaseInvoicesResult = await syncPurchaseInvoices(
      supabase,
      iplicitDomain,
      sessionToken,
      resolvedConnectionId,
      resolvedOrgId,
      userId,
      mappedIplicitEntityId,
      accountIdToCodeMap,
      accountIdToNameMap,
      knownAccountCodes
    );

    // STEP 4: Fetch Leases from iplicit Lease module and save to lease_master
    const leasesResult = await syncLeases(
      supabase,
      iplicitDomain,
      sessionToken,
      resolvedOrgId
    );

    // STEP 5: Fetch GL Entries for all relevant document types
    const glEntriesResult = await syncGlEntries(
      supabase,
      iplicitDomain,
      sessionToken,
      resolvedConnectionId,
      resolvedOrgId
    );

    let stagingGlRowsInDb: number | null = null;
    try {
      const { count, error: glCountErr } = await supabase
        .from("iplicit_gl_entries")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", resolvedOrgId)
        .eq("connection_id", resolvedConnectionId);
      if (glCountErr) {
        console.warn("[IPLICIT SYNC] Could not count iplicit_gl_entries:", glCountErr.message);
      } else {
        stagingGlRowsInDb = count ?? 0;
        console.log(
          `[IPLICIT SYNC] iplicit_gl_entries rows in DB after GL step: ${stagingGlRowsInDb} ` +
            `(API saved this run: ${glEntriesResult.savedCount})`
        );
      }
    } catch (e) {
      console.warn("[IPLICIT SYNC] staging GL count exception:", e);
    }

    // Populate canonical finance_* tables (journal + accounts) for platform-agnostic reporting
    let canonicalFinance: Awaited<ReturnType<typeof syncCanonicalFinanceFromIplicitEdge>> | null = null;
    try {
      canonicalFinance = await syncCanonicalFinanceFromIplicitEdge(
        supabase,
        resolvedOrgId,
        resolvedConnectionId
      );
      if (canonicalFinance.error) {
        console.warn("[IPLICIT SYNC] Canonical finance:", canonicalFinance.error);
      } else {
        const skipNote = canonicalFinance.skippedReason
          ? ` | ${canonicalFinance.skippedReason}`
          : "";
        console.log(
          `[IPLICIT SYNC] Canonical finance: accounts=${canonicalFinance.accountsUpserted}, ` +
            `journals=${canonicalFinance.journalEntriesUpserted}, lines=${canonicalFinance.journalLinesUpserted}, ` +
            `source_rows=${canonicalFinance.sourceRowCount ?? "n/a"}${skipNote}`
        );
      }
    } catch (canonErr) {
      console.warn("[IPLICIT SYNC] Canonical finance exception:", canonErr);
    }

    // STEP 6: Log service cost accounts found (informational only)
    // Staff Costs page uses the same ACCPAY invoices filtered by account codes
    const plSummary = getServiceCostAccountsSummary(chartOfAccountsResult.data || []);

    // Update connection with new token and sync time
    await supabase
      .from("platform_integrations")
      .update({
        access_token: sessionToken,
        token_expires_at: tokenExpiry,
        is_connected: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", resolvedConnectionId);

    console.log(
      `Sync completed: ${legalEntitiesResult.savedCount} legal entities, ` +
      `${chartOfAccountsResult.savedCount} accounts, ` +
      `${purchaseInvoicesResult.invoicesSaved} invoices, ` +
      `${purchaseInvoicesResult.lineItemsSaved} line items, ` +
      `${glEntriesResult.savedCount} GL entries saved to DB`
    );

    const totalRecords =
      legalEntitiesResult.savedCount +
      chartOfAccountsResult.savedCount +
      purchaseInvoicesResult.invoicesSaved +
      purchaseInvoicesResult.lineItemsSaved +
      glEntriesResult.savedCount;

    return new Response(
      JSON.stringify({
        success: true,
        message: "Sync completed successfully",
        legalEntities: legalEntitiesResult.count,
        legalEntitiesSaved: legalEntitiesResult.savedCount,
        chartOfAccounts: chartOfAccountsResult.count,
        chartOfAccountsSaved: chartOfAccountsResult.savedCount,
        purchaseInvoices: purchaseInvoicesResult.catalogCount,
        purchaseInvoicesSaved: purchaseInvoicesResult.invoicesSaved,
        lineItemsSaved: purchaseInvoicesResult.lineItemsSaved,
        leases: leasesResult.catalogCount,
        leasesSaved: leasesResult.leasesSaved,
        serviceCostAccountsInCoA: plSummary.serviceCostAccounts,
        glEntries: glEntriesResult.count,
        glEntriesSaved: glEntriesResult.savedCount,
        stagingGlRowsInDb,
        canonicalFinance: canonicalFinance
          ? {
              accountsUpserted: canonicalFinance.accountsUpserted,
              journalEntriesUpserted: canonicalFinance.journalEntriesUpserted,
              journalLinesUpserted: canonicalFinance.journalLinesUpserted,
              sourceRowCount: canonicalFinance.sourceRowCount ?? null,
              sourcePlRowCount: canonicalFinance.sourcePlRowCount ?? null,
              sourceBsRowCount: canonicalFinance.sourceBsRowCount ?? null,
              sourceFilterMode: canonicalFinance.sourceFilterMode ?? null,
              skippedReason: canonicalFinance.skippedReason ?? null,
              error: canonicalFinance.error ?? null,
            }
          : null,
        totalRecords,
        data: {
          legalEntities: legalEntitiesResult.data,
          accounts: chartOfAccountsResult.data,
          invoices: purchaseInvoicesResult.invoicesData,
          lineItems: purchaseInvoicesResult.lineItemsData,
        }
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Unexpected error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: "Internal server error", details: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
