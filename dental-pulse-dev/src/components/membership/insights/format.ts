/** Self-contained formatters for the Membership Plan Insights preview tabs.
 *  Deliberately NOT shared with MembershipPerformance.tsx so this module has
 *  zero coupling to the existing page's code. */

/** Sign placed BEFORE the £ symbol (not "£-1,039.42") — with
 *  font-variant-numeric: tabular-nums on these table cells, a minus sign
 *  immediately after "£" gets its own padded digit-width slot, rendering as
 *  a visible gap ("£ -1,039"); leading with the sign keeps that padding at
 *  the start of the cell instead, invisible against the right-aligned edge.
 *  Always pence-exact (client rule 2026-08-19: never round £ off in this
 *  module — figures must reconcile against the statement to the penny). */
export function gbp(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  return `${sign}£${Math.abs(amount).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Pence-precision £ — for small per-member figures where rounding to whole
 *  pounds (gbp) would misstate the number (£1.41 → "£1"). */
export function gbpExact(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  return `${sign}£${Math.abs(amount).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Sub-penny £ — for per-minute rates, where even two decimals collapse a
 *  real number to "£0.00" (e.g. −£0.0081/min). Shows up to 4 decimals but
 *  never fewer than 2, so ordinary amounts still read like money. */
export function gbpRate(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  return `${sign}£${Math.abs(amount).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
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
