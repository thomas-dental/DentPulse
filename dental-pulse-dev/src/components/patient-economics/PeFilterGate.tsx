import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useFilters } from '@/contexts/FilterContext';
import { getDateFilterLabel } from '@/components/ui/chart-date-filter';
import { toLocalYMD } from '@/utils/dateRangeUtils';
import {
  PeReadScopeProvider,
  type PeReadScope,
} from '@/contexts/PeReadScopeContext';
import { useOrganization } from '@/hooks/useOrganization';
import {
  fetchPePeriodCoverage,
  kickoffPePeriodSync,
} from '@/services/integrations/patientEconomicsService';
import { PePeriodSyncModal } from '@/components/patient-economics/PePeriodSyncModal';

type PeFilterGateProps = {
  children: ReactNode;
  /** Settings tab skips global date/location filtering. */
  skipFilters?: boolean;
};

type PendingDate = {
  dateRangeId: string;
  customFrom: Date | null;
  customTo: Date | null;
  startDate: string;
  endDate: string;
};

type CoverageRevert = {
  filters: { dateRangeId: string; from: string | null; to: string | null };
  scope: PeReadScope;
};

export function PeFilterGate({ children, skipFilters = false }: PeFilterGateProps) {
  const { organizationId } = useOrganization();
  const {
    selectedLocationId,
    selectedDateRangeId,
    customDateRange,
    dateRange,
    setSelectedDateRangeId,
    setCustomDateRange,
  } = useFilters();

  const [committedScope, setCommittedScope] = useState<PeReadScope>(() => ({
    locationId: null,
    startDate: '',
    endDate: '',
    dateRangeId: 'this-month',
    isReady: false,
  }));

  const [modalOpen, setModalOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncInProgress, setSyncInProgress] = useState(false);
  const [pendingDate, setPendingDate] = useState<PendingDate | null>(null);

  const prevDateRef = useRef({
    dateRangeId: selectedDateRangeId,
    from: customDateRange.from?.toISOString() ?? null,
    to: customDateRange.to?.toISOString() ?? null,
  });
  const prevLocationRef = useRef<string | null>(selectedLocationId);
  const committedScopeRef = useRef(committedScope);
  committedScopeRef.current = committedScope;
  const coverageRevertRef = useRef<CoverageRevert | null>(null);

  const buildScopeFromFilters = useCallback((): PeReadScope | null => {
    const startDate = toLocalYMD(dateRange.startDate);
    const endDate = toLocalYMD(dateRange.endDate);
    if (!startDate || !endDate) return null;
    return {
      locationId: selectedLocationId,
      startDate,
      endDate,
      dateRangeId: selectedDateRangeId,
      isReady: true,
    };
  }, [
    dateRange.startDate,
    dateRange.endDate,
    selectedLocationId,
    selectedDateRangeId,
  ]);

  const commitScope = useCallback((scope: PeReadScope) => {
    setCommittedScope(scope);
    prevDateRef.current = {
      dateRangeId: scope.dateRangeId,
      from: customDateRange.from?.toISOString() ?? null,
      to: customDateRange.to?.toISOString() ?? null,
    };
    prevLocationRef.current = scope.locationId;
  }, [customDateRange.from, customDateRange.to]);

  const revertDateSelection = useCallback(() => {
    const revert = coverageRevertRef.current;
    if (revert) {
      setSelectedDateRangeId(revert.filters.dateRangeId);
      setCustomDateRange({
        from: revert.filters.from ? new Date(revert.filters.from) : null,
        to: revert.filters.to ? new Date(revert.filters.to) : null,
      });
      commitScope(revert.scope);
      coverageRevertRef.current = null;
    }
    setModalOpen(false);
    setPendingDate(null);
  }, [setCustomDateRange, setSelectedDateRangeId, commitScope]);

  /** Non-blocking: PE reads start immediately; sync modal only if period lacks data. */
  const checkPeriodCoverage = useCallback(
    (scope: PeReadScope, pending: PendingDate, revert?: CoverageRevert) => {
      if (!organizationId) return () => {};

      let cancelled = false;
      (async () => {
        try {
          const coverage = await fetchPePeriodCoverage(organizationId, {
            locationId: scope.locationId,
            startDate: scope.startDate,
            endDate: scope.endDate,
          });
          if (cancelled) return;
          if (coverage.needsSync) {
            if (revert) coverageRevertRef.current = revert;
            setPendingDate(pending);
            setSyncInProgress(coverage.syncInProgress);
            setModalOpen(true);
          } else {
            coverageRevertRef.current = null;
          }
        } catch {
          // Scope already committed — reads proceed with best-effort data.
        }
      })();

      return () => {
        cancelled = true;
      };
    },
    [organizationId],
  );

  // Initial commit on mount (and when org loads)
  useEffect(() => {
    if (skipFilters || !organizationId) return;
    const scope = buildScopeFromFilters();
    if (!scope) return;

    commitScope(scope);

    return checkPeriodCoverage(scope, {
      dateRangeId: scope.dateRangeId,
      customFrom: customDateRange.from,
      customTo: customDateRange.to,
      startDate: scope.startDate,
      endDate: scope.endDate,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, skipFilters]);

  // Location changes apply immediately
  useEffect(() => {
    if (skipFilters || !organizationId || !committedScope.isReady) return;
    if (prevLocationRef.current === selectedLocationId) return;

    const scope = buildScopeFromFilters();
    if (!scope) return;
    commitScope(scope);
  }, [selectedLocationId, skipFilters, organizationId, buildScopeFromFilters, commitScope, committedScope.isReady]);

  // Date changes — apply scope immediately; coverage check runs in parallel
  useEffect(() => {
    if (skipFilters || !organizationId) return;

    const dateChanged =
      prevDateRef.current.dateRangeId !== selectedDateRangeId ||
      prevDateRef.current.from !== (customDateRange.from?.toISOString() ?? null) ||
      prevDateRef.current.to !== (customDateRange.to?.toISOString() ?? null);

    if (!dateChanged) return;

    const scope = buildScopeFromFilters();
    if (!scope) return;

    const revert: CoverageRevert | undefined = committedScopeRef.current.isReady
      ? {
          filters: { ...prevDateRef.current },
          scope: { ...committedScopeRef.current },
        }
      : undefined;

    commitScope(scope);

    return checkPeriodCoverage(
      scope,
      {
        dateRangeId: scope.dateRangeId,
        customFrom: customDateRange.from,
        customTo: customDateRange.to,
        startDate: scope.startDate,
        endDate: scope.endDate,
      },
      revert,
    );
  }, [
    selectedDateRangeId,
    customDateRange.from,
    customDateRange.to,
    organizationId,
    skipFilters,
    buildScopeFromFilters,
    commitScope,
    checkPeriodCoverage,
  ]);

  const handleConfirmSync = async () => {
    if (!organizationId || !pendingDate) return;
    setIsSyncing(true);
    try {
      await kickoffPePeriodSync(organizationId, {
        startDate: pendingDate.startDate,
        endDate: pendingDate.endDate,
      });
      setModalOpen(false);
      coverageRevertRef.current = null;
      commitScope({
        locationId: selectedLocationId,
        startDate: pendingDate.startDate,
        endDate: pendingDate.endDate,
        dateRangeId: pendingDate.dateRangeId,
        isReady: true,
      });
      setPendingDate(null);
    } catch (err) {
      console.error('[PeFilterGate] kickoff-period failed:', err);
    } finally {
      setIsSyncing(false);
    }
  };

  const periodLabel =
    pendingDate
      ? getDateFilterLabel(
          pendingDate.dateRangeId as Parameters<typeof getDateFilterLabel>[0],
        )
      : getDateFilterLabel(selectedDateRangeId as Parameters<typeof getDateFilterLabel>[0]);

  const activeScope: PeReadScope = skipFilters
    ? { ...committedScope, isReady: true }
    : committedScope;

  return (
    <PeReadScopeProvider value={activeScope}>
      {children}
      {!skipFilters && (
        <PePeriodSyncModal
          open={modalOpen}
          periodLabel={periodLabel}
          syncInProgress={syncInProgress}
          isSyncing={isSyncing}
          onConfirm={handleConfirmSync}
          onCancel={revertDateSelection}
        />
      )}
    </PeReadScopeProvider>
  );
}
