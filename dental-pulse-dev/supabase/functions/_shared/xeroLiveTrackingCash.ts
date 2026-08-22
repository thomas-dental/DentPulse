/**
 * Live Xero Balance Sheet cash for a tracking option — same source as
 * Financial Reports and a tracking-filtered Xero Excel export
 * ("Total Cash at bank and in hand").
 */

import type { XeroTrackingOptionScope } from "./xeroTrackingScope.ts";

function parseXeroAmount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value == null || value === "") return 0;
  const cleaned = String(value).replace(/[^0-9.-]/g, "");
  if (!cleaned || cleaned === "-" || cleaned === ".") return 0;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function isCashSummaryLabel(label: string): boolean {
  const t = label.trim().toLowerCase();
  return (
    t.includes("total cash at bank") ||
    t === "total cash at bank and in hand" ||
    t.includes("cash at bank and in hand")
  );
}

function isCashSectionTitle(title: unknown): boolean {
  const t = String(title || "").trim().toLowerCase();
  return t.includes("cash at bank") || t === "bank" || t.includes("bank and in hand");
}

function extractTotalCashFromReport(report: Record<string, unknown> | null): number | null {
  if (!report) return null;
  let summaryCash: number | null = null;
  let sectionCash = 0;
  let sawCashSection = false;

  const walk = (rows: unknown[], sectionTitle: string | null) => {
    for (const raw of rows || []) {
      const r = raw as {
        RowType?: string;
        Title?: string;
        Rows?: unknown[];
        Cells?: Array<{ Value?: unknown }>;
      };
      if (r.RowType === "Section") {
        walk(r.Rows || [], r.Title || sectionTitle);
        continue;
      }
      if (!Array.isArray(r.Cells) || r.Cells.length < 2) continue;
      const label = String(r.Cells[0]?.Value || "").trim();
      const amount = parseXeroAmount(r.Cells[1]?.Value);
      if (!label) continue;
      if (isCashSummaryLabel(label)) {
        summaryCash = amount;
        continue;
      }
      if (
        (r.RowType === "Row" || r.RowType === "SummaryRow") &&
        isCashSectionTitle(sectionTitle) &&
        !/^total\s+/i.test(label)
      ) {
        sawCashSection = true;
        sectionCash += amount;
      }
    }
  };

  walk((report.Rows as unknown[]) || [], null);
  if (summaryCash != null) return summaryCash;
  if (sawCashSection) return sectionCash;
  return null;
}

async function fetchOneLiveCash(
  organizationId: string,
  xeroIntegrationId: string,
  asAtDate: string,
  scope: XeroTrackingOptionScope
): Promise<number | null> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return null;

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/xero-data`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
      },
      body: JSON.stringify({
        organization_id: organizationId,
        endpoint: "balance-sheet",
        to_date: asAtDate,
        integration_id: xeroIntegrationId,
        tenant_ids: [scope.platformOrgId],
        tracking_category_id: scope.trackingCategoryId,
        tracking_option_id: scope.trackingOptionId,
      }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.success) {
      console.warn("[xeroLiveTrackingCash] xero-data failed", {
        status: res.status,
        error: json?.error,
        asAtDate,
        option: scope.trackingOptionId,
      });
      return null;
    }
    const tenantKey = `balanceSheet_${scope.platformOrgId}`;
    const result = json.data?.[tenantKey] ?? json.data?.balanceSheet;
    if (!result?.success) {
      console.warn("[xeroLiveTrackingCash] tenant report failed", result?.error);
      return null;
    }
    const report = result.data?.Reports?.[0] ?? null;
    return extractTotalCashFromReport(report);
  } catch (err) {
    console.warn(
      "[xeroLiveTrackingCash] fetch error:",
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
}

/** Sum of tracking-filtered "Total Cash at bank and in hand" as at date. */
export async function fetchLiveXeroTrackingCashTotal(
  organizationId: string,
  xeroIntegrationId: string,
  asAtDate: string,
  optionScopes: XeroTrackingOptionScope[]
): Promise<number | null> {
  const scopes = (optionScopes || []).filter(
    (s) => s.trackingCategoryId && s.trackingOptionId && s.platformOrgId
  );
  if (scopes.length === 0) return null;

  let total = 0;
  let any = false;
  for (const scope of scopes) {
    const cash = await fetchOneLiveCash(organizationId, xeroIntegrationId, asAtDate, scope);
    if (cash == null) continue;
    total += cash;
    any = true;
  }
  return any ? total : null;
}

/**
 * Live Xero "Total Cash at bank and in hand" for several as-at dates.
 * Used so monthly Money In/Out closing columns match the tracking BS,
 * including a mid-month end date (not only calendar month-end).
 */
export async function fetchLiveXeroTrackingCashTotalsByDates(
  organizationId: string,
  xeroIntegrationId: string,
  asAtDates: string[],
  optionScopes: XeroTrackingOptionScope[]
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const scopes = (optionScopes || []).filter(
    (s) => s.trackingCategoryId && s.trackingOptionId && s.platformOrgId
  );
  if (scopes.length === 0) return out;

  const unique = [
    ...new Set(
      asAtDates
        .map((d) => String(d || "").slice(0, 10))
        .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    ),
  ];
  for (const asAtDate of unique) {
    const total = await fetchLiveXeroTrackingCashTotal(
      organizationId,
      xeroIntegrationId,
      asAtDate,
      scopes
    );
    if (total != null) out.set(asAtDate, total);
  }
  return out;
}
