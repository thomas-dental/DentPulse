import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LocationFormDialog } from '@/components/locations/LocationFormDialog';
import { DeleteLocationDialog } from '@/components/locations/DeleteLocationDialog';
import { RegionFormDialog } from '@/components/regions/RegionFormDialog';
import { DeleteRegionDialog } from '@/components/regions/DeleteRegionDialog';
import { useLocations } from '@/hooks/useLocations';
import { PracticeLocation, PracticeLocationInsert, PracticeLocationUpdate, Region, RegionInsert, RegionUpdate } from '@/types/location';
import { MapPin, Plus, Pencil, Trash2, Loader2, CheckCircle2, XCircle, Search, Globe } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export function LocationRegionManagement() {
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isRegionFormOpen, setIsRegionFormOpen] = useState(false);
  const [isRegionDeleteOpen, setIsRegionDeleteOpen] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState<PracticeLocation | null>(null);
  const [selectedRegion, setSelectedRegion] = useState<Region | null>(null);
  const [selectedRegionFilter, setSelectedRegionFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'locations' | 'regions'>('regions');

  const {
    locations,
    regions,
    isLoading,
    isOrgLoading,
    createLocation,
    updateLocation,
    deleteLocation,
    createRegion,
    updateRegion,
    deleteRegion,
    isCreating,
    isUpdating,
    isDeleting,
    isCreatingRegion,
    isUpdatingRegion,
    isDeletingRegion,
    hasOrganization,
    error,
    refetch,
  } = useLocations();

  const handleAddLocation = () => {
    setSelectedLocation(null);
    setIsFormOpen(true);
  };

  const handleEditLocation = (location: PracticeLocation) => {
    setSelectedLocation(location);
    setIsFormOpen(true);
  };

  const handleDeleteClick = (location: PracticeLocation) => {
    setSelectedLocation(location);
    setIsDeleteOpen(true);
  };

  const handleFormSubmit = (data: Omit<PracticeLocationInsert, 'organization_id' | 'created_by'> | PracticeLocationUpdate) => {
    if (selectedLocation) {
      updateLocation(
        { id: selectedLocation.id, updates: data as PracticeLocationUpdate },
        { onSuccess: () => setIsFormOpen(false) }
      );
    } else {
      createLocation(data as Omit<PracticeLocationInsert, 'organization_id' | 'created_by'>, {
        onSuccess: () => setIsFormOpen(false),
      });
    }
  };

  const handleDeleteConfirm = () => {
    if (selectedLocation) {
      deleteLocation(selectedLocation.id, {
        onSuccess: () => {
          setIsDeleteOpen(false);
          setSelectedLocation(null);
        },
      });
    }
  };

  const formatAddress = (location: PracticeLocation) => {
    const parts = [
      location.address_line1,
      location.address_line2,
      location.city,
      location.state,
      location.postal_code,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(', ') : 'No address';
  };

  // Filter locations by selected region and search query
  const filteredLocations = useMemo(() => {
    let filtered = locations;

    // Filter by region
    if (selectedRegionFilter !== 'all') {
      filtered = filtered.filter(location => location.region_id === selectedRegionFilter);
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(location =>
        location.location_name.toLowerCase().includes(query) ||
        location.location_code?.toLowerCase().includes(query) ||
        location.email?.toLowerCase().includes(query) ||
        location.phone?.toLowerCase().includes(query) ||
        location.city?.toLowerCase().includes(query) ||
        location.address_line1?.toLowerCase().includes(query)
      );
    }

    return filtered;
  }, [locations, selectedRegionFilter, searchQuery]);

  // Region handlers
  const handleAddRegion = () => {
    setSelectedRegion(null);
    setIsRegionFormOpen(true);
  };

  const handleEditRegion = (region: Region) => {
    setSelectedRegion(region);
    setIsRegionFormOpen(true);
  };

  const handleDeleteRegionClick = (region: Region) => {
    setSelectedRegion(region);
    setIsRegionDeleteOpen(true);
  };

  const handleRegionFormSubmit = (data: Omit<RegionInsert, 'organization_id' | 'created_by'> | RegionUpdate) => {
    if (selectedRegion) {
      updateRegion(
        { id: selectedRegion.id, updates: data as RegionUpdate },
        { onSuccess: () => setIsRegionFormOpen(false) }
      );
    } else {
      createRegion(data as Omit<RegionInsert, 'organization_id' | 'created_by'>, {
        onSuccess: () => setIsRegionFormOpen(false),
      });
    }
  };

  const handleRegionDeleteConfirm = () => {
    if (selectedRegion) {
      deleteRegion(selectedRegion.id, {
        onSuccess: () => {
          setIsRegionDeleteOpen(false);
          setSelectedRegion(null);
        },
      });
    }
  };

  if (isOrgLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!hasOrganization) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <h2 className="text-xl font-semibold mb-2">No Organization Found</h2>
          <p className="text-muted-foreground mb-4">
            Please complete the onboarding process to set up your organization.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Calculate stats
  const activeLocations = locations.filter(loc => loc.is_active).length;
  const primaryLocations = locations.filter(loc => loc.is_primary).length;
  const activeRegions = regions.filter(reg => reg.is_active).length;

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Locations</p>
                <p className="text-2xl font-bold text-foreground">{locations.length}</p>
              </div>
              <MapPin className="h-8 w-8 text-muted-foreground opacity-50" />
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              {activeLocations} active
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Regions</p>
                <p className="text-2xl font-bold text-foreground">{regions.length}</p>
              </div>
              <Globe className="h-8 w-8 text-muted-foreground opacity-50" />
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              {activeRegions} active
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Active Locations</p>
                <p className="text-2xl font-bold text-green-600">{activeLocations}</p>
              </div>
              <CheckCircle2 className="h-8 w-8 text-green-600 opacity-50" />
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              {locations.length - activeLocations} inactive
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Primary Locations</p>
                <p className="text-2xl font-bold text-primary">{primaryLocations}</p>
              </div>
              <MapPin className="h-8 w-8 text-primary opacity-50" />
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Main location{primaryLocations !== 1 ? 's' : ''}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <CardTitle>Practice Locations & Regions</CardTitle>
              <CardDescription className="mt-1">
                Manage your practice locations and regions ({locations.length} {locations.length === 1 ? 'location' : 'locations'}, {regions.length} {regions.length === 1 ? 'region' : 'regions'})
              </CardDescription>
            </div>
            <div className="flex items-center gap-3">
              {activeTab === 'locations' ? (
                <Button onClick={handleAddLocation}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Location
                </Button>
              ) : (
                <Button onClick={handleAddRegion}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Region
                </Button>
              )}
            </div>
          </div>

          {/* Filters Bar */}
          <div className="flex items-center gap-3 flex-wrap mt-4">
            {/* Search */}
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder={activeTab === 'locations' ? 'Search locations, codes, addresses...' : 'Search regions...'}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-9"
              />
            </div>

            {activeTab === 'locations' && (
              <Select value={selectedRegionFilter} onValueChange={setSelectedRegionFilter}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="All Locations" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Locations</SelectItem>
                  {regions.map((region) => (
                    <SelectItem key={region.id} value={region.id}>
                      {region.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </CardHeader>
      </Card>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'locations' | 'regions')}>
        <TabsList>
          <TabsTrigger value="regions">
            <Globe className="h-4 w-4 mr-2" />
            Regions ({regions.length})
          </TabsTrigger>
          <TabsTrigger value="locations">
            <MapPin className="h-4 w-4 mr-2" />
            Locations ({locations.length})
          </TabsTrigger>
        </TabsList>

        {/* Regions Tab */}
        <TabsContent value="regions" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Globe className="h-5 w-5" />
                Regions ({regions.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  <span className="ml-2 text-sm text-muted-foreground">Loading regions...</span>
                </div>
              ) : error ? (
                <div className="text-center py-8 text-muted-foreground">
                  <p className="text-lg font-medium mb-2 text-destructive">Error loading regions</p>
                  <p className="text-sm mb-4">{String(error)}</p>
                  <Button variant="outline" onClick={() => refetch()}>
                    Try Again
                  </Button>
                </div>
              ) : regions.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Globe className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p className="text-lg font-medium mb-2">No regions found</p>
                  <p className="text-sm mb-4">Get started by adding your first region.</p>
                  <Button variant="outline" onClick={handleAddRegion}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Region
                  </Button>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-3 px-4 font-medium text-muted-foreground">Region Name</th>
                        <th className="text-left py-3 px-4 font-medium text-muted-foreground">Code</th>
                        <th className="text-left py-3 px-4 font-medium text-muted-foreground">Description</th>
                        <th className="text-center py-3 px-4 font-medium text-muted-foreground">Status</th>
                        <th className="text-right py-3 px-4 font-medium text-muted-foreground">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {regions
                        .filter(region => {
                          if (!searchQuery.trim()) return true;
                          const query = searchQuery.toLowerCase();
                          return (
                            region.name.toLowerCase().includes(query) ||
                            region.code?.toLowerCase().includes(query) ||
                            region.description?.toLowerCase().includes(query)
                          );
                        })
                        .map((region) => (
                          <tr
                            key={region.id}
                            className="border-b border-border/50 hover:bg-muted/30 transition-colors"
                          >
                            <td className="py-3 px-4">
                              <span className="font-medium text-foreground">{region.name}</span>
                            </td>
                            <td className="py-3 px-4 text-muted-foreground">
                              {region.code || '-'}
                            </td>
                            <td className="py-3 px-4 text-muted-foreground text-sm">
                              {region.description || '-'}
                            </td>
                            <td className="text-center py-3 px-4">
                              {region.is_active ? (
                                <Badge variant="default" className="bg-green-500">
                                  <CheckCircle2 className="h-3 w-3 mr-1" />
                                  Active
                                </Badge>
                              ) : (
                                <Badge variant="secondary">
                                  <XCircle className="h-3 w-3 mr-1" />
                                  Inactive
                                </Badge>
                              )}
                            </td>
                            <td className="text-right py-3 px-4">
                              <div className="flex items-center justify-end gap-2">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleEditRegion(region)}
                                  disabled={isUpdatingRegion}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleDeleteRegionClick(region)}
                                  disabled={isDeletingRegion}
                                >
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Locations Tab */}
        <TabsContent value="locations" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MapPin className="h-5 w-5" />
                Locations ({filteredLocations.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  <span className="ml-2 text-sm text-muted-foreground">Loading locations...</span>
                </div>
              ) : error ? (
                <div className="text-center py-8 text-muted-foreground">
                  <p className="text-lg font-medium mb-2 text-destructive">Error loading locations</p>
                  <p className="text-sm mb-4">{String(error)}</p>
                  <Button variant="outline" onClick={() => refetch()}>
                    Try Again
                  </Button>
                </div>
              ) : filteredLocations.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <MapPin className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p className="text-lg font-medium mb-2">No locations found</p>
                  <p className="text-sm mb-4">
                    {searchQuery || selectedRegionFilter !== 'all'
                      ? 'Try adjusting your filters.'
                      : 'Get started by adding your first location.'}
                  </p>
                  <Button variant="outline" onClick={handleAddLocation}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Location
                  </Button>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-3 px-4 font-medium text-muted-foreground">Location</th>
                        <th className="text-left py-3 px-4 font-medium text-muted-foreground">Region</th>
                        <th className="text-left py-3 px-4 font-medium text-muted-foreground">Address</th>
                        <th className="text-left py-3 px-4 font-medium text-muted-foreground">Contact Info</th>
                        <th className="text-left py-3 px-4 font-medium text-muted-foreground">Timezone</th>
                        <th className="text-center py-3 px-4 font-medium text-muted-foreground">Status</th>
                        <th className="text-right py-3 px-4 font-medium text-muted-foreground">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredLocations.map((location) => {
                        const region = regions.find(r => r.id === location.region_id);
                        return (
                          <tr
                            key={location.id}
                            className="border-b border-border/50 hover:bg-muted/30 transition-colors"
                          >
                            <td className="py-3 px-4">
                              <div className="flex flex-col gap-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium text-foreground">{location.location_name}</span>
                                  {location.is_primary && (
                                    <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-primary/20">
                                      Primary
                                    </Badge>
                                  )}
                                </div>
                                {location.location_code && (
                                  <span className="text-xs text-muted-foreground font-mono">{location.location_code}</span>
                                )}
                              </div>
                            </td>
                            <td className="py-3 px-4">
                              {region ? (
                                <div className="flex items-center gap-2">
                                  <Globe className="h-3 w-3 text-muted-foreground" />
                                  <span className="text-foreground">{region.name}</span>
                                  {region.code && (
                                    <span className="text-xs text-muted-foreground">({region.code})</span>
                                  )}
                                </div>
                              ) : (
                                <span className="text-muted-foreground">-</span>
                              )}
                            </td>
                            <td className="py-3 px-4">
                              <div className="text-sm text-muted-foreground max-w-xs">
                                {formatAddress(location)}
                                {location.city && location.country && (
                                  <div className="text-xs mt-1 opacity-75">
                                    {location.city}, {location.country}
                                  </div>
                                )}
                              </div>
                            </td>
                            <td className="py-3 px-4">
                              <div className="space-y-1 text-sm">
                                {location.email && (
                                  <div className="text-foreground flex items-center gap-1">
                                    <span className="text-muted-foreground">Email:</span>
                                    <span>{location.email}</span>
                                  </div>
                                )}
                                {location.phone && (
                                  <div className="text-foreground flex items-center gap-1">
                                    <span className="text-muted-foreground">Phone:</span>
                                    <span>{location.phone}</span>
                                  </div>
                                )}
                                {location.fax && (
                                  <div className="text-foreground flex items-center gap-1">
                                    <span className="text-muted-foreground">Fax:</span>
                                    <span>{location.fax}</span>
                                  </div>
                                )}
                                {!location.email && !location.phone && !location.fax && (
                                  <span className="text-muted-foreground">-</span>
                                )}
                              </div>
                            </td>
                            <td className="py-3 px-4 text-sm text-muted-foreground">
                              {location.timezone || '-'}
                            </td>
                            <td className="text-center py-3 px-4">
                              {location.is_active ? (
                                <Badge variant="default" className="bg-green-500">
                                  <CheckCircle2 className="h-3 w-3 mr-1" />
                                  Active
                                </Badge>
                              ) : (
                                <Badge variant="secondary">
                                  <XCircle className="h-3 w-3 mr-1" />
                                  Inactive
                                </Badge>
                              )}
                            </td>
                            <td className="text-right py-3 px-4">
                              <div className="flex items-center justify-end gap-2">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleEditLocation(location)}
                                  disabled={isUpdating}
                                  title="Edit location"
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleDeleteClick(location)}
                                  disabled={isDeleting}
                                  title="Delete location"
                                >
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      <LocationFormDialog
        open={isFormOpen}
        onOpenChange={setIsFormOpen}
        location={selectedLocation}
        regions={regions}
        onSubmit={handleFormSubmit}
        isLoading={isCreating || isUpdating}
      />

      <DeleteLocationDialog
        open={isDeleteOpen}
        onOpenChange={setIsDeleteOpen}
        location={selectedLocation}
        onConfirm={handleDeleteConfirm}
        isLoading={isDeleting}
      />

      <RegionFormDialog
        open={isRegionFormOpen}
        onOpenChange={setIsRegionFormOpen}
        region={selectedRegion}
        onSubmit={handleRegionFormSubmit}
        isLoading={isCreatingRegion || isUpdatingRegion}
      />

      <DeleteRegionDialog
        open={isRegionDeleteOpen}
        onOpenChange={setIsRegionDeleteOpen}
        region={selectedRegion}
        onConfirm={handleRegionDeleteConfirm}
        isLoading={isDeletingRegion}
      />
    </div>
  );
}
