import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { useOrganization } from '@/hooks/useOrganization';
import {
  fetchPeInvoicesSummary,
  type PeInvoicesSummary,
} from '@/services/integrations/peInvoicesService';

export function usePeInvoicesSummary() {
  const { organizationId } = useOrganization();
  const { user } = useAuth();

  return useQuery({
    queryKey: ['pe-invoices-summary', organizationId, user?.id],
    enabled: !!organizationId && !!user?.id,
    queryFn: async (): Promise<PeInvoicesSummary> =>
      fetchPeInvoicesSummary(organizationId!, user!.id),
  });
}
