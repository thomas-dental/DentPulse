import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import { InvoiceFolder, CreateFolderInput } from '@/hooks/useInvoiceFolders';

interface Location {
  id: string;
  location_name: string;
}

interface NewFolderModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateFolder: (input: CreateFolderInput) => void;
  isCreating: boolean;
  folders: InvoiceFolder[];
  editFolder?: InvoiceFolder | null;
  onUpdateFolder?: (input: { id: string; updates: { name: string; parent_id: string | null } }) => void;
  isUpdating?: boolean;
  selectedLocationId?: string | null;
  locations?: Location[];
}

export function NewFolderModal({
  open,
  onOpenChange,
  onCreateFolder,
  isCreating,
  folders,
  editFolder,
  onUpdateFolder,
  isUpdating,
  selectedLocationId,
  locations = [],
}: NewFolderModalProps) {
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState<string | null>(null);
  const [locationId, setLocationId] = useState<string | null>(null);

  // Reset form when modal opens/closes or editFolder changes
  useEffect(() => {
    if (open) {
      if (editFolder) {
        setName(editFolder.name);
        setParentId(editFolder.parent_id);
        setLocationId(editFolder.location_id);
      } else {
        setName('');
        setParentId(null);
        // Use selected location or first available location
        if (selectedLocationId) {
          setLocationId(selectedLocationId);
        } else if (locations.length > 0) {
          setLocationId(locations[0].id);
        } else {
          setLocationId(null);
        }
      }
    }
  }, [open, editFolder, selectedLocationId, locations]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    // VALIDATION: location_id is required
    if (!locationId) {
      console.error('[NewFolderModal] Cannot create folder - no location selected');
      return;
    }

    if (editFolder && onUpdateFolder) {
      onUpdateFolder({
        id: editFolder.id,
        updates: {
          name: name.trim(),
          parent_id: parentId,
        },
      });
    } else {
      onCreateFolder({
        name: name.trim(),
        parent_id: parentId,
        location_id: locationId,
      });
    }
  };

  // Filter out current folder and its children from parent options (when editing)
  const availableParents = folders.filter((f) => {
    if (!editFolder) return true;
    // Can't be its own parent
    if (f.id === editFolder.id) return false;
    // Can't select a child as parent (would create circular reference)
    let current = f;
    while (current.parent_id) {
      if (current.parent_id === editFolder.id) return false;
      current = folders.find((folder) => folder.id === current.parent_id) || current;
      if (current.parent_id === editFolder.id) return false;
    }
    return true;
  });

  const isSubmitting = isCreating || isUpdating;
  const canSubmit = name.trim() && locationId && !isSubmitting;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{editFolder ? 'Edit Folder' : 'Create New Folder'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Folder Name</Label>
              <Input
                id="name"
                placeholder="Enter folder name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>

            {/* Location selector - only show when creating new folder and no specific location selected */}
            {!editFolder && !selectedLocationId && locations.length > 0 && (
              <div className="grid gap-2">
                <Label htmlFor="location">Location <span className="text-red-500">*</span></Label>
                <Select
                  value={locationId || ''}
                  onValueChange={(value) => setLocationId(value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select location" />
                  </SelectTrigger>
                  <SelectContent>
                    {locations.map((location) => (
                      <SelectItem key={location.id} value={location.id}>
                        {location.location_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid gap-2">
              <Label htmlFor="parent">Parent Folder (Optional)</Label>
              <Select
                value={parentId || 'none'}
                onValueChange={(value) => setParentId(value === 'none' ? null : value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select parent folder" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No Parent (Root Level)</SelectItem>
                  {availableParents.map((folder) => (
                    <SelectItem key={folder.id} value={folder.id}>
                      {folder.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {editFolder ? 'Save Changes' : 'Create Folder'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
