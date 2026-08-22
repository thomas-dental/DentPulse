import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { ProviderCostAccountPlatform } from '@/types/provider';

export interface LocationAccountOption {
  id: string;
  account_code: string;
  account_name: string;
  account_type: string | null;
  platform: ProviderCostAccountPlatform;
  connectionName: string;
  tenantId: string | null;
}

// Fresh, self-contained implementation of the Chart-of-Accounts
// fetch-and-scope-to-location pattern already used by
// LocationDetailContent.tsx's Rules tab — written separately (not extracted
// from it) so that already-shipped feature is never touched by this work.
export function useLocationChartOfAccounts(locationId: string | null | undefined, organizationId: string | null | undefined) {
  const { data: rawAccounts = [], isLoading: isLoadingAccounts } = useQuery({
    queryKey: ['location-coa-picker', organizationId],
    queryFn: async () => {
      if (!organizationId) return [];

      const [xeroRes, iplicitRes, qbRes, sageRes] = await Promise.all([
        (supabase as any)
          .from('xero_chart_of_accounts')
          .select('id, account_code, account_name, account_type, is_active, xero_tenant_id')
          .eq('organization_id', organizationId),
        (supabase as any)
          .from('iplicit_chart_of_accounts')
          .select('id, code, name, description, account_type, is_active, xero_tenant_id')
          .eq('organization_id', organizationId),
        (supabase as any)
          .from('quickbooks_chart_of_accounts')
          .select('id, account_number, account_name, account_type, is_active, realm_id')
          .eq('organization_id', organizationId),
        (supabase as any)
          .from('sage_chart_of_accounts')
          .select('id, account_code, account_name, account_type, is_active, platform_integration_id')
          .eq('organization_id', organizationId),
      ]);

      const { data: tenantRows } = await (supabase as any)
        .from('platform_integration_organizations')
        .select('id, platform_org_id, platform_org_name, platform_name, platform_integration_id')
        .eq('organization_id', organizationId);
      const tenantUuidToGuid = new Map<string, string>();
      const sageIntegrationToBusinessId = new Map<string, string>();
      for (const r of (tenantRows ?? []) as any[]) {
        if (r.id && r.platform_org_id) tenantUuidToGuid.set(r.id, r.platform_org_id);
        if (r.platform_name === 'sage' && r.platform_integration_id && r.platform_org_id) {
          sageIntegrationToBusinessId.set(r.platform_integration_id, r.platform_org_id);
        }
      }

      const accounts: LocationAccountOption[] = [];

      for (const row of (xeroRes?.data ?? []) as any[]) {
        if (row.is_active === false) continue;
        accounts.push({
          id: row.id,
          account_code: row.account_code || '',
          account_name: row.account_name || '',
          account_type: row.account_type || null,
          platform: 'xero',
          connectionName: 'Xero',
          tenantId: tenantUuidToGuid.get(row.xero_tenant_id) || row.xero_tenant_id || null,
        });
      }
      for (const row of (iplicitRes?.data ?? []) as any[]) {
        if (row.is_active === false) continue;
        accounts.push({
          id: row.id,
          account_code: row.code || '',
          account_name: row.name || row.description || '',
          account_type: row.account_type || null,
          platform: 'iplicit',
          connectionName: 'Iplicit',
          tenantId: tenantUuidToGuid.get(row.xero_tenant_id) || row.xero_tenant_id || null,
        });
      }
      for (const row of (qbRes?.data ?? []) as any[]) {
        if (row.is_active === false) continue;
        accounts.push({
          id: row.id,
          account_code: row.account_number || '',
          account_name: row.account_name || '',
          account_type: row.account_type || null,
          platform: 'quickbooks',
          connectionName: 'QuickBooks',
          tenantId: row.realm_id || null,
        });
      }
      for (const row of (sageRes?.data ?? []) as any[]) {
        if (row.is_active === false) continue;
        accounts.push({
          id: row.id,
          account_code: row.account_code || '',
          account_name: row.account_name || '',
          account_type: row.account_type || null,
          platform: 'sage',
          connectionName: 'Sage',
          tenantId: row.platform_integration_id ? (sageIntegrationToBusinessId.get(row.platform_integration_id) || null) : null,
        });
      }

      return accounts;
    },
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000,
  });

  const [locationTenantIds, setLocationTenantIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    let cancelled = false;
    const resolve = async () => {
      if (!locationId) {
        setLocationTenantIds(new Set());
        return;
      }
      const { data: mappingRows } = await (supabase as any)
        .from('platform_integration_organization_mapping')
        .select('platform_integration_organizations_id')
        .eq('location_id', locationId);
      if (cancelled) return;
      const internalIds = Array.from(new Set(
        (mappingRows ?? []).map((r: any) => r.platform_integration_organizations_id).filter(Boolean),
      ));
      if (internalIds.length === 0) {
        setLocationTenantIds(new Set());
        return;
      }
      const { data: orgRows } = await (supabase as any)
        .from('platform_integration_organizations')
        .select('platform_org_id')
        .in('id', internalIds);
      if (cancelled) return;
      const tenants = new Set<string>();
      for (const o of (orgRows ?? []) as Array<{ platform_org_id: string | null }>) {
        if (o.platform_org_id) tenants.add(o.platform_org_id);
      }
      setLocationTenantIds(tenants);
    };
    resolve();
    return () => {
      cancelled = true;
    };
  }, [locationId]);

  const availableAccounts: LocationAccountOption[] = locationTenantIds.size === 0
    ? []
    : rawAccounts.filter((a) => a.tenantId && locationTenantIds.has(a.tenantId));

  return { availableAccounts, isLoading: isLoadingAccounts };
}
