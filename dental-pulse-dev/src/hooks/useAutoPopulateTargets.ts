import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import { useOrganization } from './useOrganization';
import { autoPopulateTargets } from '@/services/treatmentGoalTargetsService';
import { toast } from 'sonner';

interface UseAutoPopulateTargetsOptions {
  period: Date;
  periodType: 'month' | 'year';
  locationId?: string | null;
  regionId?: string | null;
  numberOfPeriods?: number;
}

/**
 * Hook to auto-populate treatment goal targets based on historical data
 */
export function useAutoPopulateTargets(options: UseAutoPopulateTargetsOptions) {
  const { user } = useAuth();
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();
  const { period, periodType, locationId, regionId, numberOfPeriods = 3 } = options;

  const autoPopulateMutation = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error('No organization selected');
      if (!user?.id) throw new Error('Not authenticated');

      return await autoPopulateTargets(
        organizationId,
        periodType,
        period,
        locationId,
        regionId,
        numberOfPeriods,
        user.id
      );
    },
    onSuccess: (result) => {
      // Invalidate targets query to refresh the data
      queryClient.invalidateQueries({ 
        queryKey: ['treatment_goal_targets', organizationId] 
      });
      
      toast.success(
        `Auto-populated targets: ${result.created} created, ${result.updated} updated`
      );
    },
    onError: (error: Error) => {
      toast.error(`Failed to auto-populate targets: ${error.message}`);
    },
  });

  return {
    autoPopulate: autoPopulateMutation.mutateAsync,
    isAutoPopulating: autoPopulateMutation.isPending,
  };
}
