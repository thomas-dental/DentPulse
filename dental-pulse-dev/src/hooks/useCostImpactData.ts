import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from './useOrganization';
import { useFilters } from '@/contexts/FilterContext';
import { useExpenseAccountSettings } from './useExpenseAccountSettings';
import { fetchGLEntries } from '@/services/integrations/glEntriesService';
import { ukDayStartInstant, ukDayEndInstant } from '@/utils/dateRangeUtils';
import { CLINICIAN_ROLE_GROUP_CODES } from '@/utils/clinicianCostAccounts';

const PAGE_SIZE = 1000;

function toDateStr(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export interface CostImpactData {
  totalRevenue: number;
  labFeesCost: number;
  staffCostsCost: number;
  operatingLeasesCost: number;
  clinicianCostCost: number;
  overheadCostCost: number;
  materialCostCost: number;
  marketingCostCost: number;
  totalCosts: number;
  ebitda: number;
  // Treatment-derived cost breakdown (fallback when no GL accounts)
  treatmentLabFees: number;
  treatmentStaffCosts: number;
  treatmentOpCosts: number;
  treatmentMaterialCosts: number;
  treatmentFinanceFees: number;
  treatmentTotalExpense: number;
  // Invoice stats (for cash conversion)
  paidInvoiceCount: number;
  totalInvoiceCount: number;
  invoiceRevenue: number;
  // Flags
  hasGLData: boolean;
  // Accounting platform the costs were resolved from — so consumers (e.g. the
  // EBITDA page badge) can label the source correctly instead of assuming Xero.
  platform: 'iplicit' | 'xero' | 'quickbooks' | 'sage';
}

type BucketKey = 'lab' | 'staff' | 'lease' | 'clinician' | 'overhead' | 'material' | 'marketing';

interface AccountFilter {
  codes: string[];
  ids: string[];
}

type BucketFilters = Record<BucketKey, AccountFilter>;

interface LocationScope {
  locationId: string;
  filters: BucketFilters;
  legalEntityIds: string[];
}

const BUCKET_KEYS: BucketKey[] = ['lab', 'staff', 'lease', 'clinician', 'overhead', 'material', 'marketing'];

function emptyBucketTotals(): Record<BucketKey, number> {
  return { lab: 0, staff: 0, lease: 0, clinician: 0, overhead: 0, material: 0, marketing: 0 };
}

function emptyPairSets(): Record<BucketKey, Set<string>> {
  return {
    lab: new Set(), staff: new Set(), lease: new Set(),
    clinician: new Set(), overhead: new Set(), material: new Set(), marketing: new Set(),
  };
}

export function useCostImpactData(options?: { dateRangeOverride?: { startDate: Date; endDate: Date } }) {
  const { organizationId } = useOrganization();
  const { dateRange: ctxDateRange, selectedLocationId, selectedRegionId } = useFilters();
  // An optional override lets a caller request costs for a DIFFERENT period
  // than the global filter — e.g. the Cost Impact "Detailed Cost Breakdown"
  // fetches the previous period for its period-over-period % Change / Cost
  // Change columns. With no override, behaviour is identical to before.
  const dateRange = options?.dateRangeOverride ?? ctxDateRange;
  const expenseSettings = useExpenseAccountSettings(selectedLocationId);

  const startDate = toDateStr(dateRange.startDate);
  const endDate = toDateStr(dateRange.endDate);

  // Org-level expense accounts (from organizations table)
  const orgLabCodes = expenseSettings.labFees.accountCodes;
  const orgLabUuids = expenseSettings.labFees.selectedAccounts;
  const orgStaffCodes = expenseSettings.staffCosts.accountCodes;
  const orgStaffUuids = expenseSettings.staffCosts.selectedAccounts;
  const orgLeaseCodes = expenseSettings.operatingLease.accountCodes;
  const orgLeaseUuids = expenseSettings.operatingLease.selectedAccounts;
  const orgClinicianCodes = expenseSettings.clinicianCost.accountCodes;
  const orgClinicianUuids = expenseSettings.clinicianCost.selectedAccounts;
  const orgOverheadCodes = expenseSettings.overheadCost.accountCodes;
  const orgOverheadUuids = expenseSettings.overheadCost.selectedAccounts;
  const orgMaterialCodes = expenseSettings.materialCost.accountCodes;
  const orgMaterialUuids = expenseSettings.materialCost.selectedAccounts;
  const orgMarketingCodes = expenseSettings.marketingCost.accountCodes;
  const orgMarketingUuids = expenseSettings.marketingCost.selectedAccounts;

  return useQuery({
    queryKey: [
      'cost-impact-data-v9',
      organizationId,
      startDate,
      endDate,
      selectedLocationId || 'all',
      selectedRegionId || 'all-regions',
      orgLabUuids,
      orgStaffUuids,
      orgLeaseUuids,
      orgClinicianUuids,
      orgOverheadUuids,
      orgMaterialUuids,
      orgMarketingUuids,
    ],
    // Caches the full cost-impact aggregation for 5 min so re-mounting
    // (e.g. tab switch within the page or navigating back) returns
    // instantly from cache instead of re-firing the heavy fetches.
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    queryFn: async (): Promise<CostImpactData> => {
      if (!organizationId) {
        return emptyResult();
      }

      // Union of every UUID we might need to resolve to {code, account_id}.
      // Pushed down to one COA query per platform instead of six.
      const allOrgUuids = Array.from(new Set([
        ...orgLabUuids, ...orgStaffUuids, ...orgLeaseUuids,
        ...orgClinicianUuids, ...orgOverheadUuids, ...orgMaterialUuids, ...orgMarketingUuids,
      ]));

      // Bucket references in practice_locations.*_accounts are normally the
      // chart-of-accounts row id, but older saves stored the platform's own
      // account identifier instead — the settings picker used to write
      // xero_account_id and still renders either form (see
      // OrganizationDetailContent's badge lookup). Matching on both keeps
      // those legacy mappings resolvable; without it every bucket silently
      // resolves to nothing and the whole dashboard reads £0.
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const uuidShapedRefs = allOrgUuids.filter(ref => UUID_RE.test(ref));
      const quoteList = (vals: string[]) => vals.map(v => `"${v.replace(/"/g, '\\"')}"`).join(',');
      // `id` is a uuid column, so only uuid-shaped refs may be compared
      // against it — QuickBooks/Sage native ids are short strings that would
      // abort the whole query with a cast error.
      const coaRefFilter = (nativeIdColumn: string) => {
        const parts: string[] = [];
        if (uuidShapedRefs.length > 0) parts.push(`id.in.(${quoteList(uuidShapedRefs)})`);
        parts.push(`${nativeIdColumn}.in.(${quoteList(allOrgUuids)})`);
        return parts.join(',');
      };

      const overrideSelect = 'id, region_id, lab_fees_accounts, staff_costs_accounts, operating_lease_accounts, overhead_cost_accounts, material_cost_accounts, marketing_cost_accounts, api_record_unique_id';

      // ── PHASE 1: Fire all independent metadata queries in parallel ──
      const [
        locationOverrideRes,
        activeLocationsRes,
        mappingRes,
        platformRes,
        treatmentsRes,
        iplicitCoaRes,
        xeroCoaRes,
        quickbooksCoaRes,
        sageCoaRes,
        pioAllRes,
        clinicianRoleMastersRes,
      ] = await Promise.all([
        // Selected location's overrides + Dentally site UUID
        selectedLocationId
          ? (supabase as any)
              .from('practice_locations')
              .select(overrideSelect)
              .eq('id', selectedLocationId)
              .single()
          : Promise.resolve({ data: null, error: null }),

        // All non-deleted locations + their overrides — used by All-view
        // bucketing so each location's per-bucket override is honored.
        !selectedLocationId
          ? (supabase as any)
              .from('practice_locations')
              .select(overrideSelect)
              .eq('organization_id', organizationId)
              .is('deleted_at', null)
          : Promise.resolve({ data: null, error: null }),

        // Mappings: per-location for selected, otherwise all org mappings
        // with location_id so we can scope cost lines per location.
        selectedLocationId
          ? (supabase as any)
              .from('platform_integration_organization_mapping')
              .select('location_id, platform_integration_organizations_id')
              .eq('organization_id', organizationId)
              .eq('location_id', selectedLocationId)
          : (supabase as any)
              .from('platform_integration_organization_mapping')
              .select('location_id, platform_integration_organizations_id')
              .eq('organization_id', organizationId),

        // Accounting platform detection (iplicit vs xero vs quickbooks vs sage)
        (supabase as any)
          .from('platform_integrations')
          .select('platform_name')
          .eq('organization_id', organizationId)
          .in('platform_name', ['iplicit', 'xero', 'quickbooks', 'sage', 'Iplicit', 'Xero', 'QuickBooks', 'Sage']),

        // Treatment cost templates (for TPI-derived cost breakdown)
        (supabase as any)
          .from('treatments')
          .select('id, treatment_name, external_id, material_cost, lab_bill, therapist_pay_rate, hourly_rate, percent_fees, finance_fee, duration_minutes')
          .eq('organization_id', organizationId)
          .is('deleted_at', null)
          .eq('is_active', true),

        // Chart-of-accounts — both platforms in parallel, batched.
        allOrgUuids.length > 0
          ? (supabase as any)
              .from('iplicit_chart_of_accounts')
              .select('id, code, account_id')
              .eq('organization_id', organizationId)
              .or(coaRefFilter('account_id'))
          : Promise.resolve({ data: [], error: null }),

        allOrgUuids.length > 0
          ? (supabase as any)
              .from('xero_chart_of_accounts')
              .select('id, account_code, xero_account_id')
              .eq('organization_id', organizationId)
              .or(coaRefFilter('xero_account_id'))
          : Promise.resolve({ data: [], error: null }),

        // QuickBooks CoA — UUIDs reference quickbooks_chart_of_accounts.id;
        // quickbooks_profit_loss matches by qb_account_id (no code column).
        allOrgUuids.length > 0
          ? (supabase as any)
              .from('quickbooks_chart_of_accounts')
              .select('id, account_number, qb_account_id')
              .eq('organization_id', organizationId)
              .or(coaRefFilter('qb_account_id'))
          : Promise.resolve({ data: [], error: null }),

        // Sage CoA — UUIDs reference sage_chart_of_accounts.id; Sage cost
        // queries match by account_code on sage_invoice_line_items.
        allOrgUuids.length > 0
          ? (supabase as any)
              .from('sage_chart_of_accounts')
              .select('id, account_code, sage_account_id, platform_integration_id')
              .eq('organization_id', organizationId)
              .or(coaRefFilter('sage_account_id'))
          : Promise.resolve({ data: [], error: null }),

        // All platform_integration_organizations rows for this org. Small
        // table (one row per legal entity / tenant). Pre-fetching avoids a
        // sequential round trip after mapping resolution. platform_name is
        // pulled too so we can route per-location costs to the right
        // platform's P&L table (some orgs mix Xero + QuickBooks across
        // locations, e.g. Wigmore on QuickBooks while another location is
        // still on Xero).
        (supabase as any)
          .from('platform_integration_organizations')
          .select('id, platform_org_id, platform_name, platform_integration_id')
          .eq('organization_id', organizationId),

        // Hygienist / Dentist / Therapist masters — Clinician Cost is their union.
        (supabase as any)
          .from('group_account_master')
          .select('id, group_code')
          .eq('group_type', 2)
          .in('group_code', [...CLINICIAN_ROLE_GROUP_CODES]),
      ]);

      // ── Detect platform ──
      // Priority order:
      //  1. The selected location's mapping in platform_integration_organizations.
      //     This is the source of truth: a location is mapped to ONE pio row
      //     whose platform_name tells us which P&L table holds the costs.
      //     Critical when an org mixes Xero + QuickBooks across locations —
      //     bucket-UUID heuristics fall apart there (legacy Xero UUIDs on a
      //     location now mapped to QuickBooks would otherwise route the
      //     query to xero_profit_loss with a QB realm_id and produce £0).
      //  2. Bucket-UUID hits across the three CoA tables — used when no
      //     selected location, or no mapping exists.
      //  3. platform_integrations hint — fallback when nothing else resolves.
      const accountingPlatform = ((platformRes?.data || []) as Array<{ platform_name: string }>)
        .find(p => ['iplicit', 'xero', 'quickbooks', 'sage'].includes(p.platform_name?.toLowerCase()));
      const iplicitUuidHits = ((iplicitCoaRes?.data ?? []) as any[]).length;
      const xeroUuidHits = ((xeroCoaRes?.data ?? []) as any[]).length;
      const qbUuidHits = ((quickbooksCoaRes?.data ?? []) as any[]).length;
      const sageUuidHits = ((sageCoaRes?.data ?? []) as any[]).length;

      // Build pio_id → platform_name lookup (used by both the mapping-based
      // platform resolver and the pio_id → platform_org_id mapping later).
      const pioIdToPlatformName = new Map<string, string>();
      for (const row of (pioAllRes?.data ?? []) as Array<{ id: string; platform_name: string | null }>) {
        if (row.platform_name) pioIdToPlatformName.set(row.id, row.platform_name.toLowerCase());
      }

      // Tally the platforms of the selected location's mappings (or every
      // mapping if no location is selected). Whichever has the most rows
      // wins.
      const mappedPlatformCounts: Record<string, number> = { iplicit: 0, xero: 0, quickbooks: 0, sage: 0 };
      for (const row of (mappingRes?.data ?? []) as Array<{ platform_integration_organizations_id: string }>) {
        const p = pioIdToPlatformName.get(row.platform_integration_organizations_id);
        if (p && p in mappedPlatformCounts) mappedPlatformCounts[p] += 1;
      }
      const mappingDominantPlatform = (Object.entries(mappedPlatformCounts)
        .sort((a, b) => b[1] - a[1])
        .find(([, n]) => n > 0)?.[0]) ?? null;

      let isIplicit: boolean;
      let isQuickBooks: boolean;
      let isSage: boolean;
      let platformSource: 'mapping' | 'uuid-hits' | 'platform-hint';
      if (mappingDominantPlatform) {
        isIplicit = mappingDominantPlatform === 'iplicit';
        isQuickBooks = mappingDominantPlatform === 'quickbooks';
        isSage = mappingDominantPlatform === 'sage';
        platformSource = 'mapping';
      } else if (iplicitUuidHits > 0 || xeroUuidHits > 0 || qbUuidHits > 0 || sageUuidHits > 0) {
        isIplicit = iplicitUuidHits >= xeroUuidHits && iplicitUuidHits >= qbUuidHits && iplicitUuidHits >= sageUuidHits && iplicitUuidHits > 0;
        isQuickBooks = !isIplicit && qbUuidHits >= xeroUuidHits && qbUuidHits >= sageUuidHits && qbUuidHits > 0;
        isSage = !isIplicit && !isQuickBooks && sageUuidHits >= xeroUuidHits && sageUuidHits > 0;
        platformSource = 'uuid-hits';
      } else {
        isIplicit = accountingPlatform?.platform_name?.toLowerCase() === 'iplicit';
        isQuickBooks = !isIplicit
          && accountingPlatform?.platform_name?.toLowerCase() === 'quickbooks';
        isSage = !isIplicit && !isQuickBooks
          && accountingPlatform?.platform_name?.toLowerCase() === 'sage';
        platformSource = 'platform-hint';
      }
      const effectivePlatform = isIplicit ? 'iplicit'
        : isQuickBooks ? 'quickbooks'
        : isSage ? 'sage'
        : 'xero';
      console.log('[COST-IMPACT] platform resolution', {
        platformHint: accountingPlatform?.platform_name ?? 'none',
        mappingDominantPlatform,
        mappedPlatformCounts,
        iplicitUuidHits, xeroUuidHits, qbUuidHits, sageUuidHits,
        effective: effectivePlatform,
        source: platformSource,
      });
      // Loud warning when the bucket UUIDs don't live in the platform we just
      // routed to — that's the most common cause of all-£0 cost tiles after a
      // platform switch (e.g. Wigmore re-mapped from Xero to QuickBooks but
      // bucket UUIDs still point at xero_chart_of_accounts).
      if (platformSource === 'mapping') {
        const hitsForEffective = effectivePlatform === 'iplicit' ? iplicitUuidHits
          : effectivePlatform === 'quickbooks' ? qbUuidHits
          : effectivePlatform === 'sage' ? sageUuidHits
          : xeroUuidHits;
        if (allOrgUuids.length > 0 && hitsForEffective === 0) {
          console.warn(
            `[COST-IMPACT] Expense bucket UUIDs do not match the mapped platform (${effectivePlatform}). ` +
            `iplicit=${iplicitUuidHits}, xero=${xeroUuidHits}, quickbooks=${qbUuidHits}, sage=${sageUuidHits}. ` +
            'Open Location Settings → Expenses Accounts and re-pick the bucket accounts from the connected platform.',
          );
        }
      }

      // ── Build treatment cost map ──
      const extIdToCosts = new Map<number | string, {
        material_cost: number; lab_bill: number; therapist_pay_rate: number;
        hourly_rate: number; percent_fees: number; finance_fee: number; duration_minutes: number;
      }>();
      for (const t of (treatmentsRes?.data ?? []) as any[]) {
        if (t.external_id) {
          extIdToCosts.set(t.external_id, {
            material_cost: t.material_cost || 0,
            lab_bill: t.lab_bill || 0,
            therapist_pay_rate: t.therapist_pay_rate || 0,
            hourly_rate: t.hourly_rate || 0,
            percent_fees: t.percent_fees || 0,
            finance_fee: t.finance_fee || 0,
            duration_minutes: t.duration_minutes || 0,
          });
        }
      }

      // ── COA map (UUID → { code, accountId }) ──
      const uuidToAccount = new Map<string, { code: string; accountId: string }>();
      // Registered under both the row id and the platform's native account id
      // so a bucket resolves whichever of the two the mapping was saved with.
      const registerAccount = (rowId: string, nativeId: string, code: string) => {
        const entry = { code, accountId: nativeId };
        uuidToAccount.set(rowId, entry);
        if (nativeId) uuidToAccount.set(nativeId, entry);
      };
      if (isIplicit) {
        for (const row of (iplicitCoaRes?.data ?? []) as Array<{ id: string; code: string | null; account_id: string | null }>) {
          registerAccount(row.id, (row.account_id || '').trim(), (row.code || '').trim());
        }
      } else if (isQuickBooks) {
        // quickbooks_profit_loss has no code column — match by qb_account_id.
        // Expose qb_account_id as BOTH code and accountId so the existing
        // pair/orphan matching logic works unchanged for QuickBooks.
        for (const row of (quickbooksCoaRes?.data ?? []) as Array<{ id: string; account_number: string | null; qb_account_id: string | null }>) {
          const qbId = (row.qb_account_id || '').trim();
          registerAccount(row.id, qbId, qbId);
        }
      } else if (isSage) {
        // Sage: UUIDs reference sage_chart_of_accounts.id; sage_invoice_line_items
        // matches by account_code. sage_account_id is the Sage ledger GUID,
        // useful as a secondary matcher when a code isn't populated on the line.
        for (const row of (sageCoaRes?.data ?? []) as Array<{ id: string; account_code: string | null; sage_account_id: string | null }>) {
          registerAccount(row.id, (row.sage_account_id || '').trim(), (row.account_code || '').trim());
        }
      } else {
        for (const row of (xeroCoaRes?.data ?? []) as Array<{ id: string; account_code: string | null; xero_account_id: string | null }>) {
          registerAccount(row.id, (row.xero_account_id || '').trim(), (row.account_code || '').trim());
        }
      }

      const buildFilter = (uuids: string[], codes: string[]): AccountFilter => {
        const resolvedCodes = new Set<string>();
        const resolvedIds = new Set<string>();
        for (const c of codes) if (c) resolvedCodes.add(c);
        for (const u of uuids) {
          const a = uuidToAccount.get(u);
          if (a?.code) resolvedCodes.add(a.code);
          if (a?.accountId) resolvedIds.add(a.accountId);
        }
        return { codes: [...resolvedCodes], ids: [...resolvedIds] };
      };

      // ── pio_id → platform_org_id lookup ──
      const pioIdToPlatformOrgId = new Map<string, string>();
      // Sage-specific: platform_integration_id → platform_org_id (Sage business
      // GUID). sage_invoices.platform_integration_id is what we have on each
      // cost row, but locationToEntityIds collects platform_org_id, so we map
      // between them in the aggregation loop below.
      const sageIntegrationToBusinessId = new Map<string, string>();
      for (const row of (pioAllRes?.data ?? []) as Array<{ id: string; platform_org_id: string | null; platform_name: string | null; platform_integration_id: string | null }>) {
        if (row.platform_org_id) pioIdToPlatformOrgId.set(row.id, row.platform_org_id);
        if (row.platform_name === 'sage' && row.platform_integration_id && row.platform_org_id) {
          sageIntegrationToBusinessId.set(row.platform_integration_id, row.platform_org_id);
        }
      }

      // ── Group mapping rows by location ──
      const locationToEntityIds = new Map<string, string[]>();
      for (const row of (mappingRes?.data ?? []) as Array<{ location_id: string; platform_integration_organizations_id: string }>) {
        const ent = pioIdToPlatformOrgId.get(row.platform_integration_organizations_id);
        if (!ent) continue;
        const list = locationToEntityIds.get(row.location_id) ?? [];
        if (!list.includes(ent)) list.push(ent);
        locationToEntityIds.set(row.location_id, list);
      }

      // Clinician Cost = Hygienist + Dentist + Therapist per location (Setup Categories).
      const clinicianMasterIds = ((clinicianRoleMastersRes?.data ?? []) as Array<{ id: number }>)
        .map((m) => m.id);
      const locationClinicianAccounts = new Map<string, string[]>();
      if (clinicianMasterIds.length > 0) {
        let clinicianGaQuery = (supabase as any)
          .from('group_account')
          .select('account_id, mapping_location_id')
          .eq('organization_id', organizationId)
          .in('group_account_master_id', clinicianMasterIds)
          .not('mapping_location_id', 'is', null);
        if (selectedLocationId) {
          clinicianGaQuery = clinicianGaQuery.eq('mapping_location_id', selectedLocationId);
        }
        const { data: clinicianGaRows } = await clinicianGaQuery;
        for (const row of (clinicianGaRows ?? []) as Array<{ account_id: string | null; mapping_location_id: string | null }>) {
          const locId = row.mapping_location_id;
          const accId = (row.account_id || '').trim();
          if (!locId || !accId) continue;
          const list = locationClinicianAccounts.get(locId) ?? [];
          if (!list.includes(accId)) list.push(accId);
          locationClinicianAccounts.set(locId, list);
        }
      }

      // Helper: build per-bucket filters from a location row's overrides
      // (org-level codes/uuids substitute when an override is empty).
      const buildBucketFilters = (loc: any | null): BucketFilters => {
        const pick = (override: unknown, orgUuids: string[], orgCodes: string[]) => {
          const arr = Array.isArray(override) ? (override as string[]) : [];
          return arr.length > 0
            ? buildFilter(arr, [])
            : buildFilter(orgUuids, orgCodes);
        };
        const locId = loc?.id ? String(loc.id) : selectedLocationId || null;
        const derivedClinician = locId ? locationClinicianAccounts.get(locId) : undefined;
        return {
          lab: pick(loc?.lab_fees_accounts, orgLabUuids, orgLabCodes),
          staff: pick(loc?.staff_costs_accounts, orgStaffUuids, orgStaffCodes),
          lease: pick(loc?.operating_lease_accounts, orgLeaseUuids, orgLeaseCodes),
          // Always Hygienist+Dentist+Therapist — never the legacy clinician_cost_accounts column.
          clinician: (derivedClinician && derivedClinician.length > 0)
            ? buildFilter(derivedClinician, [])
            : buildFilter(orgClinicianUuids, orgClinicianCodes),
          overhead: pick(loc?.overhead_cost_accounts, orgOverheadUuids, orgOverheadCodes),
          material: pick(loc?.material_cost_accounts, orgMaterialUuids, orgMaterialCodes),
          marketing: pick(loc?.marketing_cost_accounts, orgMarketingUuids, orgMarketingCodes),
        };
      };

      // ── Build location scopes ──
      // Per-location: a single scope for the selected location.
      // All-view: one scope per active *mapped* location. Locations with
      // no Practice Location Mapping are excluded — otherwise the orphan
      // fallback path below would pull P&L data for those locations using
      // org-level codes with no entity filter, inflating the All total
      // (this was the source of the £435.66 over-count from the unmapped
      // 4th location).
      //
      // Only when an org has zero mapped locations do we fall back to
      // including all active locations (orphan code-only matching) so
      // unmapped setups still show data instead of a blank dashboard.
      const scopes: LocationScope[] = [];
      const locData = locationOverrideRes?.data ?? null;
      const activeLocations = (activeLocationsRes?.data ?? []) as Array<any>;

      if (selectedLocationId) {
        scopes.push({
          locationId: selectedLocationId,
          filters: buildBucketFilters(locData),
          legalEntityIds: locationToEntityIds.get(selectedLocationId) ?? [],
        });
      } else {
        // Region scoping: when a region is selected (but no specific location),
        // restrict the scopes list to locations inside that region. This makes
        // every downstream cost aggregation reflect the region only — leaving
        // patient/invoice ID logic untouched (those branches are no-ops for
        // multi-location mode anyway).
        const scopedActive = selectedRegionId
          ? activeLocations.filter(loc => loc.region_id === selectedRegionId)
          : activeLocations;
        const allActive: LocationScope[] = scopedActive.map(loc => ({
          locationId: loc.id,
          filters: buildBucketFilters(loc),
          legalEntityIds: locationToEntityIds.get(loc.id) ?? [],
        }));
        const mappedOnly = allActive.filter(s => s.legalEntityIds.length > 0);
        if (mappedOnly.length > 0) {
          scopes.push(...mappedOnly);
        } else {
          // Region/org has no mappings — keep legacy code-only behavior
          scopes.push(...allActive);
        }
      }

      // ── Build (entity, code/id) pair sets per bucket + union filter ──
      const entityCodePairs = emptyPairSets();
      const entityIdPairs = emptyPairSets();
      const allCodesUnion = new Set<string>();
      const allIdsUnion = new Set<string>();
      const allEntitiesUnion = new Set<string>();

      // Codes/ids that exist in ANY scope but with no entity bound — used
      // for the "no-mapping" fallback path below so existing orgs that
      // haven't configured Practice Location Mappings yet still get totals.
      const orphanedBucketCodes: Record<BucketKey, Set<string>> = emptyPairSets();
      const orphanedBucketIds: Record<BucketKey, Set<string>> = emptyPairSets();

      for (const scope of scopes) {
        for (const e of scope.legalEntityIds) allEntitiesUnion.add(e);
        for (const bucket of BUCKET_KEYS) {
          const f = scope.filters[bucket];
          for (const c of f.codes) {
            allCodesUnion.add(c);
            if (scope.legalEntityIds.length === 0) {
              orphanedBucketCodes[bucket].add(c);
            } else {
              for (const e of scope.legalEntityIds) entityCodePairs[bucket].add(`${e}|${c}`);
            }
          }
          for (const i of f.ids) {
            allIdsUnion.add(i);
            if (scope.legalEntityIds.length === 0) {
              orphanedBucketIds[bucket].add(i);
            } else {
              for (const e of scope.legalEntityIds) entityIdPairs[bucket].add(`${e}|${i}`);
            }
          }
        }
      }

      // Site UUIDs (Dentally) for invoice/patient filtering — only used when a location is selected
      const dentallyUUIDs: string[] = locData?.api_record_unique_id ? [locData.api_record_unique_id as string] : [];
      const uuidSet: Set<string> | null = dentallyUUIDs.length > 0
        ? new Set(dentallyUUIDs.map(s => s.toLowerCase()))
        : null;

      // legalEntityIds for the original PL filter (union across scopes).
      // Empty when no mappings exist anywhere → falls back to org-wide query.
      const legalEntityIds = [...allEntitiesUnion];

      // Filters for the selected-location case (drive log lines and the GL
      // fallback). For All-view they're the union; the per-scope filters
      // above are what the bucketing actually uses.
      const labFiltersForLog = scopes.find(s => s.locationId === selectedLocationId)?.filters.lab
        ?? { codes: [...new Set(scopes.flatMap(s => s.filters.lab.codes))], ids: [...new Set(scopes.flatMap(s => s.filters.lab.ids))] };
      const staffFiltersForLog = scopes.find(s => s.locationId === selectedLocationId)?.filters.staff
        ?? { codes: [...new Set(scopes.flatMap(s => s.filters.staff.codes))], ids: [...new Set(scopes.flatMap(s => s.filters.staff.ids))] };
      const leaseFiltersForLog = scopes.find(s => s.locationId === selectedLocationId)?.filters.lease
        ?? { codes: [...new Set(scopes.flatMap(s => s.filters.lease.codes))], ids: [...new Set(scopes.flatMap(s => s.filters.lease.ids))] };
      const clinicianFiltersForLog = scopes.find(s => s.locationId === selectedLocationId)?.filters.clinician
        ?? { codes: [...new Set(scopes.flatMap(s => s.filters.clinician.codes))], ids: [...new Set(scopes.flatMap(s => s.filters.clinician.ids))] };
      const overheadFiltersForLog = scopes.find(s => s.locationId === selectedLocationId)?.filters.overhead
        ?? { codes: [...new Set(scopes.flatMap(s => s.filters.overhead.codes))], ids: [...new Set(scopes.flatMap(s => s.filters.overhead.ids))] };
      const materialFiltersForLog = scopes.find(s => s.locationId === selectedLocationId)?.filters.material
        ?? { codes: [...new Set(scopes.flatMap(s => s.filters.material.codes))], ids: [...new Set(scopes.flatMap(s => s.filters.material.ids))] };
      const marketingFiltersForLog = scopes.find(s => s.locationId === selectedLocationId)?.filters.marketing
        ?? { codes: [...new Set(scopes.flatMap(s => s.filters.marketing.codes))], ids: [...new Set(scopes.flatMap(s => s.filters.marketing.ids))] };

      const hasAnyAccounts = allCodesUnion.size > 0 || allIdsUnion.size > 0;

      if (selectedLocationId) {
        console.log('[COST-IMPACT] Location legal entity filter:', { selectedLocationId, legalEntityIds });
      } else {
        console.log('[COST-IMPACT] All-view scope summary:', {
          activeLocationCount: activeLocations.length,
          locationsWithEntities: scopes.filter(s => s.legalEntityIds.length > 0).length,
          totalEntities: allEntitiesUnion.size,
        });
      }
      console.log('[COST-IMPACT-V4] Phase-1 done', {
        platform: isIplicit ? 'iplicit' : isQuickBooks ? 'quickbooks' : isSage ? 'sage' : 'xero',
        scopes: scopes.length,
      });

      // ── PHASE 2: Heavy data fetches — all in parallel ──

      // Scope the paid-invoice lookup to a 12-month buffer before the date range
      const invoiceFloor = new Date(dateRange.startDate);
      invoiceFloor.setMonth(invoiceFloor.getMonth() - 12);
      const invoiceDateFloor = toDateStr(invoiceFloor);

      const fetchInvoiceIds = async (): Promise<{ allPaid: Set<number>; atLocation: Set<number> }> => {
        const paidInvoiceIds = new Set<number>();
        const paidAtLocationInvoiceIds = new Set<number>();

        const absorb = (rows: Array<{ platform_invoice_id: unknown; site_id: unknown; status: unknown }>) => {
          for (const inv of rows) {
            const pid = Number(inv.platform_invoice_id);
            if (isNaN(pid) || pid === 0) continue;
            paidInvoiceIds.add(pid);
            if (uuidSet) {
              const sid = inv.site_id != null ? String(inv.site_id).toLowerCase() : null;
              if (sid && uuidSet.has(sid)) paidAtLocationInvoiceIds.add(pid);
            } else {
              paidAtLocationInvoiceIds.add(pid);
            }
          }
        };

        // Cursor-based pagination on platform_invoice_id (skips the
        // `count: 'exact'` table scan that was previously fired here).
        let lastId: number | null = null;
        while (true) {
          let q = (supabase as any)
            .from('platform_integration_invoices')
            .select('platform_invoice_id, site_id, status')
            .eq('organization_id', organizationId)
            .is('deleted_at', null)
            .ilike('status', 'paid')
            .gte('invoice_date', invoiceDateFloor)
            .lte('invoice_date', endDate + 'T23:59:59')
            .order('platform_invoice_id', { ascending: true })
            .limit(PAGE_SIZE);
          if (lastId != null) q = q.gt('platform_invoice_id', lastId);
          const { data, error } = await q;
          if (error) {
            console.warn('[COST-IMPACT] fetchInvoiceIds error:', error.message);
            break;
          }
          const rows = (data ?? []) as Array<{ platform_invoice_id: unknown; site_id: unknown; status: unknown }>;
          if (rows.length === 0) break;
          absorb(rows);
          if (rows.length < PAGE_SIZE) break;
          const tail = rows[rows.length - 1].platform_invoice_id;
          lastId = tail != null ? Number(tail) : lastId;
        }

        return { allPaid: paidInvoiceIds, atLocation: paidAtLocationInvoiceIds };
      };

      const fetchPatientIds = async (): Promise<Set<number> | null> => {
        if (!selectedLocationId) return null;
        const patIds = new Set<number>();
        const siteIds = uuidSet ? [...uuidSet] : [];

        const absorb = (rows: Array<{ pt_id: unknown }>) => {
          for (const p of rows) {
            const pid = p.pt_id != null ? Number(p.pt_id) : null;
            if (pid && !isNaN(pid)) patIds.add(pid);
          }
        };

        // Cursor-based pagination on pt_id, no `count: 'exact'`.
        let lastPtId: number | null = null;
        while (true) {
          let q = (supabase as any)
            .from('patients')
            .select('pt_id')
            .eq('organization_id', organizationId)
            .is('deleted_at', null);
          if (siteIds.length > 0) {
            const siteList = siteIds.map(s => `"${s}"`).join(',');
            q = q.or(`location_id.eq.${selectedLocationId},pt_site_id.in.(${siteList})`);
          } else {
            q = q.eq('location_id', selectedLocationId);
          }
          q = q.order('pt_id', { ascending: true }).limit(PAGE_SIZE);
          if (lastPtId != null) q = q.gt('pt_id', lastPtId);
          const { data, error } = await q;
          if (error) {
            console.warn('[COST-IMPACT] fetchPatientIds error:', error.message);
            break;
          }
          const rows = (data ?? []) as Array<{ pt_id: unknown }>;
          if (rows.length === 0) break;
          absorb(rows);
          if (rows.length < PAGE_SIZE) break;
          const tail = rows[rows.length - 1].pt_id;
          lastPtId = tail != null ? Number(tail) : lastPtId;
        }

        return patIds;
      };

      // Cursor-based pagination on tpi_id avoids the slow `count: 'exact'`
      // full table scan that the previous offset-based version triggered
      // (each TPI table scan added several seconds to first page-load on
      // larger orgs). Sequential pages but each query hits the
      // (organization_id, tpi_id) index directly.
      const fetchAllTpis = async (): Promise<any[]> => {
        const all: any[] = [];
        let lastTpiId: number | null = null;
        while (true) {
          let q = (supabase as any)
            .from('treatment_plan_items')
            .select(
              'id, tpi_id, tpi_price, tpi_completed_at, tpi_treatment_id, tpi_invoice_id, tpi_patient_id, location_id',
            )
            .eq('organization_id', organizationId)
            .eq('tpi_completed', true)
            .not('tpi_completed_at', 'is', null)
            .is('deleted_at', null)
            // London day-boundary instants — bare 'YYYY-MM-DD' strings are
            // cast as UTC by the DB, one hour late during BST.
            .gte('tpi_completed_at', ukDayStartInstant(dateRange.startDate))
            .lte('tpi_completed_at', ukDayEndInstant(dateRange.endDate))
            .order('tpi_id', { ascending: true })
            .limit(PAGE_SIZE);
          if (lastTpiId != null) q = q.gt('tpi_id', lastTpiId);
          const { data, error } = await q;
          if (error) {
            console.error('[COST-IMPACT] fetchAllTpis error:', error.message);
            break;
          }
          const rows = (data ?? []) as any[];
          if (rows.length === 0) break;
          all.push(...rows);
          if (rows.length < PAGE_SIZE) break;
          const last = rows[rows.length - 1].tpi_id;
          lastTpiId = last != null ? Number(last) : lastTpiId;
        }
        return all;
      };

      const fetchInvoiceStats = async (): Promise<{ totalCount: number; paidCount: number; revenue: number }> => {
        const siteArray = uuidSet ? [...uuidSet] : null;

        const baseDateFilter = (q: any) => q
          .eq('organization_id', organizationId)
          .is('deleted_at', null)
          .gte('invoice_date', startDate)
          .lte('invoice_date', endDate + 'T23:59:59');

        const applySiteFilter = (q: any) =>
          siteArray && siteArray.length > 0 ? q.in('site_id', siteArray) : q;

        const countAll = async () => {
          let q = (supabase as any)
            .from('platform_integration_invoices')
            .select('*', { count: 'exact', head: true });
          q = applySiteFilter(baseDateFilter(q));
          const { count, error } = await q;
          if (error) console.warn('[COST-IMPACT] totalInvoiceCount error:', error.message);
          return count ?? 0;
        };

        const countPaid = async () => {
          let q = (supabase as any)
            .from('platform_integration_invoices')
            .select('*', { count: 'exact', head: true })
            .ilike('status', 'paid');
          q = applySiteFilter(baseDateFilter(q));
          const { count, error } = await q;
          if (error) console.warn('[COST-IMPACT] paidInvoiceCount error:', error.message);
          return count ?? 0;
        };

        const sumRevenue = async () => {
          let sum = 0;
          const absorb = (rows: Array<{ subtotal: unknown; patient_id: unknown }>) => {
            for (const r of rows) {
              const patId = r.patient_id;
              if (patId == null || patId === '' || patId === '0') continue;
              sum += parseFloat(String(r.subtotal ?? 0)) || 0;
            }
          };

          // Cursor-based on platform_invoice_id (still need it as a stable
          // sort key — id alone isn't always pagination-friendly).
          let lastId: number | string | null = null;
          while (true) {
            let q = (supabase as any)
              .from('platform_integration_invoices')
              .select('subtotal, patient_id, platform_invoice_id')
              .ilike('status', 'paid');
            q = applySiteFilter(baseDateFilter(q));
            q = q.order('platform_invoice_id', { ascending: true }).limit(PAGE_SIZE);
            if (lastId != null) q = q.gt('platform_invoice_id', lastId);
            const { data, error } = await q;
            if (error) {
              console.warn('[COST-IMPACT] invoiceRevenue error:', error.message);
              break;
            }
            const rows = (data ?? []) as Array<{
              subtotal: unknown; patient_id: unknown; platform_invoice_id: unknown;
            }>;
            if (rows.length === 0) break;
            absorb(rows);
            if (rows.length < PAGE_SIZE) break;
            const tail = rows[rows.length - 1].platform_invoice_id;
            lastId = tail != null ? Number(tail) : lastId;
          }

          return sum;
        };

        const [totalCount, paidCount, revenue] = await Promise.all([countAll(), countPaid(), sumRevenue()]);
        return { totalCount, paidCount, revenue };
      };

      // ── P&L bucket fetch — pair-based bucketing ──
      // Each row is attributed to a bucket only when the (legal_entity_id,
      // code/id) pair is allowed by SOME location's per-bucket scope. This
      // is what makes the All-view total equal to the sum of per-location
      // totals when locations have different account overrides.
      const esc = (v: string) => `"${v.replace(/"/g, '\\"')}"`;
      const buildOrFilter = (codeSet: Set<string>, idSet: Set<string>, codeCol: string, idCol: string) => {
        const parts: string[] = [];
        if (codeSet.size > 0) parts.push(`${codeCol}.in.(${[...codeSet].map(esc).join(',')})`);
        if (idSet.size > 0) parts.push(`${idCol}.in.(${[...idSet].map(esc).join(',')})`);
        return parts.join(',');
      };

      // Calendar-month aligned bounds, matching useLocationCostsImpact so the
      // Group Dashboard and this page reconcile for the same period.
      //
      // Iplicit, QuickBooks and Xero all store monthly P&L aggregates, dated
      // either at the period start (Iplicit `period_date`, QuickBooks
      // `from_date`) or the period end (Xero PL_SYNTHETIC invoices land on the
      // last day of the month). A sub-monthly range such as "1–15 July"
      // therefore matches no rows at all and renders every cost centre as £0.
      // Sage is the exception — those are real purchase invoices — so widening
      // pulls in whole months of spend rather than un-hiding an aggregate.
      //
      // Derived with string maths rather than `new Date('YYYY-MM-DD')` — that
      // parses as UTC midnight but reads back in local time, landing a month
      // early for users west of Greenwich.
      const calendarStart = startDate.slice(0, 8) + '01';
      const [endYear, endMonth] = endDate.split('-').map(Number);
      const lastDayOfEndMonth = new Date(Date.UTC(endYear, endMonth, 0)).getUTCDate();
      const calendarEnd = `${endDate.slice(0, 8)}${String(lastDayOfEndMonth).padStart(2, '0')}`;

      const fetchPLBucketsPairBased = async (): Promise<Record<BucketKey, number>> => {
        const totals = emptyBucketTotals();
        if (allCodesUnion.size === 0 && allIdsUnion.size === 0) return totals;

        // If NO scope produced any (entity, code) pair (ie. mappings missing
        // org-wide) we fall back to the legacy code-only bucketing path so
        // unmapped orgs aren't suddenly broken.
        const hasAnyPair =
          BUCKET_KEYS.some(b => entityCodePairs[b].size > 0 || entityIdPairs[b].size > 0);

        const orFilter = buildOrFilter(allCodesUnion, allIdsUnion, 'account_code', 'account_id');

        // Cursor-based pagination on `id` (primary key) — same reasoning
        // as the TPI/invoice/patient fetches above. Avoids the
        // `count: 'exact'` table scan that delayed first page-load.
        const buildIplicitQuery = (lastId: string | null) => {
          let query = (supabase as any)
            .from('iplicit_profit_loss')
            .select('id, amount, account_code, account_id, legal_entity_id')
            .eq('organization_id', organizationId)
            .gte('period_date', calendarStart)
            .lte('period_date', calendarEnd + 'T23:59:59')
            .or(orFilter)
            .order('id', { ascending: true })
            .limit(PAGE_SIZE);
          if (hasAnyPair && legalEntityIds.length === 1) {
            query = query.eq('legal_entity_id', legalEntityIds[0]);
          } else if (hasAnyPair && legalEntityIds.length > 1) {
            query = query.in('legal_entity_id', legalEntityIds);
          }
          if (lastId != null) query = query.gt('id', lastId);
          return query;
        };

        const buildXeroQuery = (lastId: string | null) => {
          let query = (supabase as any)
            .from('xero_invoice_line_items')
            .select(`
              id,
              line_amount,
              account_code,
              account_id,
              invoice:xero_invoices!inner(
                invoice_date,
                invoice_type,
                xero_tenant_id
              )
            `)
            .eq('organization_id', organizationId)
            .eq('invoice.invoice_type', 'PL_SYNTHETIC')
            .gte('invoice.invoice_date', calendarStart)
            .lte('invoice.invoice_date', calendarEnd + 'T23:59:59')
            .or(orFilter)
            .order('id', { ascending: true })
            .limit(PAGE_SIZE);
          if (hasAnyPair && legalEntityIds.length === 1) {
            query = query.eq('invoice.xero_tenant_id', legalEntityIds[0]);
          } else if (hasAnyPair && legalEntityIds.length > 1) {
            query = query.in('invoice.xero_tenant_id', legalEntityIds);
          }
          if (lastId != null) query = query.gt('id', lastId);
          return query;
        };

        // QuickBooks: quickbooks_profit_loss is one row per (account × month),
        // keyed by qb_account_id, scoped by realm_id (= platform_org_id, the
        // same entity identifier the mapping resolves to). Mirrors the
        // Iplicit monthly path. uuidToAccount exposes qb_account_id as both
        // code and id, so allCodesUnion ≡ allIdsUnion here — filter once on
        // qb_account_id.
        const qbAccountIds = new Set<string>([...allCodesUnion, ...allIdsUnion]);
        const buildQuickBooksQuery = (lastId: string | null) => {
          let query = (supabase as any)
            .from('quickbooks_profit_loss')
            .select('id, amount, qb_account_id, realm_id')
            .eq('organization_id', organizationId)
            .gte('from_date', calendarStart)
            .lte('from_date', calendarEnd)
            .in('qb_account_id', [...qbAccountIds])
            .order('id', { ascending: true })
            .limit(PAGE_SIZE);
          if (hasAnyPair && legalEntityIds.length === 1) {
            query = query.eq('realm_id', legalEntityIds[0]);
          } else if (hasAnyPair && legalEntityIds.length > 1) {
            query = query.in('realm_id', legalEntityIds);
          }
          if (lastId != null) query = query.gt('id', lastId);
          return query;
        };

        // Sage: real ACCPAY purchase-invoice line items (no synthetic rows —
        // Sage syncs the actual invoices via /purchase_invoices, so the line
        // items already carry account_code per spend bucket). Mirrors the
        // Xero query shape, but Sage has only ONE invoice_type (ACCPAY) so
        // no extra filter is needed. Entity scoping uses platform_integration_id
        // on the parent invoice — Sage is single-tenant per OAuth, so each
        // platform_integration_id maps to exactly one Sage business GUID.
        const buildSageQuery = (lastId: string | null) => {
          let query = (supabase as any)
            .from('sage_invoice_line_items')
            .select(`
              id,
              line_amount,
              account_code,
              invoice:sage_invoices!inner(
                invoice_date,
                platform_integration_id
              )
            `)
            .eq('organization_id', organizationId)
            .gte('invoice.invoice_date', calendarStart)
            .lte('invoice.invoice_date', calendarEnd + 'T23:59:59')
            .or(orFilter)
            .order('id', { ascending: true })
            .limit(PAGE_SIZE);
          if (lastId != null) query = query.gt('id', lastId);
          return query;
        };

        const buildQuery = isIplicit
          ? buildIplicitQuery
          : isQuickBooks
            ? buildQuickBooksQuery
            : isSage
              ? buildSageQuery
              : buildXeroQuery;
        const amountField = (isIplicit || isQuickBooks) ? 'amount' : 'line_amount';

        const allRows: any[] = [];
        let lastId: string | null = null;
        while (true) {
          const { data, error } = await buildQuery(lastId);
          if (error) {
            console.error('[COST-IMPACT] fetchPLBucketsPairBased error:', error);
            return totals;
          }
          const rows = (data ?? []) as any[];
          if (rows.length === 0) break;
          allRows.push(...rows);
          if (rows.length < PAGE_SIZE) break;
          const tail = rows[rows.length - 1].id;
          lastId = tail != null ? String(tail) : lastId;
        }

        for (const r of allRows as any[]) {
          const code = isQuickBooks
            ? (r.qb_account_id ? String(r.qb_account_id).trim() : '')
            : (r.account_code || '').trim();
          const id = isQuickBooks ? code : (r.account_id || '').trim();
          const entity = isIplicit
            ? (r.legal_entity_id ? String(r.legal_entity_id).trim() : '')
            : isQuickBooks
              ? (r.realm_id ? String(r.realm_id).trim() : '')
              : isSage
                // Sage rows expose the parent invoice's platform_integration_id;
                // map it to the Sage business GUID so scoping matches
                // locationToEntityIds (which collects platform_org_id).
                ? (r.invoice?.platform_integration_id
                    ? (sageIntegrationToBusinessId.get(r.invoice.platform_integration_id) || '')
                    : '')
                : (r.invoice?.xero_tenant_id ? String(r.invoice.xero_tenant_id).trim() : '');
          const amount = Number(r[amountField]) || 0;

          for (const bucket of BUCKET_KEYS) {
            let matched = false;
            if (entity && code && entityCodePairs[bucket].has(`${entity}|${code}`)) matched = true;
            else if (entity && id && entityIdPairs[bucket].has(`${entity}|${id}`)) matched = true;
            // Orphan fallback: codes/ids configured at a location with no
            // mapping. Match by code/id alone (legacy behavior preserved
            // for unmapped setups).
            else if (!matched && code && orphanedBucketCodes[bucket].has(code)) matched = true;
            else if (!matched && id && orphanedBucketIds[bucket].has(id)) matched = true;

            if (matched) totals[bucket] += amount;
          }
        }

        console.log('[COST-IMPACT] fetchPLBucketsPairBased:', {
          platform: isIplicit ? 'iplicit' : isQuickBooks ? 'quickbooks' : isSage ? 'sage' : 'xero',
          uniqueCodes: allCodesUnion.size,
          uniqueIds: allIdsUnion.size,
          totalEntities: legalEntityIds.length,
          pairCounts: Object.fromEntries(BUCKET_KEYS.map(b => [b, entityCodePairs[b].size + entityIdPairs[b].size])),
          totalRows: allRows.length,
          totals: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, `£${v.toFixed(2)}`])),
        });

        return totals;
      };

      // Fan out the heaviest fetches together
      const [
        invoiceIds,
        patientIdsAtLocation,
        allTpis,
        invoiceStats,
        plTotals,
      ] = await Promise.all([
        fetchInvoiceIds(),
        fetchPatientIds(),
        fetchAllTpis(),
        fetchInvoiceStats(),
        hasAnyAccounts ? fetchPLBucketsPairBased() : Promise.resolve(emptyBucketTotals()),
      ]);

      const targetInvoiceSet = selectedLocationId ? invoiceIds.atLocation : invoiceIds.allPaid;

      // ── Process TPIs to compute revenue + treatment-derived costs ──
      const seenTpiIds = new Set<string>();
      const seenFingerprints = new Set<string>();
      let totalRevenue = 0;
      let treatmentLabFees = 0;
      let treatmentStaffCosts = 0;
      let treatmentOpCosts = 0;
      let treatmentMaterialCosts = 0;
      let treatmentFinanceFees = 0;

      for (const item of allTpis) {
        const tpiId = item.tpi_id != null ? String(item.tpi_id) : null;
        if (tpiId) {
          if (seenTpiIds.has(tpiId)) continue;
          seenTpiIds.add(tpiId);
        } else {
          const dateStr = item.tpi_completed_at ? item.tpi_completed_at.substring(0, 10) : '';
          const fp = `${item.tpi_patient_id}|${dateStr}|${item.tpi_treatment_id}|${item.tpi_price}|${item.tpi_invoice_id ?? ''}`;
          if (seenFingerprints.has(fp)) continue;
          seenFingerprints.add(fp);
        }

        const price = parseFloat(item.tpi_price || 0);
        const invId = item.tpi_invoice_id != null ? Number(item.tpi_invoice_id) : null;
        const hasInvId = invId !== null && !isNaN(invId) && invId !== 0;
        const patId = item.tpi_patient_id != null ? Number(item.tpi_patient_id) : null;

        if (hasInvId && targetInvoiceSet.has(invId)) {
          // Paid — include
        } else if (price === 0) {
          if (selectedLocationId) {
            let atLocation = false;
            const tpiLocId = item.location_id ? String(item.location_id) : null;
            if (tpiLocId === selectedLocationId) atLocation = true;
            if (!atLocation && patId && patientIdsAtLocation?.has(patId)) atLocation = true;
            if (!atLocation) continue;
          }
        } else {
          continue; // Unpaid priced item
        }

        totalRevenue += price;

        const costs = extIdToCosts.get(item.tpi_treatment_id);
        if (costs) {
          const avgIncome = price;
          treatmentLabFees += costs.lab_bill;
          treatmentMaterialCosts += costs.material_cost;
          treatmentStaffCosts += costs.therapist_pay_rate + (avgIncome * costs.percent_fees / 100);
          treatmentOpCosts += costs.hourly_rate * (costs.duration_minutes / 60);
          treatmentFinanceFees += avgIncome * (costs.finance_fee / 100);
        }
      }

      const treatmentTotalExpense = treatmentLabFees + treatmentMaterialCosts + treatmentStaffCosts + treatmentOpCosts + treatmentFinanceFees;
      const { totalCount: totalInvoiceCount, paidCount: paidInvoiceCount, revenue: invoiceRevenue } = invoiceStats;

      console.log('[COST-IMPACT] Invoice-based revenue:', `£${invoiceRevenue.toFixed(2)}`, '| TPI-based revenue:', `£${totalRevenue.toFixed(2)}`);
      console.log('[COST-IMPACT] Accounting platform:', accountingPlatform?.platform_name || 'none', '| isIplicit:', isIplicit);

      // ── PL → cost buckets, with GL-entries fallback when P&L is empty ──
      let labFeesCost = 0;
      let staffCostsCost = 0;
      let operatingLeasesCost = 0;
      let clinicianCostCost = 0;
      let overheadCostCost = 0;
      let materialCostCost = 0;
      let marketingCostCost = 0;
      let hasGLData = false;
      let dataSource = 'Treatment Setup (fallback)';

      if (hasAnyAccounts) {
        const labPL = plTotals.lab;
        const staffPL = plTotals.staff;
        const leasePL = plTotals.lease;
        const clinicianPL = plTotals.clinician;
        const overheadPL = plTotals.overhead;
        const materialPL = plTotals.material;
        const marketingPL = plTotals.marketing;

        const hasPLData = labPL !== 0 || staffPL !== 0 || leasePL !== 0 || clinicianPL !== 0 || overheadPL !== 0 || materialPL !== 0 || marketingPL !== 0;

        if (hasPLData) {
          labFeesCost = Math.abs(labPL);
          staffCostsCost = Math.abs(staffPL);
          operatingLeasesCost = Math.abs(leasePL);
          clinicianCostCost = Math.abs(clinicianPL);
          overheadCostCost = Math.abs(overheadPL);
          materialCostCost = Math.abs(materialPL);
          marketingCostCost = Math.abs(marketingPL);
          hasGLData = true;
          dataSource = isIplicit
            ? 'Iplicit P&L'
            : isQuickBooks
              ? 'QuickBooks P&L'
              : isSage
                ? 'Sage Invoice Line Items'
                : 'Xero Invoice Line Items';
        } else {
          const [labGL, staffGL, leaseGL, clinicianGL, overheadGL, materialGL, marketingGL] = await Promise.all([
            fetchGLEntries(organizationId, { fromDate: startDate, toDate: endDate, accountCodes: labFiltersForLog.codes, accountUuids: orgLabUuids }),
            fetchGLEntries(organizationId, { fromDate: startDate, toDate: endDate, accountCodes: staffFiltersForLog.codes, accountUuids: orgStaffUuids }),
            fetchGLEntries(organizationId, { fromDate: startDate, toDate: endDate, accountCodes: leaseFiltersForLog.codes, accountUuids: orgLeaseUuids }),
            fetchGLEntries(organizationId, { fromDate: startDate, toDate: endDate, accountCodes: clinicianFiltersForLog.codes, accountUuids: orgClinicianUuids }),
            fetchGLEntries(organizationId, { fromDate: startDate, toDate: endDate, accountCodes: overheadFiltersForLog.codes, accountUuids: orgOverheadUuids }),
            fetchGLEntries(organizationId, { fromDate: startDate, toDate: endDate, accountCodes: materialFiltersForLog.codes, accountUuids: orgMaterialUuids }),
            fetchGLEntries(organizationId, { fromDate: startDate, toDate: endDate, accountCodes: marketingFiltersForLog.codes, accountUuids: orgMarketingUuids }),
          ]);

          if ((labGL.success && labGL.entries.length > 0) ||
              (staffGL.success && staffGL.entries.length > 0) ||
              (leaseGL.success && leaseGL.entries.length > 0) ||
              (clinicianGL.success && clinicianGL.entries.length > 0) ||
              (overheadGL.success && overheadGL.entries.length > 0) ||
              (materialGL.success && materialGL.entries.length > 0) ||
              (marketingGL.success && marketingGL.entries.length > 0)) {
            labFeesCost = Math.abs(labGL.totalAmount);
            staffCostsCost = Math.abs(staffGL.totalAmount);
            operatingLeasesCost = Math.abs(leaseGL.totalAmount);
            clinicianCostCost = Math.abs(clinicianGL.totalAmount);
            overheadCostCost = Math.abs(overheadGL.totalAmount);
            materialCostCost = Math.abs(materialGL.totalAmount);
            marketingCostCost = Math.abs(marketingGL.totalAmount);
            hasGLData = true;
            dataSource = 'Iplicit GL Entries';
          }
        }
      }

      const totalCosts = labFeesCost + staffCostsCost + operatingLeasesCost + clinicianCostCost + overheadCostCost + materialCostCost + marketingCostCost;
      const revenueForEbitda = invoiceRevenue > 0 ? invoiceRevenue : totalRevenue;
      const ebitda = revenueForEbitda - totalCosts;

      console.log('[COST-IMPACT]', {
        source: dataSource,
        dateRange: `${startDate} to ${endDate}`,
        revenueSource: invoiceRevenue > 0 ? 'Invoice subtotals' : 'TPI prices (fallback)',
        totalRevenue: `£${revenueForEbitda.toFixed(2)}`,
        labFeesCost: `£${labFeesCost.toFixed(2)}`,
        staffCostsCost: `£${staffCostsCost.toFixed(2)}`,
        operatingLeasesCost: `£${operatingLeasesCost.toFixed(2)}`,
        totalCosts: `£${totalCosts.toFixed(2)}`,
        ebitda: `£${ebitda.toFixed(2)}`,
      });

      return {
        totalRevenue: revenueForEbitda,
        labFeesCost,
        staffCostsCost,
        operatingLeasesCost,
        clinicianCostCost,
        overheadCostCost,
        materialCostCost,
        marketingCostCost,
        totalCosts,
        ebitda,
        treatmentLabFees,
        treatmentStaffCosts,
        treatmentOpCosts,
        treatmentMaterialCosts,
        treatmentFinanceFees,
        treatmentTotalExpense,
        paidInvoiceCount,
        totalInvoiceCount,
        invoiceRevenue,
        hasGLData,
        platform: isIplicit ? 'iplicit' : isQuickBooks ? 'quickbooks' : isSage ? 'sage' : 'xero',
      };
    },
    enabled: !!organizationId && !expenseSettings.isLoading,
  });
}

function emptyResult(): CostImpactData {
  return {
    totalRevenue: 0,
    labFeesCost: 0,
    staffCostsCost: 0,
    operatingLeasesCost: 0,
    clinicianCostCost: 0,
    overheadCostCost: 0,
    materialCostCost: 0,
    marketingCostCost: 0,
    totalCosts: 0,
    ebitda: 0,
    treatmentLabFees: 0,
    treatmentStaffCosts: 0,
    treatmentOpCosts: 0,
    treatmentMaterialCosts: 0,
    treatmentFinanceFees: 0,
    treatmentTotalExpense: 0,
    paidInvoiceCount: 0,
    totalInvoiceCount: 0,
    invoiceRevenue: 0,
    hasGLData: false,
    platform: 'xero',
  };
}
