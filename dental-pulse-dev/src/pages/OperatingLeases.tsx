import { useMemo, useEffect, useRef, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { MainLayout } from '@/components/layout/MainLayout';
import { AISummaryCard } from '@/components/ai/AISummaryCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendIndicator } from '@/components/dashboard/TrendIndicator';
import { StatusBadge } from '@/components/dashboard/StatusBadge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { CostImpactSimulator } from '@/components/costs/CostImpactSimulator';
import { useOperatingLeasesXero } from '@/hooks/useOperatingLeasesXero';
import { useIplicitPLCosts } from '@/hooks/useIplicitPLCosts';
import { useTreatmentInsights } from '@/hooks/useTreatmentInsights';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
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
import {
  Building2,
  TrendingDown,
  TrendingUp,
  AlertTriangle,
  Calendar,
  RefreshCw,
  Database,
  CheckCircle2,
  Loader2,
  Clock,
  ChevronLeft,
  ChevronRight,
  Car,
  Laptop,
  Cog
} from 'lucide-react';
import { useConnectedIntegration } from '@/hooks/useConnectedIntegration';
import { useExpenseAccountSettings } from '@/hooks/useExpenseAccountSettings';
import { useFilters } from '@/contexts/FilterContext';
import { useLocations } from '@/hooks/useLocations';
import { useOrganizationSettings } from '@/hooks/useOrganizationSettings';
import { formatCurrency as formatCurrencyBase } from '@/lib/currency';

const COLORS = ['hsl(var(--chart-3))', 'hsl(var(--chart-4))', 'hsl(var(--chart-5))', 'hsl(var(--primary))'];

// Lease category keywords for matching line items
const LEASE_KEYWORDS = {
  building: ['rent', 'lease', 'occupancy', 'premises', 'property', 'rates', 'service charge', 'building'],
  equipment: ['equipment hire', 'equipment lease', 'dental equipment', 'chair', 'x-ray', 'autoclave'],
  vehicle: ['motor', 'vehicle', 'car lease', 'car hire', 'fuel', 'mileage', 'travel'],
  it_software: ['software', 'subscription', 'saas', 'cloud', 'license', 'microsoft', 'xero', 'it', 'computer'],
};

const CATEGORY_CONFIG: Record<string, { displayName: string; color: string; icon: any }> = {
  building: { displayName: 'Building Leases', color: COLORS[0], icon: Building2 },
  equipment: { displayName: 'Equipment Leases', color: COLORS[1], icon: Cog },
  vehicle: { displayName: 'Vehicle Leases', color: COLORS[2], icon: Car },
  it_software: { displayName: 'IT & Software', color: COLORS[3], icon: Laptop },
  other: { displayName: 'Other Leases', color: 'hsl(var(--muted))', icon: Building2 },
};

const ITEMS_PER_PAGE = 7;

// Helper function to determine lease category from description/account
function determineLeaseCategory(description: string, accountCode: string, accountName: string): string | null {
  const searchText = `${description} ${accountName}`.toLowerCase();

  for (const [category, keywords] of Object.entries(LEASE_KEYWORDS)) {
    if (keywords.some(keyword => searchText.includes(keyword))) {
      return category;
    }
  }

  // Check common account codes for leases
  const leaseAccountCodes = ['460', '461', '462', '463', '470', '471', '480', '481', '490', '491'];
  if (leaseAccountCodes.includes(accountCode)) {
    if (['460', '461', '462', '463'].includes(accountCode)) return 'building';
    if (['470', '471'].includes(accountCode)) return 'equipment';
    if (['480', '481'].includes(accountCode)) return 'vehicle';
    if (['490', '491'].includes(accountCode)) return 'it_software';
  }

  return null;
}

interface LeaseMaster {
  id: string;
  lease_name: string;
  lease_reference: string | null;
  lease_description: string | null;
  lease_category: string;
  location_name: string | null;
  xero_contact_name: string | null;
  monthly_rent: number;
  lease_start_date: string | null;
  lease_end_date: string;
  notice_period_months: number;
  has_renewal_option: boolean;
  currency: string | null;
  status: string;
}

export default function OperatingLeases() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { showDecimals } = useOrganizationSettings();
  const formatCurrency = (value: number) => formatCurrencyBase(value, showDecimals);
  // Summary-tile numbers always show whole pounds, regardless of the Show Decimals setting.
  const formatCurrencyWhole = (value: number) => formatCurrencyBase(value, false);
  const lastFetchedCodesRef = useRef<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const { displayName: integrationName, connectedPlatform } = useConnectedIntegration();
  const { dateRange, selectedLocationId } = useFilters();
  const { allAvailableLocations } = useLocations();
  const { operatingLease: leaseSettings, isLoading: isLoadingSettings } = useExpenseAccountSettings(selectedLocationId);
  const [leaseExpirations, setLeaseExpirations] = useState<LeaseMaster[]>([]);
  const [benchmark, setBenchmark] = useState(12.0); // Default benchmark

  const isIplicit = connectedPlatform === 'iplicit';

  // Use date range from filter context — MUST be before hook calls
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
    leaseSettings.accountCodes,
    leaseSettings.selectedAccounts,
    defaultFromDate,
    defaultToDate,
    isIplicit && !isLoadingSettings && leaseSettings.hasAccounts,
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
  const hasConfiguredAccounts = leaseSettings.hasAccounts;
  const accountCodesKey = leaseSettings.accountCodes.join(',') || leaseSettings.selectedAccounts.join(',');
  const fetchKey = `${accountCodesKey}|${defaultFromDate}|${defaultToDate}|${selectedLocationId || 'all'}`;
  useEffect(() => {
    if (isIplicit) return; // Iplicit uses react-query, no manual fetch needed
    if (isReady && !isLoadingSettings && hasConfiguredAccounts && lastFetchedCodesRef.current !== fetchKey) {
      lastFetchedCodesRef.current = fetchKey;
      invoiceHook.loadFromDatabase(defaultFromDate, defaultToDate, 'ACCPAY', leaseSettings.accountCodes, leaseSettings.selectedAccounts, selectedLocationId);
    }
  }, [isIplicit, isReady, isLoadingSettings, hasConfiguredAccounts, fetchKey, invoiceHook.loadFromDatabase, leaseSettings.accountCodes, leaseSettings.selectedAccounts, defaultFromDate, defaultToDate]);

  // Fetch lease expirations from lease_master table
  useEffect(() => {
    async function fetchLeaseExpirations() {
      if (!profile?.current_organization_id) return;

      try {
        const { data, error } = await (supabase as any)
          .from('lease_master')
          .select('*')
          .eq('organization_id', profile.current_organization_id)
          .in('status', ['active', 'expiring_soon'])
          .order('lease_end_date', { ascending: true });

        if (!error && data) {
          setLeaseExpirations(data);
        }
      } catch (err) {
        console.log('[OperatingLeases] lease_master table may not exist yet');
      }
    }

    fetchLeaseExpirations();
  }, [profile?.current_organization_id]);

  // Fetch benchmark from industry_benchmarks table
  useEffect(() => {
    async function fetchBenchmark() {
      try {
        const { data, error } = await (supabase as any)
          .from('industry_benchmarks')
          .select('benchmark_value')
          .eq('metric_name', 'operating_leases_pct_revenue')
          .eq('is_active', true)
          .single();

        if (!error && data) {
          setBenchmark(data.benchmark_value * 100); // Convert from decimal to percentage
        }
      } catch (err) {
        console.log('[OperatingLeases] Using default benchmark');
      }
    }

    fetchBenchmark();
  }, []);

  // Get ALL invoices from Xero (ACCPAY = bills) — only used for non-iplicit
  const allInvoices = useMemo(() => {
    if (isIplicit) return [];
    const invoices = rawResponse?.invoices?.Invoices || [];
    console.log('[OperatingLeases] Total invoices received:', invoices.length);
    return invoices;
  }, [rawResponse, isIplicit]);

  // Filter and categorize line items for lease expenses
  const leaseData = useMemo(() => {
    if (isIplicit) {
      // Iplicit: use P&L data (amounts are negative for costs)
      const categoryTotals: Record<string, number> = {
        building: 0,
        equipment: 0,
        vehicle: 0,
        it_software: 0,
        other: 0,
      };
      const leaseLineItems: any[] = [];
      let totalLeaseExpenses = 0;

      plCosts.entries.forEach((entry) => {
        const category = determineLeaseCategory('', entry.account_code, entry.account_name);
        const resolvedCategory = category || 'other';
        const amount = Math.abs(entry.amount);
        totalLeaseExpenses += amount;
        categoryTotals[resolvedCategory] = (categoryTotals[resolvedCategory] || 0) + amount;

        leaseLineItems.push({
          leaseCategory: resolvedCategory,
          account_code: entry.account_code,
          account_name: entry.account_name,
          amount,
          period_date: entry.period_date,
        });
      });

      return { lineItems: leaseLineItems, total: totalLeaseExpenses, categoryTotals };
    }

    const leaseLineItems: any[] = [];
    let totalLeaseExpenses = 0;
    const categoryTotals: Record<string, number> = {
      building: 0,
      equipment: 0,
      vehicle: 0,
      it_software: 0,
      other: 0,
    };

    allInvoices.forEach((invoice: any) => {
      if (invoice.LineItems) {
        invoice.LineItems.forEach((lineItem: any) => {
          const category = determineLeaseCategory(
            lineItem.Description || '',
            lineItem.AccountCode || '',
            lineItem.AccountName || ''
          );

          const resolvedCategory = category || 'other';
          const amount = Math.abs((lineItem.LineAmount || 0) + (lineItem.TaxAmount || 0));
          totalLeaseExpenses += amount;
          categoryTotals[resolvedCategory] += amount;

          leaseLineItems.push({
            ...lineItem,
            leaseCategory: resolvedCategory,
            invoiceId: invoice.InvoiceID,
            invoiceNumber: invoice.InvoiceNumber,
            contactName: invoice.Contact?.Name,
            invoiceDate: invoice.Date,
          });
        });
      }
    });

    console.log('[OperatingLeases] Lease line items found:', leaseLineItems.length, 'Total:', totalLeaseExpenses);
    return { lineItems: leaseLineItems, total: totalLeaseExpenses, categoryTotals };
  }, [isIplicit, plCosts.entries, allInvoices]);

  const hasLeaseData = isIplicit ? plCosts.entries.length > 0 : leaseData.lineItems.length > 0;
  const totalLeaseCosts = leaseData.total;

  // Single sync handler - fetches from connected platform AND saves to DB
  const handleSync = () => {
    if (!isIplicit) {
      invoiceHook.syncFromPlatform(defaultFromDate, defaultToDate, 'ACCPAY', leaseSettings.accountCodes, leaseSettings.selectedAccounts);
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

  // Calculate KPI values.
  // Revenue from Treatment Insights so EBITDA here matches that page.
  const { summary: treatmentSummary } = useTreatmentInsights();
  const totalRevenue = treatmentSummary?.totalRevenue || 0;
  const percentOfRevenue = hasLeaseData && totalRevenue > 0
    ? Math.round((totalLeaseCosts / totalRevenue) * 1000) / 10
    : 0;
  const trend = hasLeaseData ? 0.8 : 0;
  // EBITDA = Treatment Insights revenue − this page's cost bucket.
  const ebitdaImpact = hasLeaseData ? totalRevenue - totalLeaseCosts : 0;

  // Categories for donut chart
  const categoriesData = useMemo(() => {
    if (!hasLeaseData) return [];

    return Object.entries(leaseData.categoryTotals)
      .filter(([_, amount]) => amount > 0)
      .map(([category, amount]) => ({
        name: CATEGORY_CONFIG[category]?.displayName || category,
        amount,
        category,
        percent: totalLeaseCosts > 0 ? ((amount / totalLeaseCosts) * 100).toFixed(1) : '0',
      }))
      .sort((a, b) => b.amount - a.amount);
  }, [hasLeaseData, leaseData.categoryTotals, totalLeaseCosts]);  // Works for both iplicit and invoice paths

  // Monthly trend data
  const trendData = useMemo(() => {
    if (!hasLeaseData) return [];

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
      leaseData.lineItems.forEach((item: any) => {
        if (item.invoiceDate) {
          const date = new Date(item.invoiceDate);
          const monthKey = date.toLocaleString('en-GB', { month: 'short' });
          monthMap.set(monthKey, (monthMap.get(monthKey) || 0) + Math.abs((item.LineAmount || 0) + (item.TaxAmount || 0)));
        }
      });
    }

    return Array.from(monthMap.entries())
      .map(([month, actual]) => ({
        month,
        actual,
        budget: actual * 1.05, // Placeholder budget
        benchmark: actual * 0.95, // Placeholder benchmark
      }))
      .slice(-6);
  }, [hasLeaseData, isIplicit, plCosts.entries, leaseData.lineItems]);

  // Calculate lease expirations from lease_master
  const expirationData = useMemo(() => {
    const today = new Date();

    return leaseExpirations.map(lease => {
      const endDate = new Date(lease.lease_end_date);
      const monthsRemaining = Math.max(0, Math.floor(
        (endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24 * 30.44)
      ));

      let action = 'No action';
      if (monthsRemaining <= 3) {
        action = 'Urgent: Renew';
      } else if (monthsRemaining <= 6) {
        action = 'Renegotiate';
      } else if (monthsRemaining <= 12) {
        action = 'Review options';
      } else if (monthsRemaining <= 18) {
        action = 'Market analysis';
      }

      return {
        location: lease.location_name || lease.lease_name,
        reference: lease.lease_reference,
        supplier: lease.xero_contact_name,
        category: lease.lease_category,
        expiresIn: monthsRemaining,
        monthlyRent: lease.monthly_rent,
        currency: lease.currency || 'GBP',
        action,
        hasRenewalOption: lease.has_renewal_option,
        status: lease.status,
      };
    });
  }, [leaseExpirations]);

  // Location data (grouped by contact/landlord or account for iplicit)
  const locationData = useMemo(() => {
    if (!hasLeaseData) return [];

    const locationMap = new Map<string, { total: number; categories: Record<string, number> }>();

    if (isIplicit) {
      // Iplicit P&L: group by account_name (no supplier/contact data in P&L)
      plCosts.entries.forEach((entry) => {
        const name = entry.account_name || entry.account_code || 'Unknown';
        const existing = locationMap.get(name) || { total: 0, categories: {} };
        const amount = Math.abs(entry.amount);
        const category = determineLeaseCategory('', entry.account_code, entry.account_name) || 'other';

        existing.total += amount;
        existing.categories[category] = (existing.categories[category] || 0) + amount;

        locationMap.set(name, existing);
      });
    } else {
      leaseData.lineItems.forEach((item: any) => {
        const contactName = item.contactName || 'Unknown';
        const existing = locationMap.get(contactName) || { total: 0, categories: {} };
        const amount = Math.abs((item.LineAmount || 0) + (item.TaxAmount || 0));

        existing.total += amount;
        existing.categories[item.leaseCategory] = (existing.categories[item.leaseCategory] || 0) + amount;

        locationMap.set(contactName, existing);
      });
    }

    return Array.from(locationMap.entries())
      .map(([name, data]) => {
        const percentOfTotal = totalLeaseCosts > 0 ? (data.total / totalLeaseCosts) * 100 : 0;
        const costPerPatient = Math.round(data.total / 1000); // Placeholder
        const vsBenchmark = percentOfTotal - (benchmark / locationMap.size);

        return {
          locationId: name,
          locationName: name,
          cost: data.total,
          percentOfRevenue: percentOfTotal,
          costPerPatient,
          variance: vsBenchmark,
          status: vsBenchmark > 2 ? 'danger' as const : vsBenchmark > 0 ? 'warning' as const : 'success' as const,
        };
      })
      .sort((a, b) => b.cost - a.cost);
  }, [hasLeaseData, isIplicit, plCosts.entries, leaseData.lineItems, totalLeaseCosts, benchmark]);

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

  const byLocationContext = useMemo(() => {
    // The page already pre-groups (by Xero contact or iplicit account_name);
    // for the chatbot we want true location splits. Use site-level grouping
    // for Xero/QB, and a single-bucket emit for iplicit when filtered.
    if (isIplicit) {
      if (selectedLocationId && hasLeaseData) {
        return [{
          locationName: selectedLocationName,
          totalAmount: round2(totalLeaseCosts),
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
  }, [isIplicit, invoiceRollups, selectedLocationId, selectedLocationName, hasLeaseData, totalLeaseCosts, plCosts.entries.length]);

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
    const map = new Map<string, { name: string; totalAmount: number }>();
    for (const inv of allInvoices) {
      for (const li of (inv.LineItems || [])) {
        const code = li.AccountCode || 'Unknown';
        const ex = map.get(code) || { name: li.AccountName || code, totalAmount: 0 };
        ex.totalAmount += Math.abs((li.LineAmount || 0) + (li.TaxAmount || 0));
        map.set(code, ex);
      }
    }
    return Array.from(map.entries())
      .map(([code, v]) => ({ accountCode: code, accountName: v.name, totalAmount: round2(v.totalAmount) }))
      .sort((a, b) => b.totalAmount - a.totalAmount)
      .slice(0, 10);
  }, [isIplicit, plCosts.entries, allInvoices]);

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
    leaseData,
    categoriesData,
    trendData,
    expirationData,
    isLiveData: hasLeaseData,
    page: 'operating-leases',
    selectedLocationName,
    period: { from: defaultFromDate, to: defaultToDate },
    totalAmount: round2(totalLeaseCosts),
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
        <title>Operating Leases Analysis</title>
        <meta name="description" content="Track equipment and building operating leases, monitor lease costs, and simulate expense impact scenarios." />
      </Helmet>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Operating Leases Analysis</h1>
            <p className="text-muted-foreground">Occupancy and equipment lease costs impact</p>
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
                onClick={handleSync}
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
            <div className="flex items-center gap-2 px-3 py-1.5 bg-chart-3/10 rounded-lg">
              <Building2 className="w-4 h-4 text-chart-3" />
              <span className="text-sm font-medium text-chart-3">Cost Center</span>
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
                <p className="font-medium">Sync completed: {syncResult.invoicesSaved} invoices, {syncResult.lineItemsSaved} line items saved</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* AI Summary */}
        <AISummaryCard page="operating-leases" data={aiContextData} />

        {/* Cost Impact Simulator */}
        <CostImpactSimulator
          currentCost={totalLeaseCosts}
          currentEBITDA={ebitdaImpact}
          percentOfRevenue={percentOfRevenue}
          costCenterName="Operating Leases"
        />

        {/* Overview KPIs */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className={hasLeaseData ? 'border-green-500/30' : ''}>
            <CardContent className="pt-6">
              {isLoading ? (
                <Skeleton className="h-16 w-full" />
              ) : (
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Total Lease Costs</p>
                    <p className={`text-2xl font-bold ${!hasLeaseData ? 'text-muted-foreground' : ''}`}>
                      {hasLeaseData ? formatCurrencyWhole(totalLeaseCosts) : '--'}
                    </p>
                  </div>
                  {hasLeaseData && <TrendIndicator value={trend} reverse />}
                </div>
              )}
              <p className="text-xs text-muted-foreground mt-2">
                {hasLeaseData ? `${percentOfRevenue}% of revenue` : `Awaiting ${integrationName} data`}
              </p>
            </CardContent>
          </Card>

          <Card className={hasLeaseData ? 'border-green-500/30' : ''}>
            <CardContent className="pt-6">
              {isLoading ? (
                <Skeleton className="h-16 w-full" />
              ) : (
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">vs Benchmark</p>
                    <p className={`text-2xl font-bold ${!hasLeaseData ? 'text-muted-foreground' : ''}`}>
                      {hasLeaseData ? `${benchmark}%` : '--'}
                    </p>
                  </div>
                  {hasLeaseData && (
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
              )}
              <p className="text-xs text-muted-foreground mt-2">
                Industry standard target
              </p>
            </CardContent>
          </Card>

          <Card className={hasLeaseData ? 'border-green-500/30' : ''}>
            <CardContent className="pt-6">
              {isLoading ? (
                <Skeleton className="h-16 w-full" />
              ) : (
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Building Leases</p>
                    <p className={`text-2xl font-bold ${!hasLeaseData ? 'text-muted-foreground' : ''}`}>
                      {hasLeaseData ? formatCurrencyWhole(leaseData.categoryTotals.building) : '--'}
                    </p>
                  </div>
                  <Building2 className="w-5 h-5 text-muted-foreground" />
                </div>
              )}
              <p className="text-xs text-muted-foreground mt-2">
                {hasLeaseData && totalLeaseCosts > 0
                  ? `${((leaseData.categoryTotals.building / totalLeaseCosts) * 100).toFixed(1)}% of lease costs`
                  : `Awaiting ${integrationName} data`}
              </p>
            </CardContent>
          </Card>

          <Card className={hasLeaseData ? 'border-warning/50 bg-warning/5' : ''}>
            <CardContent className="pt-6">
              {isLoading ? (
                <Skeleton className="h-16 w-full" />
              ) : (
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">EBITDA Impact</p>
                    <p className={`text-2xl font-bold ${hasLeaseData ? 'text-warning' : 'text-muted-foreground'}`}>
                      {hasLeaseData ? formatCurrencyWhole(ebitdaImpact) : '--'}
                    </p>
                  </div>
                  <AlertTriangle className={`w-5 h-5 ${hasLeaseData ? 'text-warning' : 'text-muted-foreground'}`} />
                </div>
              )}
              <p className="text-xs text-muted-foreground mt-2">
                Above benchmark cost drag
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Category Breakdown */}
          <Card className={categoriesData.length > 0 ? 'border-green-500/30' : ''}>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                Lease Categories
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
                        {categoriesData.map((entry, index) => (
                          <Cell
                            key={`cell-${index}`}
                            fill={CATEGORY_CONFIG[entry.category]?.color || COLORS[index % COLORS.length]}
                          />
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
                    <p>No lease data available</p>
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
                      <Line type="monotone" dataKey="actual" stroke="hsl(var(--chart-3))" strokeWidth={2} dot={false} name="Actual" />
                      <Line type="monotone" dataKey="budget" stroke="hsl(var(--muted-foreground))" strokeWidth={2} strokeDasharray="5 5" dot={false} name="Budget" />
                      <Line type="monotone" dataKey="benchmark" stroke="hsl(var(--primary))" strokeWidth={2} strokeDasharray="3 3" dot={false} name="Benchmark" />
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

        {/* Lease Expirations */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Calendar className="w-5 h-5" />
              Upcoming Lease Expirations
              {expirationData.length > 0 && (
                <Badge variant="outline" className="text-xs bg-blue-500/10 text-blue-600">
                  {expirationData.length} leases
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {expirationData.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Lease</th>
                      <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Supplier</th>
                      <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Category</th>
                      <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">Expires In</th>
                      <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">Monthly Rent</th>
                      <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Action Required</th>
                    </tr>
                  </thead>
                  <tbody>
                    {expirationData.map((lease, index) => (
                      <tr key={index} className="border-b border-border/50">
                        <td className="py-3 px-4 font-medium">{lease.location}</td>
                        <td className="py-3 px-4 text-sm text-muted-foreground">{lease.supplier || '-'}</td>
                        <td className="py-3 px-4">
                          <Badge variant="outline" className="text-xs">
                            {CATEGORY_CONFIG[lease.category]?.displayName || lease.category}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <Badge variant={lease.expiresIn <= 6 ? 'destructive' : lease.expiresIn <= 12 ? 'secondary' : 'outline'}>
                            {lease.expiresIn} months
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-right">{formatCurrency(lease.monthlyRent)}</td>
                        <td className="py-3 px-4">
                          <span className={`text-sm ${lease.expiresIn <= 6 ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>
                            {lease.action}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="py-8 text-center text-muted-foreground">
                <Calendar className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>No lease contracts configured</p>
                <p className="text-sm">Add lease contracts in Settings to track expirations</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Location Impact */}
        <Card className={locationData.length > 0 ? 'border-green-500/30' : ''}>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              Lease Costs by Location
              {locationData.length > 0 && (
                <>
                  <Badge variant="outline" className="text-xs bg-green-500/10 text-green-600">Live</Badge>
                  <span className="text-sm font-normal text-muted-foreground ml-2">
                    ({locationData.length} suppliers)
                  </span>
                </>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : locationData.length > 0 ? (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Location</th>
                        <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">Total Cost</th>
                        <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">% of Revenue</th>
                        <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">Cost/Patient</th>
                        <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">vs Benchmark</th>
                        <th className="text-center py-3 px-4 text-sm font-medium text-muted-foreground">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {locationData
                        .slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE)
                        .map((loc) => (
                          <tr
                            key={loc.locationId}
                            className="border-b border-border/50 hover:bg-muted/50 cursor-pointer transition-colors"
                            onClick={() => navigate(`/locations/${loc.locationId}`)}
                          >
                            <td className="py-3 px-4 font-medium">{loc.locationName}</td>
                            <td className="py-3 px-4 text-right">{formatCurrency(loc.cost)}</td>
                            <td className="py-3 px-4 text-right">{loc.percentOfRevenue.toFixed(1)}%</td>
                            <td className="py-3 px-4 text-right">£{loc.costPerPatient}</td>
                            <td className="py-3 px-4 text-right">
                              <TrendIndicator value={loc.variance} reverse />
                            </td>
                            <td className="py-3 px-4 text-center">
                              <StatusBadge status={loc.status} />
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
                      Showing {((currentPage - 1) * ITEMS_PER_PAGE) + 1} to {Math.min(currentPage * ITEMS_PER_PAGE, locationData.length)} of {locationData.length} suppliers
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
