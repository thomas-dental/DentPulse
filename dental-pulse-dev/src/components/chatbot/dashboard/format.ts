// Shared value formatting for BI dashboard widgets. UK conventions: £ + DD/MM/YYYY.
export type WidgetUnit = 'currency' | 'count' | undefined;

export function formatValue(value: number, unit: WidgetUnit): string {
  const n = Number(value) || 0;
  if (unit === 'currency') {
    return '£' + n.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }
  return n.toLocaleString('en-GB');
}

export function formatAxis(value: number, unit: WidgetUnit): string {
  const n = Number(value) || 0;
  if (unit === 'currency') {
    return Math.abs(n) >= 1000 ? `£${(n / 1000).toFixed(0)}k` : `£${n}`;
  }
  return String(n);
}

// Distinct categorical palette for bar/pie slices — theme tokens first.
export const CHART_COLORS = [
  'hsl(var(--primary))',
  'hsl(var(--success, 142 71% 45%))',
  'hsl(var(--warning, 38 92% 50%))',
  'hsl(217 91% 60%)',
  'hsl(280 65% 60%)',
  'hsl(0 72% 60%)',
  'hsl(174 62% 47%)',
  'hsl(43 74% 49%)',
  'hsl(199 89% 48%)',
  'hsl(330 70% 58%)',
  'hsl(258 70% 62%)',
  'hsl(160 60% 45%)',
];
