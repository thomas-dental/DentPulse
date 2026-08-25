/** Self-contained formatters for the Membership Plan Insights preview tabs.
 *  Deliberately NOT shared with MembershipPerformance.tsx so this module has
 *  zero coupling to the existing page's code. */

export function gbp(amount: number): string {
  return `£${Math.round(amount).toLocaleString("en-GB")}`;
}

/** Pence-precision £ — for small per-member figures where rounding to whole
 *  pounds (gbp) would misstate the number (£1.41 → "£1"). */
export function gbpExact(amount: number): string {
  return `£${amount.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function nn(amount: number): string {
  return Math.round(amount).toLocaleString("en-GB");
}

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function formatCompact(amount: number): string {
  const a = Math.abs(amount);
  const sign = amount < 0 ? "-" : "";
  if (a >= 1_000_000) return `${sign}£${(a / 1_000_000).toFixed(1)}m`;
  if (a >= 1_000) return `${sign}£${(a / 1_000).toFixed(0)}k`;
  return `${sign}£${Math.round(a)}`;
}
