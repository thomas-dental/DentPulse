import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { Lock } from "lucide-react";
import { MainLayout } from "@/components/layout/MainLayout";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useFilters } from "@/contexts/FilterContext";
import { useLocations } from "@/hooks/useLocations";
import { toLocalYMD } from "@/utils/dateRangeUtils";
import {
  useGroupDashboardData,
  CASH_COVER_TARGET,
  REVENUE_TARGET_STATIC,
  type GroupSiteRow,
} from "@/hooks/useGroupDashboardData";
import { GroupTrendChart } from "@/components/group-dashboard/GroupTrendChart";
import { GroupCashRunway } from "@/components/group-dashboard/GroupCashRunway";
import { GroupAcquisitionRamp } from "@/components/group-dashboard/GroupAcquisitionRamp";
import { ActionCenter } from "@/components/group-dashboard/ActionCenter";
import { computeBreakEvenSales } from "@/utils/breakEvenSales";
import { useOrganizationSettings } from "@/hooks/useOrganizationSettings";
import { formatCurrency } from "@/lib/currency";
import "./GroupDashboard.css";

/** Set true when covenant / acquisition feeds are ready to show on the dashboard. */
const SHOW_DEBT_AND_DEALS = false;

/* ── formatting helpers ────────────────────────────────────────────── */

/** Big tile number with a smaller unit suffix, mockup-style.
 *  ≥ £1m → £Xm · under £1m → £Xk · else plain £. */
function TileValue({
  v,
  suffix,
}: {
  v: number | null | undefined;
  suffix?: string;
}) {
  if (v == null) return <div className="tval">—</div>;
  const a = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (a >= 1_000_000) {
    const m = a / 1_000_000;
    const label = String(Math.round(m));
    return (
      <div className="tval">
        {sign}£{label}
        <span className="u">m</span>
        {suffix}
      </div>
    );
  }
  if (a >= 1_000) {
    const k = a / 1000;
    const label = String(Math.round(k));
    return (
      <div className="tval">
        {sign}£{label}
        <span className="u">k</span>
        {suffix}
      </div>
    );
  }
  return (
    <div className="tval">
      {sign}£{Math.round(a)}
      {suffix}
    </div>
  );
}

/** Compact money for meta text: ≥ £1m → £Xm, else £Xk. */
function fmtCompact(v: number): string {
  const n = Math.round(v);
  const a = Math.abs(n);
  const s = n < 0 ? "-" : "";
  if (a >= 1_000_000) {
    const m = a / 1_000_000;
    return `${s}£${Number.isInteger(m) ? m : m.toFixed(1)}m`;
  }
  if (a >= 100_000) return `${s}£${Math.round(a / 1000)}k`;
  if (a >= 1_000) return `${s}£${(a / 1000).toFixed(1)}k`;
  return `${s}£${a}`;
}

/** Whole-number variant of fmtCompact — used only in the Group Scoreboard tiles. */
function fmtCompactWhole(v: number): string {
  const n = Math.round(v);
  const a = Math.abs(n);
  const s = n < 0 ? "-" : "";
  if (a >= 1_000_000) return `${s}£${Math.round(a / 1_000_000)}m`;
  if (a >= 1_000) return `${s}£${Math.round(a / 1000)}k`;
  return `${s}£${a}`;
}

const pctW = (v: number) => `${Math.max(0, Math.min(100, v))}%`;

/** Styled "i" badge tooltip — replaces the browser-native title attribute
 *  (tiny, delayed, absent on touch). Content supports rich layout: pass a
 *  formula line (font-mono) plus a muted explanation. */
function InfoTip({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="info" tabIndex={0}>
            i
          </span>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          align="start"
          collisionPadding={12}
          className="max-w-xs p-3 space-y-1.5 text-left"
        >
          {children}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
const round2 = (n: number | null | undefined) =>
  n == null ? null : Math.round((Number(n) || 0) * 100) / 100;

/* Location and period are driven by the app's global TopBar filters —
   the page renders no pickers of its own. */
const normalizeRangeId = (id: string) =>
  id === "mtd"
    ? "this-month"
    : id === "qtd"
      ? "this-quarter"
      : id === "ytd"
        ? "this-year"
        : id;
const RANGE_SHORT: Record<string, string> = {
  "this-month": "MTD",
  "last-month": "Last mo",
  "this-quarter": "QTD",
  "this-year": "YTD",
  "last-12m": "12M",
  "last-year": "LY",
  custom: "Custom",
};

/* ── head-to-head compare ──────────────────────────────────────────── */

interface H2HEntry {
  key: string;
  label: string;
  revenue: number;
  chairDays: number | null;
  revPerChairDay: number | null;
  profitPerChairDay: number | null;
  margin: number | null;
  utilisation: number | null;
  breakEvenSales: number | null;
  score: number | null;
}

function HeadToHead({
  sites,
  periodDays,
  groupBreakEven,
}: {
  sites: GroupSiteRow[];
  periodDays: number;
  /** Org-wide Profitability break-even (not sum of sites). */
  groupBreakEven?: {
    revenue: number;
    treatmentCost: number;
    operatingExpense: number;
    breakEvenSales: number | null;
  };
}) {
  const { showDecimals } = useOrganizationSettings();
  const fmtMoney = useCallback(
    (v: number) => formatCurrency(v, showDecimals),
    [showDecimals],
  );
  const entries = useMemo<H2HEntry[]>(() => {
    const totRev = sites.reduce((s, r) => s + r.revenue, 0);
    const totCosts = sites.reduce((s, r) => s + r.costs, 0);
    const totTreatmentCost = sites.reduce(
      (s, r) => s + (r.treatmentCost ?? 0),
      0,
    );
    const totOperatingExpense = sites.reduce(
      (s, r) => s + (r.operatingExpense ?? 0),
      0,
    );
    const totChairDays = sites.reduce((s, r) => s + (r.chairDays ?? 0), 0);
    const chairTotal = sites.reduce((s, r) => s + (r.chairs ?? 0), 0);
    const utilNum = sites.reduce(
      (s, r) => s + (r.utilisation ?? 0) * (r.chairs ?? 0),
      0,
    );
    const groupMargin =
      totRev > 0 ? ((totRev - totCosts) / totRev) * 100 : null;
    const beRev = groupBreakEven?.revenue ?? totRev;
    const beCost = groupBreakEven?.treatmentCost ?? totTreatmentCost;
    const beExpense = groupBreakEven?.operatingExpense ?? totOperatingExpense;
    const groupBe =
      groupBreakEven?.breakEvenSales != null
        ? { breakEvenSales: groupBreakEven.breakEvenSales }
        : computeBreakEvenSales(beRev, beCost, beExpense);
    const group: H2HEntry = {
      key: "group",
      label: "Group average",
      revenue: totRev,
      chairDays: totChairDays || null,
      revPerChairDay: totChairDays > 0 ? totRev / totChairDays : null,
      profitPerChairDay:
        totChairDays > 0 ? (totRev - totCosts) / totChairDays : null,
      margin: groupMargin,
      utilisation: chairTotal > 0 ? utilNum / chairTotal : null,
      breakEvenSales: groupBe.breakEvenSales,
      score: null,
    };
    return [
      group,
      ...sites.map((s) => ({
        key: s.locationId,
        label: s.name,
        revenue: s.revenue,
        chairDays: s.chairDays,
        revPerChairDay: s.revPerChairDay,
        profitPerChairDay: s.profitPerChairDay,
        margin: s.margin,
        utilisation: s.utilisation,
        breakEvenSales: s.breakEvenSales,
        score: s.score,
      })),
    ];
  }, [sites, groupBreakEven, periodDays]);

  const [aKey, setAKey] = useState<string>(entries[1]?.key ?? "group");
  const [bKey, setBKey] = useState<string>("group");
  // Side A only offers real sites — if its saved key isn't one (e.g. sites
  // loaded after mount), fall back to the first site.
  const effAKey = entries.some((e) => e.key === aKey && e.key !== "group")
    ? aKey
    : (entries[1]?.key ?? "group");
  const A = entries.find((e) => e.key === effAKey) ?? entries[0];
  const B = entries.find((e) => e.key === bKey) ?? entries[0];

  type Metric = {
    name: string;
    get: (e: H2HEntry) => number | null;
    fmt: (v: number) => string;
    gap: (a: number, b: number) => { txt: string; good: boolean };
  };
  const pt = (d: number, unit: string) =>
    `${d > 0 ? "+" : ""}${Math.round(d * 10) / 10}${unit}`;
  const metrics: Metric[] = [
    {
      name: "Revenue (period)",
      get: (e) => e.revenue,
      fmt: fmtCompact,
      gap: (a, b) => ({
        txt: `${a - b >= 0 ? "+" : ""}${fmtCompact(a - b)}`,
        good: a >= b,
      }),
    },
    {
      name: "Rev / chair / day",
      get: (e) => e.revPerChairDay,
      fmt: (v) => fmtMoney(v),
      gap: (a, b) => ({
        txt: `${a - b >= 0 ? "+" : ""}${fmtMoney(a - b)}`,
        good: a >= b,
      }),
    },
    {
      name: "Profit / chair / day",
      get: (e) => e.profitPerChairDay,
      fmt: (v) => fmtMoney(v),
      gap: (a, b) => ({
        txt: `${a - b >= 0 ? "+" : ""}${fmtMoney(a - b)}`,
        good: a >= b,
      }),
    },
    {
      name: "Operating margin",
      get: (e) => e.margin,
      fmt: (v) => `${v.toFixed(1)}%`,
      gap: (a, b) => ({ txt: pt(a - b, "pt"), good: a >= b }),
    },
    {
      name: "Chair utilisation",
      get: (e) => e.utilisation,
      fmt: (v) => `${Math.round(v)}%`,
      gap: (a, b) => ({ txt: pt(a - b, "pt"), good: a >= b }),
    },
    {
      name: "Break-even sales",
      get: (e) => e.breakEvenSales,
      fmt: fmtCompact,
      gap: (a, b) => ({
        txt: `${a - b >= 0 ? "+" : ""}${fmtCompact(a - b)}`,
        good: a <= b,
      }),
    },
  ];

  const pcGap =
    A.profitPerChairDay != null && B.profitPerChairDay != null
      ? A.profitPerChairDay - B.profitPerChairDay
      : null;
  const annual =
    pcGap != null && A.chairDays
      ? Math.abs(pcGap) * A.chairDays * (365 / periodDays)
      : null;

  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="h2hsel">
        <select
          className="h2hpick"
          value={effAKey}
          onChange={(e) => setAKey(e.target.value)}
        >
          {entries
            .filter((e) => e.key !== "group")
            .map((e) => (
              <option key={e.key} value={e.key}>
                {e.label}
              </option>
            ))}
        </select>
        <span className="h2hvs">vs</span>
        <select
          className="h2hpick"
          value={bKey}
          onChange={(e) => setBKey(e.target.value)}
        >
          {entries.map((e) => (
            <option key={e.key} value={e.key}>
              {e.label}
            </option>
          ))}
        </select>
      </div>

      <div className="cmp">
        <div className="cmphead">
          <span>Metric</span>
          <span>{A.label}</span>
          <span>{B.label}</span>
          <span>Gap</span>
        </div>
        {metrics.map((m) => {
          const a = m.get(A);
          const b = m.get(B);
          const gap = a != null && b != null ? m.gap(a, b) : null;
          return (
            <div className="cmprow" key={m.name}>
              <span className="mname">{m.name}</span>
              <span className="mv">{a != null ? m.fmt(a) : "—"}</span>
              <span className="mv" style={{ color: "var(--gdb-ink-2)" }}>
                {b != null ? m.fmt(b) : "—"}
              </span>
              <span
                className={`gap ${gap ? (Math.abs((a as number) - (b as number)) < 0.005 ? "even" : gap.good ? "good" : "bad") : "even"}`}
              >
                {gap ? gap.txt : "—"}
              </span>
            </div>
          );
        })}
      </div>

      <div className="verdict" style={{ marginTop: 14 }}>
        <span className="vi">!</span>
        <div>
          {A.key === B.key ? (
            <b>
              Same site on both sides. Pick a different comparison to see the
              gap.
            </b>
          ) : pcGap == null || annual == null ? (
            <b>
              Chair-level data is missing for one side — the £ gap can't be
              sized yet.
            </b>
          ) : pcGap < 0 ? (
            <>
              <b>
                {A.label} makes {fmtMoney(Math.abs(pcGap))} less per chair per
                day than {B.label}.
              </b>{" "}
              Closing that gap is worth ~{fmtCompact(annual)} a year.
            </>
          ) : (
            <>
              <b>
                {A.label} makes {fmtMoney(pcGap)} more per chair per day than{" "}
                {B.label}.
              </b>{" "}
              That edge is worth ~{fmtCompact(annual)} a year — its playbook is
              what the other sites should copy.
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── the page ──────────────────────────────────────────────────────── */

export default function GroupDashboard() {
  const { selectedLocationId, selectedDateRangeId, dateRange } = useFilters();
  const { locations } = useLocations();
  const vm = useGroupDashboardData();
  const { showDecimals } = useOrganizationSettings();
  const fmtMoney = useCallback(
    (v: number) => formatCurrency(v, showDecimals),
    [showDecimals],
  );

  const [engineOpen, setEngineOpen] = useState(false);
  const [h2hOpen, setH2hOpen] = useState(false);

  const periodShort =
    RANGE_SHORT[normalizeRangeId(selectedDateRangeId)] ?? "Period";
  const selectedLocationName = selectedLocationId
    ? locations.find((l) => l.id === selectedLocationId)?.location_name || null
    : "All Locations";

  /* meters + rag states */
  const coverRag =
    vm.monthsCover == null
      ? "a"
      : vm.monthsCover >= CASH_COVER_TARGET
        ? "g"
        : vm.monthsCover >= 1.5
          ? "a"
          : "r";
  // Margin RAG against the Profit Benchmarking target (amber from 62.5% of the
  // benchmark — the same 15-of-24 proportion the old hardcoded thresholds used).
  const marginRag =
    vm.opMargin == null
      ? "a"
      : vm.opMargin >= vm.marginBenchmark
        ? "g"
        : vm.opMargin >= vm.marginBenchmark * 0.625
          ? "a"
          : "r";

  /* Business Pulse targets. There is no stored group budget, so each target is
     DERIVED from a figure the page already trusts — never invented:
       · revenue — TEMP static REVENUE_TARGET_STATIC (£3m) until a real per-period target is wired up
       · profit  — income at the Profit Benchmarking margin benchmark
       · cash / draw — same as profit target (period Net Cashflow plan)
     The section header says they're derived so nobody reads them as a budget. */
  const pulseTargets = useMemo(() => {
    const revenue = REVENUE_TARGET_STATIC;
    const profit =
      vm.opRevenue > 0 ? vm.opRevenue * (vm.marginBenchmark / 100) : null;
    const monthlyCosts =
      vm.costs > 0 && vm.periodDays > 0
        ? vm.costs * (30.44 / vm.periodDays)
        : null;
    const cash = monthlyCosts != null ? monthlyCosts * CASH_COVER_TARGET : null;
    // Draw / pulse Cash target = the benchmark-margin profit for the period.
    const draw = profit;
    return { revenue, profit, cash, draw };
  }, [vm.opRevenue, vm.marginBenchmark, vm.costs, vm.periodDays]);

  /** Owner equity = the EBITDA valuation when available, else the indicative mid. */
  const equityValue =
    vm.groupValue?.enterpriseValue ?? vm.estValue?.mid ?? null;

  /* efficiency aggregates — the whole group, or only the location picked in
     the top bar (the league table below always ranks every site for context) */
  const eff = useMemo(() => {
    const pool = selectedLocationId
      ? vm.sites.filter((s) => s.locationId === selectedLocationId)
      : vm.sites;
    const withChairs = pool.filter((s) => s.chairDays && s.chairDays > 0);
    const chairDays = withChairs.reduce(
      (s, r) => s + (r.chairDays as number),
      0,
    );
    const rev = withChairs.reduce((s, r) => s + r.revenue, 0);
    const cost = withChairs.reduce((s, r) => s + r.costs, 0);
    // Per-location: site PB Cost/Expense. All locations: org-wide Profitability
    // totals (same as Business Pulse) — summing sites double-counts shared costs.
    const useGroupBe = !selectedLocationId;
    const totRev = useGroupBe
      ? vm.opRevenue
      : pool.reduce((s, r) => s + r.revenue, 0);
    const totCost = pool.reduce((s, r) => s + r.costs, 0);
    const totTreatmentCost = useGroupBe
      ? (vm.beTreatmentCost ?? 0)
      : pool.reduce((s, r) => s + (r.treatmentCost ?? 0), 0);
    const totOperatingExpense = useGroupBe
      ? (vm.beOperatingExpense ?? 0)
      : pool.reduce((s, r) => s + (r.operatingExpense ?? 0), 0);
    const be = useGroupBe
      ? {
          breakEvenSales: vm.groupBreakEvenSales ?? null,
          breakEvenGap: vm.groupBreakEvenGap ?? null,
          grossProfit: vm.groupGrossProfit ?? totRev - totTreatmentCost,
          grossProfitPct: vm.groupGrossProfitPct ?? null,
          grossProfitRatio: vm.groupGrossProfitRatio ?? null,
        }
      : computeBreakEvenSales(totRev, totTreatmentCost, totOperatingExpense);
    const chairs = pool.reduce((s, r) => s + (r.chairs ?? 0), 0);
    return {
      chairDays,
      chairs,
      // Raw sums behind the per-chair-day figures — power the tile tooltips'
      // worked calculations.
      rev,
      cost,
      totRev,
      totCost,
      treatmentCost: totTreatmentCost,
      operatingExpense: totOperatingExpense,
      grossProfit: be.grossProfit,
      grossProfitPct: be.grossProfitPct,
      grossProfitRatio: be.grossProfitRatio,
      revPerChairDay: chairDays > 0 ? rev / chairDays : null,
      costPerChairDay: chairDays > 0 ? cost / chairDays : null,
      profitPerChairDay: chairDays > 0 ? (rev - cost) / chairDays : null,
      breakEvenSales: be.breakEvenSales,
      breakEvenGap: be.breakEvenGap,
    };
  }, [
    vm.sites,
    vm.opRevenue,
    vm.beTreatmentCost,
    vm.beOperatingExpense,
    vm.groupBreakEvenSales,
    vm.groupBreakEvenGap,
    vm.groupGrossProfit,
    vm.groupGrossProfitPct,
    vm.groupGrossProfitRatio,
    selectedLocationId,
  ]);

  /* Zone 0 — Exceptions: sites off-plan vs the group, with an annualised £ gap */
  const exceptions = useMemo(() => {
    const rows: Array<{
      site: GroupSiteRow;
      sev: "r" | "a";
      reasons: string[];
      annual: number;
    }> = [];
    for (const s of vm.sites) {
      if (s.revenue <= 0) continue;
      const reasons: string[] = [];
      let sev: "r" | "a" = "a";
      let marginGap = 0;
      let capacityGap = 0;
      if (
        s.margin != null &&
        vm.margin != null &&
        (s.margin as number) < (vm.margin as number) - 5
      ) {
        reasons.push(
          `Margin ${(s.margin as number).toFixed(1)}% vs ${(vm.margin as number).toFixed(1)}% group`,
        );
        marginGap =
          (((vm.margin as number) - (s.margin as number)) / 100) *
          s.revenue *
          (365 / vm.periodDays);
        if (
          (s.margin as number) < 0 ||
          (s.margin as number) < (vm.margin as number) - 10
        )
          sev = "r";
      }
      if (
        s.utilisation != null &&
        vm.groupUtil != null &&
        s.utilisation < vm.groupUtil - 10
      ) {
        reasons.push(
          `${Math.round(s.utilisation)}% chair utilisation vs ${Math.round(vm.groupUtil)}% group`,
        );
        if (s.utilisation > 0)
          capacityGap =
            s.revenue *
            (vm.groupUtil / s.utilisation - 1) *
            (365 / vm.periodDays);
      }
      if (reasons.length === 0) continue;
      rows.push({
        site: s,
        sev,
        reasons,
        annual: Math.max(marginGap, capacityGap),
      });
    }
    rows.sort((a, b) =>
      a.sev === b.sev ? b.annual - a.annual : a.sev === "r" ? -1 : 1,
    );
    const exceptionIds = new Set(rows.map((r) => r.site.locationId));
    const onPlan = vm.sites.filter(
      (s) => s.revenue > 0 && !exceptionIds.has(s.locationId),
    );
    return { rows, onPlan };
  }, [vm.sites, vm.margin, vm.groupUtil, vm.periodDays]);

  /* Zone 3a — Staffing & Capacity: chair hours available vs booked, per week */
  const staffing = useMemo(() => {
    const weeks = Math.max(1, vm.periodDays / 7);
    const rows = vm.sites
      .filter(
        (s) => s.availableHours != null && (s.availableHours as number) > 0,
      )
      .map((s) => {
        const avail = s.availableHours as number;
        const booked = Math.min(s.bookedHours ?? 0, avail);
        const openWk = Math.max(0, avail - booked) / weeks;
        const revPerBookedHour = booked > 0 ? s.revenue / booked : null;
        const openValueWk =
          revPerBookedHour != null ? openWk * revPerBookedHour : null;
        const util = s.utilisation;
        const fix =
          util == null
            ? { cls: "a", label: "Needs chair data" }
            : util >= 80
              ? { cls: "g", label: "On pace" }
              : util >= 65
                ? { cls: "a", label: "Recall tune-up" }
                : { cls: "r", label: "Demand — recall + reactivation push" };
        return {
          site: s,
          availWk: avail / weeks,
          bookedWk: booked / weeks,
          openWk,
          openValueWk,
          fix,
        };
      })
      .sort((a, b) => (b.openValueWk ?? 0) - (a.openValueWk ?? 0));
    const worst = rows[0] && (rows[0].openValueWk ?? 0) > 0 ? rows[0] : null;
    return { rows, worst };
  }, [vm.sites, vm.periodDays]);

  const bestSite = vm.sites.find((s) => s.profitPerChairDay != null);
  const dragSite = [...vm.sites]
    .reverse()
    .find(
      (s) =>
        s.margin != null &&
        vm.margin != null &&
        ((s.margin as number) < 0 ||
          (s.margin as number) < (vm.margin as number) - 5),
    );

  /* verdict for the league */
  const leagueVerdict = useMemo(() => {
    if (!dragSite || !bestSite || dragSite.locationId === bestSite.locationId)
      return null;
    if (
      bestSite.profitPerChairDay == null ||
      dragSite.profitPerChairDay == null ||
      !dragSite.chairDays
    )
      return null;
    const uplift =
      (bestSite.profitPerChairDay - dragSite.profitPerChairDay) *
      dragSite.chairDays *
      (365 / vm.periodDays);
    if (uplift <= 0) return null;
    return { dragSite, bestSite, uplift };
  }, [dragSite, bestSite, vm.periodDays]);

  const aiContext = {
    page: "group-dashboard",
    selectedLocationId: selectedLocationId || null,
    selectedLocationName,
    period: {
      from: toLocalYMD(dateRange.startDate),
      to: toLocalYMD(dateRange.endDate),
    },
    scoreboard: {
      cashInBank: round2(vm.cashLastMonth ?? vm.cash),
      monthsCover: round2(vm.monthsCover),
      operatingProfit: round2(vm.opProfit),
      revenue: round2(vm.opRevenue > 0 ? vm.opRevenue : vm.revenue),
      costs: round2(vm.costs),
      marginPct: round2(vm.opMargin ?? vm.margin),
      netCashFlow: round2(vm.safeToDraw),
      estimatedValueMid: vm.valuationAllowed
        ? round2(vm.groupValue?.enterpriseValue ?? vm.estValue?.mid ?? null)
        : null,
    },
    sites: vm.sites.map((s) => ({
      name: s.name,
      revenue: round2(s.revenue),
      costs: round2(s.costs),
      profit: round2(s.profit),
      marginPct: round2(s.margin),
      utilisationPct: round2(s.utilisation),
      profitPerChairDay: round2(s.profitPerChairDay),
    })),
    nhs: { exposure: round2(vm.nhsExposure), contracts: vm.nhsRows.length },
    alerts: vm.alerts.map((a) => `${a.title} (${a.value})`),
  };

  return (
    <MainLayout userRole="admin" aiContext={aiContext}>
      <Helmet>
        <title>Financial Position</title>
        <meta
          name="description"
          content="One view across every practice — cash, profit, chairs, NHS delivery and the next moves."
        />
      </Helmet>

      <div className="gdb">
        <div>
          {/* Page header — same pattern as the other pages; filters live in the TopBar */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-foreground">
                Financial Position
              </h1>
              <p className="text-muted-foreground text-sm mt-1">
                {vm.siteCount} practice{vm.siteCount === 1 ? "" : "s"}
                {vm.chairTotal ? <> • {vm.chairTotal} chairs</> : null} •{" "}
                {dateRange.startDate.toLocaleDateString("en-GB")} –{" "}
                {dateRange.endDate.toLocaleDateString("en-GB")}
                {vm.dataToLabel ? <> • {vm.dataToLabel}</> : null}
              </p>
            </div>
          </div>

          {/* ZONE 0 — EXCEPTIONS & ACTION CENTER */}
          {vm.sites.length > 0 && (
            <ActionCenter
              vm={vm}
              siteExceptions={exceptions.rows}
              onPlan={exceptions.onPlan}
              periodShort={periodShort}
            />
          )}

          {/* ZONE 1 — GROUP SCOREBOARD */}
          <section>
            <div className="sec-head">
              <h2>Group Scoreboard</h2>
              <span className="sub">
                Are we winning? - across{" "}
                {selectedLocationId
                  ? selectedLocationName
                  : `all ${vm.siteCount} practices`}
              </span>
            </div>
            <div className="scoreboard">
              <div className="card tile">
                <div className={`rag ${coverRag}`} />
                <div className="tlabel">
                  Cash in bank
                  {vm.cashLastMonth != null && (
                    <span className="pill ind">{vm.cashLastMonthLabel}</span>
                  )}
                  <InfoTip>
                    <div className="text-xs leading-relaxed">
                      Last month's closing balance from the Statement of Cash
                      Flows (same anchor as the statement page). Falls back to
                      this week's closing balance while the statement loads.
                    </div>
                  </InfoTip>
                </div>
                <TileValue
                  v={
                    vm.statementLoading && vm.cashLastMonth == null
                      ? null
                      : (vm.cashLastMonth ?? vm.cash)
                  }
                />
                <div className="tmeta">
                  {vm.monthsCover != null ? (
                    <span
                      className={`delta ${vm.monthsCover >= CASH_COVER_TARGET ? "up" : "down"}`}
                    >
                      {vm.monthsCover >= CASH_COVER_TARGET ? "▲" : "▼"}{" "}
                      {Math.round(vm.monthsCover)} months cover
                    </span>
                  ) : (
                    <span>
                      {vm.cashLastMonth != null
                        ? "last month closing balance"
                        : "closing balance"}
                    </span>
                  )}
                </div>
                <div className="meter">
                  <div className="mtrack">
                    <div
                      className={`mfill ${coverRag}`}
                      style={{
                        width: pctW(
                          ((vm.monthsCover ?? 0) / CASH_COVER_TARGET) * 100,
                        ),
                      }}
                    />
                  </div>
                  <div className="mcap">
                    {vm.monthsCover != null
                      ? `${Math.round(vm.monthsCover)} of ${Math.round(CASH_COVER_TARGET)}-month comfort target`
                      : "cost data needed for cover"}
                  </div>
                </div>
              </div>

              <div className="card tile">
                <div className={`rag ${marginRag}`} />
                <div className="tlabel">
                  Operating profit{" "}
                  <span className="pill ind">{periodShort}</span>
                  <InfoTip>
                    <div className="text-xs leading-relaxed">
                      Production Income (Private + Membership + NHS) minus your
                      mapped cost categories. Same £ figure as the Profit
                      Benchmark page.
                    </div>
                  </InfoTip>
                </div>
                <TileValue
                  v={vm.isLoading || vm.isCostsLoading ? null : vm.opProfit}
                />
                <div className="tmeta">
                  {pulseTargets.profit
                    ? (() => {
                        const pct =
                          (vm.opProfit / pulseTargets.profit - 1) * 100;
                        return (
                          <span className={`delta ${pct >= 0 ? "up" : "down"}`}>
                            {pct >= 0 ? "▲" : "▼"} {Math.abs(pct).toFixed(0)}%
                            vs target
                          </span>
                        );
                      })()
                    : vm.opMargin != null && (
                        <span
                          className={`delta ${vm.opMargin >= vm.marginBenchmark ? "up" : "down"}`}
                        >
                          {vm.opMargin >= vm.marginBenchmark ? "▲" : "▼"}{" "}
                          {Math.round(vm.opMargin)}% margin
                        </span>
                      )}
                </div>
                <div className="meter">
                  <div className="mtrack">
                    <div
                      className={`mfill ${marginRag}`}
                      style={{
                        width: pctW(
                          pulseTargets.profit
                            ? (vm.opProfit / pulseTargets.profit) * 100
                            : vm.opRevenue > 0
                              ? (vm.opProfit / vm.opRevenue) *
                                100 *
                                (100 / vm.marginBenchmark)
                              : 0,
                        ),
                      }}
                    />
                  </div>
                  <div className="mcap">
                    {pulseTargets.profit
                      ? `${fmtCompactWhole(vm.opProfit)} of ${fmtCompactWhole(pulseTargets.profit)} target`
                      : `${fmtCompactWhole(vm.opProfit)} of ${fmtCompactWhole(vm.opRevenue)} revenue`}
                  </div>
                </div>
              </div>

              <div className="card tile">
                <div className={`rag ${marginRag}`} />
                <div className="tlabel">
                  Profit margin
                  <InfoTip>
                    <div className="text-xs font-mono">
                      Margin = profit ÷ revenue
                    </div>
                    <div className="text-[11px] text-muted-foreground leading-relaxed">
                      Compared against your benchmark from the Profit
                      Benchmarking page — 100% minus your saved expense-category
                      benchmarks, or the 24% sector target when none are set.
                    </div>
                  </InfoTip>
                </div>
                <div className="tval">
                  {vm.opMargin != null ? Math.round(vm.opMargin) : "—"}
                  <span className="u">%</span>
                </div>
                <div className="tmeta">
                  {vm.opMargin != null && (
                    <span
                      className={`delta ${vm.opMargin >= vm.marginBenchmark ? "up" : "down"}`}
                    >
                      {vm.opMargin >= vm.marginBenchmark ? "▲" : "▼"}{" "}
                      {Math.round(Math.abs(vm.opMargin - vm.marginBenchmark))}pt
                    </span>
                  )}
                  vs {vm.marginBenchmark.toFixed(0)}% target
                </div>
                <div className="meter">
                  <div className="mtrack">
                    <div
                      className={`mfill ${marginRag}`}
                      style={{
                        width: pctW(
                          ((vm.opMargin ?? 0) / vm.marginBenchmark) * 100,
                        ),
                      }}
                    />
                  </div>
                  <div className="mcap">
                    {vm.opMargin != null
                      ? `${Math.round(vm.opMargin)}% of ${vm.marginBenchmark.toFixed(0)}% target`
                      : "needs revenue and cost data"}
                  </div>
                </div>
              </div>

              {vm.valuationAllowed ? (
                <div className="card tile">
                  <div
                    className={`rag ${vm.groupValue || vm.estValue ? "g" : "a"}`}
                  />
                  <div className="tlabel">
                    Estimated group value
                    <InfoTip>
                      <div className="text-xs leading-relaxed">
                        {vm.groupValue
                          ? `EBITDA × your final multiple (${Math.round(vm.groupValue.multiple)}×) — the same enterprise value as the EBITDA Impact tab.`
                          : "Indicative range: operating profit annualised × a typical dental sector multiple (4.5–6.5×). Not a formal valuation."}
                      </div>
                    </InfoTip>
                  </div>
                  {vm.valueLoading && !vm.groupValue ? (
                    <div className="tval">…</div>
                  ) : vm.groupValue ? (
                    <TileValue v={vm.groupValue.enterpriseValue} />
                  ) : vm.estValue ? (
                    <div className="tval">
                      {fmtCompactWhole(vm.estValue.low)}–
                      {fmtCompactWhole(vm.estValue.high).replace(/^£/, "")}
                    </div>
                  ) : (
                    <div className="tval">—</div>
                  )}
                  <div className="tmeta">
                    {vm.groupValue ? (
                      <>
                        <span className="pill ind">EBITDA Impact</span>{" "}
                        {fmtCompactWhole(vm.groupValue.ebitda)} EBITDA ×{" "}
                        {Math.round(vm.groupValue.multiple)}×
                      </>
                    ) : (
                      <>
                        <span className="pill ind">Indicative</span>{" "}
                        {vm.estValue
                          ? `mid ${fmtCompactWhole(vm.estValue.mid)}`
                          : "needs a positive profit"}
                      </>
                    )}
                  </div>
                  <div className="meter">
                    <div className="mtrack">
                      <div className="mfill band" style={{ width: "100%" }} />
                      {(vm.groupValue || vm.estValue) && (
                        <div className="tick" style={{ left: "55%" }} />
                      )}
                    </div>
                    <div className="mcap">
                      {vm.groupValue
                        ? `enterprise value · equity ${fmtCompactWhole(vm.groupValue.equityValue)} after net debt`
                        : vm.estValue
                          ? `range ${fmtCompactWhole(vm.estValue.low)} – ${fmtCompactWhole(vm.estValue.high)} · profit × 4.5–6.5`
                          : "profit × sector multiple"}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="card tile">
                  <div className="tlabel">Estimated group value</div>
                  <div className="tval locked">
                    <Lock className="w-4 h-4" />
                  </div>
                  <div className="tmeta">
                    <span className="pill ind">Accelerate</span> Business
                    Valuation isn't included in your current plan.
                  </div>
                  <Link to="/organization" className="locked-link">
                    Upgrade Plan →
                  </Link>
                </div>
              )}
            </div>
          </section>

          {/* ZONE 1b — TREND */}
          <section>
            <div className="sec-head">
              <h2>Trend</h2>
              <span className="sub">
                Are we getting better or worse - over time
              </span>
            </div>
            <GroupTrendChart trend={vm.trend} />
          </section>

          {/* ZONE 2 — BUSINESS PULSE */}
          <section>
            <div className="sec-head">
              <h2>Business Pulse</h2>
              <span className="sub">
                Revenue → Profit → Net Cash Flow → Owner wealth · this period vs
                target{" "}
                <span className="est">
                  targets derived from your benchmarks
                </span>
              </span>
            </div>
            <div className="card pulse">
              <div className="chain">
                <div className="stage">
                  <div className="sname">Revenue</div>
                  <div className="sval">
                    {vm.benchLoading ? "—" : fmtCompact(vm.opRevenue)}
                  </div>
                  <div className="sdelta">
                    {!vm.benchLoading && vm.prevRevenue > 0 && (
                      <>
                        <span
                          className={`delta ${vm.opRevenue >= vm.prevRevenue ? "up" : "down"}`}
                        >
                          {vm.opRevenue >= vm.prevRevenue ? "▲" : "▼"}{" "}
                          {Math.abs(
                            ((vm.opRevenue - vm.prevRevenue) / vm.prevRevenue) *
                              100,
                          ).toFixed(0)}
                          %
                        </span>{" "}
                        <span className="smuted">vs prev period</span>
                      </>
                    )}
                  </div>
                  <div className="bars">
                    {(() => {
                      const t = pulseTargets.revenue;
                      const max = Math.max(vm.opRevenue, t ?? 0, 1);
                      return (
                        <>
                          <div className="barrow">
                            <span>Actual</span>
                            <div className="track">
                              <div
                                className="fill actual"
                                style={{
                                  width: pctW((vm.opRevenue / max) * 100),
                                }}
                              />
                            </div>
                            <span className="bval">
                              {fmtCompact(vm.opRevenue)}
                            </span>
                          </div>
                          <div className="barrow">
                            <span>Target</span>
                            <div className="track">
                              <div
                                className="fill target"
                                style={{ width: pctW(((t ?? 0) / max) * 100) }}
                              />
                            </div>
                            <span className="bval">
                              {t != null ? fmtCompact(t) : "—"}
                            </span>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </div>

                <div className="stage">
                  <div className="sname">Profit</div>
                  <div className="sval">
                    {vm.benchLoading ? "—" : fmtCompact(vm.opProfit)}
                  </div>
                  <div className="sdelta">
                    {vm.opMargin != null && (
                      <>
                        <span
                          className={`delta ${vm.opMargin >= vm.marginBenchmark ? "up" : "down"}`}
                        >
                          {vm.opMargin.toFixed(1)}%
                        </span>{" "}
                        <span className="smuted">
                          margin vs {vm.marginBenchmark.toFixed(0)}%
                        </span>
                      </>
                    )}
                  </div>
                  <div className="bars">
                    {(() => {
                      const t = pulseTargets.profit;
                      const max = Math.max(vm.opProfit, t ?? 0, 1);
                      return (
                        <>
                          <div className="barrow">
                            <span>Actual</span>
                            <div className="track">
                              <div
                                className="fill actual"
                                style={{
                                  width: pctW(
                                    (Math.max(0, vm.opProfit) / max) * 100,
                                  ),
                                }}
                              />
                            </div>
                            <span className="bval">
                              {fmtCompact(vm.opProfit)}
                            </span>
                          </div>
                          <div className="barrow">
                            <span>Target</span>
                            <div className="track">
                              <div
                                className="fill target"
                                style={{ width: pctW(((t ?? 0) / max) * 100) }}
                              />
                            </div>
                            <span className="bval">
                              {t != null ? fmtCompact(t) : "—"}
                            </span>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </div>

                <div className="stage">
                  <div className="sname">Net Cash Flow</div>
                  {/* Statement of Cash Flows → Net Cashflow for the filter period. */}
                  {(() => {
                    const pulseCash = vm.safeToDraw;
                    const pulsePrev = vm.prevNetCashFlow;
                    return (
                      <>
                        <div className="sval">
                          {pulseCash != null ? fmtCompact(pulseCash) : "—"}
                        </div>
                        <div className="sdelta">
                          {pulseCash != null && pulsePrev != null && (
                            <>
                              <span
                                className={`delta ${pulseCash >= pulsePrev ? "up" : "down"}`}
                              >
                                {pulseCash >= pulsePrev ? "▲" : "▼"}{" "}
                                {fmtCompact(Math.abs(pulseCash - pulsePrev))}
                              </span>{" "}
                              <span className="smuted">vs prev period</span>
                            </>
                          )}
                        </div>
                        <div className="bars">
                          {(() => {
                            const t = pulseTargets.draw;
                            const max = Math.max(
                              Math.abs(pulseCash ?? 0),
                              Math.abs(t ?? 0),
                              1,
                            );
                            return (
                              <>
                                <div className="barrow">
                                  <span>Actual</span>
                                  <div className="track">
                                    <div
                                      className="fill actual"
                                      style={{
                                        width: pctW(
                                          (Math.abs(pulseCash ?? 0) / max) *
                                            100,
                                        ),
                                      }}
                                    />
                                  </div>
                                  <span className="bval">
                                    {pulseCash != null
                                      ? fmtCompact(pulseCash)
                                      : "—"}
                                  </span>
                                </div>
                                <div className="barrow">
                                  <span>Target</span>
                                  <div className="track">
                                    <div
                                      className="fill target"
                                      style={{
                                        width: pctW(
                                          (Math.abs(t ?? 0) / max) * 100,
                                        ),
                                      }}
                                    />
                                  </div>
                                  <span className="bval">
                                    {t != null ? fmtCompact(t) : "—"}
                                  </span>
                                </div>
                              </>
                            );
                          })()}
                        </div>
                      </>
                    );
                  })()}
                </div>

                <div className="stage">
                  <div className="sname">Owner wealth</div>
                  {vm.valuationAllowed ? (
                    <>
                      <div className="sval">
                        {equityValue != null ? fmtCompact(equityValue) : "—"}
                      </div>
                      <div className="sdelta">
                        <span className="smuted">
                          {vm.groupValue
                            ? "EBITDA valuation · equity"
                            : "indicative · profit × sector multiple"}
                        </span>
                      </div>
                      <div className="bars">
                        {(() => {
                          const t = pulseTargets.draw;
                          const d = Math.max(0, vm.safeToDraw ?? 0);
                          const max = Math.max(d, t ?? 0, 1);
                          return (
                            <>
                              <div className="barrow">
                                <span>Draw MTD</span>
                                <div className="track">
                                  <div
                                    className="fill actual"
                                    style={{ width: pctW((d / max) * 100) }}
                                  />
                                </div>
                                <span className="bval">
                                  {vm.safeToDraw != null
                                    ? fmtCompact(vm.safeToDraw)
                                    : "—"}
                                </span>
                              </div>
                              <div className="barrow">
                                <span>Target</span>
                                <div className="track">
                                  <div
                                    className="fill target"
                                    style={{
                                      width: pctW(((t ?? 0) / max) * 100),
                                    }}
                                  />
                                </div>
                                <span className="bval">
                                  {t != null ? fmtCompact(t) : "—"}
                                </span>
                              </div>
                            </>
                          );
                        })()}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="sval locked">
                        <Lock className="w-4 h-4" />
                      </div>
                      <div className="sdelta">
                        <span className="smuted">
                          Business Valuation — Accelerate plan
                        </span>
                      </div>
                      <Link to="/organization" className="locked-link">
                        Upgrade Plan →
                      </Link>
                    </>
                  )}
                </div>
              </div>
              {vm.verdict && (
                <div className="verdict">
                  <span className="vi">!</span>
                  <div>{vm.verdict}</div>
                </div>
              )}
            </div>
          </section>

          {/* ZONE 2b — PROFIT ENGINE */}
          <section className="collapsible">
            <div className="sec-head" onClick={() => setEngineOpen((o) => !o)}>
              <h2>Profit Engine</h2>
              <span className="sub">
                Where the money is made - providers, chairs and payor mix
              </span>
              <span className="foldind">
                {engineOpen ? "▾ hide" : "▸ show"}
              </span>
            </div>
            {engineOpen && (
              <div className="engine">
                <div className="card ecard">
                  <div className="ehead">
                    <span className="etitle">
                      Providers · {vm.associates.length} producing
                    </span>
                    <span className="escore g">
                      top {Math.min(3, vm.associates.length)}
                    </span>
                  </div>
                  {vm.associates.slice(0, 3).map((a) => (
                    <div className="erow" key={a.name}>
                      <span className="en">{a.name}</span>
                      <span className="ev">
                        {fmtCompact(a.total)} ·{" "}
                        {vm.associatesTotal > 0
                          ? Math.round((a.total / vm.associatesTotal) * 100)
                          : 0}
                        % of production
                      </span>
                    </div>
                  ))}
                  {vm.associates.length === 0 && (
                    <div className="erow">
                      <span className="en">No production in this period</span>
                      <span className="ev">—</span>
                    </div>
                  )}
                  <div className="opp">
                    <div className="oh">Concentration check</div>
                    {vm.associates.length > 0 && vm.associatesTotal > 0 ? (
                      <>
                        The top {Math.min(3, vm.associates.length)} providers
                        deliver{" "}
                        <b>
                          {Math.round(
                            (vm.associates
                              .slice(0, 3)
                              .reduce((s, a) => s + a.total, 0) /
                              vm.associatesTotal) *
                              100,
                          )}
                          %
                        </b>{" "}
                        of production — full detail on the Providers page.
                      </>
                    ) : (
                      "Production by provider appears here once treatments complete in the period."
                    )}
                  </div>
                </div>

                <div className="card ecard">
                  <div className="ehead">
                    <span className="etitle">
                      Chairs
                      {vm.chairTotal ? ` · ${vm.chairTotal} across group` : ""}
                    </span>
                    <span
                      className={`escore ${vm.underused.length > 2 ? "r" : vm.underused.length > 0 ? "a" : "g"}`}
                    >
                      {vm.underused.length > 0
                        ? `${vm.underused.length} below average`
                        : "on pace"}
                    </span>
                  </div>
                  <div className="erow">
                    <span className="en">Group utilisation</span>
                    <span className="ev">
                      {vm.groupUtil != null
                        ? `${Math.round(vm.groupUtil)}% chair-weighted`
                        : "—"}
                    </span>
                  </div>
                  {vm.underused.slice(0, 2).map((s) => (
                    <div className="erow" key={s.locationId}>
                      <span className="en">{s.name}</span>
                      <span className="ev">
                        <span className="bad">
                          {Math.round(s.utilisation ?? 0)}% utilised ▼
                        </span>
                      </span>
                    </div>
                  ))}
                  <div className="opp">
                    <div className="oh">Biggest opportunity</div>
                    {vm.recoverable != null && vm.recoverable > 0 ? (
                      <>
                        Lifting every below-average site to the group
                        utilisation rate is{" "}
                        <b>~{fmtCompact(vm.recoverable)} annualised</b> in
                        recoverable capacity.
                      </>
                    ) : (
                      "Every site is at or above the group utilisation average."
                    )}
                  </div>
                </div>

                <div className="card ecard">
                  <div className="ehead">
                    <span className="etitle">Income mix · this period</span>
                    <span className="escore a">payor split</span>
                  </div>
                  {(["private", "membership", "nhs"] as const).map((k) => {
                    const total =
                      vm.incomeMix.private +
                      vm.incomeMix.membership +
                      vm.incomeMix.nhs;
                    const v = vm.incomeMix[k];
                    return (
                      <div className="erow" key={k}>
                        <span className="en">
                          {k === "nhs"
                            ? "NHS"
                            : k[0].toUpperCase() + k.slice(1)}
                        </span>
                        <span className="ev">
                          {fmtCompact(v)}
                          {total > 0
                            ? ` · ${Math.round((v / total) * 100)}%`
                            : ""}
                        </span>
                      </div>
                    );
                  })}
                  <div className="opp">
                    <div className="oh">Note</div>
                    Same Private, Membership and NHS as Profit Benchmark —
                    Accounting App totals when mapped, otherwise Provider Net
                    Production.
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* ZONE 3 — OPERATIONAL EFFICIENCY · SITE LEAGUE */}
          {vm.operationalEfficiencyAllowed && (
          <section>
            <div className="sec-head">
              <h2>Operational Efficiency</h2>
              <span className="sub">
                What each chair earns, costs and keeps -{" "}
                {selectedLocationId
                  ? `${selectedLocationName} per clinical day`
                  : "group per clinical day"}
                , then every site ranked{" "}
                <span className="est">chair data from the Chairs module</span>
              </span>
            </div>

            <div className="effkpis">
              <div className="card kcard">
                <div className="kl">
                  Revenue per chair per day{" "}
                  {eff.revPerChairDay != null && (
                    <InfoTip>
                      <div className="text-xs font-semibold">
                        How this is calculated
                      </div>
                      <div className="text-xs font-mono">
                        {fmtMoney(eff.rev)} revenue ÷{" "}
                        {Math.round(eff.chairDays)} chair-days ={" "}
                        <span className="font-semibold">
                          {fmtMoney(eff.revPerChairDay)}
                        </span>
                      </div>
                      <div className="text-[11px] text-muted-foreground leading-relaxed">
                        Revenue is the same Production Income (Private +
                        Membership + NHS) as the Profitability page. Chair-days
                        = each site's chairs × the days that site actually
                        treated patients in this period. Sites without chair
                        setup are left out.
                      </div>
                    </InfoTip>
                  )}
                </div>
                <div className="kv">
                  {eff.revPerChairDay != null
                    ? fmtMoney(eff.revPerChairDay)
                    : "—"}
                </div>
                <div className="km">
                  {eff.chairDays > 0
                    ? `${Math.round(eff.chairDays)} chair-days in the period`
                    : "needs chair setup in the Chairs module"}
                </div>
              </div>
              <div className="card kcard">
                <div className="kl">
                  Cost per chair per day{" "}
                  {eff.costPerChairDay != null && (
                    <InfoTip>
                      <div className="text-xs font-semibold">
                        How this is calculated
                      </div>
                      <div className="text-xs font-mono">
                        {fmtMoney(eff.cost)} costs ÷ {Math.round(eff.chairDays)}{" "}
                        chair-days ={" "}
                        <span className="font-semibold">
                          {fmtMoney(eff.costPerChairDay)}
                        </span>
                      </div>
                      <div className="text-[11px] text-muted-foreground leading-relaxed">
                        Every expense category mapped for these sites is
                        included — staff, labs, materials and overheads, not
                        just direct costs.
                      </div>
                    </InfoTip>
                  )}
                </div>
                <div className="kv">
                  {eff.costPerChairDay != null
                    ? fmtMoney(eff.costPerChairDay)
                    : "—"}
                </div>
                <div className="km">all mapped cost accounts included</div>
              </div>
              <div className="card kcard">
                <div className="kl">
                  Profit per chair per day{" "}
                  {eff.profitPerChairDay != null && (
                    <InfoTip>
                      <div className="text-xs font-semibold">
                        How this is calculated
                      </div>
                      <div className="text-xs font-mono">
                        ({fmtMoney(eff.rev)} revenue − {fmtMoney(eff.cost)}{" "}
                        costs) ÷ {Math.round(eff.chairDays)} chair-days ={" "}
                        <span className="font-semibold">
                          {fmtMoney(eff.profitPerChairDay)}
                        </span>
                      </div>
                      <div className="text-[11px] text-muted-foreground leading-relaxed">
                        Fully loaded — what each chair keeps per clinical day
                        after every mapped cost.
                      </div>
                    </InfoTip>
                  )}
                </div>
                <div className="kv">
                  {eff.profitPerChairDay != null
                    ? fmtMoney(eff.profitPerChairDay)
                    : "—"}
                </div>
                <div className="km">
                  fully loaded
                  {(selectedLocationId ? eff.chairs : vm.chairTotal)
                    ? ` · ${selectedLocationId ? eff.chairs : vm.chairTotal} chairs`
                    : ""}
                </div>
              </div>
              <div className="card kcard">
                <div className="kl">
                  {selectedLocationId
                    ? "Break-even sales"
                    : "Group break-even sales"}{" "}
                  {eff.breakEvenSales != null && (
                    <InfoTip>
                      <div className="text-xs font-semibold">
                        How this is calculated
                      </div>
                      <div className="text-xs font-mono">
                        Revenue ={" "}
                        <span className="font-semibold">
                          {fmtCompact(eff.totRev)}
                        </span>
                      </div>
                      <div className="text-xs font-mono">
                        Cost ={" "}
                        <span className="font-semibold">
                          {fmtCompact(eff.treatmentCost)}
                        </span>
                      </div>
                      <div className="text-xs font-mono">
                        Expense ={" "}
                        <span className="font-semibold">
                          {fmtCompact(eff.operatingExpense)}
                        </span>
                      </div>
                      <div className="text-xs font-mono">
                        Gross Profit = Revenue − Cost ={" "}
                        <span className="font-semibold">
                          {fmtCompact(eff.grossProfit)}
                        </span>
                      </div>
                      {eff.grossProfitPct != null && (
                        <div className="text-xs font-mono">
                          Gross Profit % ={" "}
                          <span className="font-semibold">
                            {eff.grossProfitPct.toFixed(1)}%
                          </span>
                        </div>
                      )}
                      <div className="text-xs font-mono">
                        Break-even = Expense ÷ GP% ={" "}
                        <span className="font-semibold">
                          {fmtCompact(eff.breakEvenSales)}
                        </span>
                      </div>
                      <div className="text-[11px] text-muted-foreground leading-relaxed">
                        {eff.breakEvenGap === 0
                          ? "Costs are covered — everything billed above this is profit."
                          : `${fmtCompact(eff.breakEvenGap as number)} more revenue is needed before further billing becomes profit.`}
                      </div>
                    </InfoTip>
                  )}
                </div>
                <div className="kv">
                  {eff.breakEvenSales != null
                    ? fmtCompact(eff.breakEvenSales)
                    : "—"}
                </div>
                <div className="km">
                  {eff.breakEvenSales == null
                    ? "needs profitability data"
                    : eff.breakEvenGap === 0
                      ? "covered — everything billed above this is profit"
                      : `${fmtCompact(eff.breakEvenGap as number)} more revenue needed to break even`}
                </div>
              </div>
            </div>

            <div className="card efftable">
              <div className="lghead">
                <span />
                <span>Practice</span>
                <span>Chairs</span>
                <span>Rev / chair / day</span>
                <span>Profit / chair / day</span>
              </div>

              {vm.sites.length === 0 && (
                <div className="loading-note">
                  {vm.isLoading
                    ? "Loading site data…"
                    : "No site activity in this period."}
                </div>
              )}

              {vm.sites.map((s, i) => {
                const isDrag = dragSite?.locationId === s.locationId;
                return (
                  <div
                    className={`lgrow ${isDrag ? "drag" : ""}`}
                    key={s.locationId}
                  >
                    <div className={`rankn ${isDrag ? "r" : ""}`}>{i + 1}</div>
                    <div className="sn">
                      {s.name}
                      <span className="ss">
                        {s.utilisation != null
                          ? `${Math.round(s.utilisation)}% utilised`
                          : "no chair data"}
                        {s.outstanding > 0
                          ? ` · ${fmtCompact(s.outstanding)} outstanding`
                          : ""}
                      </span>
                    </div>
                    <div className="nv">{s.chairs ?? "—"}</div>
                    <div className="nv">
                      {s.revPerChairDay != null
                        ? fmtMoney(s.revPerChairDay)
                        : "—"}
                    </div>
                    <div
                      className={`nv ${s.profitPerChairDay != null && s.profitPerChairDay < 0 ? "neg" : "strong"}`}
                    >
                      {s.profitPerChairDay != null
                        ? fmtMoney(s.profitPerChairDay)
                        : "—"}
                    </div>
                  </div>
                );
              })}

              {/* <div className="effnote">
                Profit per chair per day is fully loaded: each site's revenue less its mapped cost accounts, spread over its chair-days. Sites sum to {fmtCompact(vm.sites.reduce((s, r) => s + r.profit, 0))} operating profit for the period.
              </div> */}
            </div>

            {leagueVerdict && (
              <div className="verdict" style={{ marginTop: 12 }}>
                <span className="vi">!</span>
                <div>
                  <b>{leagueVerdict.dragSite.name} is the dragging site.</b> If
                  it matched {leagueVerdict.bestSite.name}'s{" "}
                  {fmtMoney(leagueVerdict.bestSite.profitPerChairDay as number)}{" "}
                  profit per chair per day, group profit rises{" "}
                  <b>~{fmtCompact(leagueVerdict.uplift)} a year</b>.
                </div>
              </div>
            )}
          </section>
          )}

          {/* ZONE 3a — STAFFING & CAPACITY */}
          {staffing.rows.length > 0 && (
            <section>
              <div className="sec-head">
                <h2>Staffing &amp; Capacity</h2>
                <span className="sub">
                  Open chair time and what it's worth - per week{" "}
                  <span className="est">chair hours from the diary</span>
                </span>
              </div>
              <div className="card efftable">
                <div className="sthead">
                  <span>Practice</span>
                  <span>Chair hrs / wk</span>
                  <span>Booked / wk</span>
                  <span>Idle / Wk</span>
                  <span>Ideal value / wk</span>
                  <span>The fix</span>
                </div>
                {staffing.rows.map(
                  ({ site, availWk, bookedWk, openWk, openValueWk, fix }) => (
                    <div className="strow" key={site.locationId}>
                      <div className="sn">
                        {site.name}
                        {site.utilisation != null && (
                          <span className="ss">
                            {Math.round(site.utilisation)}% utilised
                          </span>
                        )}
                      </div>
                      <div className="nv">{Math.round(availWk)}</div>
                      <div className="nv">{Math.round(bookedWk)}</div>
                      <div
                        className={`nv ${openWk > availWk * 0.35 ? "strong neg" : ""}`}
                      >
                        {Math.round(openWk)}
                      </div>
                      <div
                        className={`nv ${openValueWk != null && openValueWk > 0 ? "strong" : ""}`}
                      >
                        {openValueWk != null ? fmtCompact(openValueWk) : "—"}
                      </div>
                      <div className={`stfix ${fix.cls}`}>{fix.label}</div>
                    </div>
                  ),
                )}
                <div className="effnote">
                  Idle time = chair hours available in the diary with no
                  appointment booked. Its ideal value is priced at each site's
                  own revenue per booked hour. DentPulse can't yet see rota
                  vacancies, so persistent idle time at one site can mean
                  recruitment rather than demand.
                </div>
              </div>
              {staffing.worst && (
                <div className="verdict" style={{ marginTop: 12 }}>
                  <span className="vi">!</span>
                  <div>
                    <b>
                      {staffing.worst.site.name} has the most idle chair time —
                      worth ~{fmtCompact(staffing.worst.openValueWk ?? 0)} a
                      week ({fmtCompact((staffing.worst.openValueWk ?? 0) * 52)}{" "}
                      a year).
                    </b>{" "}
                    If clinicians are in place, that gap is recall and
                    reactivation; if sessions have no clinician, it's a
                    recruitment question.
                  </div>
                </div>
              )}
            </section>
          )}

          {/* ZONE 3b — HEAD TO HEAD */}
          <section className="collapsible">
            <div className="sec-head" onClick={() => setH2hOpen((o) => !o)}>
              <h2>Head to Head</h2>
              <span className="sub">
                Any site vs the group average - or any other site
              </span>
              <span className="foldind">{h2hOpen ? "▾ hide" : "▸ show"}</span>
            </div>
            {h2hOpen && (
              <HeadToHead
                sites={vm.sites}
                periodDays={vm.periodDays}
                groupBreakEven={{
                  revenue: vm.opRevenue,
                  treatmentCost: vm.beTreatmentCost ?? 0,
                  operatingExpense: vm.beOperatingExpense ?? 0,
                  breakEvenSales: vm.groupBreakEvenSales ?? null,
                }}
              />
            )}
          </section>

          {/* ZONE 3c — NHS DELIVERY */}
          {vm.nhsHasClaims && (
            <section>
              <div className="sec-head">
                <h2>NHS Delivery &amp; Clawback Risk</h2>
                <span className="sub">
                  Fees awarded vs expected for the selected period - same
                  figures as the NHS page
                </span>
              </div>
              <div className="card efftable">
                <div className="nhshead">
                  <span>Contract</span>
                  <span>Expected</span>
                  <span>Awarded vs expected</span>
                  <span>Exposure</span>
                </div>
                {vm.nhsRows.map((r) => {
                  const fill =
                    r.status === "on-track"
                      ? "g"
                      : r.deliveredPct < 30
                        ? "r"
                        : "a";
                  return (
                    <div className="nhsrow" key={r.name}>
                      <div className="sn">{r.name}</div>
                      <div className="nv">{fmtCompact(r.expected)}</div>
                      <div className="nhstrack">
                        <div
                          className={`nhsfill ${fill}`}
                          style={{ width: pctW(r.deliveredPct) }}
                        />
                        <span className="nhspct">{r.deliveredPct}%</span>
                      </div>
                      <div
                        className={`nv strong ${r.status === "on-track" ? "ok" : r.deliveredPct < 30 ? "crit" : "warn"}`}
                      >
                        {r.status === "on-track"
                          ? "On track"
                          : fmtCompact(r.exposure)}
                      </div>
                    </div>
                  );
                })}
                <div className="effnote">
                  Exposure = expected fees not yet awarded on contracts running
                  behind. Group exposure: <b>{fmtCompact(vm.nhsExposure)}</b>.
                </div>
              </div>
            </section>
          )}

          {/* ZONE 3d — CASH RUNWAY */}
          <GroupCashRunway />

          {/* ZONE 3e — DEBT & DEALS (sample data — hidden until real feed is wired) */}
          {SHOW_DEBT_AND_DEALS && (
            <section>
              <div className="sec-head">
                <h2>Debt &amp; Deals</h2>
                <span className="sub">
                  Covenant headroom and acquisitions on their own curve
                </span>
                <span className="pill ind" style={{ marginLeft: "auto" }}>
                  Sample
                </span>
              </div>
              <div className="ddwrap">
                <div className="card" style={{ padding: "15px 16px" }}>
                  <div className="ddtitle">Bank covenant headroom</div>
                  <div className="ddbig">
                    1.21<span className="u">x</span>
                  </div>
                  <div className="ddsub">
                    Net debt £1.85m ÷ EBITDA (TTM) £1.53m · covenant max{" "}
                    <b>2.75x</b>
                  </div>
                  <div className="covtrack">
                    <div className="covfill" style={{ width: "44%" }} />
                    <div className="covtick" style={{ left: "100%" }} />
                  </div>
                  <div className="ddcap">
                    EBITDA can fall <b>£860k</b> before breach · worst month
                    this year: 1.44x · tested quarterly, next test 30 Sep
                  </div>
                  <div className="ddnote">
                    Breaching this is worse than any dip on the cash chart — it
                    alerts at 80% of covenant, before the bank calls you.
                  </div>
                </div>

                <div className="card" style={{ padding: "15px 16px" }}>
                  <div className="ddtitle">
                    Horsforth — acquired May 2026{" "}
                    <span className="pill ind">month 3 of 12 ramp</span>
                  </div>
                  <div className="legend" style={{ marginTop: 6 }}>
                    <span className="lk">
                      <span
                        className="ld"
                        style={{ background: "var(--gdb-series-1)" }}
                      />
                      Actual
                    </span>
                    <span className="lk">
                      <span className="ld" style={{ background: "#008300" }} />
                      Acquisition case
                    </span>
                  </div>
                  <GroupAcquisitionRamp />
                  <div className="ddcap">
                    Month 3 revenue £89k vs case £90k —{" "}
                    <b style={{ color: "var(--gdb-good-ink)" }}>
                      on case (−1%)
                    </b>{" "}
                    · payback tracking 4.2 yrs vs 4.5 planned
                  </div>
                  <div className="ddnote">
                    Excluded from the same-site league and every group average
                    until month 12 — new acquisitions get judged against their
                    deal case, not the group.
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* ZONE 4 — FINANCIAL ALERTS */}
          {vm.alerts.length > 0 && (
            <section>
              <div className="sec-head">
                <h2>Financial Alerts</h2>
                <span className="sub">
                  Only what carries money or risk - ranked
                </span>
              </div>
              <div className="card alerts">
                {vm.alerts.slice(0, 6).map((a, i) => (
                  <div className="alert" key={i}>
                    <div className={`ico ${a.sev}`}>
                      {a.sev === "r" ? "!" : a.sev === "a" ? "⚑" : "▲"}
                    </div>
                    <div className="atxt">
                      <b>
                        {a.title}{" "}
                        {a.chips.map((c) => (
                          <span className="sitechip" key={c}>
                            {c}
                          </span>
                        ))}
                      </b>
                      {a.sub && <div className="asub">{a.sub}</div>}
                    </div>
                    <div className={`aval ${a.sev}`}>{a.value}</div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ZONE 5 — NEXT MOVES */}
          {vm.moves.length > 0 && (
            <section>
              <div className="sec-head">
                <h2>
                  Your Next {vm.moves.length} Move
                  {vm.moves.length === 1 ? "" : "s"}
                </h2>
                <span className="sub">
                  Ranked by financial impact - from this period's live figures
                </span>
              </div>
              <div className="moves">
                {vm.moves.slice(0, 3).map((m, i) => (
                  <div className="card move" key={i}>
                    <div className="rank">
                      #{i + 1} · {m.due}
                    </div>
                    <div className={`flag ${m.flag}`} />
                    <div className="mtitle">{m.title}</div>
                    <div className={`mimpact ${m.flag}`}>{m.impact}</div>
                    <div className="mwhy">{m.why}</div>
                    <div className="ownerrow">
                      <span className="avatar">{m.initials}</span>
                      <span className="oname">{m.owner}</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <div className="foot">
            DentPulse Group - one view across every practice. Estimated value,
            health score and the £-impact of each move are indicative and not a
            substitute for advice from your accountant.
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
