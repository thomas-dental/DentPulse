import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { AccountMultiSelect } from "@/components/settings/AccountMultiSelect";
import { usePaymentPlanEntitlement } from "@/hooks/usePaymentPlanEntitlement";
import { useProviders } from "@/hooks/useProviders";
import { useLocations } from "@/hooks/useLocations";
import { useMembershipProviderMappings } from "@/hooks/useMembershipProviderMappings";
import { dentistNamesLikelyMatch } from "@/lib/dentistNameMatch";
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

/** Statement provider name → enterprise provider(s) + location. No selection
 *  leaves that name on the fuzzy matcher (lib/dentistNameMatch.ts) that
 *  already resolves it everywhere; an explicit pick overrides the fuzzy
 *  match, which is the only way to bridge names it can't ("Dr Israr Razaq
 *  2", married / preferred names, ambiguous near-duplicates). Multi-select:
 *  a statement bucket like "Hygiene Only" can cover several providers — its
 *  statement revenue is split equally between them, penny-exact, so the
 *  provider total always reconciles to the membership total. Location pins
 *  which site the statement figures belong to; "Provider's site" keeps the
 *  provider record's own location. */
function ProviderMappingSection({ labels }: { labels: string[] }) {
  // includeInactive — statements cover historical months, so a leaver's
  // statement name must still be mappable to their (now inactive) record.
  const { providers } = useProviders(undefined, null, { includeInactive: true });
  const { allAvailableLocations } = useLocations();
  // No isSaving dim/disable here: saves are optimistic (see the hook), and
  // flashing the card between rapid checkbox toggles was client-flagged as
  // "fluctuation".
  const { mappings, setMapping } = useMembershipProviderMappings();

  const byLabel = useMemo(
    () => new Map(mappings.map((m) => [m.provider_label, m])),
    [mappings],
  );

  // What the fuzzy matcher resolves each unmapped name to — shown as the
  // multi-select placeholder so the user can see whether a pick is needed.
  const autoMatchByLabel = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const label of labels) {
      const matches = providers.filter((p) => p.name && dentistNamesLikelyMatch(label, p.name));
      map.set(label, matches.length === 1 ? matches[0].name : null);
    }
    return map;
  }, [labels, providers]);

  // Location shown with each name (client request): several sites in a
  // group share near-identical practitioner names, so the site is the only
  // way to pick the right record. Searchable too (AccountMultiSelect
  // includes the label in its search value).
  const providerOptions = useMemo(() => {
    const locationNameById = new Map(allAvailableLocations.map((l) => [l.id, l.location_name]));
    return providers.map((p) => {
      const locName =
        (p.location_id ? locationNameById.get(p.location_id) : null) ??
        ((p as { practice_id?: string | null }).practice_id
          ? locationNameById.get((p as { practice_id?: string | null }).practice_id!)
          : null);
      return {
        value: p.id,
        label: `${p.name}${locName ? ` · ${locName}` : ""}${p.is_active === false ? " (inactive)" : ""}`,
      };
    });
  }, [providers, allAvailableLocations]);

  const labelByProviderId = useMemo(
    () => new Map(providerOptions.map((o) => [o.value, o.label])),
    [providerOptions],
  );

  const mappedCount = labels.filter((l) => (byLabel.get(l)?.provider_ids.length ?? 0) > 0).length;

  return (
    <div>
      <p className="mpi-eyebrow">Provider mapping</p>
      <div className="mpi-card">
        <Kv
          label="Statement providers mapped to a DentPulse provider"
          value={`${nn(mappedCount)} of ${nn(labels.length)}`}
          color={mappedCount === labels.length ? "var(--mpi-moss)" : "var(--mpi-amber)"}
        />
      </div>
      <div className="mpi-card" style={{ marginTop: "8px" }}>
        <table className="mpi-tb">
          <thead>
            <tr>
              <th className="l">Statement provider</th>
              <th className="l">DentPulse provider</th>
              <th className="l">Selected</th>
            </tr>
          </thead>
          <tbody>
            {labels.map((label) => {
              const mapping = byLabel.get(label);
              const autoName = autoMatchByLabel.get(label) ?? null;
              const selectedLabels = (mapping?.provider_ids ?? [])
                .map((id) => labelByProviderId.get(id))
                .filter((l): l is string => !!l);
              return (
                <tr key={label}>
                  <td>{label}</td>
                  <td>
                    <div className="w-[280px]">
                      <AccountMultiSelect
                        options={providerOptions}
                        value={mapping?.provider_ids ?? []}
                        itemNoun="provider"
                        placeholder={autoName ? `Auto — matches ${autoName}` : "Auto — no name match"}
                        className="min-h-8 h-8 text-sm"
                        onChange={(ids) =>
                          setMapping({
                            providerLabel: label,
                            providerIds: ids,
                            // Location select removed (client request) — the
                            // provider record's own site is the location.
                            locationIds: [],
                          })
                        }
                      />
                    </div>
                  </td>
                  <td className="sitecol">
                    {selectedLabels.length > 0 ? (
                      <>
                        {selectedLabels.slice(0, 6).map((l) => (
                          <div key={l}>{l}</div>
                        ))}
                        {selectedLabels.length > 6 && (
                          <div style={{ color: "var(--mpi-t3)" }}>+{selectedLabels.length - 6} more</div>
                        )}
                      </>
                    ) : autoName ? (
                      `Auto — ${autoName}`
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="text-xs mt-2" style={{ color: "var(--mpi-t3)" }}>
          Statement names rarely match provider records exactly — Auto resolves them by name where it can.
          Pick providers here when Auto shows no match (or matches the wrong person) and their figures
          will be attributed correctly on Clinicians and provider production. A name mapped to several
          providers (e.g. a "Hygiene Only" statement) splits its statement revenue equally between them —
          the total always matches the membership revenue to the penny. Each provider's own site (shown
          with their name) is where the figures land.
        </p>
      </div>
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

      {d.providerMappingLabels.length > 0 && <ProviderMappingSection labels={d.providerMappingLabels} />}

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
