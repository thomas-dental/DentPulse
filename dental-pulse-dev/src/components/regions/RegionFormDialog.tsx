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
import { Region, RegionInsert, RegionUpdate } from '@/types/location';

interface RegionFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  region?: Region | null;
  onSubmit: (data: Omit<RegionInsert, 'organization_id' | 'created_by'> | RegionUpdate) => void;
  isLoading?: boolean;
}

export function RegionFormDialog({
  open,
  onOpenChange,
  region,
  onSubmit,
  isLoading,
}: RegionFormDialogProps) {
  const isEditing = !!region;

  const [formData, setFormData] = useState({
    name: '',
    code: '',
    description: '',
    is_active: true,
  });

  useEffect(() => {
    if (open) {
      if (region) {
        // Edit mode - populate with existing data
        setFormData({
          name: region.name || '',
          code: region.code || '',
          description: region.description || '',
          is_active: region.is_active ?? true,
        });
      } else {
        // Create mode - reset to default values
        setFormData({
          name: '',
          code: '',
          description: '',
          is_active: true,
        });
      }
    }
  }, [region, open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const submitData = {
      name: formData.name,
      code: formData.code || null,
      description: formData.description || null,
      is_active: formData.is_active,
    };

    onSubmit(submitData);
  };

  if (!open) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="text-xl">
            {isEditing ? 'Edit Region' : 'Add New Region'}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? 'Update the region information below. All fields are optional except region name.'
              : 'Fill in the details to add a new region. Region name is required.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-4">
            <div>
              <Label htmlFor="name">Region Name *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="South London"
                required
                minLength={2}
              />
            </div>

            <div>
              <Label htmlFor="code">Region Code</Label>
              <Input
                id="code"
                value={formData.code}
                onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                placeholder="SL"
                maxLength={50}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Optional short code for internal reference
              </p>
            </div>

            <div>
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Brief description of the region..."
                rows={3}
              />
            </div>

            <div className="flex items-center justify-between p-4 border rounded-lg">
              <div className="space-y-0.5">
                <Label htmlFor="is_active" className="text-base">Active Status</Label>
                <p className="text-sm text-muted-foreground">
                  Inactive regions will not appear in dropdowns
                </p>
              </div>
              <Switch
                id="is_active"
                checked={formData.is_active}
                onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading || !formData.name}>
              {isLoading ? 'Saving...' : isEditing ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
