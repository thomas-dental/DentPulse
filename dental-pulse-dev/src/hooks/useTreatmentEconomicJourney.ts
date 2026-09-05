import { useQuery } from '@tanstack/react-query';
import {
  fetchTreatmentEconomicJourney,
  type JourneyEventType,
  type JourneyStageKey,
  type TreatmentEconomicJourneyResponse,
  type TreatmentEconomicJourneyStage,
} from '@/services/integrations/patientEconomicsService';
import { PE_READ_STALE_MS } from '@/lib/peReadStaleTime';
import { usePeScopedRead } from '@/hooks/usePeScopedRead';

/** Funnel stages mapped 1:1 to ledger event_types (display contract). */
export const JOURNEY_STAGES = [
  { key: 'planned' as const, label: 'Planned', eventType: 'PLAN_CREATED' as const },
  { key: 'scheduled' as const, label: 'Scheduled', eventType: 'APPOINTMENT_LINKED' as const },
  { key: 'started' as const, label: 'Started', eventType: 'TREATMENT_STARTED' as const },
  { key: 'completed' as const, label: 'Completed', eventType: 'PLAN_COMPLETED' as const },
  { key: 'charged' as const, label: 'Charged', eventType: 'INVOICE_RAISED' as const },
  { key: 'collected' as const, label: 'Collected', eventType: 'PAYMENT_ALLOCATED' as const },
];

export type { JourneyStageKey, JourneyEventType };
export type JourneyStage = TreatmentEconomicJourneyStage;
export type TreatmentEconomicJourney = TreatmentEconomicJourneyResponse;

export function useTreatmentEconomicJourney(options?: { enabled?: boolean }) {
  const { organizationId, scopeKey, apiScope, enabled: scopeEnabled } = usePeScopedRead();

  return useQuery({
    queryKey: ['treatment-economic-journey', 'api', organizationId, scopeKey],
    enabled: scopeEnabled && (options?.enabled ?? true),
    staleTime: PE_READ_STALE_MS,
    queryFn: () => fetchTreatmentEconomicJourney(organizationId!, apiScope),
  });
}
