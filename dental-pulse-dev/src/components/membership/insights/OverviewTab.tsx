import { Button } from "@/components/ui/button";
import { Info } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useInsights } from "./InsightsProvider";
import { ScopeBar } from "./ScopeBar";
import { TrendChart } from "./TrendChart";
import { MiniSparkline } from "./MiniSparkline";
import { Stat } from "./Stat";
import { gbp, gbpExact, nn } from "./format";
import { useOverviewData } from "./useOverviewData";
import { useReconciliationData } from "./useReconciliationData";
import { ReconciliationCard } from "./ReconciliationCard";

function formatTrackingDate(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function Kv({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="mpi-kv">
      <span>{label}</span>
      <span className="num" style={color ? { color } : undefined}>
        {value}
      </span>
    </div>
  );
}

/** Table header cell with a "how is this worked out" ⓘ tooltip — same
 *  Info-icon + Tooltip pattern as Stat's own tooltip, for table columns. */
function ThTip({ label, tooltip }: { label: string; tooltip: string }) {
  return (
    <th>
      <span className="inline-flex items-center gap-1">
        {label}
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="w-3 h-3 shrink-0 cursor-default" style={{ color: "var(--mpi-t3)" }} />
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[260px]">
              {tooltip}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </span>
    </th>
  );
}

export function OverviewTab() {
  const { goToMembers } = useInsights();
  const d = useOverviewData();
  const reconciliation = useReconciliationData();

  // No full-tab loader — content renders straight away and figures fill in
  // as queries land. The empty state waits for loading to actually finish
  // so it can't flash mid-fetch.
  if (!d.isLoading && !d.hasUploadData) {
    return (
      <div className="mpi space-y-6">
        <ScopeBar title="Overview" subtitle="Plan-wise revenue, costs and members at a glance" />
        <div className="mpi-card text-sm text-center py-8" style={{ color: "var(--mpi-t3)" }}>
          Upload membership data on the Plan Revenue tab to see this overview.
        </div>
      </div>
    );
  }

  return (
    <div className="mpi space-y-6">
      <ScopeBar title="Overview" subtitle={d.monthLabel} />

      {(() => {
        // Month-over-month cash movement from the income trend series (last
        // two points share the axis the chart below draws).
        const t = d.cashTrendData;
        const cashDelta = t.length >= 2 ? t[t.length - 1].value - t[t.length - 2].value : null;
        const prevLabel = t.length >= 2 ? t[t.length - 2].label : null;
        // Gross-to-net gap = the two real deductions between what members
        // were charged and what reached the bank: the derived Practice Plan
        // fee plus failed collections.
        const gap = d.practicePlanFeeValue + d.failedValue;
        // Net plan cash / Gross to net gap / Plan share are each gated on
        // data from a different query, so while d.isLoading they're either
        // all absent or arrive at different moments — a tile would pop in
        // mid-render and jump the grid from 1-2 tiles to 4. Render stable
        // skeletons for the whole row until every query has actually landed,
        // then decide which tiles genuinely apply (no full-tab loader — this
        // only holds back the stat row itself, everything below still
        // renders progressively as before).
        if (d.isLoading) {
          return (
            <div className="mpi-stats">
              {[0, 1, 2, 3].map((i) => (
                <div className="mpi-stat" key={i}>
                  <div className="h-3 w-24 bg-muted animate-pulse rounded mb-2" />
                  <div className="h-6 w-20 bg-muted animate-pulse rounded mb-2" />
                  <div className="h-3 w-28 bg-muted animate-pulse rounded" />
                </div>
              ))}
            </div>
          );
        }
        return (
        <div className="mpi-stats">
          <Stat
            k="Net plan cash"
            v={d.hasStatementData ? gbp(d.netCash) : "—"}
            note={
              !d.hasStatementData
                ? "no Practice Plan statement uploaded yet"
                : cashDelta != null
                  ? `${cashDelta >= 0 ? "+" : "−"}${gbp(Math.abs(cashDelta))} vs ${prevLabel}`
                  : "collected this month"
            }
            tone={d.hasStatementData && cashDelta != null ? (cashDelta >= 0 ? "up" : "down") : undefined}
            tooltip={
              d.hasStatementData
                ? undefined
                : "Upload a Practice Plan PDF statement on the Plan Revenue tab to see net cash collected."
            }
            calc={
              d.hasStatementData
                ? [
                    {
                      label: `Total Collected, ${d.monthLabel} statement${d.isMultiMonth ? "s" : ""}`,
                      value: gbpExact(d.netCash),
                      isTotal: true,
                    },
                    ...(cashDelta != null && prevLabel
                      ? [
                          { label: prevLabel, value: gbpExact(d.netCash - cashDelta) },
                          { label: "= Change", value: `${cashDelta >= 0 ? "+" : "−"}${gbpExact(Math.abs(cashDelta))}` },
                        ]
                      : []),
                  ]
                : undefined
            }
          />
          <Stat
            k="Active members"
            v={nn(d.activeMembers)}
            note={
              d.monthNetMembers != null
                ? `${d.monthNetMembers >= 0 ? "+" : ""}${d.monthNetMembers} net this month`
                : "this month"
            }
            tone={d.monthNetMembers != null ? (d.monthNetMembers >= 0 ? "up" : "down") : undefined}
            calc={[
              {
                label: `Members collected ${d.isMultiMonth ? "across" : "on"} the ${d.monthLabel} statement${d.isMultiMonth ? "s" : ""}`,
                value: nn(d.activeMembers),
                isTotal: true,
              },
              ...(d.monthNetMembers != null
                ? [
                    { label: "Joined this month", value: nn(d.monthJoined ?? 0) },
                    { label: "− Cancelled", value: nn(d.monthLeft ?? 0) },
                    { label: "= Net change", value: `${d.monthNetMembers >= 0 ? "+" : ""}${d.monthNetMembers}` },
                  ]
                : []),
            ]}
          />
          <Stat
            k="Gross to net gap"
            v={d.hasStatementData ? gbp(gap) : "—"}
            note={d.hasStatementData ? `${gbp(gap * 12)} a year at this rate` : "no Practice Plan statement uploaded yet"}
            tooltip={
              d.hasStatementData
                ? undefined
                : "Upload a Practice Plan PDF statement on the Plan Revenue tab to see the gross-to-net gap."
            }
            calc={
              d.hasStatementData
                ? [
                    { label: "Practice Plan fee", value: gbpExact(d.practicePlanFeeValue) },
                    { label: "+ Failed collections", value: gbpExact(d.failedValue) },
                    { label: "= Gap this month", value: gbpExact(gap), isTotal: true },
                    { label: "× 12 months", value: gbpExact(gap * 12) },
                  ]
                : undefined
            }
          />
          <Stat
            k="Plan share of revenue"
            v={d.planSharePct != null ? `${d.planSharePct}%` : "—"}
            note={d.planSharePct != null ? `of ${gbp(d.totalRevenue)} total` : "no practice revenue for this period"}
            calc={[
              { label: "Membership net cash", value: gbpExact(d.netCash) },
              { label: "÷ Total practice revenue, selected period", value: gbpExact(d.totalRevenue) },
              { label: "= Plan share", value: d.planSharePct != null ? `${d.planSharePct}%` : "—", isTotal: true },
            ]}
          />
        </div>
        );
      })()}

      {(d.cashTrendData.length >= 2 || d.memberTrendData.length >= 2) && (
        <div className="mpi-two mpi-mb">
          {d.cashTrendData.length >= 2 && (
            <div className="mpi-card">
              {/* Labelled by the actual charted window — a hardcoded
                  "12 months" read as wrong whenever fewer months have data
                  or a custom range is selected. */}
              <p className="mpi-eyebrow">
                Net plan cash by month · {d.cashTrendData[0].label} – {d.cashTrendData[d.cashTrendData.length - 1].label}
              </p>
              <TrendChart data={d.cashTrendData} formatter={gbp} />
            </div>
          )}
          {d.memberTrendData.length >= 2 && (
            <div className="mpi-card">
              <p className="mpi-eyebrow">
                Active members by month · {d.memberTrendData[0].label} – {d.memberTrendData[d.memberTrendData.length - 1].label}
              </p>
              <TrendChart data={d.memberTrendData} formatter={nn} />
            </div>
          )}
        </div>
      )}

      {!d.hasStatementData && (
        <div className="mpi-card">
          <p className="mpi-eyebrow">Where the gross goes</p>
          <div className="text-sm text-center py-6" style={{ color: "var(--mpi-t3)" }}>
            Upload a Practice Plan PDF statement on the Plan Revenue tab to see the cash breakdown.
          </div>
        </div>
      )}

      {d.hasStatementData && (() => {
        // Real gross including the Practice Plan fee — this ribbon's own
        // total, distinct from d.grossValue (collected + failed, used
        // elsewhere on this page) since the fee sits between the two.
        const ribbonTotal = d.netCash + d.failedValue + d.practicePlanFeeValue;
        // Per-member fee over the members it was actually derived from
        // (monthly payers on monthly plans), not all uploaded members —
        // dividing by everyone would dilute the true per-member rate.
        const perMember =
          d.practicePlanFeeMemberCount > 0 ? d.practicePlanFeeValue / d.practicePlanFeeMemberCount : 0;
        return (
        <div className="mpi-card">
          <p className="mpi-eyebrow">Where the {gbp(ribbonTotal)} goes</p>
          <div className="mpi-ribbon">
            <i
              className="rb-net"
              style={{ width: `${ribbonTotal > 0 ? (d.netCash / ribbonTotal) * 100 : 0}%` }}
            >
              Net to bank {gbp(d.netCash)}
            </i>
            {d.practicePlanFeeValue > 0 && (
              <i
                className="rb-fee"
                style={{ width: `${(d.practicePlanFeeValue / ribbonTotal) * 100}%` }}
              >
                {gbp(d.practicePlanFeeValue)}
              </i>
            )}
            {d.failedValue > 0 && (
              <i
                className="rb-fail"
                style={{ width: `${(d.failedValue / ribbonTotal) * 100}%` }}
              />
            )}
          </div>
          <div className="mpi-ribkey">
            <div>
              <i className="mpi-sw" style={{ background: "var(--mpi-verd)" }} />
              Cleared to your account
            </div>
            {d.practicePlanFeeValue > 0 && (
              <div>
                <i className="mpi-sw" style={{ background: "var(--mpi-brick)" }} />
                Practice Plan · {gbpExact(perMember)} per member
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="w-3 h-3 shrink-0 cursor-default" style={{ color: "var(--mpi-t3)" }} />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[280px]">
                      {gbpExact(perMember)} (plan list price − amount collected, per member) ×{" "}
                      {nn(d.practicePlanFeeMemberCount)} monthly members ={" "}
                      {gbpExact(d.practicePlanFeeValue)}. Annual payers excluded — their payments don't
                      line up with monthly prices.
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            )}
            {d.failedValue > 0 && (
              <div>
                <i className="mpi-sw" style={{ background: "var(--mpi-amber)" }} />
                Failed collections {gbp(d.failedValue)}
              </div>
            )}
          </div>
        </div>
        );
      })()}

      <ReconciliationCard rows={reconciliation.rows} />

      {d.showLocationComparison && (() => {
        const totalMembers = d.locationComparison.reduce((s, r) => s + r.members, 0);
        const totalNet = d.locationComparison.reduce((s, r) => s + r.net, 0);
        const groupShare = d.totalRevenue > 0 ? Math.round((totalNet / d.totalRevenue) * 100) : null;
        // Sum only rows that resolved — a site whose EBITDA/FTE query hasn't
        // landed yet must not silently zero out the group total.
        const ebitdaRows = d.locationComparison.filter((r) => r.ebitda != null);
        const groupEbitda = ebitdaRows.length > 0 ? ebitdaRows.reduce((s, r) => s + (r.ebitda ?? 0), 0) : null;
        const fteRows = d.locationComparison.filter((r) => r.fte != null);
        const groupFte = fteRows.length > 0 ? fteRows.reduce((s, r) => s + (r.fte ?? 0), 0) : null;
        const groupMembersPerFte = groupFte && groupFte > 0 ? Math.round((totalMembers / groupFte) * 10) / 10 : null;
        return (
        <div className="mpi-card">
          <p className="mpi-eyebrow">Site comparison — same definitions across the group</p>
          {d.churnTrackingSince && (
            <p className="text-xs mb-2" style={{ color: "var(--mpi-t3)" }}>
              Churn tracked from real Dentally join/leave events since {formatTrackingDate(d.churnTrackingSince)}
              — recent, so treat it as an early signal rather than a stable annual rate.
            </p>
          )}
          <table className="mpi-tb">
            <thead>
              <tr>
                <th className="l">Site</th>
                <th className="l">12m</th>
                <th>Members</th>
                <th>Net cash</th>
                <th>Plan share</th>
                <ThTip
                  label="Per FTE"
                  tooltip="Plan members at this site ÷ full-time-equivalent clinicians actually working here over the selected period (their booked hours ÷ a standard 37.5-hour week)."
                />
                <ThTip
                  label="EBITDA"
                  tooltip="This site's profit for the selected period, from the Profit Benchmark page — the same figure shown on the Group Dashboard's Operating Profit tile."
                />
                <th>Churn</th>
              </tr>
            </thead>
            <tbody>
              {d.locationComparison.map((row) => (
                <tr key={row.locationId ?? "unassigned"}>
                  <td>{row.name}</td>
                  <td className="sitecol">
                    {row.trend.length >= 2 ? <MiniSparkline values={row.trend} /> : "—"}
                  </td>
                  <td>{nn(row.members)}</td>
                  <td>{gbp(row.net)}</td>
                  <td>{row.planSharePct != null ? `${row.planSharePct}%` : "—"}</td>
                  <td title={row.fte != null ? `${row.members} members ÷ ${row.fte.toFixed(2)} FTE` : undefined}>
                    {row.membersPerFte != null ? nn(row.membersPerFte) : "—"}
                  </td>
                  <td
                    style={row.ebitda != null && row.ebitda < 0 ? { color: "var(--mpi-brick)" } : undefined}
                    title={row.ebitdaPct != null ? `${row.ebitdaPct}% margin` : undefined}
                  >
                    {row.ebitda != null ? gbp(row.ebitda) : "—"}
                  </td>
                  <td>{row.churnPct != null ? `${row.churnPct}%` : "—"}</td>
                </tr>
              ))}
              <tr className="tot">
                <td>Group</td>
                <td className="sitecol">
                  {d.groupTrend.length >= 2 ? <MiniSparkline values={d.groupTrend} /> : "—"}
                </td>
                <td>{nn(totalMembers)}</td>
                <td>{gbp(totalNet)}</td>
                <td>{groupShare != null ? `${groupShare}%` : "—"}</td>
                <td title={groupFte != null ? `${totalMembers} members ÷ ${groupFte.toFixed(2)} FTE` : undefined}>
                  {groupMembersPerFte != null ? nn(groupMembersPerFte) : "—"}
                </td>
                <td style={groupEbitda != null && groupEbitda < 0 ? { color: "var(--mpi-brick)" } : undefined}>
                  {groupEbitda != null ? gbp(groupEbitda) : "—"}
                </td>
                <td>{d.churnPct != null ? `${d.churnPct}%` : "—"}</td>
              </tr>
            </tbody>
          </table>
        </div>
        );
      })()}

      {!d.showLocationComparison && d.churnTrackingSince && (
        <div className="mpi-card">
          <p className="mpi-eyebrow">Member churn</p>
          <p className="text-xs mb-2" style={{ color: "var(--mpi-t3)" }}>
            From real Dentally join/leave events since {formatTrackingDate(d.churnTrackingSince)} — recent, so
            treat it as an early signal rather than a stable annual rate.
          </p>
          <Kv label="Joined" value={nn(d.churnJoined)} />
          <Kv label="Left" value={nn(d.churnLeft)} color={d.churnLeft > 0 ? "var(--mpi-brick)" : undefined} />
          <Kv label="Churn" value={d.churnPct != null ? `${d.churnPct}%` : "—"} />
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-[11px]">
        <div className="mpi-card">
          <p className="mpi-eyebrow">Needs attention</p>
          <Kv
            label="Sleeping members, 12m no visit"
            value={nn(d.noVisitCount)}
            color={d.noVisitCount > 0 ? "var(--mpi-brick)" : undefined}
          />
          <Kv
            label="Arrears exposure"
            value={`${nn(d.arrearsCount)} · ${gbp(d.arrearsValue)}`}
            color={d.arrearsCount > 0 ? "var(--mpi-brick)" : undefined}
          />
          <Kv
            label="Failed collections"
            value={`${nn(d.failedCount)} · ${gbp(d.failedValue)}`}
            color={d.failedCount > 0 ? "var(--mpi-brick)" : undefined}
          />
          <Kv
            label="Archived in PMS, still paying"
            value={nn(d.archivedCount)}
            color={d.archivedCount > 0 ? "var(--mpi-brick)" : undefined}
          />
          <div className="mt-3">
            <Button
              size="sm"
              style={{ background: "var(--mpi-ink)", color: "#fff" }}
              onClick={() => goToMembers("at-risk")}
            >
              Open worklist
            </Button>
          </div>
        </div>
        <div className="mpi-card">
          <p className="mpi-eyebrow">Plan members by clinician</p>
          {d.clinicianBreakdown.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--mpi-t3)" }}>
              No treating dentist recorded on uploaded members.
            </p>
          ) : (
            <>
              {d.clinicianBreakdown.map((r) => (
                <Kv key={r.name} label={r.name} value={`${nn(r.members)} · ${gbp(r.value)}`} />
              ))}
              <div className="mpi-kv" style={{ borderTop: "1px solid var(--mpi-line)", fontWeight: 600 }}>
                <span>Total</span>
                <span className="num">
                  {nn(d.clinicianBreakdown.reduce((s, r) => s + r.members, 0))}
                  {" · "}
                  {gbp(d.clinicianBreakdown.reduce((s, r) => s + r.value, 0))}
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="mpi-note n-warn">
        <span className="mk num">{nn(d.dataGapsCount)}</span>
        <span className="tx">members can't be contacted or matched — missing email address or a placeholder date of birth.</span>
        <Button
          size="sm"
          variant="outline"
          className="ml-auto shrink-0"
          onClick={() => goToMembers("gaps")}
        >
          Fix
        </Button>
      </div>
    </div>
  );
}
