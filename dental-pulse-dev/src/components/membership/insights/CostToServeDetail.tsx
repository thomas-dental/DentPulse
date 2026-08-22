import { useMemo, useState } from "react";
import { gbpExact, nn, formatDate } from "./format";
import { LedgerLabel } from "./LedgerLabel";
import type { MarginLineItem } from "./useMarginData";

const PAY_METHOD_SHORT: Record<MarginLineItem["payMethod"], string> = {
  "per-hour": "Per-hour",
  "flat-percentage": "%",
  "sliding-scale": "Sliding scale",
  "per-case": "Per-case",
  // A %-split IS configured — it just derived £0 this month (their treated
  // plan members' fees didn't cover their plan work's lab/material cost),
  // so this visit priced from Treatment Setup instead. Distinct from "Not
  // configured": calling configured providers unconfigured read as a bug.
  "percent-zero": "% of £0 rev*",
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
  const hasFallback = rows.some((r) => r.payMethod === "fallback" || r.payMethod === "percent-zero");
  const totalHrs = totalMin / 60;

  if (rows.length === 0) {
    return (
      <div className="mpi-card">
        <p className="mpi-eyebrow">{title}</p>
        <div className="text-sm text-center py-4" style={{ color: "var(--mpi-t3)" }}>
          No visits in the selected period.
        </div>
      </div>
    );
  }

  return (
    <div className="mpi-card">
      <p className="mpi-eyebrow">{title} · {nn(rows.length)} visit{rows.length === 1 ? "" : "s"}</p>
      {/* Always rendered (even with nothing to show) and reserved to a fixed
       *  2-line height so the Clinician card — which never gets this subhead
       *  — still takes up the exact same header height as the Hygiene card.
       *  Without this, Hygiene's real 2-line note pushes its table down
       *  relative to Clinician's, and every row between the two side-by-side
       *  tables goes visibly out of alignment. */}
      <p
        className="mpi-subhead"
        style={{ minHeight: "3em", visibility: practiceTotalHours != null && practiceTotalHours > 0 ? "visible" : "hidden" }}
      >
        {practiceTotalHours != null && practiceTotalHours > 0 && (
          <>
            Providers &gt; Hygienist &gt; Working Hours logged {practiceTotalHours.toFixed(1)} hrs total in this period —
            the {totalHrs.toFixed(1)} hrs below is these plan members' share of that ({((totalHrs / practiceTotalHours) * 100).toFixed(1)}%).
          </>
        )}
      </p>
      <div
        style={{
          maxHeight: 320,
          overflowY: "auto",
          overflowX: "auto",
          border: "1px solid var(--mpi-line)",
          borderRadius: "10px",
          // Reserves the scrollbar's own track so it never sits flush
          // against the Cost column's value + ⓘ icon — without this the
          // native scrollbar overlaps the last column's padding instead of
          // living outside it.
          scrollbarGutter: "stable",
        }}
      >
        <table className="mpi-tb mpi-tb-roomy" style={{ minWidth: 640 }}>
          <thead>
            <tr>
              <th className="l">Member</th>
              <th className="l">Plan dentist</th>
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
                <td className="sitecol">{li.planDentist ?? "—"}</td>
                <td className="sitecol">{li.providerName}</td>
                <td>{li.treatmentName}</td>
                <td className="sitecol">{formatDate(li.date)}</td>
                <td>
                  {Math.round(li.durationMin * 10) / 10}
                  {li.durationSource !== "real" && <sup>†</sup>}
                </td>
                <td
                  className="sitecol"
                  style={li.payMethod === "fallback" || li.payMethod === "percent-zero" ? { color: "var(--mpi-amber)" } : undefined}
                >
                  {PAY_METHOD_SHORT[li.payMethod]}
                </td>
                <td><LedgerLabel label={gbpExact(li.labourCost)} calc={li.calc} /></td>
              </tr>
            ))}
            <tr className="tot">
              <td>Total</td>
              <td className="sitecol" />
              <td className="sitecol" />
              <td className="sitecol" />
              <td className="sitecol" />
              <td>{nn(Math.round(totalMin))}</td>
              <td className="sitecol" />
              <td>{gbpExact(totalCost)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {hasEstimate && (
        <p className="mpi-subhead" style={{ marginTop: "9px", marginBottom: 0 }}>
          † no recorded Dentally appointment window for this visit — minutes shown come from the membership
          Treatments tab's configured time, else a Treatment Setup estimate (or 0 if none exists). Visits WITH
          a recorded window show their share of that appointment's real start-to-finish time — when several
          treatments were delivered in one appointment, its time is divided between them, never counted twice.
        </p>
      )}
      {hasFallback && (
        <p className="mpi-subhead" style={{ marginTop: "3px", marginBottom: 0 }}>
          * this visit is priced from Treatment Setup's generic rate instead of the provider's own split.
          "Not configured" = their chosen method has no rate entered (fix it on their Contract details tab).
          "% of £0 rev" = their %-split IS configured but produced nothing in the period — the fees of
          the plan members they treated didn't cover their plan work's lab/material cost, so their percentage
          of it is nothing. A labour cost is never shown as negative.
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
            No delivered treatments in the selected period to show.
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
