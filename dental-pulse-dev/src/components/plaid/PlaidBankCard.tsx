import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { FileText, Unlink, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { PlaidService } from '@/services/plaidService';
import type { PlaidConnection } from '@/hooks/usePlaidConnections';

interface Props {
  conn: PlaidConnection;
  cardIndex: number;
  onDisconnected: (connId: string) => void;
}

export function PlaidBankCard({ conn, cardIndex, onDisconnected }: Props) {
  const navigate      = useNavigate();
  const [busy, setBusy] = useState(false);

  const handleDisconnect = async () => {
    if (!window.confirm(`Disconnect ${conn.institution_name || 'this bank'}? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await PlaidService.disconnectBank(conn.id);
      toast.success('Bank disconnected');
      onDisconnected(conn.id);
    } catch (e: any) {
      toast.error('Failed to disconnect', { description: e.message });
    } finally {
      setBusy(false);
    }
  };

  const isActive  = conn.status === 'active';
  const initials  = (conn.institution_name || 'BK').slice(0, 2).toUpperCase();
  const bgStyle   = conn.institution_color
    ? { background: conn.institution_color }
    : { background: 'linear-gradient(135deg, #1e40af, #3b82f6)' };

  return (
    <div
      className={cn('dp-platform-card', isActive && 'dp-platform-card--connected')}
      style={{ '--card-i': cardIndex } as React.CSSProperties}
    >
      {/* Header */}
      <div className="dp-card-header">
        <div className="dp-logo-ring" style={bgStyle}>
          {conn.institution_logo ? (
            <img
              src={`data:image/png;base64,${conn.institution_logo}`}
              alt={conn.institution_name || 'Bank'}
              className="w-8 h-8 object-contain rounded"
            />
          ) : (
            <span className="text-white font-bold text-sm">{initials}</span>
          )}
        </div>
        <span className="text-base font-bold text-foreground mt-3 text-center leading-tight px-2 truncate w-full">
          {conn.institution_name || 'Bank Account'}
        </span>
        {conn.accounts[0]?.mask && (
          <span className="text-xs text-muted-foreground -mt-0.5">····{conn.accounts[0].mask}</span>
        )}
        <div className="mt-2">
          {isActive ? (
            <span className="dp-status-badge dp-status-badge--connected">
              <span className="dp-pulse-dot" /> Active
            </span>
          ) : (
            <span className="dp-status-badge dp-status-badge--idle">Error</span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="dp-card-actions">
        <Button
          variant="outline"
          size="sm"
          className="dp-btn-action w-full gap-1.5"
          onClick={() => navigate(`/plaid/statements/${conn.id}`)}
        >
          <FileText className="w-3.5 h-3.5" /> Statements
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="w-full gap-1.5 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
          onClick={handleDisconnect}
          disabled={busy}
        >
          {busy
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <Unlink className="w-3.5 h-3.5" />}
          {busy ? 'Disconnecting…' : 'Disconnect'}
        </Button>
      </div>

      {/* Footer — accounts list */}
      {conn.accounts.length > 0 && (
        <div className="dp-card-footer">
          <p className="dp-footer-label">Accounts</p>
          <div className="space-y-1">
            {conn.accounts.slice(0, 3).map(acc => (
              <div key={acc.id} className="flex items-center justify-between gap-2 text-[12px]">
                <span className="text-foreground truncate flex-1 min-w-0">
                  {acc.official_name || acc.name || acc.type || 'Account'}
                </span>
                {acc.current_balance != null && (
                  <span className="text-muted-foreground shrink-0">
                    £{acc.current_balance.toLocaleString('en-GB', { minimumFractionDigits: 2 })}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
