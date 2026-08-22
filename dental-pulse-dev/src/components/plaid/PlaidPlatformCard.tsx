import { useEffect, useState } from 'react';
import { usePlaidLink } from 'react-plaid-link';
import { Button } from '@/components/ui/button';
import { Landmark, Settings2, Plus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { PlaidService } from '@/services/plaidService';
import { usePlaidOnboarding } from '@/hooks/usePlaidOnboarding';
import { PlaidOnboardingWizard } from './PlaidOnboardingWizard';

interface Props {
  orgId: string | null | undefined;
  connectionCount: number;
  onConnectionAdded: () => void;
}

function AddBankInline({ orgId, onAdded }: { orgId: string; onAdded: () => void }) {
  const [linkToken,  setLinkToken]  = useState<string | null>(null);
  const [fetching,   setFetching]   = useState(false);
  const [exchanging, setExchanging] = useState(false);

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: async (publicToken, metadata) => {
      setLinkToken(null);
      setExchanging(true);
      try {
        await PlaidService.exchangeToken({ orgId, publicToken, metadata });
        toast.success('Bank connected');
        onAdded();
      } catch (e: any) {
        toast.error('Connection failed', { description: e.message });
      } finally {
        setExchanging(false);
      }
    },
    onExit: () => setLinkToken(null),
  });

  useEffect(() => { if (linkToken && ready) open(); }, [linkToken, ready, open]);

  const handleClick = async () => {
    setFetching(true);
    try {
      const res = await PlaidService.getLinkToken(orgId);
      setLinkToken(res.linkToken);
    } catch (e: any) {
      toast.error('Error', { description: e.message });
    } finally {
      // Always stop spinner — Plaid Link opening doesn't need a loading state
      setFetching(false);
    }
  };

  return (
    <Button size="sm" variant="outline" className="w-full gap-1.5" onClick={handleClick} disabled={fetching || exchanging}>
      {fetching || exchanging ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
      {exchanging ? 'Connecting…' : 'Add Bank Account'}
    </Button>
  );
}

export function PlaidPlatformCard({ orgId, connectionCount, onConnectionAdded }: Props) {
  const [wizardOpen, setWizardOpen] = useState(false);
  const { verification, fetchState } = usePlaidOnboarding(orgId ?? undefined);

  useEffect(() => { if (orgId) fetchState(); }, [orgId]);

  if (!orgId) return null;

  const overallStatus = verification?.overall_status;
  const isConfigured  = overallStatus === 'complete' || overallStatus === 'manual_review';

  const handleWizardFinished = () => {
    setWizardOpen(false);
    fetchState();
    onConnectionAdded();
  };

  return (
    <>
      <div className="rounded-xl border bg-card shadow-sm overflow-hidden">

        {/* Card title */}
        <div className="px-5 py-4">
          <h3 className="text-sm font-semibold text-foreground">Open Banking (Plaid)</h3>
        </div>

        {/* Connection status row */}
        <div className="flex items-center gap-3 px-5 py-3 border-t">
          <div className="w-10 h-10 rounded-xl bg-gray-900 flex items-center justify-center shrink-0">
            <Landmark className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold leading-tight">
              {!isConfigured ? 'Not Configured' : connectionCount > 0 ? 'Plaid Connected' : 'Plaid Linked'}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {isConfigured
                ? `${connectionCount} bank${connectionCount !== 1 ? 's' : ''} linked`
                : 'Set up Open Banking to get started'}
            </p>
          </div>
          {isConfigured && connectionCount === 0 && (
            <span className="shrink-0 text-xs font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
              LINKED
            </span>
          )}
          {isConfigured && connectionCount > 0 && (
            <span className="shrink-0 text-xs font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
              CONNECTED
            </span>
          )}
          {!isConfigured && (
            <span className="shrink-0 text-xs font-medium text-muted-foreground bg-muted px-2.5 py-1 rounded-full border">
              NOT SET
            </span>
          )}
        </div>

        {/* Action area */}
        <div className="px-5 py-4 border-t flex flex-col gap-2">
          {isConfigured ? (
            <>
              <AddBankInline orgId={orgId} onAdded={onConnectionAdded} />
              <button
                className="text-xs text-muted-foreground hover:text-foreground flex items-center justify-center gap-1 transition-colors"
                onClick={() => setWizardOpen(true)}
              >
                <Settings2 className="w-3 h-3" /> Manage setup
              </button>
            </>
          ) : (
            <Button className="w-full gap-2" onClick={() => setWizardOpen(true)}>
              <Settings2 className="w-4 h-4" /> Configure Open Banking
            </Button>
          )}
        </div>
      </div>

      <PlaidOnboardingWizard
        open={wizardOpen}
        orgId={orgId}
        onClose={() => setWizardOpen(false)}
        onFinished={handleWizardFinished}
      />
    </>
  );
}
