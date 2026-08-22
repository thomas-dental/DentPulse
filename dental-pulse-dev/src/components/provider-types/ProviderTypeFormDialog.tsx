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
import { Switch } from '@/components/ui/switch';
import { ProviderTypeEntity, ProviderTypeInsert, ProviderTypeUpdate } from '@/types/provider';

interface ProviderTypeFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providerType?: ProviderTypeEntity | null;
  onSubmit: (data: Omit<ProviderTypeInsert, 'organization_id' | 'created_by'> | ProviderTypeUpdate) => void;
  isLoading?: boolean;
}

export function ProviderTypeFormDialog({
  open,
  onOpenChange,
  providerType,
  onSubmit,
  isLoading,
}: ProviderTypeFormDialogProps) {
  const isEditing = !!providerType;
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    description: '',
    is_active: true,
    display_order: 0,
  });

  useEffect(() => {
    if (open) {
      if (providerType) {
        setFormData({
          name: providerType.name,
          code: providerType.code,
          description: providerType.description || '',
          is_active: providerType.is_active,
          display_order: providerType.display_order,
        });
      } else {
        setFormData({
          name: '',
          code: '',
          description: '',
          is_active: true,
          display_order: 0,
        });
      }
    }
  }, [providerType, open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim() || !formData.code.trim()) {
      return;
    }

    const submitData = {
      name: formData.name.trim(),
      code: formData.code.trim().toLowerCase(),
      description: formData.description || null,
      is_active: formData.is_active,
      display_order: formData.display_order,
    };

    onSubmit(submitData);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit Provider Type' : 'Add New Provider Type'}</DialogTitle>
          <DialogDescription>
            {isEditing ? 'Update the provider type details below.' : 'Fill in the details to add a new provider type.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Associate Dentist"
                required
              />
            </div>

            <div>
              <Label htmlFor="code">Code *</Label>
              <Input
                id="code"
                value={formData.code}
                onChange={(e) => setFormData({ ...formData, code: e.target.value.toLowerCase().replace(/\s+/g, '_') })}
                placeholder="e.g., associate"
                required
                disabled={isEditing}
              />
              <p className="text-xs text-muted-foreground mt-1">Code cannot be changed after creation</p>
            </div>

            <div>
              <Label htmlFor="display_order">Display Order</Label>
              <Input
                id="display_order"
                type="number"
                min="0"
                value={formData.display_order}
                onChange={(e) => setFormData({ ...formData, display_order: parseInt(e.target.value) || 0 })}
                placeholder="0"
              />
            </div>

            <div className="col-span-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Optional description"
                rows={3}
              />
            </div>

            <div className="col-span-2 flex items-center space-x-2">
              <Switch
                id="is_active"
                checked={formData.is_active}
                onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
              />
              <Label htmlFor="is_active" className="cursor-pointer">
                Active
              </Label>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading || !formData.name.trim() || !formData.code.trim()}>
              {isLoading ? 'Saving...' : isEditing ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
