import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { useFilters } from "@/contexts/FilterContext";
import { useOrganization } from "@/hooks/useOrganization";
import { useLocations } from "@/hooks/useLocations";
import { useChairMetrics } from "@/hooks/useChairMetrics";
import { useMembershipUploadData } from "@/hooks/useMembershipUploadData";
import { useMembershipPerformance } from "@/hooks/useMembershipPerformance";
import { getOpCostByPlatform } from "@/services/integrations/plCostService";
import { ScopeBar } from "./ScopeBar";
import { Stat } from "./Stat";
import { useChurnData } from "./useChurnData";
import { gbp, nn } from "./format";

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function Lever({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
}) {
  return (
    <div className="mpi-lever">
      <label>{label}</label>
      <Slider value={[value]} min={min} max={max} step={step} onValueChange={([v]) => onChange(v)} className="flex-1" />
      <output className="num">{format(value)}</output>
    </div>
  );
}

/** Live what-if calculator seeded with real current membership revenue and
 *  member counts (same source as the Plan Revenue tab), per-site when no
 *  location filter is active — mirrors the design mockup's Group/Single-site
 *  behaviour via the page's own top-bar location filter. The mockup's "Plan
 *  A to B" lever (move N% from a named cheap plan to a named pricier one,
 *  at a flat +£4/upgrade) has no real analogue for a generic multi-plan org
 *  — this uses the org's own two lowest-fee plans with real members and the
 *  REAL fee gap between them instead of a fabricated flat amount; hidden
 *  when fewer than two such plans exist. Break-even's "Observed churn"
 *  column is real (patient_plan_membership_events via useChurnData), not a
 *  user-set assumption — the mockup's own churn figures are real per-site
 *  numbers baked into its demo data, not something the practice sets. */
export function ScenariosTab() {
  const { selectedLocationId } = useFilters();
  const { organizationId } = useOrganization();
  const { allAvailableLocations } = useLocations();
  const { members: uploadedMembers, totalRevenue: baseMrr, totalMembers: baseMembers, isLoading: uploadLoading } =
    useMembershipUploadData();
  const { planOverviews, isLoading: perfLoading } = useMembershipPerformance();
  const churn = useChurnData();

  const isAll = !selectedLocationId;

  // Real "cost per surgery hour", current vs previous calendar month — Xero/
  // QuickBooks/iplicit total operating cost (account code 'TC', same source
  // as Profit Planning's OCPSPD) ÷ real chair hours (get_chair_metrics, same
  // as Capacity/Chairs). Answers "does my plan fee still cover my real cost
  // per hour" instead of following Practice Plan's own uplift suggestion.
  const now = new Date();
  const curMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const curMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

  const curChairQ = useChairMetrics({ startDate: curMonthStart, endDate: curMonthEnd });
  const prevChairQ = useChairMetrics({ startDate: prevMonthStart, endDate: prevMonthEnd });

  const opCostQ = useQuery({
    queryKey: ["insights_scenarios_op_cost", organizationId, selectedLocationId ?? "all", curMonthStart.getTime()],
    enabled: !!organizationId,
    queryFn: async () => {
      const [current, previous] = await Promise.all([
        getOpCostByPlatform(organizationId!, toDateStr(curMonthStart), toDateStr(curMonthEnd), "TC", selectedLocationId),
        getOpCostByPlatform(organizationId!, toDateStr(prevMonthStart), toDateStr(prevMonthEnd), "TC", selectedLocationId),
      ]);
      return { current: current.amount, previous: previous.amount, platform: current.platform };
    },
  });

  const costPerHour = useMemo(() => {
    const hoursFor = (rows: typeof curChairQ.data) =>
      (rows ?? [])
        .filter((r) => !selectedLocationId || r.location_id === selectedLocationId)
        .reduce((s, r) => s + (r.available_hours || 0), 0);
    const curHours = hoursFor(curChairQ.data);
    const prevHours = hoursFor(prevChairQ.data);
    const current = curHours > 0 && opCostQ.data?.current != null ? opCostQ.data.current / curHours : null;
    const previous = prevHours > 0 && opCostQ.data?.previous != null ? opCostQ.data.previous / prevHours : null;
    return { current, previous, platform: opCostQ.data?.platform ?? null };
  }, [curChairQ.data, prevChairQ.data, opCostQ.data, selectedLocationId]);

  const sites = useMemo(() => {
    const byLoc = new Map<string, { locationId: string; name: string; mrr: number; members: number }>();
    for (const loc of allAvailableLocations) {
      byLoc.set(loc.id, { locationId: loc.id, name: loc.location_name, mrr: 0, members: 0 });
    }
    for (const m of uploadedMembers) {
      if (!m.location_id) continue;
      const row = byLoc.get(m.location_id);
      if (!row) continue;
      row.mrr += m.net_due || 0;
      row.members += 1;
    }
    return Array.from(byLoc.values()).filter((r) => r.members > 0);
  }, [allAvailableLocations, uploadedMembers]);

  const scopedSites = isAll ? sites : sites.filter((s) => s.locationId === selectedLocationId);

  const [uplift, setUplift] = useState<Record<string, number>>({});
  const [newMembers, setNewMembers] = useState(0);
  const [churnSaved, setChurnSaved] = useState(0);
  const [upgradePct, setUpgradePct] = useState(0);

  const avgMemberValue = baseMembers > 0 ? baseMrr / baseMembers : 0;

  // Real two-cheapest-plans-with-members pair for the upgrade lever, instead
  // of the mockup's fabricated named "Plan A"/"Plan B" + flat £4 delta.
  const upgradePair = useMemo(() => {
    const withMembers = planOverviews.filter((p) => p.members > 0).sort((a, b) => a.monthlyFee - b.monthlyFee);
    if (withMembers.length < 2) return null;
    const from = withMembers[0];
    const to = withMembers.find((p) => p.monthlyFee > from.monthlyFee) ?? withMembers[1];
    if (to.planId === from.planId) return null;
    return { from, to, delta: to.monthlyFee - from.monthlyFee };
  }, [planOverviews]);

  const reset = () => {
    setUplift({});
    setNewMembers(0);
    setChurnSaved(0);
    setUpgradePct(0);
  };

  const isLoading = uploadLoading || perfLoading;

  // No full-tab loader — the empty state waits for loading to finish so it
  // can't flash mid-fetch.
  if (!isLoading && baseMembers === 0) {
    return (
      <div className="mpi space-y-6">
        <ScopeBar title="Scenarios" subtitle="What-if calculator" />
        <div className="mpi-card text-sm text-center py-8" style={{ color: "var(--mpi-t3)" }}>
          Upload membership data on the Plan Revenue tab to run scenarios.
        </div>
      </div>
    );
  }

  const upliftRevenue = scopedSites.reduce((s, site) => s + site.members * (uplift[site.locationId] ?? 0), 0);
  const upgradeRevenue = upgradePair ? Math.round((upgradePair.from.members * upgradePct) / 100) * upgradePair.delta : 0;
  const members = baseMembers + newMembers + churnSaved;
  const mrr = baseMrr + upliftRevenue + (newMembers + churnSaved) * avgMemberValue + upgradeRevenue;
  const delta = mrr - baseMrr;

  const breakEvenRows = scopedSites.map((site) => {
    const u = uplift[site.locationId] ?? 0;
    const churnRow = churn.byLocation.get(site.locationId);
    if (u <= 0) {
      return { site, uplift: u, adds: 0, breakEven: null as number | null, pctOfBase: null as number | null, churnPct: churnRow?.churnPct ?? null, headroom: "No change" as const };
    }
    const memberValue = site.members > 0 ? site.mrr / site.members : avgMemberValue;
    const breakEven = Math.round((site.members * u) / (memberValue + u));
    const pctOfBase = site.members > 0 ? (breakEven / site.members) * 100 : 0;
    const observedChurn = churnRow?.churnPct ?? null;
    const headroom =
      observedChurn == null
        ? ("Unknown" as const)
        : pctOfBase > observedChurn * 2
          ? ("Comfortable" as const)
          : pctOfBase > observedChurn
            ? ("Tight" as const)
            : ("Too tight" as const);
    return { site, uplift: u, adds: site.members * u, breakEven, pctOfBase, churnPct: observedChurn, headroom };
  });

  return (
    <div className="mpi space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <ScopeBar title="Scenarios" subtitle={`Baseline ${gbp(baseMrr)} net a month · ${isAll ? "all sites" : scopedSites[0]?.name ?? ""}`} />
      </div>
      <div className="flex justify-end -mt-4">
        <Button variant="outline" size="sm" onClick={reset}>
          Reset
        </Button>
      </div>

      {costPerHour.current != null && (
        <div className="mpi-card">
          <p className="mpi-eyebrow">Real cost per surgery hour — is your plan fee keeping up?</p>
          <div className="mpi-stats">
            <Stat
              k="Cost per surgery hour"
              v={gbp(costPerHour.current)}
              note={
                costPerHour.previous != null
                  ? `${costPerHour.current >= costPerHour.previous ? "+" : "−"}${gbp(Math.abs(costPerHour.current - costPerHour.previous))} vs last month`
                  : "this month"
              }
              tone={costPerHour.previous != null ? (costPerHour.current >= costPerHour.previous ? "down" : "up") : undefined}
              tooltip={`${opCostQ.data?.platform ?? "Accounting"} total operating cost (wages, associate rates, lab, materials, rent, rates — account code 'TC') this month ÷ real available chair hours for the same period.`}
            />
            <Stat
              k="Plan fee per patient"
              v={gbp(avgMemberValue)}
              note="a month, for comparison"
              tooltip="Same average revenue per member used by the levers below — not directly comparable £-for-£ to an hourly cost, since it depends how many chair-hours a typical plan patient actually consumes a month, but the trend direction is the real signal."
            />
          </div>
        </div>
      )}

      <div className="mpi-card space-y-3">
        <p className="mpi-eyebrow mb-0">{isAll ? "Price uplift by site" : "Price uplift"}</p>
        {scopedSites.map((site) => (
          <Lever
            key={site.locationId}
            label={isAll ? site.name : "Uplift a month"}
            value={uplift[site.locationId] ?? 0}
            min={0}
            max={3}
            step={0.25}
            onChange={(v) => setUplift((prev) => ({ ...prev, [site.locationId]: v }))}
            format={(v) => `£${v.toFixed(2)}`}
          />
        ))}
      </div>

      <div className="mpi-card space-y-3">
        <p className="mpi-eyebrow mb-0">Other levers</p>
        <Lever label="New members" value={newMembers} min={0} max={300} step={5} onChange={setNewMembers} format={String} />
        <Lever label="Churn saved" value={churnSaved} min={0} max={200} step={5} onChange={setChurnSaved} format={String} />
        {upgradePair && (
          <Lever
            label={`${upgradePair.from.planName} to ${upgradePair.to.planName}`}
            value={upgradePct}
            min={0}
            max={30}
            step={1}
            onChange={setUpgradePct}
            format={(v) => `${v}%`}
          />
        )}
      </div>

      <div className="mpi-stats">
        <Stat
          k="Net cash a month"
          v={gbp(mrr)}
          note={`${delta >= 0 ? "+" : "−"}${gbp(Math.abs(delta))} vs today`}
          tone={delta >= 0 ? "up" : "down"}
        />
        <Stat k="Annual impact" v={gbp(delta * 12)} note="incremental, full year" />
        <Stat k="Members" v={nn(members)} note={`from ${nn(baseMembers)} today`} />
      </div>

      <div className="mpi-card">
        <p className="mpi-eyebrow">Break-even on the uplift</p>
        <p className="text-xs mb-3" style={{ color: "var(--mpi-t2)" }}>
          How many members you could lose before the uplift leaves you worse off than today — set against churn
          actually observed
        </p>
        <table className="mpi-tb">
          <thead>
            <tr>
              <th className="l">Site</th>
              <th>Uplift</th>
              <th>Adds a month</th>
              <th>Break-even</th>
              <th>% of base</th>
              <th>Observed churn</th>
              <th className="l">Headroom</th>
            </tr>
          </thead>
          <tbody>
            {breakEvenRows.map((r) => (
              <tr key={r.site.locationId}>
                <td>{r.site.name}</td>
                <td>£{r.uplift.toFixed(2)}</td>
                <td>{r.adds > 0 ? gbp(r.adds) : "—"}</td>
                <td>{r.breakEven != null ? nn(r.breakEven) : "—"}</td>
                <td>{r.pctOfBase != null ? `${r.pctOfBase.toFixed(1)}%` : "—"}</td>
                <td>{r.churnPct != null ? `${r.churnPct.toFixed(1)}%` : "—"}</td>
                <td className="sitecol">
                  <span
                    className="mpi-tag"
                    style={{
                      background:
                        r.headroom === "Comfortable" ? "var(--mpi-moss-soft)" : r.headroom === "Tight" ? "var(--mpi-amber-soft)" : r.headroom === "Too tight" ? "var(--mpi-brick-soft)" : "var(--mpi-verd-soft)",
                      color:
                        r.headroom === "Comfortable" ? "var(--mpi-moss)" : r.headroom === "Tight" ? "var(--mpi-amber)" : r.headroom === "Too tight" ? "var(--mpi-brick)" : "var(--mpi-verd-deep)",
                    }}
                  >
                    {r.headroom}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mpi-note n-info">
        <span className="tx">
          A new member is valued at {gbp(avgMemberValue)}/month — your current average revenue per member, not a
          separately itemised admin fee (this app has no distinct Practice Plan/Denplan deduction figure to
          apply per £1 of uplift).
        </span>
      </div>
    </div>
  );
}
