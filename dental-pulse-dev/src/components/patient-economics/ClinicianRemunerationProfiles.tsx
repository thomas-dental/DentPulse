import { useCallback, useEffect, useState } from 'react';
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
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Loader2,
  Percent,
  Search,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type {
  PractitionerRatesSortBy,
  PractitionerRatesSortDir,
  PractitionerWithRates,
} from '@/types/patientEconomicsAssumptions';
import {
  createPractitionerPrivateShareRate,
  listPractitionerPrivateShareRates,
} from '@/services/integrations/patientEconomicsService';

const PAGE_SIZE = 10;

type ClinicianRemunerationProfilesProps = {
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

function practitionerLabel(p: PractitionerWithRates): string {
  const role = p.providerRole?.replace(/_/g, ' ');
  if (role) return `${p.name} · ${role}`;
  return p.name;
}

function formatPrivateShare(p: PractitionerWithRates): string {
  if (p.rateConfigured && p.currentRate != null) {
    return formatRatePct(p.currentRate);
  }
  return '—';
}

function SortIcon({
  active,
  dir,
}: {
  active: boolean;
  dir: PractitionerRatesSortDir;
}) {
  if (!active) return <ArrowUpDown className="h-3 w-3 opacity-50" />;
  return dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />;
}

function RateHistoryList({ history }: { history: PractitionerWithRates['history'] }) {
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

export function ClinicianRemunerationProfiles({ organizationId }: ClinicianRemunerationProfilesProps) {
  const [practitioners, setPractitioners] = useState<PractitionerWithRates[]>([]);
  const [summary, setSummary] = useState({
    totalPractitioners: 0,
    configuredCount: 0,
    notConfiguredCount: 0,
    hasMissingRate: false,
  });
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: PAGE_SIZE,
    totalPages: 1,
    totalCount: 0,
  });
  const [currentPage, setCurrentPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sortBy, setSortBy] = useState<PractitionerRatesSortBy>('name');
  const [sortDir, setSortDir] = useState<PractitionerRatesSortDir>('asc');
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [migrationPending, setMigrationPending] = useState(false);

  const [rateDialogOpen, setRateDialogOpen] = useState(false);
  const [selectedPractitioner, setSelectedPractitioner] = useState<PractitionerWithRates | null>(
    null,
  );
  const [rateInput, setRateInput] = useState('');
  const [effectiveFromInput, setEffectiveFromInput] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(searchInput.trim()), 250);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    setCurrentPage(1);
  }, [organizationId, debouncedSearch, sortBy, sortDir]);

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
      const data = await listPractitionerPrivateShareRates(organizationId, {
        page: currentPage,
        pageSize: PAGE_SIZE,
        search: debouncedSearch || undefined,
        sortBy,
        sortDir,
      });
      setPractitioners(data.practitioners);
      setSummary(data.summary);
      setPagination(data.pagination);
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
  }, [organizationId, currentPage, debouncedSearch, sortBy, sortDir]);

  useEffect(() => {
    loadRates();
  }, [loadRates]);

  const toggleSort = (field: PractitionerRatesSortBy) => {
    if (sortBy === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortDir('asc');
    }
  };

  /** Per-clinician only — never a group / practice-wide rate. */
  const openRateDialog = (practitioner: PractitionerWithRates) => {
    setSelectedPractitioner(practitioner);
    setRateInput(
      practitioner.rateConfigured && practitioner.currentRate != null
        ? String(practitioner.currentRate)
        : '',
    );
    setEffectiveFromInput(new Date().toISOString().slice(0, 10));
    setRateDialogOpen(true);
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
      setSelectedPractitioner(null);
      await loadRates();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save rate');
    } finally {
      setIsSaving(false);
    }
  };

  const rangeStart =
    pagination.totalCount === 0 ? 0 : (pagination.page - 1) * pagination.pageSize + 1;
  const rangeEnd = Math.min(pagination.page * pagination.pageSize, pagination.totalCount);
  const showEmpty =
    !isLoading && !loadError && pagination.totalCount === 0 && !debouncedSearch;
  const showNoMatches =
    !isLoading && !loadError && pagination.totalCount === 0 && !!debouncedSearch;

  return (
    <>
      <div className="border-b border-border/70 py-3.5">
        <div>
          <div className="text-[13px] font-semibold text-foreground">
            Clinician remuneration profiles
          </div>
          <div className="mt-0.5 text-[12px] text-muted-foreground">
            Each clinician has their own private-share rate — not one group %. Click a row to edit
            that clinician only.
          </div>
        </div>

        {!loadError && (
          <div className="relative mt-3 max-w-sm">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search clinicians…"
              className="h-8 pl-8 text-xs"
              disabled={!organizationId || (!!isLoading && !practitioners.length && !searchInput)}
            />
          </div>
        )}

        {isLoading && (
          <div className="mt-4 flex items-center justify-center gap-2 py-8 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Loading clinicians…</span>
          </div>
        )}

        {!isLoading && loadError && (
          <div className="mt-4 flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
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

        {showEmpty && (
          <div className="mt-4 rounded-lg border border-dashed border-border px-4 py-8 text-center">
            <p className="text-sm font-medium text-foreground">No clinicians synced yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Sync practitioners from Dentally — names appear here once available.
            </p>
          </div>
        )}

        {showNoMatches && (
          <div className="mt-4 rounded-lg border border-dashed border-border px-4 py-6 text-center">
            <p className="text-sm font-medium text-foreground">No clinicians match “{debouncedSearch}”</p>
          </div>
        )}

        {!isLoading && !loadError && pagination.totalCount > 0 && (
          <>
            <div className="mt-2.5 overflow-x-auto">
              <table className="w-full min-w-[420px] border-collapse text-[12px]">
                <thead>
                  <tr className="text-muted-foreground">
                    <th className="pb-2.5 pl-0 pr-3.5 text-left font-semibold">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 hover:text-foreground"
                        onClick={() => toggleSort('name')}
                      >
                        Clinician
                        <SortIcon active={sortBy === 'name'} dir={sortDir} />
                      </button>
                    </th>
                    <th className="pb-2.5 px-3.5 text-right font-semibold">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 hover:text-foreground"
                        onClick={() => toggleSort('private_share')}
                      >
                        Private share
                        <SortIcon active={sortBy === 'private_share'} dir={sortDir} />
                      </button>
                    </th>
                    <th className="pb-2.5 px-3.5 text-left font-semibold">Lab treatment</th>
                    <th className="pb-2.5 pl-3.5 pr-0 text-right font-semibold">UDA rate</th>
                  </tr>
                </thead>
                <tbody>
                  {practitioners.map((p) => (
                    <tr
                      key={p.id}
                      className="cursor-pointer border-t border-border/60 transition-colors hover:bg-primary/[0.04]"
                      onClick={() => openRateDialog(p)}
                    >
                      <td className="py-2.5 pl-0 pr-3.5 font-semibold text-foreground">
                        {practitionerLabel(p)}
                      </td>
                      <td
                        className={cn(
                          'py-2.5 px-3.5 text-right font-semibold',
                          !p.rateConfigured && 'font-normal text-muted-foreground',
                        )}
                      >
                        {formatPrivateShare(p)}
                      </td>
                      <td className="py-2.5 px-3.5 text-muted-foreground">n/a</td>
                      <td className="py-2.5 pl-3.5 pr-0 text-right text-muted-foreground">n/a</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-3">
              <span className="text-[12px] text-muted-foreground">
                Showing {rangeStart}–{rangeEnd} of {pagination.totalCount} clinicians
              </span>
              {pagination.totalPages > 1 && (
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-7 w-7"
                    disabled={currentPage <= 1}
                    onClick={() => setCurrentPage(1)}
                  >
                    <ChevronsLeft className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-7 w-7"
                    disabled={currentPage <= 1}
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Button>
                  <span className="px-2 text-[12px] text-muted-foreground">
                    Page {pagination.page} of {pagination.totalPages}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-7 w-7"
                    disabled={currentPage >= pagination.totalPages}
                    onClick={() => setCurrentPage((p) => Math.min(pagination.totalPages, p + 1))}
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-7 w-7"
                    disabled={currentPage >= pagination.totalPages}
                    onClick={() => setCurrentPage(pagination.totalPages)}
                  >
                    <ChevronsRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <Dialog open={rateDialogOpen} onOpenChange={setRateDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {selectedPractitioner
                ? `Rate for ${practitionerLabel(selectedPractitioner)}`
                : 'Clinician rate'}
            </DialogTitle>
            <DialogDescription>
              Applies to this clinician only — not a group rate. Past rows are never edited.
            </DialogDescription>
          </DialogHeader>

          {selectedPractitioner && selectedPractitioner.history.length > 0 && (
            <div className="rounded-lg border border-border/70 bg-muted/20 px-3">
              <p className="pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Rate history
              </p>
              <RateHistoryList history={selectedPractitioner.history} />
            </div>
          )}

          <div className="space-y-4 py-1">
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
    </>
  );
}
