import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

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
      console.error(`Failed to fetch Legal Entities: ${response.status}`);
      return { count: 0, data: [], savedCount: 0, savedIds: [] };
    }

    const entities = await response.json();
    const entityArray = Array.isArray(entities) ? entities : [];

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
      console.error(`Failed to fetch Chart of Accounts: ${response.status}`);
      return { count: 0, data: [], savedCount: 0 };
    }

    const accounts = await response.json();
    const accountArray = Array.isArray(accounts) ? accounts : [];

    console.log(`Fetched ${accountArray.length} accounts from iplicit Catalog`);

    // Prepare batch data
    const batchData = accountArray.map((account: any) => ({
      organization_id: organizationId,
      platform_integration_id: connectionId,
      platform_integration_organization_id: platformIntegrationOrgId,
      user_id: userId,
      platform_name: "iplicit",
      coa_account_id: account.id,
      coa_account_code: account.code || null,
      coa_account_name: account.description || account.code || "Unknown",
      coa_account_type: "Account",
      coa_description: account.description || null,
      coa_is_active: account.isActive !== undefined ? account.isActive : true,
    }));

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

// deno-lint-ignore no-explicit-any
async function syncPurchaseInvoices(
  supabase: SupabaseClient<any>,
  domain: string,
  sessionToken: string,
  connectionId: string,
  organizationId: string,
  userId: string | null,
  legalEntityId: string | null,
  accountIdToCodeMap?: Map<string, string>
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
      console.error(`Failed to fetch Purchase Invoice catalog: ${catalogResponse.status}`);
      return result;
    }

    const catalog = await catalogResponse.json();
    let catalogArray = Array.isArray(catalog) ? catalog : [];
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
          contact_name: inv.contactAccountDescription || inv.contactDescription || inv.supplierName || inv.description || null,
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
          console.log(`[DEBUG] Invoice ${inv.docNo} contact fields: contactAccountId=${inv.contactAccountId}, contactAccountDescription=${inv.contactAccountDescription}, contactDescription=${inv.contactDescription}, supplierName=${inv.supplierName}, description=${inv.description}`);
          if (details.length > 0) {
            console.log(`[DEBUG] Invoice ${inv.docNo} line item[0] keys:`, Object.keys(details[0]));
            console.log(`[DEBUG] Invoice ${inv.docNo} line item[0] sample:`, JSON.stringify(details[0]).substring(0, 500));
          }
        }

        for (let index = 0; index < details.length; index++) {
          const item = details[index] as Record<string, unknown>;
          const platformLineId = (item.id as string) || `${inv.id}_${index}`;

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

    // --- 3d: Clean up duplicate line items, then upsert ---
    // First remove any existing duplicate rows so the upsert (unique constraint) works correctly
    const processedInvoiceIds = allInvoiceData.map((inv) => inv.platform_invoice_id as string).filter(Boolean);
    if (processedInvoiceIds.length > 0) {
      for (let i = 0; i < processedInvoiceIds.length; i += BATCH_SIZE) {
        const batch = processedInvoiceIds.slice(i, i + BATCH_SIZE);
        const { data: existing } = await supabase
          .from("platform_integration_invoice_line_items")
          .select("id, platform_line_id, invoice_id")
          .eq("organization_id", organizationId)
          .in("invoice_id", batch);

        if (existing && existing.length > 0) {
          // Group by (invoice_id + platform_line_id) and collect duplicate IDs
          const seen = new Map<string, string>();
          const dupeIds: string[] = [];
          for (const row of existing) {
            const key = `${row.invoice_id}__${row.platform_line_id ?? ""}`;
            if (seen.has(key)) {
              dupeIds.push(row.id); // keep the first occurrence, mark rest for deletion
            } else {
              seen.set(key, row.id);
            }
          }
          if (dupeIds.length > 0) {
            console.log(`Cleaning ${dupeIds.length} duplicate line items for batch...`);
            for (let d = 0; d < dupeIds.length; d += BATCH_SIZE) {
              const delBatch = dupeIds.slice(d, d + BATCH_SIZE);
              await supabase
                .from("platform_integration_invoice_line_items")
                .delete()
                .in("id", delBatch);
            }
          }
        }
      }
    }

    // Upsert line items — same data gets updated, new data gets inserted
    console.log(`Upserting ${allLineItemData.length} line items...`);
    result.lineItemsSaved = await batchUpsert(
      supabase,
      "platform_integration_invoice_line_items",
      allLineItemData,
      "organization_id,platform_line_id,invoice_id"
    );
    result.lineItemsData = allLineItemData;

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

    // STEP 5: Log service cost accounts found (informational only)
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

    console.log(`[IPLICIT SYNC COMPLETE] Legal Entities: ${legalEntitiesResult.savedCount}, COA: ${chartOfAccountsResult.savedCount}, Invoices: ${purchaseInvoicesResult.invoicesSaved}, Line Items: ${purchaseInvoicesResult.lineItemsSaved}`);

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
