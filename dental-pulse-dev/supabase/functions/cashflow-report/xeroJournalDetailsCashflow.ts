/**
 * Category-path source for Xero when finance_journal_lines is empty.
 * Reads synced xero_journal_details (same raw store as Transactions to Review).
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isManualJournalType } from "./manualJournalFilter.ts";
import { applyTrackingOptionIdsFilter } from "../_shared/xeroTrackingScope.ts";

const PAGE = 1000;

function lineAmount(row: { gross_amount?: unknown; net_amount?: unknown }): number {
  const gross = row.gross_amount;
  if (gross != null && gross !== "" && !Number.isNaN(Number(gross))) {
    return Number(gross);
  }
  return Number(row.net_amount) || 0;
}

// deno-lint-ignore no-explicit-any
async function loadManualJournalIdSet(
  supabase: SupabaseClient<any>,
  organizationId: string,
  xeroIntegrationId: string
): Promise<Set<string>> {
  const out = new Set<string>();
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from("xero_journals")
      .select("journal_id, source_type, source_type_desc")
      .eq("organization_id", organizationId)
      .eq("platform_integration_id", xeroIntegrationId)
      .or("source_type.eq.MANJOURNAL,source_type.eq.MANUALJOURNAL,source_type_desc.eq.ManualJournal")
      .range(offset, offset + PAGE - 1);
    if (error || !data?.length) break;
    for (const row of data) {
      const jid = row.journal_id != null ? String(row.journal_id).trim() : "";
      if (jid && isManualJournalType(row.source_type, row.source_type_desc)) out.add(jid);
    }
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return out;
}

/**
 * Resolve platform_integration_organizations.id for a Xero tenant UUID.
 */
// deno-lint-ignore no-explicit-any
export async function resolveXeroTenantOrgRowId(
  supabase: SupabaseClient<any>,
  organizationId: string,
  xeroIntegrationId: string,
  mappedLegalEntityId: string | null
): Promise<string | null> {
  if (!mappedLegalEntityId?.trim()) return null;
  const { data, error } = await supabase
    .from("platform_integration_organizations")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("platform_integration_id", xeroIntegrationId)
    .eq("platform_org_id", mappedLegalEntityId.trim())
    .maybeSingle();
  if (error) {
    console.warn("[xeroJournalDetailsCashflow] tenant lookup:", error.message);
    return null;
  }
  return data?.id ? String(data.id) : null;
}

/**
 * Map xero_journal_details into the loose PL/BS-like shape used by
 * category-based cashflow-report aggregation.
 *
 * amount uses Xero journal sign convention (same as gross_amount on details).
 * Caller applies the Xero sign flip when aggregating (canonicalPlatform === "xero").
 *
 * @param tenantOrgRowId single location tenant, OR
 * @param tenantOrgRowIds All Locations mapped practice tenants (excludes unmapped orgs)
 */
// deno-lint-ignore no-explicit-any
export async function fetchXeroJournalDetailsLikePlBsForCashflowReport(
  supabase: SupabaseClient<any>,
  organizationId: string,
  xeroIntegrationId: string,
  fromDate: string,
  toDate: string,
  tenantOrgRowId?: string | null,
  tenantOrgRowIds?: string[] | null,
  trackingOptionId?: string | string[] | null
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  let offset = 0;
  const manualJournalIds = await loadManualJournalIdSet(supabase, organizationId, xeroIntegrationId);

  const single = tenantOrgRowId ? String(tenantOrgRowId).trim() : "";
  const many = (tenantOrgRowIds || []).map((id) => String(id).trim()).filter(Boolean);
  const useMany = Array.isArray(tenantOrgRowIds);
  const trackingIds = Array.isArray(trackingOptionId)
    ? trackingOptionId.map((id) => String(id || "").trim()).filter(Boolean)
    : trackingOptionId
      ? [String(trackingOptionId).trim()].filter(Boolean)
      : [];
  if (useMany && many.length === 0) {
    console.warn(
      "[xeroJournalDetailsCashflow] skipped: no mapped practice Xero tenants for All Locations"
    );
    return out;
  }

  // tracking_option_ids exists only after tracking-categories migration.
  // Selecting a missing column returns zero rows and blanks Total Received/Paid.
  const BASE_SELECT =
    "id, journal_id, platform_journal_id, journal_date, account_id, account_code, account_name, account_type, description, net_amount, gross_amount, journal_line_id";
  let includeTrackingCol = true;

  while (true) {
    let q = supabase
      .from("xero_journal_details")
      .select(includeTrackingCol ? `${BASE_SELECT}, tracking_option_ids` : BASE_SELECT)
      .eq("organization_id", organizationId)
      .eq("platform_integration_id", xeroIntegrationId)
      .gte("journal_date", fromDate)
      .lte("journal_date", toDate)
      .order("journal_date", { ascending: true })
      .range(offset, offset + PAGE - 1);

    if (single) {
      q = q.eq("platform_integration_organization_id", single);
    } else if (useMany) {
      q = q.in("platform_integration_organization_id", many);
    }

    q = applyTrackingOptionIdsFilter(q, trackingIds, includeTrackingCol);

    const { data, error } = await q;
    if (error) {
      if (includeTrackingCol && /tracking_option_ids/i.test(error.message || "")) {
        console.warn(
          "[xeroJournalDetailsCashflow] tracking_option_ids missing; retrying without tracking filter:",
          error.message
        );
        includeTrackingCol = false;
        offset = 0;
        out.length = 0;
        continue;
      }
      console.warn("[xeroJournalDetailsCashflow] details query:", error.message);
      break;
    }
    if (!data?.length) break;

    for (const row of data as Record<string, unknown>[]) {
      const pj = String(row.platform_journal_id || row.journal_id || "").trim();
      if (pj && manualJournalIds.has(pj)) continue;
      const amount = lineAmount(row);
      const dateStr = String(row.journal_date || "");
      out.push({
        id: row.id,
        doc_id: String(row.platform_journal_id || row.journal_id || row.id || ""),
        account_id: row.account_id ?? null,
        account_code: row.account_code ?? null,
        account_name: row.account_name ?? null,
        account_type: row.account_type ?? null,
        amount,
        period_date: dateStr,
        post_date: dateStr,
        doc_class: null,
        description: row.description ?? null,
        doc_description: null,
      });
    }

    if (data.length < PAGE) break;
    offset += PAGE;
  }

  console.log(
    `[xeroJournalDetailsCashflow] loaded ${out.length} journal detail lines ` +
      `(integration=${xeroIntegrationId}, tenantRow=${single || (useMany ? `mapped:${many.length}` : "all")}, ` +
      `trackingOption=${trackingIds.join(",") || "none"}, excludedManualJournals=${manualJournalIds.size})`
  );
  return out;
}

/** Bank account ids for Xero COA (optional tenant filter via xero_tenant_id = org row id or platform_org_id). */
// deno-lint-ignore no-explicit-any
export async function loadXeroBankAccountIdsForCashflow(
  supabase: SupabaseClient<any>,
  organizationId: string,
  xeroIntegrationId: string,
  tenantOrgRowId?: string | null,
  mappedLegalEntityId?: string | null,
  tenantOrgRowIds?: string[] | null
): Promise<string[]> {
  let q = supabase
    .from("xero_chart_of_accounts")
    .select("xero_account_id, account_type, bank_account_type, xero_tenant_id")
    .eq("organization_id", organizationId)
    .eq("platform_integration_id", xeroIntegrationId)
    .eq("is_active", true);

  const { data, error } = await q;
  if (error) {
    console.warn("[xeroJournalDetailsCashflow] bank COA:", error.message);
    return [];
  }

  const single = tenantOrgRowId ? String(tenantOrgRowId).trim() : "";
  const many = (tenantOrgRowIds || []).map((id) => String(id).trim()).filter(Boolean);
  const useMany = Array.isArray(tenantOrgRowIds);
  const tenantKeys = new Set(
    [single, mappedLegalEntityId, ...many]
      .map((v) => (v ? String(v).trim() : ""))
      .filter(Boolean)
  );
  // All Locations with explicit mapped list but empty → no banks
  if (useMany && many.length === 0) return [];

  const ids: string[] = [];
  for (const r of data || []) {
    const row = r as {
      xero_account_id?: string | null;
      account_type?: string | null;
      bank_account_type?: string | null;
      xero_tenant_id?: string | null;
    };
    if (tenantKeys.size > 0) {
      const t = String(row.xero_tenant_id || "").trim();
      if (t && !tenantKeys.has(t)) continue;
    }
    const accType = String(row.account_type || "").trim().toUpperCase();
    const isBank =
      (row.bank_account_type != null && String(row.bank_account_type).trim() !== "") ||
      accType === "BANK" ||
      accType === "CREDITCARD";
    if (!isBank) continue;
    const id = row.xero_account_id ? String(row.xero_account_id).trim() : "";
    if (id) ids.push(id);
  }
  return [...new Set(ids)];
}
