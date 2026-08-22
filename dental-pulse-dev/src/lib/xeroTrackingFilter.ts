/**
 * Shared helpers for Xero tenant + tracking option financial filters.
 * Used by frontend hooks; edge functions mirror the same rules inline.
 */

import { supabase } from '@/integrations/supabase/client';

export interface XeroLocationScopeFilter {
  /** platform_integration_organizations.id (internal UUID) */
  tenantOrgIds: string[];
  /** Xero TrackingOptionID when location is split within a shared tenant */
  trackingOptionId: string | null;
  trackingCategoryId: string | null;
  excludeFromFinancialDisplay?: boolean;
}

/** Tenant + Practice tracking options for one or more practice locations. */
export interface XeroJournalLocationScope {
  /** platform_integration_organizations.id on xero_journal_details */
  tenantOrgRowIds: string[];
  /** Xero TrackingOptionIDs (e.g. Practice → Appoline Dental Care) */
  trackingOptionIds: string[];
  /** Set when exactly one tracking option applies */
  trackingOptionId: string | null;
}

export function hasTrackingScope(scope: XeroLocationScopeFilter | null | undefined): boolean {
  return !!scope?.trackingOptionId;
}

/**
 * PostgREST / supabase-js filter fragment for journal/invoice/bank lines.
 * When trackingOptionId is set, require tracking_option_ids to contain it.
 */
export function applyTrackingOptionFilter<T extends { contains?: (col: string, val: string[]) => T; filter?: (col: string, op: string, val: string) => T }>(
  query: T,
  trackingOptionId: string | null | undefined,
): T {
  if (!trackingOptionId) return query;
  // supabase-js: .contains('tracking_option_ids', [optionId])
  if (typeof query.contains === 'function') {
    return query.contains('tracking_option_ids', [trackingOptionId]);
  }
  return query;
}

type JournalScopeQuery = {
  eq?: (col: string, val: string) => JournalScopeQuery;
  in?: (col: string, val: string[]) => JournalScopeQuery;
  contains?: (col: string, val: string[]) => JournalScopeQuery;
  overlaps?: (col: string, val: string[]) => JournalScopeQuery;
};

/**
 * Restrict xero_journal_details (or invoice/bank lines) to a location's
 * Xero tenant and Practice tracking option(s).
 */
export function applyXeroJournalLocationScope<T extends JournalScopeQuery>(
  query: T,
  scope: Pick<XeroJournalLocationScope, 'tenantOrgRowIds' | 'trackingOptionIds'> | null | undefined,
): T {
  if (!scope) return query;
  let q: JournalScopeQuery = query;
  if (scope.tenantOrgRowIds.length === 1 && typeof q.eq === 'function') {
    q = q.eq('platform_integration_organization_id', scope.tenantOrgRowIds[0]);
  } else if (scope.tenantOrgRowIds.length > 1 && typeof q.in === 'function') {
    q = q.in('platform_integration_organization_id', scope.tenantOrgRowIds);
  }
  if (scope.trackingOptionIds.length === 1 && typeof q.contains === 'function') {
    q = q.contains('tracking_option_ids', [scope.trackingOptionIds[0]]);
  } else if (scope.trackingOptionIds.length > 1 && typeof q.overlaps === 'function') {
    q = q.overlaps('tracking_option_ids', scope.trackingOptionIds);
  }
  return q as T;
}

/**
 * Resolve Xero tenant row ids + Practice tracking options for the given
 * practice location(s). Empty locationIds → no extra journal filters.
 */
export async function resolveLocationXeroJournalScope(
  organizationId: string,
  locationIds: string[],
): Promise<XeroJournalLocationScope> {
  const empty: XeroJournalLocationScope = {
    tenantOrgRowIds: [],
    trackingOptionIds: [],
    trackingOptionId: null,
  };
  const ids = locationIds.map((id) => String(id || '').trim()).filter(Boolean);
  if (!organizationId || ids.length === 0) return empty;

  const { data, error } = await (supabase as any)
    .from('platform_integration_organization_mapping')
    .select('platform_integration_organizations_id, xero_tracking_option_id')
    .eq('organization_id', organizationId)
    .in('location_id', ids);
  if (error) throw error;

  const tenants = new Set<string>();
  const options = new Set<string>();
  for (const row of (data ?? []) as Array<{
    platform_integration_organizations_id?: string | null;
    xero_tracking_option_id?: string | null;
  }>) {
    const tenant = String(row.platform_integration_organizations_id || '').trim();
    if (tenant) tenants.add(tenant);
    const option = String(row.xero_tracking_option_id || '').trim();
    if (option) options.add(option);
  }
  const trackingOptionIds = [...options];
  return {
    tenantOrgRowIds: [...tenants],
    trackingOptionIds,
    trackingOptionId: trackingOptionIds.length === 1 ? trackingOptionIds[0] : null,
  };
}

/** True when a location should be omitted from financial aggregates/pickers. */
export function isFinanciallyHiddenLocation(loc: {
  exclude_from_financial_display?: boolean | null;
}): boolean {
  return !!loc.exclude_from_financial_display;
}
