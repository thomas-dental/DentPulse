/**
 * Shared money / percent display for Cashflow and Profit modules.
 * Negatives: (£1,532) — never £-1,532 or -£1,532
 * Positives: £1,532 — never +£1,532
 */

export function formatGbp(
  value: number,
  options?: { decimals?: number; zeroAsDash?: boolean; symbol?: string }
): string {
  const n = Number(value);
  const symbol = options?.symbol ?? '£';
  const decimals = options?.decimals ?? 0;
  if (!Number.isFinite(n) || n === 0) {
    return options?.zeroAsDash ? '–' : `${symbol}0`;
  }
  const abs = Math.abs(n).toLocaleString('en-GB', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  if (n < 0) return `(${symbol}${abs})`;
  return `${symbol}${abs}`;
}

/** Percent without leading "+"; negatives as (12.34%). */
export function formatPercentDisplay(value: number, decimals = 2): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return `${(0).toFixed(decimals)}%`;
  const abs = Math.abs(n).toFixed(decimals);
  if (n < 0) return `(${abs}%)`;
  return `${abs}%`;
}

/**
 * Normalize API / legacy money strings like "£-1,532", "£–1,532", "-£1,532", "+£1,532"
 * into "(£1,532)" / "£1,532". Leaves already-correct or non-money strings alone.
 */
export function normalizeMoneyDisplay(value: string | null | undefined): string {
  if (value == null) return '–';
  const trimmed = String(value).trim();
  if (!trimmed || trimmed === '–' || trimmed === '-' || trimmed === '—') return trimmed || '–';

  const parenMatch = /^\(\s*([£$€]?)\s*([\d,.]+)\s*\)$/.exec(trimmed);
  if (parenMatch) {
    const sym = parenMatch[1] || '£';
    return `(${sym}${parenMatch[2]})`;
  }

  const signedMatch =
    /^([+]?)([£$€])\s*([–−-]?)\s*([\d,.]+)$/.exec(trimmed) ||
    /^([–−-])\s*([£$€])\s*([\d,.]+)$/.exec(trimmed);
  if (!signedMatch) return trimmed;

  // Forms: £-1,532 | +£1,532 | -£1,532
  let negative = false;
  let symbol = '£';
  let amount = '';
  if (signedMatch.length === 5) {
    // [+] £ [–] digits
    negative = Boolean(signedMatch[3]);
    symbol = signedMatch[2];
    amount = signedMatch[4];
  } else {
    // - £ digits
    negative = true;
    symbol = signedMatch[2];
    amount = signedMatch[3];
  }
  if (!amount) return trimmed;
  return negative ? `(${symbol}${amount})` : `${symbol}${amount}`;
}
