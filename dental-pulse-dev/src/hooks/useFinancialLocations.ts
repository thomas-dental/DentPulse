import { useMemo } from 'react';
import { useLocations } from './useLocations';
import type { PracticeLocation } from '@/types/location';

/**
 * Practice locations visible on financial screens.
 * Excludes rows with exclude_from_financial_display (e.g. Saint Catherine's)
 * so Settings/Organization mapping UIs can still show them via useLocations().
 */
export function useFinancialLocations() {
  const hook = useLocations();

  const financialLocations = useMemo(
    () =>
      (hook.locations || []).filter(
        (l: PracticeLocation & { exclude_from_financial_display?: boolean }) =>
          !l.exclude_from_financial_display,
      ),
    [hook.locations],
  );

  const allAvailableFinancialLocations = useMemo(
    () =>
      (hook.allAvailableLocations || []).filter(
        (l: PracticeLocation & { exclude_from_financial_display?: boolean }) =>
          !l.exclude_from_financial_display,
      ),
    [hook.allAvailableLocations],
  );

  return {
    ...hook,
    locations: financialLocations,
    allAvailableLocations: allAvailableFinancialLocations,
    allLocationsIncludingHidden: hook.locations,
  };
}
