import { useQuery } from '@tanstack/react-query';
import { useOrganization } from '@/hooks/useOrganization';
import {
  fetchRetentionContributionAtRiskApi,
  type RetentionContributionRollup,
  type RetentionContributionSegmentRow,
} from '@/services/integrations/patientEconomicsService';
import { parseRetentionStatus } from '@/lib/peRetentionSegmentation';
import type { PeRetentionStatus } from '@/lib/peRetentionConstants';

export type RetentionContributionAtRisk = {
  practiceId: string;
  practiceName: string;
  practice: RetentionContributionRollup;
  group: RetentionContributionRollup & {
    practiceCount: number;
    practices: RetentionContributionRollup[];
  };
  hasData: boolean;
};

function mapSegment(raw: Record<string, unknown>): RetentionContributionSegmentRow {
  return {
    status: String(raw.status || 'active'),
    label: String(raw.label || ''),
    patientCount: Number(raw.patientCount) || 0,
    contributionGbp: Number(raw.contributionGbp) || 0,
  };
}

function mapRollup(raw: Record<string, unknown>): RetentionContributionRollup {
  return {
    practiceId: String(raw.practiceId || ''),
    practiceName: String(raw.practiceName || 'Practice'),
    segments: (raw.segments as Record<string, unknown>[] | undefined)?.map(mapSegment) ?? [],
    totalContributionGbp: Number(raw.totalContributionGbp) || 0,
    totalPatientCount: Number(raw.totalPatientCount) || 0,
    atRiskContributionGbp: Number(raw.atRiskContributionGbp) || 0,
    atRiskPatientCount: Number(raw.atRiskPatientCount) || 0,
    tier: String(raw.tier || 'Derived'),
    tierNote: String(raw.tierNote || ''),
  };
}

export function useRetentionContributionAtRisk() {
  const { organizationId } = useOrganization();

  return useQuery({
    queryKey: ['retention-contribution-at-risk', organizationId],
    enabled: !!organizationId,
    queryFn: async (): Promise<RetentionContributionAtRisk> => {
      const body = await fetchRetentionContributionAtRiskApi(organizationId!);
      const groupRaw = body.group as Record<string, unknown>;
      return {
        practiceId: String(body.practiceId),
        practiceName: String(body.practiceName || 'This practice'),
        practice: mapRollup(body.practice as Record<string, unknown>),
        group: {
          ...mapRollup(groupRaw),
          practiceCount: Number(groupRaw.practiceCount) || 0,
          practices: (groupRaw.practices as Record<string, unknown>[] | undefined)?.map(
            mapRollup,
          ) ?? [],
        },
        hasData: Boolean(body.hasData),
      };
    },
  });
}

export function segmentContributionByStatus(
  rollup: RetentionContributionRollup,
): Map<PeRetentionStatus, RetentionContributionSegmentRow> {
  const map = new Map<PeRetentionStatus, RetentionContributionSegmentRow>();
  for (const seg of rollup.segments) {
    map.set(parseRetentionStatus(seg.status), seg);
  }
  return map;
}
