import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useLocations } from './useLocations';

export interface PractitionerChairMetric {
  practitioner_name: string;
  // total_* = NON-cancelled / NON-DNA (feeds the Overview "Total Chairs"
  // hrs/appts — reconciles with Dentally). booked_appointments = EVERY
  // booked appointment incl. cancelled & DNA (the By-Chair table's
  // completed/total denominator). The two are intentionally separate.
  total_appointments: number;
  booked_appointments: number;
  completed_appointments: number;
  total_hours: number;
  completed_hours: number;
  // Added: state counts respect the same date range / location filter.
  dna_appointments: number;
  cancelled_appointments: number;
  // Added: per-practitioner revenue (same definition as the Location
  // History / Providers pages) and revenue per chair.
  revenue: number;
  revenue_per_chair: number;
}

interface UsePractitionerChairMetricsOptions {
  startDate: Date;
  endDate: Date;
  locationId: string | null;
}

function toDateStr(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function asNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : value == null ? NaN : Number(value);
  return Number.isFinite(n) ? n : 0;
}

// The exact UTC instant (ISO string) of 00:00 Europe/London on the given YYYY-MM-DD
// calendar date — independent of the browser's own timezone. In BST this is 23:00Z the
// previous day; in GMT it is 00:00Z the same day. Used so date-range filters on
// timestamptz columns line up with London practice days regardless of where the app runs.
function londonMidnightInstant(dateStr: string): string {
  // London's hour at 12:00 UTC that day is 13 in BST, 12 in GMT → the UTC offset.
  const noonUtc = new Date(`${dateStr}T12:00:00Z`);
  const londonHour = Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hour12: false })
      .formatToParts(noonUtc)
      .find((p) => p.type === 'hour')?.value ?? '12',
  );
  const offsetHours = londonHour - 12; // 1 in BST, 0 in GMT
  const utc = new Date(`${dateStr}T00:00:00Z`);
  utc.setUTCHours(utc.getUTCHours() - offsetHours);
  return utc.toISOString();
}

// Charting nomenclatures are tooth-status records, not chair-time / revenue
// procedures. Copied verbatim from useLocationHistory so per-practitioner
// revenue reconciles £-for-£ with the Location History / Providers pages.
const CHARTING_NOMENCLATURES = new Set([
  'missing', 'missing tooth', 'caries', 'decay',
  'unerupted', 'partially erupted', 'root retained',
  'implant', 'implant present',
  'crown present', 'veneer present', 'bridge pontic',
  'bridge retainer', 'bridge unit',
  'denture tooth', 'denture saddle',
  'watch', 'monitor',
]);

function isChartingNomenclature(nomenclature: string | null): boolean {
  if (!nomenclature) return false;
  return CHARTING_NOMENCLATURES.has(nomenclature.toLowerCase().trim());
}

export function usePractitionerChairMetrics({ startDate, endDate, locationId }: UsePractitionerChairMetricsOptions) {
  const { user } = useAuth();
  const { organizationId } = useLocations();

  return useQuery({
    queryKey: [
      'practitioner_chair_metrics',
      organizationId,
      locationId,
      toDateStr(startDate),
      toDateStr(endDate),
    ],
    queryFn: async () => {
      if (!organizationId) return [];

      // Active provider external_ids — filter out inactive practitioners.
      const { data: activeProviders } = await supabase
        .from('providers')
        .select('external_id')
        .eq('organization_id', organizationId)
        .eq('is_active', true)
        .not('external_id', 'is', null);

      const activeExternalIds = new Set(
        (activeProviders || []).map((p: any) => String(p.external_id))
      );

      // Chair count for the selected scope (location or whole org) — same
      // source get_chair_metrics uses (chair_settings → practice_locations).
      let chairQuery = supabase
        .from('practice_locations')
        .select('id, chairs_count, chair_settings(number_of_chairs)')
        .eq('organization_id', organizationId)
        .is('deleted_at', null)
        .eq('is_active', true);
      if (locationId) chairQuery = chairQuery.eq('id', locationId);
      const { data: locRows } = await chairQuery;
      const totalChairs = (locRows || []).reduce((sum: number, l: any) => {
        const cs = Array.isArray(l.chair_settings) ? l.chair_settings[0] : l.chair_settings;
        return sum + (Number(cs?.number_of_chairs) || Number(l.chairs_count) || 0);
      }, 0);

      const startStr = toDateStr(startDate);
      const endNextStr = toDateStr(new Date(endDate.getTime() + 86400000));

      // Treat the selected dates as EUROPE/LONDON practice calendar days and convert
      // to the exact UTC instant of London midnight (23:00Z prev day in BST, 00:00Z in
      // GMT). The old code used `new Date('YYYY-MM-DDT00:00:00')`, which parses in the
      // BROWSER's local timezone — correct only for a London-based browser and wrong
      // elsewhere. This is timezone-independent.
      const startInstant = londonMidnightInstant(startStr);
      const endExclusiveInstant = londonMidnightInstant(endNextStr);

      // ── Appointments (all states, so DNA/Cancelled can be counted) ──
      const PAGE_SIZE = 1000;
      const apptRows: Array<{
        apmt_id: number | null;
        apmt_practitioner_name: string | null;
        apmt_practitioner_id: number | null;
        apmt_state: string | null;
        apmt_duration: number | null;
      }> = [];
      // STABLE ORDER for .range() pagination. The previous code had NO ORDER BY, so
      // Postgres could return rows in a different order between page requests — and
      // while a Dentally sync was writing, the big multi-page "All" fetch then silently
      // SKIPPED rows, making "All" read LOWER than the sum of the per-location views
      // (fewer pages, rarely hit). Order by the INDEXED apmt_start_time (fast — reuses
      // the date-range index) with id as a unique tie-breaker for full determinism.
      // NB: do NOT order by id alone — that ignores the date index and statement-times-
      // out on wide ranges (57014).
      let from = 0;
      while (true) {
        let query = supabase
          .from('appointments')
          .select('apmt_id, apmt_practitioner_name, apmt_practitioner_id, apmt_state, apmt_duration')
          .eq('organization_id', organizationId)
          .gte('apmt_start_time', startInstant)
          .lt('apmt_start_time', endExclusiveInstant)
          .is('deleted_at', null)
          .not('apmt_patient_id', 'is', null)
          .not('apmt_practitioner_name', 'is', null)
          .order('apmt_start_time', { ascending: true })
          .order('id', { ascending: true })
          .range(from, from + PAGE_SIZE - 1);

        if (locationId) query = query.eq('location_id', locationId);

        const { data: page, error } = await query;
        if (error) {
          console.error('[usePractitionerChairMetrics] appointments error:', error);
          throw error;
        }
        if (!page || page.length === 0) break;
        apptRows.push(...(page as any));
        if (page.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }

      const map = new Map<string, PractitionerChairMetric>();
      // ext practitioner id → display name, so TPI revenue (keyed by
      // tpi_practitioner_id) attaches to the same row the table shows.
      const extIdToName = new Map<string, string>();

      const getEntry = (name: string) => {
        let e = map.get(name);
        if (!e) {
          e = {
            practitioner_name: name,
            total_appointments: 0, booked_appointments: 0, completed_appointments: 0,
            total_hours: 0, completed_hours: 0,
            dna_appointments: 0, cancelled_appointments: 0,
            revenue: 0, revenue_per_chair: 0,
          };
          map.set(name, e);
        }
        return e;
      };

      // De-duplicate by the stable Dentally appointment id — re-synced
      // appointments can land under a new row id but keep the same apmt_id;
      // counting both inflates totals vs Dentally (mirrors the tpi_dedup
      // pattern used elsewhere for re-synced Dentally records).
      const seenApmtIds = new Set<number>();

      for (const row of apptRows) {
        if (row.apmt_id != null) {
          if (seenApmtIds.has(row.apmt_id)) continue;
          seenApmtIds.add(row.apmt_id);
        }
        if (row.apmt_practitioner_id && !activeExternalIds.has(String(row.apmt_practitioner_id))) {
          continue;
        }
        const name = (row.apmt_practitioner_name || 'Unknown').trim();
        if (row.apmt_practitioner_id != null) {
          extIdToName.set(String(row.apmt_practitioner_id), name);
        }
        const entry = getEntry(name);
        const state = (row.apmt_state || '').toLowerCase();
        const dur = (row.apmt_duration || 0) / 60;

        // EVERY booked appointment (all states) — the By-Chair table's
        // completed/total denominator.
        entry.booked_appointments++;

        // total_appointments / total_hours count NON-cancelled / NON-DNA only
        // (original behaviour) — this feeds the Overview "Total Chairs" card's
        // "hrs / appts". DNA & Cancelled are tracked separately for the By
        // Chair table's own columns; they must NOT inflate the totals.
        if (state === 'cancelled') {
          entry.cancelled_appointments++;
        } else if (state === 'did not attend' || state === 'dna') {
          entry.dna_appointments++;
        } else {
          entry.total_appointments++;
          entry.total_hours += dur;
          if (state === 'completed') {
            entry.completed_appointments++;
            entry.completed_hours += dur;
          }
        }
      }

      // ── Per-practitioner revenue (identical TPI filters to
      // useLocationHistory: completed, payment-plan, in range, charting
      // excluded) so it reconciles with the Location History page. ──
      const tpiRows: Array<{
        tpi_practitioner_id: number | null;
        tpi_price: number | null;
        tpi_patient_nomenclature: string | null;
      }> = [];
      // Stable order for .range() pagination (see the appointments query above) — by
      // the INDEXED tpi_completed_at with id as tie-breaker; avoids skipped rows during
      // a concurrent sync without the id-only-order timeout.
      let tfrom = 0;
      while (true) {
        let tq = supabase
          .from('treatment_plan_items')
          .select('tpi_practitioner_id, tpi_price, tpi_patient_nomenclature')
          .eq('organization_id', organizationId)
          .eq('tpi_completed', true)
          .not('tpi_completed_at', 'is', null)
          .not('tpi_payment_plan_id', 'is', null)
          .gte('tpi_completed_at', startInstant)
          .lt('tpi_completed_at', endExclusiveInstant)
          .is('deleted_at', null)
          .order('tpi_completed_at', { ascending: true })
          .order('id', { ascending: true })
          .range(tfrom, tfrom + PAGE_SIZE - 1);

        if (locationId) tq = tq.eq('location_id', locationId);

        const { data: tpage, error: terr } = await tq;
        if (terr) {
          console.error('[usePractitionerChairMetrics] tpi error:', terr);
          throw terr;
        }
        if (!tpage || tpage.length === 0) break;
        tpiRows.push(...(tpage as any));
        if (tpage.length < PAGE_SIZE) break;
        tfrom += PAGE_SIZE;
      }

      for (const t of tpiRows) {
        if (isChartingNomenclature(t.tpi_patient_nomenclature)) continue;
        if (t.tpi_practitioner_id == null) continue;
        const extKey = String(t.tpi_practitioner_id);
        if (!activeExternalIds.has(extKey)) continue;
        const name = extIdToName.get(extKey);
        if (!name) continue; // practitioner not in this scope's appointment set
        getEntry(name).revenue += asNumber(t.tpi_price);
      }

      for (const e of map.values()) {
        e.revenue_per_chair = totalChairs > 0 ? e.revenue / totalChairs : 0;
      }

      const result = Array.from(map.values()).sort((a, b) => a.practitioner_name.localeCompare(b.practitioner_name));
      console.log('[usePractitionerChairMetrics] returned:', result.length, 'practitioners; chairs:', totalChairs);
      return result;
    },
    enabled: !!user?.id && !!organizationId,
  });
}
