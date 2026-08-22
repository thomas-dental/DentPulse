import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from './useOrganization';
import { useFilters } from '@/contexts/FilterContext';
import type { EbitdaAccountMappings } from './useEbitdaAccountMappings';

export interface EbitdaBridgeRow {
  key: 'netProfit' | 'depreciation' | 'amortisation' | 'interest' | 'tax' | 'ebitda';
  name: string;
  value: number;
  fill: string;
  isTotal?: boolean;
}

export interface EbitdaBridgeResult {
  rows: EbitdaBridgeRow[];
  netProfit: number;
  depreciation: number;
  amortisation: number;
  interest: number;
  tax: number;
  ebitda: number;
  totalAddBacks: number;
  mappings: EbitdaAccountMappings;
  hasAnyMapping: boolean;
}

const PAGE = 1000;
const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

function asIdList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.map((x) => String(x || '').trim()).filter(Boolean))];
}

async function sumJournalAbs(
  organizationId: string,
  accountIds: string[],
  fromDate: string,
  toDate: string,
): Promise<number> {
  if (accountIds.length === 0) return 0;
  let sum = 0;
  let from = 0;
  while (true) {
    const { data, error } = await (supabase as any)
      .from('xero_journal_details')
      .select('net_amount')
      .eq('organization_id', organizationId)
      .in('account_id', accountIds)
      .gte('journal_date', fromDate)
      .lte('journal_date', toDate)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as Array<{ net_amount: number | string | null }>;
    for (const r of rows) sum += Number(r.net_amount) || 0;
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  // Expense / add-back accounts: net is typically debit-negative in Xero; abs for display.
  return round2(Math.abs(sum));
}

/** Sum EBITDA add-backs (D/A/I/T) for one location — reused by Locations metrics. */
export async function fetchEbitdaAddBacks(
  organizationId: string,
  locationId: string | null,
  fromDate: string,
  toDate: string,
): Promise<{ depreciation: number; amortisation: number; interest: number; tax: number; total: number }> {
  const zero = { depreciation: 0, amortisation: 0, interest: 0, tax: 0, total: 0 };
  if (!organizationId || !fromDate || !toDate) return zero;

  let locQ = (supabase as any)
    .from('practice_locations')
    .select(
      'ebitda_depreciation_accounts, ebitda_amortisation_accounts, ebitda_interest_accounts, ebitda_tax_accounts',
    )
    .eq('organization_id', organizationId)
    .is('deleted_at', null);
  if (locationId) locQ = locQ.eq('id', locationId);
  const { data: locs, error } = await locQ;
  if (error) throw error;

  const dep = new Set<string>();
  const amort = new Set<string>();
  const interest = new Set<string>();
  const tax = new Set<string>();
  for (const row of (locs ?? []) as Array<Record<string, unknown>>) {
    for (const id of asIdList(row.ebitda_depreciation_accounts)) dep.add(id);
    for (const id of asIdList(row.ebitda_amortisation_accounts)) amort.add(id);
    for (const id of asIdList(row.ebitda_interest_accounts)) interest.add(id);
    for (const id of asIdList(row.ebitda_tax_accounts)) tax.add(id);
  }

  const allIds = [...new Set([...dep, ...amort, ...interest, ...tax])];
  if (allIds.length === 0) return zero;

  const resolved = new Map<string, string>();
  const [{ data: byId }, { data: byXero }] = await Promise.all([
    (supabase as any)
      .from('xero_chart_of_accounts')
      .select('id, xero_account_id')
      .eq('organization_id', organizationId)
      .in('id', allIds),
    (supabase as any)
      .from('xero_chart_of_accounts')
      .select('id, xero_account_id')
      .eq('organization_id', organizationId)
      .in('xero_account_id', allIds),
  ]);
  for (const c of [...(byId ?? []), ...(byXero ?? [])] as Array<{ id: string; xero_account_id: string | null }>) {
    const xid = c.xero_account_id ? String(c.xero_account_id) : null;
    if (!xid) continue;
    resolved.set(String(c.id), xid);
    resolved.set(xid, xid);
  }
  const toXero = (ids: Set<string>) =>
    [...new Set([...ids].map((id) => resolved.get(id) ?? id))];

  const [depreciation, amortisation, interestAmt, taxAmt] = await Promise.all([
    sumJournalAbs(organizationId, toXero(dep), fromDate, toDate),
    sumJournalAbs(organizationId, toXero(amort), fromDate, toDate),
    sumJournalAbs(organizationId, toXero(interest), fromDate, toDate),
    sumJournalAbs(organizationId, toXero(tax), fromDate, toDate),
  ]);
  return {
    depreciation,
    amortisation,
    interest: interestAmt,
    tax: taxAmt,
    total: round2(depreciation + amortisation + interestAmt + taxAmt),
  };
}

/**
 * Net Profit → EBITDA bridge using Setup Categories → EBITDA COA mappings.
 * Add-backs = Σ journal net (abs) for mapped Depreciation / Amortisation / Interest / Tax accounts.
 * EBITDA = Net Profit + add-backs.
 */
export function useEbitdaBridge(
  fromDate: string,
  toDate: string,
  netProfit: number,
  locationId?: string | null,
) {
  const { organizationId } = useOrganization();
  const { selectedLocationId } = useFilters();
  const locId =
    locationId !== undefined
      ? locationId
      : selectedLocationId && String(selectedLocationId).toLowerCase() !== 'all'
        ? selectedLocationId
        : null;

  return useQuery({
    queryKey: [
      'ebitda-bridge',
      organizationId,
      locId ?? 'all',
      fromDate,
      toDate,
      round2(netProfit),
    ],
    enabled: !!organizationId && !!fromDate && !!toDate,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<EbitdaBridgeResult> => {
      const emptyMaps: EbitdaAccountMappings = {
        depreciation: [],
        amortisation: [],
        interest: [],
        tax: [],
      };
      if (!organizationId) {
        const np = round2(netProfit);
        return {
          rows: buildRows(np, 0, 0, 0, 0),
          netProfit: np,
          depreciation: 0,
          amortisation: 0,
          interest: 0,
          tax: 0,
          ebitda: np,
          totalAddBacks: 0,
          mappings: emptyMaps,
          hasAnyMapping: false,
        };
      }

      let locQ = (supabase as any)
        .from('practice_locations')
        .select(
          'ebitda_depreciation_accounts, ebitda_amortisation_accounts, ebitda_interest_accounts, ebitda_tax_accounts',
        )
        .eq('organization_id', organizationId)
        .is('deleted_at', null);
      if (locId) locQ = locQ.eq('id', locId);
      const { data: locs, error } = await locQ;
      if (error) throw error;

      const dep = new Set<string>();
      const amort = new Set<string>();
      const interest = new Set<string>();
      const tax = new Set<string>();
      for (const row of (locs ?? []) as Array<Record<string, unknown>>) {
        for (const id of asIdList(row.ebitda_depreciation_accounts)) dep.add(id);
        for (const id of asIdList(row.ebitda_amortisation_accounts)) amort.add(id);
        for (const id of asIdList(row.ebitda_interest_accounts)) interest.add(id);
        for (const id of asIdList(row.ebitda_tax_accounts)) tax.add(id);
      }

      const mappings: EbitdaAccountMappings = {
        depreciation: [...dep],
        amortisation: [...amort],
        interest: [...interest],
        tax: [...tax],
      };

      const addBacks = await fetchEbitdaAddBacks(
        organizationId,
        locId,
        fromDate,
        toDate,
      );

      const np = round2(netProfit);
      const totalAddBacks = addBacks.total;
      const ebitda = round2(np + totalAddBacks);

      return {
        rows: buildRows(
          np,
          addBacks.depreciation,
          addBacks.amortisation,
          addBacks.interest,
          addBacks.tax,
        ),
        netProfit: np,
        depreciation: addBacks.depreciation,
        amortisation: addBacks.amortisation,
        interest: addBacks.interest,
        tax: addBacks.tax,
        ebitda,
        totalAddBacks,
        mappings,
        hasAnyMapping: mappings.depreciation.length + mappings.amortisation.length + mappings.interest.length + mappings.tax.length > 0,
      };
    },
  });
}

function buildRows(
  netProfit: number,
  depreciation: number,
  amortisation: number,
  interest: number,
  tax: number,
): EbitdaBridgeRow[] {
  const ebitda = round2(netProfit + depreciation + amortisation + interest + tax);
  return [
    { key: 'netProfit', name: 'Net Profit', value: netProfit, fill: 'hsl(var(--chart-1))' },
    { key: 'depreciation', name: '+ Depreciation', value: depreciation, fill: 'hsl(var(--chart-2))' },
    { key: 'amortisation', name: '+ Amortisation', value: amortisation, fill: 'hsl(var(--chart-3))' },
    { key: 'interest', name: '+ Interest', value: interest, fill: 'hsl(var(--chart-4))' },
    { key: 'tax', name: '+ Tax', value: tax, fill: 'hsl(var(--chart-5))' },
    { key: 'ebitda', name: '= EBITDA', value: ebitda, fill: 'hsl(var(--primary))', isTotal: true },
  ];
}
