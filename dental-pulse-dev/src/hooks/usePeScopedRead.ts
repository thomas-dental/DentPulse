import { usePeReadScope, peScopeQueryKey } from '@/contexts/PeReadScopeContext';
import type { PeApiScope } from '@/services/integrations/patientEconomicsService';
import { useOrganization } from '@/hooks/useOrganization';

/** Shared TopBar scope for PE read hooks. */
export function usePeScopedRead() {
  const { organizationId } = useOrganization();
  const scope = usePeReadScope();

  const apiScope: PeApiScope = {
    locationId: scope.locationId,
    startDate: scope.startDate,
    endDate: scope.endDate,
  };

  return {
    organizationId,
    scope,
    scopeKey: peScopeQueryKey(scope),
    apiScope,
    enabled: Boolean(organizationId && scope.isReady && scope.startDate && scope.endDate),
  };
}
