import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { TreatmentCategoryFormDialog } from './TreatmentCategoryFormDialog';
import { TreatmentCategory, TreatmentCategoryInsert, TreatmentCategoryUpdate } from '@/types/treatment-category';
import { PracticeLocation, Region } from '@/types/location';
import { Edit, Trash2 } from 'lucide-react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface TreatmentCategoriesManagementProps {
  categories: TreatmentCategory[];
  locations?: PracticeLocation[];
  regions?: Region[];
  onCreate: (category: Omit<TreatmentCategoryInsert, 'organization_id' | 'created_by'>) => void;
  onUpdate: (category: TreatmentCategoryUpdate & { id: string }) => void;
  onDelete: (categoryId: string) => void;
  isLoading?: boolean;
  onCreateClick?: () => void; // Expose create handler for external button
  canAdd?: boolean;
  canUpdate?: boolean;
  canDelete?: boolean;
}

export function TreatmentCategoriesManagement({
  categories,
  locations = [],
  regions = [],
  onCreate,
  onUpdate,
  onDelete,
  isLoading,
  onCreateClick,
  canAdd = true,
  canUpdate = true,
  canDelete = true,
}: TreatmentCategoriesManagementProps) {
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<TreatmentCategory | null>(null);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [categoryToDelete, setCategoryToDelete] = useState<string | null>(null);

  // Categories are org-wide items — no location/region filtering needed.
  // Location filtering applies to revenue/TPI data, not catalog items.
  const filteredCategories = categories;

  const handleCreate = (e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    console.log('handleCreate called');
    setSelectedCategory(null);
    setIsFormOpen(true);
    console.log('isFormOpen set to true', isFormOpen);
  };

  const handleEdit = (category: TreatmentCategory) => {
    setSelectedCategory(category);
    setIsFormOpen(true);
  };

  const handleDelete = (categoryId: string) => {
    setCategoryToDelete(categoryId);
    setIsDeleteOpen(true);
  };

  const handleFormSubmit = async (data: Omit<TreatmentCategoryInsert, 'organization_id' | 'created_by'> | TreatmentCategoryUpdate) => {
    try {
      if (selectedCategory) {
        await onUpdate({ ...data, id: selectedCategory.id } as TreatmentCategoryUpdate & { id: string });
      } else {
        await onCreate(data as Omit<TreatmentCategoryInsert, 'organization_id' | 'created_by'>);
      }
      setIsFormOpen(false);
      setSelectedCategory(null);
    } catch (error) {
      // Error handling is done in the hook
      console.error('Error submitting form:', error);
    }
  };

  const handleDeleteConfirm = () => {
    if (categoryToDelete) {
      onDelete(categoryToDelete);
      setIsDeleteOpen(false);
      setCategoryToDelete(null);
    }
  };

  const sortedCategories = [...filteredCategories].sort((a, b) => 
    (a.display_order || 0) - (b.display_order || 0)
  );

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Treatment Categories</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table className="w-full" style={{ borderCollapse: 'collapse' }}>
              <TableHeader>
                <TableRow>
                  <TableHead className="border-r border-b border-black">Name</TableHead>
                  <TableHead className="text-center border-r border-b border-black">Description</TableHead>
                  <TableHead className="text-center border-r border-b border-black">Display Order</TableHead>
                  <TableHead className="text-center border-r border-b border-black">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedCategories.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-8 border-r border-b border-black">
                      No treatment categories found. Click "Add Treatment Category" to create one.
                    </TableCell>
                  </TableRow>
                ) : (
                  sortedCategories.map((category) => {
                    return (
                      <TableRow key={category.id}>
                        <TableCell className="font-medium border-r border-b border-black">{category.name}</TableCell>
                        <TableCell className="text-center text-muted-foreground border-r border-b border-black">
                          {category.description || '-'}
                        </TableCell>
                        <TableCell className="text-center border-r border-b border-black">{category.display_order || 0}</TableCell>
                        <TableCell className="text-center border-r border-b border-black">
                          <div className="flex items-center justify-center gap-2">
                            {canUpdate && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleEdit(category)}
                              disabled={isLoading}
                            >
                              <Edit className="w-4 h-4" />
                            </Button>
                            )}
                            {canDelete && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDelete(category.id)}
                              disabled={isLoading}
                            >
                              <Trash2 className="w-4 h-4 text-destructive" />
                            </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <TreatmentCategoryFormDialog
        open={isFormOpen}
        onOpenChange={setIsFormOpen}
        category={selectedCategory}
        locations={locations}
        regions={regions}
        onSubmit={handleFormSubmit}
        isLoading={isLoading}
      />

      <AlertDialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Treatment Category</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this treatment category? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm} className="bg-destructive text-destructive-foreground">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
