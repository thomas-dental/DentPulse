import { useQuery } from '@tanstack/react-query';
import {
  fetchRetentionRecoveryLoopApi,
  type ReactivationFlagRow,
  type ReactivationValueByPracticeRow,
  type ReactivationWorklistRow,
  type RecoveryFunnel,
  type RetentionRecoveryPracticePayload,
} from '@/services/integrations/patientEconomicsService';
import { usePeScopedRead } from '@/hooks/usePeScopedRead';
import { PE_READ_STALE_MS } from '@/lib/peReadStaleTime';

export type RetentionRecoveryLoop = {
  contextPracticeId: string;
  practiceName: string;
  rollupMode: 'location' | 'practice';
  practice: RetentionRecoveryPracticePayload;
  group: RetentionRecoveryPracticePayload & {
    practiceCount: number;
    practices: ReactivationValueByPracticeRow[];
    flags: ReactivationFlagRow[];
    openWorklist: ReactivationWorklistRow[];
  };
  hasData: boolean;
};

function mapFlag(raw: Record<string, unknown>): ReactivationFlagRow {
  return {
    flagId: String(raw.flagId || ''),
    patientId: String(raw.patientId || ''),
    patientName: String(raw.patientName || 'Unknown patient'),
    dentallyPatientUuid:
      raw.dentallyPatientUuid != null ? String(raw.dentallyPatientUuid) : null,
    segmentAtFlagTime: String(raw.segmentAtFlagTime || ''),
    currentRetentionStatus: String(
      raw.currentRetentionStatus || raw.segmentAtFlagTime || '',
    ),
    contributionAtRiskAtFlagTime: Number(raw.contributionAtRiskAtFlagTime) || 0,
    contributionPreFlagGbp: Number(raw.contributionPreFlagGbp) || 0,
    flaggedAt: String(raw.flaggedAt || ''),
    status: String(raw.status || 'open'),
    recoveredAt: raw.recoveredAt != null ? String(raw.recoveredAt) : null,
    reactivatedEventAt:
      raw.reactivatedEventAt != null ? String(raw.reactivatedEventAt) : null,
    contributionRecoveredGbp:
      raw.contributionRecoveredGbp != null ? Number(raw.contributionRecoveredGbp) : null,
    recoveryWindowDays: Number(raw.recoveryWindowDays) || 365,
    trailingMonths: Number(raw.trailingMonths) || 12,
    practiceId: raw.practiceId != null ? String(raw.practiceId) : undefined,
    practiceName: raw.practiceName != null ? String(raw.practiceName) : undefined,
  };
}

function mapWorklistRow(raw: Record<string, unknown>): ReactivationWorklistRow {
  const workflow = String(raw.workflowStatus || 'new');
  const workflowStatus =
    workflow === 'contacted' || workflow === 'booked' || workflow === 'recovered'
      ? workflow
      : 'new';
  return {
    ...mapFlag(raw),
    daysSinceFlagged: Number(raw.daysSinceFlagged) || 0,
    lastVisitAt: raw.lastVisitAt != null ? String(raw.lastVisitAt) : null,
    daysOverdue: Number(raw.daysOverdue) || 0,
    histContributionYr: Number(raw.histContributionYr) || 0,
    ownerName: raw.ownerName != null ? String(raw.ownerName) : null,
    workflowStatus,
  };
}

function mapRecoveryFunnel(raw: Record<string, unknown> | undefined): RecoveryFunnel {
  const stages = ((raw?.stages as Record<string, unknown>[]) ?? []).map((s) => ({
    key: String(s.key || ''),
    label: String(s.label || ''),
    valueGbp: Number(s.valueGbp) || 0,
  }));
  return {
    flaggedAtRiskGbp: Number(raw?.flaggedAtRiskGbp) || 0,
    assignedGbp: Number(raw?.assignedGbp) || 0,
    contactedGbp: Number(raw?.contactedGbp) || 0,
    bookedGbp: Number(raw?.bookedGbp) || 0,
    recoveredAtRiskGbp: Number(raw?.recoveredAtRiskGbp) || 0,
    recoveredValueGbp: Number(raw?.recoveredValueGbp) || 0,
    openValueGbp: Number(raw?.openValueGbp) || 0,
    bankedPct: raw?.bankedPct == null ? null : Number(raw.bankedPct),
    stages,
  };
}

function mapPracticePayload(raw: Record<string, unknown>): RetentionRecoveryPracticePayload {
  return {
    practiceId: String(raw.practiceId || ''),
    practiceName: String(raw.practiceName || 'Practice'),
    reactivationValueGbp: Number(raw.reactivationValueGbp) || 0,
    openFlagCount: Number(raw.openFlagCount) || 0,
    recoveryWindowDays: Number(raw.recoveryWindowDays) || 365,
    minContributionThresholdGbp: Number(raw.minContributionThresholdGbp) || 100,
    trailingMonths: Number(raw.trailingMonths) || 12,
    flaggedValueGbp: Number(raw.flaggedValueGbp) || 0,
    recoveredValueGbp: Number(raw.recoveredValueGbp) || 0,
    recoveredAtRiskGbp: Number(raw.recoveredAtRiskGbp) || 0,
    openValueGbp: Number(raw.openValueGbp) || 0,
    recoveredFlagCount: Number(raw.recoveredFlagCount) || 0,
    totalFlagCount: Number(raw.totalFlagCount) || 0,
    recoveryRatePct:
      raw.recoveryRatePct == null ? null : Number(raw.recoveryRatePct),
    recoveryFlagRatePct:
      raw.recoveryFlagRatePct == null ? null : Number(raw.recoveryFlagRatePct),
    flags: ((raw.flags as Record<string, unknown>[]) ?? []).map(mapFlag),
    openWorklist: ((raw.openWorklist as Record<string, unknown>[]) ?? []).map(mapWorklistRow),
    recoveredThisQuarterGbp: Number(raw.recoveredThisQuarterGbp) || 0,
    inProgressGbp: Number(raw.inProgressGbp) || 0,
    recoveryFunnel: mapRecoveryFunnel(raw.recoveryFunnel as Record<string, unknown>),
    tier: String(raw.tier || 'Derived'),
    tierNote: String(raw.tierNote || ''),
  };
}

export function useRetentionRecoveryLoop(options?: { enabled?: boolean }) {
  const { organizationId, scopeKey, apiScope, enabled: scopeEnabled } = usePeScopedRead();

  return useQuery({
    queryKey: ['retention-recovery-loop', organizationId, scopeKey],
    enabled: scopeEnabled && (options?.enabled ?? true),
    staleTime: PE_READ_STALE_MS,
    queryFn: async (): Promise<RetentionRecoveryLoop> => {
      const body = await fetchRetentionRecoveryLoopApi(organizationId!, apiScope);
      const groupRaw = body.group as Record<string, unknown>;
      return {
        contextPracticeId: String(body.contextPracticeId),
        practiceName: String(body.practiceName || ''),
        rollupMode:
          body.rollupMode === 'location' || body.rollupMode === 'practice'
            ? body.rollupMode
            : 'practice',
        practice: mapPracticePayload(body.practice as Record<string, unknown>),
        group: {
          ...mapPracticePayload(groupRaw),
          practiceCount: Number(groupRaw.practiceCount) || 0,
          practices: ((groupRaw.practices as Record<string, unknown>[]) ?? []).map(
            (p) => ({
              practiceId: String(p.practiceId),
              practiceName: String(p.practiceName || 'Practice'),
              reactivationValueGbp: Number(p.reactivationValueGbp) || 0,
              openFlagCount: Number(p.openFlagCount) || 0,
            }),
          ),
          flags: ((groupRaw.flags as Record<string, unknown>[]) ?? []).map(mapFlag),
          openWorklist: ((groupRaw.openWorklist as Record<string, unknown>[]) ?? []).map(
            mapWorklistRow,
          ),
        },
        hasData: Boolean(body.hasData),
      };
    },
  });
}
