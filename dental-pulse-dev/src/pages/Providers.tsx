import { Helmet } from 'react-helmet-async';
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { MainLayout } from '@/components/layout/MainLayout';
import { MetricHelp } from '@/components/dashboard/MetricHelp';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { TrendIndicator } from '@/components/dashboard/TrendIndicator';
import { AISummaryCard } from '@/components/ai/AISummaryCard';
import { ProviderFormDialog } from '@/components/providers/ProviderFormDialog';
import { DeleteProviderDialog } from '@/components/providers/DeleteProviderDialog';
import { useProviders } from '@/hooks/useProviders';
import { useProviderTypes } from '@/hooks/useProviderTypes';
import { useOrganization } from '@/hooks/useOrganization';
import { useLocations } from '@/hooks/useLocations';
import { Provider, ProviderInsert, ProviderUpdate } from '@/types/provider';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Users, Stethoscope, Heart, TrendingUp, ChevronRight, Plus, Pencil, Trash2, Loader2 } from 'lucide-react';
import { EntitySyncButton } from '@/components/sync/EntitySyncButton';
import { CommonFilterDialog, CommonFilterValues } from '@/components/common/CommonFilterDialog';
import { applyCommonFilters } from '@/components/common/filter-utils';

const providerTrends = [
  { month: 'Jul', associates: 720000, therapists: 140000, hygienists: 145000 },
  { month: 'Aug', associates: 680000, therapists: 135000, hygienists: 142000 },
  { month: 'Sep', associates: 750000, therapists: 142000, hygienists: 148000 },
  { month: 'Oct', associates: 780000, therapists: 145000, hygienists: 150000 },
  { month: 'Nov', associates: 810000, therapists: 148000, hygienists: 152000 },
  { month: 'Dec', associates: 819000, therapists: 145000, hygienists: 150000 },
];

export default function Providers() {
  const [searchParams] = useSearchParams();
  const [selectedLocation, setSelectedLocation] = useState<string>('all');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<Provider | null>(null);
  const [tableFilters, setTableFilters] = useState<CommonFilterValues>({
    search: '',
    providerType: '',
    minRevenue: '',
    maxRevenue: '',
    joiningFrom: '',
    joiningTo: '',
    sortBy: 'revenue',
    sortOrder: 'desc',
    onlyActive: false,
  });
  const navigate = useNavigate();

  // Get organization ID
  const { organizationId } = useOrganization();
  
  // Get provider types for dynamic labels
  const { activeProviderTypes } = useProviderTypes();
  
  // Get locations and regions from TopBar filters
  const { locations, regions } = useLocations();
  
  // Get selected location and region from URL params (TopBar)
  const topBarLocation = searchParams.get('location') || null;
  const topBarRegion = searchParams.get('region') || 'all';
  
  // Determine if we should show location dropdown (show if "all" or not selected in TopBar)
  const shouldShowLocationDropdown = !topBarLocation || topBarLocation === 'all' || topBarLocation === '';
  const selectedLocationFromTopBar = topBarLocation && topBarLocation !== 'all' ? locations.find(l => l.id === topBarLocation) : null;
  const selectedRegionFromTopBar = topBarRegion !== 'all' ? regions.find(r => r.id === topBarRegion) : null;

  // Fetch practices (locations) for the organization
  const { data: practices = [] } = useQuery({
    queryKey: ['practices', organizationId],
    queryFn: async () => {
      if (!organizationId) return [];
      const { data, error } = await supabase
        .from('practices')
        .select('*')
        .eq('organization_id', organizationId)
        .order('name');
      if (error) throw error;
      return data || [];
    },
    enabled: !!organizationId,
  });

  // Get providers filtered by location
  const practiceId = selectedLocation === 'all' ? null : selectedLocation;
  const {
    providers,
    providersByType,
    associates,
    therapists,
    hygienists,
    isLoading,
    isOrgLoading,
    createProvider,
    updateProvider,
    deleteProvider,
    isCreating,
    isUpdating,
    isDeleting,
    hasOrganization,
  } = useProviders(undefined, practiceId);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: 'GBP',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const handleProviderClick = (providerId: string, providerType?: string) => {
    const type = providerType ? providerType.toLowerCase() : 'other';
    navigate(`/providers/${type}/${providerId}`);
  };

  const handleAddProvider = () => {
    setSelectedProvider(null);
    setIsFormOpen(true);
  };

  const handleEditProvider = (provider: Provider, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedProvider(provider);
    setIsFormOpen(true);
  };

  const handleDeleteClick = (provider: Provider, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedProvider(provider);
    setIsDeleteOpen(true);
  };

  const handleFormSubmit = (data: Omit<ProviderInsert, 'organization_id'> | ProviderUpdate) => {
    if (selectedProvider) {
      updateProvider(
        { id: selectedProvider.id, updates: data as ProviderUpdate },
        { onSuccess: () => setIsFormOpen(false) }
      );
    } else {
      createProvider(data as Omit<ProviderInsert, 'organization_id'>, {
        onSuccess: () => setIsFormOpen(false),
      });
    }
  };

  const handleDeleteConfirm = () => {
    if (selectedProvider) {
      deleteProvider(selectedProvider.id, {
        onSuccess: () => {
          setIsDeleteOpen(false);
          setSelectedProvider(null);
        },
      });
    }
  };

  const getProviderTypeColor = (providerTypeId: string | null) => {
    if (!providerTypeId) return 'bg-gradient-to-br from-gray-500 to-gray-600';
    const typeIndex = activeProviderTypes.findIndex(pt => pt.id === providerTypeId);
    if (typeIndex >= 0) {
      const colors = [
        'bg-gradient-to-br from-blue-500 to-indigo-600',
        'bg-gradient-to-br from-purple-500 to-pink-600',
        'bg-gradient-to-br from-teal-500 to-cyan-600',
        'bg-gradient-to-br from-orange-500 to-red-600',
        'bg-gradient-to-br from-green-500 to-emerald-600',
        'bg-gradient-to-br from-pink-500 to-rose-600',
      ];
      return colors[typeIndex % colors.length];
    }
    return 'bg-gradient-to-br from-gray-500 to-gray-600';
  };

  const ProviderTable = ({ data }: { data: Provider[] }) => (
    <div className="overflow-x-auto">
      {data.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <p>No providers found.</p>
          <Button variant="link" onClick={handleAddProvider} className="mt-2">
            Add your first provider
          </Button>
        </div>
      ) : (
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-3 px-4 font-medium text-muted-foreground">Name</th>
              <th className="text-left py-3 px-4 font-medium text-muted-foreground">Specialty</th>
              <th className="text-right py-3 px-4 font-medium text-muted-foreground">Revenue (MTD)</th>
              <th className="text-right py-3 px-4 font-medium text-muted-foreground">Provider Type</th>
              <th className="text-right py-3 px-4 font-medium text-muted-foreground">Patients</th>
              <th className="text-right py-3 px-4 font-medium text-muted-foreground">Avg/Patient</th>
              <th className="text-right py-3 px-4 font-medium text-muted-foreground">Utilisation</th>
              <th className="text-right py-3 px-4 font-medium text-muted-foreground">Trend</th>
              <th className="text-right py-3 px-4 font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.map((provider) => (
              <tr
                key={provider.id}
                className="border-b border-border/50 hover:bg-muted/30 cursor-pointer transition-colors"
                onClick={() => handleProviderClick(provider.id, provider.provider_types?.code)}
              >
                <td className="py-3 px-4">
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white font-medium text-xs ${getProviderTypeColor(provider.provider_type_id)}`}>
                      {provider.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                    </div>
                    <span className="font-medium text-foreground">{provider.name}</span>
                  </div>
                </td>
                <td className="py-3 px-4 text-muted-foreground">{provider.specialties?.name || '-'}</td>
                <td className="text-right py-3 px-4 font-medium text-foreground">{formatCurrency(provider.revenue)}</td>
                <td className="text-right py-3 px-4 text-foreground">{provider.provider_types?.name || '-'}</td>
                <td className="text-right py-3 px-4 text-foreground">{provider.patients}</td>
                <td className="text-right py-3 px-4 text-foreground">{formatCurrency(provider.avg_rev_per_patient)}</td>
                <td className="text-right py-3 px-4">
                  <span className={provider.utilisation >= 90 ? 'text-success font-medium' : provider.utilisation >= 80 ? 'text-warning font-medium' : 'text-danger font-medium'}>
                    {provider.utilisation}%
                  </span>
                </td>
                <td className="text-right py-3 px-4">
                  <TrendIndicator value={provider.trend} />
                </td>
                <td className="text-right py-3 px-4">
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={(e) => handleEditProvider(provider, e)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={(e) => handleDeleteClick(provider, e)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                    <ChevronRight className="w-4 h-4 text-muted-foreground ml-1" />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );

  // Calculate totals dynamically for all provider types
  const revenueByType = activeProviderTypes.reduce((acc, type) => {
    const typeProviders = providersByType[type.code] || [];
    acc[type.code] = typeProviders.reduce((sum, p) => sum + p.revenue, 0);
    return acc;
  }, {} as Record<string, number>);

  // For backward compatibility
  const associatesRevenue = associates.reduce((sum, p) => sum + p.revenue, 0);
  const therapistsRevenue = therapists.reduce((sum, p) => sum + p.revenue, 0);
  const hygienistsRevenue = hygienists.reduce((sum, p) => sum + p.revenue, 0);
  const allProviders = providers; // Use all providers instead of hardcoded types
  const filteredAllProviders = useMemo(() => {
    return applyCommonFilters(allProviders, tableFilters, {
      text: {
        key: 'search',
        selectors: [
          (p) => p.name,
          (p) => p.email,
          (p) => p.provider_role,
          (p) => p.specialties?.name,
        ],
      },
      select: [
        {
          key: 'providerType',
          selector: (p) => p.provider_types?.code || '',
        },
      ],
      boolean: [
        {
          key: 'onlyActive',
          predicate: (p) => Boolean(p.is_active),
        },
      ],
      numberRange: [
        {
          minKey: 'minRevenue',
          maxKey: 'maxRevenue',
          selector: (p) => p.revenue,
        },
      ],
      dateRange: [
        {
          fromKey: 'joiningFrom',
          toKey: 'joiningTo',
          selector: (p) => p.joining_date,
        },
      ],
      sort: {
        sortByKey: 'sortBy',
        sortOrderKey: 'sortOrder',
        sortSelectorMap: {
          name: (p) => p.name,
          revenue: (p) => p.revenue,
          patients: (p) => p.patients,
          utilisation: (p) => p.utilisation,
          joining_date: (p) => p.joining_date || '',
        },
      },
    });
  }, [allProviders, tableFilters]);

  const avgUtilisation = allProviders.length > 0
    ? allProviders.reduce((sum, p) => sum + p.utilisation, 0) / allProviders.length
    : 0;

  // AI context data — keeps the original summary fields for AISummaryCard
  // and the chatbot's "general" questions, and adds a compact per-provider
  // array + rankings so the bot can answer row-level questions ("who's
  // underperforming?", "lowest utilisation?", "top earners?") directly from
  // structured context without re-querying.
  const TARGET_UTIL = 90;
  const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
  const providerRows = (allProviders || []).map(p => ({
    name: p.name,
    type: p.provider_types?.name || null,
    typeCode: p.provider_types?.code || null,
    specialty: p.specialties?.name || null,
    revenue: round2(p.revenue),
    patients: p.patients,
    avgPerPatient: round2(p.avg_rev_per_patient),
    utilisationPercent: round2(p.utilisation),
    isActive: Boolean(p.is_active),
    joiningDate: p.joining_date || null,
  }));
  const sortByRevenueDesc = [...providerRows].sort((a, b) => b.revenue - a.revenue);
  const sortByUtilDesc = [...providerRows].sort((a, b) => b.utilisationPercent - a.utilisationPercent);
  const sortByUtilAsc = [...providerRows].sort((a, b) => a.utilisationPercent - b.utilisationPercent);
  const sortByAvgPatientAsc = [...providerRows].sort((a, b) => a.avgPerPatient - b.avgPerPatient);

  const selectedLocationName = selectedLocationFromTopBar?.name
    || selectedLocationFromTopBar?.location_name
    || (topBarLocation === 'all' || !topBarLocation ? 'All Locations' : null);
  const selectedRegionName = selectedRegionFromTopBar?.name || null;

  const providersData = {
    // Existing summary fields (kept for AISummaryCard backward compat).
    associates: { count: associates.length, totalRevenue: associatesRevenue, avgUtilisation: associates.length > 0 ? associates.reduce((s, p) => s + p.utilisation, 0) / associates.length : 0 },
    therapists: { count: therapists.length, totalRevenue: therapistsRevenue, avgUtilisation: therapists.length > 0 ? therapists.reduce((s, p) => s + p.utilisation, 0) / therapists.length : 0 },
    hygienists: { count: hygienists.length, totalRevenue: hygienistsRevenue, avgUtilisation: hygienists.length > 0 ? hygienists.reduce((s, p) => s + p.utilisation, 0) / hygienists.length : 0 },
    topPerformer: sortByRevenueDesc[0]?.name || 'N/A',
    overallAvgUtilisation: avgUtilisation.toFixed(1),
    targetUtilisation: TARGET_UTIL,
    // Row-level data for chatbot.
    selectedLocationName,
    selectedRegionName,
    providersCount: providerRows.length,
    providers: providerRows.slice(0, 60),
    topByRevenue: sortByRevenueDesc.slice(0, 10),
    bottomByRevenue: [...sortByRevenueDesc].reverse().slice(0, 10),
    highestUtilisation: sortByUtilDesc.slice(0, 10),
    lowestUtilisation: sortByUtilAsc.slice(0, 10),
    underperformingByUtil: sortByUtilAsc.filter(p => p.utilisationPercent < TARGET_UTIL).slice(0, 20),
    lowestAvgPerPatient: sortByAvgPatientAsc.slice(0, 10),
    note: 'providers[] is capped at 60. Use ranking arrays for top/bottom/underperforming questions.',
  };

  if (isOrgLoading) {
    return (
      <MainLayout userRole="admin">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </MainLayout>
    );
  }

  if (!hasOrganization) {
    return (
      <MainLayout userRole="admin">
        <div className="flex flex-col items-center justify-center h-64 text-center">
          <h2 className="text-xl font-semibold mb-2">No Organization Found</h2>
          <p className="text-muted-foreground mb-4">
            Please complete the onboarding process to set up your organization.
          </p>
          <Button onClick={() => navigate('/onboarding')}>
            Go to Onboarding
          </Button>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout userRole="admin" aiContext={{ page: 'providers', data: providersData }}>
      <Helmet>
        <title>Providers Management</title>
        <meta name="description" content="Manage dental providers (dentists, hygienists, therapists) with performance metrics and facility assignments." />
      </Helmet>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Provider Performance</h1>
            <p className="text-muted-foreground mt-1">Associates, Therapists, and Hygienists analysis</p>
          </div>
          <div className="flex items-center gap-3">
            <Select value={selectedLocation} onValueChange={setSelectedLocation}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="All Locations" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Locations</SelectItem>
                {practices.map((practice) => (
                  <SelectItem key={practice.id} value={practice.id}>
                    {practice.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <EntitySyncButton
              entityAlias="practitioners"
              entityLabel="Providers"
              additionalEntities={[
                { alias: 'appointments', label: 'Appointments' },
                // DISABLED: Invoice sync causes rate limit issues - sync invoices separately
                // { alias: 'invoices', label: 'Invoices' }
              ]}
            />
            <Button onClick={handleAddProvider}>
              <Plus className="h-4 w-4 mr-2" />
              Add Provider
            </Button>
          </div>
        </div>

        {/* AI Summary */}
        <AISummaryCard page="providers" data={providersData} />

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="kpi-card">
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                <Stethoscope className="w-4 h-4" />
                <span>Associates Revenue</span>
                <MetricHelp title="Associates Revenue">
                  Total revenue from completed treatments delivered by associate
                  dentists in the selected period, added across all associates.
                </MetricHelp>
              </div>
              <div className="text-2xl font-semibold">{formatCurrency(associatesRevenue)}</div>
              <div className="text-xs text-muted-foreground">{associates.length} providers</div>
            </CardContent>
          </Card>
          <Card className="kpi-card">
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                <Users className="w-4 h-4" />
                <span>Therapists Revenue</span>
                <MetricHelp title="Therapists Revenue">
                  Total revenue from completed treatments delivered by therapists
                  in the selected period, added across all therapists.
                </MetricHelp>
              </div>
              <div className="text-2xl font-semibold">{formatCurrency(therapistsRevenue)}</div>
              <div className="text-xs text-muted-foreground">{therapists.length} providers</div>
            </CardContent>
          </Card>
          <Card className="kpi-card">
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                <Heart className="w-4 h-4" />
                <span>Hygienists Revenue</span>
                <MetricHelp title="Hygienists Revenue">
                  Total revenue from completed treatments delivered by hygienists
                  in the selected period, added across all hygienists.
                </MetricHelp>
              </div>
              <div className="text-2xl font-semibold">{formatCurrency(hygienistsRevenue)}</div>
              <div className="text-xs text-muted-foreground">{hygienists.length} providers</div>
            </CardContent>
          </Card>
          <Card className="kpi-card">
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                <TrendingUp className="w-4 h-4" />
                <span>Avg Utilisation</span>
                <MetricHelp title="Avg Utilisation">
                  How much of providers' available chair time is used for booked
                  appointments — booked hours ÷ available hours, averaged across
                  providers. The target is 90%.
                </MetricHelp>
              </div>
              <div className="text-2xl font-semibold">{Math.round(avgUtilisation)}%</div>
              <div className="text-xs text-muted-foreground">Target: 90%</div>
            </CardContent>
          </Card>
        </div>

        {/* Revenue Trend Chart */}
        <Card>
          <CardHeader>
            <CardTitle>Provider Revenue Trends</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={providerTrends}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickFormatter={(v) => `£${(v/1000).toFixed(0)}k`} />
                  <Tooltip
                    formatter={(value: number) => formatCurrency(value)}
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px'
                    }}
                  />
                  <Legend />
                  <Line type="monotone" dataKey="associates" name="Associates" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="therapists" name="Therapists" stroke="hsl(var(--chart-2))" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="hygienists" name="Hygienists" stroke="hsl(var(--chart-3))" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* All Providers Table */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div className="flex items-center gap-3">
              <CardTitle>All Providers</CardTitle>
              <CommonFilterDialog
                title="Provider Table Filters"
                description="Filter providers by search, type, date range, revenue range and sort."
                triggerLabel="Filters"
                values={tableFilters}
                onApply={setTableFilters}
                fields={[
                  {
                    id: 'search',
                    type: 'text',
                    label: 'Search',
                    placeholder: 'Name, email, role, specialty',
                  },
                  {
                    id: 'providerType',
                    type: 'select',
                    label: 'Provider Type',
                    options: activeProviderTypes.map((type) => ({
                      label: type.name,
                      value: type.code,
                    })),
                  },
                  {
                    id: 'sortBy',
                    type: 'select',
                    label: 'Sort By',
                    options: [
                      { label: 'Revenue', value: 'revenue' },
                      { label: 'Name', value: 'name' },
                      { label: 'Patients', value: 'patients' },
                      { label: 'Utilisation', value: 'utilisation' },
                      { label: 'Joining Date', value: 'joining_date' },
                    ],
                  },
                  {
                    id: 'sortOrder',
                    type: 'select',
                    label: 'Sort Order',
                    options: [
                      { label: 'Descending', value: 'desc' },
                      { label: 'Ascending', value: 'asc' },
                    ],
                  },
                  {
                    id: 'revenueRange',
                    type: 'numberRange',
                    label: 'Revenue Range',
                    minKey: 'minRevenue',
                    maxKey: 'maxRevenue',
                    minPlaceholder: 'Min revenue',
                    maxPlaceholder: 'Max revenue',
                  },
                  {
                    id: 'joiningRange',
                    type: 'dateRange',
                    label: 'Joining Date Range',
                    fromKey: 'joiningFrom',
                    toKey: 'joiningTo',
                  },
                  {
                    id: 'onlyActive',
                    type: 'checkbox',
                    label: 'Only active providers',
                  },
                ]}
              />
              <span className="text-sm text-muted-foreground">
                Showing {filteredAllProviders.length}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={handleAddProvider}>
                <Plus className="h-4 w-4 mr-1" />
                Add Provider
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <ProviderTable data={filteredAllProviders} />
          </CardContent>
        </Card>
      </div>

      {/* Form Dialog */}
      <ProviderFormDialog
        open={isFormOpen}
        onOpenChange={setIsFormOpen}
        provider={selectedProvider}
        onSubmit={handleFormSubmit}
        isLoading={isCreating || isUpdating}
        locations={shouldShowLocationDropdown ? locations : []}
        regions={regions}
        defaultLocationId={selectedLocationFromTopBar?.id || null}
        defaultRegionId={selectedRegionFromTopBar?.id || null}
        showLocationDropdown={shouldShowLocationDropdown}
      />

      {/* Delete Confirmation Dialog */}
      <DeleteProviderDialog
        open={isDeleteOpen}
        onOpenChange={setIsDeleteOpen}
        provider={selectedProvider}
        onConfirm={handleDeleteConfirm}
        isLoading={isDeleting}
      />
    </MainLayout>
  );
}
