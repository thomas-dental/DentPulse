import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { fetchClinicianCostAccountIds } from '@/utils/clinicianCostAccounts';

export interface ExpenseAccountDetail {
  code: string;
  name: string;
}

interface CategorySettings {
  hasAccounts: boolean;
  selectedAccounts: string[];
  accountType: string | null;
  accountCodes: string[];
  accounts: ExpenseAccountDetail[];
}

interface UseExpenseAccountSettingsReturn {
  labFees: CategorySettings;
  staffCosts: CategorySettings;
  operatingLease: CategorySettings;
  clinicianCost: CategorySettings;
  overheadCost: CategorySettings;
  materialCost: CategorySettings;
  marketingCost: CategorySettings;
  isLoading: boolean;
  hasAnyAccounts: boolean;
}

const DEFAULT_CATEGORY: CategorySettings = {
  hasAccounts: false,
  selectedAccounts: [],
  accountType: null,
  accountCodes: [],
  accounts: [],
};

function parseExpenseColumn(jsonStr: string | null | undefined): CategorySettings {
  if (!jsonStr) return DEFAULT_CATEGORY;

  try {
    const parsed = JSON.parse(jsonStr);
    const selectedAccounts = Array.isArray(parsed.selected_account) ? parsed.selected_account : [];
    return {
      hasAccounts: selectedAccounts.length > 0,
      selectedAccounts,
      accountType: parsed.account_type || null,
      accountCodes: [],
      accounts: [],
    };
  } catch {
    return DEFAULT_CATEGORY;
  }
}

export function useExpenseAccountSettings(selectedLocationId?: string | null): UseExpenseAccountSettingsReturn {
  const { profile } = useAuth();
  const [labFees, setLabFees] = useState<CategorySettings>(DEFAULT_CATEGORY);
  const [staffCosts, setStaffCosts] = useState<CategorySettings>(DEFAULT_CATEGORY);
  const [operatingLease, setOperatingLease] = useState<CategorySettings>(DEFAULT_CATEGORY);
  const [clinicianCost, setClinicianCost] = useState<CategorySettings>(DEFAULT_CATEGORY);
  const [overheadCost, setOverheadCost] = useState<CategorySettings>(DEFAULT_CATEGORY);
  const [materialCost, setMaterialCost] = useState<CategorySettings>(DEFAULT_CATEGORY);
  const [marketingCost, setMarketingCost] = useState<CategorySettings>(DEFAULT_CATEGORY);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Don't do anything until we have an org ID — keep isLoading true
    // so pages wait for real settings before fetching data
    if (!profile?.current_organization_id) return;

    setIsLoading(true);

    async function fetchSettings() {
      try {
        // 1. Read org-level settings
        const { data, error } = await (supabase as any)
          .from('organizations')
          .select('lab_fees, staff_costs, operating_lease')
          .eq('id', profile.current_organization_id)
          .single();

        if (error) {
          console.error('[useExpenseAccountSettings] Error:', error);
          setIsLoading(false);
          return;
        }

        let parsedLab = parseExpenseColumn(data?.lab_fees);
        let parsedStaff = parseExpenseColumn(data?.staff_costs);
        let parsedLease = parseExpenseColumn(data?.operating_lease);
        let parsedClinician: CategorySettings = DEFAULT_CATEGORY;
        let parsedOverhead: CategorySettings = DEFAULT_CATEGORY;
        let parsedMaterial: CategorySettings = DEFAULT_CATEGORY;
        let parsedMarketing: CategorySettings = DEFAULT_CATEGORY;

        console.log('[useExpenseAccountSettings] Org-level UUIDs:', {
          labFees: parsedLab.selectedAccounts,
          staffCosts: parsedStaff.selectedAccounts,
          operatingLease: parsedLease.selectedAccounts,
        });

        // 2. Check location-level accounts (practice_locations).
        //    Location-level overrides org-level when present.
        //    When no specific location is selected ("All Locations"), union
        //    the per-location arrays across every active location in the
        //    org — otherwise subpages like /lab-fees receive empty account
        //    filters and render £0 even though the dashboard aggregate works.
        const locQuery = (supabase as any)
          .from('practice_locations')
          .select('lab_fees_accounts, staff_costs_accounts, operating_lease_accounts, overhead_cost_accounts, material_cost_accounts, marketing_cost_accounts')
          .eq('organization_id', profile.current_organization_id)
          .is('deleted_at', null);

        const { data: locRows } = selectedLocationId
          ? await locQuery.eq('id', selectedLocationId)
          : await locQuery;

        if (locRows && locRows.length > 0) {
          const union = (key: string) => {
            const set = new Set<string>();
            for (const r of locRows as Array<Record<string, unknown>>) {
              const arr = Array.isArray(r[key]) ? (r[key] as string[]) : [];
              for (const id of arr) if (id) set.add(id);
            }
            return [...set];
          };

          const locLab = union('lab_fees_accounts');
          const locStaff = union('staff_costs_accounts');
          const locLease = union('operating_lease_accounts');
          const locOverhead = union('overhead_cost_accounts');
          const locMaterial = union('material_cost_accounts');
          const locMarketing = union('marketing_cost_accounts');

          if (locLab.length > 0) parsedLab = { hasAccounts: true, selectedAccounts: locLab, accountType: null, accountCodes: [], accounts: [] };
          if (locStaff.length > 0) parsedStaff = { hasAccounts: true, selectedAccounts: locStaff, accountType: null, accountCodes: [], accounts: [] };
          if (locLease.length > 0) parsedLease = { hasAccounts: true, selectedAccounts: locLease, accountType: null, accountCodes: [], accounts: [] };
          if (locOverhead.length > 0) parsedOverhead = { hasAccounts: true, selectedAccounts: locOverhead, accountType: null, accountCodes: [], accounts: [] };
          if (locMaterial.length > 0) parsedMaterial = { hasAccounts: true, selectedAccounts: locMaterial, accountType: null, accountCodes: [], accounts: [] };
          if (locMarketing.length > 0) parsedMarketing = { hasAccounts: true, selectedAccounts: locMarketing, accountType: null, accountCodes: [], accounts: [] };
        }

        // Clinician Cost = Hygienist + Dentist + Therapist (Setup Categories),
        // not the legacy practice_locations.clinician_cost_accounts column.
        const derivedClinicianIds = await fetchClinicianCostAccountIds(
          profile.current_organization_id,
          selectedLocationId,
        );
        if (derivedClinicianIds.length > 0) {
          parsedClinician = {
            hasAccounts: true,
            selectedAccounts: derivedClinicianIds,
            accountType: null,
            accountCodes: [],
            accounts: [],
          };
        }

        console.log('[useExpenseAccountSettings] Location UUIDs:', {
          selectedLocationId: selectedLocationId || '(all locations — unioned)',
          locationsScanned: locRows?.length ?? 0,
          labFees: parsedLab.selectedAccounts,
          staffCosts: parsedStaff.selectedAccounts,
          operatingLease: parsedLease.selectedAccounts,
          clinicianCost: parsedClinician.selectedAccounts,
          overheadCost: parsedOverhead.selectedAccounts,
          materialCost: parsedMaterial.selectedAccounts,
        });

        // 3. Resolve the selected account UUIDs to account codes.
        //    practice_locations.*_accounts can reference ANY connected
        //    accounting platform's CoA table (xero / quickbooks / iplicit /
        //    sage). A multi-platform org (e.g. Xero + QuickBooks + Sage all
        //    connected) previously guessed ONE primary platform and looked up
        //    the wrong table → empty codes → £0 on the cost pages. We now query
        //    every CoA table and merge; a UUID is unique to exactly one table,
        //    so there is never a collision.
        const allUuids = [
          ...parsedLab.selectedAccounts,
          ...parsedStaff.selectedAccounts,
          ...parsedLease.selectedAccounts,
          ...parsedClinician.selectedAccounts,
          ...parsedOverhead.selectedAccounts,
          ...parsedMaterial.selectedAccounts,
          ...parsedMarketing.selectedAccounts,
        ];

        if (allUuids.length > 0) {
          const orgId = profile.current_organization_id;
          // Mappings normally hold the chart-of-accounts row id, but older
          // saves stored the platform's own account identifier instead (the
          // settings picker used to write xero_account_id). Match on either,
          // otherwise those legacy mappings resolve to no account code and
          // every cost page renders £0. Only uuid-shaped refs may be compared
          // against `id` — QuickBooks/Sage native ids are short strings that
          // would abort the query with a cast error.
          const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          const uuidShaped = allUuids.filter(ref => UUID_RE.test(ref));
          const quoteList = (vals: string[]) => vals.map(v => `"${v.replace(/"/g, '\\"')}"`).join(',');
          const refFilter = (nativeIdColumn: string) => {
            const parts: string[] = [];
            if (uuidShaped.length > 0) parts.push(`id.in.(${quoteList(uuidShaped)})`);
            parts.push(`${nativeIdColumn}.in.(${quoteList(allUuids)})`);
            return parts.join(',');
          };

          const [xeroRes, qbRes, iplicitRes, sageRes] = await Promise.all([
            (supabase as any)
              .from('xero_chart_of_accounts')
              .select('id, account_code, account_name, xero_account_id')
              .eq('organization_id', orgId)
              .or(refFilter('xero_account_id')),
            (supabase as any)
              .from('quickbooks_chart_of_accounts')
              .select('id, account_name, qb_account_id')
              .eq('organization_id', orgId)
              .or(refFilter('qb_account_id')),
            (supabase as any)
              .from('iplicit_chart_of_accounts')
              .select('id, code, name, account_id')
              .eq('organization_id', orgId)
              .or(refFilter('account_id')),
            (supabase as any)
              .from('sage_chart_of_accounts')
              .select('id, account_code, account_name, sage_account_id')
              .eq('organization_id', orgId)
              .or(refFilter('sage_account_id')),
          ]);

          if (xeroRes.error) console.error('[useExpenseAccountSettings] Xero CoA lookup error:', xeroRes.error);
          if (qbRes.error) console.error('[useExpenseAccountSettings] QuickBooks CoA lookup error:', qbRes.error);
          if (iplicitRes.error) console.error('[useExpenseAccountSettings] Iplicit CoA lookup error:', iplicitRes.error);
          if (sageRes.error) console.error('[useExpenseAccountSettings] Sage CoA lookup error:', sageRes.error);

          const uuidToAccount = new Map<string, ExpenseAccountDetail>();
          // Keyed by both the row id and the platform's native account id so a
          // mapping resolves whichever of the two it was saved with.
          const register = (rowId: string, nativeId: string | null, detail: ExpenseAccountDetail) => {
            uuidToAccount.set(rowId, detail);
            if (nativeId) uuidToAccount.set(nativeId, detail);
          };
          // Xero / Sage: matchable code = account_code.
          (xeroRes.data || []).forEach((row: any) => {
            if (row.account_code) register(row.id, row.xero_account_id, { code: row.account_code, name: row.account_name || '' });
          });
          (sageRes.data || []).forEach((row: any) => {
            if (row.account_code) register(row.id, row.sage_account_id, { code: row.account_code, name: row.account_name || '' });
          });
          // QuickBooks: quickbooks_profit_loss joins on qb_account_id (no
          // account code), so expose qb_account_id as the resolvable "code".
          (qbRes.data || []).forEach((row: any) => {
            if (row.qb_account_id) register(row.id, row.qb_account_id, { code: row.qb_account_id, name: row.account_name || '' });
          });
          // Iplicit: matchable code = code.
          (iplicitRes.data || []).forEach((row: any) => {
            if (row.code) register(row.id, row.account_id, { code: row.code, name: row.name || '' });
          });

          if (uuidToAccount.size > 0) {
            const resolveAccountCodes = (uuids: string[]): string[] => {
              const codes = new Set<string>();
              uuids.forEach(uuid => {
                const entry = uuidToAccount.get(uuid);
                if (entry?.code) codes.add(entry.code);
              });
              return Array.from(codes);
            };

            const resolveAccounts = (uuids: string[]): ExpenseAccountDetail[] => {
              const seen = new Set<string>();
              const out: ExpenseAccountDetail[] = [];
              uuids.forEach(uuid => {
                const entry = uuidToAccount.get(uuid);
                if (entry?.code && !seen.has(entry.code)) {
                  seen.add(entry.code);
                  out.push(entry);
                }
              });
              return out;
            };

            parsedLab.accountCodes = resolveAccountCodes(parsedLab.selectedAccounts);
            parsedStaff.accountCodes = resolveAccountCodes(parsedStaff.selectedAccounts);
            parsedLease.accountCodes = resolveAccountCodes(parsedLease.selectedAccounts);
            parsedClinician.accountCodes = resolveAccountCodes(parsedClinician.selectedAccounts);
            parsedOverhead.accountCodes = resolveAccountCodes(parsedOverhead.selectedAccounts);
            parsedMaterial.accountCodes = resolveAccountCodes(parsedMaterial.selectedAccounts);
            parsedMarketing.accountCodes = resolveAccountCodes(parsedMarketing.selectedAccounts);

            parsedLab.accounts = resolveAccounts(parsedLab.selectedAccounts);
            parsedStaff.accounts = resolveAccounts(parsedStaff.selectedAccounts);
            parsedLease.accounts = resolveAccounts(parsedLease.selectedAccounts);
            parsedClinician.accounts = resolveAccounts(parsedClinician.selectedAccounts);
            parsedOverhead.accounts = resolveAccounts(parsedOverhead.selectedAccounts);
            parsedMaterial.accounts = resolveAccounts(parsedMaterial.selectedAccounts);
            parsedMarketing.accounts = resolveAccounts(parsedMarketing.selectedAccounts);

            console.log('[useExpenseAccountSettings] Resolved account codes:', {
              labFees: parsedLab.accountCodes,
              staffCosts: parsedStaff.accountCodes,
              operatingLease: parsedLease.accountCodes,
              clinicianCost: parsedClinician.accountCodes,
              overheadCost: parsedOverhead.accountCodes,
              materialCost: parsedMaterial.accountCodes,
              marketingCost: parsedMarketing.accountCodes,
            });
          } else {
            console.warn('[useExpenseAccountSettings] CoA lookup returned NO rows for UUIDs:', allUuids);
          }
        } else {
          console.log('[useExpenseAccountSettings] No UUIDs to resolve (no accounts selected)');
        }

        setLabFees(parsedLab);
        setStaffCosts(parsedStaff);
        setOperatingLease(parsedLease);
        setClinicianCost(parsedClinician);
        setOverheadCost(parsedOverhead);
        setMaterialCost(parsedMaterial);
        setMarketingCost(parsedMarketing);
      } catch (err) {
        console.error('[useExpenseAccountSettings] Error:', err);
      } finally {
        setIsLoading(false);
      }
    }

    fetchSettings();
  }, [profile?.current_organization_id, selectedLocationId]);

  const hasAnyAccounts = labFees.hasAccounts || staffCosts.hasAccounts || operatingLease.hasAccounts || clinicianCost.hasAccounts || overheadCost.hasAccounts || materialCost.hasAccounts || marketingCost.hasAccounts;

  return {
    labFees,
    staffCosts,
    operatingLease,
    clinicianCost,
    overheadCost,
    materialCost,
    marketingCost,
    isLoading,
    hasAnyAccounts,
  };
}
