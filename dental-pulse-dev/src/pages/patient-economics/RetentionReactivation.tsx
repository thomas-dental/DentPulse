/**
 * Retention & Reactivation — mockup v5.1 layout.
 */

import type { ReactNode } from 'react';

import { AlertCircle, Settings2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ContributionAtRiskBySegmentChart,
  RecoveryLoopFunnelChart,
  ReactivationValueByPracticeChart,
  ReactivationWorklistTable,
  formatGbp,
  formatGbpCompact,
} from '@/components/patient-economics/RetentionReactivationCharts';
import {
  segmentContributionByStatus,
  useRetentionContributionAtRisk,
  type RetentionContributionAtRisk,
} from '@/hooks/useRetentionContributionAtRisk';
import { useRetentionRecoveryLoop } from '@/hooks/useRetentionRecoveryLoop';
import { useEconomicAssumptions } from '@/hooks/useEconomicAssumptions';
import {
  PE_RETENTION_SEGMENT_ORDER,
  retentionStatusLabel,
  type PeRetentionStatus,
} from '@/lib/peRetentionConstants';
import { cn } from '@/lib/utils';
import { PE_CTX_BANNER_CLASS } from '@/lib/peVisualTokens';

type RetentionHeroTone = 'default' | 'conv' | 'risk';

const RETENTION_HERO_SUBTITLES: Record<PeRetentionStatus, string> = {
  active: 'Seen within recall window',
  drifting: 'Approaching lapse',
  lapsed: 'Contribution at risk',
  effectively_lost: 'No realistic recovery',
};

const RETENTION_HERO_TONES: Record<PeRetentionStatus, RetentionHeroTone> = {
  active: 'default',
  drifting: 'conv',
  lapsed: 'risk',
  effectively_lost: 'default',
};

function RetentionHeroCard({
  tone = 'default',
  question,
  value,
  subtitle,
}: {
  tone?: RetentionHeroTone;
  question: string;
  value: string;
  subtitle: ReactNode;
}) {
  const bar =
    tone === 'risk' ? 'bg-danger' : tone === 'conv' ? 'bg-warning' : 'bg-primary';
  const valueCls =
    tone === 'risk'
      ? 'text-danger-strong'
      : tone === 'conv'
        ? 'text-warning'
        : question === retentionStatusLabel('effectively_lost')
          ? 'text-muted-foreground'
          : 'text-foreground';

  return (
    <div className="relative overflow-hidden rounded-[14px] border border-border bg-card px-4 py-4 pb-[15px] shadow-sm">
      <div className={cn('absolute inset-x-0 top-0 h-[3px]', bar)} />
      <div className="mb-[9px] min-h-[26px] text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
        {question}
      </div>
      <div className={cn('text-[28px] font-extrabold tracking-tight', valueCls)}>{value}</div>
      <div className="mt-2 text-[11.5px] leading-relaxed text-muted-foreground">{subtitle}</div>
    </div>
  );
}

function RetentionHeroGrid({
  data,
  multiPractice,
}: {
  data: RetentionContributionAtRisk;
  multiPractice: boolean;
}) {
  const rollup = multiPractice ? data.group : data.practice;
  const byStatus = segmentContributionByStatus(rollup);

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      {PE_RETENTION_SEGMENT_ORDER.map((status) => {
        const seg = byStatus.get(status);
        const count = seg?.patientCount ?? 0;
        const subtitle =
          status === 'lapsed' && seg
            ? `${formatGbpCompact(seg.contributionGbp)} contribution at risk`
            : RETENTION_HERO_SUBTITLES[status];

        return (
          <RetentionHeroCard
            key={status}
            tone={RETENTION_HERO_TONES[status]}
            question={retentionStatusLabel(status)}
            value={count.toLocaleString('en-GB')}
            subtitle={subtitle}
          />
        );
      })}
    </div>
  );
}

function SimpleChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-[14px] border border-border bg-card shadow-sm">
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-[15px] font-bold tracking-tight text-foreground">{title}</h2>
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{subtitle}</p>
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}

export function RetentionReactivation() {
  const atRiskQuery = useRetentionContributionAtRisk();
  const recoveryQuery = useRetentionRecoveryLoop();
  const assumptionsQuery = useEconomicAssumptions();

  const { data, isLoading, isError, error, refetch, isFetching } = atRiskQuery;
  const multiPractice = (data?.group.practiceCount ?? 0) > 1;
  const segmentRollup = data ? (multiPractice ? data.group : data.practice) : null;

  const recoveryData = recoveryQuery.data;
  const recoveryPractice = recoveryData?.practice;
  const recoveryGroup = recoveryData?.group;
  const recoveryRollup =
    multiPractice && recoveryGroup ? recoveryGroup : recoveryPractice;
  const worklistRows = multiPractice
    ? recoveryGroup?.openWorklist ?? []
    : recoveryPractice?.openWorklist ?? [];

  const highValueThreshold =
    assumptionsQuery.data?.reactivationHighValueAtRiskGbp ?? 500;
  const highValueOverdueCount = worklistRows.filter(
    (r) => r.histContributionYr >= highValueThreshold,
  ).length;

  const reactivationPractices = recoveryGroup?.practices ?? [];
  const reactivationChartPractices =
    reactivationPractices.length > 0
      ? reactivationPractices
      : recoveryPractice && recoveryPractice.reactivationValueGbp > 0
        ? [
            {
              practiceId: recoveryPractice.practiceId,
              practiceName: recoveryPractice.practiceName,
              reactivationValueGbp: recoveryPractice.reactivationValueGbp,
              openFlagCount: recoveryPractice.openFlagCount,
            },
          ]
        : [];

  const isPageLoading = isLoading || recoveryQuery.isLoading;

  return (
    <div className="space-y-5">
      {isPageLoading && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[120px] rounded-[14px]" />
          ))}
        </div>
      )}

      {isError && (
        <div className="rounded-[14px] border border-destructive/30 bg-destructive/5 px-4 py-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">
                Could not load contribution at risk
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {(error as Error)?.message ?? 'Unknown error'}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => refetch()}
                disabled={isFetching}
              >
                Retry
              </Button>
            </div>
          </div>
        </div>
      )}

      {!isPageLoading && !isError && data && !data.hasData && (
        <div className={cn(PE_CTX_BANNER_CLASS, 'flex-wrap justify-between')}>
          <div>
            <div className="font-semibold text-foreground">No patient contribution data yet</div>
            <div className="mt-0.5 text-muted-foreground">
              Connect Dentally and run Patient Economics sync so invoice contribution and retention
              segments can be computed.
            </div>
          </div>
          <Button asChild size="sm" className="gap-2">
            <Link to="/admin?tab=integrations">
              <Settings2 className="h-4 w-4" />
              Settings / Integrations
            </Link>
          </Button>
        </div>
      )}

      {!isPageLoading && !isError && data && data.hasData && segmentRollup && (
        <>
          <RetentionHeroGrid data={data} multiPractice={multiPractice} />

          <div className="grid gap-4 lg:grid-cols-2">
            <SimpleChartCard
              title="Contribution at Risk by segment"
              subtitle="Patient counts turned into £, value, not volume"
            >
              <ContributionAtRiskBySegmentChart rollup={segmentRollup} />
            </SimpleChartCard>

            <SimpleChartCard
              title="Reactivation value by practice"
              subtitle="Recoverable contribution from lapsed patients"
            >
              {recoveryQuery.isLoading ? (
                <Skeleton className="h-[180px] w-full" />
              ) : recoveryQuery.isError ? (
                <p className="py-6 text-sm text-danger-strong">Could not load reactivation value.</p>
              ) : reactivationChartPractices.length > 0 ? (
                <ReactivationValueByPracticeChart practices={reactivationChartPractices} />
              ) : recoveryPractice && recoveryPractice.openFlagCount > 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  {recoveryPractice.openFlagCount} open flag(s) ·{' '}
                  {formatGbpCompact(recoveryPractice.reactivationValueGbp)} recoverable
                </p>
              ) : (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No open reactivation flags yet.
                </p>
              )}
            </SimpleChartCard>
          </div>
        </>
      )}

      {recoveryQuery.isLoading && (
        <Skeleton className="h-[280px] rounded-[14px]" />
      )}

      {recoveryQuery.isError && (
        <div className="rounded-[14px] border border-destructive/30 bg-destructive/5 px-4 py-4 text-sm text-danger-strong">
          Could not load Recovery Loop data.
        </div>
      )}

      {!recoveryQuery.isLoading && !recoveryQuery.isError && recoveryRollup && (
        <div className="rounded-[14px] border border-border bg-card shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div>
              <h2 className="text-[15px] font-bold tracking-tight text-foreground">
                Recovery Loop<span className="text-primary">™</span>
              </h2>
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
                From flagged to banked. Every at-risk £ gets an owner, a status and a measured
                outcome.
              </p>
            </div>
            <div className="flex gap-6">
              <div className="text-right">
                <div className="text-[11px] text-muted-foreground">
                  Recovered this quarter
                  <span className="block text-[10px] font-normal">contribution booked</span>
                </div>
                <div className="text-[22px] font-extrabold tracking-tight text-success">
                  {formatGbp(recoveryRollup.recoveredThisQuarterGbp)}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[11px] text-muted-foreground">
                  In progress
                  <span className="block text-[10px] font-normal">open flags at risk</span>
                </div>
                <div className="text-[22px] font-extrabold tracking-tight text-primary">
                  {formatGbp(recoveryRollup.inProgressGbp)}
                </div>
              </div>
            </div>
          </div>
          <div className="px-5 py-4">
            <RecoveryLoopFunnelChart funnel={recoveryRollup.recoveryFunnel} />
            <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
              Funnel £ follows worklist workflow status (new → contacted → booked). The{' '}
              <strong className="font-semibold text-foreground">At-risk recovered</strong> bar is
              contribution at risk on closed flags — not the same as{' '}
              <strong className="font-semibold text-foreground">Recovered this quarter</strong>{' '}
              (invoice contribution in the last 90 days).
              {recoveryRollup.recoveryFunnel.bankedPct != null && (
                <>
                  {' '}
                  Cohort recovery rate:{' '}
                  <strong className="font-bold text-foreground">
                    {Math.round(recoveryRollup.recoveryFunnel.bankedPct * 100)}%
                  </strong>{' '}
                  of flagged at-risk £.
                </>
              )}
              {recoveryRollup.recoveryFunnel.recoveredValueGbp > 0 && (
                <>
                  {' '}
                  Lifetime contribution on recovered flags:{' '}
                  <strong className="font-semibold text-foreground">
                    {formatGbp(recoveryRollup.recoveryFunnel.recoveredValueGbp)}
                  </strong>
                  .
                </>
              )}
            </p>
          </div>
        </div>
      )}

      {!recoveryQuery.isLoading && !recoveryQuery.isError && recoveryData && (
        <div className="rounded-[14px] border border-border bg-card shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
            <div>
              <h2 className="text-[15px] font-bold tracking-tight text-foreground">
                Financially-prioritised reactivation worklist
              </h2>
              <p className="mt-1 text-[12.5px] text-muted-foreground">
                Highest contribution at risk first, not an alphabetical recall list
              </p>
            </div>
            {highValueOverdueCount > 0 && (
              <span className="rounded-full border border-danger/30 bg-danger-muted px-2.5 py-0.5 text-[11px] font-semibold text-danger-strong">
                {highValueOverdueCount} high-value overdue
              </span>
            )}
          </div>
          <div className="px-5 py-4">
            <ReactivationWorklistTable rows={worklistRows} showPractice={multiPractice} />
          </div>
        </div>
      )}
    </div>
  );
}
