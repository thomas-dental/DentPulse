import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from './useOrganization';
import { useAuth } from './useAuth';
import { useFilters } from '@/contexts/FilterContext';

// A bill awaiting payment, sourced from the connected ledger (xero_invoices,
// invoice_type ACCPAY, unpaid) and merged with the user's per-bill settings.
export interface Bill {
  id: string;
  invoiceNumber: string;
  /** Xero reference, falling back to invoice number (Pro "Reference" column). */
  reference: string;
  /** Xero InvoiceID — used to deep-link the Reference column into Xero AP. */
  platformInvoiceId: string | null;
  supplier: string;
  invoiceDate: string | null;      // YYYY-MM-DD — Pro "Date"
  originalDueDate: string | null;  // YYYY-MM-DD
  expectedDate: string | null;     // override ?? due date — Pro "Planned Date"
  amount: number;                  // amount_due — Pro "Due"
  amountPaid: number;              // amount_paid — Pro "Paid"
  /** Days past original due date when overdue; otherwise 0. */
  overdueDays: number;
  isDraft: boolean;
  excluded: boolean;
  hasExpectedOverride: boolean;
  coa: string;                     // chart-of-account name(s) from the bill's line items
  locationId: string | null;       // practice location the bill is tagged to (null = untagged)
  locationName: string;            // resolved location name, or 'Untagged' when location_id is null
  xeroAccount: string;             // the Xero organisation/tenant this invoice came from
  // Derived status flags (relative to today):
  overdue: boolean;
  pastExpected: boolean;
  upcoming: boolean;
}

export interface SupplierLateness { supplier: string; avgDaysLate: number; bills: number; }

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const num = (v: unknown) => Math.abs(Number(v) || 0);
// Fixed sentinel week_start for bill-setting rows in cashflow_forecast_overrides
// (the table requires a non-null week_start; one row per org+location+bill).
const BILL_SETTINGS_WEEK = '2000-01-01';

export function useBillsToPay() {
  const { organizationId } = useOrganization();
  const { user } = useAuth();
  const { selectedLocationId } = useFilters();
  const queryClient = useQueryClient();
  const scope = selectedLocationId ?? 'all';

  // Outstanding bills (ACCPAY) matching Xero "Awaiting Payment":
  // AUTHORISED + amount_due > 0 + not paid. Excludes VOIDED/DELETED/DRAFT and
  // zero-balance rows that inflate counts far above live Xero.
  const billsQuery = useQuery({
    // location_id is stamped at SYNC from Practice Location Mapping; we also
    // fetch null-location rows and resolve them via tenant→location mapping
    // below. Unmapped tenants (e.g. TFL) are dropped for a selected location.
    queryKey: ['bills-to-pay', organizationId, scope],
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      if (!organizationId) return [];
      let q = (supabase as any)
        .from('xero_invoices')
        .select('id, invoice_number, reference, contact_name, invoice_date, due_date, amount_due, amount_paid, total_amount, status, is_paid, invoice_type, location_id, xero_tenant_id, platform_invoice_id, xero_invoice_id')
        .eq('organization_id', organizationId)
        .eq('invoice_type', 'ACCPAY')
        .eq('is_paid', false)
        .ilike('status', 'AUTHORISED')
        .gt('amount_due', 0);
      if (selectedLocationId) q = q.or(`location_id.eq.${selectedLocationId},location_id.is.null`);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Array<Record<string, unknown>>;
    },
  });

  // Per-bill overrides (excluded / expected_date). Stored in the existing
  // cashflow_forecast_overrides table (no extra migration): section 'bill',
  // line_key = bill id, amount = excluded ? 1 : 0, line_label = expected date,
  // pinned to a fixed sentinel week so it's one row per (org, location, bill).
  const settingsQuery = useQuery({
    queryKey: ['bills-to-pay-settings', organizationId, scope],
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      if (!organizationId) return [];
      let q = (supabase as any)
        .from('cashflow_forecast_overrides')
        .select('line_key, amount, line_label')
        .eq('organization_id', organizationId)
        .eq('section', 'bill');
      q = selectedLocationId ? q.eq('location_id', selectedLocationId) : q.is('location_id', null);
      const { data, error } = await q;
      if (error) throw error;
      return ((data ?? []) as Array<{ line_key: string; amount: number | string; line_label: string | null }>)
        .map((r) => ({ bill_id: r.line_key, excluded: Number(r.amount) > 0, expected_date: r.line_label || null }));
    },
  });

  // Paid bills over the past 3 months → "top suppliers paid late".
  const paidQuery = useQuery({
    queryKey: ['bills-to-pay-paid', organizationId, scope],
    enabled: !!organizationId,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      if (!organizationId) return [];
      const since = new Date(); since.setMonth(since.getMonth() - 3);
      let q = (supabase as any)
        .from('xero_invoices')
        .select('contact_name, due_date, paid_date, location_id')
        .eq('organization_id', organizationId)
        .eq('invoice_type', 'ACCPAY')
        .eq('is_paid', true)
        .not('due_date', 'is', null)
        .not('paid_date', 'is', null)
        .gte('paid_date', ymd(since));
      if (selectedLocationId) q = q.or(`location_id.eq.${selectedLocationId},location_id.is.null`);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Array<{ contact_name: string | null; due_date: string; paid_date: string }>;
    },
  });

  // Chart of account per bill, resolved from its Xero line items. A bill can span
  // several accounts; we show the distinct account names joined. Keyed off the set
  // of bill ids so it refetches only when the bill list changes.
  const billIdsKey = (billsQuery.data ?? []).map((r) => String(r.id)).sort().join(',');
  const coaQuery = useQuery({
    queryKey: ['bills-to-pay-coa', organizationId, billIdsKey],
    enabled: !!organizationId && (billsQuery.data?.length ?? 0) > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<Record<string, string>> => {
      const ids = (billsQuery.data ?? []).map((r) => String(r.id));
      if (!organizationId || ids.length === 0) return {};
      const [{ data: lines }, { data: coa }] = await Promise.all([
        (supabase as any).from('xero_invoice_line_items').select('invoice_id, account_id, account_code').in('invoice_id', ids),
        (supabase as any).from('xero_chart_of_accounts').select('xero_account_id, account_code, account_name').eq('organization_id', organizationId),
      ]);
      // account id/code (lower-cased) → account name
      const nameByKey = new Map<string, string>();
      for (const r of (coa ?? []) as Array<Record<string, unknown>>) {
        const nm = String(r.account_name ?? '').trim();
        if (!nm) continue;
        if (r.xero_account_id) nameByKey.set(String(r.xero_account_id).trim().toLowerCase(), nm);
        if (r.account_code) nameByKey.set(String(r.account_code).trim().toLowerCase(), nm);
      }
      const byInvoice = new Map<string, Set<string>>();
      for (const l of (lines ?? []) as Array<{ invoice_id: string; account_id: string | null; account_code: string | null }>) {
        const name = nameByKey.get(String(l.account_id ?? '').trim().toLowerCase())
          ?? nameByKey.get(String(l.account_code ?? '').trim().toLowerCase());
        if (!name) continue;
        (byInvoice.get(l.invoice_id) ?? byInvoice.set(l.invoice_id, new Set()).get(l.invoice_id)!).add(name);
      }
      const out: Record<string, string> = {};
      for (const [inv, names] of byInvoice) out[inv] = [...names].join(', ');
      return out;
    },
  });

  // Provenance lookups so each bill can be attributed to a Xero account + location:
  //   • locById        — location_id → location name
  //   • tenantById      — xero_tenant_id (platform_org_id) → Xero organisation name
  //   • tenantLocById   — xero_tenant_id → location_id, via the tenant→location map
  //     (platform_integration_organization_mapping). This is how location is REALLY
  //     determined: the sync never sets xero_invoices.location_id, so an invoice's
  //     location is whichever practice the Xero org it came from is mapped to.
  const provenanceQuery = useQuery({
    queryKey: ['bills-to-pay-provenance', organizationId],
    enabled: !!organizationId,
    staleTime: 30 * 60 * 1000,
    queryFn: async (): Promise<{ locById: Record<string, string>; tenantById: Record<string, string>; tenantLocById: Record<string, string> }> => {
      const out = { locById: {} as Record<string, string>, tenantById: {} as Record<string, string>, tenantLocById: {} as Record<string, string> };
      if (!organizationId) return out;
      const [{ data: locs }, { data: tenants }, { data: maps }] = await Promise.all([
        (supabase as any).from('practice_locations').select('id, location_name').eq('organization_id', organizationId),
        (supabase as any).from('platform_integration_organizations').select('id, platform_org_id, platform_org_name').eq('organization_id', organizationId),
        (supabase as any).from('platform_integration_organization_mapping').select('platform_integration_organizations_id, location_id').eq('organization_id', organizationId),
      ]);
      for (const r of (locs ?? []) as Array<{ id: string; location_name: string | null }>) {
        out.locById[String(r.id)] = String(r.location_name ?? '');
      }
      // platform_integration_organizations.id → platform_org_id (and the org name)
      const pioIdToTenant = new Map<string, string>();
      for (const r of (tenants ?? []) as Array<{ id: string; platform_org_id: string | null; platform_org_name: string | null }>) {
        if (!r.platform_org_id) continue;
        const tenant = String(r.platform_org_id);
        pioIdToTenant.set(String(r.id), tenant);
        out.tenantById[tenant] = String(r.platform_org_name ?? tenant);
      }
      // mapping (pio.id → location_id)  ⇒  xero_tenant_id → location_id.
      // Only accept locations that are REAL locations of this org (locById) — the
      // cloned dev DB leaves stale cross-org ids around, which would otherwise show
      // as "Unknown location".
      for (const r of (maps ?? []) as Array<{ platform_integration_organizations_id: string; location_id: string | null }>) {
        const tenant = pioIdToTenant.get(String(r.platform_integration_organizations_id));
        const loc = r.location_id ? String(r.location_id) : null;
        if (tenant && loc && out.locById[loc]) out.tenantLocById[tenant] = loc;
      }
      return out;
    },
  });

  const result = useMemo(() => {
    const settings = new Map((settingsQuery.data ?? []).map((s) => [s.bill_id, s]));
    const coaByBill = coaQuery.data ?? {};
    const locById = provenanceQuery.data?.locById ?? {};
    const tenantById = provenanceQuery.data?.tenantById ?? {};
    const tenantLocById = provenanceQuery.data?.tenantLocById ?? {};
    const today = new Date(); today.setHours(0, 0, 0, 0);

    const mapped: Bill[] = (billsQuery.data ?? []).map((r) => {
      const id = String(r.id);
      const s = settings.get(id);
      const due = (r.due_date as string) || null;
      const expected = s?.expected_date || due;
      const expDate = expected ? new Date(`${expected}T00:00:00`) : null;
      const dueDate = due ? new Date(`${due}T00:00:00`) : null;
      const isDraft = String(r.status ?? '').toLowerCase() === 'draft';
      const invoiceNumber = String(r.invoice_number ?? '').trim() || '—';
      const refRaw = String(r.reference ?? '').trim();
      const platformInvoiceId = String(r.platform_invoice_id ?? r.xero_invoice_id ?? '').trim() || null;
      const overdue = !!dueDate && dueDate < today;
      const overdueDays = overdue && dueDate
        ? Math.max(0, Math.round((today.getTime() - dueDate.getTime()) / 86400000))
        : 0;
      // Prefer stamped location_id (validated); else tenant→location mapping.
      // Unmapped Xero orgs stay untagged and are excluded when a location is selected.
      const tenant = (r.xero_tenant_id as string) || null;
      const rawLoc = (r.location_id as string) || null;
      const resolvedLocId = (rawLoc && locById[rawLoc] ? rawLoc : null)
        ?? (tenant ? (tenantLocById[tenant] ?? null) : null)
        ?? null;
      return {
        id,
        invoiceNumber,
        reference: refRaw || invoiceNumber,
        platformInvoiceId,
        supplier: String(r.contact_name ?? 'Unknown'),
        invoiceDate: (r.invoice_date as string) || null,
        originalDueDate: due,
        expectedDate: expected,
        amount: num(r.amount_due),
        amountPaid: num(r.amount_paid),
        overdueDays,
        isDraft,
        excluded: !!s?.excluded,
        hasExpectedOverride: !!s?.expected_date,
        coa: coaByBill[id] ?? '',
        locationId: resolvedLocId,
        locationName: resolvedLocId ? (locById[resolvedLocId] || 'Unknown location') : 'Untagged',
        xeroAccount: tenant ? (tenantById[tenant] || tenant) : '—',
        overdue,
        pastExpected: !!expDate && expDate < today,
        upcoming: !!dueDate && dueDate >= today,
      };
    });

    // Drop unmapped / wrong-location rows so Leiston matches that Xero org's
    // awaiting-payment list (not TFL / other null-location tenants).
    const bills = selectedLocationId
      ? mapped.filter((b) => b.locationId === selectedLocationId)
      : mapped.filter((b) => b.locationId != null);

    // Accounting reconciliation is independent of forecast inclusion:
    // Outstanding and Overdue must continue to match the connected Xero
    // Awaiting Payment list after a user excludes a bill from the forecast.
    // Forecast-only outputs (past-expected warning and payment timing) use
    // active bills so an excluded bill no longer appears as forecast payable.
    const active = bills.filter((b) => !b.excluded);
    const sum = (arr: Bill[]) => arr.reduce((s, b) => s + b.amount, 0);
    const overdue = bills.filter((b) => b.overdue);
    const pastExpected = active.filter((b) => b.pastExpected);
    const summary = {
      outstanding: { count: bills.length, amount: sum(bills) },
      overdue: { count: overdue.length, amount: sum(overdue) },
      pastExpected: { count: pastExpected.length, amount: sum(pastExpected) },
    };

    // Expected payment timing — bills bucketed by expected date over the next ~30
    // days (past-dated bills fold into today, the way Float forecasts them).
    const timingMap = new Map<string, number>();
    for (let i = 0; i < 31; i++) { const d = new Date(today); d.setDate(d.getDate() + i); timingMap.set(ymd(d), 0); }
    for (const b of active) {
      if (!b.expectedDate) continue;
      const d = new Date(`${b.expectedDate}T00:00:00`);
      const key = d < today ? ymd(today) : ymd(d);
      if (timingMap.has(key)) timingMap.set(key, (timingMap.get(key) ?? 0) + b.amount);
    }
    const paymentTiming = [...timingMap.entries()].map(([date, amount]) => ({
      date,
      label: new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
      amount: Math.round(amount),
    }));

    // Top suppliers paid late (avg days late, only those paid after the due date).
    const lateBySupplier = new Map<string, { total: number; count: number }>();
    for (const p of paidQuery.data ?? []) {
      const supplier = p.contact_name || 'Unknown';
      const daysLate = Math.round((new Date(p.paid_date).getTime() - new Date(p.due_date).getTime()) / 86400000);
      if (daysLate <= 0) continue;
      const cur = lateBySupplier.get(supplier) ?? { total: 0, count: 0 };
      cur.total += daysLate; cur.count += 1;
      lateBySupplier.set(supplier, cur);
    }
    const topSuppliersLate: SupplierLateness[] = [...lateBySupplier.entries()]
      .map(([supplier, v]) => ({ supplier, avgDaysLate: Math.round(v.total / v.count), bills: v.count }))
      .sort((a, b) => b.avgDaysLate - a.avgDaysLate)
      .slice(0, 5);

    return { bills, summary, paymentTiming, topSuppliersLate };
  }, [billsQuery.data, settingsQuery.data, paidQuery.data, coaQuery.data, provenanceQuery.data, selectedLocationId]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['bills-to-pay-settings', organizationId, scope] });
    // The 13-week forecast keeps its OWN copy of these per-bill settings (query
    // 'cashflow-forecast-bill-settings', 5-min staleTime) and rebuilds its outflow
    // pipeline from it. Invalidate those too (prefix match covers every location
    // scope) so excluding/including a bill reflects in the forecast immediately,
    // not only after that cache expires or a full page reload.
    queryClient.invalidateQueries({ queryKey: ['cashflow-forecast-bill-settings', organizationId] });
    queryClient.invalidateQueries({ queryKey: ['cashflow-forecast-block-pipeline', organizationId] });
  };

  // Upsert per-bill settings for one or more bills (batch-friendly).
  const setBillSetting = useMutation({
    mutationFn: async (args: { billIds: string[]; excluded?: boolean; expectedDate?: string | null }) => {
      if (!organizationId) throw new Error('No organization');
      const existing = new Map((settingsQuery.data ?? []).map((s) => [s.bill_id, s]));
      const rows = args.billIds.map((bill_id) => {
        const cur = existing.get(bill_id);
        const excluded = args.excluded !== undefined ? args.excluded : (cur?.excluded ?? false);
        const expectedDate = args.expectedDate !== undefined ? args.expectedDate : (cur?.expected_date ?? null);
        return {
          organization_id: organizationId,
          location_id: selectedLocationId ?? null,
          section: 'bill',
          week_start: BILL_SETTINGS_WEEK,
          line_key: bill_id,
          amount: excluded ? 1 : 0,
          line_label: expectedDate,
          created_by: user?.id ?? null,
          updated_at: new Date().toISOString(),
        };
      });
      const { error } = await (supabase as any)
        .from('cashflow_forecast_overrides')
        .upsert(rows, { onConflict: 'organization_id,location_id,week_start,section,line_key' });
      if (error) throw error;
    },
    // Optimistic update so the toggle reflects (and totals re-sum) immediately,
    // before the server round-trip.
    onMutate: async (args) => {
      const key = ['bills-to-pay-settings', organizationId, scope];
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData(key);
      queryClient.setQueryData(key, (old: unknown) => {
        const map = new Map(((old as Array<{ bill_id: string; excluded: boolean; expected_date: string | null }>) ?? []).map((s) => [s.bill_id, { ...s }]));
        for (const billId of args.billIds) {
          const cur = map.get(billId) ?? { bill_id: billId, excluded: false, expected_date: null };
          if (args.excluded !== undefined) cur.excluded = args.excluded;
          if (args.expectedDate !== undefined) cur.expected_date = args.expectedDate;
          map.set(billId, cur);
        }
        return [...map.values()];
      });
      return { prev, key };
    },
    onError: (_e, _vars, ctx) => { if (ctx?.prev !== undefined) queryClient.setQueryData(ctx.key, ctx.prev); },
    onSettled: invalidate,
  });

  return {
    ...result,
    isLoading: billsQuery.isLoading || settingsQuery.isLoading,
    error: billsQuery.error || settingsQuery.error,
    setBillSetting,
  };
}
