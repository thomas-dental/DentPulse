import { useMemo, useEffect, useRef, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { MainLayout } from '@/components/layout/MainLayout';
import { AISummaryCard } from '@/components/ai/AISummaryCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { TrendIndicator } from '@/components/dashboard/TrendIndicator';
import { CostImpactSimulator } from '@/components/costs/CostImpactSimulator';
import { useOperatingLeasesXero } from '@/hooks/useOperatingLeasesXero';
import { useIplicitPLCosts } from '@/hooks/useIplicitPLCosts';
import { useTreatmentInsights } from '@/hooks/useTreatmentInsights';
import { useNavigate } from 'react-router-dom';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, Legend } from 'recharts';
import { Megaphone, AlertTriangle, RefreshCw, Database, CheckCircle2, Loader2, Trash2, Clock, ChevronLeft, ChevronRight, MapPin } from 'lucide-react';
import { useConnectedIntegration } from '@/hooks/useConnectedIntegration';
import { useExpenseAccountSettings } from '@/hooks/useExpenseAccountSettings';
import { PRODUCTIVITY_TARGET_DEFAULT } from '@/hooks/useProductivityTargetMultiplier';
import { ProductivityTargetPopover } from '@/components/costs/ProductivityTargetPopover';
import { BUDGET_MULTIPLIER_DEFAULT, BENCHMARK_MULTIPLIER_DEFAULT } from '@/hooks/useCostTrendMultipliers';
import { MonthlyTrendSettingsPopover } from '@/components/costs/MonthlyTrendSettingsPopover';
import { TrendChartTooltip } from '@/components/costs/TrendChartTooltip';
import { useAuth } from '@/hooks/useAuth';
import { useFilters } from '@/contexts/FilterContext';
import { useLocations } from '@/hooks/useLocations';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationSettings } from '@/hooks/useOrganizationSettings';
import { formatCurrency as formatCurrencyBase } from '@/lib/currency';

const COLORS = ['hsl(var(--chart-5))', 'hsl(var(--chart-3))', 'hsl(var(--chart-4))', 'hsl(var(--chart-2))', 'hsl(var(--primary))'];

const ITEMS_PER_PAGE = 7;

export default function MarketingCosts() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { showDecimals } = useOrganizationSettings();
  const formatCurrency = (value: number) => formatCurrencyBase(value, showDecimals);
  // Summary-tile numbers always show whole pounds, regardless of the Show Decimals setting.
  const formatCurrencyWhole = (value: number) => formatCurrencyBase(value, false);
  const lastFetchedCodesRef = useRef<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [practiceLocations, setPracticeLocations] = useState<any[]>([]);
  const [accountNameMap, setAccountNameMap] = useState<Map<string, string>>(new Map());
  const { displayName: integrationName, connectedPlatform, isConnected } = useConnectedIntegration();
  const { dateRange, selectedLocationId } = useFilters();
  const { allAvailableLocations } = useLocations();
  const { marketingCost: marketingCostSettings, isLoading: isLoadingSettings } = useExpenseAccountSettings(selectedLocationId);
  const [productivityTargetMultiplier, setProductivityTargetMultiplier] = useState<number>(PRODUCTIVITY_TARGET_DEFAULT);
  const [budgetMultiplier, setBudgetMultiplier] = useState<number>(BUDGET_MULTIPLIER_DEFAULT);
  const [benchmarkMultiplier, setBenchmarkMultiplier] = useState<number>(BENCHMARK_MULTIPLIER_DEFAULT);
  const handleTrendMultipliersChange = (b: number, k: number) => {
    setBudgetMultiplier(b);
    setBenchmarkMultiplier(k);
  };

  const isIplicit = connectedPlatform === 'iplicit';

  // Marketing Costs use purchase invoices (ACCPAY), same as Overhead/Lab Fees.
  // The account codes configured in Setup Categories differentiate them.
  const invoiceType = 'ACCPAY' as const;

  // Use date range from filter context
  const { fromDate: defaultFromDate, toDate: defaultToDate } = useMemo(() => {
    const toDateStr = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };
    return {
      fromDate: toDateStr(dateRange.startDate),
      toDate: toDateStr(dateRange.endDate),
    };
  }, [dateRange.startDate, dateRange.endDate]);

  // Invoice-based hook (Xero/QuickBooks) — generic, parameterized by account codes.
  const invoiceHook = useOperatingLeasesXero();

  // Iplicit P&L hook (primary for iplicit — uses react-query, auto-fetches)
  const plCosts = useIplicitPLCosts(
    marketingCostSettings.accountCodes,
    marketingCostSettings.selectedAccounts,
    defaultFromDate,
    defaultToDate,
    isIplicit && !isLoadingSettings && marketingCostSettings.hasAccounts,
    selectedLocationId,
  );

  // Unified state based on platform
  const isLoading = isIplicit ? plCosts.isLoading : invoiceHook.isLoading;
  const isSyncing = isIplicit ? false : invoiceHook.isSyncing;
  const isReady = isIplicit ? true : invoiceHook.isReady;
  const error = isIplicit ? plCosts.error : invoiceHook.error;
  const syncResult = isIplicit ? null : invoiceHook.syncResult;
  const rawResponse = isIplicit ? null : invoiceHook.rawResponse;
  const lastSyncedAt = isIplicit ? null : invoiceHook.lastSyncedAt;

  // Auto-fetch for invoice-based platforms (Xero/QB) — Iplicit uses react-query auto
  const hasConfiguredAccounts = marketingCostSettings.hasAccounts;
  const accountCodesKey = marketingCostSettings.accountCodes.join(',') || marketingCostSettings.selectedAccounts.join(',');
  const fetchKey = `${accountCodesKey}|${defaultFromDate}|${defaultToDate}|${selectedLocationId || 'all'}`;
  useEffect(() => {
    if (isIplicit) return; // Iplicit uses react-query, no manual fetch needed
    if (isReady && !isLoadingSettings && hasConfiguredAccounts && lastFetchedCodesRef.current !== fetchKey) {
      lastFetchedCodesRef.current = fetchKey;
      console.log('[MarketingCosts] Fetching with accountCodes:', marketingCostSettings.accountCodes, 'selectedAccounts (UUIDs):', marketingCostSettings.selectedAccounts, 'dateRange:', defaultFromDate, 'to', defaultToDate, 'location:', selectedLocationId || 'all');
      invoiceHook.loadFromDatabase(defaultFromDate, defaultToDate, invoiceType, marketingCostSettings.accountCodes, marketingCostSettings.selectedAccounts, selectedLocationId);
    }
  }, [isIplicit, isReady, isLoadingSettings, hasConfiguredAccounts, fetchKey, invoiceHook.loadFromDatabase, marketingCostSettings.accountCodes, marketingCostSettings.selectedAccounts, invoiceType, defaultFromDate, defaultToDate]);

  // Fetch practice locations
  useEffect(() => {
    if (!profile?.current_organization_id) return;
    (async () => {
      const { data } = await (supabase as any)
        .from('practice_locations')
        .select('id, location_name, location_code, is_primary, city')
        .eq('organization_id', profile.current_organization_id)
        .eq('is_active', true)
        .order('is_primary', { ascending: false });
      setPracticeLocations(data || []);
    })();
  }, [profile?.current_organization_id]);

  // Fetch chart of accounts (code → name) for Xero/QB so categories show account names.
  // Xero has a dedicated table (xero_chart_of_accounts); QuickBooks still uses the
  // shared platform_integration_chart_of_accounts table. Query both and merge.
  useEffect(() => {
    if (isIplicit || !profile?.current_organization_id) return;
    (async () => {
      const map = new Map<string, string>();
      const [{ data: xeroRows }, { data: piRows }] = await Promise.all([
        (supabase as any)
          .from('xero_chart_of_accounts')
          .select('account_code, account_name')
          .eq('organization_id', profile.current_organization_id),
        (supabase as any)
          .from('platform_integration_chart_of_accounts')
          .select('coa_account_code, coa_account_name')
          .eq('organization_id', profile.current_organization_id),
      ]);
      for (const row of (piRows || []) as Array<{ coa_account_code: string; coa_account_name: string }>) {
        if (row.coa_account_code && row.coa_account_name) {
          map.set(String(row.coa_account_code).trim(), row.coa_account_name);
        }
      }
      for (const row of (xeroRows || []) as Array<{ account_code: string; account_name: string }>) {
        if (row.account_code && row.account_name) {
          map.set(String(row.account_code).trim(), row.account_name);
        }
      }
      console.log('[MarketingCosts] Loaded account name map:', map.size, 'entries');
      setAccountNameMap(map);
    })();
  }, [isIplicit, profile?.current_organization_id]);

  // Get ALL invoices from Xero — only used for non-iplicit
  const allInvoices = useMemo(() => {
    if (isIplicit) return [];
    const invoices = rawResponse?.invoices?.Invoices || [];
    console.log('[MarketingCosts] Total invoices received:', invoices.length);
    return invoices;
  }, [rawResponse, isIplicit]);

  // Calculate totals from ALL line items
  const allTotals = useMemo(() => {
    if (isIplicit) {
      // Iplicit: use P&L data (amounts are negative for costs)
      return { total: plCosts.totalAmount, lineItems: plCosts.entries };
    }
    let total = 0;
    const lineItems: any[] = [];

    allInvoices.forEach((invoice: any) => {
      if (invoice.LineItems) {
        invoice.LineItems.forEach((lineItem: any) => {
          total += (lineItem.LineAmount || 0) + (lineItem.TaxAmount || 0);
          lineItems.push({
            ...lineItem,
            invoiceId: invoice.InvoiceID,
            invoiceNumber: invoice.InvoiceNumber,
            contactName: invoice.Contact?.Name,
            invoiceDate: invoice.Date,
          });
        });
      }
    });

    console.log('[MarketingCosts] Total from all line items:', total, 'from', lineItems.length, 'items');
    return { total, lineItems };
  }, [isIplicit, plCosts.totalAmount, plCosts.entries, allInvoices]);

  const hasInvoiceData = isIplicit
    ? plCosts.entries.length > 0
    : allInvoices.length > 0 && allTotals.lineItems.length > 0;
  const hasLiveData = hasInvoiceData;

  // Single sync handler - fetches from platform AND saves to DB
  const handleSyncFromXero = () => {
    if (!isIplicit) {
      if (!hasConfiguredAccounts) {
        console.warn('[MarketingCosts] Cannot sync — no marketing cost accounts configured');
        return;
      }
      invoiceHook.syncFromPlatform(defaultFromDate, defaultToDate, invoiceType, marketingCostSettings.accountCodes, marketingCostSettings.selectedAccounts);
    }
  };

  // Format last synced time
  const formatLastSynced = (dateStr: string | null) => {
    if (!dateStr) return 'Never synced';
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} min ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  };

  // Calculate values from Xero data
  const totalMarketingCosts = hasInvoiceData ? Math.abs(allTotals.total) : 0;
  // Revenue from Treatment Insights so EBITDA here matches that page.
  const { summary: treatmentSummary } = useTreatmentInsights();
  const totalRevenue = treatmentSummary?.totalRevenue || 0;
  const percentOfRevenue = hasInvoiceData && totalRevenue > 0
    ? Math.round((totalMarketingCosts / totalRevenue) * 1000) / 10
    : 0;
  const benchmark = 8.0;
  const trend = hasInvoiceData ? 2.1 : 0;
  // EBITDA = Treatment Insights revenue − this page's cost bucket.
  const ebitdaImpact = hasInvoiceData ? totalRevenue - totalMarketingCosts : 0;

  // Group line items by AccountCode/account_name for categories (horizontal bar chart)
  const categoriesData = useMemo(() => {
    if (!hasInvoiceData) return [];

    const categoryMap = new Map<string, number>();

    if (isIplicit) {
      plCosts.entries.forEach((entry) => {
        const key = entry.account_name || entry.account_code || 'Uncategorised';
        categoryMap.set(key, (categoryMap.get(key) || 0) + Math.abs(entry.amount));
      });
    } else {
      allTotals.lineItems.forEach((item: any) => {
        const code = item.AccountCode || 'Unknown';
        categoryMap.set(code, (categoryMap.get(code) || 0) + Math.abs((item.LineAmount || 0) + (item.TaxAmount || 0)));
      });
    }

    return Array.from(categoryMap.entries())
      .map(([code, amount]) => ({
        name: isIplicit ? code : (accountNameMap.get(String(code).trim()) || `Account ${code}`),
        amount,
        code,
      }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);
  }, [hasInvoiceData, isIplicit, plCosts.entries, allTotals.lineItems, accountNameMap]);

  // Get top category for KPI
  const topCategory = categoriesData.length > 0 ? categoriesData[0] : null;

  // Group by month for trend chart
  const trendData = useMemo(() => {
    if (!hasInvoiceData) return [];

    const monthMap = new Map<string, number>();

    if (isIplicit) {
      plCosts.entries.forEach((entry) => {
        if (entry.period_date) {
          const date = new Date(entry.period_date);
          const monthKey = date.toLocaleString('en-GB', { month: 'short' });
          monthMap.set(monthKey, (monthMap.get(monthKey) || 0) + Math.abs(entry.amount));
        }
      });
    } else {
      allInvoices.forEach((invoice: any) => {
        if (invoice.Date) {
          const date = new Date(invoice.Date);
          const monthKey = date.toLocaleString('en-GB', { month: 'short' });
          const invoiceTotal = invoice.LineItems
            ?.reduce((sum: number, li: any) => sum + Math.abs((li.LineAmount || 0) + (li.TaxAmount || 0)), 0) || 0;
          monthMap.set(monthKey, (monthMap.get(monthKey) || 0) + invoiceTotal);
        }
      });
    }

    return Array.from(monthMap.entries())
      .map(([month, actual]) => ({
        month,
        actual,
        budget: actual * budgetMultiplier,
        benchmark: actual * benchmarkMultiplier,
        budgetMultiplier,
        benchmarkMultiplier,
      }))
      .slice(-6);
  }, [hasInvoiceData, isIplicit, plCosts.entries, allInvoices, budgetMultiplier, benchmarkMultiplier]);

  // Productivity data (calculated from Xero categories)
  const productivityData = useMemo(() => {
    if (!hasInvoiceData || categoriesData.length === 0) return [];

    return categoriesData.slice(0, 4).map((cat, index) => {
      const utilization = 75 + (index * 3); // Placeholder utilization
      return {
        role: cat.name,
        current: formatCurrency(cat.amount),
        target: formatCurrency(cat.amount * productivityTargetMultiplier),
        utilization,
        progress: (utilization / 100) * 100,
      };
    });
  }, [hasInvoiceData, categoriesData, productivityTargetMultiplier]);

  // Category trends with percentages
  const categoryTrends = useMemo(() => {
    if (!hasInvoiceData || categoriesData.length === 0) return [];

    return categoriesData.map((cat, index) => {
      const trendValue = 1.5 + (index * 0.5); // Placeholder trend
      const maxAmount = Math.max(...categoriesData.map(c => c.amount));
      return {
        name: cat.name,
        amount: cat.amount,
        trend: trendValue,
        progress: (cat.amount / maxAmount) * 100,
      };
    });
  }, [hasInvoiceData, categoriesData]);

  // Marketing Costs by Location — query real per-location costs via legal_entity_id mapping
  const [locationData, setLocationData] = useState<Array<{
    location: string; city: string; isPrimary: boolean;
    totalCost: number; percentOfTotal: number; vsBenchmark: number; status: string;
  }>>([]);
  const [locationDataLoading, setLocationDataLoading] = useState(false);

  const isSagePlatform = connectedPlatform === 'sage';

  useEffect(() => {
    if (!hasInvoiceData || !profile?.current_organization_id || practiceLocations.length === 0) {
      setLocationData([]);
      return;
    }

    const orgId = profile.current_organization_id;
    let cancelled = false;

    (async () => {
      setLocationDataLoading(true);
      try {
        // 1. Get location → legal_entity_id mapping
        const { data: mappings } = await (supabase as any)
          .from('platform_integration_organization_mapping')
          .select('location_id, platform_integration_organizations_id')
          .eq('organization_id', orgId);

        if (cancelled) return;

        // Resolve platform_integration_organizations → platform_org_id (= legal_entity_id)
        const pioIds = [...new Set(((mappings ?? []) as any[]).map((m: any) => m.platform_integration_organizations_id))];
        let pioMap = new Map<string, string>(); // pio.id → platform_org_id
        if (pioIds.length > 0) {
          const { data: pios } = await (supabase as any)
            .from('platform_integration_organizations')
            .select('id, platform_org_id')
            .in('id', pioIds);
          for (const pio of (pios ?? []) as any[]) {
            if (pio.platform_org_id) pioMap.set(pio.id, pio.platform_org_id);
          }
        }

        if (cancelled) return;

        // Build location_id → legal_entity_id map
        const locToEntity = new Map<string, string>();
        for (const m of (mappings ?? []) as any[]) {
          const entityId = pioMap.get(m.platform_integration_organizations_id);
          if (entityId) locToEntity.set(m.location_id, entityId);
        }

        // 2. Resolve marketing cost account codes/IDs from the right CoA table.
        // Iplicit and Sage have their own dedicated tables; we route based on
        // the connected platform so Sage users see real per-location totals
        // instead of zeros from an empty iplicit_chart_of_accounts lookup.
        const resolvedCodes = new Set<string>(marketingCostSettings.accountCodes);
        const resolvedIds = new Set<string>();

        if (marketingCostSettings.selectedAccounts.length > 0) {
          if (isSagePlatform) {
            const { data: coaRows } = await (supabase as any)
              .from('sage_chart_of_accounts')
              .select('account_code, sage_account_id')
              .eq('organization_id', orgId)
              .in('id', marketingCostSettings.selectedAccounts);
            for (const row of (coaRows ?? []) as any[]) {
              if (row.account_code) resolvedCodes.add(String(row.account_code).trim());
              if (row.sage_account_id) resolvedIds.add(String(row.sage_account_id).trim());
            }
          } else {
            const { data: coaRows } = await (supabase as any)
              .from('iplicit_chart_of_accounts')
              .select('code, account_id')
              .eq('organization_id', orgId)
              .in('id', marketingCostSettings.selectedAccounts);
            for (const row of (coaRows ?? []) as any[]) {
              if (row.code) resolvedCodes.add(row.code.trim());
              if (row.account_id) resolvedIds.add(row.account_id.trim());
            }
          }
        }

        if (cancelled) return;

        if (resolvedCodes.size === 0 && resolvedIds.size === 0) {
          setLocationData([]);
          setLocationDataLoading(false);
          return;
        }

        // 3. Fetch all P&L entries for the date range and group by legal_entity_id
        const codesArr = [...resolvedCodes];
        const idsArr = [...resolvedIds];
        const entityTotals = new Map<string, number>(); // legal_entity_id → sum
        let unmappedTotal = 0;

        const PAGE_SIZE = 1000;

        if (isSagePlatform) {
          // Sage cost data lives in sage_invoice_line_items (joined to
          // sage_invoices for the invoice_date filter). The parent invoice
          // stores platform_integration_id; we resolve it to the Sage business
          // GUID (= legal_entity_id used by locToEntity) via PIO before
          // aggregating per entity.
          const { data: sagePioRows } = await (supabase as any)
            .from('platform_integration_organizations')
            .select('platform_integration_id, platform_org_id')
            .eq('organization_id', orgId)
            .eq('platform_name', 'sage');
          const sagePiiToBusinessId = new Map<string, string>();
          for (const r of (sagePioRows ?? []) as any[]) {
            if (r.platform_integration_id && r.platform_org_id) {
              sagePiiToBusinessId.set(r.platform_integration_id, r.platform_org_id);
            }
          }

          let from = 0;
          let hasMore = true;
          while (hasMore) {
            const { data: rows } = await (supabase as any)
              .from('sage_invoice_line_items')
              .select(`
                line_amount,
                account_code,
                invoice:sage_invoices!inner(
                  invoice_date,
                  platform_integration_id
                )
              `)
              .eq('organization_id', orgId)
              .gte('invoice.invoice_date', defaultFromDate)
              .lte('invoice.invoice_date', defaultToDate + 'T23:59:59')
              .range(from, from + PAGE_SIZE - 1);

            for (const r of (rows ?? []) as any[]) {
              const code = (r.account_code || '').trim();
              const matchesCode = codesArr.some(c => c === code);
              if (!matchesCode) continue;
              const amount = Math.abs(Number(r.line_amount) || 0);
              const pii = r.invoice?.platform_integration_id ?? null;
              const entityId = pii ? (sagePiiToBusinessId.get(pii) || null) : null;
              if (entityId) {
                entityTotals.set(entityId, (entityTotals.get(entityId) ?? 0) + amount);
              } else {
                unmappedTotal += amount;
              }
            }

            hasMore = (rows ?? []).length === PAGE_SIZE;
            from += PAGE_SIZE;
          }
        } else {
          let from = 0;
          let hasMore = true;
          while (hasMore) {
            const { data: rows } = await (supabase as any)
              .from('iplicit_profit_loss')
              .select('amount, account_code, account_id, legal_entity_id')
              .eq('organization_id', orgId)
              .gte('period_date', defaultFromDate)
              .lte('period_date', defaultToDate + 'T23:59:59')
              .range(from, from + PAGE_SIZE - 1);

            for (const r of (rows ?? []) as any[]) {
              const code = (r.account_code || '').trim();
              const id = (r.account_id || '').trim();
              const matchesCode = codesArr.some(c => c === code);
              const matchesId = idsArr.some(i => i === id);
              if (!matchesCode && !matchesId) continue;

              const amount = Math.abs(Number(r.amount) || 0);
              const entityId = r.legal_entity_id ? String(r.legal_entity_id).trim() : null;
              if (entityId) {
                entityTotals.set(entityId, (entityTotals.get(entityId) ?? 0) + amount);
              } else {
                unmappedTotal += amount;
              }
            }

            hasMore = (rows ?? []).length === PAGE_SIZE;
            from += PAGE_SIZE;
          }
        }

        if (cancelled) return;

        // 4. Map back to locations
        const benchmarkPercent = 8.0;
        const allCosts = [...entityTotals.values()].reduce((s, v) => s + v, 0) + unmappedTotal;
        const results = practiceLocations.map((loc: any) => {
          const entityId = locToEntity.get(loc.id);
          const cost = entityId ? (entityTotals.get(entityId) ?? 0) : 0;
          const pct = allCosts > 0 ? (cost / allCosts) * 100 : 0;
          const vsBench = pct - benchmarkPercent / practiceLocations.length;
          return {
            location: loc.location_name,
            city: loc.city || '',
            isPrimary: loc.is_primary,
            totalCost: cost,
            percentOfTotal: pct,
            vsBenchmark: vsBench,
            status: vsBench > 2 ? 'Over Budget' : vsBench < -2 ? 'Under Budget' : 'On Target',
          };
        });

        console.log('[MarketingCosts] Location breakdown:', {
          locToEntity: Object.fromEntries(locToEntity),
          entityTotals: Object.fromEntries(entityTotals),
          unmappedTotal,
          results: results.map(r => ({ loc: r.location, cost: `£${r.totalCost.toFixed(2)}` })),
        });

        if (!cancelled) {
          setLocationData(results);
        }
      } catch (err) {
        console.error('[MarketingCosts] Location breakdown error:', err);
        if (!cancelled) setLocationData([]);
      } finally {
        if (!cancelled) setLocationDataLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [hasInvoiceData, practiceLocations, profile?.current_organization_id, marketingCostSettings.accountCodes, marketingCostSettings.selectedAccounts, defaultFromDate, defaultToDate, isSagePlatform]);

  // ---- Chatbot aiContext enrichments (pre-computed rankings + per-group rollups) ----
  const round2 = (n: number) => Math.round(n * 100) / 100;

  const selectedLocationName = useMemo(() => {
    if (!selectedLocationId) return 'All Locations';
    const match = allAvailableLocations.find((l: any) => l.id === selectedLocationId);
    return match?.location_name || 'All Locations';
  }, [selectedLocationId, allAvailableLocations]);

  const invoiceRollups = useMemo(() => {
    if (isIplicit) return [];
    return allInvoices.map((inv: any) => {
      const total = (inv.LineItems || [])
        .reduce((s: number, li: any) => s + Math.abs((li.LineAmount || 0) + (li.TaxAmount || 0)), 0);
      const firstLi = (inv.LineItems && inv.LineItems[0]) || {};
      return {
        supplier: inv.Contact?.Name || 'Unknown',
        accountCode: firstLi.AccountCode || null,
        accountName: firstLi.AccountCode ? (accountNameMap.get(String(firstLi.AccountCode).trim()) || firstLi.AccountName || null) : (firstLi.AccountName || null),
        dated: inv.Date || null,
        total: round2(total),
        locationName: inv.LocationName || null,
        locationId: inv.SiteId || null,
        invoiceNumber: inv.InvoiceNumber || null,
      };
    });
  }, [isIplicit, allInvoices, accountNameMap]);

  const sortedRollups = useMemo(
    () => [...invoiceRollups].sort((a, b) => b.total - a.total),
    [invoiceRollups],
  );

  const topInvoicesByAmount = useMemo(() => sortedRollups.slice(0, 10), [sortedRollups]);
  const bottomInvoicesByAmount = useMemo(
    () => sortedRollups.filter(r => r.total > 0).slice(-10).reverse(),
    [sortedRollups],
  );

  const topSuppliersByAmount = useMemo(() => {
    const map = new Map<string, { totalAmount: number; invoiceCount: number }>();
    for (const r of invoiceRollups) {
      const key = r.supplier || 'Unknown';
      const ex = map.get(key) || { totalAmount: 0, invoiceCount: 0 };
      ex.totalAmount += r.total;
      ex.invoiceCount += 1;
      map.set(key, ex);
    }
    return Array.from(map.entries())
      .map(([supplier, v]) => ({ supplier, totalAmount: round2(v.totalAmount), invoiceCount: v.invoiceCount }))
      .sort((a, b) => b.totalAmount - a.totalAmount)
      .slice(0, 10);
  }, [invoiceRollups]);

  const byLocationContext = useMemo(() => {
    if (isIplicit) {
      return locationData
        .filter(r => r.totalCost > 0)
        .map(r => ({
          locationName: r.location,
          totalAmount: round2(r.totalCost),
          invoiceCount: 0,
        }))
        .sort((a, b) => b.totalAmount - a.totalAmount);
    }
    const map = new Map<string, { totalAmount: number; invoiceCount: number }>();
    for (const r of invoiceRollups) {
      const key = r.locationName || 'Unknown Location';
      const ex = map.get(key) || { totalAmount: 0, invoiceCount: 0 };
      ex.totalAmount += r.total;
      ex.invoiceCount += 1;
      map.set(key, ex);
    }
    return Array.from(map.entries())
      .map(([locationName, v]) => ({ locationName, totalAmount: round2(v.totalAmount), invoiceCount: v.invoiceCount }))
      .sort((a, b) => b.totalAmount - a.totalAmount);
  }, [isIplicit, locationData, invoiceRollups]);

  const byAccount = useMemo(() => {
    if (isIplicit) {
      const map = new Map<string, { code: string; name: string; totalAmount: number }>();
      for (const e of plCosts.entries) {
        const code = e.account_code || 'Unknown';
        const ex = map.get(code) || { code, name: e.account_name || code, totalAmount: 0 };
        ex.totalAmount += Math.abs(e.amount);
        map.set(code, ex);
      }
      return Array.from(map.values())
        .map(v => ({ accountCode: v.code, accountName: v.name, totalAmount: round2(v.totalAmount) }))
        .sort((a, b) => b.totalAmount - a.totalAmount)
        .slice(0, 10);
    }
    const map = new Map<string, { totalAmount: number }>();
    for (const inv of allInvoices) {
      for (const li of (inv.LineItems || [])) {
        const code = li.AccountCode || 'Unknown';
        const ex = map.get(code) || { totalAmount: 0 };
        ex.totalAmount += Math.abs((li.LineAmount || 0) + (li.TaxAmount || 0));
        map.set(code, ex);
      }
    }
    return Array.from(map.entries())
      .map(([code, v]) => ({
        accountCode: code,
        accountName: accountNameMap.get(String(code).trim()) || code,
        totalAmount: round2(v.totalAmount),
      }))
      .sort((a, b) => b.totalAmount - a.totalAmount)
      .slice(0, 10);
  }, [isIplicit, plCosts.entries, allInvoices, accountNameMap]);

  const aiInvoicesSlice = useMemo(() => {
    if (isIplicit) return [];
    if (allInvoices.length <= 50) return allInvoices;
    const indexed = allInvoices.map((inv: any, idx: number) => {
      const total = (inv.LineItems || [])
        .reduce((s: number, li: any) => s + Math.abs((li.LineAmount || 0) + (li.TaxAmount || 0)), 0);
      return { idx, total };
    });
    indexed.sort((a, b) => b.total - a.total);
    return indexed.slice(0, 50).map(({ idx }) => allInvoices[idx]);
  }, [isIplicit, allInvoices]);

  const aiContextData = {
    allInvoices: aiInvoicesSlice,
    allTotals,
    categoriesData,
    trendData,
    isLiveData: hasLiveData,
    page: 'marketing-costs',
    selectedLocationName,
    period: { from: defaultFromDate, to: defaultToDate },
    totalAmount: round2(Math.abs(allTotals.total)),
    invoiceCount: isIplicit ? plCosts.entries.length : allInvoices.length,
    topInvoicesByAmount,
    bottomInvoicesByAmount,
    topSuppliersByAmount,
    byLocation: byLocationContext,
    byAccount,
  };

  return (
    <MainLayout userRole="admin" aiContext={aiContextData}>
      <Helmet>
        <title>Marketing Costs Analysis</title>
        <meta name="description" content="Marketing costs breakdown by location and category" />
      </Helmet>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Marketing Costs</h1>
            <p className="text-muted-foreground">Marketing costs breakdown by location and category</p>
          </div>
          <div className="flex items-center gap-4">
            {/* Last Synced Info */}
            {lastSyncedAt && (
              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                <Clock className="w-3 h-3" />
                <span>Synced {formatLastSynced(lastSyncedAt)}</span>
              </div>
            )}

            {!isIplicit && (
              <Button
                onClick={handleSyncFromXero}
                disabled={isLoading || isSyncing}
                variant="default"
                className="flex items-center gap-2"
              >
                {isSyncing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
                {isSyncing ? 'Syncing...' : `Sync from ${integrationName}`}
              </Button>
            )}
            <div className="flex items-center gap-2 px-3 py-1.5 bg-chart-5/10 rounded-lg">
              <Megaphone className="w-4 h-4 text-chart-5" />
              <span className="text-sm font-medium text-chart-5">Cost Center</span>
            </div>
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <Card className="border-destructive/50 bg-destructive/5">
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="w-5 h-5" />
                <p className="font-medium">Error loading {integrationName} data: {error}</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Sync Result Display */}
        {syncResult && (
          <Card className="border-green-500/50 bg-green-500/5">
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 text-green-600">
                <CheckCircle2 className="w-5 h-5" />
                <p className="font-medium">
                  {`Sync completed: ${syncResult?.invoicesSaved} invoices, ${syncResult?.lineItemsSaved} line items saved`}
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* AI Summary */}
        <AISummaryCard page="marketing-costs" data={aiContextData} />

        {/* Cost Impact Simulator */}
        <CostImpactSimulator
          currentCost={totalMarketingCosts}
          currentEBITDA={ebitdaImpact}
          percentOfRevenue={percentOfRevenue}
          costCenterName="Marketing Costs"
        />

        {/* Overview KPIs - 4 cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className={hasInvoiceData ? 'border-green-500/30' : ''}>
            <CardContent className="pt-6">
              {isLoading ? (
                <Skeleton className="h-16 w-full" />
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">Total Marketing Costs</p>
                  <div className="flex items-center justify-between mt-1">
                    <p className={`text-2xl font-bold ${!hasInvoiceData ? 'text-muted-foreground' : ''}`}>
                      {hasInvoiceData ? formatCurrencyWhole(totalMarketingCosts) : '--'}
                    </p>
                    {hasInvoiceData && <TrendIndicator value={trend} />}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    {hasInvoiceData ? `${percentOfRevenue}% of revenue` : `Awaiting ${integrationName} data`}
                  </p>
                </>
              )}
            </CardContent>
          </Card>

          <Card className={hasInvoiceData ? 'border-green-500/30' : ''}>
            <CardContent className="pt-6">
              {isLoading ? (
                <Skeleton className="h-16 w-full" />
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">vs Benchmark</p>
                  <div className="flex items-center justify-between mt-1">
                    <p className={`text-2xl font-bold ${!hasInvoiceData ? 'text-muted-foreground' : ''}`}>
                      {hasInvoiceData ? `${benchmark}%` : '--'}
                    </p>
                    {hasInvoiceData && (
                      <TrendIndicator value={percentOfRevenue - benchmark} />
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    Industry standard target
                  </p>
                </>
              )}
            </CardContent>
          </Card>

          <Card className={hasInvoiceData ? 'border-green-500/30' : ''}>
            <CardContent className="pt-6">
              {isLoading ? (
                <Skeleton className="h-16 w-full" />
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    {topCategory ? topCategory.name : 'Top Category'}
                  </p>
                  <div className="flex items-center justify-between mt-1">
                    <p className={`text-2xl font-bold ${!hasInvoiceData ? 'text-muted-foreground' : ''}`}>
                      {topCategory ? formatCurrencyWhole(topCategory.amount) : '--'}
                    </p>
                    <Trash2 className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    {hasInvoiceData && topCategory
                      ? `${((topCategory.amount / totalMarketingCosts) * 100).toFixed(1)}% of marketing costs`
                      : `Awaiting ${integrationName} data`}
                  </p>
                </>
              )}
            </CardContent>
          </Card>

          <Card className={hasInvoiceData ? 'border-warning/50 bg-warning/5' : ''}>
            <CardContent className="pt-6">
              {isLoading ? (
                <Skeleton className="h-16 w-full" />
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">EBITDA Impact</p>
                  <div className="flex items-center justify-between mt-1">
                    <p className={`text-2xl font-bold ${hasInvoiceData ? 'text-warning' : 'text-muted-foreground'}`}>
                      {hasInvoiceData ? formatCurrencyWhole(ebitdaImpact) : '--'}
                    </p>
                    <AlertTriangle className={`w-5 h-5 ${hasInvoiceData ? 'text-warning' : 'text-muted-foreground'}`} />
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    Above benchmark cost drag
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Marketing Cost Categories - Horizontal Bar Chart */}
        <Card className={categoriesData.length > 0 ? 'border-green-500/30' : ''}>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              Marketing Cost Categories
              {categoriesData.length > 0 && (
                <Badge variant="outline" className="text-xs bg-green-500/10 text-green-600">Live</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : categoriesData.length > 0 ? (
              <div className="space-y-4">
                {categoriesData.map((cat, index) => {
                  const maxAmount = Math.max(...categoriesData.map(c => c.amount));
                  const widthPercent = (cat.amount / maxAmount) * 100;
                  return (
                    <div key={index} className="flex items-center gap-4">
                      <div className="w-32 text-sm text-right text-muted-foreground truncate">
                        {cat.name}
                      </div>
                      <div className="flex-1 relative">
                        <div className="h-8 bg-muted rounded overflow-hidden">
                          <div
                            className="h-full bg-green-500 rounded transition-all duration-500"
                            style={{ width: `${widthPercent}%` }}
                          />
                        </div>
                        <div className="absolute inset-0 flex items-center justify-end pr-2">
                          <span className="text-sm font-medium text-foreground">
                            {formatCurrency(cat.amount)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {/* X-axis labels */}
                <div className="flex items-center gap-4 mt-4">
                  <div className="w-32" />
                  <div className="flex-1 flex justify-between text-xs text-muted-foreground">
                    <span>£0</span>
                    <span>{formatCurrency(Math.max(...categoriesData.map(c => c.amount)) / 2)}</span>
                    <span>{formatCurrency(Math.max(...categoriesData.map(c => c.amount)))}</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="h-64 flex items-center justify-center text-muted-foreground">
                <div className="text-center">
                  <Database className="w-12 h-12 mx-auto mb-2 opacity-50" />
                  <p>No category data available</p>
                  <p className="text-sm">Click "Sync from {integrationName}" to fetch data</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Marketing Productivity & Utilization - Progress Bars */}
        <Card className={productivityData.length > 0 ? 'border-green-500/30' : ''}>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              Marketing Productivity & Utilization
              {productivityData.length > 0 && (
                <Badge variant="outline" className="text-xs bg-green-500/10 text-green-600">Live</Badge>
              )}
              <ProductivityTargetPopover
                category="marketing"
                onEffectiveMultiplierChange={setProductivityTargetMultiplier}
              />
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : productivityData.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {productivityData.map((item, index) => (
                  <div key={index} className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium">{item.role}</span>
                      <span className="text-sm text-muted-foreground">{item.utilization}% util</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-green-500 rounded-full transition-all duration-500"
                        style={{ width: `${item.utilization}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>{item.current}</span>
                      <span>Target: {item.target}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Database className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>No productivity data available</p>
                <p className="text-sm">Click "Sync from {integrationName}" to fetch data</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Monthly Trend vs Budget & Cost Category Trends - Side by Side */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Monthly Trend vs Budget */}
          <Card className={trendData.length > 0 ? 'border-green-500/30' : ''}>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                Monthly Trend vs Budget
                {trendData.length > 0 && (
                  <Badge variant="outline" className="text-xs bg-green-500/10 text-green-600">Live</Badge>
                )}
                <MonthlyTrendSettingsPopover
                  category="marketing"
                  onEffectiveMultipliersChange={handleTrendMultipliersChange}
                />
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-64 w-full" />
              ) : trendData.length > 0 ? (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trendData}>
                      <XAxis dataKey="month" axisLine={false} tickLine={false} />
                      <YAxis axisLine={false} tickLine={false} tickFormatter={(v) => `£${v/1000}K`} />
                      <Tooltip content={<TrendChartTooltip />} />
                      <Legend />
                      <Line type="monotone" dataKey="actual" stroke="hsl(var(--chart-5))" strokeWidth={2} dot={{ r: 3 }} name="Actual" />
                      <Line type="monotone" dataKey="budget" stroke="hsl(var(--chart-3))" strokeWidth={2} strokeDasharray="5 5" dot={{ r: 3 }} name="Budget" />
                      <Line type="monotone" dataKey="benchmark" stroke="hsl(var(--chart-4))" strokeWidth={2} strokeDasharray="3 3" dot={{ r: 3 }} name="Benchmark" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-64 flex items-center justify-center text-muted-foreground">
                  <div className="text-center">
                    <Database className="w-12 h-12 mx-auto mb-2 opacity-50" />
                    <p>No trend data available</p>
                    <p className="text-sm">Click "Sync from {integrationName}" to fetch data</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Cost Category Trends */}
          <Card className={categoryTrends.length > 0 ? 'border-green-500/30' : ''}>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <span className="bg-primary text-primary-foreground px-2 py-1 rounded text-sm">Cost Category Trends</span>
                {categoryTrends.length > 0 && (
                  <Badge variant="outline" className="text-xs bg-green-500/10 text-green-600">Live</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-64 w-full" />
              ) : categoryTrends.length > 0 ? (
                <div className="space-y-4">
                  {categoryTrends.map((cat, index) => (
                    <div key={index} className="space-y-1">
                      <div className="flex justify-between items-center">
                        <span className="text-sm font-medium">{cat.name}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{formatCurrency(cat.amount)}</span>
                          <TrendIndicator value={cat.trend} />
                        </div>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-green-500 rounded-full transition-all duration-500"
                          style={{ width: `${cat.progress}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="h-64 flex items-center justify-center text-muted-foreground">
                  <div className="text-center">
                    <Database className="w-12 h-12 mx-auto mb-2 opacity-50" />
                    <p>No trend data available</p>
                    <p className="text-sm">Click "Sync from {integrationName}" to fetch data</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Marketing Costs by Location */}
        <Card className={locationData.length > 0 ? 'border-green-500/30' : ''}>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <MapPin className="w-5 h-5" />
              Marketing Costs by Location
              {locationData.length > 0 && (
                <>
                  <Badge variant="outline" className="text-xs bg-green-500/10 text-green-600">Live</Badge>
                  <span className="text-sm font-normal text-muted-foreground ml-2">
                    ({locationData.length} location{locationData.length !== 1 ? 's' : ''})
                  </span>
                </>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading || locationDataLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : locationData.length > 0 ? (
              <>
                <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                  <table className="w-full">
                    <thead className="sticky top-0 bg-card z-10">
                      <tr className="border-b border-border">
                        <th className="text-left py-3 px-4 font-medium text-muted-foreground bg-card">Location</th>
                        <th className="text-right py-3 px-4 font-medium text-muted-foreground bg-card">Total Cost</th>
                        <th className="text-right py-3 px-4 font-medium text-muted-foreground bg-card">% of Total</th>
                        <th className="text-right py-3 px-4 font-medium text-muted-foreground bg-card">vs Benchmark</th>
                        <th className="text-center py-3 px-4 font-medium text-muted-foreground bg-card">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {locationData
                        .slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE)
                        .map((row, index) => (
                          <tr key={index} className="border-b border-border/50 hover:bg-muted/50">
                            <td className="py-3 px-4">
                              <div className="font-medium">{row.location}</div>
                              {row.city && <div className="text-xs text-muted-foreground">{row.city}</div>}
                            </td>
                            <td className="text-right py-3 px-4">{formatCurrency(row.totalCost)}</td>
                            <td className="text-right py-3 px-4">{row.percentOfTotal.toFixed(1)}%</td>
                            <td className="text-right py-3 px-4">
                              <span className={row.vsBenchmark > 0 ? 'text-red-500' : 'text-green-500'}>
                                {row.vsBenchmark > 0 ? '+' : ''}{row.vsBenchmark.toFixed(1)}%
                              </span>
                            </td>
                            <td className="text-center py-3 px-4">
                              <Badge
                                variant="outline"
                                className={
                                  row.status === 'Over Budget'
                                    ? 'bg-red-500/10 text-red-600 border-red-500/30'
                                    : row.status === 'Under Budget'
                                    ? 'bg-green-500/10 text-green-600 border-green-500/30'
                                    : 'bg-yellow-500/10 text-yellow-600 border-yellow-500/30'
                                }
                              >
                                {row.status}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                {/* Pagination */}
                {locationData.length > ITEMS_PER_PAGE && (
                  <div className="flex items-center justify-between mt-4 pt-4 border-t border-border">
                    <div className="text-sm text-muted-foreground">
                      Showing {((currentPage - 1) * ITEMS_PER_PAGE) + 1} to {Math.min(currentPage * ITEMS_PER_PAGE, locationData.length)} of {locationData.length} locations
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                      >
                        <ChevronLeft className="w-4 h-4" />
                        Previous
                      </Button>
                      <div className="flex items-center gap-1">
                        {Array.from({ length: Math.ceil(locationData.length / ITEMS_PER_PAGE) }, (_, i) => i + 1).map(page => (
                          <Button
                            key={page}
                            variant={currentPage === page ? 'default' : 'outline'}
                            size="sm"
                            className="w-8 h-8 p-0"
                            onClick={() => setCurrentPage(page)}
                          >
                            {page}
                          </Button>
                        ))}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage(p => Math.min(Math.ceil(locationData.length / ITEMS_PER_PAGE), p + 1))}
                        disabled={currentPage >= Math.ceil(locationData.length / ITEMS_PER_PAGE)}
                      >
                        Next
                        <ChevronRight className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="h-64 flex items-center justify-center text-muted-foreground">
                <div className="text-center">
                  <MapPin className="w-12 h-12 mx-auto mb-2 opacity-50" />
                  <p>No practice locations found</p>
                  <p className="text-sm">Add locations in Organization Settings or sync from Dentally</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
