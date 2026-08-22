import { Helmet } from 'react-helmet-async';
import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search, ArrowUpDown, ArrowUp, ArrowDown, Filter, Loader2 } from 'lucide-react';
import { MainLayout } from '@/components/layout/MainLayout';
import { TrendIndicator } from '@/components/dashboard/TrendIndicator';
import { AISummaryCard } from '@/components/ai/AISummaryCard';
import { fetchPracticeLocations, fetchRegions } from '@/services/locationsService';
import { useOrganization } from '@/hooks/useOrganization';
import { useLocationMetrics } from '@/hooks/useLocationMetrics';
import { useFilters } from '@/contexts/FilterContext';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type SortKey = 'rank' | 'revenue' | 'ebitda' | 'netProfit' | 'collectionAmount' | 'netCashFlow';
type SortOrder = 'asc' | 'desc';

interface DisplayLocation {
  id: string;
  code: string;
  fullName: string;
  region: string;
  regionName: string;
  revenue: number;
  previousRevenue: number;
  revenueTrend: number;
  ebitdaPercent: number | null;
  netProfit: number | null;
  collectionAmount: number;
  netCashFlow: number | null;
  rank: number;
}

const formatCurrency = (value: number): string => {
  return `£${value.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export default function Locations() {
  const navigate = useNavigate();
  const { organizationId } = useOrganization();
  const { setSelectedLocationId } = useFilters();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRegion, setSelectedRegion] = useState<string>('all');
  const [sortKey, setSortKey] = useState<SortKey>('rank');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');

  // Fetch locations via useQuery (eliminates race condition with metrics query)
  const { data: fetchedLocations = [], isLoading: locationsLoading } = useQuery({
    queryKey: ['practice-locations-list', organizationId],
    queryFn: () => fetchPracticeLocations(organizationId!),
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000,
  });

  const { data: regions = [], isLoading: regionsLoading } = useQuery({
    queryKey: ['regions-list', organizationId],
    queryFn: () => fetchRegions(organizationId!),
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000,
  });

  // Fetch real metrics. useLocationMetrics splits its work into three queries
  // that resolve at different speeds:
  //   1. Core (revenue, AR, collection rate) — fast.
  //   2. Costs from the Cost Impact buckets — medium.
  //   3. Per-location cashflow-report — slow (external edge call).
  const {
    data: metricsMap,
    isLoading: metricsLoading,
    isCostsLoading,
    isCashflowLoading,
  } = useLocationMetrics();

  // Merge location data with real metrics
  const locations: DisplayLocation[] = useMemo(() => {
    if (!metricsMap) {
      return fetchedLocations.map((loc, i) => ({
        id: loc.id,
        code: loc.location_code || '',
        fullName: loc.location_name,
        region: loc.region_id || '',
        regionName: loc.region_name || '',
        revenue: 0,
        previousRevenue: 0,
        revenueTrend: 0,
        ebitdaPercent: null,
        netProfit: null,
        collectionAmount: 0,
        netCashFlow: null,
        rank: i + 1,
      }));
    }

    const locs = fetchedLocations.map((loc) => {
      const metrics = metricsMap.get(loc.id);
      const revenue = metrics?.revenue ?? 0;
      const previousRevenue = metrics?.previousRevenue ?? 0;
      const revenueTrend = previousRevenue > 0
        ? Math.round((revenue / previousRevenue - 1) * 1000) / 10
        : 0;

      return {
        id: loc.id,
        code: loc.location_code || '',
        fullName: loc.location_name,
        region: loc.region_id || '',
        regionName: loc.region_name || '',
        revenue,
        previousRevenue,
        revenueTrend,
        ebitdaPercent: metrics?.ebitdaPercent ?? null,
        netProfit: metrics?.netProfit ?? null,
        collectionAmount: metrics?.collectionAmount ?? 0,
        netCashFlow: metrics?.netCashFlow ?? null,
        rank: metrics?.rank ?? 0,
      };
    });

    // Re-rank based on revenue (descending)
    locs.sort((a, b) => b.revenue - a.revenue);
    locs.forEach((loc, i) => { loc.rank = i + 1; });

    return locs;
  }, [fetchedLocations, metricsMap]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortOrder('asc');
    }
  };

  const filteredLocations = locations
    .filter((loc) => {
      const matchesSearch =
        loc.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        loc.code.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesRegion = selectedRegion === 'all' || loc.region === selectedRegion;
      return matchesSearch && matchesRegion;
    })
    .sort((a, b) => {
      let comparison = 0;
      switch (sortKey) {
        case 'rank':
          comparison = a.rank - b.rank;
          break;
        case 'revenue':
          comparison = b.revenue - a.revenue;
          break;
        case 'ebitda':
          comparison = (b.ebitdaPercent ?? -Infinity) - (a.ebitdaPercent ?? -Infinity);
          break;
        case 'netProfit':
          comparison = (b.netProfit ?? -Infinity) - (a.netProfit ?? -Infinity);
          break;
        case 'collectionAmount':
          comparison = b.collectionAmount - a.collectionAmount;
          break;
        case 'netCashFlow':
          comparison = (b.netCashFlow ?? -Infinity) - (a.netCashFlow ?? -Infinity);
          break;
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    });

  const SortHeader = ({ label, sortKeyValue }: { label: string; sortKeyValue: SortKey }) => (
    <th
      className="cursor-pointer hover:bg-muted/50 transition-colors"
      onClick={() => handleSort(sortKeyValue)}
    >
      <div className="flex items-center justify-center gap-1">
        {label}
        {sortKey === sortKeyValue ? (
          sortOrder === 'asc' ? (
            <ArrowUp className="w-3 h-3" />
          ) : (
            <ArrowDown className="w-3 h-3" />
          )
        ) : (
          <ArrowUpDown className="w-3 h-3 opacity-40" />
        )}
      </div>
    </th>
  );

  // AI context data — full row array + rankings so the chatbot can answer
  // "which location is loss-making / underperforming / highest revenue?".
  const round2 = (n: number | null | undefined) =>
    n === null || n === undefined ? null : Math.round((Number(n) || 0) * 100) / 100;
  const locationRows = locations.map(l => ({
    name: l.fullName,
    code: l.code,
    region: l.regionName || null,
    revenue: round2(l.revenue),
    previousRevenue: round2(l.previousRevenue),
    revenueTrendPercent: round2(l.revenueTrend),
    ebitdaPercent: round2(l.ebitdaPercent),
    netProfit: round2(l.netProfit),
    collectionAmount: round2(l.collectionAmount),
    netCashFlow: round2(l.netCashFlow),
  }));
  const byRevenueDesc = [...locationRows].sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0));
  const byNetProfitAsc = [...locationRows].sort((a, b) => (a.netProfit ?? Infinity) - (b.netProfit ?? Infinity));
  const byEbitdaAsc = [...locationRows].sort((a, b) => (a.ebitdaPercent ?? Infinity) - (b.ebitdaPercent ?? Infinity));
  const lossMaking = locationRows.filter(l => (l.netProfit ?? 0) < 0);
  const performanceData = {
    totalLocations: locations.length,
    locations: locationRows,
    topByRevenue: byRevenueDesc.slice(0, 10),
    bottomByRevenue: [...byRevenueDesc].reverse().slice(0, 10),
    lossMaking,
    lowestEbitda: byEbitdaAsc.slice(0, 10),
    worstNetProfit: byNetProfitAsc.slice(0, 10),
    // Backward-compat summary fields (used by AISummaryCard).
    topPerformers: byRevenueDesc.slice(0, 3),
    bottomPerformers: [...byRevenueDesc].reverse().slice(0, 3),
    totalRevenue: locations.reduce((sum, l) => sum + (l.revenue ?? 0), 0),
    totalCollectionAmount: locations.reduce((sum, l) => sum + l.collectionAmount, 0),
    totalNetProfit: locations.reduce((sum, l) => sum + (l.netProfit ?? 0), 0),
    totalNetCashFlow: locations.reduce((sum, l) => sum + (l.netCashFlow ?? 0), 0),
  };

  // Block the table until locations, regions, and metrics are ready so we
  // don't flash empty £0 / — cells or a "Loading costs…" header string.
  const dataLoading = locationsLoading || regionsLoading;
  const isPageLoading =
    dataLoading || metricsLoading || isCostsLoading || isCashflowLoading;

  return (
    <MainLayout userRole="admin" aiContext={{ page: 'performance', data: performanceData }}>
      <Helmet>
        <title>Practice Locations</title>
        <meta name="description" content="View all dental practice locations with searchable performance metrics, revenue, EBITDA, and status." />
      </Helmet>
      <div className="space-y-6 animate-fade-in">
        {/* Page Header */}
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Practice Locations</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Location leaderboard and comparative performance metrics
          </p>
        </div>

        {isPageLoading ? (
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <div className="flex flex-col items-center justify-center gap-3 py-16">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Loading locations…</p>
            </div>
            <div className="space-y-2 px-4 pb-6">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          </div>
        ) : (
          <>
            {/* AI Summary */}
            <AISummaryCard page="performance" data={performanceData} />

            {/* Filters Bar */}
            <div className="flex items-center gap-3 flex-wrap">
              {/* Search */}
              <div className="relative flex-1 max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  type="search"
                  placeholder="Search locations..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 h-9"
                />
              </div>

              {/* Region Filter */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="h-9 gap-2">
                    <Filter className="w-4 h-4" />
                    Region: {selectedRegion === 'all' ? 'All Regions' : regions.find(r => r.id === selectedRegion)?.name || 'All Regions'}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onClick={() => setSelectedRegion('all')}>
                    All Regions
                  </DropdownMenuItem>
                  {regions.map((region) => (
                    <DropdownMenuItem
                      key={region.id}
                      onClick={() => setSelectedRegion(region.id)}
                    >
                      {region.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              <div className="ml-auto text-sm text-muted-foreground">
                Showing {filteredLocations.length} of {locations.length} locations
              </div>
            </div>

            {/* Location Table */}
            <div className="bg-card rounded-xl border border-border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr className="bg-muted/50">
                      <SortHeader label="Rank" sortKeyValue="rank" />
                      <th>Location</th>
                      <th>Region</th>
                      <SortHeader label="Revenue" sortKeyValue="revenue" />
                      <SortHeader label="EBITDA %" sortKeyValue="ebitda" />
                      <SortHeader label="Net Profit" sortKeyValue="netProfit" />
                      <SortHeader label="Collection Amount" sortKeyValue="collectionAmount" />
                      <SortHeader label="Net Cash Flow" sortKeyValue="netCashFlow" />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLocations.map((location) => (
                      <tr
                        key={location.id}
                        className="cursor-pointer"
                        onClick={() => {
                          setSelectedLocationId(location.id);
                          navigate('/location-history');
                        }}
                      >
                        <td>
                          <span className="w-8 h-8 rounded-full bg-muted inline-flex items-center justify-center text-sm font-medium">
                            {location.rank}
                          </span>
                        </td>
                        <td>
                          <div>
                            <p className="font-medium">{location.fullName}</p>
                            <p className="text-xs text-muted-foreground">{location.code}</p>
                          </div>
                        </td>
                        <td>
                          <span className="text-sm capitalize">
                            {regions.find(r => r.id === location.region)?.name || location.regionName || '—'}
                          </span>
                        </td>
                        <td>
                          <div className="text-center">
                            <p className="font-medium">{formatCurrency(location.revenue)}</p>
                            <TrendIndicator
                              value={location.revenueTrend}
                              showIcon={false}
                            />
                          </div>
                        </td>
                        <td className="text-center">
                          {location.ebitdaPercent != null ? (
                            <p className={cn(
                              'font-medium',
                              location.ebitdaPercent < 28 ? 'text-danger' :
                                location.ebitdaPercent < 32 ? 'text-warning' : ''
                            )}>
                              {location.ebitdaPercent}%
                            </p>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="text-center">
                          {location.netProfit != null ? (
                            <p className={cn(
                              'font-medium',
                              location.netProfit < 0 ? 'text-danger' : ''
                            )}>
                              {formatCurrency(location.netProfit)}
                            </p>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="text-center">
                          <p className="font-medium">{formatCurrency(location.collectionAmount)}</p>
                        </td>
                        <td className="text-center">
                          {location.netCashFlow != null ? (
                            <p className={cn(
                              'font-medium',
                              location.netCashFlow < 0 ? 'text-danger' : ''
                            )}>
                              {formatCurrency(location.netCashFlow)}
                            </p>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </MainLayout>
  );
}
