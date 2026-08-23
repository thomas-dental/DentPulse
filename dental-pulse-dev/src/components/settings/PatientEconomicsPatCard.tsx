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
  RefreshCw,
  Settings2,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  DentallyCredential,
  DentallyUnreachableError,
  deleteDentallyCredential,
  getDentallyCredential,
  revalidateDentallyCredential,
  saveDentallyPat,
} from '@/services/integrations/patientEconomicsService';

type PatientEconomicsPatCardProps = {
  organizationId?: string | null;
};

function HeaderStatusPill({
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

  if (credential.validatedAt) {
    return (
      <span className="pe-status-pill pe-status-pill--connected">
        <span className="dp-pulse-dot" />
        Connected
      </span>
    );
  }

  return <span className="pe-status-pill pe-status-pill--pending">Needs validation</span>;
}

export function PatientEconomicsPatCard({ organizationId }: PatientEconomicsPatCardProps) {
  const [credential, setCredential] = useState<DentallyCredential | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [connectDialogOpen, setConnectDialogOpen] = useState(false);
  const [pat, setPat] = useState('');
  const [showPat, setShowPat] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

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

  const openConnectDialog = () => {
    setPat('');
    setShowPat(false);
    setSettingsDialogOpen(false);
    setConnectDialogOpen(true);
  };

  const openSettingsDialog = () => {
    setSettingsDialogOpen(true);
  };

  const handleSave = async () => {
    if (!organizationId || !pat.trim() || isSaving) return;

    setIsSaving(true);
    try {
      const result = await saveDentallyPat(organizationId, pat.trim());
      setCredential(result.credential ?? null);

      if ('validationError' in result) {
        toast.error('Token saved but Dentally rejected it', {
          description: result.validationError,
        });
      } else {
        toast.success(credential ? 'PAT updated and validated' : 'PAT connected');
      }

      setConnectDialogOpen(false);
      setPat('');
    } catch (err) {
      if (err instanceof DentallyUnreachableError) {
        if (err.credential) setCredential(err.credential);
        toast.warning('Token saved — Dentally unreachable', { description: err.message });
        setConnectDialogOpen(false);
      } else {
        toast.error(err instanceof Error ? err.message : 'Could not save PAT');
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleRevalidate = async () => {
    if (!organizationId || isValidating) return;

    setIsValidating(true);
    try {
      const result = await revalidateDentallyCredential(organizationId);
      if (result.credential) setCredential(result.credential);

      if ('validationError' in result) {
        toast.error('Validation failed', { description: result.validationError });
      } else {
        toast.success('PAT validated with Dentally');
      }
    } catch (err) {
      if (err instanceof DentallyUnreachableError) {
        toast.warning('Dentally unreachable', { description: err.message });
      } else {
        toast.error(err instanceof Error ? err.message : 'Validation failed');
      }
    } finally {
      setIsValidating(false);
    }
  };

  const handleDelete = async () => {
    if (!organizationId || isDeleting) return;

    setIsDeleting(true);
    try {
      await deleteDentallyCredential(organizationId);
      setCredential(null);
      setSettingsDialogOpen(false);
      toast.success('PAT disconnected');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not disconnect PAT');
    } finally {
      setIsDeleting(false);
    }
  };

  const accountTitle = credential?.accountLabel || 'Dentally PAT';

  return (
    <>
      <div className="space-y-5">
        {/* Section header */}
        <div className="flex items-center gap-3 px-1">
          <div className="pe-section-icon">
            <Database className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold tracking-tight text-foreground">
                Patient Economics Engine
              </h2>
              <HeaderStatusPill credential={credential} isLoading={isLoading} />
            </div>
            <p className="text-xs text-muted-foreground">
              Store a Dentally personal access token for Patient Economics Engine sync.
            </p>
          </div>
        </div>

        {/* Action card */}
        <div
          className={cn(
            'pe-action-card',
            credential?.validatedAt && 'pe-action-card--connected',
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
                <RefreshCw className="mr-2 h-4 w-4" />
                Retry
              </Button>
            </div>
          )}

          {!isLoading && !loadError && !credential && (
            <div className="flex w-full flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="font-semibold text-foreground">No PAT configured yet</p>
                <p className="mt-0.5 text-sm text-primary/80">
                  Enter a Dentally personal access token to connect Patient Economics Engine.
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                className="dp-btn-primary shrink-0"
                onClick={openConnectDialog}
                disabled={!organizationId}
              >
                <Link2 className="h-3.5 w-3.5" />
                Connect
              </Button>
            </div>
          )}

          {!isLoading && !loadError && credential && (
            <div className="flex w-full flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-1">
                <p className="font-semibold text-foreground truncate">{accountTitle}</p>
                <p className="font-mono text-sm tracking-wide text-muted-foreground">
                  {credential.patHint || '••••••••••••••••'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {credential.validatedAt
                    ? `Validated ${formatDistanceToNow(new Date(credential.validatedAt), { addSuffix: true })}`
                    : 'Saved — validation pending or failed'}
                </p>
              </div>

              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={openSettingsDialog}
                className="dp-btn-action shrink-0"
              >
                <Settings2 className="h-3 w-3" />
                Settings
              </Button>
            </div>
          )}
        </div>
      </div>

      <Dialog open={settingsDialogOpen} onOpenChange={setSettingsDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>PAT settings</DialogTitle>
            <DialogDescription>
              Manage the Dentally personal access token for Patient Economics Engine.
            </DialogDescription>
          </DialogHeader>

          {credential && (
            <div className="rounded-lg border bg-muted/30 px-4 py-3 space-y-1">
              <p className="text-sm font-medium truncate">{accountTitle}</p>
              <p className="font-mono text-xs text-muted-foreground">
                {credential.patHint || '••••••••••••••••'}
              </p>
              <p className="text-xs text-muted-foreground">
                {credential.validatedAt
                  ? `Validated ${formatDistanceToNow(new Date(credential.validatedAt), { addSuffix: true })}`
                  : 'Validation pending or failed'}
              </p>
            </div>
          )}

          <div className="flex flex-col gap-2 py-1">
            {!credential?.validatedAt && (
              <Button
                type="button"
                variant="outline"
                className="dp-btn-action w-full justify-start"
                disabled={isValidating}
                onClick={async () => {
                  await handleRevalidate();
                }}
              >
                {isValidating ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="h-3 w-3" />
                )}
                Validate with Dentally
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              className="dp-btn-action w-full justify-start"
              onClick={openConnectDialog}
            >
              <Pencil className="h-3 w-3" />
              Update PAT
            </Button>
            <Button
              type="button"
              variant="outline"
              className="dp-btn-action w-full justify-start text-destructive hover:text-destructive hover:bg-destructive/5 border-destructive/30"
              disabled={isDeleting}
              onClick={handleDelete}
            >
              {isDeleting ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Trash2 className="h-3 w-3" />
              )}
              Remove PAT
            </Button>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSettingsDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={connectDialogOpen} onOpenChange={setConnectDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{credential ? 'Update Dentally PAT' : 'Connect Dentally PAT'}</DialogTitle>
            <DialogDescription>
              {credential
                ? 'Enter a new token to replace the current one. Only one PAT is stored per practice.'
                : 'Paste a personal access token from Dentally. Only one PAT can be connected per practice.'}
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

            {!organizationId && (
              <p className="flex items-start gap-2 text-sm text-muted-foreground">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                Select an organization before connecting a PAT.
              </p>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setConnectDialogOpen(false)} disabled={isSaving}>
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
              ) : credential ? (
                'Save & validate'
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
        .dp-conn-actions {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 4px;
          flex-wrap: wrap;
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
        .dp-icon-btn {
          height: 28px;
          width: 28px;
          border-radius: 8px;
          color: hsl(var(--muted-foreground));
          transition: all 0.15s ease;
        }
        .dp-icon-btn:hover {
          background: hsl(var(--muted));
          color: hsl(var(--foreground));
        }
        .dp-icon-btn--danger {
          color: #ef4444;
        }
        .dp-icon-btn--danger:hover {
          background: #fef2f2;
          color: #dc2626;
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
