import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Loader2, FileText, Unlink } from 'lucide-react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { usePlaidConnections } from '@/hooks/usePlaidConnections';
import { PlaidPlatformCard } from './PlaidPlatformCard';

interface Props {
  orgId: string | null | undefined;
}

interface ConfirmState {
  connId: string;
  name: string | null;
}

export function PlaidSection({ orgId }: Props) {
  const navigate = useNavigate();
  const { connections, fetchConnections, disconnect } = usePlaidConnections(orgId ?? undefined);
  const [confirm, setConfirm]   = useState<ConfirmState | null>(null);
  const [busy,    setBusy]      = useState(false);

  useEffect(() => { if (orgId) fetchConnections(); }, [orgId]);

  const handleDisconnect = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      await disconnect(confirm.connId);
      toast.success('Bank disconnected');
      setConfirm(null);
    } catch (e: any) {
      toast.error('Failed to disconnect', { description: e.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {/* 3-col internal grid: config card (col 1) + bank list (col 2-3) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 items-start">

        {/* Config card */}
        <PlaidPlatformCard
          orgId={orgId}
          connectionCount={connections.length}
          onConnectionAdded={fetchConnections}
        />

        {/* Bank list — fills cols 2-3 when banks exist */}
        {connections.length > 0 && (
          <div className="md:col-span-2 rounded-xl border bg-card shadow-sm overflow-hidden">
            {connections.map((conn, i) => {
              const initials = (conn.institution_name || 'BK').slice(0, 2).toUpperCase();
              const bgStyle  = conn.institution_color
                ? { background: conn.institution_color }
                : { background: 'linear-gradient(135deg,#1e40af,#3b82f6)' };
              const isActive   = conn.status === 'active';
              const isRemoving = busy && confirm?.connId === conn.id;

              return (
                <div key={conn.id} className={cn('px-5 py-4', i > 0 && 'border-t')}>

                  {/* Bank header */}
                  <div className="flex items-center gap-3 mb-3">
                    <div
                      className="w-10 h-10 rounded-lg shrink-0 overflow-hidden flex items-center justify-center"
                      style={bgStyle}
                    >
                      {conn.institution_logo ? (
                        <img
                          src={`data:image/png;base64,${conn.institution_logo}`}
                          className="w-7 h-7 object-contain"
                          alt={conn.institution_name || ''}
                        />
                      ) : (
                        <span className="text-white text-xs font-bold">{initials}</span>
                      )}
                    </div>
                    <p className="text-sm font-semibold text-foreground flex-1">
                      {conn.institution_name || 'Bank Account'}
                    </p>
                    <span className={cn(
                      'text-xs font-medium flex items-center gap-1 shrink-0',
                      isActive ? 'text-emerald-600' : 'text-muted-foreground'
                    )}>
                      <span className={cn('w-1.5 h-1.5 rounded-full', isActive ? 'bg-emerald-500' : 'bg-gray-400')} />
                      {isActive ? 'Active' : 'Error'}
                    </span>
                  </div>

                  {/* Account rows */}
                  <div className="space-y-1 mb-3">
                    {conn.accounts.map(acc => (
                      <div key={acc.id} className="flex items-center justify-between gap-4">
                        <span className="text-xs text-foreground">
                          {acc.official_name || acc.name || acc.subtype || acc.type}
                          {acc.mask ? ` -${acc.mask}` : ''}
                        </span>
                        {acc.current_balance != null && (
                          <span className="text-xs font-medium text-muted-foreground shrink-0 tabular-nums">
                            {acc.currency_code}&nbsp;
                            {acc.current_balance.toLocaleString('en-GB', { minimumFractionDigits: 2 })}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Action buttons */}
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 text-xs"
                      onClick={() => navigate(`/plaid/statements/${conn.id}?orgId=${encodeURIComponent(orgId ?? '')}`)}
                    >
                      <FileText className="w-3.5 h-3.5" /> Statements
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 text-xs border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                      onClick={() => setConfirm({ connId: conn.id, name: conn.institution_name })}
                      disabled={isRemoving}
                    >
                      {isRemoving
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <Unlink className="w-3.5 h-3.5" />}
                      {isRemoving ? 'Removing…' : 'Disconnect'}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Custom disconnect confirmation dialog */}
      <AlertDialog open={!!confirm} onOpenChange={open => { if (!open && !busy) setConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Bank</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to disconnect{' '}
              <span className="font-semibold text-foreground">{confirm?.name || 'this bank'}</span>?
              This will remove all linked accounts and cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            {/* Use Button (not AlertDialogAction) so dialog stays open while API call runs */}
            <Button
              variant="destructive"
              className="gap-2"
              onClick={handleDisconnect}
              disabled={busy}
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Unlink className="w-4 h-4" />}
              {busy ? 'Disconnecting…' : 'Disconnect'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
