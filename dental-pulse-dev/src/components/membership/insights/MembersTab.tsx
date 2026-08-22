import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { useInsights, type MemberFilterKey } from "./InsightsProvider";
import { ScopeBar } from "./ScopeBar";
import { gbp, nn } from "./format";
import { useMembersWorklists, type WorklistRow, type SignalTone, type TenureBucket } from "./useMembersWorklists";
import { Bar } from "./Bar";

/** One real line — the tenure group with the highest at-risk share, since
 *  a true join-cohort survival rate can't be reconstructed (Dentally has
 *  no subscription-history endpoint; see useMembersWorklists.ts). */
function tenureSubhead(buckets: TenureBucket[]): string {
  const withCounts = buckets.filter((b) => b.count > 0);
  if (withCounts.length === 0) return "";
  const worst = withCounts.reduce((a, b) => (b.atRiskCount / b.count > a.atRiskCount / a.count ? b : a));
  const pct = Math.round((worst.atRiskCount / worst.count) * 100);
  return `By tenure group, not joining cohort — ${worst.label.toLowerCase()} has the highest at-risk share, ${pct}%`;
}

// Matches the reference design's five worklist chips exactly.
const FILTER_LABEL: Record<MemberFilterKey, string> = {
  "at-risk": "At risk",
  sleeping: "Sleeping",
  arrears: "Arrears",
  upgrade: "Upgrade",
  gaps: "Data gaps",
};
const FILTER_KEYS: MemberFilterKey[] = ["at-risk", "sleeping", "arrears", "upgrade", "gaps"];

// Tag colour by signal tone (each row carries its own signal + tone from
// useMembersWorklists — set via inline style rather than the .t-risk/
// .t-warn/.t-info classes: `.mpi-why span`'s own color/display rules
// outrank those classes on specificity, same as ScenariosTab's tag).
const TONE_COLOR: Record<SignalTone, { bg: string; fg: string }> = {
  risk: { bg: "var(--mpi-brick-soft)", fg: "var(--mpi-brick)" },
  warn: { bg: "var(--mpi-amber-soft)", fg: "var(--mpi-amber)" },
  info: { bg: "var(--mpi-verd-soft)", fg: "var(--mpi-verd-deep)" },
  good: { bg: "var(--mpi-moss-soft)", fg: "var(--mpi-moss)" },
};

const ROW_COLUMNS = "1.5fr 0.5fr 1.6fr 0.55fr 0.55fr";

/** "Risk" column text — a real observed quantity (days overdue or £ of
 *  private spend), never a fabricated 0-100 score. */
function metricLabel(row: WorklistRow): string {
  if (row.metric == null) return "—";
  return row.metricUnit === "gbp" ? gbp(row.metric) : `${nn(row.metric)}d`;
}

function exportCsv(filterKey: MemberFilterKey, rows: WorklistRow[]) {
  const header = ["Member", "Member ID / dentist", "Plan", "Signal", "Detail", "Value", "Risk"];
  const lines = rows.map((m) => [
    m.name,
    m.subtitle ?? "",
    m.plan ?? "",
    m.signal,
    m.detail,
    m.amount != null ? m.amount.toFixed(2) : "",
    metricLabel(m),
  ]);
  const csv = [header, ...lines]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filterKey}-members.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function MembersTab() {
  const { membersFilter, setMembersFilter } = useInsights();
  const w = useMembersWorklists();

  // No full-tab loader — content renders straight away; the empty state
  // waits for loading to finish so it can't flash mid-fetch.
  if (!w.isLoading && !w.hasUploadData) {
    return (
      <div className="mpi space-y-6">
        <ScopeBar title="Members" subtitle="At-risk, sleeping, arrears, upgrade candidates and data gaps" />
        <div className="mpi-card text-sm text-center py-8" style={{ color: "var(--mpi-t3)" }}>
          Upload membership data on the Plan Revenue tab to see member worklists.
        </div>
      </div>
    );
  }

  const list = w.rows[membersFilter];

  return (
    <div className="mpi space-y-6">
      <ScopeBar
        title="Members"
        subtitle="Joiners, leavers and tenure derived from weekly snapshots — Practice Plan records none of them"
        action={
          <Button variant="outline" size="sm" disabled={list.length === 0} onClick={() => exportCsv(membersFilter, list)}>
            <Download className="w-4 h-4 mr-2" />
            Export CSV
          </Button>
        }
      />

      {(() => {
        const hasTenureBars = w.tenureBuckets.length > 0 && w.tenureBuckets.some((b) => b.count > 0);
        return (
          <div className="mpi-card">
            <p className="mpi-eyebrow">Cohort survival — each joining month tracked forward</p>
            {hasTenureBars && (
              <>
                <p className="mpi-subhead">{tenureSubhead(w.tenureBuckets)}</p>
                <div className="mpi-bars">
                  {w.tenureBuckets.map((b) => {
                    const healthyPct = b.count > 0 ? ((b.count - b.atRiskCount) / b.count) * 100 : 0;
                    return (
                      <Bar
                        key={b.label}
                        label={b.label}
                        segments={[
                          { pct: healthyPct, color: "var(--mpi-verd)" },
                          { pct: 100 - healthyPct, color: "var(--mpi-brick)" },
                        ]}
                        value={b.count > 0 ? `${Math.round(healthyPct)}%` : "—"}
                      />
                    );
                  })}
                </div>
              </>
            )}
          </div>
        );
      })()}

      <div className="mpi-chips">
        {FILTER_KEYS.map((f) => {
          if (f === "arrears" && !w.hasStatementData) return null;
          return (
            <button
              key={f}
              type="button"
              className="mpi-chip"
              aria-pressed={membersFilter === f}
              onClick={() => setMembersFilter(f)}
            >
              {FILTER_LABEL[f]}
              <b className="num">{nn(w.counts[f])}</b>
            </button>
          );
        })}
      </div>

      <div className="mpi-rows">
        <div className="mpi-rowhead" style={{ gridTemplateColumns: ROW_COLUMNS }}>
          <span>Member</span>
          <span>Plan</span>
          <span>Signal</span>
          <span style={{ textAlign: "right" }}>Value</span>
          <span style={{ textAlign: "right" }}>Risk</span>
        </div>
        {list.length ? (
          list.map((m) => {
            const tone = TONE_COLOR[m.signalTone];
            const overdueColor = m.metricUnit === "days" && (m.metric ?? 0) >= 365 ? "var(--mpi-brick)" : undefined;
            return (
              <div className="mpi-row" key={m.id} style={{ gridTemplateColumns: ROW_COLUMNS }}>
                <div className="mpi-who">
                  {m.patientUuid ? (
                    <a
                      href={`https://app.dentally.co/patients/${m.patientUuid}/appointments`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Open this patient's appointments in Dentally"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <b>{m.name}</b>
                    </a>
                  ) : (
                    <b>{m.name}</b>
                  )}
                  {m.subtitle && <span>{m.subtitle}</span>}
                </div>
                <div className="mpi-pl" style={{ color: "var(--mpi-t2)" }}>
                  {m.plan ?? "—"}
                </div>
                <div className="mpi-why">
                  <span className="mpi-tag" style={{ display: "inline-block", background: tone.bg, color: tone.fg }}>
                    {m.signal}
                  </span>
                  <span>{m.detail}</span>
                </div>
                <div className="mpi-rt num">{m.amount != null ? gbp(m.amount) : "—"}</div>
                <div className="mpi-score num" style={overdueColor ? { color: overdueColor } : undefined}>
                  {metricLabel(m)}
                </div>
              </div>
            );
          })
        ) : (
          <div className="p-8 text-center text-sm" style={{ color: "var(--mpi-t3)" }}>
            Nothing here. Every member in this group is up to date.
          </div>
        )}
      </div>

      <div className="flex items-center justify-between mt-3 text-xs" style={{ color: "var(--mpi-t3)" }}>
        <span>
          Showing {list.length} of {nn(w.counts[membersFilter])} {FILTER_LABEL[membersFilter].toLowerCase()} members
        </span>
        <Button variant="outline" size="sm">
          Assign to practice manager
        </Button>
      </div>
    </div>
  );
}
