import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useLocations } from './useLocations';
import { useFilters } from '@/contexts/FilterContext';
import { toast } from 'sonner';
import { ProductivityCategory } from './useProductivityTargetMultiplier';

export const BUDGET_MULTIPLIER_DEFAULT = 1.05;
export const BENCHMARK_MULTIPLIER_DEFAULT = 0.95;

const LABEL_MAP: Record<ProductivityCategory, string> = {
  staff: 'Staff',
  clinician: 'Clinician',
  overhead: 'Overhead',
  material: 'Material',
  marketing: 'Marketing',
};

type Scope = 'location' | 'org';

interface Resolved {
  budgetMultiplier: number;
  benchmarkMultiplier: number;
  source: Scope | 'default';
}

export function useCostTrendMultipliers(category: ProductivityCategory) {
  const { user } = useAuth();
  const { organizationId } = useLocations();
  const { selectedLocationId } = useFilters();
  const queryClient = useQueryClient();

  const scope: Scope = selectedLocationId ? 'location' : 'org';

  const { data: resolved, isLoading } = useQuery<Resolved>({
    queryKey: [
      'cost_productivity_settings_trend',
      organizationId,
      category,
      selectedLocationId ?? null,
    ],
    queryFn: async () => {
      const fallback: Resolved = {
        budgetMultiplier: BUDGET_MULTIPLIER_DEFAULT,
        benchmarkMultiplier: BENCHMARK_MULTIPLIER_DEFAULT,
        source: 'default',
      };
      if (!organizationId) return fallback;

      // Location-specific override first
      if (selectedLocationId) {
        const { data: locRow, error: locErr } = await (supabase as any)
          .from('cost_productivity_settings')
          .select('budget_multiplier, benchmark_multiplier')
          .eq('organization_id', organizationId)
          .eq('category', category)
          .eq('location_id', selectedLocationId)
          .maybeSingle();

        if (locErr) {
          console.error(`[useCostTrendMultipliers:${category}] location fetch error:`, locErr);
        } else if (locRow) {
          return {
            budgetMultiplier: locRow.budget_multiplier != null ? Number(locRow.budget_multiplier) : BUDGET_MULTIPLIER_DEFAULT,
            benchmarkMultiplier: locRow.benchmark_multiplier != null ? Number(locRow.benchmark_multiplier) : BENCHMARK_MULTIPLIER_DEFAULT,
            source: 'location',
          };
        }
      }

      // Org-wide fallback (location_id IS NULL)
      const { data: orgRow, error: orgErr } = await (supabase as any)
        .from('cost_productivity_settings')
        .select('budget_multiplier, benchmark_multiplier')
        .eq('organization_id', organizationId)
        .eq('category', category)
        .is('location_id', null)
        .maybeSingle();

      if (orgErr) {
        console.error(`[useCostTrendMultipliers:${category}] org fetch error:`, orgErr);
        return fallback;
      }
      if (orgRow) {
        return {
          budgetMultiplier: orgRow.budget_multiplier != null ? Number(orgRow.budget_multiplier) : BUDGET_MULTIPLIER_DEFAULT,
          benchmarkMultiplier: orgRow.benchmark_multiplier != null ? Number(orgRow.benchmark_multiplier) : BENCHMARK_MULTIPLIER_DEFAULT,
          source: 'org',
        };
      }

      return fallback;
    },
    enabled: !!user?.id && !!organizationId,
  });

  const budgetMultiplier = resolved?.budgetMultiplier ?? BUDGET_MULTIPLIER_DEFAULT;
  const benchmarkMultiplier = resolved?.benchmarkMultiplier ?? BENCHMARK_MULTIPLIER_DEFAULT;
  const source = resolved?.source ?? 'default';

  const saveMutation = useMutation({
    mutationFn: async (input: { budgetMultiplier: number; benchmarkMultiplier: number }) => {
      if (!organizationId) throw new Error('No organization selected');
      if (!user?.id) throw new Error('Not authenticated');
      if (!(input.budgetMultiplier > 0)) throw new Error('Budget multiplier must be greater than 0');
      if (!(input.benchmarkMultiplier > 0)) throw new Error('Benchmark multiplier must be greater than 0');

      const payload: Record<string, unknown> = {
        organization_id: organizationId,
        category,
        location_id: selectedLocationId ?? null,
        budget_multiplier: input.budgetMultiplier,
        benchmark_multiplier: input.benchmarkMultiplier,
        updated_by: user.id,
        created_by: user.id,
      };

      const { data, error } = await (supabase as any)
        .from('cost_productivity_settings')
        .upsert(payload, { onConflict: 'organization_id,category,location_id' })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['cost_productivity_settings_trend', organizationId, category],
      });
      const scopeLabel = selectedLocationId ? 'location' : 'organization';
      toast.success(`${LABEL_MAP[category]} trend settings saved for this ${scopeLabel}`);
    },
    onError: (error: Error) => {
      toast.error(`Failed to save trend settings: ${error.message}`);
    },
  });

  return {
    budgetMultiplier,
    benchmarkMultiplier,
    source,
    scope,
    isLoading,
    saveMultipliers: saveMutation.mutate,
    isSaving: saveMutation.isPending,
    categoryLabel: LABEL_MAP[category],
  };
}
