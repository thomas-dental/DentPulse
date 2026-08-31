import { useQuery } from '@tanstack/react-query';
import { useOrganization } from '@/hooks/useOrganization';
import { fetchGoalSettingsApi } from '@/services/integrations/patientEconomicsService';
import type { PeGoalSettingsSummary } from '@/types/peGoalSettings';

export function useGoalSettings() {
  const { organizationId } = useOrganization();

  return useQuery({
    queryKey: ['pe-goal-settings', organizationId],
    enabled: !!organizationId,
    queryFn: async (): Promise<PeGoalSettingsSummary> => {
      const body = await fetchGoalSettingsApi(organizationId!);
      return {
        contextPracticeId: String(body.contextPracticeId),
        commitmentWindowDays: Number(body.commitmentWindowDays) || 30,
        quarterStart: String(body.quarterStart || ''),
        defaults: body.defaults,
        contextMetrics: body.contextMetrics,
        practices: body.practices ?? [],
        hasData: body.hasData === true,
      };
    },
  });
}
