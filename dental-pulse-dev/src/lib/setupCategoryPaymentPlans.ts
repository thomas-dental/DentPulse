import { supabase } from '@/integrations/supabase/client';

/**
 * Setup Categories Profit → Revenue PMS mappings (Private / Membership / NHS).
 * Selected payment-plan IDs are the source of truth — including inactive
 * Dentally plans. Never filter on pp_is_active when resolving these lists.
 */

export type SetupCategoryPlanBucket = 'private' | 'membership' | 'nhs';

const COLUMNS: Record<SetupCategoryPlanBucket, readonly [string, string]> = {
  private: ['private_income_accounts', 'provider_private_income_accounts'],
  membership: ['membership_income_accounts', 'provider_membership_income_accounts'],
  nhs: ['nhs_income_accounts', 'provider_nhs_income_accounts'],
};

export function parseNumericPlanIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const out: number[] = [];
  for (const v of value) {
    const txt = String(v ?? '').trim();
    if (!/^\d+$/.test(txt)) continue;
    const n = Number(txt);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

export function jsonbHasNumericPlanIds(value: unknown): boolean {
  return parseNumericPlanIds(value).length > 0;
}

type PlanNameRow = { pp_id: number | null; pp_name: string | null };

function expandSelectedIds(selected: number[], rows: PlanNameRow[]): number[] {
  const selectedSet = new Set(selected);
  const names = new Set<string>();
  for (const r of rows) {
    if (r.pp_id != null && selectedSet.has(Number(r.pp_id)) && r.pp_name) {
      names.add(r.pp_name);
    }
  }
  const expanded = new Set(selected);
  for (const r of rows) {
    if (r.pp_id == null) continue;
    if (r.pp_name && names.has(r.pp_name)) expanded.add(Number(r.pp_id));
  }
  return [...expanded];
}

/**
 * Same-name expansion used by the net-production RPCs: TPIs at other sites
 * often carry a sibling pp_id with the same Dentally plan name. Inactive
 * siblings are included.
 */
export async function expandPaymentPlanIdsByName(
  organizationId: string,
  selectedPpIds: Iterable<number>,
): Promise<number[]> {
  const selected = [...new Set(selectedPpIds)].filter((n) => Number.isFinite(n));
  if (selected.length === 0) return [];

  const { data, error } = await (supabase as any)
    .from('payment_plans')
    .select('pp_id, pp_name')
    .eq('organization_id', organizationId)
    .is('deleted_at', null);
  if (error) {
    console.warn('[expandPaymentPlanIdsByName] lookup failed:', error);
    return selected;
  }
  return expandSelectedIds(selected, (data ?? []) as PlanNameRow[]);
}

export async function fetchSetupCategoryPaymentPlanIds(
  organizationId: string,
  locationId: string | null | undefined,
  buckets: SetupCategoryPlanBucket[] = ['private'],
): Promise<Record<SetupCategoryPlanBucket, number[]>> {
  const result: Record<SetupCategoryPlanBucket, number[]> = {
    private: [],
    membership: [],
    nhs: [],
  };
  if (!organizationId || buckets.length === 0) return result;

  const selectCols = [
    ...new Set(buckets.flatMap((b) => [...COLUMNS[b]])),
    'private_income_source',
    'membership_income_source',
    'nhs_income_source',
  ].join(', ');
  let query = (supabase as any)
    .from('practice_locations')
    .select(selectCols)
    .eq('organization_id', organizationId)
    .is('deleted_at', null);
  if (locationId && locationId !== 'all') {
    query = query.eq('id', locationId);
  }
  const { data, error } = await query;
  if (error) {
    console.warn('[fetchSetupCategoryPaymentPlanIds] failed:', error);
    return result;
  }

  const rawByBucket: Record<SetupCategoryPlanBucket, Set<number>> = {
    private: new Set(),
    membership: new Set(),
    nhs: new Set(),
  };
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    for (const bucket of buckets) {
      if (bucket === 'membership' && String(row.membership_income_source || 'accounting') !== 'pms') {
        continue;
      }
      if (bucket === 'nhs' && String(row.nhs_income_source || 'accounting') !== 'pms') {
        continue;
      }
      for (const col of COLUMNS[bucket]) {
        for (const n of parseNumericPlanIds(row[col])) rawByBucket[bucket].add(n);
      }
    }
  }

  const anySelected = buckets.some((b) => rawByBucket[b].size > 0);
  let planRows: PlanNameRow[] = [];
  if (anySelected) {
    const { data: plans, error: planErr } = await (supabase as any)
      .from('payment_plans')
      .select('pp_id, pp_name')
      .eq('organization_id', organizationId)
      .is('deleted_at', null);
    if (planErr) {
      console.warn('[fetchSetupCategoryPaymentPlanIds] plan lookup failed:', planErr);
    } else {
      planRows = (plans ?? []) as PlanNameRow[];
    }
  }

  for (const bucket of buckets) {
    result[bucket] = expandSelectedIds([...rawByBucket[bucket]], planRows);
  }
  return result;
}
