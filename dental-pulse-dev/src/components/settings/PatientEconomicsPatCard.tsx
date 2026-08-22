import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertCircle, Eye, EyeOff, KeyRound, Loader2 } from 'lucide-react';

/** UI shell states — Day 2 will drive these from Edge Function results. */
export type PatientEconomicsPatViewState = 'empty' | 'loading' | 'error' | 'form';

export function PatientEconomicsPatCard() {
  const [pat, setPat] = useState('');
  const [showPat, setShowPat] = useState(false);
  // Static preview control for Day 1; Day 2 removes this and sets state from invoke.
  const [viewState, setViewState] = useState<PatientEconomicsPatViewState>('form');

  const canConnect = pat.trim().length > 0;

  const handleConnect = () => {
    if (!canConnect) return;
    // Day 2: supabase.functions.invoke(...) — no call yet.
    console.log('[Patient Economics] Connect clicked (UI shell only)', {
      patLength: pat.trim().length,
      // never log the raw PAT
    });
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
          Credentials are stored encrypted via Edge Functions (Day 2).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Temporary state switcher for shell review — remove when wired Day 2 */}
        <div className="flex flex-wrap gap-2">
          {(['form', 'empty', 'loading', 'error'] as const).map((s) => (
            <Button
              key={s}
              type="button"
              size="sm"
              variant={viewState === s ? 'default' : 'outline'}
              onClick={() => setViewState(s)}
            >
              Preview: {s}
            </Button>
          ))}
        </div>

        {viewState === 'loading' && (
          <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin mb-3" />
            <p className="text-sm">Validating Dentally connection…</p>
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
              Placeholder error — Day 2 will show the Edge Function message here.
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
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full px-3"
                  onClick={() => setShowPat((v) => !v)}
                  aria-label={showPat ? 'Hide PAT' : 'Show PAT'}
                >
                  {showPat ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <Button type="button" disabled={!canConnect} onClick={handleConnect}>
              Connect
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
