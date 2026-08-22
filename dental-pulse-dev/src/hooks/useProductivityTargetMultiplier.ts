import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useLocations } from './useLocations';
import { useFilters } from '@/contexts/FilterContext';
import { toast } from 'sonner';

export type ProductivityCategory = 'staff' | 'clinician' | 'overhead' | 'material' | 'marketing';

export const PRODUCTIVITY_TARGET_DEFAULT = 1.1;

const LABEL_MAP: Record<ProductivityCategory, string> = {
  staff: 'Staff',
  clinician: 'Clinician',
  overhead: 'Overhead',
  material: 'Material',
  marketing: 'Marketing',
};

type Scope = 'location' | 'org';

interface ResolvedMultiplier {
  value: number;
  source: Scope | 'default';
}

export function useProductivityTargetMultiplier(category: ProductivityCategory) {
  const { user } = useAuth();
  const { organizationId } = useLocations();
  const { selectedLocationId } = useFilters();
  const queryClient = useQueryClient();

  const scope: Scope = selectedLocationId ? 'location' : 'org';

  const { data: resolved, isLoading } = useQuery<ResolvedMultiplier>({
    queryKey: [
      'cost_productivity_settings',
      organizationId,
      category,
      selectedLocationId ?? null,
    ],
    queryFn: async () => {
      if (!organizationId) {
        return { value: PRODUCTIVITY_TARGET_DEFAULT, source: 'default' };
      }

      // Try location-specific override first when a location is selected
      if (selectedLocationId) {
        const { data: locRow, error: locErr } = await (supabase as any)
          .from('cost_productivity_settings')
          .select('multiplier')
          .eq('organization_id', organizationId)
          .eq('category', category)
          .eq('location_id', selectedLocationId)
          .maybeSingle();

        if (locErr) {
          console.error(`[useProductivityTargetMultiplier:${category}] location fetch error:`, locErr);
        } else if (locRow?.multiplier != null) {
          return { value: Number(locRow.multiplier), source: 'location' };
        }
      }

      // Fall back to org-wide default row (location_id IS NULL)
      const { data: orgRow, error: orgErr } = await (supabase as any)
        .from('cost_productivity_settings')
        .select('multiplier')
        .eq('organization_id', organizationId)
        .eq('category', category)
        .is('location_id', null)
        .maybeSingle();

      if (orgErr) {
        console.error(`[useProductivityTargetMultiplier:${category}] org fetch error:`, orgErr);
        return { value: PRODUCTIVITY_TARGET_DEFAULT, source: 'default' };
      }

      if (orgRow?.multiplier != null) {
        return { value: Number(orgRow.multiplier), source: 'org' };
      }

      return { value: PRODUCTIVITY_TARGET_DEFAULT, source: 'default' };
    },
    enabled: !!user?.id && !!organizationId,
  });

  const targetMultiplier = resolved?.value ?? PRODUCTIVITY_TARGET_DEFAULT;
  const source = resolved?.source ?? 'default';

  const saveMutation = useMutation({
    mutationFn: async (multiplier: number) => {
      if (!organizationId) throw new Error('No organization selected');
      if (!user?.id) throw new Error('Not authenticated');
      if (!(multiplier > 0)) throw new Error('Target multiplier must be greater than 0');

      const payload: Record<string, unknown> = {
        organization_id: organizationId,
        category,
        location_id: selectedLocationId ?? null,
        multiplier,
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
        queryKey: ['cost_productivity_settings', organizationId, category],
      });
      const scopeLabel = selectedLocationId ? 'location' : 'organization';
      toast.success(`${LABEL_MAP[category]} target saved for this ${scopeLabel}`);
    },
    onError: (error: Error) => {
      toast.error(`Failed to save target: ${error.message}`);
    },
  });

  return {
    targetMultiplier,
    source,
    scope,
    isLoading,
    saveTargetMultiplier: saveMutation.mutate,
    isSaving: saveMutation.isPending,
    categoryLabel: LABEL_MAP[category],
  };
}
