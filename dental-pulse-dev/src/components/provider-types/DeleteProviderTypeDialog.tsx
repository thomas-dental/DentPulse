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
import { ProviderTypeEntity } from '@/types/provider';

interface DeleteProviderTypeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providerType: ProviderTypeEntity | null;
  onConfirm: () => void;
  isLoading?: boolean;
}

export function DeleteProviderTypeDialog({
  open,
  onOpenChange,
  providerType,
  onConfirm,
  isLoading,
}: DeleteProviderTypeDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Provider Type</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete provider type <strong>{providerType?.name}</strong>? This action will
            soft-delete the provider type, and it will no longer appear in active lists.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isLoading}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={isLoading}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isLoading ? 'Deleting...' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
