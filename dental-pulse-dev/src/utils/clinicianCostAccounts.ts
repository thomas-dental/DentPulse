/**
 * Clinician Cost is not a separately mapped Setup Categories bucket.
 * It is always Hygienist + Dentist + Therapist (group_account masters).
 */

import { supabase } from '@/integrations/supabase/client';

export const CLINICIAN_ROLE_GROUP_CODES = ['Hygienist', 'Dentist', 'Therapist'] as const;

/** Cost-group codes that make up Clinician Cost (excludes the legacy ClinicianCost master). */
export function isClinicianRoleGroupCode(code: string | null | undefined): boolean {
  return CLINICIAN_ROLE_GROUP_CODES.includes(
    String(code || '') as (typeof CLINICIAN_ROLE_GROUP_CODES)[number],
  );
}

/**
 * Union account IDs mapped to Hygienist + Dentist + Therapist for a location
 * (or all mapped locations when locationId is null/"all").
 */
export async function fetchClinicianCostAccountIds(
  organizationId: string,
  locationId?: string | null,
): Promise<string[]> {
  const { data: masters, error: masterErr } = await supabase
    .from('group_account_master')
    .select('id, group_code')
    .eq('group_type', 2)
    .in('group_code', [...CLINICIAN_ROLE_GROUP_CODES]);

  if (masterErr) {
    console.error('[fetchClinicianCostAccountIds] master lookup failed:', masterErr);
    return [];
  }

  const masterIds = ((masters ?? []) as Array<{ id: number }>).map((m) => m.id);
  if (masterIds.length === 0) return [];

  const normalizedLocationId =
    locationId && String(locationId).toLowerCase() !== 'all' ? locationId : null;

  let query = supabase
    .from('group_account')
    .select('account_id, mapping_location_id')
    .eq('organization_id', organizationId)
    .in('group_account_master_id', masterIds);

  if (normalizedLocationId) {
    query = query.eq('mapping_location_id', normalizedLocationId);
  } else {
    query = query.not('mapping_location_id', 'is', null);
  }

  const { data, error } = await query;
  if (error) {
    console.error('[fetchClinicianCostAccountIds] group_account lookup failed:', error);
    return [];
  }

  const ids = new Set<string>();
  for (const row of (data ?? []) as Array<{ account_id: string | null }>) {
    const id = (row.account_id || '').trim();
    if (id) ids.add(id);
  }
  return [...ids];
}

/** Union Hygienist + Dentist + Therapist account lists from Setup Categories local state. */
export function unionClinicianRoleAccounts(
  localExpenseGroups: Record<number, string[]>,
  costGroupOptions: Array<{ id: number; group_code: string }>,
): string[] {
  const ids = new Set<string>();
  for (const g of costGroupOptions) {
    if (!isClinicianRoleGroupCode(g.group_code)) continue;
    for (const id of localExpenseGroups[g.id] || []) {
      if (id) ids.add(id);
    }
  }
  return [...ids];
}
