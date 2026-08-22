import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FileText, RefreshCw, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';
import { PlaidService } from '@/services/plaidService';
import type { PlaidConnection } from '@/hooks/usePlaidConnections';

interface Props {
  connection: PlaidConnection;
  onDisconnected: () => void;
}

export function PlaidConnectionCard({ connection, onDisconnected }: Props) {
  const navigate              = useNavigate();
  const [refreshing, setRefreshing] = useState(false);
  const [removing,   setRemoving]   = useState(false);
  const [expanded,   setExpanded]   = useState(false);

  const primaryAccount = connection.accounts[0];
  const balance        = primaryAccount?.current_balance ?? primaryAccount?.available_balance;
  const mask           = primaryAccount?.mask;

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await PlaidService.refreshBalances(connection.id);
      toast.success('Balances refreshed');
      onDisconnected(); // triggers parent refetch
    } catch (e: any) {
      toast.error('Refresh failed', { description: e.message });
    } finally {
      setRefreshing(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm(`Disconnect ${connection.institution_name || 'this bank'}? This cannot be undone.`)) return;
    setRemoving(true);
    try {
      await PlaidService.disconnectBank(connection.id);
      toast.success('Bank disconnected');
      onDisconnected();
    } catch (e: any) {
      toast.error('Disconnect failed', { description: e.message });
    } finally {
      setRemoving(false);
    }
  };

  const initials = (connection.institution_name || 'BK')
    .split(' ')
    .map(w => w[0])
    .join('')
    .substring(0, 2)
    .toUpperCase();

  return (
    <Card className="border border-border/60 hover:border-border transition-colors">
      <CardContent className="p-4">
        {/* Header row */}
        <div className="flex items-start gap-3">
          {/* Logo / initials */}
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center text-white text-xs font-bold shrink-0"
            style={{ backgroundColor: connection.institution_color || '#1e40af' }}
          >
            {connection.institution_logo ? (
              <img
                src={`data:image/png;base64,${connection.institution_logo}`}
                alt={connection.institution_name || ''}
                className="w-7 h-7 object-contain rounded"
              />
            ) : (
              initials
            )}
          </div>

          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm truncate">
              {connection.institution_name || 'Bank Account'}
            </p>
            {mask && (
              <p className="text-xs text-muted-foreground">••••{mask}</p>
            )}
          </div>

          <Badge variant="outline" className="text-green-600 border-green-200 bg-green-50 shrink-0 text-[10px]">
            Active
          </Badge>
        </div>

        {/* Balance */}
        {balance != null && (
          <div className="mt-3 px-3 py-2 bg-muted/40 rounded-lg">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Balance</p>
            <p className="text-base font-bold">
              {new Intl.NumberFormat('en-GB', { style: 'currency', currency: primaryAccount?.currency_code || 'GBP' }).format(balance)}
            </p>
          </div>
        )}

        {/* Accounts toggle */}
        {connection.accounts.length > 1 && (
          <button
            onClick={() => setExpanded(e => !e)}
            className="mt-2 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
          >
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {connection.accounts.length} accounts
          </button>
        )}

        {expanded && (
          <div className="mt-2 space-y-1">
            {connection.accounts.map(acc => (
              <div key={acc.id} className="flex items-center justify-between text-xs px-2 py-1 rounded bg-muted/30">
                <span className="truncate text-foreground/80">{acc.name}{acc.mask ? ` ••••${acc.mask}` : ''}</span>
                {acc.current_balance != null && (
                  <span className="font-medium shrink-0 ml-2">
                    {new Intl.NumberFormat('en-GB', { style: 'currency', currency: acc.currency_code || 'GBP' }).format(acc.current_balance)}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Action buttons */}
        <div className="mt-3 flex gap-2">
          <Button
            size="sm"
            variant="outline"
            className="flex-1 text-xs gap-1"
            onClick={() => navigate(`/plaid/statements/${connection.id}`)}
          >
            <FileText className="w-3 h-3" />
            Statements
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="px-2"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="px-2 text-destructive hover:text-destructive"
            onClick={handleDisconnect}
            disabled={removing}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
