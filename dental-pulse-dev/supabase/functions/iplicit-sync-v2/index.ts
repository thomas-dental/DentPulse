import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// ============================================================
// iplicit-sync-v2 — Phase-based sync with concurrency & deadline
// ============================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// --- Constants ---
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;
const BATCH_SIZE = 50;
const CONCURRENT_INVOICE_WORKERS = 5;
const DEADLINE_SECONDS = 140;

// --- Deadline helper ---
let startTime: number;

function hasTimeRemaining(): boolean {
  return (Date.now() - startTime) / 1000 < DEADLINE_SECONDS;
}

// --- Interfaces ---
interface ConnectionRecord {
  id: string;
  organization_id: string;
  client_id: string | null;
  client_secret: string | null;
  access_token: string | null;
  token_expires_at: string | null;
  is_connected: boolean;
  user_id?: string | null;
}

// --- Utility helpers ---

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = MAX_RETRIES
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetch(url, options);
      if (response.ok) return response;
      if (response.status === 401 || response.status === 403) return response;
      lastError = new Error(`HTTP ${response.status}: ${await response.text()}`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
    if (attempt < retries - 1) {
      console.log(`Retry ${attempt + 1}/${retries - 1} after ${RETRY_DELAY_MS * (attempt + 1)}ms`);
      await sleep(RETRY_DELAY_MS * (attempt + 1));
    }
  }

  throw lastError || new Error("Request failed after retries");
}

// deno-lint-ignore no-explicit-any
async function batchUpsert(
  supabase: SupabaseClient<any>,
  tableName: string,
  data: Record<string, unknown>[],
  onConflict: string
): Promise<number> {
  if (data.length === 0) return 0;
  let savedCount = 0;
  for (let i = 0; i < data.length; i += BATCH_SIZE) {
    const batch = data.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from(tableName).upsert(batch, { onConflict });
    if (error) {
      console.error(`Batch upsert error for ${tableName}:`, error);
    } else {
      savedCount += batch.length;
    }
  }
  return savedCount;
}

// ============================================================
// Phase 0: Bootstrap — auth, connection, session, entity ID
// ============================================================

interface BootstrapResult {
  supabase: SupabaseClient;
  connection: ConnectionRecord;
  sessionToken: string;
  tokenExpiry: string;
  domain: string;
  organizationId: string;
  connectionId: string;
  userId: string | null;
  mappedEntityId: string | null;
}

// deno-lint-ignore no-explicit-any
async function phase0Bootstrap(req: Request): Promise<BootstrapResult> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const authHeader = req.headers.get("Authorization");
  const body = await req.json();
  const {
    connectionId,
    organizationId,
    isScheduled = false,
  }: { connectionId?: string; organizationId?: string; isScheduled?: boolean } = body;

  // Auth check
  if (!isScheduled) {
    if (!authHeader) throw new HttpError(401, "Missing authorization header");
    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);
    if (authError || !user) throw new HttpError(401, "Invalid authentication");
  }

  if (!connectionId && !organizationId) {
    throw new HttpError(400, "Missing connectionId or organizationId");
  }

  console.log(`[Phase 0] connectionId=${connectionId}, org=${organizationId}, scheduled=${isScheduled}`);

  // Lookup connection
  let connection: any = null;
  if (connectionId) {
    const { data } = await supabase
      .from("platform_integrations")
      .select("*")
      .eq("id", connectionId)
      .maybeSingle();
    connection = data;
  }
  if (!connection && organizationId) {
    const { data: rows } = await supabase
      .from("platform_integrations")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("platform_name", "iplicit")
      .order("created_at", { ascending: false })
      .limit(1);
    connection = rows?.[0] || null;
  }
  if (!connection) throw new HttpError(404, "Connection not found. Please add iplicit credentials first.");

  const conn = connection as ConnectionRecord;
  const resolvedConnectionId = conn.id;
  const resolvedOrgId = conn.organization_id;
  const domain = conn.client_id;
  const clientSecret = conn.client_secret;

  if (!domain || !clientSecret) throw new HttpError(400, "Invalid connection configuration");

  // Get / refresh session token
  const sessionResult = await getOrRefreshSession(supabase, conn, resolvedConnectionId);
  if (!sessionResult) throw new HttpError(400, "Failed to authenticate with iplicit");

  // Resolve user_id — required NOT NULL for platform_integration_organizations
  let userId: string | null = conn.user_id || null;
  if (!userId) {
    // Fallback: find any user associated with this organization
    try {
      const { data: userRole } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("organization_id", resolvedOrgId)
        .limit(1)
        .maybeSingle();
      if (userRole?.user_id) {
        userId = userRole.user_id;
        console.log(`[Phase 0] Resolved userId from user_roles: ${userId}`);
      }
    } catch (e) {
      console.warn("[Phase 0] Error resolving userId fallback:", e);
    }
  }

  // Resolve mapped entity ID IMMEDIATELY
  let mappedEntityId: string | null = null;
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
        mappedEntityId = String(platformOrg.platform_org_id).trim();
      }
    }
  } catch (e) {
    console.warn("[Phase 0] Error resolving org mapping:", e);
  }

  console.log(`[Phase 0] domain=${domain}, mappedEntityId=${mappedEntityId || "(all entities)"}`);

  return {
    supabase,
    connection: conn,
    sessionToken: sessionResult.sessionToken,
    tokenExpiry: sessionResult.tokenExpiry,
    domain,
    organizationId: resolvedOrgId,
    connectionId: resolvedConnectionId,
    userId,
    mappedEntityId,
  };
}

// deno-lint-ignore no-explicit-any
async function getOrRefreshSession(
  supabase: SupabaseClient<any>,
  connection: ConnectionRecord,
  connectionId: string
): Promise<{ sessionToken: string; tokenExpiry: string } | null> {
  const { client_id: domain, client_secret, access_token, token_expires_at } = connection;
  const [username, apiKey] = (client_secret || "").split("|");
  if (!domain || !username || !apiKey) return null;

  // Reuse valid token
  const expiry = token_expires_at ? new Date(token_expires_at) : null;
  const cutoff = new Date(Date.now() + 5 * 60 * 1000);
  if (expiry && expiry > cutoff && access_token) {
    console.log(`[Phase 0] Token valid until ${token_expires_at}`);
    return { sessionToken: access_token, tokenExpiry: token_expires_at! };
  }

  console.log("[Phase 0] Refreshing iplicit session token...");
  try {
    const res = await fetchWithRetry("https://api.iplicit.com/api/session/create/api", {
      method: "POST",
      headers: { "Content-Type": "application/json", Domain: domain },
      body: JSON.stringify({ username, userApiKey: apiKey }),
    });

    if (!res.ok) {
      console.error(`Session refresh failed: ${await res.text()}`);
      await supabase.from("platform_integrations").update({ is_connected: false }).eq("id", connectionId);
      return null;
    }

    const session: { sessionToken: string; tokenDue: string } = await res.json();
    await supabase
      .from("platform_integrations")
      .update({
        access_token: session.sessionToken,
        token_expires_at: session.tokenDue,
        updated_at: new Date().toISOString(),
      })
      .eq("id", connectionId);

    return { sessionToken: session.sessionToken, tokenExpiry: session.tokenDue };
  } catch (error) {
    console.error("[Phase 0] Session error:", error);
    return null;
  }
}

// ============================================================
// Phase 1: Reference Data (parallel — legal entities + CoA)
// ============================================================

interface Phase1Result {
  legalEntities: { count: number; savedCount: number; data: any[]; savedIds: string[] };
  chartOfAccounts: { count: number; savedCount: number; data: any[] };
  accountIdToCodeMap: Map<string, string>;
  accountIdToNameMap: Map<string, string>;
  knownAccountCodes: Set<string>;
}

// deno-lint-ignore no-explicit-any
async function phase1ReferenceData(ctx: BootstrapResult): Promise<Phase1Result> {
  console.log("[Phase 1] Fetching reference data...");

  const headers = { Domain: ctx.domain, Authorization: `Bearer ${ctx.sessionToken}` };

  // Run entities first so we have the saved org ID for CoA linkage
  const entitiesResult = await syncLegalEntities(ctx.supabase, headers, ctx.connectionId, ctx.organizationId, ctx.userId);
  const platformIntegrationOrgId = entitiesResult.savedIds.length > 0 ? entitiesResult.savedIds[0] : null;

  // Now run CoA with the org ID
  const accountsResult = await syncChartOfAccounts(ctx.supabase, headers, ctx.connectionId, ctx.organizationId, ctx.userId, platformIntegrationOrgId);

  // Build lookup maps from raw CoA data
  const accountIdToCodeMap = new Map<string, string>();
  const accountIdToNameMap = new Map<string, string>();
  const knownAccountCodes = new Set<string>();

  for (const acct of accountsResult.data) {
    const id = acct.id ? String(acct.id).trim() : "";
    const code = acct.code ? String(acct.code).trim() : "";
    const desc = acct.description ? String(acct.description).trim() : "";
    if (id && code) {
      accountIdToCodeMap.set(id, code);
      knownAccountCodes.add(code);
    }
    if (id && desc) accountIdToNameMap.set(id, desc);
  }

  console.log(`[Phase 1] Lookup maps: ${accountIdToCodeMap.size} id→code, ${knownAccountCodes.size} unique codes`);

  return {
    legalEntities: entitiesResult,
    chartOfAccounts: accountsResult,
    accountIdToCodeMap,
    accountIdToNameMap,
    knownAccountCodes,
  };
}

// deno-lint-ignore no-explicit-any
async function syncLegalEntities(
  supabase: SupabaseClient<any>,
  headers: Record<string, string>,
  connectionId: string,
  organizationId: string,
  userId: string | null
): Promise<{ count: number; data: any[]; savedCount: number; savedIds: string[] }> {
  try {
    const res = await fetchWithRetry("https://api.iplicit.com/api/LegalEntity", {
      method: "GET",
      headers,
    });
    if (!res.ok) {
      console.error(`Legal entities fetch failed: ${res.status}`);
      return { count: 0, data: [], savedCount: 0, savedIds: [] };
    }

    const entities = await res.json();
    const arr: any[] = Array.isArray(entities) ? entities : [];
    console.log(`[Phase 1] Fetched ${arr.length} legal entities`);

    const batchData = arr.map((e: any) => ({
      organization_id: organizationId,
      platform_integration_id: connectionId,
      user_id: userId,
      platform_name: "iplicit",
      platform_org_id: e.id || e.legalEntityId,
      platform_org_name: e.description || e.name || e.legalEntityName || e.code || "Unknown",
      platform_org_code: e.code || e.legalEntityCode || null,
      currency: e.currency || e.baseCurrency || null,
      country: e.country || e.countryCode || null,
      status: "active",
      is_selected: arr.length === 1,
      raw_data: e,
      meta_data: { domain: headers.Domain, isActive: e.isActive },
      updated_at: new Date().toISOString(),
    }));

    const { data: upsertData, error } = await supabase
      .from("platform_integration_organizations")
      .upsert(batchData, { onConflict: "platform_integration_id,platform_org_id" })
      .select("id");

    if (error) {
      console.error("Legal entity upsert error:", error);
      return { count: arr.length, data: arr, savedCount: 0, savedIds: [] };
    }

    const savedIds = upsertData?.map((d: any) => d.id) || [];
    console.log(`[Phase 1] Saved ${savedIds.length}/${arr.length} legal entities`);
    return { count: arr.length, data: arr, savedCount: savedIds.length, savedIds };
  } catch (error) {
    console.error("Legal entity sync error:", error);
    return { count: 0, data: [], savedCount: 0, savedIds: [] };
  }
}

// deno-lint-ignore no-explicit-any
async function syncChartOfAccounts(
  supabase: SupabaseClient<any>,
  headers: Record<string, string>,
  connectionId: string,
  organizationId: string,
  userId: string | null,
  platformIntegrationOrgId: string | null
): Promise<{ count: number; data: any[]; savedCount: number }> {
  try {
    const res = await fetchWithRetry("https://api.iplicit.com/api/Catalog/Account", {
      method: "GET",
      headers,
    });
    if (!res.ok) {
      console.error(`Chart of Accounts fetch failed: ${res.status}`);
      return { count: 0, data: [], savedCount: 0 };
    }

    const accounts = await res.json();
    const arr: any[] = Array.isArray(accounts) ? accounts : [];
    console.log(`[Phase 1] Fetched ${arr.length} accounts`);

    const batchData = arr.map((a: any) => ({
      organization_id: organizationId,
      platform_integration_id: connectionId,
      platform_integration_organization_id: platformIntegrationOrgId,
      user_id: userId,
      platform_name: "iplicit",
      coa_account_id: a.id,
      coa_account_code: a.code || null,
      coa_account_name: a.description || a.code || "Unknown",
      coa_account_type: "Account",
      coa_description: a.description || null,
      coa_is_active: a.isActive !== undefined ? a.isActive : true,
    }));

    let savedCount = 0;
    for (let i = 0; i < batchData.length; i += BATCH_SIZE) {
      const batch = batchData.slice(i, i + BATCH_SIZE);
      const { error } = await supabase
        .from("platform_integration_chart_of_accounts")
        .upsert(batch, { onConflict: "organization_id,platform_integration_id,coa_account_id" });
      if (!error) savedCount += batch.length;
      else console.error("CoA batch upsert error:", error);
    }

    console.log(`[Phase 1] Saved ${savedCount}/${arr.length} accounts`);
    return { count: arr.length, data: arr, savedCount };
  } catch (error) {
    console.error("CoA sync error:", error);
    return { count: 0, data: [], savedCount: 0 };
  }
}

// ============================================================
// Phase 2: Purchase Invoices — concurrent workers + delete/insert
// ============================================================

interface Phase2Result {
  catalogCount: number;
  invoicesSaved: number;
  lineItemsSaved: number;
}

// deno-lint-ignore no-explicit-any
async function phase2PurchaseInvoices(
  ctx: BootstrapResult,
  maps: {
    accountIdToCodeMap: Map<string, string>;
    accountIdToNameMap: Map<string, string>;
    knownAccountCodes: Set<string>;
  }
): Promise<Phase2Result> {
  console.log("[Phase 2] Syncing purchase invoices...");
  const result: Phase2Result = { catalogCount: 0, invoicesSaved: 0, lineItemsSaved: 0 };

  const headers = { Domain: ctx.domain, Authorization: `Bearer ${ctx.sessionToken}` };

  // Fetch catalog
  let catalogUrl = "https://api.iplicit.com/api/Catalog/PurchaseInvoice";
  if (ctx.mappedEntityId) {
    catalogUrl += `?legalEntityId=${encodeURIComponent(ctx.mappedEntityId)}`;
    console.log(`[Phase 2] Catalog filtered by legalEntityId: ${ctx.mappedEntityId}`);
  }

  const catalogRes = await fetchWithRetry(catalogUrl, { method: "GET", headers });
  if (!catalogRes.ok) {
    console.error(`[Phase 2] Catalog fetch failed: ${catalogRes.status}`);
    return result;
  }

  let catalog: any[] = await catalogRes.json();
  catalog = Array.isArray(catalog) ? catalog : [];
  result.catalogCount = catalog.length;
  console.log(`[Phase 2] Catalog returned ${catalog.length} invoices`);

  if (catalog.length === 0) return result;

  // Local entity filter as safety net
  if (ctx.mappedEntityId && catalog.length > 0 && catalog[0].legalEntityId) {
    const before = catalog.length;
    catalog = catalog.filter((e: any) => e.legalEntityId === ctx.mappedEntityId);
    console.log(`[Phase 2] Entity filter: ${catalog.length}/${before} match`);
    result.catalogCount = catalog.length;
  }

  // Log first catalog entry for debugging
  if (catalog.length > 0) {
    console.log(`[Phase 2] Catalog[0] keys:`, Object.keys(catalog[0]));
  }

  // Split catalog into chunks for concurrent workers
  const chunks = splitIntoChunks(catalog, CONCURRENT_INVOICE_WORKERS);
  console.log(`[Phase 2] ${catalog.length} invoices → ${chunks.length} worker(s)`);

  // Process all chunks concurrently
  const workerResults = await Promise.all(
    chunks.map((chunk, workerIndex) =>
      processInvoiceChunk(ctx, headers, chunk, maps, workerIndex)
    )
  );

  // Aggregate results
  for (const wr of workerResults) {
    result.invoicesSaved += wr.invoicesSaved;
    result.lineItemsSaved += wr.lineItemsSaved;
  }

  console.log(`[Phase 2] Complete: ${result.invoicesSaved} invoices, ${result.lineItemsSaved} line items`);
  return result;
}

function splitIntoChunks<T>(arr: T[], numChunks: number): T[][] {
  const chunks: T[][] = [];
  const chunkSize = Math.ceil(arr.length / numChunks);
  for (let i = 0; i < arr.length; i += chunkSize) {
    chunks.push(arr.slice(i, i + chunkSize));
  }
  return chunks;
}

function mapInvoiceStatus(statusList: string[]): string {
  if (!statusList || statusList.length === 0) return "draft";
  if (statusList.includes("voided")) return "voided";
  if (statusList.includes("paid")) return "paid";
  if (statusList.includes("posted") || statusList.includes("approved")) return "authorised";
  if (statusList.includes("draft")) return "draft";
  return statusList[0] || "draft";
}

// deno-lint-ignore no-explicit-any
async function processInvoiceChunk(
  ctx: BootstrapResult,
  headers: Record<string, string>,
  chunk: any[],
  maps: {
    accountIdToCodeMap: Map<string, string>;
    accountIdToNameMap: Map<string, string>;
    knownAccountCodes: Set<string>;
  },
  workerIndex: number
): Promise<{ invoicesSaved: number; lineItemsSaved: number }> {
  const allInvoices: Record<string, unknown>[] = [];
  const allLineItems: Record<string, unknown>[] = [];
  let detailsFetched = 0;

  for (const entry of chunk) {
    if (!hasTimeRemaining()) {
      console.warn(`[Worker ${workerIndex}] Deadline approaching, stopping after ${detailsFetched} invoices`);
      break;
    }

    const invoiceId = entry.id;
    if (!invoiceId) continue;

    try {
      const detailRes = await fetchWithRetry(
        `https://api.iplicit.com/api/PurchaseInvoice/${invoiceId}`,
        { method: "GET", headers }
      );

      if (!detailRes.ok) {
        console.error(`[Worker ${workerIndex}] Invoice ${invoiceId} detail failed: ${detailRes.status}`);
        continue;
      }

      const inv = await detailRes.json();
      detailsFetched++;

      // Debug first 2 invoices per worker
      if (detailsFetched <= 2) {
        console.log(`[Worker ${workerIndex}] Invoice ${inv.docNo} keys:`, Object.keys(inv));
      }

      // Map invoice
      const isPaid = inv.outstandingAmount === 0 || inv.outstandingCurrencyAmount === 0;
      const statusText = mapInvoiceStatus(inv.statusList || []);

      allInvoices.push({
        organization_id: ctx.organizationId,
        user_id: ctx.userId,
        platform_type: "iplicit",
        platform_invoice_id: inv.id,
        invoice_number: inv.docNo || null,
        invoice_type: "ACCPAY",
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
          inv.contactAccountDescription ||
          inv.contactDescription ||
          inv.supplierName ||
          inv.description ||
          null,
        site_id:
          (inv.legalEntityId ? String(inv.legalEntityId).trim() : null) ||
          (inv.locationId ? String(inv.locationId).trim() : null) ||
          null,
        line_amount_types: inv.isNetEntry ? "Exclusive" : "Inclusive",
        api_record_created_at: inv.createdDate || null,
        api_record_updated_at: inv.lastModified || null,
        last_synced_at: new Date().toISOString(),
        sync_status: "synced",
        updated_at: new Date().toISOString(),
      });

      // Map line items
      const details: any[] = Array.isArray(inv.details) ? inv.details : [];
      for (let idx = 0; idx < details.length; idx++) {
        const item = details[idx] as Record<string, unknown>;
        const platformLineId = (item.id as string) || `${inv.id}_${idx}`;

        // Resolve account ID
        let rawAccountId: unknown =
          item.accountId ?? item.nominalAccountId ?? item.glAccountId ?? null;
        if (rawAccountId && typeof rawAccountId === "object") {
          rawAccountId =
            (rawAccountId as Record<string, unknown>).id ??
            (rawAccountId as Record<string, unknown>).code ??
            null;
        }
        const itemAccountId =
          rawAccountId != null && rawAccountId !== "" ? String(rawAccountId).trim() : null;

        // Strategy 1: Direct account code from item fields
        const directCode =
          (item.accountCode != null ? String(item.accountCode).trim() : null) ||
          (item.nominalCode != null ? String(item.nominalCode).trim() : null) ||
          (item.glCode != null ? String(item.glCode).trim() : null) ||
          (typeof item.account === "string" ? String(item.account).trim() : null) ||
          (item.account &&
          typeof item.account === "object" &&
          (item.account as Record<string, unknown>).code
            ? String((item.account as Record<string, unknown>).code).trim()
            : null) ||
          null;

        // Strategy 2: Map lookup (accountId → code)
        let resolvedCode: string | null = directCode;
        if (!resolvedCode && itemAccountId && maps.accountIdToCodeMap) {
          resolvedCode = maps.accountIdToCodeMap.get(itemAccountId) || null;
        }

        // Strategy 3: accountId IS itself a known account code
        if (!resolvedCode && itemAccountId && maps.knownAccountCodes.has(itemAccountId)) {
          resolvedCode = itemAccountId;
        }

        // Resolve account name
        const resolvedName: string | null =
          (itemAccountId && maps.accountIdToNameMap
            ? maps.accountIdToNameMap.get(itemAccountId) || null
            : null) ||
          (item.accountDescription != null
            ? String(item.accountDescription).trim()
            : null) ||
          (item.nominalAccountDescription != null
            ? String(item.nominalAccountDescription).trim()
            : null) ||
          null;

        allLineItems.push({
          organization_id: ctx.organizationId,
          platform_line_id: platformLineId,
          invoice_id: inv.id as string,
          line_number: (item.orderIndex as number) || idx + 1,
          description: (item.description as string) || null,
          quantity: (item.quantity as number) || 0,
          unit_amount: (item.netCurrencyUnitPrice as number) || 0,
          line_amount: (item.netCurrencyAmount as number) || 0,
          tax_amount: (item.taxCurrencyAmount as number) || 0,
          tax_rate: (item.taxRate as number) || 0,
          account_id: itemAccountId,
          account_code: resolvedCode,
          account_name: resolvedName,
        });
      }
    } catch (err) {
      console.error(`[Worker ${workerIndex}] Error processing invoice ${invoiceId}:`, err);
    }
  }

  // Account resolution summary
  const withCode = allLineItems.filter((li) => li.account_code).length;
  const withName = allLineItems.filter((li) => li.account_name).length;
  console.log(
    `[Worker ${workerIndex}] ${detailsFetched} invoices, ${allLineItems.length} line items (${withCode} w/ code, ${withName} w/ name)`
  );

  // --- Save: upsert invoices ---
  const invoicesSaved = await batchUpsert(
    ctx.supabase,
    "platform_integration_invoices",
    allInvoices,
    "organization_id,platform_type,platform_invoice_id"
  );

  // --- Save: DELETE + INSERT line items per batch of invoice IDs ---
  let lineItemsSaved = 0;
  const invoiceIds = allInvoices.map((inv) => inv.platform_invoice_id as string).filter(Boolean);

  for (let i = 0; i < invoiceIds.length; i += BATCH_SIZE) {
    const batchIds = invoiceIds.slice(i, i + BATCH_SIZE);

    // Delete existing line items for these invoices
    const { error: delError } = await ctx.supabase
      .from("platform_integration_invoice_line_items")
      .delete()
      .eq("organization_id", ctx.organizationId)
      .in("invoice_id", batchIds);

    if (delError) {
      console.error(`[Worker ${workerIndex}] Line item delete error:`, delError);
    }

    // Insert fresh line items for these invoices
    const batchLineItems = allLineItems.filter((li) =>
      batchIds.includes(li.invoice_id as string)
    );

    if (batchLineItems.length > 0) {
      // Insert in sub-batches
      for (let j = 0; j < batchLineItems.length; j += BATCH_SIZE) {
        const subBatch = batchLineItems.slice(j, j + BATCH_SIZE);
        const { error: insertError } = await ctx.supabase
          .from("platform_integration_invoice_line_items")
          .insert(subBatch);

        if (insertError) {
          console.error(`[Worker ${workerIndex}] Line item insert error:`, insertError);
        } else {
          lineItemsSaved += subBatch.length;
        }
      }
    }
  }

  return { invoicesSaved, lineItemsSaved };
}

// ============================================================
// Phase 3: Leases
// ============================================================

interface Phase3Result {
  catalogCount: number;
  leasesSaved: number;
}

async function phase3Leases(ctx: BootstrapResult): Promise<Phase3Result> {
  console.log("[Phase 3] Syncing leases...");
  const result: Phase3Result = { catalogCount: 0, leasesSaved: 0 };

  const headers = { Domain: ctx.domain, Authorization: `Bearer ${ctx.sessionToken}` };

  try {
    const catalogRes = await fetchWithRetry("https://api.iplicit.com/api/Catalog/Lease", {
      method: "GET",
      headers,
    });
    if (!catalogRes.ok) {
      console.error(`[Phase 3] Lease catalog failed: ${catalogRes.status}`);
      return result;
    }

    const catalog = await catalogRes.json();
    const arr: any[] = Array.isArray(catalog) ? catalog : [];
    result.catalogCount = arr.length;
    console.log(`[Phase 3] Fetched ${arr.length} leases from catalog`);

    if (arr.length === 0) return result;

    const allLeases: Record<string, unknown>[] = [];

    for (const entry of arr) {
      if (!hasTimeRemaining()) {
        console.warn("[Phase 3] Deadline approaching, stopping lease fetch");
        break;
      }

      const leaseId = entry.id;
      if (!leaseId) continue;

      try {
        const detailRes = await fetchWithRetry(`https://api.iplicit.com/api/Lease/${leaseId}`, {
          method: "GET",
          headers,
        });
        if (!detailRes.ok) continue;

        const lease = await detailRes.json();

        const leaseCode =
          lease.code || lease.leaseCode || entry.code || `LEASE-${leaseId}`;
        const leaseName =
          lease.propertyName ||
          lease.property ||
          lease.description ||
          lease.name ||
          entry.description ||
          leaseCode;
        const leaseDescription =
          lease.description || lease.leaseDescription || entry.description || "";
        const contactName =
          lease.contactAccountDescription ||
          lease.contactDescription ||
          lease.supplierName ||
          lease.landlord ||
          null;
        const contactId = lease.contactAccountId || lease.contactId || null;
        // lease_start_date and lease_end_date are NOT NULL in schema — use today as fallback
        const todayStr = new Date().toISOString().split("T")[0];
        const startDate = lease.startDate ? lease.startDate.split("T")[0] : todayStr;
        const endDate = lease.endDate ? lease.endDate.split("T")[0] : todayStr;
        const amount =
          lease.amount || lease.rentAmount || lease.leaseAmount || lease.value || 0;
        const currency = lease.currency || lease.baseCurrency || "GBP";

        const category = determineLeaseCategoryFromDescription(leaseDescription || leaseName);
        const status = computeLeaseStatus(startDate, endDate);

        allLeases.push({
          organization_id: ctx.organizationId,
          lease_reference: leaseCode,
          lease_name: leaseName,
          lease_description: leaseDescription,
          lease_category: category,
          xero_contact_id: contactId,
          xero_contact_name: contactName,
          lease_start_date: startDate,
          lease_end_date: endDate,
          monthly_rent: amount,
          currency,
          status,
          updated_at: new Date().toISOString(),
        });
      } catch (err) {
        console.error(`[Phase 3] Lease ${leaseId} error:`, err);
      }
    }

    if (allLeases.length > 0) {
      result.leasesSaved = await batchUpsert(
        ctx.supabase,
        "lease_master",
        allLeases,
        "organization_id,lease_reference"
      );
    }

    console.log(`[Phase 3] Saved ${result.leasesSaved}/${result.catalogCount} leases`);
    return result;
  } catch (error) {
    console.error("[Phase 3] Lease sync error:", error);
    return result;
  }
}

function determineLeaseCategoryFromDescription(description: string): string {
  const text = (description || "").toLowerCase();
  if (/property|building|premises|office|rent|occupancy/.test(text)) return "building";
  if (/equipment|machine|dental|chair|autoclave|x-ray/.test(text)) return "equipment";
  if (/vehicle|car|van|motor|transport/.test(text)) return "vehicle";
  if (/software|it|computer|license|saas|cloud/.test(text)) return "it_software";
  return "other";
}

function computeLeaseStatus(startDate: string | null, endDate: string | null): string {
  if (!endDate) return "active";
  const now = new Date();
  const end = new Date(endDate);
  if (end < now) return "expired";
  const threeMonths = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
  if (end <= threeMonths) return "expiring_soon";
  return "active";
}

// ============================================================
// Phase 4: Finalize — update connection, build response
// ============================================================

// deno-lint-ignore no-explicit-any
function getServiceCostAccountsSummary(data: any[]): number {
  return data.filter((a: any) => {
    const code = String(a.code || "").trim();
    return /^[45]\d{2,}/.test(code);
  }).length;
}

// ============================================================
// HttpError helper
// ============================================================

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// ============================================================
// Main handler
// ============================================================

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  startTime = Date.now();

  try {
    // Phase 0: Bootstrap
    const ctx = await phase0Bootstrap(req);

    // Phase 1: Reference data (parallel)
    const phase1 = await phase1ReferenceData(ctx);

    // Phase 2: Purchase invoices (concurrent workers)
    const phase2 = await phase2PurchaseInvoices(ctx, {
      accountIdToCodeMap: phase1.accountIdToCodeMap,
      accountIdToNameMap: phase1.accountIdToNameMap,
      knownAccountCodes: phase1.knownAccountCodes,
    });

    // Phase 3: Leases
    const phase3 = await phase3Leases(ctx);

    // Phase 4: Finalize
    const serviceCostCount = getServiceCostAccountsSummary(phase1.chartOfAccounts.data || []);

    await ctx.supabase
      .from("platform_integrations")
      .update({
        access_token: ctx.sessionToken,
        token_expires_at: ctx.tokenExpiry,
        is_connected: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", ctx.connectionId);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(
      `[Phase 4] Sync complete in ${elapsed}s: ` +
        `${phase1.legalEntities.savedCount} entities, ${phase1.chartOfAccounts.savedCount} accounts, ` +
        `${phase2.invoicesSaved} invoices, ${phase2.lineItemsSaved} line items, ` +
        `${phase3.leasesSaved} leases`
    );

    const response: Record<string, unknown> = {
      success: true,
      message: "Sync completed successfully",
      legalEntities: phase1.legalEntities.count,
      legalEntitiesSaved: phase1.legalEntities.savedCount,
      chartOfAccounts: phase1.chartOfAccounts.count,
      chartOfAccountsSaved: phase1.chartOfAccounts.savedCount,
      purchaseInvoices: phase2.catalogCount,
      purchaseInvoicesSaved: phase2.invoicesSaved,
      lineItemsSaved: phase2.lineItemsSaved,
      leases: phase3.catalogCount,
      leasesSaved: phase3.leasesSaved,
      serviceCostAccountsInCoA: serviceCostCount,
      data: {
        legalEntities: phase1.legalEntities.data,
        accounts: phase1.chartOfAccounts.data,
      },
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    if (error instanceof HttpError) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: error.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.error("Unexpected error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: "Internal server error", details: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
