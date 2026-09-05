/**
 * Shared Patient Economics private-share UI — list cell, history, provider edit panel.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { AlertCircle, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
  formatPePrivateShareCurrentLabel,
  formatPePrivateShareDisplayDate,
  formatPePrivateShareRatePct,
} from '@/lib/pePractitionerPrivateShareFormat';
import {
  useInvalidatePractitionerPrivateShareRates,
  usePractitionerPrivateShareRate,
} from '@/hooks/usePractitionerPrivateShareRates';
import { createPractitionerPrivateShareRate } from '@/services/integrations/patientEconomicsService';
import type { PractitionerRateHistoryEntry } from '@/types/patientEconomicsAssumptions';

export function PePrivateShareListCell({
  rateConfigured,
  currentRate,
  isLoading,
}: {
  rateConfigured?: boolean;
  currentRate?: number | null;
  isLoading?: boolean;
}) {
  if (isLoading) {
    return (
      <span className="text-[11px] text-muted-foreground">
        <Loader2 className="inline h-3 w-3 animate-spin" />
      </span>
    );
  }

  if (!rateConfigured || currentRate == null) {
    return (
      <span className="text-[11px] font-medium text-muted-foreground">Not configured</span>
    );
  }

  return (
    <span className="text-sm font-medium tabular-nums text-foreground">
      {formatPePrivateShareRatePct(currentRate)}
    </span>
  );
}

export function PeRateHistoryList({ history }: { history: PractitionerRateHistoryEntry[] }) {
  if (history.length === 0) {
    return <p className="py-2 text-xs text-muted-foreground">No rate history yet.</p>;
  }

  return (
    <ul className="max-h-48 space-y-2 overflow-y-auto py-2">
      {history.map((entry) => (
        <li
          key={entry.id}
          className={cn(
            'flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs',
            entry.isCurrent ? 'border-primary/30 bg-primary/5' : 'border-border bg-muted/30',
          )}
        >
          <div>
            <span className="font-semibold text-foreground">
              {formatPePrivateShareRatePct(entry.rate)}
            </span>
            {entry.isCurrent && (
              <span className="ml-2 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                Current
              </span>
            )}
          </div>
          <span className="text-muted-foreground">
            {formatPePrivateShareDisplayDate(entry.effectiveFrom)}
            {' → '}
            {entry.effectiveTo ? formatPePrivateShareDisplayDate(entry.effectiveTo) : 'ongoing'}
          </span>
        </li>
      ))}
    </ul>
  );
}

type PePrivateShareProviderPanelProps = {
  organizationId?: string | null;
  practitionerId?: string | null;
  practitionerName?: string;
};

export function PePrivateShareProviderPanel({
  organizationId,
  practitionerId,
  practitionerName,
}: PePrivateShareProviderPanelProps) {
  const invalidateRates = useInvalidatePractitionerPrivateShareRates();
  const ratesQuery = usePractitionerPrivateShareRate(organizationId, practitionerId);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [rateInput, setRateInput] = useState('');
  const [effectiveFromInput, setEffectiveFromInput] = useState(() =>
    format(new Date(), 'yyyy-MM-dd'),
  );
  const [isSaving, setIsSaving] = useState(false);

  const row = ratesQuery.data;
  const loadError = ratesQuery.isError
    ? (ratesQuery.error as Error)?.message || 'Failed to load private-share rate'
    : null;
  const migrationPending =
    ratesQuery.isError &&
    (ratesQuery.error as Error & { code?: string })?.code === 'TABLE_NOT_FOUND';

  const handleSavePeRate = async () => {
    if (!organizationId || !practitionerId || isSaving) return;

    const rate = parseFloat(rateInput);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      toast.error('Enter a private-share rate between 0 and 100');
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
        practitionerId,
        rate,
        effectiveFromInput,
      );
      invalidateRates(organizationId, practitionerId);
      setRateInput('');
      setEffectiveFromInput(format(new Date(), 'yyyy-MM-dd'));
      setHistoryOpen(true);
      toast.success('Split saved', {
        description: `New split effective from ${formatPePrivateShareDisplayDate(effectiveFromInput)}.`,
      });
      await ratesQuery.refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save private-share rate');
    } finally {
      setIsSaving(false);
    }
  };

  const effectiveFromLabel = effectiveFromInput
    ? formatPePrivateShareDisplayDate(effectiveFromInput)
    : 'the selected date';

  return (
    <div className="space-y-4 rounded-md border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Split</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Private-share % for Patient Economics contribution — effective-dated; past invoices
            use the rate active at invoice date.
          </p>
        </div>
        <Link
          to="/patients?tab=settings"
          className="text-xs font-medium text-primary underline-offset-2 hover:underline"
        >
          All clinicians in PE Settings
        </Link>
      </div>

      {ratesQuery.isLoading && (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading split…
        </div>
      )}

      {loadError && (
        <div
          className={cn(
            'flex items-start gap-2 rounded-lg border px-3 py-2 text-xs',
            migrationPending
              ? 'border-amber-200/80 bg-amber-50/80 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100'
              : 'border-destructive/30 bg-destructive/5 text-destructive',
          )}
        >
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{loadError}</span>
        </div>
      )}

      {!ratesQuery.isLoading && !loadError && row && (
        <div className="rounded-lg border border-border/70 bg-muted/20 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Current effective rate
          </p>
          <p className="mt-1 text-lg font-bold tabular-nums text-foreground">
            {formatPePrivateShareCurrentLabel(row.rateConfigured, row.currentRate)}
          </p>
          {row.rateConfigured && row.currentEffectiveFrom && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Effective from {formatPePrivateShareDisplayDate(row.currentEffectiveFrom)}
            </p>
          )}
        </div>
      )}

      <button
        type="button"
        className="flex w-full items-center gap-2 text-left text-sm font-medium text-foreground"
        onClick={() => setHistoryOpen((open) => !open)}
        disabled={ratesQuery.isLoading || !!loadError}
      >
        {historyOpen ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
        Rate history
        {row?.history?.length ? (
          <span className="text-xs font-normal text-muted-foreground">
            ({row.history.length} row{row.history.length === 1 ? '' : 's'})
          </span>
        ) : null}
      </button>

      {historyOpen && row && <PeRateHistoryList history={row.history} />}

      <div className="space-y-4 border-t border-border/60 pt-4">
        <p className="text-xs leading-relaxed text-muted-foreground">
          Add a new effective-dated rate for{' '}
          <span className="font-medium text-foreground">{practitionerName || 'this clinician'}</span>.
          Saving inserts a new row — past invoices keep the rate that was active at invoice date.
        </p>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="pe-provider-split-percentage">Split Percentage</Label>
            <div className="flex h-10 w-full items-center rounded-md border border-input bg-background">
              <Input
                id="pe-provider-split-percentage"
                type="number"
                min={0}
                max={100}
                step={0.01}
                placeholder="50"
                value={rateInput}
                onChange={(e) => setRateInput(e.target.value)}
                disabled={isSaving || ratesQuery.isLoading || !!loadError}
                className="h-full border-0 bg-transparent hover:border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
              />
              <span className="px-3 text-sm text-muted-foreground">%</span>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="pe-provider-rate-effective-from">Effective from</Label>
            <Input
              id="pe-provider-rate-effective-from"
              type="date"
              value={effectiveFromInput}
              onChange={(e) => setEffectiveFromInput(e.target.value)}
              disabled={isSaving || ratesQuery.isLoading || !!loadError}
            />
          </div>
        </div>

        <p className="text-xs leading-relaxed text-muted-foreground">
          This creates a new split effective from {effectiveFromLabel}; past invoices keep the
          rate that was active at invoice date.
        </p>

        <Button
          type="button"
          onClick={handleSavePeRate}
          disabled={
            isSaving ||
            ratesQuery.isLoading ||
            !!loadError ||
            !rateInput.trim() ||
            !effectiveFromInput
          }
          className="gap-2"
        >
          {isSaving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving…
            </>
          ) : (
            'Save split'
          )}
        </Button>
      </div>
    </div>
  );
}
