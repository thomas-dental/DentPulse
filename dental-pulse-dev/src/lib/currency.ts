/** Shared £-currency formatter for pages that respect the org's "Show Decimals" display preference. */
export function formatCurrency(
  value: number | null | undefined,
  showDecimals: boolean,
  currency: string = 'GBP',
): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
    minimumFractionDigits: showDecimals ? 2 : 0,
    maximumFractionDigits: showDecimals ? 2 : 0,
  }).format(Number(value) || 0);
}
