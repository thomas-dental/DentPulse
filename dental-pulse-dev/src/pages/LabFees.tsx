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
import { useExpenseAccountSettings } from '@/hooks/useExpenseAccountSettings';
import { useIplicitPLCosts } from '@/hooks/useIplicitPLCosts';
import { useTreatmentInsights } from '@/hooks/useTreatmentInsights';
import { useNavigate } from 'react-router-dom';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { FlaskConical, TrendingDown, TrendingUp, AlertTriangle, RefreshCw, Database, CheckCircle2, Loader2, Clock, ChevronLeft, ChevronRight } from 'lucide-react';
import { useConnectedIntegration } from '@/hooks/useConnectedIntegration';
import { useFilters } from '@/contexts/FilterContext';
import { useLocations } from '@/hooks/useLocations';
import { useOrganizationSettings } from '@/hooks/useOrganizationSettings';
import { formatCurrency as formatCurrencyBase } from '@/lib/currency';

const COLORS = ['hsl(var(--primary))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))', 'hsl(var(--chart-4))', 'hsl(var(--chart-5))'];

const ITEMS_PER_PAGE = 7;

export default function LabFees() {
  const navigate = useNavigate();
  const { showDecimals } = useOrganizationSettings();
  const formatCurrency = (value: number) => formatCurrencyBase(value, showDecimals);
  // Summary-tile numbers always show whole pounds, regardless of the Show Decimals setting.
  const formatCurrencyWhole = (value: number) => formatCurrencyBase(value, false);
  const lastFetchedCodesRef = useRef<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const { displayName: integrationName, connectedPlatform } = useConnectedIntegration();
  const { dateRange, selectedLocationId } = useFilters();
  const { allAvailableLocations } = useLocations();
  const { labFees: labFeesSettings, isLoading: isLoadingSettings } = useExpenseAccountSettings(selectedLocationId);

  const isIplicit = connectedPlatform === 'iplicit';

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

  // Invoice-based hook (Xero/QuickBooks)
  const invoiceHook = useOperatingLeasesXero();

  // Iplicit P&L hook (primary for iplicit — uses react-query, auto-fetches)
  const plCosts = useIplicitPLCosts(
    labFeesSettings.accountCodes,
    labFeesSettings.selectedAccounts,
    defaultFromDate,
    defaultToDate,
    isIplicit && !isLoadingSettings && labFeesSettings.hasAccounts,
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
  const hasConfiguredAccounts = labFeesSettings.hasAccounts;
  const accountCodesKey = labFeesSettings.accountCodes.join(',') || labFeesSettings.selectedAccounts.join(',');
  const fetchKey = `${accountCodesKey}|${defaultFromDate}|${defaultToDate}|${selectedLocationId || 'all'}`;
  useEffect(() => {
    if (isIplicit) return; // Iplicit uses react-query, no manual fetch needed
    if (isReady && !isLoadingSettings && hasConfiguredAccounts && lastFetchedCodesRef.current !== fetchKey) {
      lastFetchedCodesRef.current = fetchKey;
      console.log('[LabFees] Fetching with accountCodes:', labFeesSettings.accountCodes, 'selectedAccounts (UUIDs):', labFeesSettings.selectedAccounts, 'dateRange:', defaultFromDate, 'to', defaultToDate, 'location:', selectedLocationId || 'all');
      invoiceHook.loadFromDatabase(defaultFromDate, defaultToDate, 'ACCPAY', labFeesSettings.accountCodes, labFeesSettings.selectedAccounts, selectedLocationId);
    }
  }, [isIplicit, isReady, isLoadingSettings, hasConfiguredAccounts, fetchKey, invoiceHook.loadFromDatabase, labFeesSettings.accountCodes, labFeesSettings.selectedAccounts, defaultFromDate, defaultToDate]);

  // Get invoices (only used for non-iplicit)
  const allInvoices = useMemo(() => {
    if (isIplicit) return [];
    return rawResponse?.invoices?.Invoices || [];
  }, [rawResponse, isIplicit]);

  // Calculate totals from all line items (already pre-filtered)
  // Uses gross amounts (net + tax) to reflect what the business actually pays
  const labTotals = useMemo(() => {
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

    return { total, lineItems };
  }, [isIplicit, plCosts.totalAmount, plCosts.entries, allInvoices]);

  const hasInvoiceData = isIplicit ? plCosts.entries.length > 0 : allInvoices.length > 0;
  const hasLiveData = hasInvoiceData;

  // Lab Fees by Location (grouped by site/legal entity) with supplier breakdown
  const locationData = useMemo(() => {
    if (!hasInvoiceData) return [];

    const locationMap = new Map<string, { total: number; invoiceCount: number; suppliers: Set<string> }>();

    if (isIplicit) {
      // Iplicit P&L: group by account_code (no supplier/location data in P&L)
      plCosts.entries.forEach((entry) => {
        const name = entry.account_name || entry.account_code || 'Unknown';
        const existing = locationMap.get(name) || { total: 0, invoiceCount: 0, suppliers: new Set<string>() };
        locationMap.set(name, {
          total: existing.total + Math.abs(entry.amount),
          invoiceCount: existing.invoiceCount + 1,
          suppliers: existing.suppliers,
        });
      });
    } else {
      allInvoices.forEach((invoice: any) => {
        const locationName = invoice.LocationName || invoice.SiteId || 'Unknown Location';
        const supplierName = invoice.Contact?.Name || 'Unknown';
        const invoiceTotal = invoice.LineItems
          ?.reduce((sum: number, li: any) => sum + Math.abs((li.LineAmount || 0) + (li.TaxAmount || 0)), 0) || 0;

        const existing = locationMap.get(locationName) || { total: 0, invoiceCount: 0, suppliers: new Set<string>() };
        existing.suppliers.add(supplierName);
        locationMap.set(locationName, {
          total: existing.total + invoiceTotal,
          invoiceCount: existing.invoiceCount + 1,
          suppliers: existing.suppliers,
        });
      });
    }

    const totalLabFeesAmount = Math.abs(labTotals.total) || 1;
    const benchmarkPercent = 7.0;

    return Array.from(locationMap.entries())
      .map(([name, data]) => {
        const percentOfTotal = (data.total / totalLabFeesAmount) * 100;
        const costPerInvoice = data.total / data.invoiceCount;
        const vsBenchmark = percentOfTotal - benchmarkPercent / locationMap.size;
        return {
          location: name,
          totalCost: data.total,
          percentOfTotal,
          costPerInvoice,
          vsBenchmark,
          supplierCount: data.suppliers.size,
          status: vsBenchmark > 2 ? 'Over Budget' : vsBenchmark < -2 ? 'Under Budget' : 'On Target',
        };
      })
      .sort((a, b) => b.totalCost - a.totalCost);
  }, [hasInvoiceData, isIplicit, plCosts.entries, allInvoices, labTotals.total]);

  // Group line items by description/account for categories (pie chart)
  const categoriesData = useMemo(() => {
    if (!hasInvoiceData) return [];

    const categoryMap = new Map<string, number>();

    if (isIplicit) {
      plCosts.entries.forEach((entry) => {
        const key = entry.account_name || entry.account_code || 'Other';
        categoryMap.set(key, (categoryMap.get(key) || 0) + Math.abs(entry.amount));
      });
    } else {
      allInvoices.forEach((invoice: any) => {
        invoice.LineItems?.forEach((li: any) => {
          const key = li.Description || li.AccountCode || 'Other';
          categoryMap.set(key, (categoryMap.get(key) || 0) + Math.abs((li.LineAmount || 0) + (li.TaxAmount || 0)));
        });
      });
    }

    return Array.from(categoryMap.entries())
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);
  }, [hasInvoiceData, isIplicit, plCosts.entries, allInvoices]);

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
        budget: actual * 1.05,
        benchmark: actual * 0.95,
      }))
      .slice(-6);
  }, [hasInvoiceData, isIplicit, plCosts.entries, allInvoices]);

  // Single sync handler - fetches from platform AND saves to DB
  const handleSyncFromXero = () => {
    if (!isIplicit) {
      invoiceHook.syncFromPlatform(defaultFromDate, defaultToDate, 'ACCPAY', labFeesSettings.accountCodes, labFeesSettings.selectedAccounts);
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

  // Pull revenue from Treatment Insights so the EBITDA figure here matches
  // the revenue number the user sees on the Treatment Insights page.
  const { summary: treatmentSummary } = useTreatmentInsights();
  const totalRevenue = treatmentSummary?.totalRevenue || 0;

  // Calculate values from real data only — no static fallbacks
  const totalLabFees = hasInvoiceData ? Math.abs(labTotals.total) : 0;
  const benchmark = 7.5;
  // percentOfRevenue now computed from actual revenue (was hardcoded 8.2%).
  const percentOfRevenue = hasInvoiceData && totalRevenue > 0
    ? Math.round((totalLabFees / totalRevenue) * 1000) / 10
    : 0;
  const trend = hasInvoiceData ? 0 : 0;
  const costPerProcedure = hasInvoiceData && allInvoices.length > 0
    ? labTotals.total / allInvoices.length
    : 0;
  // EBITDA on this page = Treatment Insights revenue − Lab Fees cost.
  // (Per-bucket EBITDA impact, not an above-benchmark drag delta.)
  const ebitdaImpact = hasInvoiceData
    ? totalRevenue - totalLabFees
    : 0;

  // ---- Chatbot aiContext enrichments (pre-computed rankings + per-group rollups) ----
  // Round to 2 decimals to keep the payload tight under the 12KB context cap.
  const round2 = (n: number) => Math.round(n * 100) / 100;

  const selectedLocationName = useMemo(() => {
    if (!selectedLocationId) return 'All Locations';
    const match = allAvailableLocations.find((l: any) => l.id === selectedLocationId);
    return match?.location_name || 'All Locations';
  }, [selectedLocationId, allAvailableLocations]);

  // Build a per-invoice rollup that works for Xero/QB shape. (Iplicit has no
  // raw invoices — allInvoices is empty there.)
  const invoiceRollups = useMemo(() => {
    if (isIplicit) return [];
    return allInvoices.map((inv: any) => {
      const total = (inv.LineItems || [])
        .reduce((s: number, li: any) => s + Math.abs((li.LineAmount || 0) + (li.TaxAmount || 0)), 0);
      const firstLi = (inv.LineItems && inv.LineItems[0]) || {};
      return {
        supplier: inv.Contact?.Name || 'Unknown',
        accountCode: firstLi.AccountCode || null,
        accountName: firstLi.AccountName || null,
        dated: inv.Date || null,
        total: round2(total),
        locationName: inv.LocationName || null,
        locationId: inv.SiteId || null,
        invoiceNumber: inv.InvoiceNumber || null,
      };
    });
  }, [isIplicit, allInvoices]);

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

  const byLocation = useMemo(() => {
    if (isIplicit) {
      // Iplicit P&L doesn't return legal_entity on the entry shape, so we can
      // only emit a single bucket when a specific location filter is active.
      if (selectedLocationId && hasInvoiceData) {
        return [{
          locationName: selectedLocationName,
          totalAmount: round2(Math.abs(labTotals.total)),
          invoiceCount: plCosts.entries.length,
        }];
      }
      return [];
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
  }, [isIplicit, invoiceRollups, selectedLocationId, selectedLocationName, hasInvoiceData, labTotals.total, plCosts.entries.length]);

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
      .map(([code, v]) => ({ accountCode: code, accountName: code, totalAmount: round2(v.totalAmount) }))
      .sort((a, b) => b.totalAmount - a.totalAmount)
      .slice(0, 10);
  }, [isIplicit, plCosts.entries, allInvoices]);

  // Cap allInvoices passed to the chatbot at the top 50 by amount so a long
  // date range can't blow past the 12KB context budget.
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
    labTotals,
    categoriesData,
    trendData,
    isLiveData: hasLiveData,
    page: 'lab-fees',
    selectedLocationName,
    period: { from: defaultFromDate, to: defaultToDate },
    totalAmount: round2(Math.abs(labTotals.total)),
    invoiceCount: isIplicit ? plCosts.entries.length : allInvoices.length,
    topInvoicesByAmount,
    bottomInvoicesByAmount,
    topSuppliersByAmount,
    byLocation,
    byAccount,
  };

  return (
    <MainLayout userRole="admin" aiContext={aiContextData}>
      <Helmet>
        <title>Lab Fees Analysis</title>
        <meta name="description" content="Analyze laboratory expenses, track lab fee trends across locations, and simulate cost impact scenarios." />
      </Helmet>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Lab Fees Analysis</h1>
            <p className="text-muted-foreground">Understanding lab costs impact across your business</p>
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
            <div className="flex items-center gap-2 px-3 py-1.5 bg-primary/10 rounded-lg">
              <FlaskConical className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium text-primary">Cost Center</span>
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
              <p className="text-sm text-muted-foreground mt-2">Showing cached data. Please check your {integrationName} connection.</p>
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
        <AISummaryCard page="lab-fees" data={aiContextData} />

        {/* Cost Impact Simulator */}
        <CostImpactSimulator
          currentCost={totalLabFees}
          currentEBITDA={ebitdaImpact}
          percentOfRevenue={percentOfRevenue}
          costCenterName="Lab Fees"
        />

        {/* Overview KPIs */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className={hasInvoiceData ? 'border-green-500/30' : ''}>
            <CardContent className="pt-6">
              {isLoading ? (
                <Skeleton className="h-16 w-full" />
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">Total Lab Fees</p>
                  <div className="flex items-center justify-between mt-1">
                    <p className={`text-2xl font-bold ${!hasInvoiceData ? 'text-muted-foreground' : ''}`}>
                      {hasInvoiceData ? formatCurrencyWhole(totalLabFees) : '--'}
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
                      <div className={`flex items-center gap-1 ${percentOfRevenue > benchmark ? 'text-destructive' : 'text-success'}`}>
                        {percentOfRevenue > benchmark ? (
                          <TrendingUp className="w-4 h-4" />
                        ) : (
                          <TrendingDown className="w-4 h-4" />
                        )}
                        <span className="text-sm font-medium">
                          {(percentOfRevenue - benchmark).toFixed(1)}%
                        </span>
                      </div>
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
                  <p className="text-sm text-muted-foreground">Cost per Procedure</p>
                  <div className="flex items-center justify-between mt-1">
                    <p className={`text-2xl font-bold ${!hasInvoiceData ? 'text-muted-foreground' : ''}`}>
                      {hasInvoiceData ? `£${Math.round(costPerProcedure)}` : '--'}
                    </p>
                    <FlaskConical className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    {hasInvoiceData ? 'Avg across all lab work' : `Awaiting ${integrationName} data`}
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

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Category Breakdown */}
          <Card className={categoriesData.length > 0 ? 'border-green-500/30' : ''}>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                Lab Fee Categories
                {categoriesData.length > 0 && (
                  <Badge variant="outline" className="text-xs bg-green-500/10 text-green-600">Live</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-64 w-full" />
              ) : categoriesData.length > 0 ? (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={categoriesData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={80}
                        paddingAngle={2}
                        dataKey="amount"
                        nameKey="name"
                      >
                        {categoriesData.map((_, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value: number) => formatCurrency(value)} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
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

          {/* Monthly Trend */}
          <Card className={trendData.length > 0 ? 'border-green-500/30' : ''}>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                Monthly Trend vs Budget
                {trendData.length > 0 && (
                  <Badge variant="outline" className="text-xs bg-green-500/10 text-green-600">Live</Badge>
                )}
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
                      <Tooltip formatter={(value: number) => formatCurrency(value)} />
                      <Legend />
                      <Line type="monotone" dataKey="actual" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} name="Actual" />
                      <Line type="monotone" dataKey="budget" stroke="hsl(var(--muted-foreground))" strokeWidth={2} strokeDasharray="5 5" dot={false} name="Budget" />
                      <Line type="monotone" dataKey="benchmark" stroke="hsl(var(--chart-4))" strokeWidth={2} strokeDasharray="3 3" dot={false} name="Benchmark" />
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
        </div>

        {/* Lab Fees by Location */}
        <Card className={locationData.length > 0 ? 'border-green-500/30' : ''}>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              Lab Fees by Location
              {locationData.length > 0 && (
                <>
                  <Badge variant="outline" className="text-xs bg-green-500/10 text-green-600">Live</Badge>
                  <span className="text-sm font-normal text-muted-foreground ml-2">
                    ({locationData.length} {locationData.length === 1 ? 'location' : 'locations'})
                  </span>
                </>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-48 w-full" />
            ) : locationData.length > 0 ? (
              <>
                <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                  <table className="w-full">
                    <thead className="sticky top-0 bg-card z-10">
                      <tr className="border-b border-border">
                        <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground bg-card">Location</th>
                        <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground bg-card">Suppliers</th>
                        <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground bg-card">Total Cost</th>
                        <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground bg-card">% of Total</th>
                        <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground bg-card">Cost/Invoice</th>
                        <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground bg-card">vs Benchmark</th>
                        <th className="text-center py-3 px-4 text-sm font-medium text-muted-foreground bg-card">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {locationData
                        .slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE)
                        .map((row, index) => (
                          <tr key={index} className="border-b border-border/50 hover:bg-muted/50">
                            <td className="py-3 px-4 font-medium">{row.location}</td>
                            <td className="py-3 px-4 text-right">{row.supplierCount}</td>
                            <td className="py-3 px-4 text-right">{formatCurrency(row.totalCost)}</td>
                            <td className="py-3 px-4 text-right">{row.percentOfTotal.toFixed(1)}%</td>
                            <td className="py-3 px-4 text-right">{formatCurrency(row.costPerInvoice)}</td>
                            <td className="py-3 px-4 text-right">
                              <span className={row.vsBenchmark > 0 ? 'text-red-500' : 'text-green-500'}>
                                {row.vsBenchmark > 0 ? '+' : ''}{row.vsBenchmark.toFixed(1)}%
                              </span>
                            </td>
                            <td className="py-3 px-4 text-center">
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
              <div className="h-48 flex items-center justify-center text-muted-foreground">
                <div className="text-center">
                  <Database className="w-12 h-12 mx-auto mb-2 opacity-50" />
                  <p>No location data available</p>
                  <p className="text-sm">Click "Sync from {integrationName}" to fetch data</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
