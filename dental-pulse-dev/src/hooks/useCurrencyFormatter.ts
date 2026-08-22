import { useCallback } from 'react';
import { formatCurrency } from '@/lib/currency';
import { useOrganizationSettings } from './useOrganizationSettings';

/** A formatCurrency bound to the org's "Show Decimals" display preference. */
export function useCurrencyFormatter() {
  const { showDecimals } = useOrganizationSettings();

  const format = useCallback(
    (value: number | null | undefined, currency?: string) => formatCurrency(value, showDecimals, currency),
    [showDecimals],
  );

  return { formatCurrency: format, showDecimals };
}
