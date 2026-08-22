import { useState, useMemo } from 'react';
import { Helmet } from 'react-helmet-async';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ProviderTypeFormDialog } from '@/components/provider-types/ProviderTypeFormDialog';
import { DeleteProviderTypeDialog } from '@/components/provider-types/DeleteProviderTypeDialog';
import { SpecialtyFormDialog } from '@/components/specialties/SpecialtyFormDialog';
import { DeleteSpecialtyDialog } from '@/components/specialties/DeleteSpecialtyDialog';
import { useProviderTypes } from '@/hooks/useProviderTypes';
import { useSpecialties } from '@/hooks/useSpecialties';
import { ProviderTypeEntity, ProviderTypeInsert, ProviderTypeUpdate } from '@/types/provider';
import { Specialty, SpecialtyInsert, SpecialtyUpdate } from '@/types/provider';
import { Stethoscope, Plus, Pencil, Trash2, Loader2, CheckCircle2, XCircle, Search, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function ProviderSettings() {
  const [isProviderTypeFormOpen, setIsProviderTypeFormOpen] = useState(false);
  const [isProviderTypeDeleteOpen, setIsProviderTypeDeleteOpen] = useState(false);
  const [isSpecialtyFormOpen, setIsSpecialtyFormOpen] = useState(false);
  const [isSpecialtyDeleteOpen, setIsSpecialtyDeleteOpen] = useState(false);
  const [selectedProviderType, setSelectedProviderType] = useState<ProviderTypeEntity | null>(null);
  const [selectedSpecialty, setSelectedSpecialty] = useState<Specialty | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'provider-types' | 'specialties'>('provider-types');

  const {
    providerTypes,
    activeProviderTypes,
    isLoading: isLoadingTypes,
    createProviderType,
    updateProviderType,
    deleteProviderType,
    isCreating: isCreatingType,
    isUpdating: isUpdatingType,
    isDeleting: isDeletingType,
  } = useProviderTypes();

  const {
    specialties,
    activeSpecialties,
    isLoading: isLoadingSpecialties,
    createSpecialty,
    updateSpecialty,
    deleteSpecialty,
    isCreating: isCreatingSpecialty,
    isUpdating: isUpdatingSpecialty,
    isDeleting: isDeletingSpecialty,
  } = useSpecialties();

  // Provider Type handlers
  const handleAddProviderType = () => {
    setSelectedProviderType(null);
    setIsProviderTypeFormOpen(true);
  };

  const handleEditProviderType = (providerType: ProviderTypeEntity) => {
    setSelectedProviderType(providerType);
    setIsProviderTypeFormOpen(true);
  };

  const handleDeleteProviderTypeClick = (providerType: ProviderTypeEntity) => {
    setSelectedProviderType(providerType);
    setIsProviderTypeDeleteOpen(true);
  };

  const handleProviderTypeFormSubmit = (data: Omit<ProviderTypeInsert, 'organization_id' | 'created_by'> | ProviderTypeUpdate) => {
    if (selectedProviderType) {
      updateProviderType(
        { id: selectedProviderType.id, updates: data as ProviderTypeUpdate },
        { onSuccess: () => setIsProviderTypeFormOpen(false) }
      );
    } else {
      createProviderType(data as Omit<ProviderTypeInsert, 'organization_id' | 'created_by'>, {
        onSuccess: () => setIsProviderTypeFormOpen(false),
      });
    }
  };

  const handleProviderTypeDeleteConfirm = () => {
    if (selectedProviderType) {
      deleteProviderType(selectedProviderType.id, {
        onSuccess: () => {
          setIsProviderTypeDeleteOpen(false);
          setSelectedProviderType(null);
        },
      });
    }
  };

  // Specialty handlers
  const handleAddSpecialty = () => {
    setSelectedSpecialty(null);
    setIsSpecialtyFormOpen(true);
  };

  const handleEditSpecialty = (specialty: Specialty) => {
    setSelectedSpecialty(specialty);
    setIsSpecialtyFormOpen(true);
  };

  const handleDeleteSpecialtyClick = (specialty: Specialty) => {
    setSelectedSpecialty(specialty);
    setIsSpecialtyDeleteOpen(true);
  };

  const handleSpecialtyFormSubmit = (data: Omit<SpecialtyInsert, 'organization_id' | 'created_by'> | SpecialtyUpdate) => {
    if (selectedSpecialty) {
      updateSpecialty(
        { id: selectedSpecialty.id, updates: data as SpecialtyUpdate },
        { onSuccess: () => setIsSpecialtyFormOpen(false) }
      );
    } else {
      createSpecialty(data as Omit<SpecialtyInsert, 'organization_id' | 'created_by'>, {
        onSuccess: () => setIsSpecialtyFormOpen(false),
      });
    }
  };

  const handleSpecialtyDeleteConfirm = () => {
    if (selectedSpecialty) {
      deleteSpecialty(selectedSpecialty.id, {
        onSuccess: () => {
          setIsSpecialtyDeleteOpen(false);
          setSelectedSpecialty(null);
        },
      });
    }
  };

  // Filter provider types by search query
  const filteredProviderTypes = useMemo(() => {
    if (!searchQuery.trim()) return providerTypes;
    const query = searchQuery.toLowerCase();
    return providerTypes.filter(pt =>
      pt.name.toLowerCase().includes(query) ||
      pt.code.toLowerCase().includes(query) ||
      pt.description?.toLowerCase().includes(query)
    );
  }, [providerTypes, searchQuery]);

  // Filter specialties by search query
  const filteredSpecialties = useMemo(() => {
    if (!searchQuery.trim()) return specialties;
    const query = searchQuery.toLowerCase();
    return specialties.filter(s =>
      s.name.toLowerCase().includes(query) ||
      s.code?.toLowerCase().includes(query) ||
      s.description?.toLowerCase().includes(query)
    );
  }, [specialties, searchQuery]);

  const isLoading = isLoadingTypes || isLoadingSpecialties;

  return (
    <MainLayout userRole="admin">
      <Helmet>
        <title>Provider & Specialty Settings</title>
        <meta name="description" content="Configure provider types, specialties, and manage provider-related organizational settings." />
      </Helmet>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold text-foreground">Provider Settings</h1>
              <p className="text-muted-foreground mt-1">
                Manage provider types and specialties ({providerTypes.length} {providerTypes.length === 1 ? 'type' : 'types'}, {specialties.length} {specialties.length === 1 ? 'specialty' : 'specialties'})
              </p>
            </div>
            <div className="flex items-center gap-3">
              {activeTab === 'provider-types' ? (
                <Button onClick={handleAddProviderType}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Provider Type
                </Button>
              ) : (
                <Button onClick={handleAddSpecialty}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Specialty
                </Button>
              )}
            </div>
          </div>

          {/* Filters Bar */}
          <div className="flex items-center gap-3 flex-wrap">
            {/* Search */}
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder={activeTab === 'provider-types' ? 'Search provider types...' : 'Search specialties...'}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-9"
              />
            </div>
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'provider-types' | 'specialties')}>
          <TabsList>
            <TabsTrigger value="provider-types">
              <Users className="h-4 w-4 mr-2" />
              Provider Types ({providerTypes.length})
            </TabsTrigger>
            <TabsTrigger value="specialties">
              <Stethoscope className="h-4 w-4 mr-2" />
              Specialties ({specialties.length})
            </TabsTrigger>
          </TabsList>

          {/* Provider Types Tab */}
          <TabsContent value="provider-types" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Provider Types ({filteredProviderTypes.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : filteredProviderTypes.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p className="text-lg font-medium mb-2">No provider types found</p>
                    <p className="text-sm mb-4">Get started by adding your first provider type.</p>
                    <Button variant="outline" onClick={handleAddProviderType}>
                      <Plus className="h-4 w-4 mr-2" />
                      Add Provider Type
                    </Button>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="text-left py-3 px-4 font-medium text-muted-foreground">Name</th>
                          <th className="text-left py-3 px-4 font-medium text-muted-foreground">Code</th>
                          <th className="text-left py-3 px-4 font-medium text-muted-foreground">Description</th>
                          <th className="text-center py-3 px-4 font-medium text-muted-foreground">Status</th>
                          <th className="text-center py-3 px-4 font-medium text-muted-foreground">Order</th>
                          <th className="text-right py-3 px-4 font-medium text-muted-foreground">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredProviderTypes.map((providerType) => (
                          <tr key={providerType.id} className="border-b border-border hover:bg-muted/50">
                            <td className="py-3 px-4">
                              <div className="font-medium">{providerType.name}</div>
                            </td>
                            <td className="py-3 px-4">
                              <code className="text-xs bg-muted px-2 py-1 rounded">{providerType.code}</code>
                            </td>
                            <td className="py-3 px-4">
                              <div className="text-sm text-muted-foreground">
                                {providerType.description || '-'}
                              </div>
                            </td>
                            <td className="py-3 px-4 text-center">
                              {providerType.is_active ? (
                                <Badge variant="default" className="gap-1">
                                  <CheckCircle2 className="h-3 w-3" />
                                  Active
                                </Badge>
                              ) : (
                                <Badge variant="secondary" className="gap-1">
                                  <XCircle className="h-3 w-3" />
                                  Inactive
                                </Badge>
                              )}
                            </td>
                            <td className="py-3 px-4 text-center">
                              <span className="text-sm">{providerType.display_order}</span>
                            </td>
                            <td className="py-3 px-4">
                              <div className="flex items-center justify-end gap-2">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleEditProviderType(providerType)}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleDeleteProviderTypeClick(providerType)}
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

          {/* Specialties Tab */}
          <TabsContent value="specialties" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Stethoscope className="h-5 w-5" />
                  Specialties ({filteredSpecialties.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                {isLoadingSpecialties ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : filteredSpecialties.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Stethoscope className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p className="text-lg font-medium mb-2">No specialties found</p>
                    <p className="text-sm mb-4">Get started by adding your first specialty.</p>
                    <Button variant="outline" onClick={handleAddSpecialty}>
                      <Plus className="h-4 w-4 mr-2" />
                      Add Specialty
                    </Button>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="text-left py-3 px-4 font-medium text-muted-foreground">Name</th>
                          <th className="text-left py-3 px-4 font-medium text-muted-foreground">Code</th>
                          <th className="text-left py-3 px-4 font-medium text-muted-foreground">Provider Type</th>
                          <th className="text-left py-3 px-4 font-medium text-muted-foreground">Description</th>
                          <th className="text-center py-3 px-4 font-medium text-muted-foreground">Status</th>
                          <th className="text-center py-3 px-4 font-medium text-muted-foreground">Order</th>
                          <th className="text-right py-3 px-4 font-medium text-muted-foreground">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredSpecialties.map((specialty) => {
                          const providerType = providerTypes.find(pt => pt.id === specialty.provider_type_id);
                          return (
                            <tr key={specialty.id} className="border-b border-border hover:bg-muted/50">
                              <td className="py-3 px-4">
                                <div className="font-medium">{specialty.name}</div>
                              </td>
                              <td className="py-3 px-4">
                                {specialty.code ? (
                                  <code className="text-xs bg-muted px-2 py-1 rounded">{specialty.code}</code>
                                ) : (
                                  <span className="text-muted-foreground">-</span>
                                )}
                              </td>
                              <td className="py-3 px-4">
                                {providerType ? (
                                  <Badge variant="outline">{providerType.name}</Badge>
                                ) : (
                                  <span className="text-sm text-muted-foreground">All Types</span>
                                )}
                              </td>
                              <td className="py-3 px-4">
                                <div className="text-sm text-muted-foreground">
                                  {specialty.description || '-'}
                                </div>
                              </td>
                              <td className="py-3 px-4 text-center">
                                {specialty.is_active ? (
                                  <Badge variant="default" className="gap-1">
                                    <CheckCircle2 className="h-3 w-3" />
                                    Active
                                  </Badge>
                                ) : (
                                  <Badge variant="secondary" className="gap-1">
                                    <XCircle className="h-3 w-3" />
                                    Inactive
                                  </Badge>
                                )}
                              </td>
                              <td className="py-3 px-4 text-center">
                                <span className="text-sm">{specialty.display_order}</span>
                              </td>
                              <td className="py-3 px-4">
                                <div className="flex items-center justify-end gap-2">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => handleEditSpecialty(specialty)}
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => handleDeleteSpecialtyClick(specialty)}
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
        <ProviderTypeFormDialog
          open={isProviderTypeFormOpen}
          onOpenChange={setIsProviderTypeFormOpen}
          providerType={selectedProviderType}
          onSubmit={handleProviderTypeFormSubmit}
          isLoading={isCreatingType || isUpdatingType}
        />
        <DeleteProviderTypeDialog
          open={isProviderTypeDeleteOpen}
          onOpenChange={setIsProviderTypeDeleteOpen}
          providerType={selectedProviderType}
          onConfirm={handleProviderTypeDeleteConfirm}
          isLoading={isDeletingType}
        />
        <SpecialtyFormDialog
          open={isSpecialtyFormOpen}
          onOpenChange={setIsSpecialtyFormOpen}
          specialty={selectedSpecialty}
          providerTypes={activeProviderTypes}
          onSubmit={handleSpecialtyFormSubmit}
          isLoading={isCreatingSpecialty || isUpdatingSpecialty}
        />
        <DeleteSpecialtyDialog
          open={isSpecialtyDeleteOpen}
          onOpenChange={setIsSpecialtyDeleteOpen}
          specialty={selectedSpecialty}
          onConfirm={handleSpecialtyDeleteConfirm}
          isLoading={isDeletingSpecialty}
        />
      </div>
    </MainLayout>
  );
}
