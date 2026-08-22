import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Building2, Users, Landmark, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePlaidOnboarding, type PlaidVerification } from '@/hooks/usePlaidOnboarding';
import { Step1Business } from './steps/Step1Business';
import { Step2Identity } from './steps/Step2Identity';
import { Step3Bank } from './steps/Step3Bank';

interface Props {
  open: boolean;
  orgId: string;
  onClose: () => void;
  onFinished: () => void;
}

const STEPS = [
  { label: 'Business',  icon: Building2 },
  { label: 'Identity',  icon: Users     },
  { label: 'Bank Link', icon: Landmark  },
];

function deriveStep(v: PlaidVerification | null): number {
  if (!v || v.kyb_status === 'pending') return 1;
  const kybDone    = ['verified', 'review'].includes(v.kyb_status);
  const peopleDone = v.people.length > 0 && v.people.every(p => p.status === 'verified');
  if (kybDone && !peopleDone) return 2;
  if (kybDone && peopleDone) return 3;
  return 1;
}

export function PlaidOnboardingWizard({ open, orgId, onClose, onFinished }: Props) {
  const { verification, isLoading, fetchState, setVerification } = usePlaidOnboarding(orgId);
  const [plaidLinkActive, setPlaidLinkActive] = useState(false);
  // viewStep lets the user click a completed step badge to review/edit it
  const [viewStep, setViewStep] = useState<number | null>(null);

  useEffect(() => {
    if (open) { fetchState(); setViewStep(null); }
  }, [open, fetchState]);

  const naturalStep = deriveStep(verification);
  const step        = viewStep ?? naturalStep;

  const handleDone = (v: PlaidVerification) => {
    setVerification(v);
    onFinished();
  };

  const handleStepComplete = (v: PlaidVerification) => {
    setVerification(v);
    setViewStep(null); // return to natural step after saving edits
  };

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()} modal={!plaidLinkActive}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg">Set Up Open Banking</DialogTitle>
        </DialogHeader>

        {/* Step indicator — completed steps are clickable to review */}
        <div className="flex items-center gap-0 mb-2">
          {STEPS.map((s, i) => {
            const n      = i + 1;
            const done   = naturalStep > n;
            const active = step === n;
            const Icon   = s.icon;
            return (
              <div key={n} className="flex items-center flex-1 last:flex-none">
                <button
                  type="button"
                  disabled={!done && !active}
                  onClick={() => done && setViewStep(viewStep === n ? null : n)}
                  className={cn(
                    'flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium transition-colors',
                    done && viewStep !== n  && 'text-green-700 bg-green-100 hover:bg-green-200 cursor-pointer',
                    done && viewStep === n  && 'text-green-800 bg-green-200 ring-1 ring-green-400 cursor-pointer',
                    active && !done         && 'text-blue-700 bg-blue-100',
                    !done && !active        && 'text-muted-foreground cursor-default',
                  )}
                  title={done ? `Review ${s.label} details` : undefined}
                >
                  {done
                    ? <Check className="w-3.5 h-3.5" />
                    : <Icon  className="w-3.5 h-3.5" />
                  }
                  <span className="hidden sm:inline">{s.label}</span>
                </button>
                {i < STEPS.length - 1 && (
                  <div className={cn('flex-1 h-px mx-1', naturalStep > n ? 'bg-green-300' : 'bg-border')} />
                )}
              </div>
            );
          })}
        </div>

        {/* Hint when viewing a completed step */}
        {viewStep !== null && (
          <p className="text-xs text-muted-foreground bg-muted/50 rounded-lg px-3 py-2 -mt-1">
            Reviewing saved details — update and save to apply changes.
          </p>
        )}

        <div className="mt-2">
          {isLoading && (
            <div className="text-center py-8 text-sm text-muted-foreground">Loading…</div>
          )}
          {!isLoading && step === 1 && (
            <Step1Business orgId={orgId} existing={verification} onComplete={handleStepComplete} />
          )}
          {!isLoading && step === 2 && verification && (
            <Step2Identity orgId={orgId} verification={verification} onComplete={handleStepComplete} />
          )}
          {!isLoading && step === 3 && verification && (
            <Step3Bank
              orgId={orgId}
              verification={verification}
              onComplete={handleDone}
              onPlaidLinkOpen={() => setPlaidLinkActive(true)}
              onPlaidLinkClose={() => setPlaidLinkActive(false)}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
