import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { toast } from 'sonner';

export type ScaleType = 'sliding_scale' | 'lab_sliding_scale' | 'lab_cost_scale' | 'material_cost_scale';

const SCALE_TYPE_LABELS: Record<ScaleType, string> = {
  sliding_scale: 'Associate Sliding Scale',
  lab_sliding_scale: 'Associate Lab Sliding Scale',
  lab_cost_scale: 'Lab Cost Sliding Scale',
  material_cost_scale: 'Material Cost Sliding Scale',
};

export interface SlidingScale {
  id: string;
  organization_id: string;
  user_id: string | null;
  provider_id: string;
  scale_type: ScaleType;
  band_name: string;
  start_amount: number;
  end_amount: number;
  percentage_value: number;
  created_at: string;
  updated_at: string;
}

export interface SlidingScaleBand {
  id: number;
  band: string;
  start: number;
  end: number;
  percentage: number;
}

export function useSlidingScales(providerId?: string) {
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const organizationId = profile?.current_organization_id;

  // Fetch sliding scales for a specific provider
  const {
    data: slidingScales = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['sliding-scales', providerId, organizationId],
    queryFn: async () => {
      if (!providerId || !organizationId) return [];

      const { data, error } = await supabase
        .from('provider_sliding_scales')
        .select('*')
        .eq('provider_id', providerId)
        .eq('organization_id', organizationId)
        .order('start_amount', { ascending: true });

      if (error) throw error;
      return data as SlidingScale[];
    },
    enabled: !!providerId && !!organizationId,
  });

  // Get scales by type
  const getScalesByType = (scaleType: ScaleType): SlidingScaleBand[] => {
    const scales = slidingScales.filter(s => s.scale_type === scaleType);
    return scales.map((scale, index) => ({
      id: index + 1,
      band: scale.band_name,
      start: Number(scale.start_amount),
      end: Number(scale.end_amount),
      percentage: Number(scale.percentage_value),
    }));
  };

  // Save sliding scales (Replace All Strategy)
  const saveMutation = useMutation({
    mutationFn: async ({
      providerId,
      scaleType,
      bands,
    }: {
      providerId: string;
      scaleType: ScaleType;
      bands: SlidingScaleBand[];
    }) => {
      if (!organizationId) throw new Error('No organization selected');
      if (!user?.id) throw new Error('User not authenticated');

      // Step 1: Delete existing records for this provider and scale type
      const { error: deleteError } = await supabase
        .from('provider_sliding_scales')
        .delete()
        .eq('provider_id', providerId)
        .eq('scale_type', scaleType)
        .eq('organization_id', organizationId);

      if (deleteError) throw deleteError;

      // Step 2: Insert all new records
      const records = bands.map(band => ({
        organization_id: organizationId,
        user_id: user.id,
        provider_id: providerId,
        scale_type: scaleType,
        band_name: band.band,
        start_amount: band.start,
        end_amount: band.end,
        percentage_value: band.percentage,
      }));

      const { data, error: insertError } = await supabase
        .from('provider_sliding_scales')
        .insert(records)
        .select();

      if (insertError) throw insertError;
      return { data: data as SlidingScale[], scaleType };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['sliding-scales', providerId, organizationId] });
      toast.success(`${SCALE_TYPE_LABELS[result.scaleType]} saved successfully`);
    },
    onError: (error: Error) => {
      toast.error(`Failed to save sliding scale: ${error.message}`);
    },
  });

  return {
    slidingScales,
    isLoading,
    error,
    refetch,
    getScalesByType,
    saveSlidingScale: saveMutation.mutate,
    isSaving: saveMutation.isPending,
    savingVariables: saveMutation.variables,
  };
}
