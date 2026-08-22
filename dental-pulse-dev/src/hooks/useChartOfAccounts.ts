import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from './useOrganization';

export interface ChartOfAccount {
  id: string;
  organization_id: string;
  platform_integration_id: string | null;
  /** External tenant id (Xero tenant UUID, Iplicit legal entity, etc.) */
  platform_integration_organization_id?: string | null;
  coa_account_id: string;
  coa_account_code: string;
  coa_account_name: string;
  coa_account_type: string;
  coa_is_active: boolean;
  coa_is_ar_account?: boolean;
  coa_is_ap_account?: boolean;
  created_at: string;
  updated_at: string;
}

type FinanceSourceRow = {
  id: string;
  platform_integration_id: string | null;
};

type FinanceAccountRow = {
  id: string;
  source_id: string;
  canonical_account_code: string;
  account_name: string;
  account_type: string | null;
  is_active: boolean;
  attributes_json?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

type TenantOrgRow = {
  id: string;
  platform_org_id: string | null;
  platform_integration_id: string | null;
  platform_name: string | null;
};

function matchesIntegration(
  accountIntegrationId: string | null | undefined,
  platformIntegrationId: string | null | undefined
): boolean {
  if (platformIntegrationId === undefined) return true;
  if (platformIntegrationId === null) return accountIntegrationId == null;
  return accountIntegrationId === platformIntegrationId;
}

function matchesTenant(
  accountTenantId: string | null | undefined,
  tenantOrgIds: string[]
): boolean {
  if (!tenantOrgIds.length) return true;
  return !!accountTenantId && tenantOrgIds.includes(accountTenantId);
}

async function fetchTenantScopedChartOfAccounts(
  organizationId: string,
  platformIntegrationId: string | null | undefined,
  tenantOrgIds: string[],
  includeInactive = false
): Promise<ChartOfAccount[]> {
  const tenantFilter = tenantOrgIds.length > 0 ? tenantOrgIds : null;

  let xeroQ = supabase
    .from('xero_chart_of_accounts' as any)
    .select('*')
    .eq('organization_id', organizationId)
    .order('account_type', { ascending: true })
    .order('account_code', { ascending: true });
  let iplicitQ = supabase
    .from('iplicit_chart_of_accounts' as any)
    .select('*')
    .eq('organization_id', organizationId)
    .order('account_type', { ascending: true })
    .order('code', { ascending: true });
  let qbQ = supabase
    .from('quickbooks_chart_of_accounts' as any)
    .select('*')
    .eq('organization_id', organizationId)
    .order('account_type', { ascending: true })
    .order('account_number', { ascending: true });
  let sageQ = supabase
    .from('sage_chart_of_accounts' as any)
    .select('*')
    .eq('organization_id', organizationId)
    .order('account_type', { ascending: true })
    .order('account_code', { ascending: true });
  let legacyQ = supabase
    .from('platform_integration_chart_of_accounts' as any)
    .select('*')
    .eq('organization_id', organizationId);

  if (!includeInactive) {
    xeroQ = xeroQ.eq('is_active', true);
    iplicitQ = iplicitQ.eq('is_active', true);
    qbQ = qbQ.eq('is_active', true);
    sageQ = sageQ.eq('is_active', true);
    legacyQ = legacyQ.eq('coa_is_active', true);
  }

  const [xeroRes, iplicitRes, qbRes, sageRes, legacyRes, orgsRes] = await Promise.all([
    xeroQ,
    iplicitQ,
    qbQ,
    sageQ,
    legacyQ,
    supabase
      .from('platform_integration_organizations' as any)
      .select('id, platform_org_id, platform_integration_id, platform_name')
      .eq('organization_id', organizationId),
  ]);

  const tenantUuidToGuid = new Map<string, string>();
  const sageIntegrationToBusinessId = new Map<string, string>();
  for (const row of (orgsRes.data || []) as TenantOrgRow[]) {
    if (row.id && row.platform_org_id) tenantUuidToGuid.set(row.id, row.platform_org_id);
    if (row.platform_name?.toLowerCase() === 'sage' && row.platform_integration_id && row.platform_org_id) {
      sageIntegrationToBusinessId.set(row.platform_integration_id, row.platform_org_id);
    }
  }

  const mapped: ChartOfAccount[] = [];
  const now = new Date().toISOString();

  const pushIfScoped = (account: ChartOfAccount) => {
    if (!matchesIntegration(account.platform_integration_id, platformIntegrationId)) return;
    if (!matchesTenant(account.platform_integration_organization_id, tenantFilter ?? [])) return;
    mapped.push(account);
  };

  for (const acc of (xeroRes.data || []) as any[]) {
    pushIfScoped({
      id: String(acc.id),
      organization_id: organizationId,
      platform_integration_id: acc.platform_integration_id ?? null,
      platform_integration_organization_id:
        tenantUuidToGuid.get(acc.xero_tenant_id) || acc.platform_integration_organization_id || acc.xero_tenant_id || null,
      coa_account_id: String(acc.xero_account_id || acc.id || ''),
      coa_account_code: String(acc.account_code || ''),
      coa_account_name: String(acc.account_name || ''),
      coa_account_type: String(acc.account_type || 'OTHER'),
      coa_is_active: acc.is_active !== false,
      created_at: acc.created_at || now,
      updated_at: acc.updated_at || now,
    });
  }

  for (const acc of (iplicitRes.data || []) as any[]) {
    pushIfScoped({
      id: String(acc.id),
      organization_id: organizationId,
      platform_integration_id: acc.platform_integration_id ?? null,
      platform_integration_organization_id: acc.legal_entity_id || acc.platform_integration_organization_id || null,
      coa_account_id: String(acc.account_id || acc.id || ''),
      coa_account_code: String(acc.code || ''),
      coa_account_name: String(acc.name || acc.description || ''),
      coa_account_type: String(acc.account_type || 'OTHER'),
      coa_is_active: acc.is_active !== false,
      created_at: acc.created_at || now,
      updated_at: acc.updated_at || now,
    });
  }

  for (const acc of (qbRes.data || []) as any[]) {
    pushIfScoped({
      id: String(acc.id),
      organization_id: organizationId,
      platform_integration_id: acc.platform_integration_id ?? null,
      platform_integration_organization_id: acc.realm_id || acc.platform_integration_organization_id || null,
      coa_account_id: String(acc.qb_account_id || acc.id || ''),
      coa_account_code: String(acc.account_number || ''),
      coa_account_name: String(acc.account_name || ''),
      coa_account_type: String(acc.account_type || 'OTHER'),
      coa_is_active: acc.is_active !== false,
      created_at: acc.created_at || now,
      updated_at: acc.updated_at || now,
    });
  }

  for (const acc of (sageRes.data || []) as any[]) {
    pushIfScoped({
      id: String(acc.id),
      organization_id: organizationId,
      platform_integration_id: acc.platform_integration_id ?? null,
      platform_integration_organization_id:
        sageIntegrationToBusinessId.get(acc.platform_integration_id) || acc.platform_integration_organization_id || null,
      coa_account_id: String(acc.sage_account_id || acc.id || ''),
      coa_account_code: String(acc.account_code || ''),
      coa_account_name: String(acc.account_name || ''),
      coa_account_type: String(acc.account_type || 'OTHER'),
      coa_is_active: acc.is_active !== false,
      created_at: acc.created_at || now,
      updated_at: acc.updated_at || now,
    });
  }

  for (const acc of (legacyRes.data || []) as any[]) {
    pushIfScoped({
      id: String(acc.id),
      organization_id: organizationId,
      platform_integration_id: acc.platform_integration_id ?? null,
      platform_integration_organization_id: acc.platform_integration_organization_id ?? null,
      coa_account_id: String(acc.coa_account_id || acc.id || ''),
      coa_account_code: String(acc.coa_account_code || ''),
      coa_account_name: String(acc.coa_account_name || ''),
      coa_account_type: String(acc.coa_account_type || 'OTHER'),
      coa_is_active: acc.coa_is_active !== false,
      created_at: acc.created_at || now,
      updated_at: acc.updated_at || now,
    });
  }

  return mapped
    .filter(
      (account, index, self) =>
        index ===
        self.findIndex(
          (x) =>
            x.platform_integration_id === account.platform_integration_id &&
            x.coa_account_id === account.coa_account_id
        )
    )
    .sort((a, b) => {
      const t = (a.coa_account_type || '').localeCompare(b.coa_account_type || '');
      if (t !== 0) return t;
      return (a.coa_account_code || '').localeCompare(b.coa_account_code || '');
    });
}

export function useChartOfAccounts(
  platformIntegrationId?: string | null,
  useCanonicalFirst: boolean = false,
  tenantOrgIds?: string[] | null,
  /** Setup Categories needs archived COA so historical P&L accounts can still be mapped. */
  includeInactive: boolean = false
) {
  const { organizationId } = useOrganization();
  // null = org-wide; array (possibly empty) = location-scoped fetch from platform COA tables
  const isLocationScoped = tenantOrgIds != null;
  const normalizedTenantOrgIds = isLocationScoped ? [...tenantOrgIds].sort() : null;

  const {
    data: accounts,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: [
      'chart-of-accounts',
      organizationId,
      platformIntegrationId,
      useCanonicalFirst,
      normalizedTenantOrgIds,
      includeInactive ? 'with-inactive' : 'active-only',
    ],
    queryFn: async () => {
      if (!organizationId) return [];

      if (isLocationScoped) {
        if (!platformIntegrationId && normalizedTenantOrgIds!.length === 0) return [];
        return fetchTenantScopedChartOfAccounts(
          organizationId,
          platformIntegrationId,
          normalizedTenantOrgIds!,
          includeInactive
        );
      }

      if (useCanonicalFirst) {
        let sourceQuery = supabase
          .from('finance_data_sources' as any)
          .select('id, platform_integration_id')
          .eq('organization_id', organizationId)
          .eq('is_active', true);

        if (platformIntegrationId === null) {
          sourceQuery = sourceQuery.is('platform_integration_id', null);
        } else if (platformIntegrationId !== undefined) {
          sourceQuery = sourceQuery.eq('platform_integration_id', platformIntegrationId);
        } else {
          sourceQuery = sourceQuery.not('platform_integration_id', 'is', null);
        }

        const { data: sourceRows, error: sourceErr } = await sourceQuery;
        if (sourceErr) throw sourceErr;

        const sources = (sourceRows || []) as unknown as FinanceSourceRow[];
        const sourceIds = sources.map((s) => s.id).filter(Boolean);

        if (sourceIds.length > 0) {
          const sourceById = new Map<string, FinanceSourceRow>();
          sources.forEach((s) => sourceById.set(s.id, s));

          const canonicalRows: FinanceAccountRow[] = [];
          const chunkSize = 200;
          for (let i = 0; i < sourceIds.length; i += chunkSize) {
            const idChunk = sourceIds.slice(i, i + chunkSize);
            let accountQuery = supabase
              .from('finance_accounts' as any)
              .select('id, source_id, canonical_account_code, account_name, account_type, is_active, attributes_json, created_at, updated_at')
              .eq('organization_id', organizationId)
              .in('source_id', idChunk);
            if (!includeInactive) {
              accountQuery = accountQuery.eq('is_active', true);
            }
            const { data: accountChunk, error: accountErr } = await accountQuery;
            if (accountErr) throw accountErr;
            canonicalRows.push(...((accountChunk || []) as unknown as FinanceAccountRow[]));
          }

          if (canonicalRows.length > 0) {
            const mapped = canonicalRows.map((a) => {
              const attrs = (a.attributes_json || {}) as Record<string, unknown>;
              const src = sourceById.get(a.source_id);
              return {
                id: a.id,
                organization_id: organizationId,
                platform_integration_id: src?.platform_integration_id ?? null,
                platform_integration_organization_id: null,
                coa_account_id: String(a.canonical_account_code || ''),
                coa_account_code: String(attrs.coa_account_code ?? a.canonical_account_code ?? ''),
                coa_account_name: String(a.account_name || ''),
                coa_account_type: String(a.account_type || 'OTHER'),
                coa_is_active: Boolean(a.is_active),
                coa_is_ar_account: Boolean(attrs.coa_is_ar_account),
                coa_is_ap_account: Boolean(attrs.coa_is_ap_account),
                created_at: a.created_at,
                updated_at: a.updated_at,
              } as ChartOfAccount;
            });

            const uniqueCanonical = mapped.filter(
              (account, index, self) =>
                index ===
                self.findIndex(
                  (x) =>
                    x.platform_integration_id === account.platform_integration_id &&
                    x.coa_account_id === account.coa_account_id
                )
            );

            return uniqueCanonical.sort((a, b) => {
              const t = (a.coa_account_type || '').localeCompare(b.coa_account_type || '');
              if (t !== 0) return t;
              return (a.coa_account_code || '').localeCompare(b.coa_account_code || '');
            });
          }
        }
      }

      let query = supabase
        .from('platform_integration_chart_of_accounts' as any)
        .select('*')
        .eq('organization_id', organizationId);
      if (!includeInactive) {
        query = query.eq('coa_is_active', true);
      }

      if (platformIntegrationId === null) {
        query = query.is('platform_integration_id', null);
      } else if (platformIntegrationId !== undefined) {
        query = query.eq('platform_integration_id', platformIntegrationId);
      }

      if (normalizedTenantOrgIds) {
        query = query.in('platform_integration_organization_id', normalizedTenantOrgIds);
      }

      const { data, error } = await query.order('coa_account_type', { ascending: true }).order('coa_account_code', { ascending: true });

      if (error) throw error;

      // Remove duplicates based on account code and name
      const uniqueAccounts = ((data || []) as unknown as ChartOfAccount[]).filter(
        (account, index, self) =>
          index ===
          self.findIndex(
            (a) =>
              a.coa_account_code === account.coa_account_code &&
              a.coa_account_name === account.coa_account_name
          )
      );

      return uniqueAccounts;
    },
    enabled: !!organizationId,
  });

  return {
    accounts: accounts || [],
    isLoading,
    error,
    refetch,
  };
}
