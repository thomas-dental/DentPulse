import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';

type PePeriodSyncModalProps = {
  open: boolean;
  periodLabel: string;
  syncInProgress?: boolean;
  isSyncing: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function PePeriodSyncModal({
  open,
  periodLabel,
  syncInProgress,
  isSyncing,
  onConfirm,
  onCancel,
}: PePeriodSyncModalProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !isSyncing) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Sync data for {periodLabel}?</DialogTitle>
          <DialogDescription>
            Patient Economics does not have synced data for this period yet.
            {syncInProgress
              ? ' A sync is already running — you can wait for it to finish or try again later.'
              : ' Sync will pull invoices, appointments, and ledger events for the selected dates from Dentally.'}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={onCancel} disabled={isSyncing}>
            Cancel
          </Button>
          <Button type="button" onClick={onConfirm} disabled={isSyncing}>
            {isSyncing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Starting sync…
              </>
            ) : (
              'Sync period'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
