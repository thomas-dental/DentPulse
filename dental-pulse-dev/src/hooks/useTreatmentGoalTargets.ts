import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useOrganization } from './useOrganization';
// Removed unused imports - period_date is now stored as 'M-YYYY' or 'YYYY' string
import { toast } from 'sonner';

export interface TreatmentGoalTarget {
  id: string;
  organization_id: string;
  location_id: string | null;
  region_id: string | null;
  category_name: string;
  period_type: 'month' | 'quarter' | 'year';
  period_date: string; // 'M-YYYY' format for months (e.g., '1-2026') or 'YYYY' for years
  unit_target: number;
  avg_amount_target: number;
  created_at: string;
  updated_at: string;
}

interface UseTreatmentGoalTargetsOptions {
  period: Date;
  periodType: 'month' | 'quarter' | 'year';
  locationId?: string | null;
  regionId?: string | null;
}

/**
 * Hook to load and save treatment goal targets
 */
export function useTreatmentGoalTargets(options: UseTreatmentGoalTargetsOptions) {
  const { user } = useAuth();
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();
  const { period, periodType, locationId, regionId } = options;

  // Calculate period identifier:
  //   month: 'M-YYYY' (e.g., '1-2026')
  //   quarter: 'QN-YYYY' (e.g., 'Q1-2025')
  //   year: 'YYYY' (e.g., '2026')
  const periodDateStr = period && period instanceof Date
    ? (periodType === 'month'
      ? `${period.getMonth() + 1}-${period.getFullYear()}`
      : periodType === 'quarter'
      ? `Q${Math.floor(period.getMonth() / 3) + 1}-${period.getFullYear()}`
      : `${period.getFullYear()}`)
    : '';

  // Fetch targets for the planning period
  const { data: targets = [], isLoading } = useQuery({
    queryKey: ['treatment_goal_targets', organizationId, periodDateStr, periodType, locationId, regionId],
    queryFn: async () => {
      if (!organizationId) {
        return [] as TreatmentGoalTarget[];
      }

      let query = (supabase as any)
        .from('treatment_goal_targets')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('period_type', periodType)
        .eq('period_date', periodDateStr);

      if (locationId) {
        query = query.eq('location_id', locationId);
      } else {
        query = query.is('location_id', null);
      }

      if (regionId) {
        query = query.eq('region_id', regionId);
      } else {
        query = query.is('region_id', null);
      }

      const { data, error } = await query.order('category_name', { ascending: true });

      if (error) {
        console.error('Error fetching treatment goal targets:', error);
        throw error;
      }

      return (data || []) as TreatmentGoalTarget[];
    },
    enabled: !!organizationId && !!period && period instanceof Date,
  });

  // Convert targets array to map for easy lookup (memoized to prevent re-render loops)
  const targetsMap = useMemo(() => {
    const map = new Map<string, { unitTarget: number; avgAmountTarget: number }>();
    targets.forEach((target) => {
      map.set(target.category_name, {
        unitTarget: target.unit_target,
        avgAmountTarget: target.avg_amount_target,
      });
    });
    return map;
  }, [targets]);

  // Save targets mutation
  // IMPORTANT: This saves targets for the PLANNING PERIOD (not actual period)
  // The period_date is calculated from the 'period' parameter which should be planningPeriod
  const saveTargetsMutation = useMutation({
    mutationFn: async (targetsToSave: Record<string, { unitTarget: number; avgAmountTarget: number }>) => {
      if (!organizationId) throw new Error('No organization selected');
      if (!user?.id) throw new Error('Not authenticated');

      // Verify we're saving for the correct period (planning period)
      if (!period || !(period instanceof Date)) {
        throw new Error('Period must be a valid date');
      }
      
      console.log('[useTreatmentGoalTargets] Saving targets for period:', {
        periodDate: periodDateStr,
        periodType,
        period: period.toISOString(),
      });

      const categoryNames = Object.keys(targetsToSave);
      const upserts = categoryNames.map((categoryName) => {
        const target = targetsToSave[categoryName];
        return {
          organization_id: organizationId,
          location_id: locationId || null,
          region_id: regionId || null,
          category_name: categoryName,
          period_type: periodType,
          period_date: periodDateStr, // This is the planning period date
          unit_target: target.unitTarget ?? 0,
          avg_amount_target: target.avgAmountTarget ?? 0,
          updated_by: user.id,
        };
      });

      // First, delete existing targets for this period to avoid conflicts
      // Then insert new ones
      let deleteQuery = (supabase as any)
        .from('treatment_goal_targets')
        .delete()
        .eq('organization_id', organizationId)
        .eq('period_type', periodType)
        .eq('period_date', periodDateStr);

      if (locationId) {
        deleteQuery = deleteQuery.eq('location_id', locationId);
      } else {
        deleteQuery = deleteQuery.is('location_id', null);
      }

      if (regionId) {
        deleteQuery = deleteQuery.eq('region_id', regionId);
      } else {
        deleteQuery = deleteQuery.is('region_id', null);
      }

      const { error: deleteError } = await deleteQuery;
      if (deleteError) {
        console.error('Error deleting existing targets:', deleteError);
        throw deleteError;
      }

      // Insert new targets
      const { data, error } = await (supabase as any)
        .from('treatment_goal_targets')
        .insert(upserts)
        .select();

      if (error) {
        console.error('Error saving treatment goal targets:', error);
        throw error;
      }

      return data as TreatmentGoalTarget[];
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ 
        queryKey: ['treatment_goal_targets', organizationId, periodDateStr, periodType, locationId, regionId] 
      });
      toast.success('Treatment goal targets saved successfully');
    },
    onError: (error: Error) => {
      toast.error(`Failed to save targets: ${error.message}`);
    },
  });

  return {
    targets: targetsMap,
    targetsList: targets,
    isLoading,
    saveTargets: saveTargetsMutation.mutateAsync,
    isSaving: saveTargetsMutation.isPending,
  };
}
