/**
 * Economic Assumptions — live config for all PE scattered constants.
 */

import { useCallback, useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useEconomicAssumptions } from '@/hooks/useEconomicAssumptions';
import { saveEconomicAssumptionsApi } from '@/services/integrations/patientEconomicsService';
import type { PeEconomicAssumptions } from '@/types/peEconomicAssumptions';
import { cn } from '@/lib/utils';

function SetRow({
  label,
  description,
  control,
}: {
  label: string;
  description: string;
  control: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 py-3.5 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-foreground">{label}</div>
        <div className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{description}</div>
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="pt-3 text-[12px] font-bold uppercase tracking-wide text-muted-foreground">
      {children}
    </div>
  );
}

function parseNum(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function parseIntList(raw: string): number[] {
  return raw
    .split(/[,\s]+/)
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function assumptionsToInputs(a: PeEconomicAssumptions): Record<string, string> {
  return {
    membershipServiceCostAnnual: String(a.membershipServiceCostAnnual),
    defaultCac: String(a.defaultCac),
    commitmentRateWindowDays: String(a.commitmentRateWindowDays),
    commitmentRateClinicianWindowDays: String(a.commitmentRateClinicianWindowDays),
    commitmentRateStandardWindowsDays: a.commitmentRateStandardWindowsDays.join(','),
    leakageUnscheduledThresholdDays: String(a.leakageUnscheduledThresholdDays),
    growthLeversTrailingMonths: String(a.growthLeversTrailingMonths),
    growthLeversBenchmarkMethod: a.growthLeversBenchmarkMethod,
    growthLeversTargetVisitFrequency:
      a.growthLeversTargetVisitFrequency != null ? String(a.growthLeversTargetVisitFrequency) : '',
    growthLeversTargetValuePerVisit:
      a.growthLeversTargetValuePerVisit != null ? String(a.growthLeversTargetValuePerVisit) : '',
    growthLeversTargetTenureYears:
      a.growthLeversTargetTenureYears != null ? String(a.growthLeversTargetTenureYears) : '',
    growthLeversTargetProjectedLifetimeYears:
      a.growthLeversTargetProjectedLifetimeYears != null
        ? String(a.growthLeversTargetProjectedLifetimeYears)
        : '',
    cltvAcquisitionMinSample: String(a.cltvAcquisitionMinSample),
    collectionRateTrailingMonths: String(a.collectionRateTrailingMonths),
    cashLeakageCollectionWindowDays: String(a.cashLeakageCollectionWindowDays),
    agingBucketBoundaryDays: a.agingBucketBoundaryDays.join(','),
    retentionDriftingVisitGapDays: String(a.retentionDriftingVisitGapDays),
    retentionLapsedRecallOverdueDays: String(a.retentionLapsedRecallOverdueDays),
    retentionLapsedVisitGapDays: String(a.retentionLapsedVisitGapDays),
    retentionEffectivelyLostRecallOverdueDays: String(a.retentionEffectivelyLostRecallOverdueDays),
    retentionEffectivelyLostVisitGapDays: String(a.retentionEffectivelyLostVisitGapDays),
    reactivationMinContributionAtRiskGbp: String(a.reactivationMinContributionAtRiskGbp),
    reactivationRecoveryContributionWindowDays: String(a.reactivationRecoveryContributionWindowDays),
    reactivationHighValueAtRiskGbp: String(a.reactivationHighValueAtRiskGbp),
    reactivationWorklistTrailingMonths: String(a.reactivationWorklistTrailingMonths),
    recommendedActionHighOpportunityWeightedGbp: String(a.recommendedActionHighOpportunityWeightedGbp),
    recommendedActionHighQualityScore: String(a.recommendedActionHighQualityScore),
    recommendedActionLowQualityScore: String(a.recommendedActionLowQualityScore),
    projectedLifetimeYearsActive: String(a.projectedLifetimeYearsActive),
    projectedLifetimeYearsDrifting: String(a.projectedLifetimeYearsDrifting),
    projectedLifetimeYearsLapsed: String(a.projectedLifetimeYearsLapsed),
    projectedLifetimeYearsEffectivelyLost: String(a.projectedLifetimeYearsEffectivelyLost),
    cltvProjectionHorizonYears: String(a.cltvProjectionHorizonYears),
    cltvProjectionDiscountRate: String(a.cltvProjectionDiscountRate),
    modelledVisitsPerYearCap: String(a.modelledVisitsPerYearCap),
    modelledMinVisitsPerYearActive: String(a.modelledMinVisitsPerYearActive),
    modelledInactiveRetentionFactor: String(a.modelledInactiveRetentionFactor),
    modelledFullEngagementVisitsPerYear: String(a.modelledFullEngagementVisitsPerYear),
    modelledQualityScorePlanBonus: String(a.modelledQualityScorePlanBonus),
    journeyMinPlannedEvents: String(a.journeyMinPlannedEvents),
    journeyMinTotalFunnelEvents: String(a.journeyMinTotalFunnelEvents),
  };
}

function inputsToAssumptions(inputs: Record<string, string>): PeEconomicAssumptions {
  const nullable = (k: string) => parseNum(inputs[k]);
  return {
    membershipServiceCostAnnual: parseNum(inputs.membershipServiceCostAnnual) ?? 0,
    defaultCac: parseNum(inputs.defaultCac) ?? 0,
    commitmentRateWindowDays: parseNum(inputs.commitmentRateWindowDays) ?? 30,
    commitmentRateClinicianWindowDays: parseNum(inputs.commitmentRateClinicianWindowDays) ?? 30,
    commitmentRateStandardWindowsDays: parseIntList(inputs.commitmentRateStandardWindowsDays),
    leakageUnscheduledThresholdDays: parseNum(inputs.leakageUnscheduledThresholdDays) ?? 60,
    growthLeversTrailingMonths: parseNum(inputs.growthLeversTrailingMonths) ?? 12,
    growthLeversBenchmarkMethod:
      inputs.growthLeversBenchmarkMethod === 'configured_target' ? 'configured_target' : 'group_top',
    growthLeversTargetVisitFrequency: nullable('growthLeversTargetVisitFrequency'),
    growthLeversTargetValuePerVisit: nullable('growthLeversTargetValuePerVisit'),
    growthLeversTargetTenureYears: nullable('growthLeversTargetTenureYears'),
    growthLeversTargetProjectedLifetimeYears: nullable('growthLeversTargetProjectedLifetimeYears'),
    cltvAcquisitionMinSample: parseNum(inputs.cltvAcquisitionMinSample) ?? 5,
    collectionRateTrailingMonths: parseNum(inputs.collectionRateTrailingMonths) ?? 12,
    cashLeakageCollectionWindowDays: parseNum(inputs.cashLeakageCollectionWindowDays) ?? 30,
    agingBucketBoundaryDays: parseIntList(inputs.agingBucketBoundaryDays),
    retentionDriftingVisitGapDays: parseNum(inputs.retentionDriftingVisitGapDays) ?? 182,
    retentionLapsedRecallOverdueDays: parseNum(inputs.retentionLapsedRecallOverdueDays) ?? 90,
    retentionLapsedVisitGapDays: parseNum(inputs.retentionLapsedVisitGapDays) ?? 365,
    retentionEffectivelyLostRecallOverdueDays:
      parseNum(inputs.retentionEffectivelyLostRecallOverdueDays) ?? 180,
    retentionEffectivelyLostVisitGapDays:
      parseNum(inputs.retentionEffectivelyLostVisitGapDays) ?? 730,
    reactivationMinContributionAtRiskGbp:
      parseNum(inputs.reactivationMinContributionAtRiskGbp) ?? 100,
    reactivationRecoveryContributionWindowDays:
      parseNum(inputs.reactivationRecoveryContributionWindowDays) ?? 365,
    reactivationHighValueAtRiskGbp: parseNum(inputs.reactivationHighValueAtRiskGbp) ?? 500,
    reactivationWorklistTrailingMonths: parseNum(inputs.reactivationWorklistTrailingMonths) ?? 12,
    recommendedActionHighOpportunityWeightedGbp:
      parseNum(inputs.recommendedActionHighOpportunityWeightedGbp) ?? 500,
    recommendedActionHighQualityScore: parseNum(inputs.recommendedActionHighQualityScore) ?? 70,
    recommendedActionLowQualityScore: parseNum(inputs.recommendedActionLowQualityScore) ?? 40,
    projectedLifetimeYearsActive: parseNum(inputs.projectedLifetimeYearsActive) ?? 8,
    projectedLifetimeYearsDrifting: parseNum(inputs.projectedLifetimeYearsDrifting) ?? 5,
    projectedLifetimeYearsLapsed: parseNum(inputs.projectedLifetimeYearsLapsed) ?? 2,
    projectedLifetimeYearsEffectivelyLost:
      parseNum(inputs.projectedLifetimeYearsEffectivelyLost) ?? 1,
    cltvProjectionHorizonYears: parseNum(inputs.cltvProjectionHorizonYears) ?? 5,
    cltvProjectionDiscountRate: parseNum(inputs.cltvProjectionDiscountRate) ?? 0.1,
    modelledVisitsPerYearCap: parseNum(inputs.modelledVisitsPerYearCap) ?? 6,
    modelledMinVisitsPerYearActive: parseNum(inputs.modelledMinVisitsPerYearActive) ?? 0.5,
    modelledInactiveRetentionFactor: parseNum(inputs.modelledInactiveRetentionFactor) ?? 0.3,
    modelledFullEngagementVisitsPerYear:
      parseNum(inputs.modelledFullEngagementVisitsPerYear) ?? 2,
    modelledQualityScorePlanBonus: parseNum(inputs.modelledQualityScorePlanBonus) ?? 5,
    journeyMinPlannedEvents: parseNum(inputs.journeyMinPlannedEvents) ?? 5,
    journeyMinTotalFunnelEvents: parseNum(inputs.journeyMinTotalFunnelEvents) ?? 10,
  };
}

type Props = { organizationId: string | null };

export function PeEconomicAssumptionsPanel({ organizationId }: Props) {
  const queryClient = useQueryClient();
  const query = useEconomicAssumptions();
  const [inputs, setInputs] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!query.data?.assumptions) return;
    setInputs(assumptionsToInputs(query.data.assumptions));
  }, [query.data]);

  const setField = useCallback((key: string, value: string) => {
    setInputs((prev) => ({ ...prev, [key]: value }));
  }, []);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error('No practice selected');
      return saveEconomicAssumptionsApi(organizationId, inputsToAssumptions(inputs));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pe-economic-assumptions'] });
      queryClient.invalidateQueries({ queryKey: ['pe-conversion-probabilities'] });
      toast.success('Economic assumptions saved');
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to save'),
  });

  function numInput(
    value: string,
    onChange: (v: string) => void,
    opts?: { width?: string; suffix?: string },
  ) {
    return (
      <div className="flex items-center gap-1.5">
        <Input
          className={cn('h-8 text-xs', opts?.width ?? 'w-20')}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        {opts?.suffix && <span className="text-xs text-muted-foreground">{opts.suffix}</span>}
      </div>
    );
  }

  const ni = (key: string, suffix?: string, width = 'w-20') =>
    numInput(inputs[key] ?? '', (v) => setField(key, v), { suffix, width });

  if (!organizationId) {
    return (
      <p className="text-sm text-muted-foreground">Select a practice to configure assumptions.</p>
    );
  }

  if (query.isLoading) {
    return (
      <div className="space-y-3 py-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <div>
          <p className="font-medium text-destructive">Could not load economic assumptions</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2 h-7 text-xs"
            onClick={() => query.refetch()}
          >
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <SectionTitle>Commitment rate & leakage</SectionTitle>
      <SetRow
        label="Commitment rate window"
        description="Days from PLAN_CREATED to first APPOINTMENT_LINKED (default 30)."
        control={ni('commitmentRateWindowDays', 'days')}
      />
      <SetRow
        label="Clinician commitment window"
        description="Window for per-clinician breakdown on Value & Leakage."
        control={ni('commitmentRateClinicianWindowDays', 'days')}
      />
      <SetRow
        label="Standard commitment windows"
        description="Chart windows — comma-separated days (7,30,60,90)."
        control={ni('commitmentRateStandardWindowsDays', '', 'w-32')}
      />
      <SetRow
        label="Planned unscheduled threshold"
        description="Days before planned-but-unscheduled pipeline counts as leakage."
        control={ni('leakageUnscheduledThresholdDays', 'days')}
      />

      <SectionTitle>Growth levers & CLTV</SectionTitle>
      <SetRow
        label="Trailing months"
        description="Growth Levers visit frequency / value-per-visit window."
        control={ni('growthLeversTrailingMonths', 'mo')}
      />
      <SetRow
        label="Benchmark method"
        description="Group top performer vs configured targets."
        control={
          <Select
            value={inputs.growthLeversBenchmarkMethod ?? 'group_top'}
            onValueChange={(v) => setField('growthLeversBenchmarkMethod', v)}
          >
            <SelectTrigger className="h-8 w-[180px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="group_top">Group top performer</SelectItem>
              <SelectItem value="configured_target">Configured targets</SelectItem>
            </SelectContent>
          </Select>
        }
      />
      <SetRow
        label="Target visit frequency"
        description="When benchmark = configured (blank = group top fallback)."
        control={ni('growthLeversTargetVisitFrequency', 'visits/yr')}
      />
      <SetRow
        label="Target value per visit"
        description="Configured benchmark £ per visit."
        control={
          <div className="flex items-center gap-1.5">
            <span className="text-[13px] text-muted-foreground">£</span>
            {numInput(inputs.growthLeversTargetValuePerVisit ?? '', (v) =>
              setField('growthLeversTargetValuePerVisit', v),
            )}
          </div>
        }
      />
      <SetRow
        label="CLTV acquisition min sample"
        description="Minimum patients per acquisition source for CLTV by source."
        control={ni('cltvAcquisitionMinSample', 'patients')}
      />

      <SectionTitle>Invoices & collection</SectionTitle>
      <SetRow
        label="Collection rate trailing months"
        description="Trailing window for collection rate by practice."
        control={ni('collectionRateTrailingMonths', 'mo')}
      />
      <SetRow
        label="Cash leakage window"
        description="Days charged without collection before cash-leakage flag."
        control={ni('cashLeakageCollectionWindowDays', 'days')}
      />
      <SetRow
        label="Aging bucket boundaries"
        description="Upper day bounds for 0–30 / 31–60 / 61–90 / 90+ (comma-separated)."
        control={ni('agingBucketBoundaryDays', '', 'w-32')}
      />
      <SetRow
        label="Membership service cost"
        description="Annual expected delivery cost per member (£)."
        control={
          <div className="flex items-center gap-1.5">
            <span className="text-[13px] text-muted-foreground">£</span>
            {numInput(inputs.membershipServiceCostAnnual ?? '', (v) =>
              setField('membershipServiceCostAnnual', v),
            )}
          </div>
        }
      />
      <SetRow
        label="Default CAC"
        description="Default customer acquisition cost when source unknown (£)."
        control={
          <div className="flex items-center gap-1.5">
            <span className="text-[13px] text-muted-foreground">£</span>
            {numInput(inputs.defaultCac ?? '', (v) => setField('defaultCac', v))}
          </div>
        }
      />

      <SectionTitle>Retention thresholds (days)</SectionTitle>
      <SetRow label="Drifting visit gap" description="No visit &gt; N days → drifting." control={ni('retentionDriftingVisitGapDays', 'days')} />
      <SetRow label="Lapsed recall overdue" description="Recall overdue &gt; N → lapsed." control={ni('retentionLapsedRecallOverdueDays', 'days')} />
      <SetRow label="Lapsed visit gap" description="No visit &gt; N → lapsed." control={ni('retentionLapsedVisitGapDays', 'days')} />
      <SetRow label="Effectively lost recall" description="Recall overdue &gt; N → effectively lost." control={ni('retentionEffectivelyLostRecallOverdueDays', 'days')} />
      <SetRow label="Effectively lost visit gap" description="No visit &gt; N → effectively lost." control={ni('retentionEffectivelyLostVisitGapDays', 'days')} />

      <SectionTitle>Reactivation</SectionTitle>
      <SetRow label="Min contribution at risk" description="Minimum £ to open a reactivation flag." control={
        <div className="flex items-center gap-1.5"><span className="text-xs text-muted-foreground">£</span>{numInput(inputs.reactivationMinContributionAtRiskGbp ?? '', (v) => setField('reactivationMinContributionAtRiskGbp', v))}</div>
      } />
      <SetRow label="Recovery window" description="Days to sum contribution after reactivation." control={ni('reactivationRecoveryContributionWindowDays', 'days')} />
      <SetRow label="High-value at risk" description="Badge threshold for high-value overdue count (£)." control={
        <div className="flex items-center gap-1.5"><span className="text-xs text-muted-foreground">£</span>{numInput(inputs.reactivationHighValueAtRiskGbp ?? '', (v) => setField('reactivationHighValueAtRiskGbp', v))}</div>
      } />
      <SetRow label="Worklist trailing months" description="12mo contribution enrichment on worklist." control={ni('reactivationWorklistTrailingMonths', 'mo')} />

      <SectionTitle>Recommended action rules</SectionTitle>
      <SetRow label="High opportunity weighted" description="Weighted opportunity £ for high-opp actions." control={
        <div className="flex items-center gap-1.5"><span className="text-xs text-muted-foreground">£</span>{numInput(inputs.recommendedActionHighOpportunityWeightedGbp ?? '', (v) => setField('recommendedActionHighOpportunityWeightedGbp', v))}</div>
      } />
      <SetRow label="High quality score" description="Quality score ≥ N = high quality." control={ni('recommendedActionHighQualityScore', '/100')} />
      <SetRow label="Low quality score" description="Quality score &lt; N = low quality." control={ni('recommendedActionLowQualityScore', '/100')} />

      <SectionTitle>Projected lifetime (years by segment)</SectionTitle>
      <SetRow label="Active" description="Expected total relationship years." control={ni('projectedLifetimeYearsActive', 'yr')} />
      <SetRow label="Drifting" description="" control={ni('projectedLifetimeYearsDrifting', 'yr')} />
      <SetRow label="Lapsed" description="" control={ni('projectedLifetimeYearsLapsed', 'yr')} />
      <SetRow label="Effectively lost" description="" control={ni('projectedLifetimeYearsEffectivelyLost', 'yr')} />

      <SectionTitle>Modelled scores job</SectionTitle>
      <SetRow label="CLTV horizon" description="Discounted projection years." control={ni('cltvProjectionHorizonYears', 'yr')} />
      <SetRow label="Discount rate" description="Annual discount for CLTV projection (0.10 = 10%)." control={ni('cltvProjectionDiscountRate', '')} />
      <SetRow label="Visits per year cap" description="Cap on trailing visit frequency." control={ni('modelledVisitsPerYearCap', '')} />
      <SetRow label="Min visits/year (active)" description="Floor for active patient run-rate." control={ni('modelledMinVisitsPerYearActive', '')} />
      <SetRow label="Inactive retention factor" description="Multiplier when patient not active (0.30)." control={ni('modelledInactiveRetentionFactor', '')} />
      <SetRow label="Full engagement visits/yr" description="Visits/year for full engagement factor (÷2 in formula)." control={ni('modelledFullEngagementVisitsPerYear', '')} />
      <SetRow label="Quality plan bonus" description="Points added when on payment plan." control={ni('modelledQualityScorePlanBonus', 'pts')} />

      <SectionTitle>Journey backfill thresholds</SectionTitle>
      <SetRow label="Min planned events" description="Below this → “ledger backfilling” empty state." control={ni('journeyMinPlannedEvents', 'events')} />
      <SetRow label="Min total funnel events" description="Minimum total funnel events before chart shows." control={ni('journeyMinTotalFunnelEvents', 'events')} />

      <div className="mt-4 flex justify-end gap-2 border-t border-border/60 pt-4">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 text-xs"
          disabled={saveMutation.isPending}
          onClick={() => {
            if (query.data?.assumptions) {
              setInputs(assumptionsToInputs(query.data.assumptions));
            }
          }}
        >
          Reset
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          disabled={saveMutation.isPending}
          onClick={() => saveMutation.mutate()}
        >
          {saveMutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5" />
          )}
          Save assumptions
        </Button>
      </div>

      {query.data?.opsOnlyNote && (
        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">{query.data.opsOnlyNote}</p>
      )}
    </div>
  );
}
