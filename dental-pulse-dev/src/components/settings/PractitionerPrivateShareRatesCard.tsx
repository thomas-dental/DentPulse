import { useCallback, useEffect, useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
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
  ChevronDown,
  History,
  Loader2,
  Percent,
  Plus,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { PractitionerWithRates } from '@/types/patientEconomicsAssumptions';
import {
  createPractitionerPrivateShareRate,
  listPractitionerPrivateShareRates,
} from '@/services/integrations/patientEconomicsService';

type PractitionerPrivateShareRatesCardProps = {
  organizationId?: string | null;
};

function formatDisplayDate(isoDate: string): string {
  try {
    return format(parseISO(isoDate), 'd MMM yyyy');
  } catch {
    return isoDate;
  }
}

function formatRatePct(rate: number): string {
  const rounded = Math.round(rate * 100) / 100;
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(2)}%`;
}

function practitionerSubtitle(p: PractitionerWithRates): string | null {
  if (!p.providerRole) return null;
  return p.providerRole.replace(/_/g, ' ');
}

function NotConfiguredBadge() {
  return (
    <span className="pe-rate-pill pe-rate-pill--pending">
      <span className="pe-rate-pill-dot" />
      Not configured
    </span>
  );
}

function CurrentRateBadge({ rate, effectiveFrom }: { rate: number; effectiveFrom: string }) {
  return (
    <div className="text-right">
      <div className="text-sm font-bold text-foreground">{formatRatePct(rate)}</div>
      <div className="text-[11px] text-muted-foreground">
        from {formatDisplayDate(effectiveFrom)}
      </div>
    </div>
  );
}

function RateHistoryList({ history }: { history: PractitionerWithRates['history'] }) {
  if (history.length === 0) {
    return <p className="py-2 text-xs text-muted-foreground">No rate history yet.</p>;
  }

  return (
    <ul className="space-y-2 py-2">
      {history.map((entry) => (
        <li
          key={entry.id}
          className={cn(
            'flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs',
            entry.isCurrent ? 'border-primary/30 bg-primary/5' : 'border-border bg-muted/30',
          )}
        >
          <div>
            <span className="font-semibold text-foreground">{formatRatePct(entry.rate)}</span>
            {entry.isCurrent && (
              <span className="ml-2 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                Current
              </span>
            )}
          </div>
          <span className="text-muted-foreground">
            {formatDisplayDate(entry.effectiveFrom)}
            {' → '}
            {entry.effectiveTo ? formatDisplayDate(entry.effectiveTo) : 'ongoing'}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function PractitionerPrivateShareRatesCard({
  organizationId,
}: PractitionerPrivateShareRatesCardProps) {
  const [practitioners, setPractitioners] = useState<PractitionerWithRates[]>([]);
  const [summary, setSummary] = useState({
    totalPractitioners: 0,
    configuredCount: 0,
    notConfiguredCount: 0,
    hasMissingRate: false,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [migrationPending, setMigrationPending] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const [rateDialogOpen, setRateDialogOpen] = useState(false);
  const [selectedPractitioner, setSelectedPractitioner] = useState<PractitionerWithRates | null>(
    null,
  );
  const [rateInput, setRateInput] = useState('');
  const [effectiveFromInput, setEffectiveFromInput] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const loadRates = useCallback(async () => {
    if (!organizationId) {
      setPractitioners([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setLoadError(null);
    setMigrationPending(false);
    try {
      const data = await listPractitionerPrivateShareRates(organizationId);
      setPractitioners(data.practitioners);
      setSummary(data.summary);
    } catch (err) {
      const code = (err as Error & { code?: string }).code;
      if (code === 'TABLE_NOT_FOUND') {
        setMigrationPending(true);
        setLoadError(
          'Rate table not deployed yet — apply the practitioner_private_share_rates migration.',
        );
      } else {
        setLoadError(err instanceof Error ? err.message : 'Failed to load practitioner rates');
      }
      setPractitioners([]);
    } finally {
      setIsLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    loadRates();
  }, [loadRates]);

  const configuredLabel = useMemo(() => {
    if (summary.totalPractitioners === 0) return '0 clinicians';
    return `${summary.configuredCount} of ${summary.totalPractitioners} configured`;
  }, [summary]);

  const openRateDialog = (practitioner: PractitionerWithRates) => {
    setSelectedPractitioner(practitioner);
    setRateInput('');
    setEffectiveFromInput(new Date().toISOString().slice(0, 10));
    setRateDialogOpen(true);
  };

  const toggleHistory = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSaveRate = async () => {
    if (!organizationId || !selectedPractitioner || isSaving) return;

    const rate = parseFloat(rateInput);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      toast.error('Enter a rate between 0 and 100');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFromInput)) {
      toast.error('Enter a valid effective date');
      return;
    }

    setIsSaving(true);
    try {
      await createPractitionerPrivateShareRate(
        organizationId,
        selectedPractitioner.id,
        rate,
        effectiveFromInput,
      );
      toast.success(`Rate saved for ${selectedPractitioner.name}`);
      setRateDialogOpen(false);
      setExpandedIds((prev) => new Set(prev).add(selectedPractitioner.id));
      setSelectedPractitioner(null);
      await loadRates();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save rate');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <div
        className="rounded-xl border border-primary/35 bg-card px-5 py-5 shadow-sm"
        data-pe-assumption-panel="practitioner-rates"
      >
        <div className="mb-4">
          <h3 className="text-base font-bold text-primary">Economic Assumptions</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Used to compute contribution where live cost feeds aren&apos;t connected — the
            &ldquo;only a few assumptions&rdquo; layer.
          </p>
        </div>

        <div className="border-t border-border/70 pt-4">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">Clinician remuneration profiles</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Per-clinician private share % — not one group average. Fair clinician-level
                comparison depends on this.
              </p>
            </div>
            {!isLoading && !loadError && practitioners.length > 0 && (
              <span className="text-xs font-medium text-muted-foreground">{configuredLabel}</span>
            )}
          </div>

          {summary.hasMissingRate && !isLoading && !loadError && practitioners.length > 0 && (
            <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-200/80 bg-amber-50/80 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {summary.notConfiguredCount} clinician
                {summary.notConfiguredCount === 1 ? '' : 's'} ha
                {summary.notConfiguredCount === 1 ? 's' : 've'} no private-share rate yet.
                Contribution for those clinicians stays incomplete until configured here.
              </span>
            </div>
          )}

          {isLoading && (
            <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Loading clinicians…</span>
            </div>
          )}

          {!isLoading && loadError && (
            <div className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-destructive">
                  {migrationPending ? 'Database migration required' : 'Could not load rates'}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">{loadError}</p>
              </div>
              {!migrationPending && (
                <Button type="button" variant="outline" size="sm" onClick={loadRates} className="shrink-0">
                  Retry
                </Button>
              )}
            </div>
          )}

          {!isLoading && !loadError && practitioners.length === 0 && (
            <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center">
              <p className="text-sm font-medium text-foreground">No clinicians synced yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Run the Patient Economics practitioners sync after connecting your PAT. Names appear
                here once synced from Dentally.
              </p>
            </div>
          )}

          {!isLoading && !loadError && practitioners.length > 0 && (
            <div className="space-y-0 divide-y divide-border/60 rounded-lg border border-border/70">
              <div className="hidden grid-cols-[1fr_auto_auto] gap-3 px-3 py-2 text-[11px] font-semibold text-muted-foreground sm:grid">
                <span>Clinician</span>
                <span className="text-right">Private share</span>
                <span className="text-right w-[180px]">Actions</span>
              </div>

              {practitioners.map((p) => {
                const expanded = expandedIds.has(p.id);
                const subtitle = practitionerSubtitle(p);
                return (
                  <div key={p.id} className="px-3 py-3">
                    <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-[1fr_auto_auto]">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-foreground">{p.name}</div>
                        {subtitle && (
                          <div className="mt-0.5 text-xs capitalize text-muted-foreground">
                            {subtitle}
                          </div>
                        )}
                        {!p.isActive && (
                          <div className="mt-0.5 text-[10px] text-muted-foreground">Inactive</div>
                        )}
                      </div>

                      <div className="sm:text-right">
                        {p.rateConfigured && p.currentRate != null && p.currentEffectiveFrom ? (
                          <CurrentRateBadge rate={p.currentRate} effectiveFrom={p.currentEffectiveFrom} />
                        ) : (
                          <NotConfiguredBadge />
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 sm:justify-end sm:w-[180px]">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 gap-1 px-2 text-xs"
                          disabled={p.history.length === 0}
                          onClick={() => toggleHistory(p.id)}
                        >
                          <History className="h-3 w-3" />
                          History
                          <ChevronDown
                            className={cn(
                              'h-3 w-3 transition-transform',
                              expanded && 'rotate-180',
                            )}
                          />
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 gap-1 px-2.5 text-xs"
                          onClick={() => openRateDialog(p)}
                        >
                          <Plus className="h-3 w-3" />
                          Set new rate
                        </Button>
                      </div>
                    </div>

                    {expanded && (
                      <div className="mt-3 rounded-lg border border-border/70 bg-muted/20 px-3">
                        <p className="pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Rate history
                        </p>
                        <RateHistoryList history={p.history} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <Dialog open={rateDialogOpen} onOpenChange={setRateDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Set new private-share rate</DialogTitle>
            <DialogDescription>
              {selectedPractitioner
                ? `Adds a new effective-dated rate for ${selectedPractitioner.name}. Past rows are never edited — history is preserved for invoice-based contribution.`
                : 'Append a new rate row.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="pe-private-share-rate">Private share (%)</Label>
              <div className="relative">
                <Input
                  id="pe-private-share-rate"
                  type="number"
                  min={0}
                  max={100}
                  step={0.01}
                  placeholder="e.g. 45"
                  value={rateInput}
                  onChange={(e) => setRateInput(e.target.value)}
                  disabled={isSaving}
                  className="pr-8"
                />
                <Percent className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pe-rate-effective-from">Effective from</Label>
              <Input
                id="pe-rate-effective-from"
                type="date"
                value={effectiveFromInput}
                onChange={(e) => setEffectiveFromInput(e.target.value)}
                disabled={isSaving}
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => setRateDialogOpen(false)}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="dp-btn-primary"
              onClick={handleSaveRate}
              disabled={isSaving || !rateInput.trim() || !effectiveFromInput}
            >
              {isSaving ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Saving…
                </>
              ) : (
                'Save rate'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <style>{`
        .pe-rate-pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 10px;
          border-radius: 9999px;
          font-size: 11px;
          font-weight: 600;
          line-height: 1;
        }
        .pe-rate-pill--pending {
          background: #fffbeb;
          color: #d97706;
          border: 1px solid #fde68a;
        }
        .pe-rate-pill-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #d97706;
          opacity: 0.85;
        }
        .dp-btn-primary {
          background: linear-gradient(135deg, #0d9488, #0f766e) !important;
          color: white !important;
          border: none !important;
          font-weight: 600;
          gap: 6px;
          border-radius: 10px;
          box-shadow: 0 2px 8px rgba(13, 148, 136, 0.25);
        }
        .dp-btn-primary:hover:not(:disabled) {
          box-shadow: 0 4px 14px rgba(13, 148, 136, 0.35);
        }
      `}</style>
    </>
  );
}
