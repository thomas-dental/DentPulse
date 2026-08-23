import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  AlertCircle,
  AlertTriangle,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  RefreshCw,
  WifiOff,
} from 'lucide-react';
import { DentallyUnreachableError, saveDentallyPat } from '@/services/integrations/patientEconomicsService';

export type PatientEconomicsPatViewState =
  | 'empty'
  | 'form'
  | 'loading'
  | 'connected'
  | 'invalid_token'
  | 'unreachable'
  | 'error';

type PatientEconomicsPatCardProps = {
  organizationId?: string | null;
};

function maskPat(pat: string): string {
  const trimmed = pat.trim();
  if (trimmed.length <= 8) return '••••••••';
  return `${trimmed.slice(0, 4)}••••••••${trimmed.slice(-4)}`;
}

function ConnectedBadge() {
  return (
    <span className="dp-status-badge dp-status-badge--connected inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium bg-emerald-50 text-emerald-600 border border-emerald-200">
      <span className="dp-pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
      Connected
    </span>
  );
}

export function PatientEconomicsPatCard({ organizationId }: PatientEconomicsPatCardProps) {
  const [pat, setPat] = useState('');
  const [showPat, setShowPat] = useState(false);
  const [viewState, setViewState] = useState<PatientEconomicsPatViewState>('empty');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [maskedPat, setMaskedPat] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const canConnect = pat.trim().length > 0 && !!organizationId && !isSaving;

  const handleConnect = async () => {
    if (!organizationId || !pat.trim() || isSaving) return;
    const patValue = pat.trim();
    setIsSaving(true);
    setStatusMessage(null);
    setViewState('loading');
    try {
      const result = await saveDentallyPat(organizationId, patValue);
      if ('validationError' in result) {
        setStatusMessage(result.validationError);
        setPat('');
        setViewState('invalid_token');
        return;
      }
      setMaskedPat(maskPat(patValue));
      setPat('');
      setViewState('connected');
    } catch (err) {
      if (err instanceof DentallyUnreachableError) {
        setStatusMessage(err.message);
        setViewState('unreachable');
      } else {
        setStatusMessage(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
        setViewState('error');
      }
    } finally {
      setIsSaving(false);
    }
  };

  const openForm = () => {
    setStatusMessage(null);
    setViewState('form');
  };

  const previewState = (state: PatientEconomicsPatViewState) => {
    setStatusMessage(null);
    setMaskedPat('abcd••••••••wxyz');
    switch (state) {
      case 'empty':
        setMaskedPat(null);
        setPat('');
        break;
      case 'form':
        setMaskedPat(null);
        setPat('');
        break;
      case 'invalid_token':
        setStatusMessage('Token saved, but Dentally rejected it. Check the PAT and try again.');
        setPat('');
        break;
      case 'unreachable':
        setStatusMessage('Token saved, but Dentally timed out. Try connecting again in a moment.');
        setPat('preview-token-value');
        break;
      case 'error':
        setStatusMessage('Failed to save credentials. Please try again.');
        setPat('');
        break;
      default:
        break;
    }
    setViewState(state);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="h-4 w-4" />
          Patient Economics — Dentally PAT
        </CardTitle>
        <CardDescription>
          Connect a Dentally personal access token for the Patient Economics Engine.
          Credentials are stored encrypted and validated against Dentally.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {viewState === 'loading' && (
          <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin mb-3" />
            <p className="text-sm font-medium">Saving and validating…</p>
            <p className="text-xs mt-1 max-w-xs text-center">
              Encrypting your token, storing it securely, then confirming with the Dentally API.
              This may take a few seconds.
            </p>
          </div>
        )}

        {viewState === 'empty' && (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <KeyRound className="h-10 w-10 text-muted-foreground mb-3" />
            <p className="font-medium">No PAT connected</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm">
              Add a Dentally personal access token to enable Patient Economics sync.
            </p>
            <Button type="button" className="mt-4" onClick={openForm}>
              Add PAT
            </Button>
          </div>
        )}

        {viewState === 'connected' && (
          <div className="space-y-4 max-w-md">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-foreground">Dentally PAT</p>
                <ConnectedBadge />
              </div>
              <p className="font-mono text-sm text-muted-foreground">{maskedPat || '••••••••'}</p>
              <p className="text-xs text-muted-foreground">
                Your token was saved and confirmed with the Dentally API.
              </p>
            </div>
            <Button type="button" variant="outline" onClick={openForm}>
              Update PAT
            </Button>
          </div>
        )}

        {viewState === 'invalid_token' && (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <AlertCircle className="h-10 w-10 text-destructive mb-3" />
            <p className="font-medium text-destructive">Invalid Dentally token</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm">
              {statusMessage ||
                'Your token was saved, but Dentally rejected it. Generate a new PAT in Dentally and try again.'}
            </p>
            <p className="text-xs text-muted-foreground mt-2 max-w-sm">
              This is a token authentication problem — not a network or server error.
            </p>
            <Button type="button" className="mt-4" onClick={openForm}>
              Enter a new PAT
            </Button>
          </div>
        )}

        {viewState === 'unreachable' && (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <WifiOff className="h-10 w-10 text-amber-600 mb-3" />
            <p className="font-medium">Dentally API unavailable</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm">
              {statusMessage ||
                'Your token was saved, but Dentally could not be reached. Wait a moment and try again — you do not need a new token.'}
            </p>
            <p className="text-xs text-muted-foreground mt-2 max-w-sm">
              This is usually temporary. Retry shortly before replacing your PAT.
            </p>
            <Button
              type="button"
              className="mt-4"
              onClick={handleConnect}
              disabled={!organizationId || !pat.trim() || isSaving}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Retry validation
            </Button>
            {!pat.trim() && (
              <Button type="button" variant="link" className="mt-2 text-xs" onClick={openForm}>
                Re-enter PAT to retry
              </Button>
            )}
          </div>
        )}

        {viewState === 'error' && (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <AlertTriangle className="h-10 w-10 text-destructive mb-3" />
            <p className="font-medium text-destructive">Could not save credentials</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm">
              {statusMessage || 'An unexpected error occurred while contacting DentPulse. Please try again.'}
            </p>
            <Button type="button" variant="outline" className="mt-4" onClick={openForm}>
              Try again
            </Button>
          </div>
        )}

        {viewState === 'form' && (
          <div className="space-y-4 max-w-md">
            <div className="space-y-2">
              <Label htmlFor="patient-economics-pat">Dentally PAT</Label>
              <div className="relative">
                <Input
                  id="patient-economics-pat"
                  type={showPat ? 'text' : 'password'}
                  autoComplete="off"
                  placeholder="Enter Dentally personal access token"
                  value={pat}
                  onChange={(e) => setPat(e.target.value)}
                  className="pr-10"
                  disabled={isSaving}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full px-3"
                  onClick={() => setShowPat((v) => !v)}
                  aria-label={showPat ? 'Hide PAT' : 'Show PAT'}
                  disabled={isSaving}
                >
                  {showPat ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <Button type="button" disabled={!canConnect} onClick={handleConnect}>
              Connect
            </Button>
            {!organizationId && (
              <p className="text-sm text-muted-foreground">Select an organization to connect a PAT.</p>
            )}
          </div>
        )}

        {import.meta.env.DEV && (
          <div className="border-t pt-3 space-y-2">
            <p className="text-xs text-muted-foreground">Dev: preview UI states</p>
            <div className="flex flex-wrap gap-1">
              {(
                ['empty', 'form', 'loading', 'connected', 'invalid_token', 'unreachable', 'error'] as const
              ).map((s) => (
                <Button key={s} type="button" size="sm" variant="outline" onClick={() => previewState(s)}>
                  {s}
                </Button>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
