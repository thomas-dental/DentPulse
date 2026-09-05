import { useMemo, useState } from "react";
import { gbpExact, nn, formatDate } from "./format";
import type { MarginLineItem } from "./useMarginData";

const PAY_METHOD_SHORT: Record<MarginLineItem["payMethod"], string> = {
  "per-hour": "Per-hour",
  "flat-percentage": "%",
  "sliding-scale": "Sliding scale",
  "per-case": "Per-case",
  fallback: "Not configured*",
};

function VisitTable({
  title,
  providerLabel,
  rows,
  practiceTotalHours,
}: {
  title: string;
  /** Column header for the delivering provider's name — "Hygienist" or
   *  "Provider", matching which visit table this is. */
  providerLabel: string;
  rows: MarginLineItem[];
  /** Real whole-practice hours to place this table's total inside of (e.g.
   *  Hygienist Working Hours) — omitted when there's no such source. */
  practiceTotalHours?: number | null;
}) {
  const sorted = useMemo(
    () => [...rows].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")),
    [rows],
  );
  const totalMin = rows.reduce((s, r) => s + r.durationMin, 0);
  const totalCost = rows.reduce((s, r) => s + r.labourCost, 0);
  const hasEstimate = rows.some((r) => r.durationSource !== "real");
  const hasFallback = rows.some((r) => r.payMethod === "fallback");
  const totalHrs = totalMin / 60;

  if (rows.length === 0) {
    return (
      <div className="mpi-card">
        <p className="mpi-eyebrow">{title}</p>
        <div className="text-sm text-center py-4" style={{ color: "var(--mpi-t3)" }}>
          No visits this month.
        </div>
      </div>
    );
  }

  return (
    <div className="mpi-card">
      <p className="mpi-eyebrow">{title} · {nn(rows.length)} visit{rows.length === 1 ? "" : "s"}</p>
      {practiceTotalHours != null && practiceTotalHours > 0 && (
        <p className="mpi-subhead">
          Providers &gt; Hygienist &gt; Working Hours logged {practiceTotalHours.toFixed(1)} hrs total this month —
          the {totalHrs.toFixed(1)} hrs below is these plan members' share of that ({((totalHrs / practiceTotalHours) * 100).toFixed(1)}%).
        </p>
      )}
      <div style={{ maxHeight: 320, overflowY: "auto", overflowX: "auto", border: "1px solid var(--mpi-line)", borderRadius: "10px" }}>
        <table className="mpi-tb" style={{ minWidth: 560 }}>
          <thead>
            <tr>
              <th className="l">Member</th>
              <th className="l">{providerLabel}</th>
              <th className="l">Treatment</th>
              <th className="l">Date</th>
              <th>Minutes</th>
              <th className="l">Paid</th>
              <th>Cost</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((li, i) => (
              <tr key={i}>
                <td>{li.patientName}</td>
                <td className="sitecol">{li.providerName}</td>
                <td>{li.treatmentName}</td>
                <td className="sitecol">{formatDate(li.date)}</td>
                <td>
                  {li.durationMin}
                  {li.durationSource !== "real" && <sup>†</sup>}
                </td>
                <td className="sitecol" style={li.payMethod === "fallback" ? { color: "var(--mpi-amber)" } : undefined}>
                  {PAY_METHOD_SHORT[li.payMethod]}
                </td>
                <td>{gbpExact(li.labourCost)}</td>
              </tr>
            ))}
            <tr className="tot">
              <td>Total</td>
              <td className="sitecol" />
              <td className="sitecol" />
              <td className="sitecol" />
              <td>{nn(totalMin)}</td>
              <td className="sitecol" />
              <td>{gbpExact(totalCost)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {hasEstimate && (
        <p className="mpi-subhead" style={{ marginTop: "9px", marginBottom: 0 }}>
          † no recorded Dentally appointment length for this visit — minutes shown is a Treatment Setup estimate (or
          0 if neither exists); the £ is unaffected either way.
        </p>
      )}
      {hasFallback && (
        <p className="mpi-subhead" style={{ marginTop: "3px", marginBottom: 0 }}>
          * this provider's Split Configuration isn't fully set (their chosen method has no rate entered), so this
          visit is priced from Treatment Setup's generic rate instead. Fix it on their Contract details tab.
        </p>
      )}
    </div>
  );
}

/** The live, per-visit calculation behind Clinician time and Hygiene time —
 *  one row per real delivered treatment, grouped exactly like the ledger
 *  lines it proves, each its own full-width card (same shape as the other
 *  tables on this tab) with a Total row that reconciles to that ledger
 *  figure. This is the client's own patient list, not a summary. */
export function CostToServeDetail({
  lineItems,
  totalPracticeHygieneHours,
}: {
  lineItems: MarginLineItem[];
  totalPracticeHygieneHours?: number | null;
}) {
  const [open, setOpen] = useState(true);
  const clinicianRows = useMemo(() => lineItems.filter((li) => li.type === "clinician"), [lineItems]);
  const hygieneRows = useMemo(() => lineItems.filter((li) => li.type === "hygiene"), [lineItems]);

  return (
    <>
      <div className="flex items-center justify-between mpi-mb">
        <p className="mpi-eyebrow" style={{ margin: 0 }}>
          Every visit Clinician time and Hygiene time are built from
        </p>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: "12.5px",
            fontWeight: 500,
            color: "var(--mpi-accent, #5b5bd6)",
            padding: 0,
          }}
        >
          {open ? "Hide" : "Show"}
        </button>
      </div>

      {open && (
        lineItems.length === 0 ? (
          <div className="mpi-card text-sm text-center py-6 mpi-mb" style={{ color: "var(--mpi-t3)" }}>
            No delivered treatments this month to show.
          </div>
        ) : (
          <div className="mpi-two mpi-mb">
            <VisitTable title="Clinician visits" providerLabel="Provider" rows={clinicianRows} />
            <VisitTable title="Hygiene visits" providerLabel="Hygienist" rows={hygieneRows} practiceTotalHours={totalPracticeHygieneHours} />
          </div>
        )
      )}
    </>
  );
}
