import { useQuery } from '@tanstack/react-query';
import { fetchCltvByAcquisitionSourceApi } from '@/services/integrations/patientEconomicsService';
import { usePeScopedRead } from '@/hooks/usePeScopedRead';

export type CltvAcquisitionSourceRow = {
  acquisitionSourceName: string;
  patientCount: number;
  avgCltv: number;
  totalCltv: number;
  avgQualityScore: number;
  isThinSample: boolean;
  tier: string;
};

export type CltvByAcquisitionSource = {
  minSampleSize: number;
  minSampleTierNote: string;
  sources: CltvAcquisitionSourceRow[];
  hasData: boolean;
  tier: string;
  tierNote: string;
};

export function useCltvByAcquisitionSource() {
  const { organizationId, scopeKey, apiScope, enabled } = usePeScopedRead();

  return useQuery({
    queryKey: ['cltv-by-acquisition-source', organizationId, scopeKey],
    enabled,
    queryFn: async (): Promise<CltvByAcquisitionSource> => {
      const body = await fetchCltvByAcquisitionSourceApi(organizationId!, apiScope);
      return {
        minSampleSize: Number(body.minSampleSize) || 5,
        minSampleTierNote: String(body.minSampleTierNote || ''),
        sources: (body.sources ?? []).map((r) => ({
          acquisitionSourceName: String(r.acquisitionSourceName || 'Unknown'),
          patientCount: Number(r.patientCount) || 0,
          avgCltv: Number(r.avgCltv) || 0,
          totalCltv: Number(r.totalCltv) || 0,
          avgQualityScore: Number(r.avgQualityScore) || 0,
          isThinSample: Boolean(r.isThinSample),
          tier: String(r.tier || 'Modelled'),
        })),
        hasData: Boolean(body.hasData),
        tier: String(body.tier || 'Modelled'),
        tierNote: String(body.tierNote || ''),
      };
    },
  });
}
