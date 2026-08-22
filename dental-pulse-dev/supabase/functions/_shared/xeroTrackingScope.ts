/**
 * Shared Xero location → tenant + tracking-option scope for cashflow screens.
 *
 * Single location  → that location's tracking option (if mapped).
 * Other location   → that other location's option (possibly another category).
 * All Locations    → union of mapped options on visible practices (not raw tenant).
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type XeroTrackingOptionScope = {
  trackingCategoryId: string;
  trackingOptionId: string;
  platformOrgId: string;
};

export type XeroTrackingScope = {
  trackingOptionIds: string[];
  trackingCategoryId: string | null;
  tenantOrgRowIds: string[];
  mappedPlatformOrgId: string | null;
  excludeFromFinancialDisplay: boolean;
  /** One live Xero BS call per mapped option (All Locations = union). */
  optionScopes: XeroTrackingOptionScope[];
};

export function normalizeTrackingOptionIds(
  ids: string | string[] | null | undefined
): string[] {
  const list = Array.isArray(ids) ? ids : ids ? [ids] : [];
  return [...new Set(list.map((id) => String(id || "").trim()).filter(Boolean))];
}

/** PostgREST filter: one option = contains, many = overlaps. */
export function applyTrackingOptionIdsFilter<
  Q extends {
    contains?: (col: string, val: string[]) => Q;
    overlaps?: (col: string, val: string[]) => Q;
  },
>(query: Q, trackingOptionIds: string[] | null | undefined, enabled = true): Q {
  const ids = normalizeTrackingOptionIds(trackingOptionIds);
  if (!enabled || ids.length === 0) return query;
  if (ids.length === 1 && typeof query.contains === "function") {
    return query.contains("tracking_option_ids", [ids[0]]);
  }
  if (typeof query.overlaps === "function") {
    return query.overlaps("tracking_option_ids", ids);
  }
  return query;
}

async function loadHiddenLocationIds(
  // deno-lint-ignore no-explicit-any
  supabase: SupabaseClient<any>,
  organizationId: string
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("practice_locations")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("exclude_from_financial_display", true);
  if (error) return new Set();
  return new Set((data || []).map((r: { id: string }) => String(r.id)));
}

/**
 * Resolve tenant row ids + tracking option ids for a practice location,
 * or the union of visible mapped locations when locationId is null (All Locations).
 */
export async function resolveXeroTrackingScope(
  // deno-lint-ignore no-explicit-any
  supabase: SupabaseClient<any>,
  organizationId: string,
  xeroIntegrationId: string | null | undefined,
  locationId: string | null | undefined
): Promise<XeroTrackingScope> {
  const empty: XeroTrackingScope = {
    trackingOptionIds: [],
    trackingCategoryId: null,
    tenantOrgRowIds: [],
    mappedPlatformOrgId: null,
    excludeFromFinancialDisplay: false,
    optionScopes: [],
  };
  const loc = locationId ? String(locationId).trim() : "";
  const xeroId = xeroIntegrationId ? String(xeroIntegrationId).trim() : "";

  if (loc) {
    const { data: excl } = await supabase
      .from("practice_locations")
      .select("exclude_from_financial_display")
      .eq("id", loc)
      .maybeSingle();
    if (
      (excl as { exclude_from_financial_display?: boolean } | null)
        ?.exclude_from_financial_display
    ) {
      return { ...empty, excludeFromFinancialDisplay: true };
    }
  }

  const hidden = loc ? new Set<string>() : await loadHiddenLocationIds(supabase, organizationId);

  let q = supabase
    .from("platform_integration_organization_mapping")
    .select(
      `
      platform_integration_id,
      platform_integration_organizations_id,
      xero_tracking_category_id,
      xero_tracking_option_id,
      location_id,
      platform_integration_organizations (
        platform_name,
        platform_org_id
      )
    `
    )
    .eq("organization_id", organizationId)
    .not("location_id", "is", null);

  if (loc) q = q.eq("location_id", loc);
  if (xeroId) q = q.eq("platform_integration_id", xeroId);

  const { data, error } = await q;
  if (error) {
    console.warn("[xeroTrackingScope] mapping select:", error.message);
    return empty;
  }

  const optionIds = new Set<string>();
  const tenantIds = new Set<string>();
  const optionScopes: XeroTrackingOptionScope[] = [];
  const optionScopeKeys = new Set<string>();
  let trackingCategoryId: string | null = null;
  let mappedPlatformOrgId: string | null = null;

  for (const row of data || []) {
    const locationRowId = String((row as { location_id?: string }).location_id || "").trim();
    if (locationRowId && hidden.has(locationRowId)) continue;

    const org = (row as {
      platform_integration_organizations?: {
        platform_name?: string;
        platform_org_id?: string;
      } | Array<{ platform_name?: string; platform_org_id?: string }>;
    }).platform_integration_organizations;
    const orgRow = Array.isArray(org) ? org[0] : org;
    const platformName = String(orgRow?.platform_name || "").toLowerCase();
    if (xeroId && platformName && platformName !== "xero") continue;

    const tenantId = String(
      (row as { platform_integration_organizations_id?: string })
        .platform_integration_organizations_id || ""
    ).trim();
    if (tenantId) tenantIds.add(tenantId);

    const optionId = String(
      (row as { xero_tracking_option_id?: string }).xero_tracking_option_id || ""
    ).trim();
    if (optionId) optionIds.add(optionId);

    const catId = String(
      (row as { xero_tracking_category_id?: string }).xero_tracking_category_id || ""
    ).trim();
    if (catId && !trackingCategoryId) trackingCategoryId = catId;

    const orgId = String(orgRow?.platform_org_id || "").trim();
    if (orgId && !mappedPlatformOrgId) mappedPlatformOrgId = orgId;
    if (catId && optionId && orgId) {
      const key = `${orgId}:${catId}:${optionId}`;
      if (!optionScopeKeys.has(key)) {
        optionScopeKeys.add(key);
        optionScopes.push({
          trackingCategoryId: catId,
          trackingOptionId: optionId,
          platformOrgId: orgId,
        });
      }
    }
  }

  return {
    trackingOptionIds: [...optionIds],
    trackingCategoryId,
    tenantOrgRowIds: [...tenantIds],
    mappedPlatformOrgId,
    excludeFromFinancialDisplay: false,
    optionScopes,
  };
}

/**
 * Account ids mapped under Setup Categories → Bank for a location
 * (or all visible practice locations when locationId is null).
 */
export async function loadSetupBankAccountIds(
  // deno-lint-ignore no-explicit-any
  supabase: SupabaseClient<any>,
  organizationId: string,
  options?: {
    locationId?: string | null;
    platformIntegrationId?: string | null;
  }
): Promise<string[]> {
  const { data: bankMaster, error: masterErr } = await supabase
    .from("category_range_master")
    .select("id")
    .eq("range_group", "Bank")
    .limit(1)
    .maybeSingle();
  if (masterErr || !bankMaster?.id) return [];

  let q = supabase
    .from("category_range_map")
    .select("location_id")
    .eq("organization_id", organizationId)
    .eq("category_range_id", bankMaster.id);

  if (options?.platformIntegrationId) {
    q = q.eq("platform_integration_id", options.platformIntegrationId);
  }

  if (options?.locationId) {
    q = q.eq("mapping_location_id", options.locationId);
  } else {
    q = q.not("mapping_location_id", "is", null);
  }

  const { data, error } = await q;
  if (error) return [];

  const ids = new Set<string>();
  for (const row of data || []) {
    const id = String((row as { location_id?: string }).location_id || "").trim();
    if (id) ids.add(id);
  }

  if (ids.size === 0 && options?.locationId) {
    let fb = supabase
      .from("category_range_map")
      .select("location_id")
      .eq("organization_id", organizationId)
      .eq("category_range_id", bankMaster.id)
      .is("mapping_location_id", null);
    if (options?.platformIntegrationId) {
      fb = fb.or(
        `platform_integration_id.eq.${options.platformIntegrationId},platform_integration_id.is.null`
      );
    }
    const { data: fbRows } = await fb;
    for (const row of fbRows || []) {
      const id = String((row as { location_id?: string }).location_id || "").trim();
      if (id) ids.add(id);
    }
  }

  return [...ids];
}
