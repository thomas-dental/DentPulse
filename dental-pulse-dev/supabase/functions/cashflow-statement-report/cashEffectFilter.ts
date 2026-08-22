/**
 * Keep only cash-effect movements: drop same-day equal opposite amounts
 * (e.g. YouLend +£262 with "As per previous" −£262) that cancel in the running total.
 */

export function roundMoney2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export type CashEffectCandidate = {
  /** Stable id used to keep/drop */
  key: string;
  /** YYYY-MM-DD */
  date: string;
  /** Signed amount (+ in / − out) */
  amount: number;
  description?: string;
};

/** Lower = remove first when pairing opposites. */
function removableScore(it: CashEffectCandidate): number {
  const d = String(it.description || "").trim().toLowerCase();
  if (/as per previous/.test(d)) return 0;
  if (!d || d === "—" || d === "-") return 1;
  return 2;
}

/**
 * Returns the set of keys that should remain after cancelling same-day
 * equal-and-opposite amounts (prefer dropping clearing/"As per previous" rows).
 */
export function selectCashEffectKeys(items: CashEffectCandidate[]): Set<string> {
  const keep = new Set(items.map((i) => i.key));
  const groups = new Map<string, CashEffectCandidate[]>();

  for (const it of items) {
    const abs = roundMoney2(Math.abs(it.amount));
    if (abs < 0.005) continue;
    const date = String(it.date || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const gkey = `${date}|${abs.toFixed(2)}`;
    const g = groups.get(gkey) ?? [];
    g.push(it);
    groups.set(gkey, g);
  }

  for (const g of groups.values()) {
    const positives = g
      .filter((x) => x.amount > 0.005)
      .sort((a, b) => removableScore(a) - removableScore(b));
    const negatives = g
      .filter((x) => x.amount < -0.005)
      .sort((a, b) => removableScore(a) - removableScore(b));
    const pairs = Math.min(positives.length, negatives.length);
    for (let i = 0; i < pairs; i++) {
      keep.delete(positives[i].key);
      keep.delete(negatives[i].key);
    }
  }

  return keep;
}
