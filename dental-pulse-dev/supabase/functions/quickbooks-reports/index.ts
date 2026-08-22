import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Live, on-demand QuickBooks report fetch for the Financial Reports page —
 * covers both Profit & Loss and Balance Sheet.
 *
 * Neither report is read from a pre-synced table here:
 *  - quickbooks_profit_loss exists but is only as fresh/complete as the last
 *    scheduled backend sync (which has its own separately-configured date
 *    window) — reading it can silently understate a report if that sync
 *    window doesn't cover the period being viewed.
 *  - QuickBooks has no Balance Sheet sync at all.
 * So both report types are fetched straight from the QuickBooks Reports API
 * every time the page asks for them and returned as flat {accountId,
 * section, name, amount} rows — no persistence, always current.
 *
 * Xero doesn't need an equivalent function — the existing xero-data function
 * already supports endpoint: "profit-and-loss" and "balance-sheet" and is
 * called directly from the frontend hook, with the report-row parsing done
 * client-side.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const QBO_MINORVERSION = "70";

type ReportType = "profit-loss" | "balance-sheet";

interface ReportRow {
  accountId: string;
  section: string | null;
  name: string | null;
  amount: number;
  sectionOrder: number;
  rowOrder: number;
  group: "assets" | "liabilities" | "equity" | null;
}

/** A native QBO total that isn't tied to a real account — e.g. "Total Income", "Net Income". */
interface SummaryRow {
  label: string;
  amount: number;
}

type BalanceSheetGroup = "assets" | "liabilities" | "equity";

function detectBalanceSheetGroup(
  title: string | null | undefined,
): BalanceSheetGroup | null {
  if (!title) return null;
  const n = title.trim().toLowerCase();
  if (n === "assets" || n === "asset") return "assets";
  if (n === "liabilities" || n === "liability") return "liabilities";
  if (
    n === "equity" ||
    n === "net assets" ||
    n === "shareholders' equity" ||
    n === "shareholders equity" ||
    n === "stockholders' equity" ||
    n === "stockholders equity"
  ) {
    return "equity";
  }
  return null;
}

interface RequestBody {
  organization_id: string;
  /** platform_integration_organizations.id for the QuickBooks company */
  entity_id: string;
  report_type: ReportType;
  // balance-sheet params (point-in-time snapshot)
  as_of_date?: string; // YYYY-MM-DD
  prior_as_of_date?: string;
  // profit-loss params (date-range total)
  from_date?: string; // YYYY-MM-DD
  to_date?: string;
  prior_from_date?: string;
  prior_to_date?: string;
}

function respond(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isTokenExpired(tokenExpiresAt: string | null): boolean {
  if (!tokenExpiresAt) return true;
  return new Date() >= new Date(new Date(tokenExpiresAt).getTime() - 5 * 60 * 1000);
}

/** Delegates to quickbooks-refresh-token — the same mutex-protected refresh the Node backend uses. */
async function refreshAccessToken(
  supabaseUrl: string,
  supabaseServiceKey: string,
  integrationId: string,
): Promise<{ access_token: string | null; error: string | null }> {
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/quickbooks-refresh-token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${supabaseServiceKey}`,
      },
      body: JSON.stringify({ integrationId }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.access_token) {
      return { access_token: null, error: data?.error || data?.details || `Refresh failed: HTTP ${response.status}` };
    }
    return { access_token: data.access_token, error: null };
  } catch (error) {
    return { access_token: null, error: error instanceof Error ? error.message : "Token refresh failed" };
  }
}

function getQboApiBase() {
  return (Deno.env.get("QUICKBOOKS_API_BASE") || "https://quickbooks.api.intuit.com").replace(/\/+$/, "");
}

async function fetchQboReport(
  accessToken: string,
  realmId: string,
  reportName: "ProfitAndLoss" | "BalanceSheet",
  startDate: string,
  endDate: string,
) {
  const params = new URLSearchParams({
    start_date: startDate,
    end_date: endDate,
    summarize_column_by: "Total",
    accounting_method: "Accrual",
    minorversion: QBO_MINORVERSION,
  });
  const url = `${getQboApiBase()}/v3/company/${realmId}/reports/${reportName}?${params.toString()}`;
  const response = await fetch(url, {
    headers: { "Authorization": `Bearer ${accessToken}`, "Accept": "application/json" },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`QuickBooks ${reportName} ${response.status}: ${text.slice(0, 300)}`);
  }
  return response.json();
}

/**
 * Shared row-tree shape across every QBO report (P&L, BalanceSheet, …):
 * Header/ColData carries a parent account's own total when that parent is
 * itself an account with sub-accounts; Summary/ColData carries a pure
 * grouping section's total (e.g. "Total Income", with no account behind it);
 * Data rows are leaf accounts; Rows nests children. A row with a label and
 * amount but no account id (Summary totals, and the top-level "Net Income"
 * row) is a native QBO total, not a real account — captured separately as a
 * summaryRow instead of being silently dropped.
 *
 * sectionOrder / rowOrder follow the depth-first walk so Financial Statements
 * can render accounts in the same sequence as QuickBooks' own Balance Sheet.
 */
function parseQboReport(report: any): { rows: ReportRow[]; summaryRows: SummaryRow[] } {
  const out: ReportRow[] = [];
  const summary: SummaryRow[] = [];
  let sectionOrderCounter = 0;
  let rowOrderCounter = 0;
  const sectionOrderByLabel = new Map<string, number>();

  const sectionOrderFor = (label: string): number => {
    let order = sectionOrderByLabel.get(label);
    if (order === undefined) {
      order = sectionOrderCounter++;
      sectionOrderByLabel.set(label, order);
    }
    return order;
  };

  function walk(
    rowTree: any,
    sectionLabel: string | null,
    currentGroup: BalanceSheetGroup | null,
  ) {
    const rows = (rowTree && rowTree.Row) || [];
    for (const r of rows) {
      let sec = sectionLabel;
      const headerTitle = r.Header?.ColData?.[0]?.value as string | undefined;
      if (!sectionLabel && headerTitle) sec = headerTitle;
      else if (!sectionLabel && r.group) sec = r.group;

      const nextGroup =
        detectBalanceSheetGroup(headerTitle) ??
        detectBalanceSheetGroup(typeof r.group === "string" ? r.group : null) ??
        currentGroup;

      const sectionKey = sec || "Other";

      if (r.Header?.ColData?.[0]) {
        const acct = r.Header.ColData[0];
        const amount = Number(r.Header.ColData[1]?.value || 0);
        if (Number.isFinite(amount) && acct.id) {
          out.push({
            accountId: String(acct.id),
            section: sec,
            name: acct.value || null,
            amount,
            sectionOrder: sectionOrderFor(sectionKey),
            rowOrder: rowOrderCounter++,
            group: nextGroup,
          });
        }
      }

      if (r.Summary?.ColData?.[0]?.value) {
        const label = r.Summary.ColData[0].value;
        const amount = Number(r.Summary.ColData[1]?.value || 0);
        if (Number.isFinite(amount)) summary.push({ label, amount });
      }

      if (r.ColData && r.type === "Data") {
        const acct = r.ColData[0] || {};
        const amount = Number(r.ColData[1]?.value || 0);
        if (Number.isFinite(amount)) {
          if (acct.id) {
            out.push({
              accountId: String(acct.id),
              section: sec,
              name: acct.value || null,
              amount,
              sectionOrder: sectionOrderFor(sectionKey),
              rowOrder: rowOrderCounter++,
              group: nextGroup,
            });
          } else if (acct.value) {
            // e.g. the top-level "Net Income" row — a real total, but not tied to an account.
            summary.push({ label: acct.value, amount });
          }
        }
      }

      if (r.Rows) walk(r.Rows, sec, nextGroup);
    }
  }

  walk(report?.Rows, null, null);

  // A parent account can appear as both a Section Header and a sibling Data
  // row; the Data row (pushed after, since we recurse into children last) wins
  // for amount, but we keep the earliest walk indexes so layout order is stable.
  const byAccount = new Map<string, ReportRow>();
  for (const row of out) {
    const prev = byAccount.get(row.accountId);
    if (!prev) {
      byAccount.set(row.accountId, row);
    } else {
      byAccount.set(row.accountId, {
        ...row,
        sectionOrder: Math.min(prev.sectionOrder, row.sectionOrder),
        rowOrder: Math.min(prev.rowOrder, row.rowOrder),
        group: prev.group ?? row.group,
      });
    }
  }
  return {
    rows: [...byAccount.values()].sort(
      (a, b) => a.sectionOrder - b.sectionOrder || a.rowOrder - b.rowOrder,
    ),
    summaryRows: summary,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseServiceKey) {
      return respond(500, { success: false, error: "Server configuration error" });
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let body: RequestBody;
    try {
      body = await req.json();
    } catch {
      return respond(400, { success: false, error: "Invalid request body" });
    }

    const { organization_id, entity_id, report_type } = body;
    if (!organization_id || !entity_id) {
      return respond(400, { success: false, error: "organization_id and entity_id are required" });
    }
    if (report_type !== "profit-loss" && report_type !== "balance-sheet") {
      return respond(400, { success: false, error: "report_type must be 'profit-loss' or 'balance-sheet'" });
    }

    // Resolve the (start, end) window for a snapshot: balance-sheet uses the
    // same as_of_date for both bounds (QBO reports a point-in-time balance
    // regardless of start_date); profit-loss sums over the given range.
    function resolveWindow(prefix: "" | "prior_"): { start: string; end: string } | null {
      if (report_type === "balance-sheet") {
        const asOf = prefix === "" ? body.as_of_date : body.prior_as_of_date;
        return asOf ? { start: asOf, end: asOf } : null;
      }
      const from = prefix === "" ? body.from_date : body.prior_from_date;
      const to = prefix === "" ? body.to_date : body.prior_to_date;
      return from && to ? { start: from, end: to } : null;
    }

    const currentWindow = resolveWindow("");
    if (!currentWindow) {
      return respond(400, {
        success: false,
        error: report_type === "balance-sheet" ? "as_of_date is required" : "from_date and to_date are required",
      });
    }
    const priorWindow = resolveWindow("prior_");

    const { data: entity, error: entityErr } = await supabase
      .from("platform_integration_organizations")
      .select("id, platform_name, platform_org_id, platform_integration_id")
      .eq("id", entity_id)
      .eq("organization_id", organization_id)
      .eq("platform_name", "quickbooks")
      .single();

    if (entityErr || !entity) {
      return respond(404, { success: false, error: "QuickBooks company not found" });
    }

    const { data: integration, error: integErr } = await supabase
      .from("platform_integrations")
      .select("id, access_token, refresh_token, token_expires_at, is_connected")
      .eq("id", entity.platform_integration_id)
      .single();

    if (integErr || !integration) {
      return respond(404, { success: false, error: "Integration not found" });
    }
    if (!integration.is_connected) {
      return respond(400, { success: false, error: "QuickBooks is not connected" });
    }

    let accessToken: string = integration.access_token;
    if (isTokenExpired(integration.token_expires_at)) {
      const refreshed = await refreshAccessToken(supabaseUrl, supabaseServiceKey, integration.id);
      if (!refreshed.access_token) {
        return respond(401, { success: false, error: refreshed.error || "Failed to refresh token" });
      }
      accessToken = refreshed.access_token;
    }

    const reportName = report_type === "balance-sheet" ? "BalanceSheet" : "ProfitAndLoss";

    async function fetchWindow(window: { start: string; end: string }) {
      const report = await fetchQboReport(accessToken, entity.platform_org_id, reportName, window.start, window.end);
      return parseQboReport(report);
    }

    const current = await fetchWindow(currentWindow);
    const prior = priorWindow ? await fetchWindow(priorWindow) : null;

    return respond(200, {
      success: true,
      current: { rows: current.rows, summaryRows: current.summaryRows },
      prior: prior ? { rows: prior.rows, summaryRows: prior.summaryRows } : null,
    });
  } catch (error) {
    console.error("[quickbooks-reports] Error:", error);
    return respond(500, {
      success: false,
      error: "Internal server error",
      details: error instanceof Error ? error.message : String(error),
    });
  }
});
