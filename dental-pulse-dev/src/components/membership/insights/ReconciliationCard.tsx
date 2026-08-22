import { useState } from "react";
import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { gbp, nn } from "./format";
import type { ReconciliationMonthRow } from "./useReconciliationData";

// A variance under this is normal rounding noise (pence-level statement
// rounding, part-month payment timing) — not worth flagging red.
const VARIANCE_TOLERANCE_PCT = 2;

function varianceColor(row: ReconciliationMonthRow): string | undefined {
  if (row.variancePct == null) return undefined;
  return Math.abs(row.variancePct) > VARIANCE_TOLERANCE_PCT ? "var(--mpi-brick)" : undefined;
}

/** Statement-vs-Dentally monthly reconciliation — the "Dentally" leg of the
 *  client's 3-way net-cash reconciliation ask (Overview tab). Each row is a
 *  month with a Practice Plan statement; clicking it opens the real
 *  Dentally payment-method breakdown behind that month's total, since
 *  Dentally's method labels are practice-configured, not assumed. */
export function ReconciliationCard({ rows }: { rows: ReconciliationMonthRow[] }) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  if (rows.length === 0) return null;
  const expanded = rows.find((r) => `${r.year}-${r.month}` === expandedKey) ?? null;

  return (
    <div className="mpi-card">
      <p className="mpi-eyebrow">
        <span className="inline-flex items-center gap-1">
          Statement vs Dentally — monthly reconciliation
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="w-3 h-3 shrink-0 cursor-default" style={{ color: "var(--mpi-t3)" }} />
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[300px]">
                Your Practice Plan statement's own Total Collected, checked against every payment Dentally has
                recorded for that month's plan members (any payment method — click a row to see the breakdown).
                A gap means either Dentally hasn't had the payment posted to it yet, or the patient-matching
                missed someone. This doesn't check the bank itself — that's a separate, not-yet-built comparison
                to Xero.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </span>
      </p>
      <table className="mpi-tb">
        <thead>
          <tr>
            <th className="l">Month</th>
            <th>Statement</th>
            <th>Dentally</th>
            <th>Variance</th>
            <th>Matched patients</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const key = `${r.year}-${r.month}`;
            return (
              <tr
                key={key}
                onClick={() => setExpandedKey(key)}
                style={{ cursor: "pointer" }}
                title="Click for the Dentally payment-method breakdown"
              >
                <td className="l">{r.monthLabel}</td>
                <td>{gbp(r.statementCollected)}</td>
                <td>{gbp(r.dentallyTotal)}</td>
                <td style={{ color: varianceColor(r) }}>
                  {r.variance >= 0 ? "+" : "−"}
                  {gbp(Math.abs(r.variance))}
                  {r.variancePct != null && ` (${r.variancePct >= 0 ? "+" : ""}${r.variancePct}%)`}
                </td>
                <td>{nn(r.matchedPatients)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <Dialog open={expanded !== null} onOpenChange={(open) => { if (!open) setExpandedKey(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Dentally payments — {expanded?.monthLabel}</DialogTitle>
            <DialogDescription>
              {expanded ? `${gbp(expanded.dentallyTotal)} recorded across ${nn(expanded.matchedPatients)} matched patients, by payment method` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[50vh] overflow-y-auto pr-1">
            {expanded?.dentallyByMethod.map((m) => (
              <div
                key={m.method}
                className="flex items-center justify-between gap-2 text-sm py-1.5 border-b last:border-0"
                style={{ borderColor: "var(--mpi-line)" }}
              >
                <span className="font-medium">{m.method}</span>
                <span className="num">{gbp(m.amount)}</span>
              </div>
            ))}
            {expanded?.dentallyByMethod.length === 0 && (
              <p className="text-sm py-2" style={{ color: "var(--mpi-t3)" }}>
                No Dentally payments found for this month's plan members — check the collection has actually been
                posted to Dentally yet.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
