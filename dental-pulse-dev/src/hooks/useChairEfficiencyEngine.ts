import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useFilters } from '@/contexts/FilterContext';
import { useOrganization } from '@/hooks/useOrganization';
import { useTreatments } from '@/hooks/useTreatments';
import { useTreatmentInsights } from '@/hooks/useTreatmentInsights';

export interface ChairEfficiencyRow {
  itemDate: string;        // YYYY-MM-DD ('' for treatments with no activity)
  treatmentId: string | null;
  treatmentName: string;
  avgTimeMins: number;     // average treatment duration (mins) — appointment start→finish window
  units: number;           // number of treatments delivered
  totalTimeMins: number;   // sum of durations
  chairHrs: number;        // totalTimeMins / 60
  totalIncome: number;
}

/**
 * Resolve each treatment's "time to complete" from the actual appointment
 * window (apmt_start_time → apmt_finish_time), NOT the TPI/template duration.
 *
 * The chain is: treatment_plan_items.tpi_treatment_appointment_id (= ta_id)
 *   → treatment_appointments.ta_appointment_id (= apmt_id)
 *   → appointments.apmt_start_time / apmt_finish_time.
 * Returns a Map keyed by ta_id → appointment duration in minutes.
 *
 * Note: a single appointment can contain several treatments — each treatment
 * occurrence is credited the full visit window (no splitting), so summed time
 * across treatments sharing one visit exceeds the wall-clock visit length.
 */
export async function fetchApptDurationByTa(
  taIds: number[],
  organizationId: string,
): Promise<Map<number, number>> {
  const info = await fetchApptInfoByTa(taIds, organizationId);
  return new Map([...info].map(([taId, i]) => [taId, i.minutes]));
}

/**
 * Same chain as fetchApptDurationByTa, but keeps the physical appointment id
 * alongside the window minutes — for callers that must count each visit's
 * chair window ONCE (several TPI rows can share a ta_id, and several ta_ids
 * can share an apmt_id; deduping needs the apmt_id, which the minutes-only
 * map cannot express).
 */
export async function fetchApptInfoByTa(
  taIds: number[],
  organizationId: string,
): Promise<Map<number, { apmtId: number; minutes: number }>> {
  const out = new Map<number, { apmtId: number; minutes: number }>();
  if (taIds.length === 0) return out;

  // ta_id → ta_appointment_id (apmt_id)
  const taToAppt = new Map<number, number>();
  for (let i = 0; i < taIds.length; i += 300) {
    const slice = taIds.slice(i, i + 300);
    const { data, error } = await (supabase as any)
      .from('treatment_appointments')
      .select('ta_id, ta_appointment_id')
      .eq('organization_id', organizationId)
      .in('ta_id', slice);
    if (error) { console.error('[ChairEfficiency] treatment_appointments error:', error); continue; }
    for (const r of (data ?? [])) {
      if (r.ta_id != null && r.ta_appointment_id != null) {
        taToAppt.set(Number(r.ta_id), Number(r.ta_appointment_id));
      }
    }
  }

  // apmt_id → duration (minutes) from the start→finish window
  const apptIds = [...new Set([...taToAppt.values()])];
  const apptDuration = new Map<number, number>();
  for (let i = 0; i < apptIds.length; i += 300) {
    const slice = apptIds.slice(i, i + 300);
    const { data, error } = await (supabase as any)
      .from('appointments')
      .select('apmt_id, apmt_start_time, apmt_finish_time, apmt_duration')
      .eq('organization_id', organizationId)
      .in('apmt_id', slice);
    if (error) { console.error('[ChairEfficiency] appointments error:', error); continue; }
    for (const a of (data ?? [])) {
      if (a.apmt_id == null) continue;
      let mins = 0;
      if (a.apmt_start_time && a.apmt_finish_time) {
        const ms = new Date(a.apmt_finish_time).getTime() - new Date(a.apmt_start_time).getTime();
        if (Number.isFinite(ms) && ms > 0) mins = Math.round(ms / 60000);
      }
      // Fall back to the stored duration when start/finish are missing.
      if (mins === 0 && a.apmt_duration != null) mins = Number(a.apmt_duration) || 0;
      apptDuration.set(Number(a.apmt_id), mins);
    }
  }

  for (const [taId, apmtId] of taToAppt) {
    const mins = apptDuration.get(apmtId);
    if (mins != null) out.set(taId, { apmtId, minutes: mins });
  }
  return out;
}

/**
 * Chair Efficiency Engine rows.
 *
 * Data source is Treatment Insights' qualified items (the SAME completed-TPI
 * pipeline the Treatment Insights page uses: tpi_completed + payment-plan +
 * real-procedure appointment gate, location-attributed via practitioner primary
 * location + patient exclusion). We group those items by (completed date,
 * treatment) so:
 *   - Σ units   == Treatment Insights "Treatment Volume"
 *   - Σ income  == Treatment Insights "Total Revenue"
 * i.e. the table reconciles £-for-£ and unit-for-unit with Treatment Insights
 * for the same period / location, rather than re-deriving from raw invoices.
 *
 * Every treatment in the location's catalogue is still listed: ones with no
 * activity in the period appear as zero rows (their configured duration shown,
 * 0 units / time / income).
 */
export function useChairEfficiencyEngine() {
  const { selectedLocationId } = useFilters();
  const { organizationId } = useOrganization();
  const { currentItems = [], isLoading: insightsLoading } = useTreatmentInsights();

  // Full treatment catalogue for the selected location (locations sharing a
  // Dentally integration share the catalogue), used to list every treatment.
  const { treatments, isLoading: treatmentsLoading } = useTreatments({ locationId: selectedLocationId });

  // Distinct treatment-appointment ids across the qualified items — used to
  // resolve each treatment's actual appointment window (start→finish).
  const taIds = useMemo(() => {
    const s = new Set<number>();
    for (const it of currentItems) {
      if (it.treatmentAppointmentId > 0) s.add(it.treatmentAppointmentId);
    }
    return [...s].sort((a, b) => a - b);
  }, [currentItems]);

  const { data: apptDurByTa, isLoading: apptLoading } = useQuery({
    queryKey: ['chair-efficiency-appt-durations', organizationId, taIds],
    queryFn: () => fetchApptDurationByTa(taIds, organizationId!),
    enabled: !!organizationId && taIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  const rows = useMemo<ChairEfficiencyRow[]>(() => {
    // Group by (completed date, treatment). Mirror the Treatment Insights
    // summary gate exactly — real procedures only (treatmentAppointmentId > 0),
    // all prices included (refunds/credits count, like the TI Total Revenue).
    const grouped = new Map<string, {
      itemDate: string;
      treatmentId: string | null;
      treatmentName: string;
      units: number;
      totalIncome: number;
      totalDuration: number;
    }>();

    for (const it of currentItems) {
      if (it.treatmentAppointmentId <= 0) continue;
      const date = (it.completedAt || '').substring(0, 10);
      const tid = it.treatmentId || '';
      const key = `${date}__${tid || it.treatmentName}`;
      let g = grouped.get(key);
      if (!g) {
        g = {
          itemDate: date,
          treatmentId: it.treatmentId || null,
          treatmentName: it.treatmentName,
          units: 0,
          totalIncome: 0,
          totalDuration: 0,
        };
        grouped.set(key, g);
      }
      g.units += 1;
      g.totalIncome += it.price;
      // Time to complete = ONLY the appointment's start→finish window for this
      // treatment occurrence. Never the TPI/template duration or the completion
      // time — if the appointment can't be resolved, this occurrence adds 0
      // rather than substituting a non-appointment time source.
      g.totalDuration += apptDurByTa?.get(it.treatmentAppointmentId) ?? 0;
    }

    const dataRows: ChairEfficiencyRow[] = Array.from(grouped.values())
      .map((g) => ({
        itemDate: g.itemDate,
        treatmentId: g.treatmentId,
        treatmentName: g.treatmentName,
        avgTimeMins: g.units > 0 ? g.totalDuration / g.units : 0,
        units: g.units,
        totalTimeMins: g.totalDuration,
        chairHrs: g.totalDuration / 60,
        totalIncome: g.totalIncome,
      }))
      .sort(
        (a, b) =>
          b.itemDate.localeCompare(a.itemDate) ||
          a.treatmentName.localeCompare(b.treatmentName),
      );

    // Zero rows: every catalogue treatment with no activity this period.
    const presentTreatmentIds = new Set(
      dataRows.map((r) => r.treatmentId).filter((id): id is string => !!id),
    );
    // No activity → no appointment, so Avg Time is 0 (NOT the configured
    // template duration). The column reflects measured appointment time only.
    const zeroRows: ChairEfficiencyRow[] = treatments
      .filter((t) => !presentTreatmentIds.has(t.id))
      .map((t) => ({
        itemDate: '',
        treatmentId: t.id,
        treatmentName: t.treatment_name,
        avgTimeMins: 0,
        units: 0,
        totalTimeMins: 0,
        chairHrs: 0,
        totalIncome: 0,
      }));

    return [...dataRows, ...zeroRows];
  }, [currentItems, treatments, apptDurByTa]);

  const totals = useMemo(() => {
    const acc = rows.reduce(
      (a, r) => {
        a.units += r.units;
        a.totalTimeMins += r.totalTimeMins;
        a.chairHrs += r.chairHrs;
        a.totalIncome += r.totalIncome;
        return a;
      },
      { units: 0, totalTimeMins: 0, chairHrs: 0, totalIncome: 0 },
    );
    // Avg across ALL delivered units (Σ time ÷ Σ units) — a true weighted
    // average, NOT the sum of per-row averages (which was meaningless).
    return { ...acc, avgTimeMins: acc.units > 0 ? acc.totalTimeMins / acc.units : 0 };
  }, [rows]);

  return {
    rows,
    totals,
    isLoading: insightsLoading || treatmentsLoading || apptLoading,
    isError: false,
    error: null as Error | null,
  };
}
