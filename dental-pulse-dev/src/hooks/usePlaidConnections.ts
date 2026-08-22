import { useState, useCallback } from 'react';
import { PlaidService } from '@/services/plaidService';

export interface PlaidAccount {
  id: string;
  plaid_account_id: string;
  name: string | null;
  official_name: string | null;
  mask: string | null;
  type: string | null;
  subtype: string | null;
  current_balance: number | null;
  available_balance: number | null;
  currency_code: string;
  balances_updated_at: string | null;
}

export interface PlaidConnection {
  id: string;
  organization_id: string;
  item_id: string;
  institution_id: string | null;
  institution_name: string | null;
  institution_logo: string | null;
  institution_color: string | null;
  status: 'active' | 'error' | 'disconnected';
  error_code: string | null;
  created_at: string;
  accounts: PlaidAccount[];
}

export function usePlaidConnections(orgId: string | undefined) {
  const [connections, setConnections] = useState<PlaidConnection[]>([]);
  const [isLoading, setIsLoading]     = useState(false);
  const [error, setError]             = useState<string | null>(null);

  const fetchConnections = useCallback(async () => {
    if (!orgId) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await PlaidService.getConnections(orgId);
      setConnections(res.connections ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsLoading(false);
    }
  }, [orgId]);

  const disconnect = async (connId: string) => {
    await PlaidService.disconnectBank(connId);
    setConnections(prev => prev.filter(c => c.id !== connId));
  };

  return { connections, isLoading, error, fetchConnections, disconnect };
}
