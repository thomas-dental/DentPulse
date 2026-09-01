/**
 * Internal/dev PE sync inspector — not a product Settings screen.
 * URL: /dev/pe-sync-inspector (owner/admin only)
 *
 * Loads row counts first; browse rows load only when a resource tab is clicked.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useOrganization } from '@/hooks/useOrganization';
import { useUserRole } from '@/hooks/useUserRole';
import {
  BROWSE_CONFIG,
  BROWSE_RESOURCES,
  BrowseResource,
  PeDevOverview,
  PeLedgerCounts,
  PeRowCounts,
  browsePeRows,
  fetchPeDevCounts,
  fetchPeDevOverview,
  triggerPeLedgerBackfill,
  triggerPeSyncChunk,
} from '@/services/integrations/peSyncInspectorService';
import { Loader2, RefreshCw } from 'lucide-react';

const PAGE_SIZE = 25;

function fmt(ts: string | null | undefined) {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}

function countLabel(counts: PeRowCounts | null, key: string): string | null {
  const c = counts?.[key];
  if (!c || c.error || c.count == null) return null;
  return String(c.count);
}

export default function PeSyncInspector() {
  const { organizationId: currentOrgId, organization } = useOrganization();
  const { isOwner, isAdmin, loading: roleLoading } = useUserRole();
  const allowed = isOwner() || isAdmin();

  const [counts, setCounts] = useState<PeRowCounts | null>(null);
  const [ledgerCounts, setLedgerCounts] = useState<PeLedgerCounts | null>(null);
  const [countsLoading, setCountsLoading] = useState(true);
  const [countsError, setCountsError] = useState<string | null>(null);

  const [overview, setOverview] = useState<PeDevOverview | null>(null);
  const [metaLoading, setMetaLoading] = useState(true);
  const [metaError, setMetaError] = useState<string | null>(null);

  const [triggering, setTriggering] = useState<string | null>(null);
  const [backfillingLedger, setBackfillingLedger] = useState(false);

  const [browseResource, setBrowseResource] = useState<BrowseResource | null>(null);
  const [browsePage, setBrowsePage] = useState(0);
  const [browseRows, setBrowseRows] = useState<Record<string, unknown>[]>([]);
  const [browseQueryTotal, setBrowseQueryTotal] = useState<number | null>(null);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);

  const loadCounts = useCallback(async () => {
    if (!currentOrgId) return;
    setCountsLoading(true);
    setCountsError(null);
    try {
      const next = await fetchPeDevCounts(currentOrgId);
      setCounts(next.counts);
      setLedgerCounts(next.ledger);
    } catch (err) {
      setCountsError(err instanceof Error ? err.message : 'Failed to load counts');
    } finally {
      setCountsLoading(false);
    }
  }, [currentOrgId]);

  const loadMeta = useCallback(async () => {
    if (!currentOrgId) return;
    setMetaLoading(true);
    setMetaError(null);
    try {
      const ov = await fetchPeDevOverview(currentOrgId);
      setOverview(ov);
    } catch (err) {
      setMetaError(err instanceof Error ? err.message : 'Failed to load sync status');
    } finally {
      setMetaLoading(false);
    }
  }, [currentOrgId]);

  const loadBrowse = useCallback(async () => {
    if (!currentOrgId || !browseResource) return;
    setBrowseLoading(true);
    setBrowseError(null);
    setBrowseRows([]);
    try {
      const { rows, total } = await browsePeRows(
        currentOrgId,
        browseResource,
        browsePage,
        PAGE_SIZE
      );
      setBrowseRows(rows);
      setBrowseQueryTotal(total);
    } catch (err) {
      setBrowseError(err instanceof Error ? err.message : 'Browse failed');
      setBrowseRows([]);
      setBrowseQueryTotal(null);
    } finally {
      setBrowseLoading(false);
    }
  }, [currentOrgId, browseResource, browsePage]);

  useEffect(() => {
    if (allowed && currentOrgId) {
      loadCounts();
      loadMeta();
    }
  }, [allowed, currentOrgId, loadCounts, loadMeta]);

  useEffect(() => {
    if (allowed && currentOrgId && browseResource) {
      loadBrowse();
    }
  }, [allowed, currentOrgId, browseResource, browsePage, loadBrowse]);

  const browseColumns = useMemo(() => {
    if (!browseResource) return [] as string[];
    return BROWSE_CONFIG[browseResource].columns;
  }, [browseResource]);

  const browseDisplayTotal =
    browseResource && counts?.[browseResource]?.count != null
      ? counts[browseResource].count
      : browseQueryTotal;

  const onSelectBrowse = (r: BrowseResource) => {
    setBrowseResource(r);
    setBrowsePage(0);
    setBrowseRows([]);
    setBrowseQueryTotal(null);
    setBrowseError(null);
  };

  const onBackfillLedger = async () => {
    if (!currentOrgId) return;
    setBackfillingLedger(true);
    setMetaError(null);
    try {
      await triggerPeLedgerBackfill(currentOrgId);
      await loadCounts();
    } catch (err) {
      setMetaError(err instanceof Error ? err.message : 'Ledger backfill failed');
    } finally {
      setBackfillingLedger(false);
    }
  };

  const onTrigger = async (resourceType: string) => {
    if (!currentOrgId) return;
    setTriggering(resourceType);
    try {
      await triggerPeSyncChunk(currentOrgId, resourceType);
      await Promise.all([loadCounts(), loadMeta()]);
      if (
        browseResource &&
        (BROWSE_RESOURCES.includes(resourceType as BrowseResource) ||
          (resourceType === 'invoice_items' && browseResource === 'invoice_items'))
      ) {
        await loadBrowse();
      }
    } catch (err) {
      setMetaError(err instanceof Error ? err.message : 'Trigger failed');
    } finally {
      setTriggering(null);
    }
  };

  const onRefresh = async () => {
    const tasks: Promise<void>[] = [loadCounts(), loadMeta()];
    if (browseResource) tasks.push(loadBrowse());
    await Promise.all(tasks);
  };

  const refreshing = countsLoading || metaLoading || browseLoading;

  if (roleLoading) {
    return (
      <MainLayout>
        <div className="p-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      </MainLayout>
    );
  }

  if (!allowed) {
    return (
      <MainLayout>
        <div className="p-6">
          <h1 className="text-lg font-semibold">PE Sync Inspector</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Owner/admin only. This page is not available to normal members.
          </p>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <Helmet>
        <title>PE Sync Inspector (dev)</title>
      </Helmet>
      <div className="p-4 space-y-6 max-w-[1400px]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold">PE Sync Inspector</h1>
            <p className="text-xs text-muted-foreground">
              Dev/engineering only — practice{' '}
              <code className="text-xs">{organization?.name || currentOrgId}</code>
              . Counts load first; click a resource below to browse rows.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={onRefresh}
            disabled={refreshing || !currentOrgId}
          >
            {refreshing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            <span className="ml-2">Refresh</span>
          </Button>
        </div>

        {(countsError || metaError) && (
          <div className="border border-destructive/40 bg-destructive/5 text-sm p-3 rounded">
            {countsError || metaError}
          </div>
        )}

        {/* Counts — first / fastest */}
        <section>
          <h2 className="text-sm font-medium mb-2">Row counts</h2>
          <div className="overflow-x-auto border rounded min-h-[80px]">
            {countsLoading && !counts ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground p-4">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading row counts…
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Resource</TableHead>
                    <TableHead>Table</TableHead>
                    <TableHead className="text-right">Count</TableHead>
                    <TableHead>Note</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Object.entries(counts || {}).map(([key, c]) => (
                    <TableRow key={key}>
                      <TableCell className="font-mono text-xs">{key}</TableCell>
                      <TableCell className="font-mono text-xs">{c.table}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {c.error ? `err` : c.count ?? '—'}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {c.error || c.note || ''}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </section>

        {/* Event ledger */}
        <section>
          <div className="flex items-center justify-between gap-4 mb-2">
            <h2 className="text-sm font-medium">Event ledger</h2>
            <Button
              size="sm"
              variant="secondary"
              disabled={backfillingLedger || !currentOrgId}
              onClick={onBackfillLedger}
            >
              {backfillingLedger ? (
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
              ) : null}
              Backfill missing events
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground mb-2">
            Compare source row counts above with ledger events below. Backfill emits missing
            historical events from synced tables (safe to re-run).
          </p>
          <div className="overflow-x-auto border rounded min-h-[80px]">
            {countsLoading && !ledgerCounts ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground p-4">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading ledger counts…
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Event type</TableHead>
                    <TableHead className="text-right">Count</TableHead>
                    <TableHead>Source rows (hint)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="font-mono text-xs">total</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {ledgerCounts?.totalError ? 'err' : ledgerCounts?.total ?? '—'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">event_ledger</TableCell>
                  </TableRow>
                  {Object.entries(ledgerCounts?.byType || {}).map(([eventType, row]) => {
                    const hintKey =
                      eventType === 'PLAN_CREATED' ||
                      eventType === 'TREATMENT_STARTED' ||
                      eventType === 'PLAN_COMPLETED'
                        ? 'treatment_plans'
                        : eventType === 'APPOINTMENT_LINKED' || eventType === 'APPOINTMENT_UNLINKED'
                          ? 'treatment_appointments'
                          : eventType === 'ITEM_COMPLETED'
                            ? 'treatment_items'
                            : eventType === 'INVOICE_RAISED'
                              ? 'invoices'
                              : eventType === 'PAYMENT_ALLOCATED'
                                ? 'payments'
                                : eventType === 'RECALL_DUE' ||
                                    eventType === 'RECALL_OVERDUE' ||
                                    eventType === 'PATIENT_REACTIVATED'
                                  ? 'patients'
                                  : null;
                    const hintCount = hintKey ? countLabel(counts, hintKey) : null;
                    return (
                      <TableRow key={eventType}>
                        <TableCell className="font-mono text-xs">{eventType}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.error ? 'err' : row.count ?? '—'}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {hintKey && hintCount != null ? `${hintKey}: ${hintCount}` : '—'}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </div>
        </section>

        {/* PAT */}
        <section>
          <h2 className="text-sm font-medium mb-2">PAT / connection</h2>
          {metaLoading && !overview ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground border rounded p-3">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading connection…
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>validated_at</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell>{overview?.pat.label ?? '—'}</TableCell>
                  <TableCell>{fmt(overview?.pat.validatedAt)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </section>

        {/* Status */}
        <section>
          <h2 className="text-sm font-medium mb-2">Sync status (sync_cursors)</h2>
          <div className="overflow-x-auto border rounded relative min-h-[80px]">
            {metaLoading && !overview ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground p-4">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading sync status…
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Resource</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last delta</TableHead>
                    <TableHead>Last full</TableHead>
                    <TableHead>Last error</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(overview?.resources || []).map((r) => {
                    const syncDisabled = triggering === r.resourceType;
                    return (
                      <TableRow key={r.resourceType}>
                        <TableCell className="font-mono text-xs">
                          {r.resourceType}
                          {r.cursorAliasOf ? (
                            <span className="text-muted-foreground">
                              {' '}
                              (= {r.cursorAliasOf})
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell>{r.status}</TableCell>
                        <TableCell className="text-xs">
                          {fmt(r.lastIncrementalCompletedAt)}
                        </TableCell>
                        <TableCell className="text-xs">{fmt(r.lastFullCompletedAt)}</TableCell>
                        <TableCell
                          className="text-xs max-w-[280px] truncate"
                          title={r.lastError || ''}
                        >
                          {r.lastError || '—'}
                        </TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={syncDisabled}
                            onClick={() => onTrigger(r.resourceType)}
                          >
                            {triggering === r.resourceType ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              'Sync'
                            )}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            Sync runs one chunk per click — no background PE sync unless{' '}
            <code className="text-[10px]">PE_SYNC_CRON_ENABLED=true</code> on the API.
          </p>
        </section>

        {/* Browse — on demand */}
        <section>
          <h2 className="text-sm font-medium mb-2">Synced data (browse)</h2>
          <p className="text-[11px] text-muted-foreground mb-2">
            Click a resource to load rows from the database (onboarding + later syncs).
          </p>
          <div className="flex flex-wrap gap-2 mb-3">
            {BROWSE_RESOURCES.map((r) => {
              const n = countLabel(counts, r);
              return (
                <Button
                  key={r}
                  size="sm"
                  variant={browseResource === r ? 'default' : 'outline'}
                  disabled={browseLoading && browseResource === r}
                  onClick={() => onSelectBrowse(r)}
                >
                  {browseLoading && browseResource === r ? (
                    <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  ) : null}
                  {r}
                  {n != null ? (
                    <span className="ml-1 tabular-nums opacity-80">({n})</span>
                  ) : null}
                </Button>
              );
            })}
          </div>
          {browseError && (
            <div className="text-sm text-destructive mb-2">{browseError}</div>
          )}
          {!browseResource ? (
            <div className="border rounded p-8 text-center text-sm text-muted-foreground">
              Select patients, accounts, recalls, etc. above to load table rows.
            </div>
          ) : (
            <>
              <div className="overflow-x-auto border rounded min-h-[120px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {browseColumns.map((col) => (
                        <TableHead key={col} className="font-mono text-[11px]">
                          {col}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {browseLoading ? (
                      <TableRow>
                        <TableCell colSpan={browseColumns.length} className="py-8">
                          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Loading {browseResource}…
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : browseRows.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={browseColumns.length}
                          className="text-muted-foreground py-6 text-center"
                        >
                          No rows in database for {browseResource}
                        </TableCell>
                      </TableRow>
                    ) : (
                      browseRows.map((row, i) => (
                        <TableRow key={i}>
                          {browseColumns.map((col) => (
                            <TableCell key={col} className="text-xs font-mono whitespace-nowrap">
                              {row[col] == null ? '—' : String(row[col])}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
              <div className="flex items-center gap-3 mt-2 text-xs">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={browsePage === 0 || browseLoading}
                  onClick={() => setBrowsePage((p) => Math.max(0, p - 1))}
                >
                  Prev
                </Button>
                <span>
                  {browseLoading ? (
                    <span className="inline-flex items-center gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" /> Loading…
                    </span>
                  ) : (
                    <>
                      Page {browsePage + 1}
                      {browseDisplayTotal != null ? ` · ${browseDisplayTotal} total` : ''}
                    </>
                  )}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={
                    browseLoading ||
                    (browseDisplayTotal != null &&
                      (browsePage + 1) * PAGE_SIZE >= browseDisplayTotal)
                  }
                  onClick={() => setBrowsePage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </>
          )}
        </section>
      </div>
    </MainLayout>
  );
}
