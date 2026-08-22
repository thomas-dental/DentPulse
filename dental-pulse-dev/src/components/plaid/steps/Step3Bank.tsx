import { useState, useEffect } from 'react';
import { usePlaidLink } from 'react-plaid-link';
import { Button } from '@/components/ui/button';
import { Landmark, Loader2, CheckCircle2, AlertTriangle, ShieldCheck, Unlink } from 'lucide-react';
import { toast } from 'sonner';
import { PlaidService } from '@/services/plaidService';
import type { PlaidVerification } from '@/hooks/usePlaidOnboarding';

interface Props {
  orgId: string;
  verification: PlaidVerification;
  onComplete: (v: PlaidVerification) => void;
  onPlaidLinkOpen?: () => void;
  onPlaidLinkClose?: () => void;
}

export function Step3Bank({ orgId, verification, onComplete, onPlaidLinkOpen, onPlaidLinkClose }: Props) {
  const [linkToken,     setLinkToken]     = useState<string | null>(null);
  const [fetching,      setFetching]      = useState(false);
  const [connecting,    setConnecting]    = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [result,       setResult]       = useState<{
    bankStatus: string; matchScore: number; overallStatus: string; institutionName: string | null;
  } | null>(null);
  const [freshVerif,   setFreshVerif]   = useState<PlaidVerification | null>(null);

  const alreadyDone = ['matched', 'mismatch'].includes(verification.bank_status);

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: async (publicToken, metadata) => {
      setLinkToken(null);
      onPlaidLinkClose?.();
      setConnecting(true);
      try {
        const res = await PlaidService.connectOnboardingBank({ orgId, publicToken, metadata });
        const stateRes = await PlaidService.getOnboardingState(orgId);
        setFreshVerif(stateRes.verification);
        setResult(res);
        // Auto-close for complete/manual_review; otherwise user clicks Finish Setup
        if (['complete', 'manual_review'].includes(res.overallStatus)) {
          onComplete(stateRes.verification);
        }
      } catch (e: any) {
        toast.error('Bank connection failed', { description: e.message });
      } finally {
        setConnecting(false);
      }
    },
    onExit: (err) => {
      if (err) toast.error('Bank link cancelled', { description: err.display_message || err.error_message });
      setLinkToken(null);
      onPlaidLinkClose?.();
    },
  });

  // Auto-open as soon as token is ready; notify wizard so it drops modal blocking
  useEffect(() => {
    if (linkToken && ready) {
      onPlaidLinkOpen?.();
      open();
    }
  }, [linkToken, ready, open]);

  const handleOpenPlaid = async () => {
    setFetching(true);
    try {
      const res = await PlaidService.getOnboardingBankLinkToken(orgId);
      setLinkToken(res.linkToken);
    } catch (e: any) {
      toast.error('Error', { description: e.message });
      setFetching(false);
    }
  };

  const handleDisconnectOnboarding = async () => {
    setDisconnecting(true);
    try {
      await PlaidService.disconnectOnboardingBank(orgId);
      toast.success('Bank disconnected');
      // Reset verification locally — bank_status back to pending so wizard returns to step 3 connect view
      onComplete({ ...verification, bank_status: 'pending', bank_institution_name: null, bank_account_mask: null, overall_status: 'incomplete' });
    } catch (e: any) {
      toast.error('Failed to disconnect', { description: e.message });
    } finally {
      setDisconnecting(false);
    }
  };

  // Show result
  if (result) {
    const matched = result.bankStatus === 'matched';
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${matched ? 'bg-green-600' : 'bg-amber-500'}`}>
            {matched ? <CheckCircle2 className="w-5 h-5 text-white" /> : <AlertTriangle className="w-5 h-5 text-white" />}
          </div>
          <div>
            <h3 className="font-semibold text-base">{matched ? 'Bank Connected' : 'Connected — Low Match'}</h3>
            <p className="text-xs text-muted-foreground">
              {result.institutionName || 'Bank'} · Match score: {result.matchScore}%
            </p>
          </div>
        </div>

        {!matched && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-700">
            <AlertTriangle className="w-4 h-4 inline mr-1" />
            Low match score · {result.matchScore}% — manual review may be required.
          </div>
        )}

        <Button className="w-full" onClick={() => onComplete(freshVerif ?? { ...verification, overall_status: result.overallStatus as any })}>
          Finish Setup
        </Button>
      </div>
    );
  }

  // Already connected previously
  if (alreadyDone) {
    const isLowMatch = verification.bank_status === 'mismatch';
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-green-600 flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="font-semibold text-base">Bank Connected</h3>
            <p className="text-xs text-muted-foreground">
              {verification.bank_institution_name}
              {verification.bank_account_mask ? ` ····${verification.bank_account_mask}` : ''}
            </p>
          </div>
        </div>
        {isLowMatch && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <p className="text-xs text-blue-700 leading-relaxed">
              Your bank is linked. Our team will verify the business name match — no action needed from you.
            </p>
          </div>
        )}
        <div className="flex gap-3">
          <Button
            variant="outline"
            className="flex-1 gap-2 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
            disabled={disconnecting}
            onClick={handleDisconnectOnboarding}
          >
            {disconnecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Unlink className="w-4 h-4" />}
            {disconnecting ? 'Removing…' : 'Disconnect'}
          </Button>
          <Button className="flex-1" onClick={() => onComplete(verification)}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center shrink-0">
          <Landmark className="w-5 h-5 text-white" />
        </div>
        <div>
          <h3 className="font-semibold text-base">Connect Business Bank Account</h3>
          <p className="text-xs text-muted-foreground">Securely link your bank via Plaid</p>
        </div>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-700 space-y-1">
        <div className="flex items-center gap-1.5 font-medium">
          <ShieldCheck className="w-3.5 h-3.5" /> Bank-grade security
        </div>
        <p>Your credentials are never stored. Plaid connects directly to your bank using read-only access.</p>
      </div>

      <Button
        className="w-full gap-2"
        onClick={handleOpenPlaid}
        disabled={fetching || connecting}
      >
        {fetching || connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Landmark className="w-4 h-4" />}
        {connecting ? 'Connecting…' : fetching ? 'Loading…' : 'Connect Bank Account'}
      </Button>
    </div>
  );
}
