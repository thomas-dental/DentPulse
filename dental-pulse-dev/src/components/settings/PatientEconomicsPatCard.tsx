import { useCallback, useEffect, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertCircle,
  Database,
  Eye,
  EyeOff,
  Link2,
  Loader2,
  Pencil,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  DentallyCredential,
  DentallyUnreachableError,
  deleteDentallyCredential,
  getDentallyCredential,
  saveDentallyPat,
} from '@/services/integrations/patientEconomicsService';

type PatientEconomicsPatCardProps = {
  organizationId?: string | null;
};

type ConnectionStatus = 'connected' | 'invalid' | 'not_validated';

function resolveStatus(credential: DentallyCredential): ConnectionStatus {
  if (credential.needsReconnection) return 'invalid';
  if (credential.validatedAt) return 'connected';
  return 'not_validated';
}

function StatusPill({
  credential,
  isLoading,
}: {
  credential: DentallyCredential | null;
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <span className="pe-status-pill pe-status-pill--idle">
        <Loader2 className="h-3 w-3 animate-spin" />
        Loading
      </span>
    );
  }

  if (!credential) {
    return <span className="pe-status-pill pe-status-pill--idle">Not connected</span>;
  }

  const status = resolveStatus(credential);
  if (status === 'connected') {
    return (
      <span className="pe-status-pill pe-status-pill--connected">
        <span className="dp-pulse-dot" />
        Connected
      </span>
    );
  }
  if (status === 'invalid') {
    return <span className="pe-status-pill pe-status-pill--invalid">Token invalid</span>;
  }
  return <span className="pe-status-pill pe-status-pill--pending">Not yet validated</span>;
}

function maskedDisplay(credential: DentallyCredential): string {
  if (credential.patHint) return credential.patHint;
  return '•••••••• Connected';
}

export function PatientEconomicsPatCard({ organizationId }: PatientEconomicsPatCardProps) {
  const [credential, setCredential] = useState<DentallyCredential | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [tokenDialogOpen, setTokenDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [pat, setPat] = useState('');
  const [showPat, setShowPat] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [savePhase, setSavePhase] = useState<'idle' | 'saving'>('idle');

  const hasCredential = Boolean(credential);
  const isUpdateMode = hasCredential;

  const loadCredential = useCallback(async () => {
    if (!organizationId) {
      setCredential(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setLoadError(null);
    try {
      const row = await getDentallyCredential(organizationId);
      setCredential(row);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load credential');
      setCredential(null);
    } finally {
      setIsLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    loadCredential();
  }, [loadCredential]);

  const openTokenDialog = () => {
    setPat('');
    setShowPat(false);
    setSavePhase('idle');
    setTokenDialogOpen(true);
  };

  const handleSave = async () => {
    if (!organizationId || !pat.trim() || isSaving) return;

    setIsSaving(true);
    setSavePhase('saving');
    try {
      const result = await saveDentallyPat(organizationId, pat.trim());
      setCredential(result.credential ?? null);

      if ('validationError' in result) {
        toast.error('Token saved but Dentally rejected it', {
          description: result.validationError,
        });
      } else {
        toast.success(isUpdateMode ? 'PAT updated and validated' : 'PAT connected and validated');
      }

      setTokenDialogOpen(false);
      setPat('');
    } catch (err) {
      if (err instanceof DentallyUnreachableError) {
        if (err.credential) setCredential(err.credential);
        toast.warning('Token saved — Dentally unreachable', { description: err.message });
        setTokenDialogOpen(false);
        setPat('');
      } else {
        toast.error(err instanceof Error ? err.message : 'Could not save PAT');
      }
    } finally {
      setIsSaving(false);
      setSavePhase('idle');
    }
  };

  const handleDelete = async () => {
    if (!organizationId || isDeleting) return;

    setIsDeleting(true);
    try {
      await deleteDentallyCredential(organizationId);
      setCredential(null);
      setDeleteDialogOpen(false);
      toast.success('PAT disconnected from DentPulse');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not disconnect PAT');
    } finally {
      setIsDeleting(false);
    }
  };

  const accountTitle = credential?.accountLabel || 'Dentally';
  const status = credential ? resolveStatus(credential) : null;

  return (
    <>
      <div className="space-y-5">
        <div className="flex items-center gap-3 px-1">
          <div className="pe-section-icon">
            <Database className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold tracking-tight text-foreground">
                Patient Economics Engine
              </h2>
              <StatusPill credential={credential} isLoading={isLoading} />
            </div>
            <p className="text-xs text-muted-foreground">
              Dentally personal access token for Patient Economics sync. Managed only here in Settings → Integrations.
            </p>
          </div>
        </div>

        <div
          className={cn(
            'pe-action-card',
            status === 'connected' && 'pe-action-card--connected',
            status === 'invalid' && 'pe-action-card--invalid',
          )}
        >
          {isLoading && (
            <div className="flex w-full items-center justify-center gap-2 py-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Loading credential…</span>
            </div>
          )}

          {!isLoading && loadError && (
            <div className="flex w-full flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="font-semibold text-destructive">Could not load credential</p>
                <p className="mt-0.5 text-sm text-muted-foreground">{loadError}</p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={loadCredential} className="shrink-0">
                Retry
              </Button>
            </div>
          )}

          {/* State: no credential — Connect */}
          {!isLoading && !loadError && !credential && (
            <div className="flex w-full flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="font-semibold text-foreground">No PAT connected</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Paste a Dentally personal access token to connect Patient Economics Engine.
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                className="dp-btn-primary shrink-0"
                onClick={openTokenDialog}
                disabled={!organizationId}
              >
                <Link2 className="h-3.5 w-3.5" />
                Connect
              </Button>
            </div>
          )}

          {/* State: credential exists — Display + Update + Delete */}
          {!isLoading && !loadError && credential && (
            <div className="flex w-full flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-1">
                <p className="font-semibold text-foreground truncate">{accountTitle}</p>
                <p className="font-mono text-sm tracking-wide text-muted-foreground">
                  {maskedDisplay(credential)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {status === 'connected' && credential.validatedAt
                    ? `Validated ${formatDistanceToNow(new Date(credential.validatedAt), { addSuffix: true })}`
                    : status === 'invalid'
                      ? credential.authErrorMessage || 'Dentally rejected this token — update it to reconnect.'
                      : 'Stored — validation has not succeeded yet.'}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="dp-btn-action"
                  onClick={openTokenDialog}
                  disabled
                >
                  <Pencil className="h-3 w-3" />
                  Update
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="dp-btn-action text-destructive hover:text-destructive hover:bg-destructive/5 border-destructive/30"
                  onClick={() => setDeleteDialogOpen(true)}
                  disabled
                >
                  <Trash2 className="h-3 w-3" />
                  Delete
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Connect / Update — same upsert endpoint */}
      <Dialog open={tokenDialogOpen} onOpenChange={setTokenDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{isUpdateMode ? 'Update Dentally PAT' : 'Connect Dentally PAT'}</DialogTitle>
            <DialogDescription>
              {isUpdateMode
                ? 'Enter a new token to replace the stored one. The previous DentPulse copy is overwritten; this does not revoke the old token on Dentally.'
                : 'Paste a personal access token from Dentally. Only one encrypted token is stored per practice.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="pe-pat-value">Personal access token</Label>
              <div className="relative">
                <Input
                  id="pe-pat-value"
                  type={showPat ? 'text' : 'password'}
                  autoComplete="off"
                  placeholder="Paste Dentally PAT"
                  value={pat}
                  onChange={(e) => setPat(e.target.value)}
                  className="pr-10 font-mono text-sm"
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

            {savePhase === 'saving' && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving and validating with Dentally…
              </p>
            )}

            {!organizationId && (
              <p className="flex items-start gap-2 text-sm text-muted-foreground">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                Select an organization before connecting a PAT.
              </p>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setTokenDialogOpen(false)} disabled={isSaving}>
              Cancel
            </Button>
            <Button
              type="button"
              className="dp-btn-primary"
              onClick={handleSave}
              disabled={!organizationId || !pat.trim() || isSaving}
            >
              {isSaving ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Saving…
                </>
              ) : isUpdateMode ? (
                'Update'
              ) : (
                <>
                  <Link2 className="h-3 w-3" />
                  Connect
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete stored PAT?</DialogTitle>
            <DialogDescription className="space-y-2">
              <span className="block">
                This removes DentPulse&apos;s encrypted copy of the token and stops future Patient Economics syncs for this practice until you connect again.
              </span>
              <span className="block font-medium text-foreground">
                It does not revoke the token on Dentally&apos;s side — only DentPulse&apos;s stored copy is cleared.
              </span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setDeleteDialogOpen(false)} disabled={isDeleting}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Deleting…
                </>
              ) : (
                'Delete'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <style>{`
        .pe-section-icon {
          width: 40px;
          height: 40px;
          border-radius: 12px;
          background: linear-gradient(135deg, #6366f1, #8b5cf6);
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 4px 12px rgba(99, 102, 241, 0.28);
          flex-shrink: 0;
        }
        .pe-status-pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 12px;
          border-radius: 9999px;
          font-size: 12px;
          font-weight: 600;
          line-height: 1;
        }
        .pe-status-pill--idle {
          background: hsl(var(--primary) / 0.1);
          color: hsl(var(--primary));
          border: 1px solid hsl(var(--primary) / 0.2);
        }
        .pe-status-pill--connected {
          background: #ecfdf5;
          color: #059669;
          border: 1px solid #a7f3d0;
        }
        .pe-status-pill--pending {
          background: #fffbeb;
          color: #d97706;
          border: 1px solid #fde68a;
        }
        .pe-status-pill--invalid {
          background: #fef2f2;
          color: #dc2626;
          border: 1px solid #fecaca;
        }
        .pe-action-card {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          padding: 18px 20px;
          border-radius: 12px;
          border: 1px solid hsl(var(--border));
          background: hsl(var(--card));
        }
        .pe-action-card--connected {
          border-color: #a7f3d0;
          background: linear-gradient(90deg, hsl(var(--card)) 0%, rgba(236, 253, 245, 0.35) 100%);
        }
        .pe-action-card--invalid {
          border-color: #fecaca;
          background: linear-gradient(90deg, hsl(var(--card)) 0%, rgba(254, 242, 242, 0.4) 100%);
        }
        .dp-btn-primary {
          background: linear-gradient(135deg, #0d9488, #0f766e) !important;
          color: white !important;
          border: none !important;
          font-weight: 600;
          gap: 6px;
          border-radius: 10px;
          box-shadow: 0 2px 8px rgba(13, 148, 136, 0.25);
          transition: all 0.2s ease;
        }
        .dp-btn-primary:hover:not(:disabled) {
          box-shadow: 0 4px 14px rgba(13, 148, 136, 0.35);
          transform: translateY(-1px);
        }
        .dp-btn-action {
          gap: 6px;
          border-radius: 10px;
          font-weight: 500;
        }
        .dp-pulse-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #10b981;
          box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.5);
          animation: pePulse 2s ease-in-out infinite;
        }
        @keyframes pePulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.5); }
          50% { box-shadow: 0 0 0 5px rgba(16, 185, 129, 0); }
        }
      `}</style>
    </>
  );
}
