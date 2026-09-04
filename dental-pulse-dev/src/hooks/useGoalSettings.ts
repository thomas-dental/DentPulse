import { useQuery } from '@tanstack/react-query';
import { fetchGoalSettingsApi } from '@/services/integrations/patientEconomicsService';
import { usePeScopedRead } from '@/hooks/usePeScopedRead';
import type { PeGoalSettingsSummary } from '@/types/peGoalSettings';
import { PE_READ_STALE_MS } from '@/lib/peReadStaleTime';

export function useGoalSettings(options?: { enabled?: boolean }) {
  const { organizationId, scopeKey, apiScope, enabled: scopeEnabled } = usePeScopedRead();

  return useQuery({
    queryKey: ['pe-goal-settings', organizationId, scopeKey],
    enabled: scopeEnabled && (options?.enabled ?? true),
    staleTime: PE_READ_STALE_MS,
    queryFn: async (): Promise<PeGoalSettingsSummary> => {
      const body = await fetchGoalSettingsApi(organizationId!, apiScope);
      return {
        contextPracticeId: String(body.contextPracticeId),
        rollupMode: body.rollupMode === 'location' ? 'location' : 'practice',
        commitmentWindowDays: Number(body.commitmentWindowDays) || 30,
        quarterStart: String(body.quarterStart || ''),
        defaults: body.defaults,
        contextMetrics: body.contextMetrics,
        practices: (body.practices ?? []).map((row: Record<string, unknown>) => ({
          ...row,
          practiceId: String(row.practiceId),
          practiceName: String(row.practiceName || 'Practice'),
          unitType: row.unitType === 'location' ? 'location' : 'practice',
          organizationId:
            row.organizationId != null ? String(row.organizationId) : String(row.practiceId),
        })),
        hasData: body.hasData === true,
      };
    },
  });
}
