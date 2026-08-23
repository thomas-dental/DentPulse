import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertCircle, Eye, EyeOff, KeyRound, Loader2 } from 'lucide-react';
import { saveDentallyPat } from '@/services/integrations/patientEconomicsService';

export type PatientEconomicsPatViewState = 'empty' | 'loading' | 'error' | 'form';

type PatientEconomicsPatCardProps = {
  organizationId?: string | null;
};

export function PatientEconomicsPatCard({ organizationId }: PatientEconomicsPatCardProps) {
  const [pat, setPat] = useState('');
  const [showPat, setShowPat] = useState(false);
  const [viewState, setViewState] = useState<PatientEconomicsPatViewState>('form');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const canConnect = pat.trim().length > 0 && !!organizationId && !isSaving;

  const handleConnect = async () => {
    if (!organizationId || !pat.trim() || isSaving) return;
    setIsSaving(true);
    setErrorMessage(null);
    setViewState('loading');
    try {
      await saveDentallyPat(organizationId, pat.trim());
      setPat('');
      setViewState('form');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Connection failed');
      setViewState('error');
    } finally {
      setIsSaving(false);
    }
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
          Credentials are stored encrypted via the API. Dentally validation comes in a later step.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {viewState === 'loading' && (
          <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin mb-3" />
            <p className="text-sm">Saving Dentally credentials…</p>
          </div>
        )}

        {viewState === 'empty' && (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <KeyRound className="h-10 w-10 text-muted-foreground mb-3" />
            <p className="font-medium">No PAT connected</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm">
              Add a Dentally personal access token to enable Patient Economics sync.
            </p>
            <Button type="button" className="mt-4" onClick={() => setViewState('form')}>
              Add PAT
            </Button>
          </div>
        )}

        {viewState === 'error' && (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <AlertCircle className="h-10 w-10 text-destructive mb-3" />
            <p className="font-medium text-destructive">Connection failed</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm">
              {errorMessage || 'Could not save credentials. Please try again.'}
            </p>
            <Button type="button" variant="outline" className="mt-4" onClick={() => setViewState('form')}>
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
              {isSaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : (
                'Connect'
              )}
            </Button>
            {!organizationId && (
              <p className="text-sm text-muted-foreground">Select an organization to connect a PAT.</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
