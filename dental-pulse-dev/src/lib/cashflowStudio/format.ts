/**
 * Cash Flow Scenario Studio — number formatting.
 * Executive style: $2.85M, $328K, ($450K) for negatives.
 */

export function fmtCompact(value: number, symbol = '$'): string {
  const neg = value < 0;
  const abs = Math.abs(value);
  let body: string;
  if (abs >= 1_000_000) body = `${symbol}${(abs / 1_000_000).toFixed(2)}M`;
  else if (abs >= 1_000) body = `${symbol}${Math.round(abs / 1_000)}K`;
  else body = `${symbol}${Math.round(abs)}`;
  return neg ? `(${body})` : body;
}

export function fmtFull(value: number, symbol = '$'): string {
  const neg = value < 0;
  const body = `${symbol}${Math.round(Math.abs(value)).toLocaleString()}`;
  return neg ? `(${body})` : body;
}

export function fmtSignedCompact(value: number, symbol = '$'): string {
  if (value === 0) return `${symbol}0`;
  const s = fmtCompact(Math.abs(value), symbol);
  return value > 0 ? `+${s}` : `−${s}`;
}
