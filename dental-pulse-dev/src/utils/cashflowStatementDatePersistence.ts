import type { CustomRange, DateFilterType } from '@/components/ui/chart-date-filter';

/** Session-scoped key — cleared on logout (see useAuth.signOut). */
export const CASHFLOW_STATEMENT_DATES_STORAGE_KEY = 'dentpulse_cashflow_statement_dates';

const VALID_DATE_FILTERS: ReadonlySet<DateFilterType> = new Set([
  'this-month',
  'this-quarter',
  'this-year',
  'last-month',
  'last-quarter',
  'last-year',
  'custom',
]);

export interface CashflowStatementDateState {
  dateFilter: DateFilterType;
  customRange: CustomRange;
}

/** Default custom window: last 210 days → today (matches Version 2.0 / page defaults). */
export function getDefaultCashflowStatementDates(): CashflowStatementDateState {
  const from = new Date();
  from.setDate(from.getDate() - 210);
  return {
    dateFilter: 'custom',
    customRange: { from, to: new Date() },
  };
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Hydrate cashflow statement date filter from sessionStorage, or null if missing/invalid. */
export function loadCashflowStatementDates(): CashflowStatementDateState | null {
  try {
    const stored = sessionStorage.getItem(CASHFLOW_STATEMENT_DATES_STORAGE_KEY);
    if (!stored) return null;

    const parsed = JSON.parse(stored) as {
      dateFilter?: string;
      customRange?: { from?: string | null; to?: string | null };
    };

    const dateFilter = parsed.dateFilter;
    if (!dateFilter || !VALID_DATE_FILTERS.has(dateFilter as DateFilterType)) {
      return null;
    }

    const from = parseDate(parsed.customRange?.from);
    const to = parseDate(parsed.customRange?.to);
    if (!from || !to) return null;

    return {
      dateFilter: dateFilter as DateFilterType,
      customRange: { from, to },
    };
  } catch (e) {
    console.error('Error reading cashflow statement dates from sessionStorage:', e);
    return null;
  }
}

/** Persist cashflow statement date filter for the browser session. */
export function saveCashflowStatementDates(state: CashflowStatementDateState): void {
  try {
    sessionStorage.setItem(
      CASHFLOW_STATEMENT_DATES_STORAGE_KEY,
      JSON.stringify({
        dateFilter: state.dateFilter,
        customRange: {
          from: state.customRange.from?.toISOString() ?? null,
          to: state.customRange.to?.toISOString() ?? null,
        },
      }),
    );
  } catch (e) {
    console.error('Error saving cashflow statement dates to sessionStorage:', e);
  }
}

export function clearCashflowStatementDates(): void {
  try {
    sessionStorage.removeItem(CASHFLOW_STATEMENT_DATES_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Initial state for the statement date picker:
 * persisted session dates → optional fallback (e.g. top-nav range) → 210-day default.
 */
export function getInitialCashflowStatementDates(
  fallbackRange?: CustomRange,
): CashflowStatementDateState {
  const stored = loadCashflowStatementDates();
  if (stored) return stored;
  if (fallbackRange?.from && fallbackRange?.to) {
    return { dateFilter: 'custom', customRange: fallbackRange };
  }
  return getDefaultCashflowStatementDates();
}
