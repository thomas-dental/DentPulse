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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Specialty, SpecialtyInsert, SpecialtyUpdate } from '@/types/provider';
import { ProviderTypeEntity } from '@/types/provider';

interface SpecialtyFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  specialty?: Specialty | null;
  providerTypes?: ProviderTypeEntity[];
  onSubmit: (data: Omit<SpecialtyInsert, 'organization_id' | 'created_by'> | SpecialtyUpdate) => void;
  isLoading?: boolean;
}

export function SpecialtyFormDialog({
  open,
  onOpenChange,
  specialty,
  providerTypes = [],
  onSubmit,
  isLoading,
}: SpecialtyFormDialogProps) {
  const isEditing = !!specialty;
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    description: '',
    provider_type_id: '',
    is_active: true,
    display_order: 0,
  });

  useEffect(() => {
    if (open) {
      if (specialty) {
        setFormData({
          name: specialty.name,
          code: specialty.code || '',
          description: specialty.description || '',
          provider_type_id: specialty.provider_type_id || '',
          is_active: specialty.is_active,
          display_order: specialty.display_order,
        });
      } else {
        setFormData({
          name: '',
          code: '',
          description: '',
          provider_type_id: '',
          is_active: true,
          display_order: 0,
        });
      }
    }
  }, [specialty, open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      return;
    }

    const submitData = {
      name: formData.name.trim(),
      code: formData.code || null,
      description: formData.description || null,
      provider_type_id: formData.provider_type_id || null,
      is_active: formData.is_active,
      display_order: formData.display_order,
    };

    onSubmit(submitData);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit Specialty' : 'Add New Specialty'}</DialogTitle>
          <DialogDescription>
            {isEditing ? 'Update the specialty details below.' : 'Fill in the details to add a new specialty.'}
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
                placeholder="e.g., General, Implants"
                required
              />
            </div>

            <div>
              <Label htmlFor="code">Code</Label>
              <Input
                id="code"
                value={formData.code}
                onChange={(e) => setFormData({ ...formData, code: e.target.value.toLowerCase().replace(/\s+/g, '_') })}
                placeholder="e.g., general"
              />
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
              <Label htmlFor="provider_type_id">Provider Type</Label>
              <Select
                value={formData.provider_type_id || 'none'}
                onValueChange={(value) => setFormData({ ...formData, provider_type_id: value === 'none' ? '' : value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select provider type (optional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None (All Provider Types)</SelectItem>
                  {providerTypes.map((pt) => (
                    <SelectItem key={pt.id} value={pt.id}>
                      {pt.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
            <Button type="submit" disabled={isLoading || !formData.name.trim()}>
              {isLoading ? 'Saving...' : isEditing ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
