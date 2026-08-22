import { useState, useMemo } from 'react';
import { Helmet } from 'react-helmet-async';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ProviderTypeFormDialog } from '@/components/provider-types/ProviderTypeFormDialog';
import { DeleteProviderTypeDialog } from '@/components/provider-types/DeleteProviderTypeDialog';
import { useProviderTypes } from '@/hooks/useProviderTypes';
import { ProviderTypeEntity, ProviderTypeInsert, ProviderTypeUpdate } from '@/types/provider';
import { Plus, Pencil, Trash2, Loader2, CheckCircle2, XCircle, Search, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export default function ProviderTypes() {
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [selectedProviderType, setSelectedProviderType] = useState<ProviderTypeEntity | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const {
    providerTypes,
    activeProviderTypes,
    isLoading,
    createProviderType,
    updateProviderType,
    deleteProviderType,
    isCreating,
    isUpdating,
    isDeleting,
  } = useProviderTypes();

  const handleAdd = () => {
    setSelectedProviderType(null);
    setIsFormOpen(true);
  };

  const handleEdit = (providerType: ProviderTypeEntity) => {
    setSelectedProviderType(providerType);
    setIsFormOpen(true);
  };

  const handleDeleteClick = (providerType: ProviderTypeEntity) => {
    setSelectedProviderType(providerType);
    setIsDeleteOpen(true);
  };

  const handleFormSubmit = (data: Omit<ProviderTypeInsert, 'organization_id' | 'created_by'> | ProviderTypeUpdate) => {
    if (selectedProviderType) {
      updateProviderType(
        { id: selectedProviderType.id, updates: data as ProviderTypeUpdate },
        { onSuccess: () => setIsFormOpen(false) }
      );
    } else {
      createProviderType(data as Omit<ProviderTypeInsert, 'organization_id' | 'created_by'>, {
        onSuccess: () => setIsFormOpen(false),
      });
    }
  };

  const handleDeleteConfirm = () => {
    if (selectedProviderType) {
      deleteProviderType(selectedProviderType.id, {
        onSuccess: () => {
          setIsDeleteOpen(false);
          setSelectedProviderType(null);
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

  return (
    <MainLayout userRole="admin">
      <Helmet>
        <title>Provider Types Management</title>
        <meta name="description" content="Create and manage provider type classifications for your dental practice organization." />
      </Helmet>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold text-foreground">Provider Types</h1>
              <p className="text-muted-foreground mt-1">
                Manage provider types ({providerTypes.length} {providerTypes.length === 1 ? 'type' : 'types'})
              </p>
            </div>
            <Button onClick={handleAdd}>
              <Plus className="h-4 w-4 mr-2" />
              Add Provider Type
            </Button>
          </div>

          {/* Search */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search provider types..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-9"
              />
            </div>
          </div>
        </div>

        {/* Table */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              All Provider Types ({filteredProviderTypes.length})
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
                <Button variant="outline" onClick={handleAdd}>
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
                              onClick={() => handleEdit(providerType)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDeleteClick(providerType)}
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

        {/* Dialogs */}
        <ProviderTypeFormDialog
          open={isFormOpen}
          onOpenChange={setIsFormOpen}
          providerType={selectedProviderType}
          onSubmit={handleFormSubmit}
          isLoading={isCreating || isUpdating}
        />
        <DeleteProviderTypeDialog
          open={isDeleteOpen}
          onOpenChange={setIsDeleteOpen}
          providerType={selectedProviderType}
          onConfirm={handleDeleteConfirm}
          isLoading={isDeleting}
        />
      </div>
    </MainLayout>
  );
}
