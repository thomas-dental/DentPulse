import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { TreatmentCategory, TreatmentCategoryInsert, TreatmentCategoryUpdate } from '@/types/treatment-category';
import { PracticeLocation, Region } from '@/types/location';
import { useFilters } from '@/contexts/FilterContext';

interface TreatmentCategoryFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  category?: TreatmentCategory | null;
  locations?: PracticeLocation[];
  regions?: Region[];
  onSubmit: (data: Omit<TreatmentCategoryInsert, 'organization_id' | 'created_by'> | TreatmentCategoryUpdate) => void;
  isLoading?: boolean;
}

export function TreatmentCategoryFormDialog({
  open,
  onOpenChange,
  category,
  locations = [],
  regions = [],
  onSubmit,
  isLoading,
}: TreatmentCategoryFormDialogProps) {
  const isEditing = !!category;
  const { selectedRegionId, selectedLocationId } = useFilters();
  
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    display_order: 0,
    location_id: null as string | null,
    region_id: null as string | null,
  });

  // Debug: Log when dialog opens
  useEffect(() => {
    console.log('TreatmentCategoryFormDialog render', { open, isEditing, category, locations: locations?.length, regions: regions?.length });
    if (open) {
      console.log('TreatmentCategoryFormDialog opened', { isEditing, category, locations: locations?.length, regions: regions?.length });
    }
  }, [open, isEditing, category, locations, regions]);

  useEffect(() => {
    if (open) {
      if (category) {
        // When editing, use current selected location/region from global filters
        setFormData({
          name: category.name || '',
          description: category.description || '',
          display_order: category.display_order || 0,
          location_id: selectedLocationId || null,
          region_id: selectedRegionId || null,
        });
      } else {
        // Reset form for new category and auto-populate from global filters
        setFormData({
          name: '',
          description: '',
          display_order: 0,
          location_id: selectedLocationId || null,
          region_id: selectedRegionId || null,
        });
      }
    }
  }, [category, open, selectedLocationId, selectedRegionId]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      return;
    }
    
    // Ensure empty strings are converted to null for location_id and region_id
    const submitData = {
      name: formData.name,
      description: formData.description || null,
      display_order: formData.display_order,
      location_id: formData.location_id && formData.location_id !== '' ? formData.location_id : null,
      region_id: formData.region_id && formData.region_id !== '' ? formData.region_id : null,
    };
    
    if (isEditing && category) {
      onSubmit(submitData as TreatmentCategoryUpdate);
    } else {
      onSubmit(submitData as Omit<TreatmentCategoryInsert, 'organization_id' | 'created_by'>);
    }
  };

  // Early return if not open (similar to LocationFormDialog pattern)
  if (!open) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? 'Edit Treatment Category' : 'Add New Treatment Category'}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? 'Update the treatment category information below.'
              : 'Fill in the details to add a new treatment category.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="name">Category Name *</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g., NHS Treatments, Private Treatments"
              required
            />
          </div>

          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Optional description"
              rows={3}
            />
          </div>


          <div>
            <Label htmlFor="display_order">Display Order</Label>
            <Input
              id="display_order"
              type="number"
              value={formData.display_order}
              onChange={(e) => setFormData({ ...formData, display_order: parseInt(e.target.value) || 0 })}
              placeholder="0"
              min="0"
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading || !formData.name.trim()}>
              {isLoading ? 'Saving...' : isEditing ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
