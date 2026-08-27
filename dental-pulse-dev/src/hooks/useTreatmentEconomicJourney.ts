import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';

/** Funnel stages mapped 1:1 to ledger event_types (pure GROUP BY contract). */
export const JOURNEY_STAGES = [
  { key: 'planned', label: 'Planned', eventType: 'PLAN_CREATED' },
  { key: 'scheduled', label: 'Scheduled', eventType: 'APPOINTMENT_LINKED' },
  { key: 'started', label: 'Started', eventType: 'TREATMENT_STARTED' },
  { key: 'completed', label: 'Completed', eventType: 'PLAN_COMPLETED' },
  { key: 'charged', label: 'Charged', eventType: 'INVOICE_RAISED' },
  { key: 'collected', label: 'Collected', eventType: 'PAYMENT_ALLOCATED' },
] as const;

export type JourneyStageKey = (typeof JOURNEY_STAGES)[number]['key'];
export type JourneyEventType = (typeof JOURNEY_STAGES)[number]['eventType'];

export type JourneyStage = {
  key: JourneyStageKey;
  label: string;
  eventType: JourneyEventType;
  eventCount: number;
  /** Sum of payload monetary fields — matches manual event_ledger GROUP BY. */
  valueGbp: number;
};

export type TreatmentEconomicJourney = {
  stages: JourneyStage[];
  totalEvents: number;
  plannedEventCount: number;
  /** Too little history to chart meaningfully (just connected / early sync). */
  isBackfilling: boolean;
};

const FUNNEL_EVENT_TYPES: JourneyEventType[] = JOURNEY_STAGES.map((s) => s.eventType);

/** Minimum history before we show the waterfall (not fake zeros for a new connect). */
const MIN_PLANNED_EVENTS = 5;
const MIN_TOTAL_FUNNEL_EVENTS = 10;

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Same COALESCE / NULLIF('',) order as the verification SQL. */
export function payloadGbp(payload: unknown): number {
  if (!payload || typeof payload !== 'object') return 0;
  const p = payload as Record<string, unknown>;
  for (const key of [
    'planned_value',
    'tp_private_treatment_value',
    'value',
    'amount',
    'total',
  ] as const) {
    const raw = p[key];
    if (raw == null || raw === '') continue;
    const n = num(raw);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

async function fetchTreatmentEconomicJourney(
  practiceId: string,
): Promise<TreatmentEconomicJourney> {
  const byType = new Map<string, { eventCount: number; valueGbp: number }>();
  for (const t of FUNNEL_EVENT_TYPES) {
    byType.set(t, { eventCount: 0, valueGbp: 0 });
  }

  const pageSize = 1000;
  let offset = 0;

  for (let i = 0; i < 500; i++) {
    const { data, error } = await (supabase as any)
      .from('event_ledger')
      .select('event_type, payload')
      .eq('practice_id', practiceId)
      .in('event_type', FUNNEL_EVENT_TYPES)
      .range(offset, offset + pageSize - 1);

    if (error) throw error;
    const rows = (data ?? []) as Array<{ event_type: string; payload: unknown }>;
    if (rows.length === 0) break;

    for (const row of rows) {
      const bucket = byType.get(row.event_type);
      if (!bucket) continue;
      bucket.eventCount += 1;
      bucket.valueGbp += payloadGbp(row.payload);
    }

    if (rows.length < pageSize) break;
    offset += pageSize;
  }

  const stages: JourneyStage[] = JOURNEY_STAGES.map((s) => {
    const bucket = byType.get(s.eventType)!;
    return {
      key: s.key,
      label: s.label,
      eventType: s.eventType,
      eventCount: bucket.eventCount,
      valueGbp: Math.round(bucket.valueGbp * 100) / 100,
    };
  });

  const totalEvents = stages.reduce((sum, s) => sum + s.eventCount, 0);
  const plannedEventCount = stages.find((s) => s.key === 'planned')?.eventCount ?? 0;
  const isBackfilling =
    plannedEventCount < MIN_PLANNED_EVENTS || totalEvents < MIN_TOTAL_FUNNEL_EVENTS;

  return { stages, totalEvents, plannedEventCount, isBackfilling };
}

export function useTreatmentEconomicJourney() {
  const { organizationId } = useOrganization();

  return useQuery({
    queryKey: ['event_ledger', 'treatment-economic-journey', organizationId],
    enabled: !!organizationId,
    queryFn: () => fetchTreatmentEconomicJourney(organizationId!),
  });
}
