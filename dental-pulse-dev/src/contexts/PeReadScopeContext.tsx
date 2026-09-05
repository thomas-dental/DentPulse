import { createContext, useContext, type ReactNode } from 'react';

/** Committed read scope for Patient Economics (TopBar location + date). */
export type PeReadScope = {
  locationId: string | null;
  startDate: string;
  endDate: string;
  dateRangeId: string;
  /** False while period coverage check or sync modal is in progress. */
  isReady: boolean;
};

export const defaultPeReadScope: PeReadScope = {
  locationId: null,
  startDate: '',
  endDate: '',
  dateRangeId: 'this-month',
  isReady: false,
};

const PeReadScopeContext = createContext<PeReadScope>(defaultPeReadScope);

export function PeReadScopeProvider({
  value,
  children,
}: {
  value: PeReadScope;
  children: ReactNode;
}) {
  return (
    <PeReadScopeContext.Provider value={value}>{children}</PeReadScopeContext.Provider>
  );
}

export function usePeReadScope(): PeReadScope {
  return useContext(PeReadScopeContext);
}

/** Query params for economics-engine read APIs. */
export function peScopeToParams(
  practiceId: string,
  scope: PeReadScope,
): Record<string, string> {
  const params: Record<string, string> = { practiceId };
  if (scope.locationId) params.locationId = scope.locationId;
  if (scope.startDate) params.startDate = scope.startDate;
  if (scope.endDate) params.endDate = scope.endDate;
  return params;
}

export function peScopeQueryKey(scope: PeReadScope): string {
  return `${scope.locationId ?? 'all'}:${scope.startDate}:${scope.endDate}`;
}
