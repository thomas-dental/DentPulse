/**
 * Xero Business Overview–style bank account cards.
 *
 * Uses Finance API CashValidation for:
 *   - statementBalance (+ date)
 *   - cashAccount.accountBalance (Balance in Xero)
 *   - bankStatement.statementLines.unreconciledLines
 *
 * Requires OAuth scope finance.cashvalidation.read (orgs must reconnect Xero after enabling).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const XERO_API_BASE = "https://api.xero.com/api.xro/2.0";
const XERO_FINANCE_BASE = "https://api.xero.com/finance.xro/1.0";

interface BankOverviewCard {
  accountId: string;
  accountName: string;
  accountCode: string | null;
  accountNumber: string | null;
  accountType: string | null;
  bankBalance: number | null;
  xeroBalance: number | null;
  balanceAsOf: string | null;
  unreconciledCount: number;
  reconciliationUrl: string;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function signedMoney(
  value: number | null | undefined,
  type: string | null | undefined,
): number | null {
  if (value == null || Number.isNaN(Number(value))) return null;
  const abs = Math.abs(Number(value));
  const t = String(type || "").toUpperCase();
  // CashValidation: value is absolute; CREDIT means negative for cash accounts.
  return t === "CREDIT" ? -abs : abs;
}

function buildReconciliationUrl(accountId: string): string {
  return `https://go.xero.com/Bank/BankRec.aspx?accountID=${encodeURIComponent(accountId)}`;
}

async function refreshXeroAccessToken(
  supabaseUrl: string,
  supabaseServiceKey: string,
  integrationId: string,
): Promise<{ access_token: string | null; error: string | null }> {
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/xero-refresh-token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${supabaseServiceKey}`,
      },
      body: JSON.stringify({ integrationId }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.access_token) {
      return {
        access_token: null,
        error: data?.error || data?.details || `Refresh failed: HTTP ${response.status}`,
      };
    }
    return { access_token: data.access_token, error: null };
  } catch (error) {
    return {
      access_token: null,
      error: error instanceof Error ? error.message : "Token refresh failed",
    };
  }
}

async function resolveXeroTenant(
  supabase: ReturnType<typeof createClient>,
  organizationId: string,
  locationId: string,
): Promise<{
  tenantGuid: string | null;
  tenantOrgUuid: string | null;
  integrationId: string | null;
  xeroOrgName: string | null;
}> {
  const { data: mappingRows, error } = await supabase
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
    .eq("organization_id", organizationId)
    .eq("location_id", locationId);

  if (error) {
    console.warn("[xero-bank-overview] mapping error:", error.message);
    return { tenantGuid: null, tenantOrgUuid: null, integrationId: null, xeroOrgName: null };
  }

  const xeroMapping = (mappingRows || []).find(
    (m: any) => m.platform_integration_organizations?.platform_name === "xero",
  );
  if (!xeroMapping) {
    return { tenantGuid: null, tenantOrgUuid: null, integrationId: null, xeroOrgName: null };
  }

  const org = (xeroMapping as any).platform_integration_organizations;
  return {
    tenantGuid: org?.platform_org_id ? String(org.platform_org_id) : null,
    tenantOrgUuid: org?.id ? String(org.id) : String(xeroMapping.platform_integration_organizations_id || ""),
    integrationId: xeroMapping.platform_integration_id
      ? String(xeroMapping.platform_integration_id)
      : org?.platform_integration_id
      ? String(org.platform_integration_id)
      : null,
    xeroOrgName: org?.platform_org_name ? String(org.platform_org_name) : null,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ success: false, error: "Missing authorization header" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return jsonResponse({ success: false, error: "Invalid authentication" }, 401);
    }

    const body = (await req.json().catch(() => ({}))) as {
      organizationId?: string;
      locationId?: string | null;
    };
    const organizationId = String(body.organizationId || "").trim();
    const locationId = body.locationId ? String(body.locationId).trim() : "";

    if (!organizationId) {
      return jsonResponse({ success: false, error: "organizationId is required" }, 400);
    }
    if (!locationId) {
      return jsonResponse({
        success: true,
        cards: [],
        needsLocation: true,
        message: "Select a practice location to load Xero bank accounts.",
      });
    }

    const tenant = await resolveXeroTenant(supabase, organizationId, locationId);
    if (!tenant.tenantGuid || !tenant.integrationId) {
      return jsonResponse({
        success: true,
        cards: [],
        message: "No Xero organisation is mapped to this location.",
      });
    }

    const { data: integration } = await supabase
      .from("platform_integrations")
      .select("id, access_token, token_expires_at, is_connected, platform_name")
      .eq("id", tenant.integrationId)
      .eq("organization_id", organizationId)
      .eq("platform_name", "xero")
      .maybeSingle();

    if (!integration?.is_connected) {
      return jsonResponse({
        success: false,
        needsReconnect: true,
        error: "Xero is not connected. Connect Xero in Settings → Accounting Integrations.",
        cards: [],
      });
    }

    const refresh = await refreshXeroAccessToken(supabaseUrl, supabaseServiceKey, integration.id);
    if (!refresh.access_token) {
      return jsonResponse({
        success: false,
        needsReconnect: true,
        error: refresh.error || "Failed to refresh Xero token. Please reconnect Xero.",
        cards: [],
      });
    }

    const accessToken = refresh.access_token;
    const xeroHeaders = {
      Authorization: `Bearer ${accessToken}`,
      "Xero-tenant-id": tenant.tenantGuid,
      Accept: "application/json",
    };

    // ── CashValidation (statement balance, Xero balance, unreconciled statement lines)
    const cvResp = await fetch(`${XERO_FINANCE_BASE}/CashValidation`, { headers: xeroHeaders });
    const cvText = await cvResp.text();
    if (!cvResp.ok) {
      console.error("[xero-bank-overview] CashValidation failed:", cvResp.status, cvText.slice(0, 500));
      const needsScope =
        cvResp.status === 401 ||
        cvResp.status === 403 ||
        /scope|forbidden|unauthorized|insufficient/i.test(cvText);
      return jsonResponse({
        success: false,
        needsReconnect: needsScope,
        needsFinanceScope: needsScope,
        error: needsScope
          ? "Xero Finance scope is missing. Enable finance.cashvalidation.read on the Xero app, then disconnect and reconnect Xero."
          : `CashValidation failed (${cvResp.status}).`,
        cards: [],
      });
    }

    let cashValidation: any[] = [];
    try {
      const parsed = JSON.parse(cvText);
      cashValidation = Array.isArray(parsed) ? parsed : parsed?.accounts || parsed?.Accounts || [];
    } catch {
      return jsonResponse({ success: false, error: "Invalid CashValidation response", cards: [] }, 502);
    }

    // ── Live bank account metadata (name + account number)
    const acctFilter = encodeURIComponent(`Type=="BANK"||Type=="CREDITCARD"`);
    const acctResp = await fetch(`${XERO_API_BASE}/Accounts?where=${acctFilter}`, {
      headers: xeroHeaders,
    });
    const metaById = new Map<
      string,
      { name: string; code: string | null; number: string | null; type: string | null }
    >();
    if (acctResp.ok) {
      const acctData = await acctResp.json();
      for (const a of acctData?.Accounts || []) {
        const id = String(a.AccountID || "").trim();
        if (!id) continue;
        metaById.set(id, {
          name: String(a.Name || "Bank account"),
          code: a.Code != null ? String(a.Code) : null,
          number: a.BankAccountNumber != null ? String(a.BankAccountNumber) : null,
          type: a.Type != null ? String(a.Type) : a.BankAccountType != null ? String(a.BankAccountType) : null,
        });
      }
    } else {
      console.warn("[xero-bank-overview] Accounts fetch:", acctResp.status);
      // Fallback: COA from DB
      if (tenant.tenantOrgUuid) {
        const { data: coaRows } = await supabase
          .from("xero_chart_of_accounts")
          .select("xero_account_id, account_name, account_code, account_type, bank_account_type")
          .eq("organization_id", organizationId)
          .eq("xero_tenant_id", tenant.tenantOrgUuid)
          .eq("is_active", true);
        for (const row of coaRows || []) {
          const id = String((row as any).xero_account_id || "").trim();
          if (!id) continue;
          metaById.set(id, {
            name: String((row as any).account_name || "Bank account"),
            code: (row as any).account_code != null ? String((row as any).account_code) : null,
            number: null,
            type:
              (row as any).account_type != null
                ? String((row as any).account_type)
                : (row as any).bank_account_type != null
                ? String((row as any).bank_account_type)
                : null,
          });
        }
      }
    }

    const cards: BankOverviewCard[] = [];
    for (const row of cashValidation) {
      const accountId = String(row?.accountId || row?.AccountID || "").trim();
      if (!accountId) continue;

      const statement = row?.statementBalance || row?.StatementBalance;
      const bankBalance = signedMoney(
        statement?.value ?? statement?.Value,
        statement?.type ?? statement?.Type,
      );
      const xeroBalanceRaw = row?.cashAccount?.accountBalance ?? row?.CashAccount?.AccountBalance;
      const xeroBalance =
        xeroBalanceRaw == null || Number.isNaN(Number(xeroBalanceRaw))
          ? null
          : Number(xeroBalanceRaw);

      const unreconciledCount = Number(
        row?.bankStatement?.statementLines?.unreconciledLines ??
          row?.BankStatement?.StatementLines?.UnreconciledLines ??
          0,
      ) || 0;

      const balanceAsOf = row?.statementBalanceDate || row?.StatementBalanceDate || null;
      const meta = metaById.get(accountId);

      // Skip accounts with no statement feed and no books balance and nothing to reconcile
      if (bankBalance == null && xeroBalance == null && unreconciledCount === 0) continue;

      cards.push({
        accountId,
        accountName: meta?.name || "Bank account",
        accountCode: meta?.code ?? null,
        accountNumber: meta?.number ?? null,
        accountType: meta?.type ?? null,
        bankBalance,
        xeroBalance,
        balanceAsOf: balanceAsOf ? String(balanceAsOf).slice(0, 10) : null,
        unreconciledCount,
        reconciliationUrl: buildReconciliationUrl(accountId),
      });
    }

    cards.sort((a, b) => {
      if (b.unreconciledCount !== a.unreconciledCount) {
        return b.unreconciledCount - a.unreconciledCount;
      }
      const absA = Math.abs(a.bankBalance ?? a.xeroBalance ?? 0);
      const absB = Math.abs(b.bankBalance ?? b.xeroBalance ?? 0);
      if (absB !== absA) return absB - absA;
      return a.accountName.localeCompare(b.accountName);
    });

    console.log("[xero-bank-overview] ok", {
      organizationId,
      locationId,
      tenant: tenant.tenantGuid,
      cardCount: cards.length,
    });

    return jsonResponse({
      success: true,
      cards,
      xeroOrgName: tenant.xeroOrgName,
    });
  } catch (error) {
    console.error("[xero-bank-overview] unexpected:", error);
    return jsonResponse(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unexpected error",
        cards: [],
      },
      500,
    );
  }
});
