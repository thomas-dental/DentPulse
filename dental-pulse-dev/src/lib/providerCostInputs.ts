import { supabase } from '@/integrations/supabase/client';
import type { ProviderCostAccountPlatform, ProviderCostSourceMethod } from '@/types/provider';
import type { CostSlidingScaleBand } from './providerCostResolution';

export interface ProviderCostInputRow {
  id: string;
  location_id: string | null;
  lab_cost_source_method: ProviderCostSourceMethod | null;
  lab_cost_percentage: number | null;
  lab_cost_account_id: string | null;
  lab_cost_account_platform: ProviderCostAccountPlatform | null;
  material_cost_source_method: ProviderCostSourceMethod | null;
  material_cost_percentage: number | null;
  material_cost_account_id: string | null;
  material_cost_account_platform: ProviderCostAccountPlatform | null;
}

export interface LocationCostGate {
  associate_cost_lab_source: string | null;
  associate_cost_labs_percent: number | null;
  material_cost_source: string | null;
  practice_cost_materials_percent: number | null;
  is_associate_pay_including_lab_cost: boolean | null;
  is_associate_pay_including_material_cost: boolean | null;
}

export interface ProviderCostInputsResult {
  locationGateByLocationId: Map<string, LocationCostGate>;
  accountAmountByProviderId: Map<string, { lab: number | null; material: number | null }>;
  monthlyValuesByProviderId: Map<string, { lab: number[]; material: number[] }>;
  monthlyBillByLocationId: Map<string, { lab: number[]; material: number[] }>;
  bandsByProviderId: Map<string, { lab: CostSlidingScaleBand[]; material: CostSlidingScaleBand[] }>;
}

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function monthKey(y: number, m: number): string {
  return `${y}-${String(m).padStart(2, '0')}`;
}

// Calendar months overlapping [dateFrom, dateTo], inclusive of any partial
// month at either end — matches the "whole calendar months, never prorated"
// convention already used elsewhere in this codebase (LocationDetailContent,
// useLocationCostsImpact) for expanding a sub-monthly range to month bounds.
function monthsInRange(dateFrom: Date, dateTo: Date): Array<{ key: string; year: number; month: number }> {
  const months: Array<{ key: string; year: number; month: number }> = [];
  let y = dateFrom.getFullYear();
  let m = dateFrom.getMonth() + 1;
  const endY = dateTo.getFullYear();
  const endM = dateTo.getMonth() + 1;
  while (y < endY || (y === endY && m <= endM)) {
    months.push({ key: monthKey(y, m), year: y, month: m });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return months;
}

function calendarBounds(dateFrom: Date, dateTo: Date): { start: string; end: string } {
  const start = `${dateFrom.getFullYear()}-${String(dateFrom.getMonth() + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(dateTo.getFullYear(), dateTo.getMonth() + 1, 0).getDate();
  const end = `${dateTo.getFullYear()}-${String(dateTo.getMonth() + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { start, end };
}

// Resolves the tenant/legal-entity/business GUIDs mapped to a location, the
// same mechanism LocationDetailContent uses to scope its Chart of Accounts.
async function resolveLocationTenants(locationId: string): Promise<string[]> {
  const { data: mappingRows } = await (supabase as any)
    .from('platform_integration_organization_mapping')
    .select('platform_integration_organizations_id')
    .eq('location_id', locationId);
  const internalIds = Array.from(new Set(
    (mappingRows ?? []).map((r: any) => r.platform_integration_organizations_id).filter(Boolean),
  ));
  if (internalIds.length === 0) return [];
  const { data: orgRows } = await (supabase as any)
    .from('platform_integration_organizations')
    .select('id, platform_org_id')
    .in('id', internalIds);
  const tenants = new Set<string>();
  for (const o of (orgRows ?? []) as Array<{ id: string; platform_org_id: string | null }>) {
    if (o.platform_org_id) tenants.add(o.platform_org_id);
  }
  return Array.from(tenants);
}

interface AccountRef {
  code: string;
  nativeId: string;
}

async function resolveAccountRef(
  organizationId: string,
  platform: ProviderCostAccountPlatform,
  accountId: string,
): Promise<AccountRef | null> {
  if (platform === 'iplicit') {
    const { data } = await (supabase as any)
      .from('iplicit_chart_of_accounts')
      .select('code, account_id')
      .eq('organization_id', organizationId)
      .eq('id', accountId)
      .maybeSingle();
    if (!data) return null;
    return { code: (data.code || '').trim(), nativeId: (data.account_id || '').trim() };
  }
  if (platform === 'xero') {
    const { data } = await (supabase as any)
      .from('xero_chart_of_accounts')
      .select('account_code, xero_account_id')
      .eq('organization_id', organizationId)
      .eq('id', accountId)
      .maybeSingle();
    if (!data) return null;
    return { code: (data.account_code || '').trim(), nativeId: (data.xero_account_id || '').trim() };
  }
  if (platform === 'quickbooks') {
    const { data } = await (supabase as any)
      .from('quickbooks_chart_of_accounts')
      .select('qb_account_id')
      .eq('organization_id', organizationId)
      .eq('id', accountId)
      .maybeSingle();
    if (!data) return null;
    const qbId = (data.qb_account_id || '').trim();
    return { code: qbId, nativeId: qbId };
  }
  // sage
  const { data } = await (supabase as any)
    .from('sage_chart_of_accounts')
    .select('account_code, sage_account_id')
    .eq('organization_id', organizationId)
    .eq('id', accountId)
    .maybeSingle();
  if (!data) return null;
  return { code: (data.account_code || '').trim(), nativeId: (data.sage_account_id || '').trim() };
}

// Absolute £ for one specific account, over the month-expanded date range —
// no proration, matching plCostService's getOpCostByPlatform convention.
async function fetchAccountAmount(
  organizationId: string,
  platform: ProviderCostAccountPlatform,
  ref: AccountRef,
  tenantIds: string[],
  dateFrom: Date,
  dateTo: Date,
): Promise<number> {
  const { start, end } = calendarBounds(dateFrom, dateTo);
  let total = 0;

  if (platform === 'iplicit') {
    let q = (supabase as any)
      .from('iplicit_profit_loss')
      .select('amount, legal_entity_id')
      .eq('organization_id', organizationId)
      .eq('account_code', ref.code)
      .gte('period_date', start)
      .lte('period_date', end + 'T23:59:59');
    if (tenantIds.length === 1) q = q.eq('legal_entity_id', tenantIds[0]);
    else if (tenantIds.length > 1) q = q.in('legal_entity_id', tenantIds);
    const { data } = await q;
    for (const r of (data ?? []) as Array<{ amount: unknown }>) total += Math.abs(Number(r.amount) || 0);
  } else if (platform === 'xero') {
    let q = (supabase as any)
      .from('xero_invoice_line_items')
      .select('line_amount, invoice:xero_invoices!inner(invoice_date, invoice_type, xero_tenant_id)')
      .eq('organization_id', organizationId)
      .eq('account_code', ref.code)
      .eq('invoice.invoice_type', 'PL_SYNTHETIC')
      .gte('invoice.invoice_date', start)
      .lte('invoice.invoice_date', end + 'T23:59:59');
    if (tenantIds.length === 1) q = q.eq('invoice.xero_tenant_id', tenantIds[0]);
    else if (tenantIds.length > 1) q = q.in('invoice.xero_tenant_id', tenantIds);
    const { data } = await q;
    for (const r of (data ?? []) as Array<{ line_amount: unknown }>) total += Math.abs(Number(r.line_amount) || 0);
  } else if (platform === 'quickbooks') {
    let q = (supabase as any)
      .from('quickbooks_profit_loss')
      .select('amount, realm_id')
      .eq('organization_id', organizationId)
      .eq('qb_account_id', ref.nativeId)
      .gte('from_date', start)
      .lte('from_date', end);
    if (tenantIds.length === 1) q = q.eq('realm_id', tenantIds[0]);
    else if (tenantIds.length > 1) q = q.in('realm_id', tenantIds);
    const { data } = await q;
    for (const r of (data ?? []) as Array<{ amount: unknown }>) total += Math.abs(Number(r.amount) || 0);
  } else {
    // sage
    const q = (supabase as any)
      .from('sage_invoice_line_items')
      .select('line_amount, invoice:sage_invoices!inner(invoice_date)')
      .eq('organization_id', organizationId)
      .eq('account_code', ref.code)
      .gte('invoice.invoice_date', start)
      .lte('invoice.invoice_date', end + 'T23:59:59');
    const { data } = await q;
    for (const r of (data ?? []) as Array<{ line_amount: unknown }>) total += Math.abs(Number(r.line_amount) || 0);
  }

  return total;
}

// Detects which platform a location's account UUID refs (e.g.
// lab_fees_accounts / material_cost_accounts) belong to, and resolves each
// ref to a {code, nativeId} pair — same heuristic as useLocationCostsImpact
// (whichever platform's chart_of_accounts matches the most refs wins).
async function resolveLocationAccountRefs(
  organizationId: string,
  uuidRefs: string[],
): Promise<{ platform: ProviderCostAccountPlatform | null; refs: AccountRef[] }> {
  if (uuidRefs.length === 0) return { platform: null, refs: [] };

  const [iplicitRes, xeroRes, qbRes, sageRes] = await Promise.all([
    (supabase as any).from('iplicit_chart_of_accounts').select('id, code, account_id').eq('organization_id', organizationId).in('id', uuidRefs),
    (supabase as any).from('xero_chart_of_accounts').select('id, account_code, xero_account_id').eq('organization_id', organizationId).in('id', uuidRefs),
    (supabase as any).from('quickbooks_chart_of_accounts').select('id, qb_account_id').eq('organization_id', organizationId).in('id', uuidRefs),
    (supabase as any).from('sage_chart_of_accounts').select('id, account_code, sage_account_id').eq('organization_id', organizationId).in('id', uuidRefs),
  ]);

  const iplicitRows = (iplicitRes?.data ?? []) as Array<{ id: string; code: string | null; account_id: string | null }>;
  const xeroRows = (xeroRes?.data ?? []) as Array<{ id: string; account_code: string | null; xero_account_id: string | null }>;
  const qbRows = (qbRes?.data ?? []) as Array<{ id: string; qb_account_id: string | null }>;
  const sageRows = (sageRes?.data ?? []) as Array<{ id: string; account_code: string | null; sage_account_id: string | null }>;

  if (iplicitRows.length >= xeroRows.length && iplicitRows.length >= qbRows.length && iplicitRows.length >= sageRows.length && iplicitRows.length > 0) {
    return { platform: 'iplicit', refs: iplicitRows.map((r) => ({ code: (r.code || '').trim(), nativeId: (r.account_id || '').trim() })) };
  }
  if (qbRows.length >= xeroRows.length && qbRows.length >= sageRows.length && qbRows.length > 0) {
    return { platform: 'quickbooks', refs: qbRows.map((r) => ({ code: (r.qb_account_id || '').trim(), nativeId: (r.qb_account_id || '').trim() })) };
  }
  if (sageRows.length >= xeroRows.length && sageRows.length > 0) {
    return { platform: 'sage', refs: sageRows.map((r) => ({ code: (r.account_code || '').trim(), nativeId: (r.sage_account_id || '').trim() })) };
  }
  if (xeroRows.length > 0) {
    return { platform: 'xero', refs: xeroRows.map((r) => ({ code: (r.account_code || '').trim(), nativeId: (r.xero_account_id || '').trim() })) };
  }
  return { platform: null, refs: [] };
}

// The location's monthly lab/material bill, bucketed per calendar month —
// used as the base for Sliding Scale banding. Scoped to one location's own
// account refs and mapped tenants only (no cross-location equal-sharing;
// that convention exists in useLocationCostsImpact for a different,
// bucket-union context and doesn't apply to a single location's own bill).
async function fetchMonthlyBill(
  organizationId: string,
  platform: ProviderCostAccountPlatform,
  refs: AccountRef[],
  tenantIds: string[],
  months: Array<{ key: string; year: number; month: number }>,
  dateFrom: Date,
  dateTo: Date,
): Promise<Map<string, number>> {
  const byMonth = new Map<string, number>();
  for (const m of months) byMonth.set(m.key, 0);
  if (refs.length === 0) return byMonth;

  const codes = Array.from(new Set(refs.map((r) => r.code).filter(Boolean)));
  const nativeIds = Array.from(new Set(refs.map((r) => r.nativeId).filter(Boolean)));
  const { start, end } = calendarBounds(dateFrom, dateTo);

  const addToMonth = (dateStr: string | null | undefined, amount: number) => {
    if (!dateStr) return;
    const d = new Date(dateStr);
    const key = monthKey(d.getFullYear(), d.getMonth() + 1);
    if (byMonth.has(key)) byMonth.set(key, (byMonth.get(key) ?? 0) + Math.abs(amount));
  };

  if (platform === 'iplicit') {
    let q = (supabase as any)
      .from('iplicit_profit_loss')
      .select('amount, account_code, period_date')
      .eq('organization_id', organizationId)
      .in('account_code', codes)
      .gte('period_date', start)
      .lte('period_date', end + 'T23:59:59');
    if (tenantIds.length === 1) q = q.eq('legal_entity_id', tenantIds[0]);
    else if (tenantIds.length > 1) q = q.in('legal_entity_id', tenantIds);
    const { data } = await q;
    for (const r of (data ?? []) as Array<{ amount: unknown; period_date: string }>) addToMonth(r.period_date, Number(r.amount) || 0);
  } else if (platform === 'xero') {
    let q = (supabase as any)
      .from('xero_invoice_line_items')
      .select('line_amount, account_code, invoice:xero_invoices!inner(invoice_date, invoice_type, xero_tenant_id)')
      .eq('organization_id', organizationId)
      .in('account_code', codes)
      .eq('invoice.invoice_type', 'PL_SYNTHETIC')
      .gte('invoice.invoice_date', start)
      .lte('invoice.invoice_date', end + 'T23:59:59');
    if (tenantIds.length === 1) q = q.eq('invoice.xero_tenant_id', tenantIds[0]);
    else if (tenantIds.length > 1) q = q.in('invoice.xero_tenant_id', tenantIds);
    const { data } = await q;
    for (const r of (data ?? []) as Array<{ line_amount: unknown; invoice?: { invoice_date?: string } }>) {
      addToMonth(r.invoice?.invoice_date, Number(r.line_amount) || 0);
    }
  } else if (platform === 'quickbooks') {
    let q = (supabase as any)
      .from('quickbooks_profit_loss')
      .select('amount, qb_account_id, from_date, realm_id')
      .eq('organization_id', organizationId)
      .in('qb_account_id', nativeIds)
      .gte('from_date', start)
      .lte('from_date', end);
    if (tenantIds.length === 1) q = q.eq('realm_id', tenantIds[0]);
    else if (tenantIds.length > 1) q = q.in('realm_id', tenantIds);
    const { data } = await q;
    for (const r of (data ?? []) as Array<{ amount: unknown; from_date: string }>) addToMonth(r.from_date, Number(r.amount) || 0);
  } else {
    // sage
    const q = (supabase as any)
      .from('sage_invoice_line_items')
      .select('line_amount, account_code, invoice:sage_invoices!inner(invoice_date)')
      .eq('organization_id', organizationId)
      .in('account_code', codes)
      .gte('invoice.invoice_date', start)
      .lte('invoice.invoice_date', end + 'T23:59:59');
    const { data } = await q;
    for (const r of (data ?? []) as Array<{ line_amount: unknown; invoice?: { invoice_date?: string } }>) {
      addToMonth(r.invoice?.invoice_date, Number(r.line_amount) || 0);
    }
  }

  return byMonth;
}

export async function loadProviderCostInputs(params: {
  organizationId: string;
  providers: ProviderCostInputRow[];
  dateFrom: Date;
  dateTo: Date;
}): Promise<ProviderCostInputsResult> {
  const { organizationId, providers, dateFrom, dateTo } = params;
  const months = monthsInRange(dateFrom, dateTo);

  const result: ProviderCostInputsResult = {
    locationGateByLocationId: new Map(),
    accountAmountByProviderId: new Map(),
    monthlyValuesByProviderId: new Map(),
    monthlyBillByLocationId: new Map(),
    bandsByProviderId: new Map(),
  };

  const locationIds = Array.from(new Set(providers.map((p) => p.location_id).filter(Boolean))) as string[];
  if (locationIds.length === 0) return result;

  const { data: locationRows } = await (supabase as any)
    .from('practice_locations')
    .select('id, associate_cost_lab_source, associate_cost_labs_percent, material_cost_source, practice_cost_materials_percent, lab_fees_accounts, material_cost_accounts, is_associate_pay_including_lab_cost, is_associate_pay_including_material_cost')
    .in('id', locationIds);

  const locationsById = new Map<string, any>();
  for (const loc of (locationRows ?? []) as any[]) {
    locationsById.set(loc.id, loc);
    result.locationGateByLocationId.set(loc.id, {
      associate_cost_lab_source: loc.associate_cost_lab_source,
      associate_cost_labs_percent: loc.associate_cost_labs_percent,
      material_cost_source: loc.material_cost_source,
      practice_cost_materials_percent: loc.practice_cost_materials_percent,
      is_associate_pay_including_lab_cost: loc.is_associate_pay_including_lab_cost,
      is_associate_pay_including_material_cost: loc.is_associate_pay_including_material_cost,
    });
  }

  const needsAssociateWise = (p: ProviderCostInputRow, key: 'lab' | 'material') => {
    const loc = p.location_id ? locationsById.get(p.location_id) : null;
    if (!loc) return false;
    return key === 'lab' ? loc.associate_cost_lab_source === 'associate_wise' : loc.material_cost_source === 'associate_wise';
  };

  // ── Accounting Application: resolve one amount per (provider, cost type) ──
  const accountingProviders = providers.filter(
    (p) =>
      (needsAssociateWise(p, 'lab') && p.lab_cost_source_method === 'accounting_application' && p.lab_cost_account_id && p.lab_cost_account_platform) ||
      (needsAssociateWise(p, 'material') && p.material_cost_source_method === 'accounting_application' && p.material_cost_account_id && p.material_cost_account_platform),
  );
  if (accountingProviders.length > 0) {
    const tenantsByLocation = new Map<string, string[]>();
    for (const p of accountingProviders) {
      if (p.location_id && !tenantsByLocation.has(p.location_id)) {
        tenantsByLocation.set(p.location_id, await resolveLocationTenants(p.location_id));
      }
    }
    for (const p of accountingProviders) {
      const tenantIds = p.location_id ? (tenantsByLocation.get(p.location_id) ?? []) : [];
      const entry = result.accountAmountByProviderId.get(p.id) ?? { lab: null, material: null };
      if (needsAssociateWise(p, 'lab') && p.lab_cost_source_method === 'accounting_application' && p.lab_cost_account_id && p.lab_cost_account_platform) {
        const ref = await resolveAccountRef(organizationId, p.lab_cost_account_platform, p.lab_cost_account_id);
        if (ref) entry.lab = await fetchAccountAmount(organizationId, p.lab_cost_account_platform, ref, tenantIds, dateFrom, dateTo);
      }
      if (needsAssociateWise(p, 'material') && p.material_cost_source_method === 'accounting_application' && p.material_cost_account_id && p.material_cost_account_platform) {
        const ref = await resolveAccountRef(organizationId, p.material_cost_account_platform, p.material_cost_account_id);
        if (ref) entry.material = await fetchAccountAmount(organizationId, p.material_cost_account_platform, ref, tenantIds, dateFrom, dateTo);
      }
      result.accountAmountByProviderId.set(p.id, entry);
    }
  }

  // ── Monthly: read provider_monthly_costs for months in range ──
  const monthlyProviders = providers.filter(
    (p) =>
      (needsAssociateWise(p, 'lab') && p.lab_cost_source_method === 'monthly') ||
      (needsAssociateWise(p, 'material') && p.material_cost_source_method === 'monthly'),
  );
  if (monthlyProviders.length > 0) {
    const { start, end } = calendarBounds(dateFrom, dateTo);
    const { data: monthlyRows } = await (supabase as any)
      .from('provider_monthly_costs')
      .select('provider_id, month, lab_cost_value, material_cost_value')
      .eq('organization_id', organizationId)
      .in('provider_id', monthlyProviders.map((p) => p.id))
      .gte('month', start)
      .lte('month', end);
    for (const p of monthlyProviders) {
      result.monthlyValuesByProviderId.set(p.id, { lab: [], material: [] });
    }
    for (const row of (monthlyRows ?? []) as Array<{ provider_id: string; lab_cost_value: number | null; material_cost_value: number | null }>) {
      const entry = result.monthlyValuesByProviderId.get(row.provider_id);
      if (!entry) continue;
      if (row.lab_cost_value != null) entry.lab.push(Number(row.lab_cost_value));
      if (row.material_cost_value != null) entry.material.push(Number(row.material_cost_value));
    }
  }

  // ── Sliding Scale: per-location monthly bill + per-provider bands ──
  const slidingLocationIds = new Set<string>();
  for (const p of providers) {
    if (needsAssociateWise(p, 'lab') && p.lab_cost_source_method === 'sliding_scale' && p.location_id) slidingLocationIds.add(p.location_id);
    if (needsAssociateWise(p, 'material') && p.material_cost_source_method === 'sliding_scale' && p.location_id) slidingLocationIds.add(p.location_id);
  }
  for (const locId of slidingLocationIds) {
    const loc = locationsById.get(locId);
    if (!loc) continue;
    const tenantIds = await resolveLocationTenants(locId);
    const labUuids: string[] = Array.isArray(loc.lab_fees_accounts) ? loc.lab_fees_accounts.filter(Boolean) : [];
    const materialUuids: string[] = Array.isArray(loc.material_cost_accounts) ? loc.material_cost_accounts.filter(Boolean) : [];

    const [labResolved, materialResolved] = await Promise.all([
      resolveLocationAccountRefs(organizationId, labUuids),
      resolveLocationAccountRefs(organizationId, materialUuids),
    ]);

    const labByMonth = labResolved.platform
      ? await fetchMonthlyBill(organizationId, labResolved.platform, labResolved.refs, tenantIds, months, dateFrom, dateTo)
      : new Map(months.map((m) => [m.key, 0]));
    const materialByMonth = materialResolved.platform
      ? await fetchMonthlyBill(organizationId, materialResolved.platform, materialResolved.refs, tenantIds, months, dateFrom, dateTo)
      : new Map(months.map((m) => [m.key, 0]));

    result.monthlyBillByLocationId.set(locId, {
      lab: months.map((m) => labByMonth.get(m.key) ?? 0),
      material: months.map((m) => materialByMonth.get(m.key) ?? 0),
    });
  }

  // ── Bands: read provider_sliding_scales directly for providers using sliding_scale ──
  const slidingProviderIds = providers
    .filter(
      (p) =>
        (needsAssociateWise(p, 'lab') && p.lab_cost_source_method === 'sliding_scale') ||
        (needsAssociateWise(p, 'material') && p.material_cost_source_method === 'sliding_scale'),
    )
    .map((p) => p.id);
  if (slidingProviderIds.length > 0) {
    const { data: bandRows } = await (supabase as any)
      .from('provider_sliding_scales')
      .select('provider_id, scale_type, start_amount, end_amount, percentage_value')
      .eq('organization_id', organizationId)
      .in('provider_id', slidingProviderIds)
      .in('scale_type', ['lab_cost_scale', 'material_cost_scale'])
      .order('start_amount', { ascending: true });
    for (const pid of slidingProviderIds) {
      result.bandsByProviderId.set(pid, { lab: [], material: [] });
    }
    for (const row of (bandRows ?? []) as Array<{ provider_id: string; scale_type: string; start_amount: number; end_amount: number; percentage_value: number }>) {
      const entry = result.bandsByProviderId.get(row.provider_id);
      if (!entry) continue;
      const band = { start: Number(row.start_amount), end: Number(row.end_amount), percentage: Number(row.percentage_value) };
      if (row.scale_type === 'lab_cost_scale') entry.lab.push(band);
      else entry.material.push(band);
    }
  }

  return result;
}
