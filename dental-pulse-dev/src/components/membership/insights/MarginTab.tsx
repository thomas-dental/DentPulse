import { useState } from "react";
import { ScopeBar } from "./ScopeBar";
import { Bar } from "./Bar";
import { Stat } from "./Stat";
import { LedgerLabel } from "./LedgerLabel";
import { CostToServeDetail } from "./CostToServeDetail";
import { gbpExact, nn } from "./format";
import { useMarginData } from "./useMarginData";

export function MarginTab() {
  const d = useMarginData();
  // Margin-per-member view: one month's fee vs that month's plan-covered
  // cost, or 12× fee vs a trailing year of plan servicing (the entitlement
  // is annual, so a visit-heavy month alone can misread as a loss).
  const [distView, setDistView] = useState<"monthly" | "annual">("monthly");

  // No full-tab loader — content renders straight away; the empty state
  // waits for loading to finish so it can't flash mid-fetch.
  if (!d.isLoading && !d.hasUploadData) {
    return (
      <div className="mpi space-y-6">
        <ScopeBar title="Margin" subtitle="Cash received against cost to serve" />
        <div className="mpi-card text-sm text-center py-8" style={{ color: "var(--mpi-t3)" }}>
          Upload membership data on the Plan Revenue tab to see margin.
        </div>
      </div>
    );
  }

  return (
    <div className="mpi space-y-6">
      <ScopeBar title="Margin" subtitle="Cash received against cost to serve, and what the plan gives up" />

      {d.bySite.length > 1 && (
        <div className="mpi-card">
          <p className="mpi-eyebrow">Contribution by site — where the plan earns and where it leaks</p>
          <table className="mpi-tb">
            <thead>
              <tr>
                <th className="l">Site</th>
                <th>Net cash</th>
                <th>Cost to serve</th>
                <th>Contribution</th>
                <th>Margin</th>
                <th>Opportunity net</th>
                <th className="l">Verdict</th>
              </tr>
            </thead>
            <tbody>
              {d.bySite.map((s) => (
                <tr key={s.locationId}>
                  <td>{s.name}</td>
                  <td>{gbpExact(s.netCash)}</td>
                  <td>{gbpExact(s.costToServe)}</td>
                  <td style={{ color: s.contribution >= 0 ? "var(--mpi-moss)" : "var(--mpi-brick)" }}>
                    {gbpExact(s.contribution)}
                  </td>
                  <td>{s.marginPct != null ? `${s.marginPct}%` : "—"}</td>
                  <td>—</td>
                  <td className="sitecol">
                    {s.verdict && (
                      <span className={`mpi-tag ${s.verdict === "earning" ? "t-good" : "t-risk"}`}>
                        {s.verdict === "earning" ? "Earning" : "Destroying value"}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              <tr className="tot">
                <td>Group</td>
                <td>{gbpExact(d.totalRevenue)}</td>
                <td>{gbpExact(d.totalCosts)}</td>
                <td style={{ color: d.contribution >= 0 ? "var(--mpi-moss)" : "var(--mpi-brick)" }}>
                  {gbpExact(d.contribution)}
                </td>
                <td>{d.contributionPct != null ? `${d.contributionPct}%` : "—"}</td>
                <td>—</td>
                <td className="sitecol"></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <div className="mpi-two mpi-mb">
        <div className="mpi-card">
          <p className="mpi-eyebrow">Cash received</p>
          <table className="mpi-led">
            <tbody>
              {d.cashReceivedLedger.map((r) => (
                <tr key={r.label} className={r.isTotal ? "tot" : undefined}>
                  <td>{r.label}</td>
                  <td style={r.isNegative ? { color: "var(--mpi-brick)" } : undefined}>
                    {r.amount < 0 ? `−${gbpExact(Math.abs(r.amount))}` : gbpExact(r.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mpi-card">
          <p className="mpi-eyebrow">Cost to serve</p>
          <table className="mpi-led">
            <tbody>
              {d.costToServeLedger.map((r) => (
                <tr key={r.label} className={r.isTotal ? "tot" : undefined}>
                  <td><LedgerLabel label={r.label} calc={r.calc} /></td>
                  <td style={r.isTotal ? { color: r.amount >= 0 ? "var(--mpi-moss)" : "var(--mpi-brick)" } : undefined}>
                    {gbpExact(r.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mpi-mb">
        <CostToServeDetail lineItems={d.costToServeLineItems} totalPracticeHygieneHours={d.totalPracticeHygieneHours} />
      </div>

      {d.costedMemberCount > 0 && (() => {
        const activeDist = distView === "monthly" ? d.distribution : d.annualDistribution;
        const activeCalc = distView === "monthly" ? d.distributionCalc : d.annualDistributionCalc;
        const activeMax = Math.max(1, ...activeDist.map((b) => b.count));
        const loss = (activeDist[0]?.count ?? 0) + (activeDist[1]?.count ?? 0);
        const lossPct = d.costedMemberCount > 0 ? Math.round((loss / d.costedMemberCount) * 100) : 0;
        const DIST_COLORS = [
          "var(--mpi-brick)",
          "var(--mpi-brick)",
          "var(--mpi-amber)",
          "var(--mpi-verd)",
          "var(--mpi-verd)",
          "var(--mpi-verd-deep)",
        ];
        return (
          <div className="mpi-card">
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px" }}>
              <p className="mpi-eyebrow">
                <LedgerLabel
                  label={
                    distView === "monthly"
                      ? d.isMultiMonth
                        ? "Margin per member — contribution over the selected months after plan-covered appointments"
                        : "Margin per member — monthly contribution after plan-covered appointments"
                      : "Margin per member — 12-month contribution (annual entitlement view)"
                  }
                  calc={activeCalc}
                />
              </p>
              <div style={{ display: "flex", gap: "4px", flexShrink: 0 }}>
                {(["monthly", "annual"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setDistView(v)}
                    className={`mpi-tag ${distView === v ? "t-good" : ""}`}
                    style={{ cursor: "pointer", border: "none" }}
                  >
                    {v === "monthly" ? (d.isMultiMonth ? "Selected months" : "Monthly") : "Annual (12 mo)"}
                  </button>
                ))}
              </div>
            </div>
            <p className="mpi-subhead">
              {nn(loss)} members ({lossPct}%) cost more to serve than they pay
              {distView === "annual" ? " over 12 months" : ""}
            </p>
            <div className="mpi-bars">
              {activeDist.map((b, i) => (
                <Bar
                  key={b.label}
                  label={b.label}
                  segments={[
                    { pct: (b.count / activeMax) * 100, color: DIST_COLORS[i] ?? "var(--mpi-verd)" },
                    { pct: 100 - (b.count / activeMax) * 100, color: "#F0EEE9" },
                  ]}
                  value={nn(b.count)}
                  calc={b.calc}
                />
              ))}
            </div>
          </div>
        );
      })()}

      <p className="mpi-eyebrow">Opportunity cost — value given up, not cash lost</p>
      <div className="mpi-stats mpi-mb">
        <Stat
          k="Discount forgone"
          v={gbpExact(d.discountForgone)}
          note="vs private fee-per-item"
          calc={d.discountForgoneCalc}
        />
        <Stat
          k="Chair time displaced"
          v={gbpExact(d.chairTimeDisplaced)}
          note="at private hourly yield"
          calc={d.chairTimeDisplacedCalc}
        />
        <Stat
          k="Unredeemed entitlement"
          v={`+${gbpExact(d.unredeemedEntitlement)}`}
          note="sleeping · churn risk"
          tone="up"
          calc={d.unredeemedEntitlementCalc}
        />
        <Stat
          k="Private spend uplift"
          v={`${d.privateSpendUplift >= 0 ? "+" : "−"}${gbpExact(Math.abs(d.privateSpendUplift))}`}
          note="plan vs non-plan cohort"
          tone={d.privateSpendUplift >= 0 ? "up" : "down"}
          calc={d.privateSpendUpliftCalc}
        />
      </div>

      <div className="mpi-card mpi-mb">
        <p className="mpi-eyebrow">Private spend beyond the plan — annual per patient, by treatment category</p>
        {d.categorySpend.length === 0 ? (
          <div className="text-sm text-center py-6" style={{ color: "var(--mpi-t3)" }}>
            No private treatment activity found for either cohort in the trailing 12 months.
          </div>
        ) : (
          <table className="mpi-tb">
            <thead>
              <tr>
                <th className="l">Category</th>
                <th>Plan members</th>
                <th>Private, no plan</th>
                <th>Gap</th>
                <th className="l" style={{ width: "32%" }}>Plan vs no plan</th>
              </tr>
            </thead>
            <tbody>
              {d.categorySpend.map((c) => {
                const gap = c.planPerPatient - c.nonPlanPerPatient;
                const catMax = Math.max(1, ...d.categorySpend.map((x) => Math.max(x.planPerPatient, x.nonPlanPerPatient)));
                return (
                  <tr key={c.category}>
                    <td>{c.category}</td>
                    <td>{gbpExact(c.planPerPatient)}</td>
                    <td>{gbpExact(c.nonPlanPerPatient)}</td>
                    <td style={{ color: gap >= 0 ? "var(--mpi-moss)" : "var(--mpi-brick)" }}>
                      {gap >= 0 ? "+" : "−"}{gbpExact(Math.abs(gap))}
                    </td>
                    <td className="sitecol">
                      <div style={{ height: "7px", marginBottom: "3px", background: "#F0EEE9", borderRadius: "3px", overflow: "hidden" }}>
                        <div style={{ width: `${(c.planPerPatient / catMax) * 100}%`, height: "100%", background: "var(--mpi-verd)" }} />
                      </div>
                      <div style={{ height: "7px", background: "#F0EEE9", borderRadius: "3px", overflow: "hidden" }}>
                        <div style={{ width: `${(c.nonPlanPerPatient / catMax) * 100}%`, height: "100%", background: "var(--mpi-t3)" }} />
                      </div>
                    </td>
                  </tr>
                );
              })}
              <tr className="tot">
                <td>Total per patient</td>
                <td>{gbpExact(d.categorySpend.reduce((s, c) => s + c.planPerPatient, 0))}</td>
                <td>{gbpExact(d.categorySpend.reduce((s, c) => s + c.nonPlanPerPatient, 0))}</td>
                <td
                  style={{
                    color:
                      d.categorySpend.reduce((s, c) => s + c.planPerPatient - c.nonPlanPerPatient, 0) >= 0
                        ? "var(--mpi-moss)"
                        : "var(--mpi-brick)",
                  }}
                >
                  {(() => {
                    const totalGap = d.categorySpend.reduce((s, c) => s + c.planPerPatient - c.nonPlanPerPatient, 0);
                    return `${totalGap >= 0 ? "+" : "−"}${gbpExact(Math.abs(totalGap))}`;
                  })()}
                </td>
                <td className="sitecol"></td>
              </tr>
            </tbody>
          </table>
        )}
      </div>

      <div className="mpi-note n-info">
        <span className="tx">
          Cost to serve covers the same statement months as the date filter (a single month when one month is
          selected) and is computed per delivered treatment. Labour is priced from the delivering
          provider's own current Split Configuration (per-hour, flat percentage, sliding-scale or per-case —
          whichever that person is actually set to), the same numbers their own Contract details tab shows — not
          one house rate applied to everyone, and not tied to any contract date. Falls back to Treatment Setup's
          generic rate only when a provider's configured method has no rate set, flagged in "Show" below.
          Materials/lab costs still come from Treatment
          Setup, same catalog used across the app — not an estimate. Cost to serve is labour plus
          materials/lab only — no chair-overhead or finance-fee allocation is added on top. Only
          plan-covered visits are costed against the plan: visits charged at £0, exams, hygiene, x-rays and
          "Plan"-named treatments. Private treatment billed separately to a plan member (an extraction, a
          crown) is excluded from every figure here — it carries its own invoice and its own revenue — and
          the amount excluded is shown in the Margin-per-member ⓘ. The Annual (12 mo) view compares 12× the
          monthly fee against a trailing year of plan-covered visits priced the same way (percentage-paid
          labour uses each provider's current derived rate) — the entitlement is annual, so a single
          visit-heavy month is not, by itself, a losing member. X-ray items
          (bitewings, periapicals, OPGs) carry no time or labour cost of their own and don't appear in the
          Clinician/Hygiene visit tables — the image is taken within the exam or hygiene visit whose minutes
          already cover it; their material cost still counts in Materials and lab. Clinician/hygiene hours are the real appointment window
          (start to finish, from Dentally) for each matched member's visit — when several treatments were
          delivered in one appointment its time is divided between them, never counted twice — falling back to
          the membership Treatments tab's configured minutes, then the Treatment Setup catalog's duration, only
          when an appointment has no recorded window. The hours shown are scoped to these plan members' visits
          specifically, the same visits behind the £ figures next to them. Margin per member includes every matched member, not only those with a visit
          in the period — a member with no delivered treatment has £0 cost, so their margin is their full fee.
          "Chair time displaced" values plan hours at the non-plan cohort's real £/hour, using the same real
          appointment-window duration as Cost to serve. Opportunity cost and the category table are annual (trailing 12 months), a different
          window to the monthly ledgers above, matching how entitlement itself is annual. The "non-plan"
          comparison cohort is patients with no Dentally payment plan at all — a real but broad definition, not
          matched by age/treatment history to your plan members. A distinct Practice Plan/Denplan admin-fee
          line isn't shown in Cash received — net cash already nets it out, but it isn't itemised anywhere in
          this app's data.
        </span>
      </div>
    </div>
  );
}
