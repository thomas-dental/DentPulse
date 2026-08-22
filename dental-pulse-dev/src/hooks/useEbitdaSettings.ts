import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from './useOrganization';
import { useAuth } from './useAuth';
import { DEFAULT_QUALITY_WEIGHTS, type QualityWeights } from '@/utils/ebitda/qualityScore';

/** A user-defined Multiple Impact Penalty. `value` is the multiple delta
 *  (negative = penalty, positive = premium). */
export interface CustomPenalty {
  id: string;
  label: string;
  value: number;
}

export interface EbitdaValuationSettings {
  net_debt: number;
  base_multiple: number;
  new_associate_ramp_up: number;
  new_associate_ramp_confidence: number;
  utilisation_improvement: number;
  utilisation_improvement_confidence: number;
  departure_risk_factor: number;
  quality_weights: QualityWeights;
  // Multiple penalty overrides (0 = no penalty, negative = penalty)
  mgmt_depth_penalty: number;
  standardisation_penalty: number;
  leverage_penalty: number;
  // User-defined extra multiple-impact penalties (added via the "+" action).
  custom_penalties: CustomPenalty[];
}

const DEFAULT_SETTINGS: EbitdaValuationSettings = {
  net_debt: 0,
  base_multiple: 5.8,
  new_associate_ramp_up: 0,
  new_associate_ramp_confidence: 50,
  utilisation_improvement: 0,
  utilisation_improvement_confidence: 70,
  departure_risk_factor: 30,
  quality_weights: DEFAULT_QUALITY_WEIGHTS,
  mgmt_depth_penalty: -0.3,
  standardisation_penalty: -0.2,
  leverage_penalty: -0.2,
  custom_penalties: [],
};

/** Normalise the JSONB custom_penalties column into a clean typed array. */
function parseCustomPenalties(raw: unknown): CustomPenalty[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((p: any, i: number): CustomPenalty | null => {
      if (!p || typeof p !== 'object') return null;
      const value = Number(p.value);
      if (!Number.isFinite(value)) return null;
      return {
        id: typeof p.id === 'string' && p.id ? p.id : `cp_${i}`,
        label: typeof p.label === 'string' ? p.label : '',
        value,
      };
    })
    .filter((p): p is CustomPenalty => p !== null);
}

export function useEbitdaSettings() {
  const { organizationId } = useOrganization();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const queryKey = ['ebitda-valuation-settings', organizationId];

  const query = useQuery({
    queryKey,
    queryFn: async (): Promise<EbitdaValuationSettings> => {
      if (!organizationId) return DEFAULT_SETTINGS;

      const { data, error } = await (supabase as any)
        .from('ebitda_valuation_settings')
        .select('net_debt, base_multiple, new_associate_ramp_up, new_associate_ramp_confidence, utilisation_improvement, utilisation_improvement_confidence, departure_risk_factor, quality_weights, mgmt_depth_penalty, standardisation_penalty, leverage_penalty, custom_penalties')
        .eq('organization_id', organizationId)
        .maybeSingle();

      if (error) {
        console.error('[useEbitdaSettings] Error:', error);
        return DEFAULT_SETTINGS;
      }

      if (!data) return DEFAULT_SETTINGS;

      // Parse quality_weights — stored as JSONB in DB
      let parsedWeights = DEFAULT_QUALITY_WEIGHTS;
      if (data.quality_weights && typeof data.quality_weights === 'object') {
        parsedWeights = { ...DEFAULT_QUALITY_WEIGHTS, ...data.quality_weights };
      }

      return {
        net_debt: data.net_debt ?? DEFAULT_SETTINGS.net_debt,
        base_multiple: data.base_multiple ?? DEFAULT_SETTINGS.base_multiple,
        new_associate_ramp_up: data.new_associate_ramp_up ?? DEFAULT_SETTINGS.new_associate_ramp_up,
        new_associate_ramp_confidence: data.new_associate_ramp_confidence ?? DEFAULT_SETTINGS.new_associate_ramp_confidence,
        utilisation_improvement: data.utilisation_improvement ?? DEFAULT_SETTINGS.utilisation_improvement,
        utilisation_improvement_confidence: data.utilisation_improvement_confidence ?? DEFAULT_SETTINGS.utilisation_improvement_confidence,
        departure_risk_factor: data.departure_risk_factor ?? DEFAULT_SETTINGS.departure_risk_factor,
        quality_weights: parsedWeights,
        mgmt_depth_penalty: data.mgmt_depth_penalty ?? DEFAULT_SETTINGS.mgmt_depth_penalty,
        standardisation_penalty: data.standardisation_penalty ?? DEFAULT_SETTINGS.standardisation_penalty,
        leverage_penalty: data.leverage_penalty ?? DEFAULT_SETTINGS.leverage_penalty,
        custom_penalties: parseCustomPenalties(data.custom_penalties),
      };
    },
    enabled: !!organizationId && !!user?.id,
  });

  const updateMutation = useMutation({
    mutationFn: async (updates: Partial<EbitdaValuationSettings>) => {
      const { error } = await (supabase as any)
        .from('ebitda_valuation_settings')
        .upsert({
          organization_id: organizationId,
          ...updates,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'organization_id' });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  return {
    settings: query.data ?? DEFAULT_SETTINGS,
    isLoading: query.isLoading,
    updateSettings: updateMutation.mutateAsync,
  };
}
