import { useState } from "react";
import { Link } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { usePaymentPlanEntitlement } from "@/hooks/usePaymentPlanEntitlement";
import { ScopeBar } from "./ScopeBar";
import { nn } from "./format";
import { useSettingsData, type MappedPaymentPlan } from "./useSettingsData";

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

/** Exam/hygiene/xray count editor for a Practice Plan row — one set of
 *  inputs regardless of how many Dentally payment plans that row maps to
 *  (e.g. "Registration" → R&I + Private); saving applies the same
 *  entitlement to every mapped plan id at once, since from the practice's
 *  side it's one plan with one entitlement. Exam/hygiene start from the
 *  first mapped plan's override if set, else its Dentally-synced value (so
 *  editing doesn't silently discard a real Dentally-configured number by
 *  showing 0). Xray has no Dentally-synced counterpart at all, so it starts
 *  from the override alone. */
function EntitlementEditor({ plans }: { plans: MappedPaymentPlan[] }) {
  const { setEntitlement, isSaving } = usePaymentPlanEntitlement();
  const first = plans[0];
  const [exams, setExams] = useState(String(first.overrideExam ?? first.dentallyExam ?? ""));
  const [hygiene, setHygiene] = useState(String(first.overrideHygiene ?? first.dentallyHygiene ?? ""));
  const [xray, setXray] = useState(String(first.overrideXray ?? ""));

  const save = () => {
    const examsNum = exams.trim() === "" ? null : Math.max(0, Number(exams));
    const hygieneNum = hygiene.trim() === "" ? null : Math.max(0, Number(hygiene));
    const xrayNum = xray.trim() === "" ? null : Math.max(0, Number(xray));
    if (examsNum === first.overrideExam && hygieneNum === first.overrideHygiene && xrayNum === first.overrideXray) return;
    setEntitlement({ paymentPlanIds: plans.map((p) => p.id), exams: examsNum, hygiene: hygieneNum, xray: xrayNum });
  };

  const label = plans.map((p) => p.name).join(", ");
  return (
    <div className="flex items-center gap-2 justify-end" style={{ opacity: isSaving ? 0.6 : 1 }}>
      <Input
        type="number"
        min={0}
        value={exams}
        onChange={(e) => setExams(e.target.value)}
        onBlur={save}
        className="h-7 w-14 text-right px-2"
        aria-label={`Exams included for ${label}`}
      />
      <span style={{ color: "var(--mpi-t3)", fontSize: "11px" }}>exam</span>
      <Input
        type="number"
        min={0}
        value={hygiene}
        onChange={(e) => setHygiene(e.target.value)}
        onBlur={save}
        className="h-7 w-14 text-right px-2"
        aria-label={`Hygiene visits included for ${label}`}
      />
      <span style={{ color: "var(--mpi-t3)", fontSize: "11px" }}>hygiene</span>
      <Input
        type="number"
        min={0}
        value={xray}
        onChange={(e) => setXray(e.target.value)}
        onBlur={save}
        className="h-7 w-14 text-right px-2"
        aria-label={`Xray visits included for ${label}`}
      />
      <span style={{ color: "var(--mpi-t3)", fontSize: "11px" }}>xray</span>
    </div>
  );
}

function Pill({ connected, label }: { connected: boolean; label: string }) {
  return (
    <div className="mpi-kv">
      <span>{label}</span>
      <span
        className="mpi-pill"
        style={{
          background: connected ? "var(--mpi-moss-soft)" : "var(--mpi-brick-soft)",
          color: connected ? "var(--mpi-moss)" : "var(--mpi-brick)",
        }}
      >
        {connected ? "Connected" : "Not connected"}
      </span>
    </div>
  );
}

export function SettingsTab() {
  const d = useSettingsData();

  // No full-tab loader — content renders straight away and values fill in
  // as queries land.
  return (
    <div className="mpi space-y-6">
      <ScopeBar title="Settings" subtitle="Everything here drives the numbers on Margin, Clinicians and Scenarios" />

      <div>
        <p className="mpi-eyebrow">Practice</p>
        <div className="mpi-card">
          <Kv label="Practice type" value={d.isMultiLocation ? `Group · ${d.locationNames.length} sites` : "Single site"} />
          <Kv label="Sites" value={d.locationNames.join(", ") || "—"} />
          <Kv label="Pricing" value={d.isMultiLocation ? "per site" : "single price list"} />
          <Kv label="Reporting default" value={d.isMultiLocation ? "group roll-up, drill to site" : "single practice"} />
        </div>
      </div>

      <div>
        <p className="mpi-eyebrow">Connections</p>
        <div className="mpi-card">
          <Pill connected={d.practicePlanConnected} label={`Practice Plan${d.practicePlanDetail ? ` · ${d.practicePlanDetail}` : ""}`} />
          <Pill connected={d.accountingConnected} label={d.accountingName} />
          <Pill connected={d.dentallyConnected ?? false} label="Dentally" />
        </div>
      </div>

      <div>
        <p className="mpi-eyebrow">Patient matching</p>
        <div className="mpi-card">
          <Kv label="Primary key" value="reference → Dentally id" />
          <Kv label="Fallback" value="legacy_id, then surname + DOB" />
          <Kv
            label="Matched"
            value={
              d.patientMatchedPct != null
                ? `${nn(d.patientMatchedCount)} of ${nn(d.patientTotalCount)} · ${d.patientMatchedPct}%`
                : "No uploaded members yet"
            }
            color={d.patientMatchedPct != null ? "var(--mpi-moss)" : undefined}
          />
        </div>
      </div>

      {d.planMappingLabels.length > 0 && (
        <div>
          <p className="mpi-eyebrow">Plan mapping</p>
          <div className="mpi-card">
            <Kv
              label="Practice Plan statement plans mapped to Dentally"
              value={`${nn(d.planMappingMappedCount)} of ${nn(d.planMappingLabels.length)}`}
              color={d.planMappingMappedCount === d.planMappingLabels.length ? "var(--mpi-moss)" : "var(--mpi-amber)"}
            />
          </div>
          <div className="mpi-card" style={{ marginTop: "8px" }}>
            <table className="mpi-tb">
              <thead>
                <tr>
                  <th className="l">Practice Plan</th>
                  <th className="l">Dentally payment plan</th>
                  <th>Entitlement</th>
                </tr>
              </thead>
              <tbody>
                {d.planMappingRows.map((r) => (
                  <tr key={r.label}>
                    <td>{r.label}</td>
                    <td className="sitecol">{r.dentallyPlanNames}</td>
                    <td className="sitecol">
                      {r.plans.length === 0 ? "—" : <EntitlementEditor plans={r.plans} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs mt-2" style={{ color: "var(--mpi-t3)" }}>
              Dentally has no exam/hygiene entitlement configured for most practices, and no x-ray entitlement
              field at all — set the real numbers here and they'll be used everywhere entitlement is shown
              (Capacity, Margin), overriding Dentally's own value if it has one. A row mapped to more than one
              Dentally plan (e.g. Registration → R&I, Private) applies the same entitlement to all of them.
            </p>
          </div>
        </div>
      )}

      <div>
        <p className="mpi-eyebrow">Cost assumptions</p>
        <div className="mpi-card text-sm" style={{ color: "var(--mpi-t2)" }}>
          Material cost, lab bill, therapist pay and hourly rate are set per treatment, not as a single
          practice-wide number.{" "}
          <Link to="/treatments/setup" className="text-primary hover:underline">
            Configure in Treatment Setup →
          </Link>
        </div>
      </div>
    </div>
  );
}
