import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { ukDayStartInstant } from '@/utils/dateRangeUtils';

// ── Appointment-volume basis for the Lab Fees / Materials forecast ──
// Drives those cost rows from CLINICAL WORKLOAD: how many appointments each
// practitioner has BOOKED in each of the next 13 weeks, plus how many they did
// over the trailing 13 weeks. The cashflow forecast turns the trailing window into
// an average real-cash cost per appointment (real lab/material invoices ÷ trailing
// appointments) and multiplies the booked appointments per week by it — so the
// number ties to actual cash but flexes with how busy each week is.
//
// Window basis (matches Dentally's Practitioner Activity report):
//   • TRAILING (the rate's denominator) counts ONLY completed appointments
//     (apmt_state === 'completed') — the same basis as the completed revenue/cost
//     the rate is divided into, and the same "Completed" count the activity report
//     shows (e.g. 883). Scheduled / arrived / in-surgery do NOT count here.
//   • FUTURE (the multiplier) counts BOOKED appointments — anything not Cancelled /
//     Did not attend — because upcoming appointments can't be "completed" yet; they
//     are the demand expected to happen and convert to revenue.
//
// In ADDITION to the raw "all appointments" volume (used for Private income and as a
// fallback), each appointment is CLASSIFIED by the booked treatment so Lab Fees /
// Materials can be driven by only the appointments that actually generate that cost:
//   • lab-type      — sends work to an external lab (crown, bridge, denture, veneer,
//                     implant, inlay/onlay, prosthetic, retainer/aligner, splint…)
//   • clinical      — chairside hands-on work that consumes materials but no lab
//                     (filling, root canal, extraction, hygiene/scale & polish…)
//   • neither       — no lab and ~no materials (exam, review, consultation, x-ray…)
// The signal is apmt_treatment_description (+ apmt_reason); when that's blank/unknown
// we FALL BACK to apmt_duration (a short slot reads as an exam → 'neither'; a longer
// slot reads as clinical). This is what lets a crown-heavy week carry lab cost while
// an exam-heavy week doesn't — instead of every appointment counting equally.

const PAGE = 1000;
const EXCLUDED_STATES = new Set(['cancelled', 'did not attend']);

// Treatment-type keyword buckets (matched against the lower-cased
// description + reason). Order of precedence: lab → clinical → neither.
const LAB_KEYWORDS = [
  'crown', 'bridge', 'denture', 'veneer', 'implant', 'inlay', 'onlay',
  'post and core', 'post & core', 'prosth', 'abutment', 'framework',
  'retainer', 'aligner', 'invisalign', 'splint', 'try in', 'try-in', 'wax up',
  'wax-up', 'bite registration', 'impression',
];
const CLINICAL_KEYWORDS = [
  'filling', 'restoration', 'composite', 'amalgam', 'bond', 'root canal', 'rct',
  'endo', 'extraction', 'extract', 'scale', 'polish', 'hygiene', 'perio',
  'debride', 'sealant', 'fluoride', 'whitening', 'bleach', 'surgery', 'surgical',
  'suture', 'dressing', 'pulpotomy', 'pulp', 'build up', 'build-up', 'recement',
  're-cement', 'repair', 'root surface', 'fissure',
];
const NEITHER_KEYWORDS = [
  'exam', 'assessment', 'consult', 'review', 'check up', 'check-up', 'checkup',
  'recall', 'x-ray', 'xray', 'x ray', 'radiograph', 'opg', 'scan', 'photo',
  'advice', 'treatment plan', 'report', 'telephone', 'phone', 'virtual', 'video',
  'new patient',
];
// Below this many minutes a no-keyword slot reads as an exam/admin ('neither');
// at or above it, as chairside clinical work. Never infers lab from duration.
const CLINICAL_DURATION_MIN = 20;

export type ApptClass = 'lab' | 'clinical' | 'neither';

function classifyAppointment(
  description: string | null,
  reason: string | null,
  duration: number | null,
): ApptClass {
  const text = `${description ?? ''} ${reason ?? ''}`.toLowerCase();
  if (text.trim()) {
    if (LAB_KEYWORDS.some((k) => text.includes(k))) return 'lab';
    if (CLINICAL_KEYWORDS.some((k) => text.includes(k))) return 'clinical';
    if (NEITHER_KEYWORDS.some((k) => text.includes(k))) return 'neither';
  }
  // No keyword signal → duration fallback (minutes).
  const d = Number(duration);
  if (Number.isFinite(d) && d > 0) return d >= CLINICAL_DURATION_MIN ? 'clinical' : 'neither';
  // No signal at all → assume chairside clinical (counts toward materials, never lab).
  return 'clinical';
}

async function fetchAll<T>(build: () => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}


// Per-practitioner counts split by whether the booked treatment generates lab work
// or materials. `mat` = lab + clinical (everything that consumes materials), so the
// Materials denominator naturally includes lab cases too.
export interface KindFuture { lab: number[]; mat: number[] }
export interface KindTrailing { lab: number; mat: number }

export interface AppointmentForecast {
  // practitioner external_id → booked appointments per forecast week (length = weeks).
  futureByProvider: Map<string, number[]>;
  // practitioner external_id → COMPLETED appointment count over the trailing window.
  // NOTE the basis: this is completed-only (it is the denominator for completed
  // revenue/cost rates). It is NOT comparable with futureByProvider, which counts
  // every booked state — dividing one by the other compares different populations and
  // silently inflates the ratio. Use trailingBookedPerWeek for that.
  trailingByProvider: Map<string, number>;
  // Trailing BOOKED appointments per trailing week, on the SAME basis as
  // futureByProvider — so an activity ratio (future ÷ trailing) is like-for-like.
  trailingBookedPerWeek: number[];
  // practitioner external_id → lab/material-relevant counts per forecast week.
  futureKindByProvider: Map<string, KindFuture>;
  // practitioner external_id → lab/material-relevant trailing totals.
  trailingKindByProvider: Map<string, KindTrailing>;
  // Fraction of booked appointments (trailing+future) classified from a real
  // description/reason keyword (not the duration fallback) — a data-quality readout.
  coverage: number;
  nameByExt: Map<string, string>;
  ready: boolean;
}

const EMPTY: AppointmentForecast = {
  futureByProvider: new Map(),
  trailingByProvider: new Map(),
  trailingBookedPerWeek: [],
  futureKindByProvider: new Map(),
  trailingKindByProvider: new Map(),
  coverage: 0,
  nameByExt: new Map(),
  ready: false,
};

/**
 * Per-practitioner booked-appointment volume — future (per forecast week) and
 * trailing (total) — scoped to the selected location, both raw and split by
 * lab/material relevance. Consumed by useCashflowForecast to shape the Lab Fees /
 * Materials rows by the clinical work actually booked.
 */
export function useAppointmentForecast(
  organizationId: string | null | undefined,
  selectedLocationId: string | null | undefined,
  anchorMonday: Date,
  forecastWeeks: number,
  trailingStart: Date,
): AppointmentForecast {
  const forecastEnd = new Date(anchorMonday.getTime() + forecastWeeks * 7 * 86400000);
  // Europe/London day-boundary instants — bare 'YYYY-MM-DD' strings are cast
  // as UTC by the DB, one hour late during BST. Used as query bounds AND as
  // the week-bucket bases below so both stay on the same boundary.
  const startStr = ukDayStartInstant(anchorMonday);
  const endStr = ukDayStartInstant(forecastEnd);
  const trailStr = ukDayStartInstant(trailingStart);

  const query = useQuery({
    queryKey: ['cashflow-appointment-forecast', organizationId, selectedLocationId ?? 'all', startStr, endStr, trailStr],
    enabled: !!organizationId,
    staleTime: 10 * 60 * 1000,
    queryFn: async (): Promise<AppointmentForecast> => {
      if (!organizationId) return { ...EMPTY, ready: true };

      // Provider names for the account→practitioner match in the forecast.
      let pq = (supabase as any)
        .from('providers')
        .select('external_id, name')
        .eq('organization_id', organizationId)
        .not('external_id', 'is', null);
      if (selectedLocationId) pq = pq.eq('location_id', selectedLocationId);
      const provs = await fetchAll<{ external_id: number | string; name: string | null }>(() => pq);
      const nameByExt = new Map<string, string>();
      for (const p of provs) { const e = String(p.external_id); if (!nameByExt.has(e)) nameByExt.set(e, p.name || e); }

      const baseQuery = (fromIso: string, toIso: string) => {
        let q = (supabase as any)
          .from('appointments')
          .select('apmt_practitioner_id, apmt_start_time, apmt_state, apmt_treatment_description, apmt_reason, apmt_duration')
          .eq('organization_id', organizationId)
          .is('deleted_at', null)
          .not('apmt_practitioner_id', 'is', null)
          .gte('apmt_start_time', fromIso)
          .lt('apmt_start_time', toIso);
        if (selectedLocationId) q = q.eq('location_id', selectedLocationId);
        return q;
      };
      const booked = (state: string | null) => !EXCLUDED_STATES.has(String(state ?? '').toLowerCase());
      // Trailing basis = completed only (mirrors the Practitioner Activity report and
      // the completed revenue/cost the per-appointment rate is derived from).
      const completed = (state: string | null) => String(state ?? '').toLowerCase() === 'completed';

      type ApptRow = {
        apmt_practitioner_id: number | string;
        apmt_start_time: string;
        apmt_state: string | null;
        apmt_treatment_description: string | null;
        apmt_reason: string | null;
        apmt_duration: number | null;
      };

      // Coverage counters — how many booked appts were classified from a real
      // description/reason keyword vs. the duration fallback.
      let bookedTotal = 0;
      let keywordClassified = 0;
      const hasKeyword = (r: ApptRow): boolean => {
        const text = `${r.apmt_treatment_description ?? ''} ${r.apmt_reason ?? ''}`.toLowerCase();
        if (!text.trim()) return false;
        return LAB_KEYWORDS.some((k) => text.includes(k))
          || CLINICAL_KEYWORDS.some((k) => text.includes(k))
          || NEITHER_KEYWORDS.some((k) => text.includes(k));
      };

      // Future: booked appointments per forecast week (raw + by kind).
      const futureRows = await fetchAll<ApptRow>(() => baseQuery(startStr, endStr));
      const futureByProvider = new Map<string, number[]>();
      const futureKindByProvider = new Map<string, KindFuture>();
      for (const a of futureRows) {
        if (!booked(a.apmt_state)) continue;
        const wi = Math.floor((new Date(a.apmt_start_time).getTime() - new Date(startStr).getTime()) / (7 * 86400000));
        if (wi < 0 || wi >= forecastWeeks) continue;
        bookedTotal++; if (hasKeyword(a)) keywordClassified++;
        const ext = String(a.apmt_practitioner_id);
        const arr = futureByProvider.get(ext) ?? new Array(forecastWeeks).fill(0);
        arr[wi] += 1;
        futureByProvider.set(ext, arr);
        const cls = classifyAppointment(a.apmt_treatment_description, a.apmt_reason, a.apmt_duration);
        if (cls !== 'neither') {
          const k = futureKindByProvider.get(ext)
            ?? { lab: new Array(forecastWeeks).fill(0), mat: new Array(forecastWeeks).fill(0) };
          if (cls === 'lab') k.lab[wi] += 1;
          k.mat[wi] += 1; // both lab and clinical consume materials
          futureKindByProvider.set(ext, k);
        }
      }

      // Trailing: COMPLETED appointment count per practitioner (raw + by kind) — the
      // rate's denominator must match the completed revenue/cost and the activity report.
      const trailRows = await fetchAll<ApptRow>(() => baseQuery(trailStr, startStr));
      const trailingByProvider = new Map<string, number>();
      const trailingKindByProvider = new Map<string, KindTrailing>();
      for (const a of trailRows) {
        if (!completed(a.apmt_state)) continue;
        bookedTotal++; if (hasKeyword(a)) keywordClassified++;
        const ext = String(a.apmt_practitioner_id);
        trailingByProvider.set(ext, (trailingByProvider.get(ext) ?? 0) + 1);
        const cls = classifyAppointment(a.apmt_treatment_description, a.apmt_reason, a.apmt_duration);
        if (cls !== 'neither') {
          const k = trailingKindByProvider.get(ext) ?? { lab: 0, mat: 0 };
          if (cls === 'lab') k.lab += 1;
          k.mat += 1;
          trailingKindByProvider.set(ext, k);
        }
      }

      // Trailing BOOKED appointments per trailing week — same `booked()` basis and same
      // per-week bucketing as futureByProvider, so a future ÷ trailing activity ratio is
      // like-for-like. Deliberately separate from trailingByProvider above (completed-only,
      // which must keep its own basis for the per-appointment cost rates).
      const trailingWeekCount = Math.max(
        1,
        Math.round((anchorMonday.getTime() - trailingStart.getTime()) / (7 * 86400000)),
      );
      const trailingBookedPerWeek = new Array<number>(trailingWeekCount).fill(0);
      for (const a of trailRows) {
        if (!booked(a.apmt_state)) continue;
        const wi = Math.floor((new Date(a.apmt_start_time).getTime() - new Date(trailStr).getTime()) / (7 * 86400000));
        if (wi < 0 || wi >= trailingWeekCount) continue;
        trailingBookedPerWeek[wi] += 1;
      }

      const coverage = bookedTotal > 0 ? keywordClassified / bookedTotal : 0;
      return { futureByProvider, trailingByProvider, trailingBookedPerWeek, futureKindByProvider, trailingKindByProvider, coverage, nameByExt, ready: true };
    },
  });

  return query.data ?? EMPTY;
}
