import { useEffect, useState } from 'react';
import { usePlaidLink } from 'react-plaid-link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Landmark, Plus, Settings2, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { PlaidService } from '@/services/plaidService';
import { usePlaidOnboarding } from '@/hooks/usePlaidOnboarding';
import { usePlaidConnections } from '@/hooks/usePlaidConnections';
import { PlaidConnectionCard } from './PlaidConnectionCard';
import { PlaidOnboardingWizard } from './PlaidOnboardingWizard';

interface Props {
  orgId: string | undefined;
}

// Wrapper so usePlaidLink re-mounts when linkToken changes
function AddBankButton({ orgId, onAdded }: { orgId: string; onAdded: () => void }) {
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
        toast.success('Bank connected successfully');
        onAdded();
      } catch (e: any) {
        toast.error('Connection failed', { description: e.message });
      } finally {
        setExchanging(false);
      }
    },
    onExit: (err) => {
      if (err) toast.error('Cancelled', { description: err.display_message || '' });
      setLinkToken(null);
    },
  });

  useEffect(() => {
    if (linkToken && ready) open();
  }, [linkToken, ready, open]);

  const handleClick = async () => {
    setFetching(true);
    try {
      const res = await PlaidService.getLinkToken(orgId);
      setLinkToken(res.linkToken);
    } catch (e: any) {
      toast.error('Error', { description: e.message });
      setFetching(false);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-1.5 text-xs"
      onClick={handleClick}
      disabled={fetching || exchanging}
    >
      {fetching || exchanging
        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
        : <Plus className="w-3.5 h-3.5" />
      }
      Connect Another Bank
    </Button>
  );
}

export function PlaidIntegrationSection({ orgId }: Props) {
  const [wizardOpen, setWizardOpen] = useState(false);
  const { verification, fetchState } = usePlaidOnboarding(orgId);
  const { connections, isLoading: connLoading, fetchConnections } = usePlaidConnections(orgId);

  useEffect(() => {
    if (!orgId) return;
    fetchState();
    fetchConnections();
  }, [orgId, fetchState, fetchConnections]);

  if (!orgId) return null;

  const overallStatus  = verification?.overall_status;
  const isConfigured   = overallStatus === 'complete' || overallStatus === 'manual_review';

  const handleWizardFinished = () => {
    setWizardOpen(false);
    fetchState();
    fetchConnections();
  };

  return (
    <>
      <div className="rounded-2xl border bg-card p-5 space-y-4 mt-2">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-600 flex items-center justify-center shrink-0">
              <Landmark className="w-4.5 h-4.5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-sm">Open Banking (Plaid)</h3>
                {isConfigured && (
                  <Badge
                    variant="outline"
                    className={
                      overallStatus === 'complete'
                        ? 'text-green-600 border-green-200 bg-green-50 text-[10px]'
                        : 'text-amber-600 border-amber-200 bg-amber-50 text-[10px]'
                    }
                  >
                    {overallStatus === 'complete'
                      ? <><CheckCircle2 className="w-2.5 h-2.5 mr-1 inline" />Active</>
                      : <><AlertTriangle className="w-2.5 h-2.5 mr-1 inline" />Manual Review</>
                    }
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {isConfigured
                  ? `${connections.length} bank${connections.length !== 1 ? 's' : ''} connected`
                  : 'Connect your business bank for payments & statements'}
              </p>
            </div>
          </div>

          {isConfigured && orgId && (
            <div className="flex items-center gap-2">
              <AddBankButton orgId={orgId} onAdded={fetchConnections} />
              <Button
                size="sm"
                variant="ghost"
                className="px-2"
                onClick={() => setWizardOpen(true)}
              >
                <Settings2 className="w-4 h-4" />
              </Button>
            </div>
          )}
        </div>

        {/* Configure CTA (not yet set up) */}
        {!isConfigured && (
          <Button
            onClick={() => setWizardOpen(true)}
            className="w-full gap-2"
          >
            <Settings2 className="w-4 h-4" />
            Configure Open Banking →
          </Button>
        )}

        {/* Manual review warning */}
        {overallStatus === 'manual_review' && (
          <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-50 rounded-lg p-3">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            Name match score was below threshold. Your account is under manual review.
          </div>
        )}

        {/* Connected bank cards */}
        {isConfigured && (
          <div>
            {connLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading banks…
              </div>
            ) : connections.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">No active bank connections. Connect one above.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {connections.map(conn => (
                  <PlaidConnectionCard
                    key={conn.id}
                    connection={conn}
                    onDisconnected={fetchConnections}
                  />
                ))}
              </div>
            )}
          </div>
        )}
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
