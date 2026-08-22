import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import type { ExpenseAccountDetail } from '@/hooks/useExpenseAccountSettings';
import { CLINICIAN_ROLE_GROUP_CODES } from '@/utils/clinicianCostAccounts';

export interface LocationCoaMapping {
  id: string;
  name: string;
  labFees: ExpenseAccountDetail[];
  staffCosts: ExpenseAccountDetail[];
  operatingLease: ExpenseAccountDetail[];
  clinicianCost: ExpenseAccountDetail[];
  overheadCost: ExpenseAccountDetail[];
  materialCost: ExpenseAccountDetail[];
  marketingCost: ExpenseAccountDetail[];
}

// Returns the chart-of-account mappings for every active location in the org,
// broken down by category. Used by the chatbot context so the bot can answer
// "which CoA is mapped for lab fees at <location>?" or list mappings across
// locations when the user hasn't named one.
export function useLocationCoaMappings(): { mappings: LocationCoaMapping[]; isLoading: boolean } {
  const { profile } = useAuth();
  const [mappings, setMappings] = useState<LocationCoaMapping[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!profile?.current_organization_id) {
      setMappings([]);
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    setIsLoading(true);

    async function fetchAll() {
      try {
        // Org-level mappings — only lab_fees/staff_costs/operating_lease have
        // an org-level column. The other three categories are location-only.
        const { data: orgRow } = await (supabase as any)
          .from('organizations')
          .select('lab_fees, staff_costs, operating_lease')
          .eq('id', profile.current_organization_id)
          .single();

        const parseOrgList = (val: string | null | undefined): string[] => {
          if (!val) return [];
          try {
            const parsed = JSON.parse(val);
            return Array.isArray(parsed.selected_account) ? parsed.selected_account : [];
          } catch { return []; }
        };
        const orgLab = parseOrgList(orgRow?.lab_fees);
        const orgStaff = parseOrgList(orgRow?.staff_costs);
        const orgLease = parseOrgList(orgRow?.operating_lease);

        const { data: locs, error: locErr } = await (supabase as any)
          .from('practice_locations')
          .select('id, location_name, lab_fees_accounts, staff_costs_accounts, operating_lease_accounts, overhead_cost_accounts, material_cost_accounts, marketing_cost_accounts')
          .eq('organization_id', profile.current_organization_id)
          .is('deleted_at', null);
        if (locErr) throw locErr;
        if (!locs || locs.length === 0) {
          if (!cancelled) setMappings([]);
          return;
        }

        // Clinician Cost = Hygienist + Dentist + Therapist per location.
        const locationClinicianAccounts = new Map<string, string[]>();
        const { data: clinicianMasters } = await (supabase as any)
          .from('group_account_master')
          .select('id')
          .eq('group_type', 2)
          .in('group_code', [...CLINICIAN_ROLE_GROUP_CODES]);
        const clinicianMasterIds = ((clinicianMasters ?? []) as Array<{ id: number }>).map((m) => m.id);
        if (clinicianMasterIds.length > 0) {
          const { data: clinicianGaRows } = await (supabase as any)
            .from('group_account')
            .select('account_id, mapping_location_id')
            .eq('organization_id', profile.current_organization_id)
            .in('group_account_master_id', clinicianMasterIds)
            .not('mapping_location_id', 'is', null);
          for (const row of (clinicianGaRows ?? []) as Array<{ account_id: string | null; mapping_location_id: string | null }>) {
            const locId = row.mapping_location_id;
            const accId = (row.account_id || '').trim();
            if (!locId || !accId) continue;
            const list = locationClinicianAccounts.get(locId) ?? [];
            if (!list.includes(accId)) list.push(accId);
            locationClinicianAccounts.set(locId, list);
          }
        }

        const accountKeys = [
          'lab_fees_accounts',
          'staff_costs_accounts',
          'operating_lease_accounts',
          'overhead_cost_accounts',
          'material_cost_accounts',
          'marketing_cost_accounts',
        ] as const;

        const allUuids = new Set<string>();
        for (const l of locs as Array<Record<string, unknown>>) {
          for (const k of accountKeys) {
            const arr = Array.isArray(l[k]) ? (l[k] as string[]) : [];
            for (const u of arr) if (u) allUuids.add(u);
          }
          for (const u of locationClinicianAccounts.get(String(l.id)) ?? []) allUuids.add(u);
        }
        // Org-level UUIDs also need resolving.
        for (const u of orgLab) allUuids.add(u);
        for (const u of orgStaff) allUuids.add(u);
        for (const u of orgLease) allUuids.add(u);

        let isIplicit = false;
        const { data: integrations } = await (supabase as any)
          .from('platform_integrations')
          .select('platform_name')
          .eq('organization_id', profile.current_organization_id)
          .in('platform_name', ['iplicit', 'xero', 'Iplicit', 'Xero']);
        const platform = (integrations || []).find((p: { platform_name: string }) =>
          ['iplicit', 'xero'].includes(p.platform_name?.toLowerCase())
        );
        isIplicit = platform?.platform_name?.toLowerCase() === 'iplicit';

        const uuidToAccount = new Map<string, ExpenseAccountDetail>();
        if (allUuids.size > 0) {
          const uuidList = Array.from(allUuids);
          const uuidShaped = uuidList.filter((value) =>
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value),
          );
          const quoteList = (values: string[]) =>
            values.map((value) => `"${value.replace(/"/g, '\\"')}"`).join(',');
          const refFilter = (nativeColumn: string) => {
            const parts: string[] = [];
            if (uuidShaped.length > 0) parts.push(`id.in.(${quoteList(uuidShaped)})`);
            parts.push(`${nativeColumn}.in.(${quoteList(uuidList)})`);
            return parts.join(',');
          };
          if (isIplicit) {
            const { data: rows } = await (supabase as any)
              .from('iplicit_chart_of_accounts')
              .select('id, code, name, account_id')
              .eq('organization_id', profile.current_organization_id)
              .or(refFilter('account_id'));
            (rows || []).forEach((r: { id: string; code: string | null; name: string | null; account_id: string | null }) => {
              if (!r.code) return;
              const detail = { code: r.code, name: r.name || '' };
              uuidToAccount.set(r.id, detail);
              if (r.account_id) uuidToAccount.set(r.account_id, detail);
            });
          } else {
            // Xero accounts live in xero_chart_of_accounts — that's the table
            // the Organization Settings UI selects from, so the UUIDs stored
            // in practice_locations.*_accounts reference this table's `id`.
            // platform_integration_chart_of_accounts is a parallel/legacy
            // table and does NOT match those UUIDs.
            const { data: rows } = await (supabase as any)
              .from('xero_chart_of_accounts')
              .select('id, account_code, account_name, xero_account_id')
              .eq('organization_id', profile.current_organization_id)
              .or(refFilter('xero_account_id'));
            (rows || []).forEach((r: { id: string; account_code: string | null; account_name: string | null; xero_account_id: string | null }) => {
              if (!r.account_code) return;
              const detail = { code: r.account_code, name: r.account_name || '' };
              uuidToAccount.set(r.id, detail);
              if (r.xero_account_id) uuidToAccount.set(r.xero_account_id, detail);
            });
          }
        }

        const resolve = (uuids: unknown): ExpenseAccountDetail[] => {
          if (!Array.isArray(uuids)) return [];
          const seen = new Set<string>();
          const out: ExpenseAccountDetail[] = [];
          for (const u of uuids as string[]) {
            const a = uuidToAccount.get(u);
            if (a?.code && !seen.has(a.code)) {
              seen.add(a.code);
              out.push(a);
            }
          }
          return out;
        };

        // Location-level overrides org-level when present. When the location's
        // array is empty, fall back to org-level so the effective mapping the
        // app actually uses is what we expose to the chatbot.
        const orgLabAccounts = resolve(orgLab);
        const orgStaffAccounts = resolve(orgStaff);
        const orgLeaseAccounts = resolve(orgLease);

        const result: LocationCoaMapping[] = (locs as Array<Record<string, unknown>>).map(l => {
          const locLab = resolve(l.lab_fees_accounts);
          const locStaff = resolve(l.staff_costs_accounts);
          const locLease = resolve(l.operating_lease_accounts);
          return {
            id: String(l.id),
            name: String(l.location_name || ''),
            labFees: locLab.length > 0 ? locLab : orgLabAccounts,
            staffCosts: locStaff.length > 0 ? locStaff : orgStaffAccounts,
            operatingLease: locLease.length > 0 ? locLease : orgLeaseAccounts,
            clinicianCost: resolve(locationClinicianAccounts.get(String(l.id)) ?? []),
            overheadCost: resolve(l.overhead_cost_accounts),
            materialCost: resolve(l.material_cost_accounts),
            marketingCost: resolve(l.marketing_cost_accounts),
          };
        });

        if (!cancelled) setMappings(result);
      } catch (err) {
        console.error('[useLocationCoaMappings] failed:', err);
        if (!cancelled) setMappings([]);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    fetchAll();
    return () => {
      cancelled = true;
    };
  }, [profile?.current_organization_id]);

  return { mappings, isLoading };
}
