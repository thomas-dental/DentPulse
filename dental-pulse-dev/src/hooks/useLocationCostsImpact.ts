import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from './useOrganization';
import { useFilters } from '@/contexts/FilterContext';
import { useExpenseAccountSettings } from './useExpenseAccountSettings';
import { CLINICIAN_ROLE_GROUP_CODES } from '@/utils/clinicianCostAccounts';

const PAGE_SIZE = 1000;

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

type BucketKey = 'lab' | 'staff' | 'lease' | 'clinician' | 'overhead' | 'material' | 'marketing';
const BUCKET_KEYS: BucketKey[] = ['lab', 'staff', 'lease', 'clinician', 'overhead', 'material', 'marketing'];

export interface LocationCostBuckets {
  lab: number;
  staff: number;
  lease: number;
  clinician: number;
  overhead: number;
  material: number;
  marketing: number;
  totalCosts: number;
}

interface PracticeLocationOverrides {
  id: string;
  lab_fees_accounts: string[] | null;
  staff_costs_accounts: string[] | null;
  operating_lease_accounts: string[] | null;
  overhead_cost_accounts: string[] | null;
  material_cost_accounts: string[] | null;
  marketing_cost_accounts: string[] | null;
}

interface AccountFilter {
  codes: Set<string>;
  ids: Set<string>;
}

function emptyBuckets(): LocationCostBuckets {
  return { lab: 0, staff: 0, lease: 0, clinician: 0, overhead: 0, material: 0, marketing: 0, totalCosts: 0 };
}

/**
 * Per-location cost totals computed using the same bucketing logic as
 * `useCostImpactData`:
 *
 *   - 6 buckets: lab fees, staff costs, operating leases, clinician costs,
 *     overhead costs, material costs.
 *   - Each location uses its own per-bucket overrides on `practice_locations`
 *     when set, otherwise falls back to the org-level settings on
 *     `organizations`.
 *   - UUIDs are resolved to account codes/IDs via the chart_of_accounts table
 *     for the configured platform (iplicit vs xero).
 *   - P&L rows are filtered by (legal_entity_id|tenant_id, code/id) pair so
 *     a location's cost only includes lines from its own mapped tenant.
 *
 * Returns Map<locationId, { totalCosts, lab, staff, lease, ... }>.
 */
export function useLocationCostsImpact() {
  const { organizationId } = useOrganization();
  const { dateRange } = useFilters();
  // Pass null to get org-level + unioned location settings (we re-do the
  // per-location attribution ourselves; this is just to surface the
  // org-level UUIDs that act as the bucket-membership signal).
  const expenseSettings = useExpenseAccountSettings(null);

  const startDate = toDateStr(dateRange.startDate);
  const endDate = toDateStr(dateRange.endDate);

  const orgUuidsByBucket: Record<BucketKey, string[]> = {
    lab: expenseSettings.labFees.selectedAccounts,
    staff: expenseSettings.staffCosts.selectedAccounts,
    lease: expenseSettings.operatingLease.selectedAccounts,
    clinician: expenseSettings.clinicianCost.selectedAccounts,
    overhead: expenseSettings.overheadCost.selectedAccounts,
    material: expenseSettings.materialCost.selectedAccounts,
    marketing: expenseSettings.marketingCost.selectedAccounts,
  };
  const orgCodesByBucket: Record<BucketKey, string[]> = {
    lab: expenseSettings.labFees.accountCodes,
    staff: expenseSettings.staffCosts.accountCodes,
    lease: expenseSettings.operatingLease.accountCodes,
    clinician: expenseSettings.clinicianCost.accountCodes,
    overhead: expenseSettings.overheadCost.accountCodes,
    material: expenseSettings.materialCost.accountCodes,
    marketing: expenseSettings.marketingCost.accountCodes,
  };

  return useQuery({
    queryKey: [
      // v3: dual CoA id/native-id lookup + equal-share when locations share a P&L line
      'location-costs-impact-v3',
      organizationId,
      startDate,
      endDate,
      JSON.stringify(orgUuidsByBucket),
    ],
    enabled: !!organizationId && !expenseSettings.isLoading,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<Map<string, LocationCostBuckets>> => {
      const result = new Map<string, LocationCostBuckets>();
      if (!organizationId) return result;

      // Union of every bucket UUID across org-level + per-location overrides.
      // Used to resolve codes/IDs in one shot via the chart of accounts.
      const allOrgUuids = Array.from(new Set([
        ...orgUuidsByBucket.lab, ...orgUuidsByBucket.staff, ...orgUuidsByBucket.lease,
        ...orgUuidsByBucket.clinician, ...orgUuidsByBucket.overhead, ...orgUuidsByBucket.material,
        ...orgUuidsByBucket.marketing,
      ]));

      const overrideSelect = 'id, lab_fees_accounts, staff_costs_accounts, operating_lease_accounts, overhead_cost_accounts, material_cost_accounts, marketing_cost_accounts';

      const [
        activeLocationsRes,
        mappingRes,
        platformRes,
        pioAllRes,
        clinicianRoleMastersRes,
      ] = await Promise.all([
        (supabase as any)
          .from('practice_locations')
          .select(overrideSelect)
          .eq('organization_id', organizationId)
          .is('deleted_at', null),
        (supabase as any)
          .from('platform_integration_organization_mapping')
          .select('location_id, platform_integration_organizations_id')
          .eq('organization_id', organizationId),
        (supabase as any)
          .from('platform_integrations')
          .select('platform_name')
          .eq('organization_id', organizationId)
          .in('platform_name', ['iplicit', 'xero', 'quickbooks', 'sage', 'Iplicit', 'Xero', 'QuickBooks', 'Sage']),
        (supabase as any)
          .from('platform_integration_organizations')
          .select('id, platform_org_id, platform_name, platform_integration_id')
          .eq('organization_id', organizationId),
        (supabase as any)
          .from('group_account_master')
          .select('id')
          .eq('group_type', 2)
          .in('group_code', [...CLINICIAN_ROLE_GROUP_CODES]),
      ]);

      const activeLocations = (activeLocationsRes?.data ?? []) as PracticeLocationOverrides[];
      if (activeLocations.length === 0) return result;

      // Hygienist + Dentist + Therapist per location → Clinician Cost.
      const locationClinicianAccounts = new Map<string, string[]>();
      const clinicianMasterIds = ((clinicianRoleMastersRes?.data ?? []) as Array<{ id: number }>).map((m) => m.id);
      if (clinicianMasterIds.length > 0) {
        const { data: clinicianGaRows } = await (supabase as any)
          .from('group_account')
          .select('account_id, mapping_location_id')
          .eq('organization_id', organizationId)
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

      const accountingPlatform = ((platformRes?.data ?? []) as Array<{ platform_name: string }>)
        .find(p => ['iplicit', 'xero', 'quickbooks', 'sage'].includes(p.platform_name?.toLowerCase()));
      // Effective platform is derived AFTER resolving UUIDs (see below) by
      // which COA table actually owns them — platform_integrations order is
      // arbitrary and a stale Xero/Iplicit row must not shadow QuickBooks.
      let isIplicit = false;
      let isQuickBooks = false;
      let isSage = false;

      // Pull union of per-location override UUIDs too — they may not appear
      // in the org-level set if a location overrides with a different UUID.
      const allUuids = new Set<string>(allOrgUuids);
      for (const loc of activeLocations) {
        for (const key of [
          'lab_fees_accounts', 'staff_costs_accounts', 'operating_lease_accounts',
          'overhead_cost_accounts', 'material_cost_accounts', 'marketing_cost_accounts',
        ] as const) {
          const arr = loc[key];
          if (Array.isArray(arr)) {
            for (const u of arr) if (u) allUuids.add(u);
          }
        }
        for (const u of locationClinicianAccounts.get(loc.id) ?? []) allUuids.add(u);
      }
      const uuidsList = [...allUuids];

      // Resolve UUIDs → { code, accountId } via chart of accounts.
      // Bucket refs are normally the CoA row id, but older Setup Categories
      // saves stored the platform's native account id (e.g. xero_account_id).
      // Match on both — same pattern as useCostImpactData / useExpenseAccountSettings
      // — otherwise every location silently resolves to £0 and Cost Impact
      // / Operational Efficiency cost tiles show empty figures.
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const uuidShapedRefs = uuidsList.filter((ref) => UUID_RE.test(ref));
      const quoteList = (vals: string[]) => vals.map((v) => `"${v.replace(/"/g, '\\"')}"`).join(',');
      const coaRefFilter = (nativeIdColumn: string) => {
        const parts: string[] = [];
        // `id` is a uuid column — only uuid-shaped refs may be compared against it
        // (QB/Sage short native ids would abort the query with a cast error).
        if (uuidShapedRefs.length > 0) parts.push(`id.in.(${quoteList(uuidShapedRefs)})`);
        if (uuidsList.length > 0) parts.push(`${nativeIdColumn}.in.(${quoteList(uuidsList)})`);
        return parts.join(',');
      };

      const uuidToAccount = new Map<string, { code: string; accountId: string }>();
      const registerAccount = (rowId: string, nativeId: string, code: string) => {
        const entry = { code, accountId: nativeId };
        uuidToAccount.set(rowId, entry);
        if (nativeId) uuidToAccount.set(nativeId, entry);
      };

      if (uuidsList.length > 0) {
        const [iplicitCoa, xeroCoa, qbCoa, sageCoa] = await Promise.all([
          (supabase as any)
            .from('iplicit_chart_of_accounts')
            .select('id, code, account_id')
            .eq('organization_id', organizationId)
            .or(coaRefFilter('account_id')),
          (supabase as any)
            .from('xero_chart_of_accounts')
            .select('id, account_code, xero_account_id')
            .eq('organization_id', organizationId)
            .or(coaRefFilter('xero_account_id')),
          (supabase as any)
            .from('quickbooks_chart_of_accounts')
            .select('id, qb_account_id')
            .eq('organization_id', organizationId)
            .or(coaRefFilter('qb_account_id')),
          (supabase as any)
            .from('sage_chart_of_accounts')
            .select('id, account_code, sage_account_id')
            .eq('organization_id', organizationId)
            .or(coaRefFilter('sage_account_id')),
        ]);

        const iplicitRows = (iplicitCoa?.data ?? []) as Array<{ id: string; code: string | null; account_id: string | null }>;
        const xeroRows = (xeroCoa?.data ?? []) as Array<{ id: string; account_code: string | null; xero_account_id: string | null }>;
        const qbRows = (qbCoa?.data ?? []) as Array<{ id: string; qb_account_id: string | null }>;
        const sageRows = (sageCoa?.data ?? []) as Array<{ id: string; account_code: string | null; sage_account_id: string | null }>;

        if (iplicitRows.length >= xeroRows.length && iplicitRows.length >= qbRows.length && iplicitRows.length >= sageRows.length && iplicitRows.length > 0) {
          isIplicit = true;
        } else if (qbRows.length >= xeroRows.length && qbRows.length >= sageRows.length && qbRows.length > 0) {
          isQuickBooks = true;
        } else if (sageRows.length >= xeroRows.length && sageRows.length > 0) {
          isSage = true;
        }
        // else: Xero (default) — unchanged for existing Xero orgs.

        const registerAccount = (rowId: string, nativeId: string, code: string) => {
          const entry = { code, accountId: nativeId };
          uuidToAccount.set(rowId, entry);
          if (nativeId) uuidToAccount.set(nativeId, entry);
        };

        if (isIplicit) {
          for (const row of iplicitRows) {
            registerAccount(row.id, (row.account_id || '').trim(), (row.code || '').trim());
          }
        } else if (isQuickBooks) {
          // quickbooks_profit_loss matches by qb_account_id (no code column),
          // so expose qb_account_id as both code and id.
          for (const row of qbRows) {
            const qbId = (row.qb_account_id || '').trim();
            registerAccount(row.id, qbId, qbId);
          }
        } else if (isSage) {
          // Sage: sage_invoice_line_items matches by account_code; sage_account_id
          // is the Sage ledger GUID, useful as a fallback id matcher.
          for (const row of sageRows) {
            registerAccount(
              row.id,
              (row.sage_account_id || '').trim(),
              (row.account_code || '').trim(),
            );
          }
        } else {
          for (const row of xeroRows) {
            registerAccount(
              row.id,
              (row.xero_account_id || '').trim(),
              (row.account_code || '').trim(),
            );
          }
        }
        console.log('[useLocationCostsImpact] platform resolution', {
          platformHint: accountingPlatform?.platform_name ?? 'none',
          iplicitUuidHits: iplicitRows.length,
          xeroUuidHits: xeroRows.length,
          qbUuidHits: qbRows.length,
          sageUuidHits: sageRows.length,
          resolvedRefs: uuidToAccount.size,
          effective: isIplicit ? 'iplicit' : isQuickBooks ? 'quickbooks' : isSage ? 'sage' : 'xero',
        });
      }

      // pio_id → platform_org_id (legal entity / xero tenant id)
      const pioIdToEntity = new Map<string, string>();
      // Sage-specific: platform_integration_id → platform_org_id (Sage business
      // GUID). sage_invoices stores platform_integration_id on each row, but
      // locationToEntities collects platform_org_id — we resolve between them
      // in the aggregation loop below.
      const sageIntegrationToBusinessId = new Map<string, string>();
      for (const row of (pioAllRes?.data ?? []) as Array<{ id: string; platform_org_id: string | null; platform_name: string | null; platform_integration_id: string | null }>) {
        if (row.platform_org_id) pioIdToEntity.set(row.id, row.platform_org_id);
        if (row.platform_name === 'sage' && row.platform_integration_id && row.platform_org_id) {
          sageIntegrationToBusinessId.set(row.platform_integration_id, row.platform_org_id);
        }
      }

      // location_id → list of legal entity / tenant ids it's mapped to
      const locationToEntities = new Map<string, string[]>();
      for (const row of (mappingRes?.data ?? []) as Array<{ location_id: string; platform_integration_organizations_id: string }>) {
        const entity = pioIdToEntity.get(row.platform_integration_organizations_id);
        if (!entity) continue;
        const list = locationToEntities.get(row.location_id) ?? [];
        if (!list.includes(entity)) list.push(entity);
        locationToEntities.set(row.location_id, list);
      }

      // Build per-location, per-bucket filter sets (codes + ids).
      // Each location uses its overrides if set, else falls back to org-level.
      const buildFilter = (uuids: string[], codes: string[]): AccountFilter => {
        const codeSet = new Set<string>();
        const idSet = new Set<string>();
        for (const c of codes) if (c) codeSet.add(c);
        for (const u of uuids) {
          const a = uuidToAccount.get(u);
          if (a?.code) codeSet.add(a.code);
          if (a?.accountId) idSet.add(a.accountId);
        }
        return { codes: codeSet, ids: idSet };
      };

      const locationFilters = new Map<string, Record<BucketKey, AccountFilter>>();
      for (const loc of activeLocations) {
        const pickArr = (override: unknown): string[] =>
          Array.isArray(override) ? (override as string[]).filter(Boolean) : [];
        const overrides: Record<BucketKey, string[]> = {
          lab: pickArr(loc.lab_fees_accounts),
          staff: pickArr(loc.staff_costs_accounts),
          lease: pickArr(loc.operating_lease_accounts),
          clinician: locationClinicianAccounts.get(loc.id) ?? [],
          overhead: pickArr(loc.overhead_cost_accounts),
          material: pickArr(loc.material_cost_accounts),
          marketing: pickArr(loc.marketing_cost_accounts),
        };
        const filters = {} as Record<BucketKey, AccountFilter>;
        for (const bucket of BUCKET_KEYS) {
          const uuids = overrides[bucket].length > 0 ? overrides[bucket] : orgUuidsByBucket[bucket];
          const codes = overrides[bucket].length > 0 ? [] : orgCodesByBucket[bucket];
          filters[bucket] = buildFilter(uuids, codes);
        }
        locationFilters.set(loc.id, filters);
      }

      // Build (entity|code) → Map<bucket, Set<locationId>> and (entity|id) → ...
      // Used to attribute a single P&L row to all locations whose bucket
      // includes that (entity, code/id) pair.
      type PairKey = string;
      const pairToLocByBucket: Record<BucketKey, Map<PairKey, Set<string>>> = {
        lab: new Map(), staff: new Map(), lease: new Map(),
        clinician: new Map(), overhead: new Map(), material: new Map(), marketing: new Map(),
      };
      const orphanCodeToLocByBucket: Record<BucketKey, Map<string, Set<string>>> = {
        lab: new Map(), staff: new Map(), lease: new Map(),
        clinician: new Map(), overhead: new Map(), material: new Map(), marketing: new Map(),
      };
      const orphanIdToLocByBucket: Record<BucketKey, Map<string, Set<string>>> = {
        lab: new Map(), staff: new Map(), lease: new Map(),
        clinician: new Map(), overhead: new Map(), material: new Map(), marketing: new Map(),
      };

      const allCodesUnion = new Set<string>();
      const allIdsUnion = new Set<string>();
      const allEntities = new Set<string>();

      for (const [locId, filters] of locationFilters) {
        const entities = locationToEntities.get(locId) ?? [];
        for (const e of entities) allEntities.add(e);
        for (const bucket of BUCKET_KEYS) {
          const f = filters[bucket];
          for (const c of f.codes) {
            allCodesUnion.add(c);
            if (entities.length === 0) {
              // Orphan: no platform mapping → match by code alone
              const set = orphanCodeToLocByBucket[bucket].get(c) ?? new Set();
              set.add(locId);
              orphanCodeToLocByBucket[bucket].set(c, set);
            } else {
              for (const e of entities) {
                const key = `${e}|${c}`;
                const set = pairToLocByBucket[bucket].get(key) ?? new Set();
                set.add(locId);
                pairToLocByBucket[bucket].set(key, set);
              }
            }
          }
          for (const i of f.ids) {
            allIdsUnion.add(i);
            if (entities.length === 0) {
              const set = orphanIdToLocByBucket[bucket].get(i) ?? new Set();
              set.add(locId);
              orphanIdToLocByBucket[bucket].set(i, set);
            } else {
              for (const e of entities) {
                const key = `${e}|${i}`;
                const set = pairToLocByBucket[bucket].get(key) ?? new Set();
                set.add(locId);
                pairToLocByBucket[bucket].set(key, set);
              }
            }
          }
        }
      }

      // Initialize result map (every active location starts at 0)
      for (const loc of activeLocations) {
        result.set(loc.id, emptyBuckets());
      }

      if (allCodesUnion.size === 0 && allIdsUnion.size === 0) return result;

      // ── Fetch P&L rows once with union filter ─────────────────────
      const esc = (v: string) => `"${v.replace(/"/g, '\\"')}"`;
      const orParts: string[] = [];
      if (allCodesUnion.size > 0) orParts.push(`account_code.in.(${[...allCodesUnion].map(esc).join(',')})`);
      if (allIdsUnion.size > 0) orParts.push(`account_id.in.(${[...allIdsUnion].map(esc).join(',')})`);
      const orFilter = orParts.join(',');

      // Calendar-month aligned bounds. Iplicit/Xero P&L rows are dated at
      // month-end, so a sub-monthly date range (e.g. "20-26 April") would
      // miss them entirely. Extend to: first day of startDate's month →
      // last day of endDate's month.
      const startD = new Date(startDate);
      const endD = new Date(endDate);
      const calendarStart = `${startD.getFullYear()}-${String(startD.getMonth() + 1).padStart(2, '0')}-01`;
      const lastDayOfEnd = new Date(endD.getFullYear(), endD.getMonth() + 1, 0).getDate();
      const calendarEnd = `${endD.getFullYear()}-${String(endD.getMonth() + 1).padStart(2, '0')}-${String(lastDayOfEnd).padStart(2, '0')}`;
      const iplicitPeriodStart = calendarStart;

      const fetchAll = async (build: () => any): Promise<any[]> => {
        const rows: any[] = [];
        const first = await build().range(0, PAGE_SIZE - 1);
        if (first.error) {
          console.error('[useLocationCostsImpact] fetch error:', first.error);
          return rows;
        }
        const firstPage = (first.data ?? []) as any[];
        const totalCount = (first.count ?? firstPage.length) as number;
        rows.push(...firstPage);
        if (totalCount > PAGE_SIZE) {
          const numPages = Math.ceil(totalCount / PAGE_SIZE);
          const rest = await Promise.all(
            Array.from({ length: numPages - 1 }, (_, i) => {
              const start = (i + 1) * PAGE_SIZE;
              return build().range(start, start + PAGE_SIZE - 1);
            }),
          );
          for (const r of rest) if (r?.data) rows.push(...r.data);
        }
        return rows;
      };

      const entitiesArr = [...allEntities];
      const hasEntityFilter = entitiesArr.length > 0;

      const buildIplicit = () => {
        let q = (supabase as any)
          .from('iplicit_profit_loss')
          .select('amount, account_code, account_id, legal_entity_id', { count: 'exact' })
          .eq('organization_id', organizationId)
          .gte('period_date', iplicitPeriodStart)
          .lte('period_date', calendarEnd + 'T23:59:59')
          .or(orFilter);
        if (hasEntityFilter && entitiesArr.length === 1) {
          q = q.eq('legal_entity_id', entitiesArr[0]);
        } else if (hasEntityFilter) {
          q = q.in('legal_entity_id', entitiesArr);
        }
        return q;
      };

      const buildXero = () => {
        let q = (supabase as any)
          .from('xero_invoice_line_items')
          .select(`
            line_amount,
            account_code,
            account_id,
            invoice:xero_invoices!inner(
              invoice_date,
              invoice_type,
              xero_tenant_id
            )
          `, { count: 'exact' })
          .eq('organization_id', organizationId)
          .eq('invoice.invoice_type', 'PL_SYNTHETIC')
          .gte('invoice.invoice_date', calendarStart)
          .lte('invoice.invoice_date', calendarEnd + 'T23:59:59')
          .or(orFilter);
        if (hasEntityFilter && entitiesArr.length === 1) {
          q = q.eq('invoice.xero_tenant_id', entitiesArr[0]);
        } else if (hasEntityFilter) {
          q = q.in('invoice.xero_tenant_id', entitiesArr);
        }
        return q;
      };

      // QuickBooks: quickbooks_profit_loss is one row per (account × month),
      // keyed by qb_account_id, scoped by realm_id (= platform_org_id, the
      // same entity id the mapping resolves to). Mirrors the Iplicit monthly
      // aggregation. uuidToAccount exposes qb_account_id as both code and id,
      // so the union of codes+ids is the qb_account_id set.
      const qbAccountIds = [...new Set<string>([...allCodesUnion, ...allIdsUnion])];
      const buildQuickBooks = () => {
        let q = (supabase as any)
          .from('quickbooks_profit_loss')
          .select('amount, qb_account_id, realm_id', { count: 'exact' })
          .eq('organization_id', organizationId)
          .gte('from_date', iplicitPeriodStart)
          .lte('from_date', calendarEnd)
          .in('qb_account_id', qbAccountIds);
        if (hasEntityFilter && entitiesArr.length === 1) {
          q = q.eq('realm_id', entitiesArr[0]);
        } else if (hasEntityFilter) {
          q = q.in('realm_id', entitiesArr);
        }
        return q;
      };

      // Sage: real ACCPAY purchase invoice line items (no synthetic table —
      // Sage syncs the actual invoices, so line items carry account_code).
      // Mirrors the Xero query shape. Entity scoping uses platform_integration_id
      // on the parent invoice (Sage is single-tenant per OAuth).
      const buildSage = () => {
        let q = (supabase as any)
          .from('sage_invoice_line_items')
          .select(`
            line_amount,
            account_code,
            invoice:sage_invoices!inner(
              invoice_date,
              platform_integration_id
            )
          `, { count: 'exact' })
          .eq('organization_id', organizationId)
          .gte('invoice.invoice_date', calendarStart)
          .lte('invoice.invoice_date', calendarEnd + 'T23:59:59')
          .or(orFilter);
        return q;
      };

      const rows = isIplicit
        ? await fetchAll(buildIplicit)
        : isQuickBooks
          ? await fetchAll(buildQuickBooks)
          : isSage
            ? await fetchAll(buildSage)
            : await fetchAll(buildXero);
      const amountField = (isIplicit || isQuickBooks) ? 'amount' : 'line_amount';

      for (const r of rows) {
        const code = isQuickBooks
          ? (r.qb_account_id ? String(r.qb_account_id).trim() : '')
          : (r.account_code || '').trim();
        const id = isQuickBooks ? code : (r.account_id || '').trim();
        const entity = isIplicit
          ? (r.legal_entity_id ? String(r.legal_entity_id).trim() : '')
          : isQuickBooks
            ? (r.realm_id ? String(r.realm_id).trim() : '')
            : isSage
              // Sage line items expose the parent invoice's platform_integration_id;
              // map it to the Sage business GUID so it matches locationToEntities
              // (which collects platform_org_id from PIO).
              ? (r.invoice?.platform_integration_id
                  ? (sageIntegrationToBusinessId.get(r.invoice.platform_integration_id) || '')
                  : '')
              : (r.invoice?.xero_tenant_id ? String(r.invoice.xero_tenant_id).trim() : '');
        const amount = Number(r[amountField]) || 0;
        if (amount === 0) continue;

        for (const bucket of BUCKET_KEYS) {
          let matchedLocations: Set<string> | undefined;

          if (entity && code) {
            matchedLocations = pairToLocByBucket[bucket].get(`${entity}|${code}`);
          }
          if (!matchedLocations && entity && id) {
            matchedLocations = pairToLocByBucket[bucket].get(`${entity}|${id}`);
          }
          if (!matchedLocations && code) {
            matchedLocations = orphanCodeToLocByBucket[bucket].get(code);
          }
          if (!matchedLocations && id) {
            matchedLocations = orphanIdToLocByBucket[bucket].get(id);
          }

          if (!matchedLocations) continue;
          const absAmount = Math.abs(amount);
          // When several locations share the same accounting entity and the
          // same mapped account, give each an equal share so the group sum
          // equals the unique P&L total (no double-count). Locations with
          // dedicated tenants still receive 100% of their own lines.
          const share = absAmount / matchedLocations.size;
          for (const locId of matchedLocations) {
            const buckets = result.get(locId);
            if (!buckets) continue;
            buckets[bucket] += share;
            buckets.totalCosts += share;
          }
        }
      }

      return result;
    },
  });
}
