import { format, parseISO } from 'date-fns';

export function formatPePrivateShareDisplayDate(isoDate: string): string {
  try {
    return format(parseISO(isoDate), 'd MMM yyyy');
  } catch {
    return isoDate;
  }
}

export function formatPePrivateShareRatePct(rate: number): string {
  const rounded = Math.round(rate * 100) / 100;
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(2)}%`;
}

export function formatPePrivateShareCurrentLabel(
  rateConfigured: boolean,
  currentRate: number | null,
): string {
  if (rateConfigured && currentRate != null) {
    return formatPePrivateShareRatePct(currentRate);
  }
  return 'Not configured';
}
