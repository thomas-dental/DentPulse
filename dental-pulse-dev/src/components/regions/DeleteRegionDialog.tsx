import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Region } from '@/types/location';
import { AlertTriangle } from 'lucide-react';

interface DeleteRegionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  region: Region | null;
  onConfirm: () => void;
  isLoading?: boolean;
}

export function DeleteRegionDialog({
  open,
  onOpenChange,
  region,
  onConfirm,
  isLoading,
}: DeleteRegionDialogProps) {
  if (!region) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            Delete Region
          </DialogTitle>
          <DialogDescription>
            Are you sure you want to delete this region? This action cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <div className="p-4 bg-muted rounded-lg">
            <p className="font-medium">{region.name}</p>
            {region.code && (
              <p className="text-sm text-muted-foreground">Code: {region.code}</p>
            )}
            {region.description && (
              <p className="text-sm text-muted-foreground mt-2">{region.description}</p>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-4">
            Note: This will soft delete the region. Locations associated with this region will not be affected, but you may want to update them.
          </p>
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
          <Button
            type="button"
            variant="destructive"
            onClick={onConfirm}
            disabled={isLoading}
          >
            {isLoading ? 'Deleting...' : 'Delete Region'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
