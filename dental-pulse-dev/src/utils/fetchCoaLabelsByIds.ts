import { supabase } from '@/integrations/supabase/client';

export interface CoaLabel {
  id: string;
  code: string | null;
  name: string | null;
}

/**
 * Resolve display labels for chart-of-account row ids REGARDLESS of tenant /
 * entity scope.
 *
 * The AP invoice modals scope their account dropdown options to the location's
 * mapped accounting entity (correct — it stops one entity's accounts leaking
 * into another). But a line item may already have an account saved that sits
 * outside that scope (saved against a different entity, or before a COA
 * re-sync). With only the scoped options, that saved value renders as
 * "Select Account" even though it IS set.
 *
 * This does a targeted lookup by id (no tenant filter) so the saved value can
 * still be shown. It is used ONLY for rendering the selected label — the
 * dropdown options stay scoped.
 *
 * `platform_account_id` on a line item stores the COA table's internal row id,
 * so we look it up in that platform's COA table. We also probe the legacy
 * `platform_integration_chart_of_accounts` table as a safety net for older data
 * and for the case where the platform could not be resolved.
 */
export async function fetchCoaLabelsByIds(
  platformName: string | undefined | null,
  ids: string[],
): Promise<Map<string, CoaLabel>> {
  const result = new Map<string, CoaLabel>();
  const unique = Array.from(new Set((ids || []).filter(Boolean)));
  if (unique.length === 0) return result;

  const add = (rows: any[], map: (a: any) => CoaLabel) => {
    for (const r of rows || []) {
      const label = map(r);
      if (label.id && !result.has(label.id)) result.set(label.id, label);
    }
  };

  // Each probe queries one COA table for whichever ids are still unresolved.
  const probes: Record<string, () => Promise<void>> = {
    iplicit: async () => {
      const { data } = await (supabase as any)
        .from('iplicit_chart_of_accounts')
        .select('id, code, name, description')
        .in('id', unique.filter((id) => !result.has(id)));
      add(data, (a) => ({ id: a.id, code: a.code, name: a.name || a.description }));
    },
    quickbooks: async () => {
      const { data } = await (supabase as any)
        .from('quickbooks_chart_of_accounts')
        .select('id, account_number, account_name')
        .in('id', unique.filter((id) => !result.has(id)));
      add(data, (a) => ({ id: a.id, code: a.account_number, name: a.account_name }));
    },
    xero: async () => {
      const { data } = await (supabase as any)
        .from('xero_chart_of_accounts')
        .select('id, account_code, account_name')
        .in('id', unique.filter((id) => !result.has(id)));
      add(data, (a) => ({ id: a.id, code: a.account_code, name: a.account_name }));
    },
    sage: async () => {
      const { data } = await (supabase as any)
        .from('sage_chart_of_accounts')
        .select('id, account_code, account_name')
        .in('id', unique.filter((id) => !result.has(id)));
      add(data, (a) => ({ id: a.id, code: a.account_code, name: a.account_name }));
    },
    legacy: async () => {
      const { data } = await (supabase as any)
        .from('platform_integration_chart_of_accounts')
        .select('id, coa_account_code, coa_account_name')
        .in('id', unique.filter((id) => !result.has(id)));
      add(data, (a) => ({ id: a.id, code: a.coa_account_code, name: a.coa_account_name }));
    },
  };

  // Probe the resolved platform first (fast path); then fall back to the other
  // tables for any ids still unresolved (e.g. platform could not be resolved).
  const p = (platformName || '').toLowerCase();
  const order = [p, 'xero', 'quickbooks', 'iplicit', 'sage', 'legacy'].filter(
    (name, i, self) => probes[name] && self.indexOf(name) === i,
  );

  try {
    for (const name of order) {
      if (unique.every((id) => result.has(id))) break; // all resolved
      await probes[name]();
    }
  } catch (err) {
    console.error('[fetchCoaLabelsByIds] failed:', err);
  }

  return result;
}
