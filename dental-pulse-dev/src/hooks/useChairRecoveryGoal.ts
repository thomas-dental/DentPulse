import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useLocations } from './useLocations';
import { toast } from 'sonner';

export interface ChairRecoveryGoal {
  id: string;
  organization_id: string;
  location_id: string | null;
  period_type: string;
  actual_period: string;
  planning_period: string;
  chair_occupancy_pct: number;
  current_chair_time_occupied_hrs: number;
  recovery_chair_time_hrs: number;
  current_total_revenue: number;
  potential_revenue_recovery: number;
  created_at: string;
  created_by: string | null;
}

export interface ChairRecoveryGoalInput {
  location_id: string | null;
  period_type: string;
  actual_period: string;
  planning_period: string;
  chair_occupancy_pct: number;
  current_chair_time_occupied_hrs: number;
  recovery_chair_time_hrs: number;
  current_total_revenue: number;
  potential_revenue_recovery: number;
}

export interface AssociatePotentialGoal {
  id: string;
  organization_id: string;
  location_id: string | null;
  period_type: string;
  actual_period: string;
  planning_period: string;
  provider_external_id: string | null;
  associate_name: string;
  chair_time_target_hrs: number;
  target_revenue_per_chair_hour: number;
  created_at: string;
  created_by: string | null;
}

export interface AssociatePotentialGoalInput {
  provider_external_id: string | null;
  associate_name: string;
  chair_time_target_hrs: number;
  target_revenue_per_chair_hour: number;
}

interface BatchInput {
  location_id: string | null;
  period_type: string;
  actual_period: string;
  planning_period: string;
  associates: AssociatePotentialGoalInput[];
}

export function useChairRecoveryGoal(locationId: string | null) {
  const { user } = useAuth();
  const { organizationId } = useLocations();
  const queryClient = useQueryClient();

  const { data: history = [], isLoading } = useQuery({
    queryKey: ['chair_recovery_goals', organizationId, locationId],
    queryFn: async () => {
      if (!organizationId) return [];
      let q = (supabase as any)
        .from('chair_recovery_goals')
        .select('*')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false });
      if (locationId) q = q.eq('location_id', locationId);
      else q = q.is('location_id', null);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as ChairRecoveryGoal[];
    },
    enabled: !!user?.id && !!organizationId,
  });

  const saveMutation = useMutation({
    mutationFn: async (input: ChairRecoveryGoalInput) => {
      if (!organizationId) throw new Error('No organization selected');
      if (!user?.id) throw new Error('Not authenticated');
      const { data, error } = await (supabase as any)
        .from('chair_recovery_goals')
        .insert({
          organization_id: organizationId,
          location_id: input.location_id,
          period_type: input.period_type,
          actual_period: input.actual_period,
          planning_period: input.planning_period,
          chair_occupancy_pct: input.chair_occupancy_pct,
          current_chair_time_occupied_hrs: input.current_chair_time_occupied_hrs,
          recovery_chair_time_hrs: input.recovery_chair_time_hrs,
          current_total_revenue: input.current_total_revenue,
          potential_revenue_recovery: input.potential_revenue_recovery,
          created_by: user.id,
        })
        .select()
        .single();
      if (error) throw error;
      return data as ChairRecoveryGoal;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chair_recovery_goals', organizationId, locationId] });
      toast.success('Chair recovery goal saved');
    },
    onError: (error: Error) => {
      toast.error(`Failed to save recovery goal: ${error.message}`);
    },
  });

  return {
    history,
    isLoading,
    saveGoal: saveMutation.mutate,
    isSaving: saveMutation.isPending,
  };
}

export function useAssociatePotentialGoals(locationId: string | null) {
  const { user } = useAuth();
  const { organizationId } = useLocations();
  const queryClient = useQueryClient();

  const { data: history = [], isLoading } = useQuery({
    queryKey: ['associate_potential_goals', organizationId, locationId],
    queryFn: async () => {
      if (!organizationId) return [];
      let q = (supabase as any)
        .from('associate_potential_goals')
        .select('*')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false });
      if (locationId) q = q.eq('location_id', locationId);
      else q = q.is('location_id', null);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as AssociatePotentialGoal[];
    },
    enabled: !!user?.id && !!organizationId,
  });

  // One Save click writes the whole table — every associate row becomes one
  // associate_potential_goals row sharing the same created_at batch.
  const saveBatchMutation = useMutation({
    mutationFn: async (input: BatchInput) => {
      if (!organizationId) throw new Error('No organization selected');
      if (!user?.id) throw new Error('Not authenticated');
      const rows = input.associates
        .filter(a =>
          (a.chair_time_target_hrs && a.chair_time_target_hrs > 0) ||
          (a.target_revenue_per_chair_hour && a.target_revenue_per_chair_hour > 0)
        )
        .map(a => ({
          organization_id: organizationId,
          location_id: input.location_id,
          period_type: input.period_type,
          actual_period: input.actual_period,
          planning_period: input.planning_period,
          provider_external_id: a.provider_external_id,
          associate_name: a.associate_name,
          chair_time_target_hrs: a.chair_time_target_hrs,
          target_revenue_per_chair_hour: a.target_revenue_per_chair_hour,
          created_by: user.id,
        }));
      if (rows.length === 0) return [];
      const { data, error } = await (supabase as any)
        .from('associate_potential_goals')
        .insert(rows)
        .select();
      if (error) throw error;
      return (data || []) as AssociatePotentialGoal[];
    },
    onSuccess: (rows) => {
      queryClient.invalidateQueries({ queryKey: ['associate_potential_goals', organizationId, locationId] });
      if (rows.length === 0) {
        toast.info('Nothing to save — enter at least one target.');
      } else {
        toast.success(`Saved ${rows.length} associate target${rows.length === 1 ? '' : 's'}`);
      }
    },
    onError: (error: Error) => {
      toast.error(`Failed to save associate targets: ${error.message}`);
    },
  });

  return {
    history,
    isLoading,
    saveBatch: saveBatchMutation.mutate,
    isSaving: saveBatchMutation.isPending,
  };
}
