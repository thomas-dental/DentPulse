import { useQuery } from '@tanstack/react-query';
import { useOrganization } from '@/hooks/useOrganization';
import { fetchGoalSettingsApi } from '@/services/integrations/patientEconomicsService';
import type { PeGoalSettingsSummary } from '@/types/peGoalSettings';
import { PE_READ_STALE_MS } from '@/lib/peReadStaleTime';

export function useGoalSettings() {
  const { organizationId } = useOrganization();

  return useQuery({
    queryKey: ['pe-goal-settings', organizationId],
    enabled: !!organizationId,
    staleTime: PE_READ_STALE_MS,
    queryFn: async (): Promise<PeGoalSettingsSummary> => {
      const body = await fetchGoalSettingsApi(organizationId!);
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
