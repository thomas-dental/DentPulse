import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ScopeBar } from "./ScopeBar";
import { nn } from "./format";
import { useCliniciansData } from "./useCliniciansData";

function toneColor(pct: number | null, goodAt: number, badAt: number): string | undefined {
  if (pct == null) return undefined;
  if (pct >= goodAt) return "var(--mpi-moss)";
  if (pct <= badAt) return "var(--mpi-brick)";
  return undefined;
}

export function CliniciansTab() {
  const d = useCliniciansData();

  // No full-tab loader — content renders straight away; the empty state
  // waits for loading to finish so it can't flash mid-fetch.
  if (!d.isLoading && !d.hasUploadData) {
    return (
      <div className="mpi space-y-6">
        <ScopeBar title="Clinicians" subtitle="Conversion, utilisation delivered and plan margin — per dentist" />
        <div className="mpi-card text-sm text-center py-8" style={{ color: "var(--mpi-t3)" }}>
          Upload membership data on the Plan Revenue tab to see this breakdown.
        </div>
      </div>
    );
  }

  return (
    <div className="mpi space-y-6">
      <ScopeBar title="Clinicians" subtitle="Conversion, utilisation delivered and plan margin — per dentist, same definitions" />

      <div className="mpi-card">
        <table className="mpi-tb">
          <thead>
            <tr>
              <th className="l">Dentist</th>
              <th className="l">Site</th>
              <th>Members</th>
              <th>New pts</th>
              <th>Joins</th>
              <th>Conversion</th>
              <th>Existing conv.</th>
              <th>
                <span className="inline-flex items-center gap-1">
                  Utilisation
                  <TooltipProvider delayDuration={200}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="w-3 h-3 shrink-0 cursor-default" style={{ color: "var(--mpi-t3)" }} />
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-[260px]">
                        % of this dentist's own plan members with a real appointment (any provider) in the last
                        6 months — are they turning up, not chair time booked.
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </span>
              </th>
              <th>
                <span className="inline-flex items-center gap-1">
                  Margin
                  <TooltipProvider delayDuration={200}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="w-3 h-3 shrink-0 cursor-default" style={{ color: "var(--mpi-t3)" }} />
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-[280px]">
                        (Membership revenue − allocated cost) ÷ revenue. Cost is your real accounting spend
                        (materials, lab, clinician time, overhead) for the period, split across dentists by their
                        plan members' share of all delivered treatment — not just their plan's covered visits, so
                        a member who also buys extra private treatment adds to cost here without adding to this
                        revenue figure. Shows "—" when no accounting platform is connected for this scope.
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {d.rows.map((r) => (
              <tr key={r.name}>
                <td>{r.name}</td>
                <td className="sitecol">{r.site ?? "—"}</td>
                <td>{nn(r.members)}</td>
                <td>{r.newPatients ?? "—"}</td>
                <td>{r.joins ?? "—"}</td>
                <td style={{ color: toneColor(r.conversionPct, 40, 22) }}>
                  {r.conversionPct != null ? `${r.conversionPct}%` : "—"}
                </td>
                <td style={{ color: toneColor(r.existingConversionPct, 15, 5) }}>
                  {r.existingConversionPct != null ? `${r.existingConversionPct}%` : "—"}
                </td>
                <td
                  style={{ color: toneColor(r.seenPct6m, 80, 50) }}
                  title={
                    r.seenPct6m != null
                      ? `${r.seenPct12m}% in the last 12 months · ${nn(r.unredeemedCount ?? 0)} not seen in 6 months`
                      : undefined
                  }
                >
                  {r.seenPct6m != null ? `${r.seenPct6m}%` : "—"}
                </td>
                <td>{r.marginPct != null ? `${r.marginPct}%` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {d.conversionGap ? (
        <div className="mpi-note n-info">
          <span className="mk">{d.conversionGap.best.conversionPct! - d.conversionGap.worst.conversionPct!}pts</span>
          <span className="tx">
            {d.conversionGap.best.name} converts {d.conversionGap.best.conversionPct}% of new patients onto a
            plan; {d.conversionGap.worst.name} converts {d.conversionGap.worst.conversionPct}%. Same price list —
            the gap is the conversation at the chair.
          </span>
        </div>
      ) : (
        <div className="mpi-note n-info">
          <span className="tx">
            New pts is real Dentally patient registrations under this dentist this period; Joins is the real
            new-patient-on-plan count from this dentist's own Practice Plan statement upload; Conversion is
            Joins ÷ New pts — the new-patient funnel. Existing conv. is the other funnel: of this dentist's own
            patients seen (completed appointment) this period who weren't already a plan member, the share who
            joined a plan during the period (patient_plan_membership_events) — NHS/private patients converting at
            the chair, not new joiners. Utilisation is entitlement redemption: the share of this dentist's own
            plan members with a real appointment (with any provider) in the last 6 months — are they actually
            turning up, not booked chair time. Site/New pts/Existing conv. only show for dentists matched by name
            to a Dentally provider record; Utilisation doesn't need that match — margin shows only where an
            uploaded plan is matched to a Dentally payment plan with treatment-cost data (see Plan Mapping).
          </span>
        </div>
      )}
    </div>
  );
}
