import { useState } from "react";
import {
  Area,
  AreaChart,
  Bar as RechartsBar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useFilters } from "@/contexts/FilterContext";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScopeBar } from "./ScopeBar";
import { Stat } from "./Stat";
import { Bar } from "./Bar";
import { nn } from "./format";
import { useCapacityData, type CapacityData, type RedemptionBuckets, type RedemptionMember } from "./useCapacityData";

const CHART_TOOLTIP_STYLE = {
  background: "var(--mpi-surface)",
  border: "1px solid var(--mpi-line)",
  borderRadius: 8,
  fontSize: 12,
} as const;

/** Hygiene wait time and leavers, side by side over the same 12 real
 *  calendar months — deliberately two single-axis small multiples sharing
 *  one x-domain, not one dual-axis chart (different units, different
 *  scales), so a reader can still see the two move together by eye without
 *  a misleading combined scale. */
function HygieneChurnTrend({ trend }: { trend: CapacityData["hygieneChurnTrend"] }) {
  const hasWait = trend.some((p) => p.waitWeeks != null);
  const hasLeavers = trend.some((p) => p.leavers != null);
  if (!hasWait && !hasLeavers) return null;
  return (
    <div className="mpi-two mpi-mb">
      <div className="mpi-card">
        <p className="mpi-eyebrow">Hygiene wait time · 12 months</p>
        <div style={{ width: "100%", height: 160 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={trend} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
              <defs>
                <linearGradient id="mpiWaitFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--mpi-brick)" stopOpacity={0.18} />
                  <stop offset="100%" stopColor="var(--mpi-brick)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--mpi-line)" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={30} tickFormatter={(v) => `${v}w`} />
              <RechartsTooltip
                contentStyle={CHART_TOOLTIP_STYLE}
                formatter={(v: number) => [`${v}w`, "Wait"]}
                labelFormatter={(_, payload) => payload?.[0]?.payload?.fullLabel ?? ""}
              />
              <Area
                type="monotone"
                dataKey="waitWeeks"
                stroke="var(--mpi-brick)"
                strokeWidth={2}
                fill="url(#mpiWaitFill)"
                dot={false}
                activeDot={{ r: 3.5 }}
                connectNulls={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="mpi-card">
        <p className="mpi-eyebrow">Leavers · 12 months</p>
        <div style={{ width: "100%", height: 160 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={trend} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--mpi-line)" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} width={30} />
              <RechartsTooltip
                contentStyle={CHART_TOOLTIP_STYLE}
                formatter={(v: number) => [v, "Leavers"]}
                labelFormatter={(_, payload) => payload?.[0]?.payload?.fullLabel ?? ""}
              />
              <RechartsBar dataKey="leavers" fill="var(--mpi-amber)" radius={[4, 4, 0, 0]} maxBarSize={22} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

// #F0EEE9 is the mockup's own literal track color for these two bar cards
// (distinct from --mpi-line, #E4E2DC, used elsewhere) — kept literal to
// match exactly rather than reusing a token with a slightly different value.
const REDEMPTION_TRACK = "#F0EEE9";

type RedemptionKind = "hygiene" | "exam" | "xray";
type RedemptionBucket = "none" | "partial" | "full";
interface RedemptionDrilldown {
  kind: RedemptionKind;
  bucket: RedemptionBucket;
  label: string;
}

function redemptionBars(
  buckets: RedemptionBuckets,
  labels: [string, string, string],
  kind: RedemptionKind,
  onSelect: (d: RedemptionDrilldown) => void,
) {
  const total = buckets.none + buckets.partial + buckets.full;
  if (total === 0) return null;
  const rows: Array<{ label: string; bucket: RedemptionBucket; count: number; color: string }> = [
    { label: labels[0], bucket: "none", count: buckets.none, color: "var(--mpi-brick)" },
    { label: labels[1], bucket: "partial", count: buckets.partial, color: "var(--mpi-amber)" },
    { label: labels[2], bucket: "full", count: buckets.full, color: "var(--mpi-verd)" },
  ];
  return rows.map((r) => (
    <Bar
      key={r.label}
      label={r.label}
      segments={[
        { pct: (r.count / total) * 100, color: r.color },
        { pct: 100 - (r.count / total) * 100, color: REDEMPTION_TRACK },
      ]}
      value={nn(r.count)}
      onClick={r.count > 0 ? () => onSelect({ kind, bucket: r.bucket, label: r.label }) : undefined}
    />
  ));
}

function RedemptionMemberRow({ m }: { m: RedemptionMember }) {
  const detail = `${nn(m.redeemed)} of ${nn(m.entitled)} redeemed`;
  return (
    <div className="flex items-center justify-between gap-2 text-sm py-1.5 border-b last:border-0" style={{ borderColor: "var(--mpi-line)" }}>
      {m.patientUuid ? (
        <a
          href={`https://app.dentally.co/patients/${m.patientUuid}/appointments`}
          target="_blank"
          rel="noopener noreferrer"
          title="Open this patient's appointments in Dentally"
          className="font-medium hover:underline"
          style={{ color: "var(--mpi-verd)" }}
        >
          {m.name}
        </a>
      ) : (
        <span className="font-medium">{m.name}</span>
      )}
      <span style={{ color: "var(--mpi-t3)" }}>{detail}</span>
    </div>
  );
}

export function CapacityTab() {
  const d = useCapacityData();
  const { selectedLocationId } = useFilters();
  const [drilldown, setDrilldown] = useState<RedemptionDrilldown | null>(null);
  const drilldownMembers = drilldown
    ? (drilldown.kind === "hygiene"
        ? d.hygieneRedemptionMembers
        : drilldown.kind === "exam"
          ? d.examRedemptionMembers
          : d.xrayRedemptionMembers
      ).filter((m) => m.bucket === drilldown.bucket)
    : [];

  // No full-tab loader — content renders straight away and figures fill in
  // as queries land. The empty state waits for loading to actually finish
  // so it can't flash mid-fetch.
  if (!d.isLoading && !d.hasData) {
    return (
      <div className="mpi space-y-6">
        <ScopeBar title="Capacity" subtitle="Hygiene, exam and xray supply against the entitlement your plans have already sold" />
        <div className="mpi-card text-sm text-center py-8" style={{ color: "var(--mpi-t3)" }}>
          No chair activity for the selected period.
        </div>
      </div>
    );
  }

  return (
    <div className="mpi space-y-6">
      <ScopeBar title="Capacity" subtitle="Hygiene and exam supply against the entitlement your plans have already sold" />

      <div className="mpi-stats">
        <Stat
          k="Hygiene hours booked"
          v={d.hygieneBookedPct == null ? "—" : `${d.hygieneBookedPct}%`}
          note={d.hygieneBookedPct == null ? "no hygienist providers" : `${nn(d.hygieneBookedHours)} of ${nn(d.hygieneAvailableHours)} available`}
          tooltip="Same formula as the Hygienist Management page's Avg Utilisation tile: total booked hygienist appointment minutes ÷ (hygienists × working days × hours/day × 60)."
        />
        <Stat
          k="Time to next slot"
          v={d.waitWeeks == null ? "—" : `${d.waitWeeks.toFixed(1)}w`}
          note={d.waitWeeks == null ? "no recent hygiene bookings" : d.waitWeeks > 8 ? "beyond patient patience" : "within reach"}
          tone={d.waitWeeks != null && d.waitWeeks > 8 ? "down" : undefined}
          tooltip="Proxy, not live availability (this app has no schedule feed): median gap between when a hygienist appointment was booked and when it took place, over hygienist appointments booked in the last 8 weeks."
        />
        <Stat
          k="Short-notice loss"
          v={`${d.shortNoticeLossPct}%`}
          note="failed to attend or cancelled"
          tone={d.shortNoticeLossPct > 10 ? "down" : undefined}
          tooltip={`${nn(d.lostAppointments)} cancelled or not attended ÷ ${nn(d.totalAppointments)} booked = ${d.shortNoticeLossPct}%`}
        />
        {d.matchedPlanMembers > 0 && (
          <Stat
            k="Visits owed a year"
            v={nn(d.visitsOwedAYear)}
            note={`${nn((d.hygieneRedemption?.none ?? 0) + (d.hygieneRedemption?.partial ?? 0) + (d.hygieneRedemption?.full ?? 0))} hygiene · ${nn((d.examRedemption?.none ?? 0) + (d.examRedemption?.partial ?? 0) + (d.examRedemption?.full ?? 0))} exam · ${nn((d.xrayRedemption?.none ?? 0) + (d.xrayRedemption?.partial ?? 0) + (d.xrayRedemption?.full ?? 0))} xray plans`}
            tooltip="Sum of each matched plan member's included exam + hygiene + xray visits for the year, from their plan's entitlement settings."
          />
        )}
        {d.matchedPlanMembers > 0 && (
          <Stat
            k="Seen in 6 months"
            v={d.seenPct6m == null ? "—" : `${d.seenPct6m}%`}
            note={d.seenPct12m == null ? "of matched plan members" : `${d.seenPct12m}% in the last 12 months`}
            tone={d.seenPct6m != null && d.seenPct6m < 50 ? "down" : undefined}
            tooltip="Matched plan members with any real (non-cancelled, non-DNA) Dentally appointment in the last 6 / 12 months — are they actually turning up, not just paying."
          />
        )}
      </div>

      {(d.hygieneRedemption || d.examRedemption || d.xrayRedemption) && (
        <div className="mpi-three mpi-mb">
          <div className="mpi-card">
            <p className="mpi-eyebrow">Hygiene redeemed</p>
            <p className="mpi-subhead">
              Hygiene visits owed · {nn((d.hygieneRedemption?.none ?? 0) + (d.hygieneRedemption?.partial ?? 0) + (d.hygieneRedemption?.full ?? 0))} members
            </p>
            <div className="mpi-bars">
              {d.hygieneRedemption &&
                redemptionBars(d.hygieneRedemption, ["Neither visit", "One of two", "Both visits"], "hygiene", setDrilldown)}
            </div>
          </div>
          <div className="mpi-card">
            <p className="mpi-eyebrow">Exams redeemed</p>
            <p className="mpi-subhead">
              Exams owed · {nn((d.examRedemption?.none ?? 0) + (d.examRedemption?.partial ?? 0) + (d.examRedemption?.full ?? 0))} members
            </p>
            <div className="mpi-bars">
              {d.examRedemption &&
                redemptionBars(d.examRedemption, ["Neither exam", "One of two", "Both exams"], "exam", setDrilldown)}
            </div>
          </div>
          <div className="mpi-card">
            <p className="mpi-eyebrow">Xray redeemed</p>
            <p className="mpi-subhead">
              Xray visits owed · {nn((d.xrayRedemption?.none ?? 0) + (d.xrayRedemption?.partial ?? 0) + (d.xrayRedemption?.full ?? 0))} members
            </p>
            <div className="mpi-bars">
              {d.xrayRedemption &&
                redemptionBars(d.xrayRedemption, ["Neither visit", "One of two", "Both visits"], "xray", setDrilldown)}
            </div>
          </div>
        </div>
      )}

      {d.byLocation.length > 1 && (
        <div className="mpi-card">
          <p className="mpi-eyebrow">Capacity by site — wait time tracks churn</p>
          <table className="mpi-tb">
            <thead>
              <tr>
                <th className="l">Site</th>
                <th>Booked</th>
                <th>Wait</th>
                <th>FTA</th>
                <th>No hygiene</th>
                <th>No exam</th>
                <th>No xray</th>
                <th>Churn</th>
              </tr>
            </thead>
            <tbody>
              {d.byLocation.map((row) => (
                <tr key={row.locationId}>
                  <td>{row.name}</td>
                  <td>{row.bookedPct == null ? "—" : `${row.bookedPct}%`}</td>
                  <td style={row.waitWeeks != null && row.waitWeeks > 8 ? { color: "var(--mpi-brick)" } : undefined}>
                    {row.waitWeeks == null ? "—" : `${row.waitWeeks.toFixed(1)}w`}
                  </td>
                  <td>{row.shortNoticeLossPct == null ? "—" : `${row.shortNoticeLossPct}%`}</td>
                  <td>{row.noHygiene == null ? "—" : nn(row.noHygiene)}</td>
                  <td>{row.noExam == null ? "—" : nn(row.noExam)}</td>
                  <td>{row.noXray == null ? "—" : nn(row.noXray)}</td>
                  <td>{row.churnPct == null ? "—" : `${row.churnPct}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <HygieneChurnTrend trend={d.hygieneChurnTrend} />

      {(() => {
        const zeroRedemption = (d.hygieneRedemption?.none ?? 0) + (d.examRedemption?.none ?? 0) + (d.xrayRedemption?.none ?? 0);
        if (zeroRedemption === 0) return null;
        if (d.hygieneBookedPct != null && d.hygieneBookedPct >= 85) {
          return (
            <div className="mpi-note n-bad">
              <span className="mk num">{d.hygieneBookedPct}%</span>
              <span className="tx">
                {selectedLocationId ? "This site is" : "The group is"} {d.hygieneBookedPct}% booked. {nn(zeroRedemption)} members have redeemed nothing —
                they can't get in, not won't. Adding sessions is a retention decision, not a cost.
              </span>
            </div>
          );
        }
        if (d.hygieneBookedPct != null && d.hygieneBookedPct < 50) {
          return (
            <div className="mpi-note n-warn">
              <span className="mk num">{nn(zeroRedemption)}</span>
              <span className="tx">
                There's spare hygiene capacity, but {nn(zeroRedemption)} members have redeemed nothing. Nobody is
                being asked to book. That's a recall problem, not a capacity one.
              </span>
            </div>
          );
        }
        return (
          <div className="mpi-note n-warn">
            <span className="mk num">{nn(zeroRedemption)}</span>
            <span className="tx">
              members have redeemed nothing this year. Best margin today, highest churn risk at renewal.
            </span>
          </div>
        );
      })()}

      <div className="mpi-note n-info">
        <span className="tx">
          Entitlement redemption (hygiene/exam/xray visits owed vs. taken) and hygiene booked-time match the
          Hygienist Management page for the same period, matched plan members only, trailing 12 months.
          Exam/hygiene/xray visits are identified by a best-effort keyword match against each treatment's name
          and category — Dentally's own category names vary per practice, so this can misclassify
          unusually-named treatments; xray entitlement is set manually in Settings, since Dentally has no
          synced x-ray entitlement field at all. Time to next slot and Wait are a proxy, not live availability — this app has no schedule
          feed, so they show the median gap between when a hygienist appointment was booked and when it took
          place, over the last 8 weeks of bookings, not a true next-available slot. The Hygiene wait time chart
          uses the same gap, bucketed by the month each appointment actually happened rather than a rolling
          8-week window, so it has a real value per month; Leavers is the same real monthly figure as the Plan
          Revenue tab's own Leavers chart (Practice Plan statement cancellations). Only shown for Practice
          Plan orgs — leavers has no equivalent signal in a Denplan sheet upload.
        </span>
      </div>

      <Dialog open={drilldown !== null} onOpenChange={(open) => { if (!open) setDrilldown(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {drilldown &&
                (drilldown.kind === "hygiene" ? "Hygiene redeemed" : drilldown.kind === "exam" ? "Exams redeemed" : "Xray redeemed")}{" "}
              — {drilldown?.label}
            </DialogTitle>
            <DialogDescription>
              {nn(drilldownMembers.length)} member{drilldownMembers.length === 1 ? "" : "s"} · click a name to open their
              appointments in Dentally
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto pr-1">
            {drilldownMembers.map((m) => (
              <RedemptionMemberRow key={m.id} m={m} />
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
