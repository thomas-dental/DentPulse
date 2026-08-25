import { ScopeBar } from "./ScopeBar";
import { Bar } from "./Bar";
import { Stat } from "./Stat";
import { LedgerLabel } from "./LedgerLabel";
import { CostToServeDetail } from "./CostToServeDetail";
import { gbp, nn } from "./format";
import { useMarginData } from "./useMarginData";

export function MarginTab() {
  const d = useMarginData();

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

  const distMax = Math.max(1, ...d.distribution.map((b) => b.count));

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
                  <td>{gbp(s.netCash)}</td>
                  <td>{gbp(s.costToServe)}</td>
                  <td style={{ color: s.contribution >= 0 ? "var(--mpi-moss)" : "var(--mpi-brick)" }}>
                    {gbp(s.contribution)}
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
                <td>{gbp(d.totalRevenue)}</td>
                <td>{gbp(d.totalCosts)}</td>
                <td style={{ color: d.contribution >= 0 ? "var(--mpi-moss)" : "var(--mpi-brick)" }}>
                  {gbp(d.contribution)}
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
                    {r.amount < 0 ? `−${gbp(Math.abs(r.amount))}` : gbp(r.amount)}
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
                    {gbp(r.amount)}
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
        const loss = (d.distribution[0]?.count ?? 0) + (d.distribution[1]?.count ?? 0);
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
            <p className="mpi-eyebrow">Margin per member — monthly contribution after time-costed appointments</p>
            <p className="mpi-subhead">
              {nn(loss)} members ({lossPct}%) cost more to serve than they pay
            </p>
            <div className="mpi-bars">
              {d.distribution.map((b, i) => (
                <Bar
                  key={b.label}
                  label={b.label}
                  segments={[
                    { pct: (b.count / distMax) * 100, color: DIST_COLORS[i] ?? "var(--mpi-verd)" },
                    { pct: 100 - (b.count / distMax) * 100, color: "#F0EEE9" },
                  ]}
                  value={nn(b.count)}
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
          v={gbp(d.discountForgone)}
          note="vs private fee-per-item"
          calc={d.discountForgoneCalc}
        />
        <Stat
          k="Chair time displaced"
          v={gbp(d.chairTimeDisplaced)}
          note="at private hourly yield"
          calc={d.chairTimeDisplacedCalc}
        />
        <Stat
          k="Unredeemed entitlement"
          v={`+${gbp(d.unredeemedEntitlement)}`}
          note="sleeping · churn risk"
          tone="up"
          calc={d.unredeemedEntitlementCalc}
        />
        <Stat
          k="Private spend uplift"
          v={`${d.privateSpendUplift >= 0 ? "+" : "−"}${gbp(Math.abs(d.privateSpendUplift))}`}
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
                    <td>{gbp(c.planPerPatient)}</td>
                    <td>{gbp(c.nonPlanPerPatient)}</td>
                    <td style={{ color: gap >= 0 ? "var(--mpi-moss)" : "var(--mpi-brick)" }}>
                      {gap >= 0 ? "+" : "−"}{gbp(Math.abs(gap))}
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
                <td>{gbp(d.categorySpend.reduce((s, c) => s + c.planPerPatient, 0))}</td>
                <td>{gbp(d.categorySpend.reduce((s, c) => s + c.nonPlanPerPatient, 0))}</td>
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
                    return `${totalGap >= 0 ? "+" : "−"}${gbp(Math.abs(totalGap))}`;
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
          Cost to serve (monthly) is computed per delivered treatment. Labour is priced from the delivering
          provider's own current Split Configuration (per-hour, flat percentage, sliding-scale or per-case —
          whichever that person is actually set to), the same numbers their own Contract details tab shows — not
          one house rate applied to everyone, and not tied to any contract date. Falls back to Treatment Setup's
          generic rate only when a provider's configured method has no rate set, flagged in "Show" below.
          Materials/lab and the chair-hour overhead rate still come from Treatment
          Setup, same catalog used across the app — not an estimate. Clinician/hygiene hours are the real appointment window for
          each matched member's delivered treatment (start to finish, from Dentally), falling back to the
          Treatment Setup catalog's own duration only when an appointment has no recorded window — so the
          hours shown are scoped to these plan members' visits specifically, the same visits behind the £
          figures next to them. Margin per member includes every matched member, not only those with a visit
          this month — a member with no delivered treatment has £0 cost, so their margin is their full fee.
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
