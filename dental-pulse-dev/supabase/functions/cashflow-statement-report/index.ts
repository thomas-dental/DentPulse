import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  countJournalLinesForSource,
  fetchCanonicalStatementRowsLikePlBs,
  getIplicitFinanceSourceId,
  sumCanonicalBankOpeningBalance,
} from "./cashflowCanonicalStatement.ts";
import { tryLoadXeroCanonicalBankStatement } from "./xeroCanonicalStatement.ts";
import {
  rebaseStatementRunningBalances,
  resolveXeroBankClosingBalanceForStatement,
  resolveXeroBankOpeningBalanceForStatement,
  tryLoadXeroJournalBankStatement,
} from "./xeroJournalStatement.ts";
import {
  getIplicitTransactionLink,
  getXeroTransactionLink,
  xeroBankFeedLinkType,
  type AccountingPlatform,
} from "./accountingTransactionLinks.ts";
import { resolveXeroTrackingScope } from "../_shared/xeroTrackingScope.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Transaction row for "Transactions to Review" – matches frontend TransactionToReview */
interface TransactionToReview {
  id: string;
  date: string;
  transactionType: string;
  transactionLink?: string;
  name: string;
  memoOrDescription: string;
  location: string;
  split: string;
  debit: string;
  credit: string;
  balance: string;
}

/** Internal extended type for filtering – includes numeric values and lowercased strings */
interface TransactionToReviewInternal extends TransactionToReview {
  _debitNum: number;
  _creditNum: number;
  _balanceNum: number;
  _nameLower: string;
  _memoLower: string;
}

interface StatementReportRequestBody {
  organizationId: string;
  fromDate: string;
  toDate: string;
  locationId?: string | null;
  onlyTransactionWithIssue?: boolean;
  isOriginData?: boolean;
  categoryIds?: string;
  transactionTypes?: string;
  name?: string;
  memoOrDescription?: string;
  /** Comma-separated "Who Paid" (location) values to include */
  whoPaid?: string | null;
  /** Comma-separated "For What" (split) values to include */
  forWhat?: string | null;
  debitMin?: number | null;
  debitMax?: number | null;
  creditMin?: number | null;
  creditMax?: number | null;
  balanceMin?: number | null;
  balanceMax?: number | null;
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatDate(d: string): string {
  const iso = String(d || "").slice(0, 10);
  const parsed = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (parsed) {
    return `${Number(parsed[3])} ${MONTH_NAMES[Number(parsed[2]) - 1]} ${parsed[1]}`;
  }
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return String(d || "");
  return `${date.getUTCDate()} ${MONTH_NAMES[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function formatMoney(value: number | null | undefined, currency = "£"): string {
  if (value == null || value === 0) return "–";
  const abs = Math.abs(value);
  const formatted = abs.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return value < 0 ? `(${currency}${formatted})` : `${currency}${formatted}`;
}

/** Normalise iplicit account_id for Map lookups (avoids string/UUID mismatch). */
function normAccountId(id: unknown): string {
  return id != null && id !== "" ? String(id).trim() : "";
}

async function resolvePreferredIplicitConnectionId(
  supabase: ReturnType<typeof createClient>,
  organizationId: string
): Promise<string | null> {
  const { data: iplicitConnections, error: iplicitError } = await supabase
    .from("platform_integrations")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("platform_name", "iplicit")
    .eq("is_connected", true);

  if (iplicitError || !iplicitConnections || iplicitConnections.length === 0) {
    return null;
  }

  const connectedIds = new Set(
    (iplicitConnections as { id: string }[]).map((r) => String(r.id).trim()).filter(Boolean)
  );

  const { data: mappingRows } = await supabase
    .from("category_range_map")
    .select("platform_integration_id")
    .eq("organization_id", organizationId)
    .not("platform_integration_id", "is", null);

  const counts = new Map<string, number>();
  for (const row of (mappingRows || []) as { platform_integration_id: string | null }[]) {
    const id = row.platform_integration_id ? String(row.platform_integration_id).trim() : "";
    if (!id || !connectedIds.has(id)) continue;
    counts.set(id, (counts.get(id) || 0) + 1);
  }

  if (counts.size > 0) {
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }

  const { data: latestIplicit } = await supabase
    .from("platform_integrations")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("platform_name", "iplicit")
    .eq("is_connected", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return latestIplicit?.id ? String(latestIplicit.id) : null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const traceId = crypto.randomUUID();
    const log = (stage: string, meta: Record<string, unknown> = {}) => {
      console.log(
        JSON.stringify({
          scope: "cashflow-statement-report",
          traceId,
          stage,
          ...meta,
        })
      );
    };

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid authentication" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as StatementReportRequestBody;
    const {
      organizationId,
      fromDate,
      toDate,
      locationId,
      transactionTypes,
      name,
      memoOrDescription,
      whoPaid,
      forWhat,
      debitMin,
      debitMax,
      creditMin,
      creditMax,
      balanceMin,
      balanceMax,
    } = body;

    log("request.received", {
      organizationId,
      fromDate,
      toDate,
      locationId: locationId ?? null,
      transactionTypes: transactionTypes ?? "",
      name: name ?? "",
      memoOrDescription: memoOrDescription ?? "",
      debitMin: debitMin ?? null,
      debitMax: debitMax ?? null,
      creditMin: creditMin ?? null,
      creditMax: creditMax ?? null,
      balanceMin: balanceMin ?? null,
      balanceMax: balanceMax ?? null,
      userId: user.id,
    });

    if (!organizationId || !fromDate || !toDate) {
      return new Response(
        JSON.stringify({ error: "Missing organizationId, fromDate or toDate", transactionStatus: 0, resultMsg: "Bad request" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Resolve connections, preferring location-mapped integrations when provided.
    let iplicitConnectionId: string | null = null;
    let xeroConnectionIdFromLocation: string | null = null;
    let mappedLegalEntityId: string | null = null;

    // 1) Try location-specific mapping first (practice location → platform organization → integration)
    if (locationId) {
      try {
        const { data: mappingRows, error: mappingError } = await supabase
          .from("platform_integration_organization_mapping")
          .select(`
            platform_integration_id,
            platform_integration_organizations!inner (
              platform_name,
              platform_org_id
            )
          `)
          .eq("organization_id", organizationId)
          .eq("location_id", locationId);

        if (mappingError) {
          console.error("iplicit location mapping error:", mappingError);
        }

        const iplicitMapping = (mappingRows || []).find(
          (m: any) => m.platform_integration_organizations?.platform_name === "iplicit"
        );
        const xeroMapping = (mappingRows || []).find(
          (m: any) => m.platform_integration_organizations?.platform_name === "xero"
        );

        if (iplicitMapping?.platform_integration_id) {
          const { data: piConn } = await supabase
            .from("platform_integrations")
            .select("is_connected")
            .eq("id", iplicitMapping.platform_integration_id)
            .maybeSingle();
          if (piConn?.is_connected) {
            iplicitConnectionId = String(iplicitMapping.platform_integration_id);
          }
        }

        const mappedOrg = (iplicitMapping as any)?.platform_integration_organizations;
        if (mappedOrg?.platform_org_id) {
          mappedLegalEntityId = String(mappedOrg.platform_org_id).trim();
        }

        if (xeroMapping?.platform_integration_id) {
          const { data: xeroConn } = await supabase
            .from("platform_integrations")
            .select("is_connected")
            .eq("id", xeroMapping.platform_integration_id)
            .maybeSingle();
          if (xeroConn?.is_connected) {
            xeroConnectionIdFromLocation = String(xeroMapping.platform_integration_id);
            // For Xero, mapped legal entity corresponds to tenant id.
            const mappedXeroOrg = (xeroMapping as any)?.platform_integration_organizations;
            if (!mappedLegalEntityId && mappedXeroOrg?.platform_org_id) {
              mappedLegalEntityId = String(mappedXeroOrg.platform_org_id).trim();
            }
          }
        }
      } catch (mappingErr) {
        console.warn("iplicit location mapping lookup failed:", mappingErr);
      }
    }

    // 2) Fallback: any connected iplicit integration for this organization (legacy behaviour / All Locations)
    if (!iplicitConnectionId) {
      iplicitConnectionId = await resolvePreferredIplicitConnectionId(supabase, organizationId);
    }

    /** Used to scope Xero canonical + bank feed queries to a connection that actually has data. */
    let xeroIntegrationIdForBank: string | null = xeroConnectionIdFromLocation;
    if (!xeroIntegrationIdForBank) {
      const { data: connectedXeroIntegrations } = await supabase
        .from("platform_integrations")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("platform_name", "xero")
        .eq("is_connected", true)
        .order("updated_at", { ascending: false });

      const connectedXeroIds = (connectedXeroIntegrations || [])
        .map((row: any) => String(row.id || "").trim())
        .filter(Boolean);

      if (connectedXeroIds.length > 0) {
        const { data: xeroSources } = await supabase
          .from("finance_data_sources")
          .select("platform_integration_id")
          .eq("organization_id", organizationId)
          .eq("platform", "xero")
          .in("platform_integration_id", connectedXeroIds);

        const sourceBackedXeroIds = new Set(
          (xeroSources || [])
            .map((row: any) => String(row.platform_integration_id || "").trim())
            .filter(Boolean)
        );

        xeroIntegrationIdForBank =
          connectedXeroIds.find((id) => sourceBackedXeroIds.has(id)) ?? connectedXeroIds[0] ?? null;
      }
    }

    log("connection.resolved", {
      hasIplicitConnection: !!iplicitConnectionId,
      iplicitConnectionId,
      xeroIntegrationIdForBank,
      xeroConnectionIdFromLocation,
      locationId: locationId ?? null,
      mappedLegalEntityId: mappedLegalEntityId ?? null,
    });

    const xeroTrackingScope = xeroIntegrationIdForBank
      ? await resolveXeroTrackingScope(
          supabase,
          organizationId,
          xeroIntegrationIdForBank,
          locationId ?? null
        )
      : null;
    if (xeroTrackingScope?.excludeFromFinancialDisplay) {
      return new Response(
        JSON.stringify({
          returnObject: [],
          totalMoneyIn: 0,
          totalMoneyOut: 0,
          closingBalance: 0,
          whoPaidOptions: [],
          forWhatOptions: [],
          transactionTypeOptions: [],
          accountingPlatform: "xero",
          transactionStatus: 8,
          resultMsg: "Location excluded from financial display",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const trackingOptionIds = xeroTrackingScope?.trackingOptionIds ?? [];
    const trackingMapped =
      trackingOptionIds.length > 0 || (xeroTrackingScope?.optionScopes?.length ?? 0) > 0;
    log("xero.tracking-scope", {
      locationId: locationId || "all",
      trackingOptionCount: trackingOptionIds.length,
      tenantOrgRowCount: xeroTrackingScope?.tenantOrgRowIds.length ?? 0,
      trackingMapped,
    });

    let list: TransactionToReviewInternal[] = [];
    let rows: Record<string, unknown>[] = [];
    let accountingPlatform: AccountingPlatform | null = null;
    let iplicitDomain: string | null = null;

    if (iplicitConnectionId) {
      // Source: iplicit_profit_loss (bank account type records only) – joined with COA for bank filter
      const connectionId = iplicitConnectionId;

      const { data: iplicitConnRow } = await supabase
        .from("platform_integrations")
        .select("iplicit_domain, client_id")
        .eq("id", connectionId)
        .maybeSingle();
      iplicitDomain =
        String(iplicitConnRow?.iplicit_domain || iplicitConnRow?.client_id || "").trim() || null;

      // Bank accounts: from iplicit_chart_of_accounts linked via coa_group_id to iplicit_coa_account_groups
      // 1) Load all active COA groups for this org/integration and build BANK root + all descendants in-memory
      const { data: bankGroupsRaw, error: bankGroupsError } = await supabase
        .from("iplicit_coa_account_groups")
        .select("account_group_id,parent_coa_group_id,code")
        .eq("organization_id", organizationId)
        .eq("platform_integration_id", connectionId)
        .eq("is_active", true);

      if (bankGroupsError) {
        console.error("iplicit_coa_account_groups bank filter error:", bankGroupsError);
      }

      const allGroups = (bankGroupsRaw || []) as {
        account_group_id?: string | null;
        parent_coa_group_id?: string | null;
        code?: string | null;
      }[];

      const rootBankIds = allGroups
        .filter((g) => (g.code || "").toUpperCase() === "BANK")
        .map((g) => g.account_group_id)
        .filter((id): id is string => !!id);

      const bankGroupIdSet = new Set<string>(rootBankIds);
      const queue: string[] = [...rootBankIds];

      while (queue.length > 0) {
        const current = queue.shift()!;
        const children = allGroups.filter(
          (g) => g.parent_coa_group_id === current && g.account_group_id && !bankGroupIdSet.has(g.account_group_id)
        );
        for (const child of children) {
          const id = child.account_group_id as string;
          bankGroupIdSet.add(id);
          queue.push(id);
        }
      }

      const bankGroupIds = Array.from(bankGroupIdSet);
      log("bank-groups.resolved", {
        allGroupCount: allGroups.length,
        rootBankCount: rootBankIds.length,
        recursiveBankGroupCount: bankGroupIds.length,
      });

      // 2) Get account_id from iplicit_chart_of_accounts where coa_group_id is in BANK groups (incl. descendants)
      let bankAccountIds: string[] = [];
      if (bankGroupIds.length > 0) {
        const { data: bankCoaRows, error: bankCoaError } = await supabase
          .from("iplicit_chart_of_accounts")
          .select("account_id")
          .eq("organization_id", organizationId)
          .eq("platform_integration_id", connectionId)
          .in("coa_group_id", bankGroupIds)
          .eq("is_active", true);

        if (bankCoaError) {
          console.error("iplicit_chart_of_accounts bank accounts error:", bankCoaError);
        } else {
          bankAccountIds = (bankCoaRows || [])
            .map((r: { account_id?: string | null }) => normAccountId(r.account_id))
            .filter((c): c is string => !!c);
        }
      }
      bankAccountIds = [...new Set(bankAccountIds)];
      const bankAccountIdSet = new Set(bankAccountIds);
      log("bank-accounts.resolved", {
        bankAccountCount: bankAccountIds.length,
      });

      let useCanonicalStatement = false;
      let financeSourceId: string | null = null;
      let bankFinanceAccountUuids: string[] = [];

      try {
        financeSourceId = await getIplicitFinanceSourceId(supabase, organizationId, connectionId);
        if (financeSourceId && bankAccountIds.length > 0) {
          const canonicalLineCount = await countJournalLinesForSource(supabase, financeSourceId);
          if (canonicalLineCount > 0) {
            const { data: bankFaRows, error: bankFaErr } = await supabase
              .from("finance_accounts")
              .select("id")
              .eq("organization_id", organizationId)
              .eq("source_id", financeSourceId)
              .in("canonical_account_code", bankAccountIds);

            if (bankFaErr) {
              console.warn("finance_accounts bank mapping (statement):", bankFaErr.message);
            } else {
              bankFinanceAccountUuids = (bankFaRows || [])
                .map((r: { id?: string | null }) => String(r.id || "").trim())
                .filter((id): id is string => !!id);
              useCanonicalStatement = bankFinanceAccountUuids.length > 0;
            }
          }
        }
      } catch (canonicalCheckErr) {
        console.warn("canonical statement availability check failed:", canonicalCheckErr);
      }

      log("statement.source-mode", {
        useCanonicalStatement,
        financeSourceId: financeSourceId ?? null,
        bankFinanceAccountUuidCount: bankFinanceAccountUuids.length,
      });

      let allRows: Record<string, unknown>[] = [];

      if (useCanonicalStatement && financeSourceId) {
        allRows = await fetchCanonicalStatementRowsLikePlBs(
          supabase,
          organizationId,
          financeSourceId,
          fromDate,
          toDate,
          mappedLegalEntityId
        );
        log("source-rows.loaded.canonical", {
          allRowsCount: allRows.length,
        });
      } else {
      // Fetch from iplicit_profit_loss and iplicit_balance_sheet using PERIOD date for filter and display.
      // When a mappedLegalEntityId is present (location-specific mapping), we also filter by legal_entity_id.

      let plPeriodQuery = supabase
        .from("iplicit_profit_loss")
        .select(
          "id, doc_id, account_id, account_code, amount, period_date, invoice_date, post_date, doc_class, description, doc_description, contact_account_id, name:contact_account_code, legal_entity_id, created_at, updated_at"
        )
        .eq("organization_id", organizationId)
        .eq("platform_integration_id", connectionId)
        .not("period_date", "is", null)
        .gte("period_date", fromDate)
        .lte("period_date", toDate);

      let plPeriodNullFallbackQuery = supabase
        .from("iplicit_profit_loss")
        .select(
          "id, doc_id, account_id, account_code, amount, period_date, invoice_date, post_date, doc_class, description, doc_description, contact_account_id, name:contact_account_code, legal_entity_id, created_at, updated_at"
        )
        .eq("organization_id", organizationId)
        .eq("platform_integration_id", connectionId)
        .is("period_date", null)
        .gte("post_date", fromDate)
        .lte("post_date", toDate);

      let bsPeriodQuery = supabase
        .from("iplicit_balance_sheet")
        .select(
          "id, doc_id, account_id, account_code, amount, period_date, invoice_date, post_date, doc_class, description, doc_description, contact_account_id, name:contact_account_code, legal_entity_id, created_at, updated_at"
        )
        .eq("organization_id", organizationId)
        .eq("platform_integration_id", connectionId)
        .not("period_date", "is", null)
        .gte("period_date", fromDate)
        .lte("period_date", toDate);

      let bsPeriodNullFallbackQuery = supabase
        .from("iplicit_balance_sheet")
        .select(
          "id, doc_id, account_id, account_code, amount, period_date, invoice_date, post_date, doc_class, description, doc_description, contact_account_id, name:contact_account_code, legal_entity_id, created_at, updated_at"
        )
        .eq("organization_id", organizationId)
        .eq("platform_integration_id", connectionId)
        .is("period_date", null)
        .gte("post_date", fromDate)
        .lte("post_date", toDate);

      if (mappedLegalEntityId) {
        plPeriodQuery = plPeriodQuery.eq("legal_entity_id", mappedLegalEntityId);
        plPeriodNullFallbackQuery = plPeriodNullFallbackQuery.eq("legal_entity_id", mappedLegalEntityId);
        bsPeriodQuery = bsPeriodQuery.eq("legal_entity_id", mappedLegalEntityId);
        bsPeriodNullFallbackQuery = bsPeriodNullFallbackQuery.eq("legal_entity_id", mappedLegalEntityId);
      }

      plPeriodQuery = plPeriodQuery
        .order("period_date", { ascending: true })
        .order("created_at", { ascending: true });
      plPeriodNullFallbackQuery = plPeriodNullFallbackQuery
        .order("post_date", { ascending: true })
        .order("created_at", { ascending: true });
      bsPeriodQuery = bsPeriodQuery
        .order("period_date", { ascending: true })
        .order("created_at", { ascending: true });
      bsPeriodNullFallbackQuery = bsPeriodNullFallbackQuery
        .order("post_date", { ascending: true })
        .order("created_at", { ascending: true });

      const [plRes1, plRes2, bsRes1, bsRes2] = await Promise.all([
        plPeriodQuery,
        plPeriodNullFallbackQuery,
        bsPeriodQuery,
        bsPeriodNullFallbackQuery,
      ]);

      const plError = plRes1.error || plRes2.error;
      const bsError = bsRes1.error || bsRes2.error;

      if (plError || bsError) {
        console.error("iplicit_profit_loss error:", plError);
        console.error("iplicit_balance_sheet error:", bsError);
        const err = plError || bsError;
        // HTTP 200 so the browser client receives JSON (Supabase invoke treats non-2xx as FunctionsHttpError).
        return new Response(
          JSON.stringify({
            error: err?.message ?? "Failed to fetch iplicit data",
            resultMsg: "Failed to fetch iplicit profit & loss / balance sheet data",
            transactionStatus: 0,
            returnObject: [],
            totalMoneyIn: 0,
            totalMoneyOut: 0,
            closingBalance: 0,
            whoPaidOptions: [],
            forWhatOptions: [],
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const plRows = [...(plRes1.data || []), ...(plRes2.data || [])] as Record<string, unknown>[];
      const bsRows = [...(bsRes1.data || []), ...(bsRes2.data || [])] as Record<string, unknown>[];
      allRows = [...plRows, ...bsRows] as Record<string, unknown>[];
      log("source-rows.loaded", {
        plRowsPeriodDateCount: (plRes1.data || []).length,
        plRowsPeriodNullFallbackCount: (plRes2.data || []).length,
        bsRowsPeriodDateCount: (bsRes1.data || []).length,
        bsRowsPeriodNullFallbackCount: (bsRes2.data || []).length,
        plRowsCount: plRows.length,
        bsRowsCount: bsRows.length,
        allRowsCount: allRows.length,
      });
      }

      // Group all rows by document for later split calculation (non-bank side of the entry)
      const rowsByDocId = new Map<string, Record<string, unknown>[]>();
      for (const row of allRows) {
        const docId = String(row.doc_id || "");
        if (!docId) continue;
        const existing = rowsByDocId.get(docId) ?? [];
        existing.push(row);
        rowsByDocId.set(docId, existing);
      }

      const filteredGlRows = allRows.filter((row: Record<string, unknown>) => {
        const acctId = normAccountId(row.account_id);
        if (!acctId) return false;
        if (bankAccountIdSet.size === 0) return false;
        return bankAccountIdSet.has(acctId);
      });

      filteredGlRows.sort((a: Record<string, unknown>, b: Record<string, unknown>) => {
        const dateA = String(a.period_date || a.post_date || (a as any).invoice_date || "");
        const dateB = String(b.period_date || b.post_date || (b as any).invoice_date || "");
        if (dateA !== dateB) {
          return dateA.localeCompare(dateB);
        }
        const createdA = String((a as any).created_at || (a as any).updated_at || "");
        const createdB = String((b as any).created_at || (b as any).updated_at || "");
        return createdA.localeCompare(createdB);
      });
      log("rows.filtered.bank-only", {
        filteredGlRowsCount: filteredGlRows.length,
      });

      // Resolve receipt/payment allocations so we can link bank documents (receipts/payments)
      // back to the underlying sales/purchase invoices. This lets us build "For What" based
      // on the invoice accounts instead of just control accounts.
      const bankDocIds = [
        ...new Set(
          filteredGlRows
            .map((r: Record<string, unknown>) => String(r.doc_id || ""))
            .filter((id) => id !== "")
        ),
      ];

      const receiptAllocationsByReceipt = new Map<string, string[]>();
      const paymentAllocationsByPayment = new Map<string, string[]>();

      if (bankDocIds.length > 0) {
        const [{ data: receiptAllocRows, error: receiptAllocError }, { data: paymentAllocRows, error: paymentAllocError }] =
          await Promise.all([
            supabase
              .from("iplicit_receipt_allocations")
              .select("receipt_id, doc_id")
              .eq("organization_id", organizationId)
              .eq("platform_integration_id", connectionId)
              .in("receipt_id", bankDocIds),
            supabase
              .from("iplicit_payment_allocations")
              .select("payment_id, doc_id")
              .eq("organization_id", organizationId)
              .eq("platform_integration_id", connectionId)
              .in("payment_id", bankDocIds),
          ]);

        if (receiptAllocError) {
          console.error("iplicit_receipt_allocations error:", receiptAllocError);
        }
        if (paymentAllocError) {
          console.error("iplicit_payment_allocations error:", paymentAllocError);
        }

        const receiptRows = (receiptAllocRows || []) as {
          receipt_id?: string | null;
          doc_id?: string | null;
        }[];
        for (const r of receiptRows) {
          const receiptId = (r.receipt_id && String(r.receipt_id)) || "";
          const invoiceId = (r.doc_id && String(r.doc_id)) || "";
          if (!receiptId || !invoiceId) continue;
          const existing = receiptAllocationsByReceipt.get(receiptId) ?? [];
          existing.push(invoiceId);
          receiptAllocationsByReceipt.set(receiptId, existing);
        }

        const paymentRows = (paymentAllocRows || []) as {
          payment_id?: string | null;
          doc_id?: string | null;
        }[];
        for (const r of paymentRows) {
          const paymentId = (r.payment_id && String(r.payment_id)) || "";
          const invoiceId = (r.doc_id && String(r.doc_id)) || "";
          if (!paymentId || !invoiceId) continue;
          const existing = paymentAllocationsByPayment.get(paymentId) ?? [];
          existing.push(invoiceId);
          paymentAllocationsByPayment.set(paymentId, existing);
        }
      }

      // Some invoices linked to these receipts/payments might fall outside the selected
      // date range, so they are not present in the initial allRows set. To ensure "For What"
      // can still surface their revenue/expense accounts, eagerly load any missing GL rows
      // for allocated invoice doc_ids (without additional date filters) and merge them into
      // rowsByDocId/allRows for split calculations.
      const allRelatedInvoiceIds = new Set<string>();
      for (const ids of receiptAllocationsByReceipt.values()) {
        for (const id of ids) {
          if (id) allRelatedInvoiceIds.add(id);
        }
      }
      for (const ids of paymentAllocationsByPayment.values()) {
        for (const id of ids) {
          if (id) allRelatedInvoiceIds.add(id);
        }
      }

      if (allRelatedInvoiceIds.size > 0) {
        const invoiceIdArray = Array.from(allRelatedInvoiceIds);
        const chunkSize = 200;
        const extraRows: Record<string, unknown>[] = [];

        for (let i = 0; i < invoiceIdArray.length; i += chunkSize) {
          const chunk = invoiceIdArray.slice(i, i + chunkSize);
          const [plExtraRes, bsExtraRes] = await Promise.all([
            supabase
              .from("iplicit_profit_loss")
              .select(
                "id, doc_id, account_id, account_code, amount, period_date, invoice_date, post_date, doc_class, description, doc_description, contact_account_id, name:contact_account_code, legal_entity_id, created_at, updated_at"
              )
              .eq("organization_id", organizationId)
              .eq("platform_integration_id", connectionId)
              .in("doc_id", chunk),
            supabase
              .from("iplicit_balance_sheet")
              .select(
                "id, doc_id, account_id, account_code, amount, period_date, invoice_date, post_date, doc_class, description, doc_description, contact_account_id, name:contact_account_code, legal_entity_id, created_at, updated_at"
              )
              .eq("organization_id", organizationId)
              .eq("platform_integration_id", connectionId)
              .in("doc_id", chunk),
          ]);

          if (plExtraRes.error) {
            console.error("iplicit_profit_loss extra invoice rows error:", plExtraRes.error);
          }
          if (bsExtraRes.error) {
            console.error("iplicit_balance_sheet extra invoice rows error:", bsExtraRes.error);
          }

          if (plExtraRes.data) {
            extraRows.push(...(plExtraRes.data as Record<string, unknown>[]));
          }
          if (bsExtraRes.data) {
            extraRows.push(...(bsExtraRes.data as Record<string, unknown>[]));
          }
        }

        if (extraRows.length > 0) {
          for (const row of extraRows) {
            const docId = String(row.doc_id || "");
            if (!docId) continue;
            const existing = rowsByDocId.get(docId) ?? [];
            existing.push(row);
            rowsByDocId.set(docId, existing);
          }
          allRows = allRows.concat(extraRows);
          log("extra-invoice-rows.loaded", {
            extraRowCount: extraRows.length,
            relatedInvoiceIdCount: allRelatedInvoiceIds.size,
          });
        }
      }

      // Resolve account_id -> account metadata (name, type, AR/AP flags) from iplicit_chart_of_accounts.
      // Chunk .in() queries: very large unique id lists (after merging invoice GL rows) exceed PostgREST
      // limits and return errors / empty data, which breaks "Who Paid" and "For What".
      let accountNameById: Record<string, string> = {};
      let accountIsControlById: Record<string, boolean> = {};
      let accountTypeById: Record<string, string> = {};

      type CoaRow = {
        account_id?: string | null;
        name?: string | null;
        ap_flag?: boolean | null;
        ar_flag?: boolean | null;
        account_type?: string | null;
      };

      const applyCoaRows = (coaRows: CoaRow[]) => {
        for (const r of coaRows) {
          const id = normAccountId(r.account_id);
          if (!id) continue;
          if (typeof r.name === "string" && r.name.trim()) {
            accountNameById[id] = r.name.trim();
          }
          const controlHere = Boolean(r.ap_flag) || Boolean(r.ar_flag);
          accountIsControlById[id] = (accountIsControlById[id] ?? false) || controlHere;
          if (typeof r.account_type === "string" && r.account_type.trim()) {
            accountTypeById[id] = r.account_type.trim();
          }
        }
      };

      const uniqueAccountIds = [
        ...new Set(
          allRows
            .map((r: Record<string, unknown>) => normAccountId(r.account_id))
            .filter((c): c is string => !!c)
        ),
      ];

      const COA_CHUNK = 150;
      for (let i = 0; i < uniqueAccountIds.length; i += COA_CHUNK) {
        const chunk = uniqueAccountIds.slice(i, i + COA_CHUNK);
        const { data: coaChunk, error: coaChunkError } = await supabase
          .from("iplicit_chart_of_accounts")
          .select("account_id, name, ap_flag, ar_flag, account_type")
          .eq("organization_id", organizationId)
          .eq("platform_integration_id", connectionId)
          .in("account_id", chunk);

        if (coaChunkError) {
          console.error("iplicit_chart_of_accounts chunk error:", coaChunkError);
        } else {
          applyCoaRows((coaChunk || []) as CoaRow[]);
        }
      }

      // Always load bank account names in a small query so "Who Paid" works even if bulk chunking fails.
      if (bankAccountIds.length > 0) {
        const { data: bankCoaMeta, error: bankCoaMetaError } = await supabase
          .from("iplicit_chart_of_accounts")
          .select("account_id, name, ap_flag, ar_flag, account_type")
          .eq("organization_id", organizationId)
          .eq("platform_integration_id", connectionId)
          .in("account_id", bankAccountIds);

        if (bankCoaMetaError) {
          console.error("iplicit_chart_of_accounts bank meta error:", bankCoaMetaError);
        } else {
          applyCoaRows((bankCoaMeta || []) as CoaRow[]);
        }
      }

      log("coa.resolved", {
        uniqueAccountIdCount: uniqueAccountIds.length,
        nameMapSize: Object.keys(accountNameById).length,
        bankAccountCount: bankAccountIds.length,
      });

      rows = filteredGlRows;

      // Opening balance: sum all historic bank movements BEFORE fromDate.
      // Canonical path uses finance_journal_lines; legacy uses iplicit_balance_sheet only.
      let openingBalance = 0;
      if (bankAccountIds.length > 0) {
        if (useCanonicalStatement && financeSourceId && bankFinanceAccountUuids.length > 0) {
          openingBalance = await sumCanonicalBankOpeningBalance(
            supabase,
            organizationId,
            financeSourceId,
            bankFinanceAccountUuids,
            fromDate,
            mappedLegalEntityId
          );
          log("opening-balance.calculated.canonical", {
            openingBalance,
          });
        } else {
          let obPeriodQuery = supabase
            .from("iplicit_balance_sheet")
            .select("amount, legal_entity_id, period_date, post_date")
            .eq("organization_id", organizationId)
            .eq("platform_integration_id", connectionId)
            .in("account_id", bankAccountIds)
            .not("period_date", "is", null)
            .lt("period_date", fromDate);

          let obPeriodNullFallbackQuery = supabase
            .from("iplicit_balance_sheet")
            .select("amount, legal_entity_id, period_date, post_date")
            .eq("organization_id", organizationId)
            .eq("platform_integration_id", connectionId)
            .in("account_id", bankAccountIds)
            .is("period_date", null)
            .lt("post_date", fromDate);

          if (mappedLegalEntityId) {
            obPeriodQuery = obPeriodQuery.eq("legal_entity_id", mappedLegalEntityId);
            obPeriodNullFallbackQuery = obPeriodNullFallbackQuery.eq("legal_entity_id", mappedLegalEntityId);
          }

          const [obRes1, obRes2] = await Promise.all([obPeriodQuery, obPeriodNullFallbackQuery]);

          if (obRes1.error) {
            console.error("iplicit_balance_sheet opening balance (period_date) error:", obRes1.error);
          }
          if (obRes2.error) {
            console.error("iplicit_balance_sheet opening balance (period null fallback) error:", obRes2.error);
          }

          const openingRows = [...(obRes1.data || []), ...(obRes2.data || [])] as { amount?: number | string | null }[];
          openingBalance = openingRows.reduce((sum, r) => {
            const amt = parseFloat(String(r.amount ?? 0)) || 0;
            return sum + amt;
          }, 0);
          log("opening-balance.calculated", {
            openingRowsCount: openingRows.length,
            openingBalance,
          });
        }
      }

      const currencySym = "£";
      let runningBalance = openingBalance;

      list = rows.map((row: Record<string, unknown>) => {
        const amount = parseFloat(String(row.amount ?? 0)) || 0;
        const debitNum = amount > 0 ? Math.abs(amount) : 0;
        const creditNum = amount < 0 ? Math.abs(amount) : 0;

        runningBalance += debitNum - creditNum;

        const debitStr = debitNum > 0 ? formatMoney(debitNum, currencySym) : "–";
        const creditStr = creditNum > 0 ? formatMoney(creditNum, currencySym) : "–";
        const balanceStr = formatMoney(runningBalance, currencySym);

        const transactionType = String(row.doc_class || "").trim() || "Bank";
        // Name: prefer descriptive text (doc/memo), otherwise fall back to aliased `name` (contact_account_code)
        const rawCode = String((row as { name?: unknown }).name ?? "").trim();
        const rawDesc = String(row.description || row.doc_description || "").trim();
        const displayName = rawDesc || rawCode || "—";
        // Who Paid = bank account name from chart of accounts (not account code)
        const bankRowAccId = normAccountId(row.account_id);
        const accountName = bankRowAccId ? accountNameById[bankRowAccId] : undefined;
        const codeFallback = String(row.account_code ?? "").trim();
        const location = (accountName?.trim() || codeFallback || "—") as string;

        // Split: prefer item-level / invoice-based accounts where available by using
        // receipt/payment allocation tables to jump from the bank document to the related
        // sales/purchase invoices. Fallback to non-bank, non-control GL accounts on the
        // same document if no allocations are found.
        const docId = String(row.doc_id || "");
        const baseDocRows = (docId && rowsByDocId.get(docId)) || [];

        // 1) Resolve all invoice doc_ids related to this bank document (receipt/payment).
        const relatedInvoiceIdsSet = new Set<string>();
        const receiptInvoices = receiptAllocationsByReceipt.get(docId);
        if (receiptInvoices) {
          for (const id of receiptInvoices) {
            if (id) relatedInvoiceIdsSet.add(id);
          }
        }
        const paymentInvoices = paymentAllocationsByPayment.get(docId);
        if (paymentInvoices) {
          for (const id of paymentInvoices) {
            if (id) relatedInvoiceIdsSet.add(id);
          }
        }

        // 2) Collect GL rows for those invoices (from profit & loss / balance sheet tables).
        let invoiceDocRows: Record<string, unknown>[] = [];
        if (relatedInvoiceIdsSet.size > 0) {
          for (const invoiceId of relatedInvoiceIdsSet) {
            const invRows = rowsByDocId.get(invoiceId);
            if (invRows && invRows.length > 0) {
              invoiceDocRows = invoiceDocRows.concat(invRows);
            }
          }
        }

        // Use invoice rows when available; otherwise fall back to rows on the bank document.
        const usingInvoiceRows = invoiceDocRows.length > 0;
        const candidateRows = usingInvoiceRows ? invoiceDocRows : baseDocRows;

        log("split.candidateRows", {
          rowId: String(row.id ?? ""),
          docId,
          relatedInvoiceIds: Array.from(relatedInvoiceIdsSet),
          baseDocRowCount: baseDocRows.length,
          invoiceDocRowCount: invoiceDocRows.length,
          candidateRowCount: candidateRows.length,
        });

        // 3) From the candidate rows, keep only non-bank, non-control accounts to surface
        // the actual revenue/expense accounts the cash movement relates to.
        const splitAccounts = candidateRows
          .filter((r) => {
            const accId = normAccountId(r.account_id);
            if (!accId) return false;
            // Always exclude bank accounts from "For What"
            if (bankAccountIdSet.size > 0 && bankAccountIdSet.has(accId)) return false;
            // When using invoice-based rows, we only want the revenue/expense side,
            // so restrict to Profit & Loss accounts where possible.
            if (usingInvoiceRows) {
              const accType = (accountTypeById[accId] || "").toUpperCase();
              if (accType && accType !== "PL") return false;
            }
            // When we're using only the bank document rows (no linked invoices),
            // hide pure control accounts (AR/AP) so we don't just show "Debtors/Creditors Control".
            // For invoice-based rows, we keep control accounts to avoid ending up with an empty split.
            if (!usingInvoiceRows && accountIsControlById[accId]) return false;
            return true;
          })
          .map((r) => {
            const accId = normAccountId(r.account_id);
            const accName = accId ? accountNameById[accId] : undefined;
            const code = String(r.account_code || "").trim();
            return (accName || code) as string;
          })
          .filter((s) => !!s);

        const splitLabel =
          splitAccounts.length > 0 ? [...new Set(splitAccounts)].join(", ") : "Bank";

        log("split.computed", {
          rowId: String(row.id ?? ""),
          docId,
          splitAccounts,
          splitLabel,
        });
        const memo = String(row.description || row.doc_description || "").trim() || "";
        // Use PERIOD date for display; fall back to post_date then invoice_date when period_date is null
        const effectiveDate = String(row.period_date || row.post_date || (row as any).invoice_date || "");

        const transactionLink = getIplicitTransactionLink(iplicitDomain, transactionType, docId);

        return {
          id: String(row.id),
          date: formatDate(effectiveDate),
          transactionType,
          transactionLink,
          name: displayName,
          memoOrDescription: memo,
          location: String(location),
          split: splitLabel,
          debit: debitStr,
          credit: creditStr,
          balance: balanceStr,
          _debitNum: debitNum,
          _creditNum: creditNum,
          _balanceNum: runningBalance,
          _nameLower: displayName.toLowerCase(),
          _memoLower: memo.toLowerCase(),
        };
      });
      if (list.length > 0) accountingPlatform = "iplicit";
      log("rows.mapped.iplicit", {
        useCanonicalStatement,
        mappedCount: list.length,
        firstRowId: list[0]?.id ?? null,
        lastRowId: list[list.length - 1]?.id ?? null,
      });

      if ((!list || list.length === 0) && xeroIntegrationIdForBank) {
        log("statement.try-xero-journals-after-iplicit-empty", { xeroIntegrationIdForBank });
        const journalStmt = await tryLoadXeroJournalBankStatement(supabase, {
          organizationId,
          xeroIntegrationId: xeroIntegrationIdForBank,
          fromDate,
          toDate,
          mappedLegalEntityId,
          log,
          trackingOptionIds,
          locationId: locationId ?? null,
          optionScopes: xeroTrackingScope?.optionScopes ?? [],
        });
        if (journalStmt) {
          list = journalStmt.list as unknown as TransactionToReviewInternal[];
          rows = journalStmt.rows;
          accountingPlatform = "xero";
        }
      }

      if ((!list || list.length === 0) && xeroIntegrationIdForBank && !trackingMapped) {
        log("statement.try-xero-canonical-after-iplicit-empty", { xeroIntegrationIdForBank });
        const canonical = await tryLoadXeroCanonicalBankStatement(supabase, {
          organizationId,
          xeroIntegrationId: xeroIntegrationIdForBank,
          fromDate,
          toDate,
          mappedLegalEntityId,
          log,
        });
        if (canonical && canonical.list.length > 0) {
          list = canonical.list as unknown as TransactionToReviewInternal[];
          rows = canonical.rows;
          accountingPlatform = "xero";
        }
      }
    } else {
      log("connection.fallback", {
        reason: "No iplicit connection found; using xero_bank_transactions",
      });

      if (xeroIntegrationIdForBank) {
        log("statement.try-xero-journals-before-bank-feed", { xeroIntegrationIdForBank });
        const journalStmt = await tryLoadXeroJournalBankStatement(supabase, {
          organizationId,
          xeroIntegrationId: xeroIntegrationIdForBank,
          fromDate,
          toDate,
          mappedLegalEntityId,
          log,
          trackingOptionIds,
          locationId: locationId ?? null,
          optionScopes: xeroTrackingScope?.optionScopes ?? [],
        });
        if (journalStmt) {
          list = journalStmt.list as unknown as TransactionToReviewInternal[];
          rows = journalStmt.rows;
          accountingPlatform = "xero";
        }
      }

      if (list.length === 0 && xeroIntegrationIdForBank && !trackingMapped) {
        log("statement.try-xero-canonical-before-bank-feed", { xeroIntegrationIdForBank });
        const canonical = await tryLoadXeroCanonicalBankStatement(supabase, {
          organizationId,
          xeroIntegrationId: xeroIntegrationIdForBank,
          fromDate,
          toDate,
          mappedLegalEntityId,
          log,
        });
        if (canonical && canonical.list.length > 0) {
          list = canonical.list as unknown as TransactionToReviewInternal[];
          rows = canonical.rows;
          accountingPlatform = "xero";
        }
      }

      if (list.length > 0) {
        if (!accountingPlatform) accountingPlatform = "xero";
        log("rows.mapped.xero-statement-no-iplicit", { mappedCount: list.length });
      } else if (!trackingMapped) {
      // Fallback: xero_bank_transactions (e.g. Xero) — scope to connected Xero when available
      let bankFeedQuery = supabase
        .from("xero_bank_transactions")
        .select("id, type, contact_name, bank_account_name, bank_transaction_id, transaction_date, total, currency_code")
        .eq("organization_id", organizationId)
        .gte("transaction_date", fromDate)
        .lte("transaction_date", toDate)
        .order("transaction_date", { ascending: true });
      if (xeroIntegrationIdForBank) {
        bankFeedQuery = bankFeedQuery.eq("platform_integration_id", xeroIntegrationIdForBank);
      }
      const { data: platformRows, error } = await bankFeedQuery;

      if (error) {
        console.error("Supabase error:", error);
        return new Response(
          JSON.stringify({
            error: error.message,
            resultMsg: "Failed to fetch transactions",
            transactionStatus: 0,
            returnObject: [],
            totalMoneyIn: 0,
            totalMoneyOut: 0,
            closingBalance: 0,
            whoPaidOptions: [],
            forWhatOptions: [],
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      rows = (platformRows || []) as Record<string, unknown>[];
      log("source-rows.loaded.fallback", {
        platformRowsCount: rows.length,
      });
      let runningBalance = 0;
      if (xeroIntegrationIdForBank) {
        runningBalance = await resolveXeroBankOpeningBalanceForStatement(
          supabase,
          organizationId,
          xeroIntegrationIdForBank,
          fromDate,
          mappedLegalEntityId
        );
        log("opening-balance.calculated.bank-feed-fallback", { openingBalance: runningBalance });
      }

      list = rows.map((row: Record<string, unknown>) => {
        const total = Number(row.total) || 0;
        const type = String(row.type || "").toUpperCase();
        const isReceive = type === "RECEIVE";
        const debitNum = isReceive ? total : 0;
        const creditNum = isReceive ? 0 : total;
        runningBalance += debitNum - creditNum;

        const debitStr = isReceive ? formatMoney(total) : "–";
        const creditStr = isReceive ? "–" : formatMoney(total);
        const balanceStr = formatMoney(runningBalance);

        const transactionType = type || "Bank";
        const displayName = String(row.contact_name || (row.bank_transaction_id ? `Txn ${row.bank_transaction_id}` : "—")).trim() || "—";
        const location = String(row.bank_account_name || "—").trim() || "—";

        const bankTxnId = String(row.bank_transaction_id || "");
        const linkType = xeroBankFeedLinkType(type);
        const transactionLink = getXeroTransactionLink(linkType, bankTxnId);

        return {
          id: String(row.id),
          date: formatDate(String(row.transaction_date)),
          transactionType,
          transactionLink,
          name: displayName,
          memoOrDescription: "",
          location,
          split: "Bank",
          debit: debitStr,
          credit: creditStr,
          balance: balanceStr,
          _debitNum: debitNum,
          _creditNum: creditNum,
          _balanceNum: runningBalance,
          _nameLower: displayName.toLowerCase(),
          _memoLower: "",
        };
      });
      if (list.length > 0) accountingPlatform = "xero";
      log("rows.mapped.fallback", {
        mappedCount: list.length,
        firstRowId: list[0]?.id ?? null,
        lastRowId: list[list.length - 1]?.id ?? null,
      });
      }
    }

    if ((!list || list.length === 0) && xeroIntegrationIdForBank && accountingPlatform !== "xero") {
      log("statement.retry.xero-journals", {
        reason: "no_rows_before_final_bank_feed_retry",
        xeroIntegrationIdForBank,
      });
      const journalRetry = await tryLoadXeroJournalBankStatement(supabase, {
        organizationId,
        xeroIntegrationId: xeroIntegrationIdForBank,
        fromDate,
        toDate,
        mappedLegalEntityId,
        log,
        trackingOptionIds,
        locationId: locationId ?? null,
        optionScopes: xeroTrackingScope?.optionScopes ?? [],
      });
      if (journalRetry) {
        list = journalRetry.list as unknown as TransactionToReviewInternal[];
        rows = journalRetry.rows;
        accountingPlatform = "xero";
        log("rows.mapped.xero-journals.retry", { mappedCount: list.length });
      }
    }

    if ((!list || list.length === 0) && xeroIntegrationIdForBank && !trackingMapped) {
      log("statement.retry.platform-bank", {
        reason: "no_rows_after_canonical_try_xero_scoped_bank_feed",
        hadIplicitPath: !!iplicitConnectionId,
        xeroIntegrationIdForBank,
      });
      let retryQuery = supabase
        .from("xero_bank_transactions")
        .select("id, type, contact_name, bank_account_name, bank_transaction_id, transaction_date, total, currency_code")
        .eq("organization_id", organizationId)
        .eq("platform_integration_id", xeroIntegrationIdForBank)
        .gte("transaction_date", fromDate)
        .lte("transaction_date", toDate)
        .order("transaction_date", { ascending: true });
      const { data: platformRetryRows, error: retryErr } = await retryQuery;
      if (retryErr) {
        console.error("xero_bank_transactions retry error:", retryErr);
      } else {
        rows = (platformRetryRows || []) as Record<string, unknown>[];
        let runningBalance = await resolveXeroBankOpeningBalanceForStatement(
          supabase,
          organizationId,
          xeroIntegrationIdForBank,
          fromDate,
          mappedLegalEntityId
        );
        log("opening-balance.calculated.bank-feed-retry", { openingBalance: runningBalance });
        list = rows.map((row: Record<string, unknown>) => {
          const total = Number(row.total) || 0;
          const type = String(row.type || "").toUpperCase();
          const isReceive = type === "RECEIVE";
          const debitNum = isReceive ? total : 0;
          const creditNum = isReceive ? 0 : total;
          runningBalance += debitNum - creditNum;
          const debitStr = isReceive ? formatMoney(total) : "–";
          const creditStr = isReceive ? "–" : formatMoney(total);
          const balanceStr = formatMoney(runningBalance);
          const transactionType = type || "Bank";
          const displayName = String(row.contact_name || (row.bank_transaction_id ? `Txn ${row.bank_transaction_id}` : "—")).trim() || "—";
          const location = String(row.bank_account_name || "—").trim() || "—";
          const bankTxnId = String(row.bank_transaction_id || "");
          const linkType = xeroBankFeedLinkType(type);
          const transactionLink = getXeroTransactionLink(linkType, bankTxnId);

          return {
            id: String(row.id),
            date: formatDate(String(row.transaction_date)),
            transactionType,
            transactionLink,
            name: displayName,
            memoOrDescription: "",
            location,
            split: "Bank",
            debit: debitStr,
            credit: creditStr,
            balance: balanceStr,
            _debitNum: debitNum,
            _creditNum: creditNum,
            _balanceNum: runningBalance,
            _nameLower: displayName.toLowerCase(),
            _memoLower: "",
          };
        });
        if (list.length > 0) accountingPlatform = "xero";
        log("rows.mapped.fallback.retry", {
          mappedCount: list.length,
          platformRowsCount: rows.length,
        });
      }
    }

    let statementClosing: number | null = null;
    if (xeroIntegrationIdForBank) {
      statementClosing = await resolveXeroBankClosingBalanceForStatement(
        supabase,
        organizationId,
        xeroIntegrationIdForBank,
        fromDate,
        toDate,
        mappedLegalEntityId,
        log,
        { trackingOptionIds, locationId: locationId ?? null, optionScopes: xeroTrackingScope?.optionScopes ?? [] }
      );
      if (statementClosing != null) {
        rebaseStatementRunningBalances(list, statementClosing);
        log("running-balance.rebase-to-bs-pre-filter", {
          closingBalance: statementClosing,
          lastRow: list.length > 0 ? list[list.length - 1]._balanceNum : null,
        });
      }
    }

    const transactionTypesSet =
      transactionTypes && transactionTypes.trim()
        ? new Set(transactionTypes.split(",").map((t) => t.trim().toUpperCase()))
        : null;
    const nameFilter = (name ?? "").trim().toLowerCase();
    const memoFilter = (memoOrDescription ?? "").trim().toLowerCase();

    // Distinct options for Who Paid (location) and For What (split) from full list (before whoPaid/forWhat filter)
    // so the UI can always show all accounts/categories regardless of current selection.
    const whoPaidOptions = [...new Set(list.map((t) => t.location).filter((s) => s != null && String(s).trim() !== ""))].map((s) => String(s).trim()).sort((a, b) => a.localeCompare(b));
    const forWhatOptions = [...new Set(list.map((t) => t.split).filter((s) => s != null && String(s).trim() !== ""))].map((s) => String(s).trim()).sort((a, b) => a.localeCompare(b));
    const transactionTypeOptions = [...new Set(list.map((t) => t.transactionType).filter((s) => s != null && String(s).trim() !== ""))].map((s) => String(s).trim()).sort((a, b) => a.localeCompare(b));
    log("filter-options", {
      whoPaidCount: whoPaidOptions.length,
      forWhatCount: forWhatOptions.length,
      transactionTypeCount: transactionTypeOptions.length,
      accountingPlatform,
    });

    // Apply filters (same logic as Version 2.0)
    let filtered: TransactionToReviewInternal[] = list;
    log("filters.start", { preFilterCount: filtered.length });
    if (transactionTypesSet) {
      filtered = filtered.filter((t) => transactionTypesSet.has(t.transactionType.toUpperCase()));
      log("filters.transactionTypes.applied", { countAfter: filtered.length });
    }
    if (nameFilter) {
      filtered = filtered.filter((t) => t._nameLower.includes(nameFilter));
      log("filters.name.applied", { countAfter: filtered.length });
    }
    if (memoFilter) {
      filtered = filtered.filter((t) => t._memoLower.includes(memoFilter));
      log("filters.memo.applied", { countAfter: filtered.length });
    }
    if (debitMin != null) {
      filtered = filtered.filter((t) => t._debitNum >= debitMin);
      log("filters.debitMin.applied", { countAfter: filtered.length });
    }
    if (debitMax != null) {
      filtered = filtered.filter((t) => t._debitNum <= debitMax);
      log("filters.debitMax.applied", { countAfter: filtered.length });
    }
    if (creditMin != null) {
      filtered = filtered.filter((t) => t._creditNum >= creditMin);
      log("filters.creditMin.applied", { countAfter: filtered.length });
    }
    if (creditMax != null) {
      filtered = filtered.filter((t) => t._creditNum <= creditMax);
      log("filters.creditMax.applied", { countAfter: filtered.length });
    }
    if (balanceMin != null) {
      filtered = filtered.filter((t) => t._balanceNum >= balanceMin);
      log("filters.balanceMin.applied", { countAfter: filtered.length });
    }
    if (balanceMax != null) {
      filtered = filtered.filter((t) => t._balanceNum <= balanceMax);
      log("filters.balanceMax.applied", { countAfter: filtered.length });
    }
    const whoPaidSet =
      whoPaid && whoPaid.trim()
        ? new Set(whoPaid.split(",").map((s) => s.trim()).filter(Boolean))
        : null;
    if (whoPaidSet && whoPaidSet.size > 0) {
      filtered = filtered.filter((t) => whoPaidSet.has(t.location));
      log("filters.whoPaid.applied", { countAfter: filtered.length });
    }
    const forWhatSet =
      forWhat && forWhat.trim()
        ? new Set(forWhat.split(",").map((s) => s.trim()).filter(Boolean))
        : null;
    if (forWhatSet && forWhatSet.size > 0) {
      filtered = filtered.filter((t) => forWhatSet.has(t.split));
      log("filters.forWhat.applied", { countAfter: filtered.length });
    }

    // Compute totals for footer (before stripping internal fields)
    const totalMoneyIn = filtered.reduce((sum, t) => sum + t._debitNum, 0);
    const totalMoneyOut = filtered.reduce((sum, t) => sum + t._creditNum, 0);
    const closingBalance =
      statementClosing != null
        ? statementClosing
        : filtered.length > 0
          ? filtered[filtered.length - 1]._balanceNum
          : 0;
    if (statementClosing != null) {
      log("closing-balance.from-bs", { closingBalance: statementClosing });
    }

    // Strip internal fields for response
    const returnObject: TransactionToReview[] = filtered.map((t) => ({
      id: t.id,
      date: t.date,
      transactionType: t.transactionType,
      transactionLink: t.transactionLink,
      name: t.name,
      memoOrDescription: t.memoOrDescription,
      location: t.location,
      split: t.split,
      debit: t.debit,
      credit: t.credit,
      balance: t.balance,
    }));

    log("response.ready", {
      returnCount: returnObject.length,
      totalMoneyIn,
      totalMoneyOut,
      closingBalance,
    });

    return new Response(
      JSON.stringify({
        returnObject,
        totalMoneyIn,
        totalMoneyOut,
        closingBalance,
        whoPaidOptions,
        forWhatOptions,
        transactionTypeOptions,
        accountingPlatform,
        transactionStatus: 8,
        resultMsg: "Success",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("cashflow-statement-report error:", err);
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Unknown error",
        resultMsg: "Failed to process request",
        transactionStatus: 0,
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
