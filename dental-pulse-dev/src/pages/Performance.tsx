import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Search, ArrowUpDown, ArrowUp, ArrowDown, Filter } from 'lucide-react';
import { MainLayout } from '@/components/layout/MainLayout';
import { StatusBadge } from '@/components/dashboard/StatusBadge';
import { TrendIndicator } from '@/components/dashboard/TrendIndicator';
import { AISummaryCard } from '@/components/ai/AISummaryCard';
import { locations as mockLocations, regions as mockRegions, StatusType } from '@/data/mockData';
import { useLocations } from '@/hooks/useLocations';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type SortKey = 'rank' | 'revenue' | 'ebitda' | 'collections' | 'arDays' | 'status';
type SortOrder = 'asc' | 'desc';

const formatCurrency = (value: number): string => {
  if (value >= 1000000) {
    return `£${(value / 1000000).toFixed(2)}M`;
  }
  return `£${(value / 1000).toFixed(0)}K`;
};

export default function Performance() {
  const navigate = useNavigate();
  const { regions: dynamicRegions, locations: dynamicLocations } = useLocations();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRegion, setSelectedRegion] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<StatusType | 'all'>('all');
  const [sortKey, setSortKey] = useState<SortKey>('rank');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');

  // Use dynamic regions if available, otherwise fallback to mock data
  const regions = dynamicRegions && dynamicRegions.length > 0
    ? [{ id: 'all', name: 'All Regions' }, ...dynamicRegions.map(r => ({ id: r.id, name: r.name }))]
    : [{ id: 'all', name: 'All Regions' }, ...mockRegions];

  // Use dynamic locations if available, otherwise fallback to mock data
  const locations = dynamicLocations && dynamicLocations.length > 0
    ? dynamicLocations.map(loc => ({
      id: loc.id,
      fullName: loc.location_name,
      code: loc.location_code || '',
      region: loc.region_id || 'all',
      rank: 0,
      revenue: { mtd: 0, lastMonth: 0, budget: 0, trend: [] as number[] },
      ebitda: { percentage: 0, budget: 0, variance: 0 },
      collections: { rate: 0, target: 0 },
      arDays: 0,
      status: 'success' as StatusType,
    }))
    : mockLocations;

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
      const matchesStatus = selectedStatus === 'all' || loc.status === selectedStatus;
      return matchesSearch && matchesRegion && matchesStatus;
    })
    .sort((a, b) => {
      let comparison = 0;
      switch (sortKey) {
        case 'rank':
          comparison = a.rank - b.rank;
          break;
        case 'revenue':
          comparison = b.revenue.mtd - a.revenue.mtd;
          break;
        case 'ebitda':
          comparison = b.ebitda.percentage - a.ebitda.percentage;
          break;
        case 'collections':
          comparison = b.collections.rate - a.collections.rate;
          break;
        case 'arDays':
          comparison = a.arDays - b.arDays;
          break;
        case 'status':
          const statusOrder = { success: 0, warning: 1, danger: 2 };
          comparison = statusOrder[a.status] - statusOrder[b.status];
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
  // "which location is below benchmark / lowest collections / longest AR?".
  const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
  const locationRows = locations.map(l => ({
    name: l.fullName,
    code: l.code,
    region: l.region,
    rank: l.rank,
    revenueMtd: round2(l.revenue.mtd),
    revenueLastMonth: round2(l.revenue.lastMonth),
    revenueBudget: round2(l.revenue.budget),
    ebitdaPercent: round2(l.ebitda.percentage),
    ebitdaBudget: round2(l.ebitda.budget),
    ebitdaVariance: round2(l.ebitda.variance),
    collectionRatePercent: round2(l.collections.rate),
    collectionTarget: round2(l.collections.target),
    arDays: l.arDays,
    status: l.status,
  }));
  const byRevenueDesc = [...locationRows].sort((a, b) => b.revenueMtd - a.revenueMtd);
  const byEbitdaAsc = [...locationRows].sort((a, b) => a.ebitdaPercent - b.ebitdaPercent);
  const byCollectionAsc = [...locationRows].sort((a, b) => a.collectionRatePercent - b.collectionRatePercent);
  const byArDaysDesc = [...locationRows].sort((a, b) => b.arDays - a.arDays);
  const performanceData = {
    totalLocations: locations.length,
    locations: locationRows,
    topByRevenue: byRevenueDesc.slice(0, 10),
    bottomByRevenue: [...byRevenueDesc].reverse().slice(0, 10),
    lowestEbitda: byEbitdaAsc.slice(0, 10),
    lowestCollectionRate: byCollectionAsc.slice(0, 10),
    longestArDays: byArDaysDesc.slice(0, 10),
    critical: locationRows.filter(l => l.status === 'danger'),
    // Backward-compat summary fields.
    topPerformers: byRevenueDesc.slice(0, 3),
    bottomPerformers: [...byRevenueDesc].reverse().slice(0, 3),
    avgCollectionRate: (locations.reduce((sum, l) => sum + l.collections.rate, 0) / Math.max(locations.length, 1)).toFixed(1),
    avgARDays: Math.round(locations.reduce((sum, l) => sum + l.arDays, 0) / Math.max(locations.length, 1)),
    criticalLocations: locations.filter(l => l.status === 'danger').length,
  };

  return (
    <MainLayout userRole="admin" aiContext={{ page: 'performance', data: performanceData }}>
      <Helmet>
        <title>Practice Performance</title>
        <meta name="description" content="Compare dental location performance with metrics for revenue, EBITDA, collections, and AR aging by region." />
      </Helmet>
      <div className="space-y-6 animate-fade-in">
        {/* Page Header */}
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Performance Overview</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Location leaderboard and comparative performance metrics
          </p>
        </div>

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

          {/* Status Filter */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="h-9 gap-2">
                Status: {selectedStatus === 'all' ? 'All' : selectedStatus}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={() => setSelectedStatus('all')}>
                All Statuses
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSelectedStatus('success')}>
                On Track
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSelectedStatus('warning')}>
                Attention
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSelectedStatus('danger')}>
                Critical
              </DropdownMenuItem>
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
                  <SortHeader label="Revenue (MTD)" sortKeyValue="revenue" />
                  <SortHeader label="EBITDA %" sortKeyValue="ebitda" />
                  <SortHeader label="Collection Rate" sortKeyValue="collections" />
                  <SortHeader label="AR Days" sortKeyValue="arDays" />
                  <SortHeader label="Status" sortKeyValue="status" />
                </tr>
              </thead>
              <tbody>
                {filteredLocations.map((location) => (
                  <tr
                    key={location.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/locations/${location.id}`)}
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
                        {location.region === 'north' ? 'Region North' :
                          location.region === 'south' ? 'Region South' : 'Region London'}
                      </span>
                    </td>
                    <td>
                      <div className="text-center">
                        <p className="font-medium">{formatCurrency(location.revenue.mtd)}</p>
                        <TrendIndicator
                          value={Math.round((location.revenue.mtd / location.revenue.lastMonth - 1) * 100 * 10) / 10}
                          showIcon={false}
                        />
                      </div>
                    </td>
                    <td>
                      <div className="text-center">
                        <p className={cn(
                          'font-medium',
                          location.ebitda.percentage < 28 ? 'text-danger' :
                            location.ebitda.percentage < 32 ? 'text-warning' : ''
                        )}>
                          {location.ebitda.percentage}%
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Budget: {location.ebitda.budget}%
                        </p>
                      </div>
                    </td>
                    <td>
                      <div className="text-center">
                        <p className={cn(
                          'font-medium',
                          location.collections.rate < 95 ? 'text-danger' :
                            location.collections.rate < 97 ? 'text-warning' : ''
                        )}>
                          {location.collections.rate}%
                        </p>
                      </div>
                    </td>
                    <td>
                      <div className="text-center">
                        <p className={cn(
                          'font-medium',
                          location.arDays > 45 ? 'text-danger' :
                            location.arDays > 35 ? 'text-warning' : ''
                        )}>
                          {location.arDays}
                        </p>
                      </div>
                    </td>
                    <td className="text-center">
                      <StatusBadge status={location.status} size="sm" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
