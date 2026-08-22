/**
 * Phase D: pre-aggregated org × location × month dashboard facts.
 * Read path is a single RPC; refresh rebuilds production + profit columns.
 */

import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';

export type DashboardMonthFact = {
  organization_id: string;
  location_id: string | null;
  month_start: string;
  pms_private: number;
  pms_membership: number;
  pms_nhs: number;
  pms_total: number;
  acct_private: number | null;
  acct_membership: number | null;
  acct_nhs: number | null;
  production_income: number;
  pb_treatment_cost: number;
  pb_operating_expense: number;
  pb_total_expenses: number;
  actual_profit: number;
  cf_total_received: number | null;
  cf_total_paid: number | null;
  cf_net_cashflow: number | null;
  cf_opening_balance: number | null;
  cf_closing_balance: number | null;
  formula_version: string;
  refreshed_at: string;
};

const MONTH_KEY = 'MMM-yy';

function monthKeyFromStart(monthStart: string): string | null {
  const start = String(monthStart ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return null;
  const [y, m] = start.split('-').map(Number);
  return format(new Date(y, m - 1, 1), MONTH_KEY);
}

export async function getDashboardMonthFacts(
  organizationId: string,
  fromDate: string,
  toDate: string,
  locationId?: string | null,
): Promise<DashboardMonthFact[]> {
  const { data, error } = await (supabase as any).rpc('get_dashboard_month_facts', {
    p_organization_id: organizationId,
    p_from_date: fromDate,
    p_to_date: toDate,
    p_location_id: locationId ?? null,
  });
  if (error) throw error;
  return (data ?? []) as DashboardMonthFact[];
}

/** Rebuild facts for the range. Slow on first run; safe to fire-and-forget. */
export async function refreshDashboardMonthFacts(
  organizationId: string,
  fromDate: string,
  toDate: string,
  locationId?: string | null,
): Promise<number> {
  const { data, error } = await (supabase as any).rpc('refresh_dashboard_month_facts', {
    p_organization_id: organizationId,
    p_from_date: fromDate,
    p_to_date: toDate,
    p_location_id: locationId ?? null,
  });
  if (error) throw error;
  return Number(data) || 0;
}

/**
 * Map facts → MMM-yy revenue/profit. Returns null when any requested month is missing
 * so the caller can fall back to the live compose path.
 */
export function profitTrendFromFacts(
  facts: DashboardMonthFact[],
  monthKeys: string[],
): { revenue: Map<string, number>; profit: Map<string, number> } | null {
  const byKey = new Map<string, DashboardMonthFact>();
  for (const f of facts) {
    const key = monthKeyFromStart(f.month_start);
    if (key) byKey.set(key, f);
  }
  if (monthKeys.some((k) => !byKey.has(k))) return null;

  const revenue = new Map<string, number>();
  const profit = new Map<string, number>();
  for (const k of monthKeys) {
    const f = byKey.get(k)!;
    revenue.set(k, Number(f.production_income) || 0);
    profit.set(k, Number(f.actual_profit) || 0);
  }
  return { revenue, profit };
}
