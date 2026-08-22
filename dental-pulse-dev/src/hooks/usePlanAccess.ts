import { useCallback } from 'react';
import { useOrganization } from './useOrganization';
import { PlanTier, isModuleInPlan } from '@/lib/planRegistry';

// Subscription-plan gate, mirrors useModuleAccess's shape/resolution style.
// Applies to everyone, including org owners.
export function usePlanAccess() {
  const { organization, isLoading } = useOrganization();
  const planTier = (organization?.plan_tier as PlanTier) || 'basic';

  const isModuleAllowedByPlan = useCallback(
    (moduleKey: string): boolean => isModuleInPlan(planTier, moduleKey),
    [planTier],
  );

  return { planTier, isModuleAllowedByPlan, loading: isLoading };
}
