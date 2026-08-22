import { useMemo, useState, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useOrganization } from '@/hooks/useOrganization';
import { useFilters } from '@/contexts/FilterContext';
import { parseMembershipFile, type ParsedMembershipRow } from '@/utils/membershipFileParser';
// Type-only import from .core (NOT the pdf.js wrapper) so pdfjs stays out of
// the main bundle — the wrapper itself is still dynamic-imported at parse time.
import type { PracticePlanParseResult } from '@/utils/practicePlanPdfParser.core';
import { isEditDistanceOne } from '@/lib/stringSimilarity';
import { toast } from 'sonner';

export interface MembershipUploadMember {
  id: string;
  surname: string;
  initial: string | null;
  dob: string | null;
  treating_dentist: string | null;
  /** Location the file was uploaded under — the row's OWNING location for
   *  every location-scoped read (client rule 2026-08-20). null on legacy
   *  rows imported before upload-location stamping; those fall back to the
   *  patient's home location_id. */
  upload_location_id?: string | null;
  fee_category: string;
  discount_percent: number;
  net_due: number;
  upload_month: number;
  upload_year: number;
  mapped_plan_id: string | null;
  mapped_plan_name: string | null;
  location_id: string | null;
  patient_id: string | null;
  title: string | null;
  pay_grp_size: number | null;
  pay_grp_id: string | null;
  /** 'Practice Plan statement' marker on PDF-imported rows — drives
   *  statement-plan grouping instead of the Denplan patient-plan grouping. */
  explanatory_text: string | null;
  /** Set for members collected annually rather than monthly ('Y' from the
   *  Practice Plan statement's Freq column; free text from Denplan sheets;
   *  TEXT column). Their net_due for the period collected isn't directly
   *  comparable to the plan's monthly list price — the Practice Plan fee
   *  derivation in useOverviewData.ts excludes them. */
  annual_payer: string | null;
  /** Set by dedupeMembers: this member's collected £ summed across every
   *  month in the header's selected range (per-month max, so a £0 annual
   *  copy never shadows the paid one). Equals net_due for a single-month
   *  range. Range-scoped revenue tiles must use this, never net_due — the
   *  kept row only carries its own (latest) month's payment. */
  range_net_due?: number;
  /** Set by dedupeMembers alongside range_net_due: the same range £ broken
   *  down by the treating dentist each month's payment was actually printed
   *  under ('' key = no dentist recorded). A member who moved between
   *  dentists mid-range (e.g. Razaq → "Razaq 2") keeps each month's £ under
   *  that month's own dentist — the attribution the statements themselves
   *  use, and the one provider production reconciles against. */
  range_net_due_by_dentist?: Record<string, number>;
}

export interface MembershipLocationGroup {
  locationId: string | null; // null bucket = "Unassigned"
  locationName: string;
  members: MembershipUploadMember[];
  totalNetDue: number;
}

export interface PlanRevenueSummary {
  fee_category: string;
  members: number;
  total_net_due: number;
  avg_discount: number;
  mapped_plan_id: string | null;
  mapped_plan_name: string | null;
  /** True for groups built from Practice Plan statement rows — the group IS
   *  the statement's own plan, so "unmapped" badges don't apply. */
  is_practice_plan?: boolean;
}

export interface AvailablePaymentPlan {
  id: string;
  name: string;
}

export interface DenplanFacilityMapping {
  id: string;
  facility_id: string;
  product_name: string;
  dentist_name: string | null;
  /** All payment plans this facility maps to. Empty array = unmapped. */
  payment_plan_ids: string[];
  /** Legacy single-plan slot — kept for backwards compatibility on reads. */
  payment_plan_id: string | null;
}

/**
 * Facility detected in a batch of uploaded files, with its current mapping
 * (if any) resolved against `denplan_facility_mappings`. The UI uses this to
 * flag unmapped facilities and let the user create/update mappings inline.
 */
export interface DetectedFacility {
  facility_id: string;
  file_names: string[];
  row_count: number;
  mapping: DenplanFacilityMapping | null;
}

export type { ParsedMembershipRow };

const QUERY_KEY = 'membership_upload_members';
const PAGE_SIZE = 1000;

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

export { MONTH_NAMES };

function monthYearPairsInRange(start: Date, end: Date): Array<{ month: number; year: number }> {
  const pairs: Array<{ month: number; year: number }> = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const last = new Date(end.getFullYear(), end.getMonth(), 1);
  while (cursor.getTime() <= last.getTime()) {
    pairs.push({ month: cursor.getMonth() + 1, year: cursor.getFullYear() });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return pairs;
}

export type MonthPair = { month: number; year: number };

/**
 * Resolve which upload months the page should display: the header-selected
 * range when it actually has data, otherwise the LATEST uploaded month
 * org-wide. Membership data is uploaded for a statement's own month (e.g. a
 * July Denplan sheet), so a page filter of "This Month" would otherwise
 * render a blank card right after a successful import — which reads as "the
 * upload didn't work". Falling back keeps the numbers visible and the card
 * labels which month is being shown.
 *
 * Practice Plan is EXCLUDED from this fallback (client request 2026-08-11):
 * each statement is its own month's collections, so filtering to a month
 * with no PP statement uploaded must show that month as empty/£0, never
 * silently swap in a different month's figures — that read as "last month's
 * data" when it was actually this month's.
 */
async function resolveEffectivePairs(
  organizationId: string,
  selectedPairs: MonthPair[],
): Promise<{ pairs: MonthPair[]; fallbackMonth: MonthPair | null }> {
  const orFilter = selectedPairs
    .map(p => `and(upload_month.eq.${p.month},upload_year.eq.${p.year})`)
    .join(',');
  // Org-wide existence probe (deliberately NOT location-filtered — a location
  // mismatch is surfaced separately by the "saved under a different location"
  // empty state, not by jumping months).
  const { data: probe, error: probeErr } = await (supabase as any)
    .from('membership_upload_members')
    .select('id')
    .eq('organization_id', organizationId)
    .or(orFilter)
    .is('deleted_at', null)
    .limit(1);
  if (probeErr) throw probeErr;
  if ((probe ?? []).length > 0) return { pairs: selectedPairs, fallbackMonth: null };

  // Same latest-row source detection as the `membership_upload_has_any_v2`
  // query (an org uses one provider in practice) — reused here so the
  // fallback decision and the "which provider is this org on" decision never
  // disagree.
  const { data: latest, error: latestErr } = await (supabase as any)
    .from('membership_upload_members')
    .select('upload_month, upload_year, explanatory_text')
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .order('upload_year', { ascending: false })
    .order('upload_month', { ascending: false })
    .limit(1);
  if (latestErr) throw latestErr;
  const row = ((latest ?? []) as Array<{ upload_month: number; upload_year: number; explanatory_text: string | null }>)[0];
  if (!row) return { pairs: selectedPairs, fallbackMonth: null };
  if (row.explanatory_text === 'Practice Plan statement') {
    return { pairs: selectedPairs, fallbackMonth: null };
  }
  const fb = { month: Number(row.upload_month), year: Number(row.upload_year) };
  return { pairs: [fb], fallbackMonth: fb };
}

async function enrichWithCurrentPlan(
  rows: MembershipUploadMember[],
  organizationId: string,
): Promise<MembershipUploadMember[]> {
  const ids = Array.from(new Set(rows.map(r => r.patient_id).filter((x): x is string => !!x)));
  if (ids.length === 0) return rows;

  type PatientRow = { pt_id: string; pt_legacy_id: string | null; pt_payment_plan_id: number | string | null };
  const patientPlanByKey = new Map<string, { ppId: string | null }>();
  const activeKeys = new Set<string>();
  const CHUNK = 200;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const { data, error } = await (supabase as any)
      .from('patients')
      .select('pt_id, pt_legacy_id, pt_payment_plan_id, is_active')
      .eq('organization_id', organizationId)
      // No is_active filter — inactive-but-paying members (matched at import)
      // must still resolve their current plan and stay in the saved view.
      .is('deleted_at', null)
      .or(`pt_id.in.(${chunk.map(v => `"${v}"`).join(',')}),pt_legacy_id.in.(${chunk.map(v => `"${v}"`).join(',')})`);
    // THROW on error — swallowing it leaves activeKeys empty, which makes the
    // exclusion below drop EVERY patient-matched row. React Query would then
    // cache that empty result as fresh (staleTime 5 min), so one transient
    // failure (e.g. right after an import's write burst) blanks the whole
    // page until a hard refresh — the "hard refresh to get data" bug class.
    // Failing the query makes RQ retry and refetch instead.
    if (error) { console.error('[membership enrich] patients lookup failed:', error); throw error; }
    for (const p of ((data ?? []) as PatientRow[])) {
      const ppId = p.pt_payment_plan_id != null ? String(p.pt_payment_plan_id) : null;
      // pt_id arrives as a NUMBER from PostgREST (bigint column) while
      // member rows store patient_id as TEXT — key everything as strings.
      // Unstringified, activeKeys.has('57939') was false for every
      // pt_id-matched member, and the exclusion below silently dropped ALL
      // of them (Practice Plan rows always store matched pt_ids, so the
      // whole import vanished from the page; Denplan rows mostly carry the
      // CSV legacy id, which already went through the String() path).
      if (p.pt_id != null) {
        patientPlanByKey.set(String(p.pt_id), { ppId });
        activeKeys.add(String(p.pt_id));
      }
      if (p.pt_legacy_id != null) {
        patientPlanByKey.set(String(p.pt_legacy_id), { ppId });
        activeKeys.add(String(p.pt_legacy_id));
      }
    }
  }

  const ppIds = Array.from(new Set(
    Array.from(patientPlanByKey.values()).map(v => v.ppId).filter((x): x is string => !!x),
  ));
  const planByPpId = new Map<string, { id: string; name: string }>();
  if (ppIds.length > 0) {
    const { data, error } = await (supabase as any)
      .from('payment_plans')
      .select('id, pp_id, pp_name, pp_patient_friendly_name')
      .is('deleted_at', null)
      .in('pp_id', ppIds);
    // Same rule as above: a swallowed failure here regroups every member
    // under "Unmapped" and gets cached as fresh — fail the query instead.
    if (error) { console.error('[membership enrich] payment_plans lookup failed:', error); throw error; }
    for (const p of (data ?? [])) {
      if (p.pp_id != null) {
        planByPpId.set(String(p.pp_id), {
          id: p.id as string,
          name: (p.pp_name || p.pp_patient_friendly_name || 'Unnamed') as string,
        });
      }
    }
  }

  const out: MembershipUploadMember[] = [];
  for (const r of rows) {
    if (r.patient_id && !activeKeys.has(r.patient_id)) {
      // Sheet matched a patient_id that no longer exists in the DB (deleted /
      // re-keyed) — exclude. Inactive patients DO exist here and are kept.
      continue;
    }
    if (!r.patient_id) { out.push(r); continue; }
    const patient = patientPlanByKey.get(r.patient_id);
    if (!patient || !patient.ppId) { out.push(r); continue; }
    const plan = planByPpId.get(patient.ppId);
    if (!plan) { out.push(r); continue; }
    out.push({ ...r, mapped_plan_id: plan.id, mapped_plan_name: plan.name });
  }
  return out;
}

/** Collapse duplicate/re-uploaded rows for the same member down to one —
 *  by patient_id when linked, else by (pay_grp_id, surname, initial, dob).
 *  Keeps the most recently uploaded copy. Exported so other Membership
 *  Insights consumers (e.g. useCliniciansData's prior-month comparison) get
 *  the exact same member count this page shows, not a raw row count that
 *  double-counts re-upload duplicates. */
/** One removable chunk of uploaded data: a month × statement-dentist pair
 *  (dentist null = rows with no dentist recorded, e.g. sheet uploads). */
export interface UploadSlice {
  month: number;
  year: number;
  treatingDentist: string | null;
  memberCount: number;
  totalNetDue: number;
}

export function dedupeMembers(rows: MembershipUploadMember[]): MembershipUploadMember[] {
  const sorted = [...rows].sort((a, b) => {
    if (a.upload_year !== b.upload_year) return b.upload_year - a.upload_year;
    if (a.upload_month !== b.upload_month) return b.upload_month - a.upload_month;
    // Same-month duplicates keep the PAID copy deterministically — an annual
    // payer can exist both as their collected row and as a £0 annual-section
    // row from an older import; DB fetch order must not decide which £ the
    // page shows.
    return (Number(b.net_due) || 0) - (Number(a.net_due) || 0);
  });
  const seen = new Set<string>();
  const out: MembershipUploadMember[] = [];
  // Per member, per month: the month's highest net_due (same rule as the
  // same-month tie-break above — the paid copy wins over a £0 annual copy).
  // Summed across the months in range this becomes range_net_due, so a
  // multi-month header range reports the member's REAL collected £ for the
  // whole range while the member itself is still counted once (client
  // report 2026-08-19: "custom range revenue not updated" — revenue tiles
  // showed one blended month for a four-month range).
  // Each month also remembers WHICH dentist the winning (max) row was
  // printed under, so range_net_due_by_dentist can attribute each month's £
  // to that month's own dentist — a member who moved between dentists
  // mid-range must not carry earlier months' £ onto their latest dentist
  // (that's what made the Overview clinician card disagree with provider
  // production over a wide range).
  const perMonthMax = new Map<string, Map<string, { v: number; dentist: string }>>();
  const keyOf = (r: MembershipUploadMember): string =>
    // Practice Plan rows dedupe by PP's OWN patient id (pay_grp_id) — the
    // one identity that is genuinely unique per paying member. Keying them
    // by the matched Dentally patient_id collapsed DISTINCT members whose
    // patients merely share a legacy card NUMBER across this org's sites
    // (e.g. "005253" is a different person at each practice) — Appoline
    // July 2026: 62 real rows / £790 of monthly fees hidden from every
    // total. The same member re-uploaded across months keeps the same PP
    // id, so cross-month collapse still works.
    r.explanatory_text === PRACTICE_PLAN_MARKER && r.pay_grp_id
      ? `pp:${r.pay_grp_id}`
      : r.patient_id
        ? `pid:${r.patient_id}`
        : `k:${r.pay_grp_id ?? ''}|${(r.surname ?? '').toLowerCase()}|${(r.initial ?? '').toLowerCase()}|${r.dob ?? ''}`;
  for (const r of sorted) {
    const key = keyOf(r);
    const mk = `${r.upload_year}-${r.upload_month}`;
    let months = perMonthMax.get(key);
    if (!months) { months = new Map(); perMonthMax.set(key, months); }
    const v = Number(r.net_due) || 0;
    const existing = months.get(mk);
    if (!existing || v > existing.v) {
      months.set(mk, { v, dentist: r.treating_dentist?.trim() ?? '' });
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out.map(r => {
    let rangeTotal = 0;
    const byDentist: Record<string, number> = {};
    for (const { v, dentist } of perMonthMax.get(keyOf(r))!.values()) {
      rangeTotal += v;
      byDentist[dentist] = Math.round(((byDentist[dentist] ?? 0) + v) * 100) / 100;
    }
    return {
      ...r,
      range_net_due: Math.round(rangeTotal * 100) / 100,
      range_net_due_by_dentist: byDentist,
    };
  });
}

// Groups Denplan-sheet rows by the matched DB patient's current payment plan
// (patients.pt_payment_plan_id → payment_plans); rows whose patient could not
// be resolved — or whose patient has no active plan — are bucketed under
// "Unmapped". Practice Plan statement rows group by their OWN statement plan
// (fee_category, e.g. "Low B" / "Comprehensive") instead: the statement IS the
// plan catalogue there, and the Denplan grouping would collapse it into the
// patients' Dentally plans ("Private" / "NHS" / "PLAN PLAN 1"), losing the
// plan-wise view entirely.
const UNMAPPED_PLAN_LABEL = 'Unmapped';
export const PRACTICE_PLAN_MARKER = 'Practice Plan statement';
function buildPlanSummary(
  rows: Array<{ fee_category: string; net_due: number; discount_percent: number; mapped_plan_id?: string | null; mapped_plan_name?: string | null; explanatory_text?: string | null }>
): PlanRevenueSummary[] {
  const map = new Map<string, { members: number; totalNetDue: number; totalDiscount: number; mapped_plan_id: string | null; mapped_plan_name: string | null; isPracticePlan: boolean; rawFeeCategories: Set<string> }>();
  for (const m of rows) {
    const isPracticePlan = m.explanatory_text === PRACTICE_PLAN_MARKER;
    const groupKey = isPracticePlan
      ? (m.fee_category?.trim() || UNMAPPED_PLAN_LABEL)
      : (m.mapped_plan_name && m.mapped_plan_name.trim() !== '') ? m.mapped_plan_name : UNMAPPED_PLAN_LABEL;
    const existing = map.get(groupKey);
    if (existing) {
      existing.members += 1;
      existing.totalNetDue += m.net_due;
      existing.totalDiscount += m.discount_percent;
      existing.rawFeeCategories.add(m.fee_category);
      // A statement-plan group spans members on assorted Dentally plans —
      // binding the first member's plan id would misattribute that plan's
      // whole treatment-cost line to this group, so PP groups stay unbound.
      if (!isPracticePlan && !existing.mapped_plan_id && m.mapped_plan_id) {
        existing.mapped_plan_id = m.mapped_plan_id;
        existing.mapped_plan_name = m.mapped_plan_name ?? null;
      }
    } else {
      map.set(groupKey, {
        members: 1,
        totalNetDue: m.net_due,
        totalDiscount: m.discount_percent,
        mapped_plan_id: isPracticePlan ? null : (m.mapped_plan_id ?? null),
        mapped_plan_name: isPracticePlan ? null : (m.mapped_plan_name ?? null),
        isPracticePlan,
        rawFeeCategories: new Set([m.fee_category]),
      });
    }
  }
  return Array.from(map.entries()).map(([groupKey, v]) => ({
    fee_category: groupKey,
    members: v.members,
    total_net_due: v.totalNetDue,
    avg_discount: v.members > 0 ? Math.round((v.totalDiscount / v.members) * 100) / 100 : 0,
    mapped_plan_id: v.mapped_plan_id,
    mapped_plan_name: v.mapped_plan_name,
    is_practice_plan: v.isPracticePlan,
  })).sort((a, b) => b.total_net_due - a.total_net_due);
}

export function useMembershipUploadData() {
  const { user } = useAuth();
  const { organizationId } = useOrganization();
  const { selectedLocationId } = useFilters();
  const queryClient = useQueryClient();

  // Derive month/year from the global date range filter (header "This Month" / "Last Month" etc.)
  const { dateRange } = useFilters();
  const now = new Date();
  const monthYearPairs = useMemo(
    () => monthYearPairsInRange(dateRange.startDate, dateRange.endDate),
    [dateRange.startDate, dateRange.endDate],
  );
  const monthYearKey = useMemo(
    () => monthYearPairs.map(p => `${p.year}-${p.month}`).join(','),
    [monthYearPairs],
  );
  const lastPair = monthYearPairs[monthYearPairs.length - 1] ?? { month: now.getMonth() + 1, year: now.getFullYear() };
  const selectedMonth = lastPair.month;
  const selectedYear = lastPair.year;

  // Preview state — parsed rows held in memory before confirm
  const [previewRows, setPreviewRows] = useState<ParsedMembershipRow[] | null>(null);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  // Month/year chosen in the preview dialog for import
  const [importMonth, setImportMonth] = useState<number>(now.getMonth() + 1);
  const [importYear, setImportYear] = useState<number>(now.getFullYear());
  // The location a DenPlan upload belongs to. Stamped on every imported row as
  // upload_location_id so the file is isolated to one location (reads filter by
  // it), instead of scattering members across locations by patient home site.
  const [importLocationId, setImportLocationId] = useState<string | null>(null);
  // Manual fee_category → plan mapping — feature currently commented out,
  // kept for easy restoration.
  const [feeCategoryPlanMap, setFeeCategoryPlanMap] = useState<Record<string, string>>({});
  // Per-row auto-match: index in previewRows → resolved DB patient + plan
  // (from surname + DOB lookup in the patients table).
  interface RowPlanMatch {
    pt_id: string | null;
    // The matched patient's pt_legacy_id — this, NOT pt_id, is what
    // membership_upload_members.patient_id must be written as (see
    // resolvedPatientId below). pt_id is Dentally's numeric row key, reused
    // across integrations; legacy_id is the stable cross-system identifier
    // the rest of the app (and the Denplan sheet's own patient_id column)
    // actually joins on.
    legacy_id: string | null;
    plan_id: string | null;  // payment_plans.id (UUID)
    plan_name: string | null;
    dob: string | null;       // matched DB patient's DOB (YYYY-MM-DD)
    location_id: string | null; // matched DB patient's practice_locations.id
  }
  const [rowPlanMatches, setRowPlanMatches] = useState<RowPlanMatch[]>([]);

  // Facilities detected in the currently-staged batch of files.
  const [detectedFacilities, setDetectedFacilities] = useState<DetectedFacility[]>([]);

  // Practice Plan statement parse results for the currently-staged batch —
  // held across the parse → confirm boundary so confirmMutation can persist
  // the statement header + failed/cancelled event rows alongside the member
  // rows. One entry per PP PDF (statements are per-dentist documents).
  const ppStatementsRef = useRef<PracticePlanParseResult[]>([]);

  // Denplan facility → product/plan mappings for this organization.
  // Normalises the row so callers can always rely on `payment_plan_ids` as
  // the canonical list, even for rows that pre-date the multi-plan column.
  const { data: denplanFacilityMappings = [] } = useQuery<DenplanFacilityMapping[]>({
    queryKey: ['denplan_facility_mappings', organizationId],
    queryFn: async () => {
      if (!organizationId) return [];
      const { data, error } = await (supabase as any)
        .from('denplan_facility_mappings')
        .select('id, facility_id, product_name, dentist_name, payment_plan_id, payment_plan_ids')
        .eq('organization_id', organizationId)
        .order('facility_id');
      if (error) throw error;
      return ((data ?? []) as any[]).map(r => {
        const ids: string[] = Array.isArray(r.payment_plan_ids) && r.payment_plan_ids.length > 0
          ? r.payment_plan_ids
          : (r.payment_plan_id ? [r.payment_plan_id] : []);
        return {
          id: r.id,
          facility_id: r.facility_id,
          product_name: r.product_name,
          dentist_name: r.dentist_name ?? null,
          payment_plan_id: r.payment_plan_id ?? null,
          payment_plan_ids: ids,
        } as DenplanFacilityMapping;
      });
    },
    enabled: !!organizationId,
  });

  // All payment plans for this org, including inactive. Used by the Denplan
  // facility mapping dropdown — Setup Categories / statement mappings must
  // still resolve historical Dentally plans.
  const { data: allActivePlans = [] } = useQuery<AvailablePaymentPlan[]>({
    queryKey: ['membership_upload_all_plans_v2', organizationId],
    queryFn: async () => {
      if (!organizationId) return [];
      const { data, error } = await (supabase as any)
        .from('payment_plans')
        .select('id, pp_name, pp_patient_friendly_name, pp_is_active, deleted_at')
        .is('deleted_at', null)
        .order('pp_name');
      if (error) throw error;
      return ((data ?? []) as any[]).map((p) => {
        const name = (p.pp_name || p.pp_patient_friendly_name || 'Unnamed') as string;
        return {
          id: p.id as string,
          name: p.pp_is_active === false ? `${name} (Inactive)` : name,
        };
      });
    },
    enabled: !!organizationId,
    staleTime: 10 * 60 * 1000,
  });

  // Narrower list used by the (currently-disabled) fee-category → plan
  // mapper. Keeps the NHS/Private exclusion since fee-category mapping is
  // specifically Denplan-only and those plan types shouldn't appear there.
  const availablePlans = useMemo<AvailablePaymentPlan[]>(() => {
    return allActivePlans.filter(p => {
      const name = p.name.toLowerCase();
      return !name.includes('nhs') && !name.includes('private');
    });
  }, [allActivePlans]);

  // Practice locations for the org — used to label rows in the
  // location-split modal. Indexed by id → name.
  const { data: practiceLocations = [] } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ['membership_upload_practice_locations', organizationId],
    queryFn: async () => {
      if (!organizationId) return [];
      const { data, error } = await (supabase as any)
        .from('practice_locations')
        .select('id, location_name')
        .eq('organization_id', organizationId)
        .is('deleted_at', null)
        .order('location_name');
      if (error) throw error;
      return ((data ?? []) as any[]).map(l => ({ id: l.id as string, name: (l.location_name ?? 'Unnamed') as string }));
    },
    enabled: !!organizationId,
    staleTime: 10 * 60 * 1000,
  });

  // Denplan facility mapping CRUD. Used by the preview dialog so users can
  // resolve unmapped facilities inline without leaving the upload flow.
  const facilityMappingMutation = useMutation({
    mutationFn: async (input: {
      facility_id: string;
      product_name: string;
      dentist_name?: string | null;
      payment_plan_ids?: string[];
    }) => {
      if (!organizationId) throw new Error('Not authenticated');
      const planIds = input.payment_plan_ids ?? [];
      // Keep the legacy single-plan column in sync so readers that still
      // consult it (e.g. older dashboards) see the primary plan.
      const payload = {
        organization_id: organizationId,
        facility_id: input.facility_id,
        product_name: input.product_name,
        dentist_name: input.dentist_name ?? null,
        payment_plan_ids: planIds,
        payment_plan_id: planIds[0] ?? null,
        updated_at: new Date().toISOString(),
      };
      const { data, error } = await (supabase as any)
        .from('denplan_facility_mappings')
        .upsert(payload, { onConflict: 'organization_id,facility_id' })
        .select('id, facility_id, product_name, dentist_name, payment_plan_id, payment_plan_ids')
        .single();
      if (error) throw error;
      const saved: DenplanFacilityMapping = {
        id: data.id,
        facility_id: data.facility_id,
        product_name: data.product_name,
        dentist_name: data.dentist_name ?? null,
        payment_plan_id: data.payment_plan_id ?? null,
        payment_plan_ids: Array.isArray(data.payment_plan_ids) ? data.payment_plan_ids : planIds,
      };
      return saved;
    },
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ['denplan_facility_mappings', organizationId] });
      // Patch the currently detected-facility list in place so the UI updates
      // immediately without waiting for the re-query round-trip.
      setDetectedFacilities(prev =>
        prev.map(f => f.facility_id === saved.facility_id ? { ...f, mapping: saved } : f),
      );
      toast.success(`Mapped facility ${saved.facility_id} → ${saved.product_name}`);
    },
    onError: (err: Error) => {
      toast.error(`Failed to save facility mapping: ${err.message}`);
    },
  });

  const deleteFacilityMappingMutation = useMutation({
    mutationFn: async (mappingId: string) => {
      if (!organizationId) throw new Error('Not authenticated');
      const { error } = await (supabase as any)
        .from('denplan_facility_mappings')
        .delete()
        .eq('id', mappingId)
        .eq('organization_id', organizationId);
      if (error) throw error;
      return mappingId;
    },
    onSuccess: (mappingId) => {
      queryClient.invalidateQueries({ queryKey: ['denplan_facility_mappings', organizationId] });
      setDetectedFacilities(prev =>
        prev.map(f => f.mapping?.id === mappingId ? { ...f, mapping: null } : f),
      );
      toast.success('Facility mapping removed');
    },
    onError: (err: Error) => {
      toast.error(`Failed to delete facility mapping: ${err.message}`);
    },
  });

  // Location-split modal visibility — opened automatically after a successful
  // import and re-openable via the "View by Location" button on the page.
  const [isImportSummaryOpen, setImportSummaryOpen] = useState(false);

  // Whether ANY membership data was ever uploaded for this org (any month,
  // any location) and WHICH source it came from. Drives the first-visit
  // "what do you want to upload?" chooser on the Membership page — once a
  // source is known the Upload button skips the chooser and opens the right
  // file picker directly. Practice Plan rows are recognised by the
  // explanatory_text marker the PDF parser stamps on every row; the latest
  // month's data decides (an org uses one provider in practice).
  const { data: uploadPresence } = useQuery<{ hasAny: boolean; source: 'practice-plan' | 'sheet' | null }>({
    queryKey: ['membership_upload_has_any_v2', organizationId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('membership_upload_members')
        .select('explanatory_text')
        .eq('organization_id', organizationId)
        .is('deleted_at', null)
        .order('upload_year', { ascending: false })
        .order('upload_month', { ascending: false })
        .limit(1);
      if (error) throw error;
      const row = ((data ?? []) as Array<{ explanatory_text: string | null }>)[0];
      if (!row) return { hasAny: false, source: null };
      return {
        hasAny: true,
        source: row.explanatory_text === 'Practice Plan statement' ? ('practice-plan' as const) : ('sheet' as const),
      };
    },
    enabled: !!user?.id && !!organizationId,
    staleTime: 5 * 60 * 1000,
  });
  const hasAnyUpload = uploadPresence?.hasAny;
  const uploadSource = uploadPresence?.source ?? null;

  // Fetch saved members for the selected month/year (falling back to the
  // latest uploaded month when the selected range has none — see
  // resolveEffectivePairs — and to ALL locations when the header-selected
  // location has none for that month).
  const { data: membersData, isLoading, error: membersError, refetch: refetchMembers } = useQuery({
    queryKey: [QUERY_KEY, organizationId, selectedLocationId, monthYearKey],
    queryFn: async () => {
      const emptyResult = {
        rows: [] as MembershipUploadMember[],
        fallbackMonth: null as MonthPair | null,
      };
      if (!organizationId || monthYearPairs.length === 0) return emptyResult;
      const { pairs, fallbackMonth } = await resolveEffectivePairs(organizationId, monthYearPairs);
      const orFilter = pairs
        .map(p => `and(upload_month.eq.${p.month},upload_year.eq.${p.year})`)
        .join(',');

      const fetchRows = async (locationId: string | null): Promise<MembershipUploadMember[]> => {
        const out: MembershipUploadMember[] = [];
        let from = 0;
        let hasMore = true;
        while (hasMore) {
          let q = (supabase as any)
            .from('membership_upload_members')
            .select('id, surname, initial, dob, treating_dentist, fee_category, discount_percent, net_due, upload_month, upload_year, mapped_plan_id, mapped_plan_name, location_id, upload_location_id, patient_id, title, pay_grp_size, pay_grp_id, explanatory_text, annual_payer')
            .eq('organization_id', organizationId)
            .or(orFilter)
            .is('deleted_at', null)
            .order('fee_category')
            .order('surname')
            .range(from, from + PAGE_SIZE - 1);
          if (locationId) {
            // The UPLOAD location owns the row (client rule 2026-08-20: a
            // location must never show another location's data — the old
            // home-OR-upload match made a member registered at site A but
            // uploaded under site B visible from both). Patient-home
            // matching only remains for legacy rows imported before
            // upload-location stamping existed (upload_location_id null).
            q = q.or(`upload_location_id.eq.${locationId},and(upload_location_id.is.null,location_id.eq.${locationId})`);
          }
          const { data, error } = await q;
          if (error) throw error;
          out.push(...(data ?? []));
          hasMore = (data?.length ?? 0) === PAGE_SIZE;
          from += PAGE_SIZE;
        }
        return out;
      };

      const all = await fetchRows(selectedLocationId);
      // NO location fallback (removed 2026-08-20, client: "make sure other
      // location data not show in other location") — a location with no
      // rows shows the informative "saved under a different location" empty
      // state (driven by the separate all-locations query), never another
      // location's numbers.
      const enriched = await enrichWithCurrentPlan(all, organizationId);
      return { rows: dedupeMembers(enriched), fallbackMonth };
    },
    enabled: !!user?.id && !!organizationId,
    staleTime: 5 * 60 * 1000,
  });
  const members = membersData?.rows ?? [];
  const fallbackMonth = membersData?.fallbackMonth ?? null;
  // The month/year the page is ACTUALLY showing (header selection, or the
  // latest-upload fallback). The location-split modal title and Clear both
  // follow this, so they always refer to the visible data.
  const displayMonth: MonthPair = fallbackMonth ?? { month: selectedMonth, year: selectedYear };
  // Every month/year pair actually contributing to `members` — same rule
  // `resolveEffectivePairs` applied server-side (the header's full selected
  // range, or the single latest-upload fallback month). Statement-scoped
  // consumers (Overview/Members tabs' Practice Plan figures) need every pair
  // in range, not just `displayMonth` — using only the range's last month
  // left tiles showing "no statement uploaded" for a wide range like "This
  // Year" even when earlier months in that range had real statements.
  const effectivePairs: MonthPair[] = fallbackMonth ? [fallbackMonth] : monthYearPairs;

  // Fetch ALL members for the selected month/year across every location in
  // the org — used by the location-split modal. We can't reuse `members`
  // because that query is filtered by the currently selected header location.
  const { data: membersAllLocations = [], isFetching: isLocationSplitFetching } = useQuery<MembershipUploadMember[]>({
    queryKey: [QUERY_KEY, 'all-locations', organizationId, monthYearKey],
    queryFn: async () => {
      if (!organizationId || monthYearPairs.length === 0) return [];
      // Same latest-upload fallback as the main members query so the modal
      // and the card always describe the same month.
      const { pairs } = await resolveEffectivePairs(organizationId, monthYearPairs);
      const orFilter = pairs
        .map(p => `and(upload_month.eq.${p.month},upload_year.eq.${p.year})`)
        .join(',');
      const all: MembershipUploadMember[] = [];
      let from = 0;
      let hasMore = true;
      while (hasMore) {
        const { data, error } = await (supabase as any)
          .from('membership_upload_members')
          .select('id, surname, initial, dob, treating_dentist, fee_category, discount_percent, net_due, upload_month, upload_year, mapped_plan_id, mapped_plan_name, location_id, upload_location_id, patient_id, title, pay_grp_size, pay_grp_id, explanatory_text, annual_payer')
          .eq('organization_id', organizationId)
          .or(orFilter)
          .is('deleted_at', null)
          .order('surname')
          .range(from, from + PAGE_SIZE - 1);
        if (error) throw error;
        all.push(...(data ?? []));
        hasMore = (data?.length ?? 0) === PAGE_SIZE;
        from += PAGE_SIZE;
      }
      const enriched = await enrichWithCurrentPlan(all, organizationId);
      return dedupeMembers(enriched);
    },
    enabled: !!user?.id && !!organizationId,
    staleTime: 5 * 60 * 1000,
  });

  // Members whose statement row could NOT be matched to any Dentally
  // patient (patient_id null). Since uploads stamp every row with the
  // upload's location, these no longer surface as an "Unassigned" location
  // bucket — they get their own explicit list in the location-split modal
  // so unmatched members are never invisible.
  const unmatchedMembers = useMemo(
    () =>
      membersAllLocations.filter(
        (m) =>
          !m.patient_id &&
          // Ownership rule (2026-08-20): scoped to the header location when
          // one is selected — the modal must not list another location's
          // unmatched rows.
          (!selectedLocationId || (m.upload_location_id ?? m.location_id) === selectedLocationId),
      ),
    [membersAllLocations, selectedLocationId],
  );

  // Group all-location members by their stored location_id. Unmatched rows
  // (location_id = null) land in the "Unassigned" bucket so the user can
  // see members that couldn't be linked to a DB patient.
  const membersByLocation = useMemo<MembershipLocationGroup[]>(() => {
    const locMap = new Map<string, { id: string; name: string }>();
    for (const l of practiceLocations) locMap.set(l.id, l);
    const groups = new Map<string, MembershipLocationGroup>();
    const unassignedKey = '__unassigned__';
    for (const m of membersAllLocations) {
      // The OWNING location (upload location, patient home for legacy
      // unstamped rows) — same ownership rule as every location-scoped
      // read, so this split names the location whose page shows each row.
      const ownerLocationId = m.upload_location_id ?? m.location_id;
      const key = ownerLocationId ?? unassignedKey;
      // Range-scoped £: the member's collected total across every month in
      // range, not just the latest kept copy's month.
      const memberNet = m.range_net_due ?? m.net_due;
      const existing = groups.get(key);
      if (existing) {
        existing.members.push(m);
        existing.totalNetDue += memberNet;
      } else {
        const name = ownerLocationId
          ? (locMap.get(ownerLocationId)?.name ?? 'Unknown location')
          : 'Unassigned';
        groups.set(key, {
          locationId: ownerLocationId,
          locationName: name,
          members: [m],
          totalNetDue: memberNet,
        });
      }
    }
    // Sort: named locations first (alphabetical), Unassigned last
    return Array.from(groups.values()).sort((a, b) => {
      if (a.locationId === null) return 1;
      if (b.locationId === null) return -1;
      return a.locationName.localeCompare(b.locationName);
    });
  }, [membersAllLocations, practiceLocations]);

  // The location-split modal's view of the groups, scoped to the header
  // location when one is selected (client 2026-08-20: other location data
  // must not show). The UNSCOPED membersByLocation stays exported — the
  // "saved under a different location" empty state needs it to NAME where
  // the data lives (names only, never the rows themselves).
  const membersByLocationForModal = useMemo<MembershipLocationGroup[]>(
    () =>
      selectedLocationId
        ? membersByLocation.filter((g) => g.locationId === selectedLocationId)
        : membersByLocation,
    [membersByLocation, selectedLocationId],
  );

  // Saved data plan summary
  const planSummary = useMemo(() => buildPlanSummary(members), [members]);
  // Header revenue tile: RANGE-scoped — each member's collected £ summed over
  // every month in the selected range (range_net_due), so a multi-month
  // custom range reports the whole range's revenue, matching the monthly
  // reconciliation card's per-month sum. Identical to the plan-summary total
  // for a single-month range. Per-plan cards stay on net_due (monthly view).
  const totalRevenue = useMemo(
    () => members.reduce((s, m) => s + (m.range_net_due ?? m.net_due ?? 0), 0),
    [members],
  );
  const totalMembers = useMemo(() => planSummary.reduce((s, p) => s + p.members, 0), [planSummary]);

  /**
   * Resolve the effective plan for a row: facility mapping wins when set,
   * otherwise falls back to whatever the patient match produced.
   *
   * When a facility maps to multiple plans, the plan whose name best matches
   * the row's `fee_category` is preferred (case-insensitive, then substring).
   * If no name matches, the first mapped plan is used so the row still lands
   * under a Denplan product rather than "Unmapped".
   */
  const resolveRowPlan = useCallback((
    row: ParsedMembershipRow | { source_facility_id: string | null; fee_category?: string },
    patientMatch: { plan_id: string | null; plan_name: string | null } | null | undefined,
  ): { plan_id: string | null; plan_name: string | null } => {
    const fid = (row as any).source_facility_id as string | null;
    if (fid) {
      const mapping = denplanFacilityMappings.find(m => m.facility_id === fid);
      const ids = mapping?.payment_plan_ids ?? [];
      if (ids.length > 0) {
        const feeCat = ((row as any).fee_category ?? '').toString().trim().toLowerCase();
        const candidates = ids
          .map(id => allActivePlans.find(p => p.id === id))
          .filter((p): p is AvailablePaymentPlan => !!p);
        // Best match: exact name, then substring either direction.
        let picked = feeCat
          ? candidates.find(p => p.name.toLowerCase() === feeCat)
            ?? candidates.find(p => p.name.toLowerCase().includes(feeCat) || feeCat.includes(p.name.toLowerCase()))
          : undefined;
        if (!picked) picked = candidates[0];
        if (picked) {
          return { plan_id: picked.id, plan_name: picked.name };
        }
        // Mapping exists but none of its ids resolved (plan deleted?) —
        // still return the first id with the facility's product_name so the
        // row doesn't fall back to Unmapped unexpectedly.
        return { plan_id: ids[0], plan_name: mapping?.product_name ?? null };
      }
    }
    return {
      plan_id: patientMatch?.plan_id ?? null,
      plan_name: patientMatch?.plan_name ?? null,
    };
  }, [denplanFacilityMappings, allActivePlans]);

  // Preview plan summary (before confirm) — inject the auto-resolved
  // mapped_plan_name from rowPlanMatches so grouping reflects the
  // per-patient plan rather than CSV fee_category. Facility mappings
  // (if saved) override the patient plan for rows from that facility.
  const previewPlanSummary = useMemo(() => {
    if (!previewRows) return [] as PlanRevenueSummary[];
    const enriched = previewRows.map((r, i) => {
      const patientMatch = rowPlanMatches[i];
      const { plan_id, plan_name } = resolveRowPlan(r, patientMatch);
      return {
        fee_category: r.fee_category,
        net_due: r.net_due,
        discount_percent: r.discount_percent,
        mapped_plan_id: plan_id,
        mapped_plan_name: plan_name,
        // Keeps the preview grouped by the STATEMENT's plans for Practice
        // Plan PDFs (same rule as the saved view).
        explanatory_text: r.explanatory_text,
      };
    });
    return buildPlanSummary(enriched);
  }, [previewRows, rowPlanMatches, resolveRowPlan]);
  const previewTotalRevenue = useMemo(() => previewPlanSummary.reduce((s, p) => s + p.total_net_due, 0), [previewPlanSummary]);
  const previewTotalMembers = useMemo(() => previewPlanSummary.reduce((s, p) => s + p.members, 0), [previewPlanSummary]);

  // Surname validation: set of surnames found in DB (lowercase for matching)
  const [validSurnames, setValidSurnames] = useState<Set<string>>(new Set());
  // Map: full surname (lowercase) → pt_id (bigint as string)
  const [surnamePatientIdMap, setSurnamePatientIdMap] = useState<Map<string, string>>(new Map());
  const [isValidating, setIsValidating] = useState(false);

  // Step 1: Parse file(s) → validate surnames → show preview (no DB write).
  // Accepts one or many files — rows from all files are concatenated so the
  // user can import a whole month's worth of sheets in a single pass.
  const handleFileSelect = useCallback(async (files: File | File[]) => {
    setIsValidating(true);
    try {
      const fileList = Array.isArray(files) ? files : [files];
      if (fileList.length === 0) {
        setIsValidating(false);
        return;
      }

      // Route by file type: Practice Plan monthly statements arrive as PDFs
      // (parsed into the same row shape — dynamic import keeps pdf.js out of
      // the main bundle); everything else is the Denplan-style Excel/CSV.
      const parsed = await Promise.all(fileList.map(async (f) => {
        if (f.name.toLowerCase().endsWith('.pdf')) {
          const { parsePracticePlanPdf } = await import('@/utils/practicePlanPdfParser');
          return await parsePracticePlanPdf(f);
        }
        return await parseMembershipFile(f);
      }));
      // A Practice Plan statement names its own month ("Statement for July
      // 2026") — preselect it in the import dialog so the data lands in the
      // statement's month rather than whatever the page filter shows.
      const statementParsed = parsed.find(
        (p): p is typeof p & { statementMonth: number; statementYear: number } =>
          typeof (p as any).statementMonth === 'number' && typeof (p as any).statementYear === 'number',
      );
      // Stage every PP statement parse (header totals + failed/cancelled
      // rows) for persistence when the import is confirmed.
      ppStatementsRef.current = parsed.filter(
        (p): p is PracticePlanParseResult => Array.isArray((p as any).planBreakdown),
      );
      const combinedRows: ParsedMembershipRow[] = [];
      const combinedErrors: string[] = [];
      // Group parsed files by facility_id so the UI can flag unmapped ones.
      const facilityAgg = new Map<string, { file_names: string[]; row_count: number }>();
      for (let i = 0; i < parsed.length; i++) {
        combinedRows.push(...parsed[i].data);
        for (const e of parsed[i].errors) {
          combinedErrors.push(fileList.length > 1 ? `${fileList[i].name}: ${e}` : e);
        }
        const fid = parsed[i].facilityId;
        if (fid) {
          const prev = facilityAgg.get(fid) ?? { file_names: [], row_count: 0 };
          prev.file_names.push(parsed[i].fileName);
          prev.row_count += parsed[i].data.length;
          facilityAgg.set(fid, prev);
        }
      }
      const mappingByFacility = new Map<string, DenplanFacilityMapping>();
      for (const m of denplanFacilityMappings) mappingByFacility.set(m.facility_id, m);
      const detected: DetectedFacility[] = Array.from(facilityAgg.entries()).map(([facility_id, v]) => ({
        facility_id,
        file_names: v.file_names,
        row_count: v.row_count,
        mapping: mappingByFacility.get(facility_id) ?? null,
      }));
      setDetectedFacilities(detected);

      const result = { data: combinedRows, errors: combinedErrors };
      if (result.data.length === 0) {
        setIsValidating(false);
        toast.error('No valid rows found in file(s)');
        return;
      }

      // Validate surnames against patients table.
      // The "surname" field may contain a full name like "Christiane Paschoal"
      // so we extract the last word as last name and match against pt_last_name.
      const uniqueSurnames = [...new Set(result.data.map(r => r.surname.trim()))];
      const foundSurnames = new Set<string>();

      // Fetch patient last names + first names + pt_id + DOB + plan id for this org
      // Map: lowercase last name → array of candidate patients
      interface DbPatientCandidate {
        pt_id: string;
        legacyId: string | null; // patients.pt_legacy_id — the value that must be written back as patient_id
        firstName: string;
        lastName: string;
        title: string;
        dob: string | null; // YYYY-MM-DD
        planId: string | null; // payment_plans.id (UUID) via pt_payment_plan_id lookup below
        ppId: string | null; // raw pt_payment_plan_id (number-as-string)
        locationId: string | null; // practice_locations.id — patient's home location
      }
      const dbPatients = new Map<string, Array<DbPatientCandidate>>();
      // Secondary index by DOB — used as a fallback when last-name lookup
      // fails (maiden/married name changes, spelling drift). DOB + first-
      // name initial is usually enough to uniquely identify a patient.
      const dbPatientsByDob = new Map<string, Array<DbPatientCandidate>>();
      // Primary index by legacy_id — the CSV "patient_id" column carries
      // Dentally's legacy_id for the patient, so this is the most reliable
      // join when the column is present.
      const dbPatientsByLegacyId = new Map<string, DbPatientCandidate>();

      // Normalize helper — strip zero-width / non-breaking whitespace and
      // lowercase. Used for both sides of the surname/firstName match so
      // whitespace quirks in DB values don't break equality with sheet keys.
      // FOLD DIACRITICS on both sides of every name comparison (2026-08-20,
      // Dominiak case: Dentally stores "Przemys\u0142aw" with the Polish \u0142, the
      // Practice Plan statement prints an ASCII transliteration \u2014 the two
      // must compare equal). NFD strips combining accents (\u00E9\u2192e); stroked
      // letters aren't decomposable and need the explicit map.
      const foldName = (v: string) =>
        v
          .normalize('NFD')
          .replace(/[\u0300-\u036F]/g, '')
          .replace(/[\u0142\u0141]/g, 'l')
          .replace(/[\u00F8\u00D8]/g, 'o')
          .replace(/[\u0111\u0110]/g, 'd')
          .replace(/\u00DF/g, 'ss')
          .replace(/[\u00E6\u00C6]/g, 'ae')
          .replace(/[\u0153\u0152]/g, 'oe');
      const normName = (v: string | null | undefined) =>
        foldName(
          (v ?? '')
            .replace(/[\u00A0\u200B\u200C\u200D\uFEFF]/g, ' ')
            .trim()
            .toLowerCase(),
        );

      // Collect the set of values we care about from the sheet so we can
      // fetch only the patients that might match. A blanket `.range()`
      // paginated fetch hits Supabase's 1000-row cap and silently drops
      // patients past that boundary — which is exactly why David Irish
      // (pt_id=9578) was missing from dbPatients even though he exists.
      const sheetSurnames = new Set<string>();
      const sheetDobs = new Set<string>();
      const sheetLegacyIds = new Set<string>();
      const sheetInitials = new Set<string>();
      const sheetPpIds = new Set<string>();
      // Build a fee_category \u2192 pp_id map from the payment_plans table so
      // we can fetch any patient assigned to a plan referenced by this
      // sheet. First collect the raw fee_categories from the sheet.
      const sheetFeeCategories = new Set<string>();
      for (const r of result.data) {
        const cleaned = r.surname.trim().replace(/[\u00A0\u200B\u200C\u200D\uFEFF]/g, ' ');
        const parts = cleaned.split(/\s+/).filter(Boolean);
        if (parts.length) {
          // Index every token of the surname so multi-word sheet values
          // ("Kershaw-Naylor" parsed as "Naylor") still pick up the DB row.
          for (const p of parts) {
            const t = p.toLowerCase().replace(/^[^a-z0-9]+/, '');
            if (t) sheetSurnames.add(t);
          }
          // Full cleaned string as a fallback key (hyphenated-as-one-token).
          sheetSurnames.add(cleaned.toLowerCase());
        }
        if (r.dob) sheetDobs.add(r.dob.slice(0, 10));
        if (r.patient_id) sheetLegacyIds.add(String(r.patient_id).trim());
        const init = (r.initial || '').trim().charAt(0).toLowerCase();
        if (init) sheetInitials.add(init);
        if (r.fee_category) sheetFeeCategories.add(r.fee_category);
      }

      // Resolve sheet fee_categories \u2192 payment_plan pp_ids. Payment plan
      // names can drift (pp_name vs pp_patient_friendly_name) so we match
      // either casing. Anyone with a matching pt_payment_plan_id is then
      // pulled into the candidate pool.
      if (sheetFeeCategories.size > 0) {
        const names = Array.from(sheetFeeCategories);
        const { data: ppRows } = await (supabase as any)
          .from('payment_plans')
          .select('pp_id, pp_name, pp_patient_friendly_name')
          .is('deleted_at', null)
          .or(names.map(n =>
            `pp_name.ilike.${n.replace(/[,()]/g, '')},pp_patient_friendly_name.ilike.${n.replace(/[,()]/g, '')}`
          ).join(','));
        for (const p of (ppRows ?? [])) {
          if (p.pp_id != null) sheetPpIds.add(String(p.pp_id));
        }
      }

      // Build one OR filter. Supabase's `.or()` accepts comma-separated
      // pred strings — for surname/firstName we want case-insensitive
      // equality via `ilike` (no wildcards so it's an exact match with
      // case folding). Chunk if needed to stay under URL length limits.
      const fetchPatientsFor = async (
        surnames: string[],
        dobs: string[],
        legacyIds: string[],
        initials: string[],
        ppIds: string[],
      ) => {
        const results: any[] = [];
        const CHUNK = 120; // conservative to stay within URL caps
        const escape = (v: string) => v.replace(/[,()]/g, '');
        const chunks = <T>(arr: T[]): T[][] => {
          const out: T[][] = [];
          for (let i = 0; i < arr.length; i += CHUNK) out.push(arr.slice(i, i + CHUNK));
          return out;
        };
        const PAGE = 1000;
        // Fetch a single page, RETRYING on error. A transient DB error (e.g. a
        // statement timeout under load) must NOT silently yield a partial
        // result — that made matching non-deterministic ("sometimes found,
        // sometimes not"). Returns null only if every retry fails.
        const fetchPage = async (predicates: string[], activeOnly: boolean, from: number): Promise<any[] | null> => {
          for (let attempt = 0; attempt < 3; attempt++) {
            let q = (supabase as any)
              .from('patients')
              .select('id, pt_id, pt_legacy_id, pt_first_name, pt_last_name, pt_title, pt_dob, pt_payment_plan_id, location_id, is_active')
              .is('deleted_at', null)
              .or(predicates.join(','))
              .order('id', { ascending: true })
              .range(from, from + PAGE - 1);
            if (organizationId) q = q.eq('organization_id', organizationId);
            if (activeOnly) q = q.eq('is_active', true);
            const { data, error } = await q;
            if (!error) return (data ?? []) as any[];
            console.warn(`[membership upload] candidate fetch retry ${attempt + 1}/3:`, error.message);
            await new Promise(res => setTimeout(res, 400 * (attempt + 1)));
          }
          console.error('[membership upload] candidate fetch failed after retries — predicates:', predicates.length);
          return null;
        };
        // Fetch one OR-chunk (paginating past the 1000-row cap when `paginate`).
        // `activeOnly` bounds the broad pool-wideners to active patients; paging
        // orders by the unique row PK `id` (pt_id is NOT unique in this org).
        const runChunk = async (predicates: string[], activeOnly = false, paginate = true): Promise<any[]> => {
          if (predicates.length === 0) return [];
          const out: any[] = [];
          let from = 0;
          for (;;) {
            const rows = await fetchPage(predicates, activeOnly, from);
            if (rows === null) break; // all retries exhausted — give up this chunk
            out.push(...rows);
            if (!paginate || rows.length < PAGE) break;
            from += PAGE;
          }
          return out;
        };
        // Run the chunks with bounded concurrency + retry. Callers keep the
        // heavy surname ILIKE chunks small (see the two-phase logic below), so
        // a modest pool stays both fast and timeout-free.
        const thunks: Array<() => Promise<any[]>> = [];
        for (const c of chunks(surnames)) thunks.push(() => runChunk(c.map(s => `pt_last_name.ilike.${escape(s)}`)));
        for (const c of chunks(dobs)) thunks.push(() => runChunk(c.map(d => `pt_dob.eq.${escape(d)}`)));
        for (const c of chunks(legacyIds)) thunks.push(() => runChunk(c.map(l => `pt_legacy_id.eq.${escape(l)}`)));
        // Broad pool-wideners — active-only and single-page (no pagination).
        if (initials.length > 0) thunks.push(() => runChunk(initials.map(i => `pt_first_name.ilike.${escape(i)}%`), true, false));
        for (const c of chunks(ppIds)) thunks.push(() => runChunk(c.map(p => `pt_payment_plan_id.eq.${escape(p)}`), true, false));

        const CONCURRENCY = 3;
        let next = 0;
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, thunks.length) }, async () => {
          while (next < thunks.length) {
            results.push(...await thunks[next++]());
          }
        }));
        return results;
      };

      // Index a batch of fetched patient rows into the lookup maps. Dedupe by
      // the row's unique PK `id` — NOT pt_id, which is reused across
      // integrations in this org (deduping by pt_id would treat two DISTINCT
      // patients as one and drop the second, displacing correct matches).
      const seenIds = new Set<string>();
      const indexRows = (rows: any[]) => {
        for (const r of rows) {
          const rowId = String(r.id);
          if (seenIds.has(rowId)) continue;
          seenIds.add(rowId);
          const lastName = normName(r.pt_last_name);
          const cand: DbPatientCandidate = {
            pt_id: String(r.pt_id),
            legacyId: r.pt_legacy_id != null ? String(r.pt_legacy_id) : null,
            firstName: normName(r.pt_first_name),
            lastName,
            title: normName(r.pt_title).replace(/\.$/, ''),
            dob: r.pt_dob ? String(r.pt_dob).slice(0, 10) : null,
            planId: null,
            ppId: r.pt_payment_plan_id != null ? String(r.pt_payment_plan_id) : null,
            locationId: r.location_id ?? null,
          };
          if (lastName) {
            const list = dbPatients.get(lastName) ?? [];
            list.push(cand);
            dbPatients.set(lastName, list);
            const parts = lastName.split(/\s+/).filter(Boolean);
            if (parts.length > 1) {
              const lastWord = parts[parts.length - 1].replace(/^[^a-z0-9]+/, '');
              if (lastWord && lastWord !== lastName) {
                const l2 = dbPatients.get(lastWord) ?? [];
                l2.push(cand);
                dbPatients.set(lastWord, l2);
              }
            }
          }
          if (cand.dob) {
            const dobList = dbPatientsByDob.get(cand.dob) ?? [];
            dobList.push(cand);
            dbPatientsByDob.set(cand.dob, dobList);
          }
          if (r.pt_legacy_id) {
            dbPatientsByLegacyId.set(String(r.pt_legacy_id).trim(), cand);
          }
        }
      };

      // ── Two-phase candidate fetch (fast on large orgs) ─────────────────────
      // The surname ILIKE is a sequential scan over the whole patients table
      // (~seconds each) and times out when several run concurrently; DOB and
      // legacy_id lookups are indexed and fast even org-wide. So:
      //   Phase 1: fetch by DOB + legacy_id (matches most rows quickly).
      //   Phase 2: run the surname scan ONLY for rows that did NOT match on DOB
      //            or legacy_id — usually a handful — so it's one small query
      //            instead of scanning the table dozens of times.
      indexRows(await fetchPatientsFor([], Array.from(sheetDobs), Array.from(sheetLegacyIds), [], []));

      const neededSurnames = new Set<string>();
      for (const r of result.data) {
        const rowDob = (r.dob || '').slice(0, 10);
        const legacyHit = r.patient_id != null && dbPatientsByLegacyId.has(String(r.patient_id).trim());
        // A DOB hit only skips the surname scan when one of its candidates
        // plausibly IS this member (surname or first-name token agreement).
        // A bare date collision with strangers must still scan: the
        // name-precedence stages below reject those candidates, and without
        // the scan the row would have no surname pool left to match against.
        const rowTokens = new Set(
          (r.surname + ' ' + (r.initial || ''))
            .toLowerCase()
            .split(/\s+/)
            .map(t => foldName(t).replace(/^[^a-z0-9]+/, ''))
            .filter(t => t.length > 1),
        );
        const dobHit = !!rowDob && (dbPatientsByDob.get(rowDob) ?? []).some(c =>
          c.lastName.split(/\s+/).some(t => rowTokens.has(t))
          || rowTokens.has(c.firstName.split(/\s+/)[0] ?? ''),
        );
        if (legacyHit || dobHit) continue; // already matchable without a surname scan
        const cleaned = r.surname.trim().replace(/[ ​‌‍﻿]/g, ' ');
        const parts = cleaned.split(/\s+/).filter(Boolean);
        for (const p of parts) {
          const t = p.toLowerCase().replace(/^[^a-z0-9]+/, '');
          if (t) neededSurnames.add(t);
        }
        if (cleaned) neededSurnames.add(cleaned.toLowerCase());
      }

      indexRows(await fetchPatientsFor(
        Array.from(neededSurnames),
        [],
        [],
        Array.from(sheetInitials),
        Array.from(sheetPpIds),
      ));

      // Fetch payment_plans map: pp_id (integer key) → { id (uuid), name }
      const ppIdToPlan = new Map<string, { id: string; name: string }>();
      {
        const { data: plansData } = await (supabase as any)
          .from('payment_plans')
          .select('id, pp_id, pp_name, pp_patient_friendly_name')
          .is('deleted_at', null);
        for (const p of (plansData ?? [])) {
          const name = (p.pp_name || p.pp_patient_friendly_name || 'Unnamed') as string;
          if (p.pp_id != null) {
            ppIdToPlan.set(String(p.pp_id), { id: p.id as string, name });
          }
        }
      }

      // Resolve each DB patient's plan (pp_id → payment_plans.id)
      for (const candidates of dbPatients.values()) {
        for (const c of candidates) {
          if (c.ppId) {
            const plan = ppIdToPlan.get(c.ppId);
            if (plan) c.planId = plan.id;
          }
        }
      }

      // Per-row match — sequential stages:
      //   Stage 1: CSV patient_id → patients.pt_legacy_id (Dentally legacy).
      //   Stage 2: DOB match across all patients in the org, but ONLY among
      //            candidates whose NAME corroborates (client rule
      //            2026-08-19: the statement prints the member's full name;
      //            when name and DOB disagree, the name wins — a stranger
      //            sharing only the birthday must never match).
      //   Stage 3: Surname + full-first-name match (falling back to initial
      //            for sheet rows that only carry one), title + DOB as
      //            tiebreaks. A full first name that CONTRADICTS a candidate
      //            disqualifies it even when the surname agrees.
      // If all stages fail → unmatched (row surfaces under "Unassigned").
      const normTitle = (v: string) => v.trim().toLowerCase().replace(/\.$/, '');
      const matches: RowPlanMatch[] = result.data.map((r) => {
        const cleaned = r.surname.trim().replace(/[\u00A0\u200B\u200C\u200D\uFEFF]/g, ' ');
        const parts = cleaned.split(/\s+/).filter(Boolean);
        // foldName on every row-side key \u2014 dbPatients / candidate names are
        // indexed via normName (folded), so unfolded row keys would miss
        // any candidate whose name carries a diacritic.
        const lastNameRaw = parts.length ? foldName(parts[parts.length - 1].toLowerCase()) : '';
        const lastName = lastNameRaw.replace(/^[^a-z0-9]+/, '');
        const altKeys = [foldName(cleaned.toLowerCase()), lastNameRaw].filter(k => k && k !== lastName);
        const firstName = parts.length > 1 ? foldName(parts[0].toLowerCase()) : '';
        const rowDob = (r.dob || '').slice(0, 10);
        const rowInitial = foldName((r.initial || '').trim().charAt(0).toLowerCase());
        const rowTitle = normTitle(r.title || '');
        // Full first name — Practice Plan statements print the member's whole
        // given names (the parser stores them in `initial`, e.g. "Nicholas M");
        // Denplan sheets may instead carry "First Last" in the surname blob.
        // A single-letter value is a real initial, not a name — leave empty so
        // the initial-only paths below keep handling sheet rows.
        const givenFirst = foldName(((r.initial || '').trim().split(/\s+/)[0] ?? '').toLowerCase());
        const rowFullFirst = givenFirst.length > 1 ? givenFirst : (firstName.length > 1 ? firstName : '');
        const dbFirstToken = (c: DbPatientCandidate) => c.firstName.split(/\s+/)[0] ?? '';
        // First-name compatibility: with a full first name, exact, prefix
        // either way ("Nick" ↔ "Nicholas"), or a SINGLE-CHARACTER typo
        // (edit distance 1 — the statement's own misspelling: "Premyslaw"
        // for "Przemyslaw", Dominiak case 2026-08-20; same tolerance the
        // dentist matcher has had since 2026-08-11). With only an initial,
        // the initial must agree; with neither, any candidate is compatible.
        const firstNameCompatible = (c: DbPatientCandidate) => {
          const dbFirst = dbFirstToken(c);
          if (rowFullFirst) {
            return !!dbFirst && (
              dbFirst === rowFullFirst
              || dbFirst.startsWith(rowFullFirst)
              || rowFullFirst.startsWith(dbFirst)
              || isEditDistanceOne(dbFirst, rowFullFirst)
            );
          }
          return rowInitial ? dbFirst.charAt(0) === rowInitial : true;
        };
        const surnameAgrees = (c: DbPatientCandidate) =>
          (!!lastName && (c.lastName === lastName || altKeys.includes(c.lastName)))
          || (!!lastName && c.lastName.split(/\s+/).includes(lastName));

        let chosen: DbPatientCandidate | undefined;

        // Stage 1: legacy_id primary join.
        if (r.patient_id) {
          const byLegacy = dbPatientsByLegacyId.get(String(r.patient_id).trim());
          if (byLegacy) chosen = byLegacy;
        }

        // Stage 2: DOB lookup across the entire org — but a shared birthday
        // alone is NOT a match: the candidate's name must also corroborate
        // (surname agreement covers the normal case; first-name compatibility
        // alone still allows a married/maiden surname change). Candidates that
        // share only the date are strangers — they're filtered out and the
        // row falls through to the name stages below, where the name wins.
        if (!chosen && rowDob) {
          const dobCandidates = (dbPatientsByDob.get(rowDob) ?? [])
            .filter(c => surnameAgrees(c) || firstNameCompatible(c));
          if (dobCandidates.length === 1) {
            chosen = dobCandidates[0];
          } else if (dobCandidates.length > 1) {
            // Disambiguate by surname → full first name → initial → title.
            const bySurname = lastName
              ? dobCandidates.filter(c => c.lastName === lastName
                  || altKeys.includes(c.lastName))
              : dobCandidates;
            const pool = bySurname.length ? bySurname : dobCandidates;
            chosen = (rowFullFirst ? pool.find(c => dbFirstToken(c) === rowFullFirst) : undefined)
              ?? (rowInitial ? pool.find(c => c.firstName.charAt(0) === rowInitial) : undefined)
              ?? (rowTitle ? pool.find(c => c.title === rowTitle) : undefined)
              ?? pool[0];
          }
        }

        // Stage 3: surname + initial + title.
        if (!chosen && lastName) {
          let candidates = dbPatients.get(lastName);
          if (!candidates || candidates.length === 0) {
            for (const k of altKeys) {
              const alt = dbPatients.get(k);
              if (alt && alt.length > 0) { candidates = alt; break; }
            }
          }
          if (candidates && candidates.length > 0) {
            if (candidates.length === 1) {
              // Surname-only agreement isn't enough when the statement gives
              // a full first name that CONTRADICTS the only candidate ("Mrs
              // Marilynn Wake" must not match the org's only other Wake,
              // Elizabeth) — require a compatible first name or an agreeing
              // DOB before accepting.
              const only = candidates[0];
              if (firstNameCompatible(only) || (!!rowDob && only.dob === rowDob)) {
                chosen = only;
              }
            } else {
              // Narrow by full first name first (statements print it), else
              // initial; then title; DOB and exact first name break remaining
              // ties. A row with a full first name never falls back to a
              // candidate that contradicts it — if no candidate's first name
              // is compatible, only an exact-DOB candidate may still match.
              let pool = candidates;
              if (rowFullFirst) {
                const byFullFirst = pool.filter(c => firstNameCompatible(c));
                pool = byFullFirst.length > 0
                  ? byFullFirst
                  : (rowDob ? pool.filter(c => c.dob === rowDob) : []);
              } else if (rowInitial) {
                const byInitial = pool.filter(c => c.firstName.charAt(0) === rowInitial);
                if (byInitial.length > 0) pool = byInitial;
              }
              if (pool.length > 1 && rowTitle) {
                const byTitle = pool.filter(c => c.title === rowTitle);
                if (byTitle.length > 0) pool = byTitle;
              }
              if (pool.length === 1) {
                chosen = pool[0];
              } else if (pool.length > 1) {
                chosen = (rowDob ? pool.find(c => c.dob === rowDob) : undefined)
                  ?? (rowFullFirst ? pool.find(c => dbFirstToken(c) === rowFullFirst) : undefined)
                  ?? pool[0];
              }
            }
          }
        }

        // Stage 4: fuzzy surname (edit-distance-1) + exact initial + exact
        // title — last resort for a single-character statement typo (see
        // isEditDistanceOne). Requires BOTH initial and title to agree AND
        // exactly one surviving candidate; an ambiguous pool (more than one
        // plausible patient) stays unmatched rather than guessing, same as
        // every stage above.
        if (!chosen && lastName && rowInitial) {
          const fuzzy: DbPatientCandidate[] = [];
          const seenFuzzyIds = new Set<string>();
          for (const [key, list] of dbPatients.entries()) {
            if (!isEditDistanceOne(key, lastName)) continue;
            for (const c of list) {
              if (seenFuzzyIds.has(c.pt_id)) continue;
              seenFuzzyIds.add(c.pt_id);
              fuzzy.push(c);
            }
          }
          // firstNameCompatible is stricter than a bare initial when the row
          // carries a full first name (PP statements always do).
          let pool = fuzzy.filter(c => c.firstName.charAt(0) === rowInitial && firstNameCompatible(c));
          if (rowTitle) pool = pool.filter(c => c.title === rowTitle);
          if (pool.length === 1) {
            chosen = pool[0];
            console.info('[membership upload] fuzzy-matched row (single-character surname typo)', {
              statementSurname: r.surname, matchedSurname: chosen.lastName, pt_id: chosen.pt_id,
            });
          }
        }

        // Facility override is applied lazily at render/insert time (see
        // `applyFacilityOverride` below) so the preview stays reactive when
        // the user saves a new mapping from the preview dialog.
        if (!chosen) {
          // Diagnostic — only fires for unmatched rows so log volume is small.
          console.warn('[membership upload] row unmatched', {
            patient_id: r.patient_id,
            surname: r.surname,
            lastName,
            altKeys,
            initial: r.initial,
            title: r.title,
            rowDob,
            dbHasSurname: dbPatients.has(lastName),
            dbSurnameCandidateCount: dbPatients.get(lastName)?.length ?? 0,
            dbSurnameCandidates: (dbPatients.get(lastName) ?? []).map(c => ({
              pt_id: c.pt_id, firstName: c.firstName, lastName: c.lastName,
              title: c.title, dob: c.dob,
            })),
          });
          return { pt_id: null, legacy_id: null, plan_id: null, plan_name: null, dob: null, location_id: null };
        }

        const patientPlan = chosen.ppId ? ppIdToPlan.get(chosen.ppId) : undefined;
        return {
          pt_id: chosen.pt_id,
          legacy_id: chosen.legacyId,
          plan_id: patientPlan?.id ?? null,
          plan_name: patientPlan?.name ?? null,
          dob: chosen.dob,
          location_id: chosen.locationId,
        };
      });
      setRowPlanMatches(matches);

      // ── Auto-infer facility → plan mappings from matched patients ──────────
      // The Denplan CSV carries no product column (the facility → product table
      // lives only on denplan.co.uk's "Information about your plans" page), so
      // for any facility WITHOUT a saved mapping we derive its plan(s) from the
      // plans its own matched patients are assigned to (patients.pt_payment_plan_id).
      // The most common plan becomes the facility's product_name; every distinct
      // plan is kept in payment_plan_ids so the per-row override can still pick
      // the best match by fee_category. Saved mappings are never overwritten.
      const facilityPlanCounts = new Map<string, Map<string, { name: string; count: number }>>();
      for (let i = 0; i < result.data.length; i++) {
        const fid = result.data[i].source_facility_id;
        const m = matches[i];
        if (!fid || !m?.plan_id) continue;
        if (mappingByFacility.has(fid)) continue; // respect an existing saved mapping
        let counts = facilityPlanCounts.get(fid);
        if (!counts) { counts = new Map(); facilityPlanCounts.set(fid, counts); }
        const cur = counts.get(m.plan_id) ?? { name: m.plan_name ?? 'Unnamed', count: 0 };
        cur.count += 1;
        counts.set(m.plan_id, cur);
      }

      const inferredRows = Array.from(facilityPlanCounts.entries()).map(([facility_id, counts]) => {
        // Order plans by how many of the facility's patients hold them; the
        // dominant plan names the facility, the rest stay available for the
        // per-row fee_category override.
        const ordered = Array.from(counts.entries()).sort((a, b) => b[1].count - a[1].count);
        return {
          facility_id,
          product_name: ordered[0]?.[1].name ?? 'Denplan',
          payment_plan_ids: ordered.map(([id]) => id),
        };
      });

      if (inferredRows.length > 0 && organizationId) {
        const payload = inferredRows.map(r => ({
          organization_id: organizationId,
          facility_id: r.facility_id,
          product_name: r.product_name,
          payment_plan_ids: r.payment_plan_ids,
          payment_plan_id: r.payment_plan_ids[0] ?? null,
          updated_at: new Date().toISOString(),
        }));
        const { data: saved, error: saveErr } = await (supabase as any)
          .from('denplan_facility_mappings')
          .upsert(payload, { onConflict: 'organization_id,facility_id' })
          .select('id, facility_id, product_name, dentist_name, payment_plan_id, payment_plan_ids');
        if (saveErr) {
          console.warn('[membership upload] facility auto-map persist failed:', saveErr);
        } else {
          const savedByFacility = new Map<string, DenplanFacilityMapping>();
          for (const s of (saved ?? [])) {
            savedByFacility.set(s.facility_id, {
              id: s.id,
              facility_id: s.facility_id,
              product_name: s.product_name,
              dentist_name: s.dentist_name ?? null,
              payment_plan_id: s.payment_plan_id ?? null,
              payment_plan_ids: Array.isArray(s.payment_plan_ids) ? s.payment_plan_ids : [],
            });
          }
          // Reflect the inferred mappings in the detected-facilities panel and
          // refresh the org-wide mapping catalog so resolveRowPlan picks them up.
          setDetectedFacilities(prev => prev.map(f =>
            savedByFacility.has(f.facility_id) ? { ...f, mapping: savedByFacility.get(f.facility_id)! } : f));
          queryClient.invalidateQueries({ queryKey: ['denplan_facility_mappings', organizationId] });
          toast.success(`Auto-mapped ${inferredRows.length} facilit${inferredRows.length === 1 ? 'y' : 'ies'} from patient plans`);
        }
      }

      const matchedCount = matches.filter(m => !!m.pt_id).length;
      // Count every candidate across all surname buckets (some may be
      // indexed under multiple keys, so dedupe by pt_id).
      const uniquePtIds = new Set<string>();
      for (const list of dbPatients.values()) for (const c of list) uniquePtIds.add(c.pt_id);
      console.log('[membership upload] matching summary', {
        rowsParsed: result.data.length,
        dbPatientLastNameKeys: dbPatients.size,
        dbUniquePatientsFetched: uniquePtIds.size,
        rowsMatched: matchedCount,
        davidIrishInFetch: uniquePtIds.has('9578'),
        irishKeyInMap: dbPatients.has('irish'),
        irishCandidates: (dbPatients.get('irish') ?? []).map(c => ({ pt_id: c.pt_id, firstName: c.firstName })),
        sampleRowDobs: result.data.slice(0, 5).map(r => ({ surname: r.surname, dob: r.dob })),
      });

      // Keep the old surname-only validation map (used elsewhere for display)
      const ptIdMap = new Map<string, string>();
      for (let i = 0; i < result.data.length; i++) {
        const r = result.data[i];
        const m = matches[i];
        if (m.pt_id) {
          foundSurnames.add(r.surname.toLowerCase());
          ptIdMap.set(r.surname.toLowerCase(), m.pt_id);
        }
      }
      setValidSurnames(foundSurnames);
      setSurnamePatientIdMap(ptIdMap);
      setIsValidating(false);

      // Add warnings for names not found
      const notFound = uniqueSurnames.filter(s => !foundSurnames.has(s.toLowerCase()));
      const errors = [...result.errors];
      if (notFound.length > 0) {
        errors.push(`${notFound.length} name(s) not found in patients: ${notFound.join(', ')}`);
      }
      setParseErrors(errors);

      // Default import month/year: a Practice Plan statement dictates its own
      // month; otherwise fall back to what's currently selected in the view.
      setImportMonth(statementParsed?.statementMonth ?? selectedMonth);
      setImportYear(statementParsed?.statementYear ?? selectedYear);

      // Initialize fee-category → plan mapping. For any category that matches
      // a DB plan name case-insensitively, pre-select that plan.
      const planNameLookup = new Map<string, string>();
      for (const p of availablePlans) planNameLookup.set(p.name.toLowerCase(), p.id);
      const uniqueCategories = Array.from(new Set(result.data.map(r => r.fee_category)));
      const initialMap: Record<string, string> = {};
      for (const cat of uniqueCategories) {
        const matchedId = planNameLookup.get(cat.toLowerCase());
        if (matchedId) initialMap[cat] = matchedId;
      }
      setFeeCategoryPlanMap(initialMap);

      // Practice Plan statements import IMMEDIATELY — no preview/confirm step.
      // The statement is authoritative: it names its own month and the parser
      // reconciles row count + total against the statement's own summary, so
      // there is nothing for the user to decide. The preview dialog still
      // opens as a safety net whenever the PARSER raised any warning
      // (unreadable month, unknown plan code, count/total mismatch) so
      // questionable data never lands silently. Patient-name mismatches do
      // NOT block auto-import — unmatched members still import and surface
      // under "Unassigned", same as a confirmed import.
      const isPracticePlanBatch =
        result.data.length > 0 &&
        result.data.every(r => r.explanatory_text === 'Practice Plan statement');
      // The location this import is tagged to: the preview dialog's own pick
      // when one was made, else the header's currently selected location.
      // The MANUAL path marks Location as REQUIRED (Confirm stays disabled
      // without one) — auto-import must honour the same rule, not bypass it:
      // it previously passed importLocationId (null unless the dialog had
      // opened), importing whole statements with NO location, which the
      // header's location filter then hid (client-flagged "99 instead of
      // 144" — 42 of 141 members invisible under the selected location).
      const resolvedImportLocationId = importLocationId ?? selectedLocationId ?? null;
      if (resolvedImportLocationId && !importLocationId) setImportLocationId(resolvedImportLocationId);
      if (
        isPracticePlanBatch &&
        statementParsed &&
        combinedErrors.length === 0 &&
        resolvedImportLocationId
      ) {
        toast.info(`Statement parsed — importing ${result.data.length} members for ${MONTH_NAMES[statementParsed.statementMonth - 1]} ${statementParsed.statementYear}…`);
        confirmMutation.mutate({
          rows: result.data,
          rowMatches: matches,
          month: statementParsed.statementMonth,
          year: statementParsed.statementYear,
          locationId: resolvedImportLocationId,
        });
        return;
      }

      setPreviewRows(result.data);
    } catch (err: any) {
      setIsValidating(false);
      toast.error(`Parse failed: ${err.message}`);
    }
  }, [selectedMonth, selectedYear, organizationId, user?.id, availablePlans, selectedLocationId, importLocationId]);

  const cancelPreview = useCallback(() => {
    setPreviewRows(null);
    setParseErrors([]);
    setFeeCategoryPlanMap({});
    setRowPlanMatches([]);
    setDetectedFacilities([]);
    ppStatementsRef.current = [];
  }, []);

  const setFeeCategoryPlan = useCallback((feeCategory: string, planId: string | null) => {
    setFeeCategoryPlanMap(prev => {
      const next = { ...prev };
      if (planId) next[feeCategory] = planId;
      else delete next[feeCategory];
      return next;
    });
  }, []);

  // Step 2: Confirm → save to DB with chosen month/year
  const confirmMutation = useMutation({
    mutationFn: async ({
      rows,
      rowMatches,
      month,
      year,
      locationId,
    }: {
      rows: ParsedMembershipRow[];
      rowMatches: RowPlanMatch[];
      month: number;
      year: number;
      locationId: string | null;
    }) => {
      if (!organizationId || !user?.id) throw new Error('Not authenticated');

      // Merge behaviour: existing rows for this org+location+month+year are
      // preserved. Dedupe key is (pay_grp_id + surname + initial + dob) —
      // Dentally groups a whole family under one pay_grp_id but each family
      // member is a separate row, so we include member identity to avoid
      // collapsing e.g. "Mr Adams" and "Mrs Adams" into one.
      //
      // In-batch dedupe: Dentally exports occasionally emit the same member
      // row twice (observed in Feb 2026 export: 199 duplicated pairs). We
      // collapse rows sharing the member key to the first occurrence so the
      // DB doesn't store phantom members and revenue isn't double-counted.

      // Insert in batches
      const BATCH = 500;
      const toInt = (v: string | null): number | null => {
        if (v == null) return null;
        const n = parseInt(v.replace(/[^0-9\-]/g, ''), 10);
        return Number.isFinite(n) ? n : null;
      };

      // Step A: build member keys and drop in-batch duplicates.
      // Identity preference: patient_id (Dentally legacy_id) > composite
      // (pay_grp_id + surname + initial + dob). Rows with neither are always
      // kept — no safe identity anchor to dedupe on.
      const norm = (v: string | null | undefined) => (v ?? '').trim().toLowerCase();
      const memberKey = (r: ParsedMembershipRow): string | null => {
        const grp = r.pay_grp_id != null ? String(r.pay_grp_id).trim() : '';
        if (grp === '') return null;
        return `${grp}|${norm(r.surname)}|${norm(r.initial)}|${norm(r.dob)}`;
      };
      const dedupeKey = (r: ParsedMembershipRow): string | null => {
        const pid = r.patient_id != null ? String(r.patient_id).trim() : '';
        if (pid !== '') return `pid:${pid}`;
        const mk = memberKey(r);
        return mk ? `mk:${mk}` : null;
      };
      const dedupedIndices: number[] = [];
      const incomingKeySetLocal = new Set<string>();
      const seenInBatch = new Set<string>();
      let duplicatesDropped = 0;
      for (let i = 0; i < rows.length; i++) {
        const mk = memberKey(rows[i]);
        if (mk) incomingKeySetLocal.add(mk);
        const dk = dedupeKey(rows[i]);
        if (dk) {
          if (seenInBatch.has(dk)) {
            duplicatesDropped++;
            continue;
          }
          seenInBatch.add(dk);
        }
        dedupedIndices.push(i);
      }
      if (duplicatesDropped > 0) {
        console.info('[membership upload] dropped in-batch duplicate rows', {
          duplicatesDropped,
          totalRows: rows.length,
          uniqueRows: dedupedIndices.length,
        });
      }

      // Step B: soft-delete existing DB rows that share the same member key
      // (pay_grp_id + surname + initial + dob) for this org+location+month+year,
      // so re-imports replace the old row for that member instead of creating
      // a duplicate. Other family members in the same pay_grp_id are preserved.
      const incomingKeys = Array.from(incomingKeySetLocal);
      if (incomingKeys.length > 0) {
        const incomingGrpIds = Array.from(new Set(
          incomingKeys.map(k => k.split('|')[0]).filter(Boolean),
        ));
        // Look across ALL locations in the org for this month — rows are now
        // stored per-patient-location, so a re-uploaded member may live under
        // a different location_id than the header filter currently shows.
        const q = (supabase as any)
          .from('membership_upload_members')
          .select('id, pay_grp_id, surname, initial, dob')
          .eq('organization_id', organizationId)
          .eq('upload_month', month)
          .eq('upload_year', year)
          .is('deleted_at', null)
          .in('pay_grp_id', incomingGrpIds);
        const { data: existing, error: selErr } = await q;
        if (selErr) throw selErr;
        const incomingKeySet = new Set(incomingKeys);
        const toDeleteIds: string[] = [];
        for (const row of (existing ?? [])) {
          const grp = row.pay_grp_id != null ? String(row.pay_grp_id).trim() : '';
          if (!grp) continue;
          const k = `${grp}|${norm(row.surname)}|${norm(row.initial)}|${norm(row.dob)}`;
          if (incomingKeySet.has(k)) toDeleteIds.push(row.id);
        }
        if (toDeleteIds.length > 0) {
          const { error: delErr } = await (supabase as any)
            .from('membership_upload_members')
            .update({ deleted_at: new Date().toISOString() })
            .in('id', toDeleteIds);
          if (delErr) throw delErr;
        }
      }

      // Matched patients WITHOUT a pt_legacy_id (newer Dentally records never
      // got one) may fall back to pt_id as the row's patient_id join key —
      // but ONLY when that pt_id is unambiguous org-wide: unique among this
      // org's patients AND not colliding with any patient's legacy id, since
      // the read path (enrichWithCurrentPlan) resolves patient_id against
      // BOTH keyspaces. pt_id repeats across this org's Dentally sites, so an
      // unguarded fallback would mis-attribute members (same failure class as
      // the legacy-card-number collision — see the dedupe key comment above).
      const fallbackPtIds = Array.from(new Set(
        dedupedIndices
          .map(i => rowMatches[i])
          .filter(m => m && !m.legacy_id && m.pt_id)
          .map(m => String(m!.pt_id)),
      ));
      const safePtIds = new Set<string>();
      if (fallbackPtIds.length > 0) {
        const CHUNK_IDS = 150;
        const ptIdRowCount = new Map<string, number>();
        const legacyCollisions = new Set<string>();
        for (let i = 0; i < fallbackPtIds.length; i += CHUNK_IDS) {
          const chunk = fallbackPtIds.slice(i, i + CHUNK_IDS);
          const { data: ptRows, error: ptErr } = await (supabase as any)
            .from('patients')
            .select('id, pt_id')
            .eq('organization_id', organizationId)
            .is('deleted_at', null)
            .in('pt_id', chunk);
          if (ptErr) throw ptErr;
          for (const p of (ptRows ?? [])) {
            const k = String(p.pt_id);
            ptIdRowCount.set(k, (ptIdRowCount.get(k) ?? 0) + 1);
          }
          const { data: legRows, error: legErr } = await (supabase as any)
            .from('patients')
            .select('id, pt_legacy_id')
            .eq('organization_id', organizationId)
            .is('deleted_at', null)
            .in('pt_legacy_id', chunk);
          if (legErr) throw legErr;
          for (const p of (legRows ?? [])) {
            if (p.pt_legacy_id != null) legacyCollisions.add(String(p.pt_legacy_id).trim());
          }
        }
        for (const k of fallbackPtIds) {
          if ((ptIdRowCount.get(k) ?? 0) === 1 && !legacyCollisions.has(k)) safePtIds.add(k);
        }
      }

      const dbRows = dedupedIndices.map(i => rows[i]).map((r, j) => {
        const origIdx = dedupedIndices[j];
        const match = rowMatches[origIdx];
        // Facility mapping override — same rule as the preview summary so
        // what the user reviewed is exactly what gets inserted.
        const { plan_id: mappedPlanId, plan_name: mappedPlanName } = resolveRowPlan(r, match);
        // r.patient_id is only meaningful for Denplan/CSV sheet uploads, whose
        // own "patient_id" column already IS Dentally's legacy_id. For every
        // other upload type (e.g. Practice Plan PDFs, which carry no such
        // column) a name-based match is used instead — and that match must
        // write back the candidate's legacy_id, never its pt_id: pt_id is
        // Dentally's numeric row key, reused across integrations, so writing
        // it here silently mis-attributes membership revenue to whichever
        // unrelated patient happens to share that number.
        const resolvedPatientId = r.patient_id
          ?? match?.legacy_id
          ?? (match?.pt_id && safePtIds.has(String(match.pt_id)) ? String(match.pt_id) : null);

        return {
          organization_id: organizationId,
          // Client rule 2026-08-19: every member in an uploaded statement
          // belongs to the location the file was uploaded FOR — never
          // scattered to each patient's own registered home location (a
          // patient registered at site A but on site B's statement was
          // splitting one statement's members across sites). The matched
          // patient's home location is only a fallback for an upload made
          // with no location selected ("All").
          location_id: locationId ?? match?.location_id ?? null,
          // The location this file was uploaded for (whole-file scope).
          upload_location_id: locationId ?? null,
          surname: r.surname,
          initial: r.initial || null,
          dob: r.dob || null,
          treating_dentist: r.treating_dentist || null,
          fee_category: r.fee_category,
          discount_percent: r.discount_percent,
          net_due: r.net_due,
          upload_month: month,
          upload_year: year,
          uploaded_by: user.id,
          pay_grp_id: r.pay_grp_id,
          patient_id: resolvedPatientId,
          title: r.title,
          pay_grp_size: toInt(r.pay_grp_size),
          multiple_payments: r.multiple_payments,
          unpaid_payment: r.unpaid_payment,
          late_joiner: r.late_joiner,
          supplementary_insurance: r.supplementary_insurance,
          implant_insurance: r.implant_insurance,
          annual_payer: r.annual_payer,
          explanatory_text: r.explanatory_text,
          mapped_plan_id: mappedPlanId,
          mapped_plan_name: mappedPlanName,
          source_facility_id: r.source_facility_id,
        };
      });

      for (let i = 0; i < dbRows.length; i += BATCH) {
        const batch = dbRows.slice(i, i + BATCH);
        const { error } = await (supabase as any)
          .from('membership_upload_members')
          .insert(batch);
        if (error) throw error;
      }

      // Persist Practice Plan statement headers + Failed Collections /
      // Cancelled Patients event rows. The statement is the practice's only
      // record of DD failures and plan cancellations — previously parsed and
      // thrown away. One summary row per statement (org + month + dentist),
      // replaced wholesale on re-upload (events cascade on delete).
      const ppStatements = ppStatementsRef.current.filter(
        s => s.statementMonth != null && s.statementYear != null,
      );
      for (const stmt of ppStatements) {
        const dentist = stmt.data[0]?.treating_dentist || null;

        let delQ = (supabase as any)
          .from('membership_statement_summaries')
          .delete()
          .eq('organization_id', organizationId)
          .eq('statement_year', stmt.statementYear)
          .eq('statement_month', stmt.statementMonth)
          .eq('source', 'practice-plan');
        delQ = dentist == null ? delQ.is('treating_dentist', null) : delQ.eq('treating_dentist', dentist);
        const { error: delStmtErr } = await delQ;
        if (delStmtErr) throw delStmtErr;

        const findLine = (label: string) =>
          stmt.summaryLines.find(l => l.label.toLowerCase() === label);
        const newLine = findLine('new patient collections');
        const existingLine = findLine('existing patient collections');
        const failedLine = findLine('failed collections');
        const totalLine = findLine('total collected');
        const failedRowsValue =
          Math.round(stmt.failedCollections.reduce((s, r) => s + (r.amount ?? 0), 0) * 100) / 100;

        const { data: insertedStmt, error: insStmtErr } = await (supabase as any)
          .from('membership_statement_summaries')
          .insert({
            organization_id: organizationId,
            upload_location_id: locationId ?? null,
            uploaded_by: user.id,
            source: 'practice-plan',
            treating_dentist: dentist,
            statement_month: stmt.statementMonth,
            statement_year: stmt.statementYear,
            file_name: stmt.fileName,
            new_patient_count: newLine?.count ?? null,
            new_patient_value: newLine?.value ?? null,
            existing_patient_count: existingLine?.count ?? null,
            existing_patient_value: existingLine?.value ?? null,
            total_collected_value: totalLine?.value ?? null,
            // Prefer the statement's own Summary-page numbers; fall back to
            // what we parsed out of the section rows.
            failed_collection_count: failedLine?.count ?? stmt.failedCollections.length,
            failed_collection_value: failedLine?.value ?? failedRowsValue,
            cancelled_patient_count: stmt.cancelledPatients.length,
            plan_breakdown: stmt.planBreakdown,
            summary_lines: stmt.summaryLines,
          })
          .select('id')
          .single();
        if (insStmtErr) throw insStmtErr;

        const codeToDescription = new Map(
          stmt.planBreakdown.map(p => [p.code.toLowerCase(), p.description]),
        );
        const events = [...stmt.failedCollections, ...stmt.cancelledPatients].map(ev => ({
          organization_id: organizationId,
          statement_id: insertedStmt.id,
          event_type: ev.eventType,
          pp_patient_id: ev.ppPatientId,
          surname: ev.surname,
          title: ev.title,
          initial: ev.initial || null,
          dob: ev.dob,
          plan_code: ev.planCode,
          fee_category: ev.planCode
            ? (codeToDescription.get(ev.planCode.toLowerCase()) ?? null)
            : null,
          amount: ev.amount,
          event_date: ev.eventDate,
          raw_line: ev.rawLine,
        }));
        if (events.length > 0) {
          const { error: evErr } = await (supabase as any)
            .from('membership_statement_events')
            .insert(events);
          if (evErr) throw evErr;
        }
      }
      ppStatementsRef.current = [];

      // Practice Plan statements are single-practice documents — the
      // by-location split modal is a Denplan multi-site concept and only
      // confuses the flow there, so the auto-open is skipped for them.
      const isPracticePlan = rows.some(r => r.explanatory_text === 'Practice Plan statement');

      return { inserted: dbRows.length, duplicatesDropped, month, year, isPracticePlan };
    },
    onSuccess: (result) => {
      const dupNote = result.duplicatesDropped > 0
        ? ` (${result.duplicatesDropped} duplicate row${result.duplicatesDropped === 1 ? '' : 's'} skipped)`
        : '';
      toast.success(`Imported ${result.inserted} records for ${MONTH_NAMES[result.month - 1]} ${result.year}${dupNote}`);
      setPreviewRows(null);
      setParseErrors([]);
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
      queryClient.invalidateQueries({ queryKey: ['membership_upload_has_any_v2'] });
      queryClient.invalidateQueries({ queryKey: ['membership_statement_insights'] });
      queryClient.invalidateQueries({ queryKey: ['membership_trends_src'] });
      // Auto-open the location-split modal so the user immediately sees how
      // rows were distributed across locations (and which landed in
      // Unassigned). NOT for Practice Plan statement imports — single-practice
      // documents where the split adds nothing (the "View by Location" button
      // still opens it on demand).
      if (!result.isPracticePlan) {
        setImportSummaryOpen(true);
      }
    },
    onError: (err: Error) => {
      toast.error(`Import failed: ${err.message}`);
    },
  });

  // Manual per-category mapping gating — disabled; plan is auto-resolved
  // from the matched patient's pt_payment_plan_id.
  const unmappedFeeCategories = useMemo(() => [] as string[], []);

  const confirmImport = useCallback(() => {
    if (previewRows && previewRows.length > 0) {
      // Import every row in the sheet, including ones whose patient could not
      // be auto-matched in the DB — we don't want silently-dropped members.
      // Unmatched rows are still inserted; mapped_plan_id/pt_id stay null so
      // the UI can flag them for manual review later.
      const emptyMatch: RowPlanMatch = { pt_id: null, legacy_id: null, plan_id: null, plan_name: null, dob: null, location_id: null };
      const rowMatches = previewRows.map((_, i) => rowPlanMatches[i] ?? emptyMatch);
      confirmMutation.mutate({
        rows: previewRows,
        rowMatches,
        month: importMonth,
        year: importYear,
        locationId: importLocationId,
      });
    }
  }, [previewRows, importMonth, importYear, importLocationId, confirmMutation, rowPlanMatches]);

  // Clear saved data for the selected month/year across ALL locations in
  // the org. Rows are stored per-patient-location now, so a single upload
  // can populate many locations — clearing only the currently filtered
  // location would leave the other imported rows behind.
  const clearMutation = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error('Not authenticated');
      // Clears the month the page is DISPLAYING (which may be the
      // latest-upload fallback, not the header-selected month).
      const { error } = await (supabase as any)
        .from('membership_upload_members')
        .update({ deleted_at: new Date().toISOString() })
        .eq('organization_id', organizationId)
        .eq('upload_month', displayMonth.month)
        .eq('upload_year', displayMonth.year)
        .is('deleted_at', null);
      if (error) throw error;
      // Statement headers (+ their event rows, via the summary's deleted_at)
      // follow the member rows for the cleared month.
      const { error: stmtErr } = await (supabase as any)
        .from('membership_statement_summaries')
        .update({ deleted_at: new Date().toISOString() })
        .eq('organization_id', organizationId)
        .eq('statement_month', displayMonth.month)
        .eq('statement_year', displayMonth.year)
        .is('deleted_at', null);
      if (stmtErr) throw stmtErr;
    },
    onSuccess: () => {
      toast.success(`Data cleared for ${MONTH_NAMES[displayMonth.month - 1]} ${displayMonth.year}`);
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
      queryClient.invalidateQueries({ queryKey: ['membership_upload_has_any_v2'] });
      queryClient.invalidateQueries({ queryKey: ['membership_statement_insights'] });
      queryClient.invalidateQueries({ queryKey: ['membership_trends_src'] });
    },
  });

  // ── Manage uploaded data: what's stored, sliced by month × statement
  // dentist, and targeted removal of one slice (a specific practitioner's
  // statement, or a whole month) without touching anything else — the
  // existing Clear only removes the currently displayed month wholesale.
  const { data: uploadSlices = [], isLoading: isLoadingUploadSlices } = useQuery<UploadSlice[]>({
    queryKey: ['membership_upload_slices', organizationId, selectedLocationId ?? 'all'],
    enabled: !!user?.id && !!organizationId,
    queryFn: async () => {
      const rows: Array<{ upload_month: number; upload_year: number; treating_dentist: string | null; net_due: number | null }> = [];
      let from = 0;
      let hasMore = true;
      while (hasMore) {
        let q = (supabase as any)
          .from('membership_upload_members')
          .select('upload_month, upload_year, treating_dentist, net_due')
          .eq('organization_id', organizationId)
          .is('deleted_at', null)
          .order('id')
          .range(from, from + PAGE_SIZE - 1);
        if (selectedLocationId) {
          // Ownership rule (2026-08-20): the Manage dialog lists only the
          // selected location's uploads.
          q = q.or(`upload_location_id.eq.${selectedLocationId},and(upload_location_id.is.null,location_id.eq.${selectedLocationId})`);
        }
        const { data, error } = await q;
        if (error) throw error;
        rows.push(...(data ?? []));
        hasMore = (data?.length ?? 0) === PAGE_SIZE;
        from += PAGE_SIZE;
      }
      const byKey = new Map<string, UploadSlice>();
      for (const r of rows) {
        const dentist = r.treating_dentist?.trim() || null;
        const key = `${r.upload_year}-${r.upload_month}|${dentist ?? ''}`;
        const cur = byKey.get(key) ?? {
          month: r.upload_month,
          year: r.upload_year,
          treatingDentist: dentist,
          memberCount: 0,
          totalNetDue: 0,
        };
        cur.memberCount += 1;
        cur.totalNetDue += Number(r.net_due) || 0;
        byKey.set(key, cur);
      }
      return Array.from(byKey.values()).sort(
        (a, b) => b.year - a.year || b.month - a.month || (a.treatingDentist ?? '').localeCompare(b.treatingDentist ?? ''),
      );
    },
  });

  const deleteUploadSliceMutation = useMutation({
    mutationFn: async ({ month, year, treatingDentist }: { month: number; year: number; treatingDentist: string | null }) => {
      // Soft-delete, same as Clear — reversible in the DB, invisible to every
      // deleted_at-filtered read. treatingDentist null = the whole month.
      // Scoped to the selected location's OWNED rows when a location is
      // chosen — removing a slice from one location's Manage dialog must
      // never touch another location's uploads.
      let q = (supabase as any)
        .from('membership_upload_members')
        .update({ deleted_at: new Date().toISOString() })
        .eq('organization_id', organizationId)
        .eq('upload_month', month)
        .eq('upload_year', year)
        .is('deleted_at', null);
      if (treatingDentist != null) q = q.eq('treating_dentist', treatingDentist);
      if (selectedLocationId) {
        q = q.or(`upload_location_id.eq.${selectedLocationId},and(upload_location_id.is.null,location_id.eq.${selectedLocationId})`);
      }
      const { error } = await q;
      if (error) throw error;
      // Statement headers (+ their event rows) follow: a dentist-specific
      // removal takes only that dentist's statement summary; a whole-month
      // removal takes every summary for the month.
      let sq = (supabase as any)
        .from('membership_statement_summaries')
        .update({ deleted_at: new Date().toISOString() })
        .eq('organization_id', organizationId)
        .eq('statement_month', month)
        .eq('statement_year', year)
        .is('deleted_at', null);
      if (treatingDentist != null) sq = sq.eq('treating_dentist', treatingDentist);
      if (selectedLocationId) {
        // Summaries have no patient-home fallback — the upload stamp is the
        // only location they carry; unstamped legacy summaries are left
        // alone under a location-scoped removal.
        sq = sq.eq('upload_location_id', selectedLocationId);
      }
      const { error: stmtErr } = await sq;
      if (stmtErr) throw stmtErr;
    },
    onSuccess: (_d, vars) => {
      toast.success(
        vars.treatingDentist
          ? `Removed ${vars.treatingDentist}'s data for ${MONTH_NAMES[vars.month - 1]} ${vars.year}`
          : `Removed all data for ${MONTH_NAMES[vars.month - 1]} ${vars.year}`,
      );
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
      queryClient.invalidateQueries({ queryKey: ['membership_upload_slices'] });
      queryClient.invalidateQueries({ queryKey: ['membership_upload_has_any_v2'] });
      queryClient.invalidateQueries({ queryKey: ['membership_statement_insights'] });
      queryClient.invalidateQueries({ queryKey: ['membership_trends_src'] });
    },
    onError: (e: any) => toast.error(`Couldn't remove data: ${e.message}`),
  });

  return {
    // Saved data
    members,
    planSummary,
    totalRevenue,
    totalMembers,
    isLoading,
    /** True once any month's data exists org-wide; undefined while loading. */
    hasAnyUpload,
    /** Source of the latest uploaded data: 'practice-plan' | 'sheet' | null. */
    uploadSource,
    /** Non-null when loading saved members FAILED — the page shows the message
     *  instead of a misleading "No data uploaded yet" empty state. */
    membersError: (membersError as Error | null) ?? null,
    refetchMembers,

    // Month/Year derived from global date range filter
    selectedMonth,
    selectedYear,
    /** Month-pair cache key for the current header range (debug display). */
    monthYearKey,
    /** The month/year actually being displayed — equals the header selection,
     *  or the latest uploaded month when the selection has no data. */
    displayMonth,
    /** Every month/year pair actually contributing to `members` (header's
     *  full selected range, or the single fallback month) — pass this,
     *  not just `displayMonth`, to statement-scoped consumers so a wide
     *  range sums every statement in range instead of only the last month. */
    effectivePairs,
    isShowingFallbackMonth: !!fallbackMonth,
    /** True when the header-selected location had no rows for the effective
     *  month, so the card is showing the org's saved rows instead. */

    // Preview (before confirm)
    previewRows,
    previewPlanSummary,
    previewTotalRevenue,
    previewTotalMembers,
    parseErrors,
    validSurnames,
    surnamePatientIdMap,
    isValidating,
    handleFileSelect,
    cancelPreview,

    // Import month/year (in preview dialog)
    importMonth,
    importYear,
    setImportMonth,
    setImportYear,
    importLocationId,
    setImportLocationId,

    // Confirm import
    confirmImport,
    isImporting: confirmMutation.isPending,

    // Fee category → plan mapping (preview) — manual UI currently disabled
    availablePlans,
    feeCategoryPlanMap,
    setFeeCategoryPlan,
    unmappedFeeCategories,

    // Auto-resolved per-row patient → plan matches (from surname + DOB)
    rowPlanMatches,

    // Clear
    clearData: clearMutation.mutate,
    isClearing: clearMutation.isPending,

    // Manage uploaded data — per-month × per-dentist slices + targeted removal
    uploadSlices,
    isLoadingUploadSlices,
    deleteUploadSlice: deleteUploadSliceMutation.mutate,
    isDeletingUploadSlice: deleteUploadSliceMutation.isPending,

    // Location-split modal
    membersByLocation,
    /** The modal's own view of the split — scoped to the header-selected
     *  location; equals membersByLocation when no location is selected. */
    membersByLocationForModal,
    /** Rows with no matching Dentally patient — the modal's "Not found in
     *  Dentally" list. */
    unmatchedMembers,
    /** True while the all-locations rows are (re)loading — the modal shows a
     *  spinner instead of a false "No imported members" during the refetch
     *  that immediately follows an import. */
    isLocationSplitFetching,
    isImportSummaryOpen,
    openImportSummary: () => setImportSummaryOpen(true),
    closeImportSummary: () => setImportSummaryOpen(false),
    practiceLocations,

    // Denplan facility mappings — org-scoped catalog + per-batch detection.
    denplanFacilityMappings,
    detectedFacilities,
    upsertFacilityMapping: facilityMappingMutation.mutate,
    deleteFacilityMapping: deleteFacilityMappingMutation.mutate,
    isSavingFacilityMapping: facilityMappingMutation.isPending,
    /** Full active-plan list (unfiltered) — used by the facility mapping dropdown. */
    allActivePlans,
  };
}
