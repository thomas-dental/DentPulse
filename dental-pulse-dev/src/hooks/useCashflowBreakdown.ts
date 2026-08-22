import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from './useOrganization';
import { useFilters } from '@/contexts/FilterContext';

// One real ledger transaction (Xero invoice / bill / credit note) due in the
// selected forecast week — the "Breakdown" tab's per-week line items.
export interface BreakdownTxn {
  id: string;
  type: 'Invoice' | 'Bill' | 'Credit note';
  date: string;        // effective payment date (planned ?? due) YYYY-MM-DD
  description: string; // contact + invoice number
  amount: number;      // signed: + for money in (ACCREC), − for money out (ACCPAY)
  excluded?: boolean;  // bill toggled off in Bills to Pay (hidden unless "show excluded")
}

// Unpaid Xero invoices/bills whose effective payment date falls in [fromIso, toIso].
// Bills: Planned Date (override) → else Due Date; past dates fold into the current
// week when `foldOverdue` (same rules as the 13-week forecast pipeline / Bills to Pay).
export function useCashflowBreakdown(fromIso?: string, toIso?: string, foldOverdue = false) {
  const { organizationId } = useOrganization();
  const { selectedLocationId } = useFilters();

  const { data, isLoading, error } = useQuery({
    queryKey: ['cashflow-breakdown-v2', organizationId, selectedLocationId ?? 'all', fromIso, toIso, foldOverdue],
    enabled: !!organizationId && !!fromIso && !!toIso,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<BreakdownTxn[]> => {
      if (!organizationId || !fromIso || !toIso) return [];

      const [{ data: tenants }, { data: maps }, { data: locs }] = await Promise.all([
        (supabase as any)
          .from('platform_integration_organizations')
          .select('id, platform_org_id')
          .eq('organization_id', organizationId),
        (supabase as any)
          .from('platform_integration_organization_mapping')
          .select('platform_integration_organizations_id, location_id')
          .eq('organization_id', organizationId),
        (supabase as any)
          .from('practice_locations')
          .select('id')
          .eq('organization_id', organizationId)
          .is('deleted_at', null),
      ]);
      const locById = new Set(((locs ?? []) as Array<{ id: string }>).map((r) => String(r.id)));
      const pioIdToTenant = new Map<string, string>();
      for (const r of (tenants ?? []) as Array<{ id: string; platform_org_id: string | null }>) {
        if (r.platform_org_id) pioIdToTenant.set(String(r.id), String(r.platform_org_id));
      }
      const tenantLocById = new Map<string, string>();
      for (const r of (maps ?? []) as Array<{
        platform_integration_organizations_id: string;
        location_id: string | null;
      }>) {
        const tenant = pioIdToTenant.get(String(r.platform_integration_organizations_id));
        const loc = r.location_id ? String(r.location_id) : null;
        if (tenant && loc && locById.has(loc)) tenantLocById.set(tenant, loc);
      }

      // Bill settings: excluded + planned/expected date overrides.
      let setQ = (supabase as any)
        .from('cashflow_forecast_overrides')
        .select('line_key, amount, line_label')
        .eq('organization_id', organizationId)
        .eq('section', 'bill');
      setQ = selectedLocationId ? setQ.eq('location_id', selectedLocationId) : setQ.is('location_id', null);
      const { data: setRows } = await setQ;
      const excluded = new Set<string>();
      const expectedById: Record<string, string> = {};
      for (const r of (setRows ?? []) as Array<{ line_key: string; amount: number | string; line_label: string | null }>) {
        if (Number(r.amount) > 0) excluded.add(r.line_key);
        if (r.line_label) expectedById[r.line_key] = String(r.line_label).slice(0, 10);
      }

      // Fetch unpaid invoices through the week end; overdue bills fold when foldOverdue.
      let q = (supabase as any)
        .from('xero_invoices')
        .select('id, invoice_number, invoice_type, contact_name, due_date, amount_due, total_amount, status, location_id, xero_tenant_id')
        .eq('organization_id', organizationId)
        .eq('is_paid', false)
        .neq('invoice_type', 'PL_SYNTHETIC')
        .or(`due_date.lte.${toIso},due_date.is.null`);
      if (selectedLocationId) {
        q = q.or(`location_id.eq.${selectedLocationId},location_id.is.null`);
      }
      const { data: rowsRaw, error } = await q;
      if (error) throw error;

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayIso = today.toISOString().slice(0, 10);

      const out: BreakdownTxn[] = [];
      for (const r of (rowsRaw ?? []) as Array<{
        id: string;
        invoice_number: string | null;
        invoice_type: string | null;
        contact_name: string | null;
        due_date: string | null;
        amount_due: number | string | null;
        total_amount: number | string | null;
        status: string | null;
        location_id: string | null;
        xero_tenant_id: string | null;
      }>) {
        const type = String(r.invoice_type ?? '').toUpperCase();
        const isBill = type === 'ACCPAY';
        const tenant = r.xero_tenant_id ? String(r.xero_tenant_id) : null;
        const stamped = r.location_id && locById.has(String(r.location_id)) ? String(r.location_id) : null;
        const resolvedLoc = stamped ?? (tenant ? (tenantLocById.get(tenant) ?? null) : null);

        if (selectedLocationId) {
          if (resolvedLoc !== selectedLocationId) continue;
        } else if (!resolvedLoc) {
          continue;
        }

        if (isBill) {
          if (String(r.status ?? '').toUpperCase() !== 'AUTHORISED') continue;
          if (!(Number(r.amount_due ?? 0) > 0)) continue;
        } else if (!r.due_date) {
          continue;
        }

        // Planned → Due; past bills fold into "today" when this is the current week.
        const planned = expectedById[r.id] || null;
        const due = r.due_date || null;
        let eff = isBill ? (planned || due) : due;
        if (!eff) continue;
        const d = new Date(`${eff}T00:00:00`);
        if (Number.isNaN(d.getTime())) continue;
        if (d < today && isBill && foldOverdue) {
          eff = todayIso;
        } else if (d < today && isBill && !foldOverdue) {
          continue; // overdue only belongs in the current-week column
        } else if (d < today && !isBill) {
          continue;
        }

        if (eff < fromIso || eff > toIso) continue;

        const amt = Math.abs(Number(r.amount_due ?? r.total_amount) || 0);
        out.push({
          id: r.id,
          type: isBill ? 'Bill' : 'Invoice',
          date: eff,
          description: `${r.contact_name ?? 'Unknown'}${r.invoice_number ? ` (${r.invoice_number})` : ''}`,
          amount: isBill ? -amt : amt,
          excluded: excluded.has(r.id),
        });
      }

      return out.sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount);
    },
  });

  return { transactions: data ?? [], isLoading, error };
}
