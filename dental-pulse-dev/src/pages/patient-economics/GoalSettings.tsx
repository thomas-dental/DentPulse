/**
 * Goal Settings — mockup v5.1 layout with inline group targets + practice overrides table.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Check, Loader2, Target } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  PeGoalMetricCard,
  computePracticeGoalProgressPct,
  goalProgressBarClass,
} from '@/components/patient-economics/PeGoalMetricCard';
import { PeSectionLabel } from '@/components/patient-economics/PeSectionLabel';
import { useOrganization } from '@/hooks/useOrganization';
import { useGoalSettings } from '@/hooks/useGoalSettings';
import { saveGoalSettingsApi } from '@/services/integrations/patientEconomicsService';
import type { PeGoalTargets } from '@/types/peGoalSettings';
import { cn } from '@/lib/utils';
import { PE_CTX_BANNER_CLASS } from '@/lib/peVisualTokens';
import {
  applyFieldRemainderFill,
  applyLastRowAutoFill,
  buildRowOverrideTargets,
  emptyGoalTargetInputs,
  resolveEffectiveGoalInputs,
  shouldSaveOverrideRow,
  type GoalTargetField,
  type GoalTargetInputs,
} from '@/lib/peGoalDistribution';
import { formatCommitmentPointsGap } from '@/lib/peGoalProgress';

function emptyTargets(): PeGoalTargets {
  return {
    commitmentRatePct: null,
    contributionPerActiveGbp: null,
    opportunityProgressionGbp: null,
    attritionCeilingPct: null,
  };
}

function parseInputNumber(raw: string): number | null {
  const t = raw.trim().replace(/[£,%]/g, '');
  if (!t) return null;
  const normalized = t.endsWith('k') ? Number(t.slice(0, -1)) * 1000 : Number(t);
  return Number.isFinite(normalized) ? normalized : null;
}

function targetsToInputs(t: PeGoalTargets): GoalTargetInputs {
  return {
    commitmentRatePct: t.commitmentRatePct != null ? String(t.commitmentRatePct) : '',
    contributionPerActiveGbp:
      t.contributionPerActiveGbp != null ? String(t.contributionPerActiveGbp) : '',
    opportunityProgressionGbp:
      t.opportunityProgressionGbp != null ? String(t.opportunityProgressionGbp) : '',
    attritionCeilingPct: t.attritionCeilingPct != null ? String(t.attritionCeilingPct) : '',
  };
}

function inputsToTargets(inputs: GoalTargetInputs): PeGoalTargets {
  return {
    commitmentRatePct: parseInputNumber(inputs.commitmentRatePct),
    contributionPerActiveGbp: parseInputNumber(inputs.contributionPerActiveGbp),
    opportunityProgressionGbp: parseInputNumber(inputs.opportunityProgressionGbp),
    attritionCeilingPct: parseInputNumber(inputs.attritionCeilingPct),
  };
}

function attritionBreachingHint(
  practices: Array<{
    practiceName: string;
    actuals: { attritionPct: number | null };
    targets: { attritionCeilingPct: number | null };
  }>,
): string | undefined {
  let worst: { name: string; pct: number } | null = null;

  for (const row of practices) {
    const ceiling =
      row.targets.attritionCeilingPct != null ? row.targets.attritionCeilingPct / 100 : null;
    const actual = row.actuals.attritionPct;
    if (ceiling == null || actual == null || actual <= ceiling) continue;
    const pct = Math.round(actual * 1000) / 10;
    if (!worst || pct > worst.pct) worst = { name: row.practiceName, pct };
  }

  if (!worst) return undefined;
  const shortName = worst.name.replace(/\s+Dental$/i, '').trim();
  return `${shortName} breaching at ${worst.pct}%`;
}

type GoalSettingsSavePayload = {
  defaultInputs: GoalTargetInputs;
  overrideInputs: Record<string, GoalTargetInputs>;
  overrideSnapshot: Record<string, GoalTargetInputs>;
  rows: Array<{ practiceId: string }>;
};

export function GoalSettings() {
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();
  const settingsQuery = useGoalSettings();
  const data = settingsQuery.data;

  const [defaultInputs, setDefaultInputs] = useState<GoalTargetInputs>(emptyGoalTargetInputs());
  const [overrideInputs, setOverrideInputs] = useState<Record<string, GoalTargetInputs>>({});
  const [overrideSnapshot, setOverrideSnapshot] = useState<Record<string, GoalTargetInputs>>({});
  const [saveSuccessMessage, setSaveSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    setDefaultInputs(targetsToInputs(data.defaults));
    const map: Record<string, GoalTargetInputs> = {};
    for (const row of data.practices) {
      map[row.practiceId] = targetsToInputs(row.override ?? emptyTargets());
    }
    setOverrideInputs(map);
    setOverrideSnapshot(
      Object.fromEntries(
        Object.entries(map).map(([id, inputs]) => [id, { ...inputs }]),
      ),
    );
  }, [data]);

  useEffect(() => {
    if (!saveSuccessMessage) return;
    const timer = window.setTimeout(() => setSaveSuccessMessage(null), 5000);
    return () => window.clearTimeout(timer);
  }, [saveSuccessMessage]);

  const saveMutation = useMutation({
    mutationFn: async (payload: GoalSettingsSavePayload) => {
      if (!organizationId) throw new Error('No practice selected');

      const practiceOverrides = payload.rows
        .map((row) => {
          const inputs = payload.overrideInputs[row.practiceId] ?? emptyGoalTargetInputs();
          const snapshot = payload.overrideSnapshot[row.practiceId] ?? emptyGoalTargetInputs();
          if (!shouldSaveOverrideRow(inputs, snapshot)) return null;
          return { practiceId: row.practiceId, ...buildRowOverrideTargets(inputs) };
        })
        .filter((row): row is NonNullable<typeof row> => row != null);

      return saveGoalSettingsApi(organizationId, {
        defaults: inputsToTargets(payload.defaultInputs),
        practiceOverrides,
      });
    },
    onSuccess: (_data, variables) => {
      setSaveSuccessMessage('Goal targets saved successfully.');
      setOverrideSnapshot(
        Object.fromEntries(
          Object.entries(variables.overrideInputs).map(([id, inputs]) => [id, { ...inputs }]),
        ),
      );
      toast.success('Goal targets saved', {
        description: 'Group and per-location targets have been updated.',
        duration: 5000,
      });
      queryClient.invalidateQueries({ queryKey: ['pe-goal-settings', organizationId] });
    },
    onError: (err: Error) => {
      setSaveSuccessMessage(null);
      toast.error(err.message || 'Failed to save goal targets', { duration: 6000 });
    },
  });

  const contextMetrics = data?.contextMetrics;
  const practiceRows = useMemo(() => data?.practices ?? [], [data?.practices]);
  const practiceIds = useMemo(() => practiceRows.map((row) => row.practiceId), [practiceRows]);
  const rollupUnitLabel = data?.rollupMode === 'location' ? 'location' : 'practice';
  const rollupUnitLabelPlural = data?.rollupMode === 'location' ? 'locations' : 'practices';

  const effectiveOverrideInputs = useMemo(
    () => resolveEffectiveGoalInputs(defaultInputs, overrideInputs, practiceIds),
    [defaultInputs, overrideInputs, practiceIds],
  );

  const attritionFooter = useMemo(
    () => attritionBreachingHint(practiceRows),
    [practiceRows],
  );

  const commitmentFooter = useMemo(
    () =>
      formatCommitmentPointsGap(
        contextMetrics?.commitmentRate.actual,
        defaultInputs.commitmentRatePct,
        contextMetrics?.commitmentRate.target,
      ),
    [contextMetrics?.commitmentRate, defaultInputs.commitmentRatePct],
  );

  const updateOverride = useCallback(
    (practiceId: string, field: GoalTargetField, value: string) => {
      setOverrideInputs((prev) => {
        const withEdit = {
          ...prev,
          [practiceId]: {
            ...(prev[practiceId] ?? emptyGoalTargetInputs()),
            [field]: value,
          },
        };

        const withFieldFill = applyFieldRemainderFill(
          defaultInputs,
          withEdit,
          practiceIds,
          field,
        );
        return applyLastRowAutoFill(defaultInputs, withFieldFill, practiceIds);
      });
    },
    [defaultInputs, practiceIds],
  );

  return (
    <div className="space-y-5">
      <div className={cn(PE_CTX_BANNER_CLASS, 'items-center')}>
        <Target className="h-4 w-4 shrink-0 text-primary" />
        <span>
          Targets are economic now, contribution, commitment rate and opportunity conversion, with{' '}
          <strong className="text-primary">actual vs target</strong> progress. Blank per-{rollupUnitLabel}{' '}
          fields inherit the group target.
        </span>
      </div>

      {settingsQuery.isLoading && (
        <div className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[200px] rounded-[14px]" />
            ))}
          </div>
          <Skeleton className="h-[320px] rounded-[14px]" />
        </div>
      )}

      {settingsQuery.isError && (
        <div className="rounded-[14px] border border-destructive/30 bg-destructive/5 px-4 py-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">Could not load goal settings</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {(settingsQuery.error as Error)?.message ?? 'Unknown error'}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => settingsQuery.refetch()}
              >
                Retry
              </Button>
            </div>
          </div>
        </div>
      )}

      {settingsQuery.isSuccess && data && contextMetrics && (
        <>
          <div className="grid gap-4 xl:grid-cols-2">
            <PeGoalMetricCard
              title={`Commitment Rate™ (${data.commitmentWindowDays}-day)`}
              subtitle="Planned → scheduled conversion"
              metric={contextMetrics.commitmentRate}
              format="pct"
              targetFieldLabel="Group target"
              targetInputValue={defaultInputs.commitmentRatePct}
              onTargetInputChange={(v) =>
                setDefaultInputs((p) => ({ ...p, commitmentRatePct: v }))
              }
              targetSuffix="%"
              footerHint={commitmentFooter}
            />
            <PeGoalMetricCard
              title="Contribution per active patient"
              subtitle="Annual"
              metric={contextMetrics.contributionPerActive}
              format="gbp"
              targetFieldLabel="Group target"
              targetInputValue={defaultInputs.contributionPerActiveGbp}
              onTargetInputChange={(v) =>
                setDefaultInputs((p) => ({ ...p, contributionPerActiveGbp: v }))
              }
            />
            <PeGoalMetricCard
              title="Opportunity Progression"
              subtitle="Planned unscheduled → Scheduled / quarter"
              metric={contextMetrics.opportunityProgression}
              format="gbp"
              targetFieldLabel="Quarterly target"
              actualColumnLabel="This qtr"
              targetInputValue={defaultInputs.opportunityProgressionGbp}
              onTargetInputChange={(v) =>
                setDefaultInputs((p) => ({ ...p, opportunityProgressionGbp: v }))
              }
            />
            <PeGoalMetricCard
              title="Attrition ceiling"
              subtitle="Max annual patient loss"
              metric={contextMetrics.attritionCeiling}
              format="pctCeiling"
              targetFieldLabel="Ceiling"
              targetInputValue={defaultInputs.attritionCeilingPct}
              onTargetInputChange={(v) =>
                setDefaultInputs((p) => ({ ...p, attritionCeilingPct: v }))
              }
              targetSuffix="%"
              footerHint={attritionFooter}
            />
          </div>

          {!data.hasData && (
            <p className="text-sm text-muted-foreground">
              No PE metrics yet — set targets now; actuals populate after sync and ledger backfill.
            </p>
          )}

          <PeSectionLabel>Per-{rollupUnitLabel} goal overrides</PeSectionLabel>

          <div className="rounded-[14px] border border-border bg-card shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
              <div>
                <h3 className="text-[15px] font-bold tracking-tight text-foreground">
                  Targets by {rollupUnitLabel}
                </h3>
                <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                  Blank inherits the group target
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                className="h-8 gap-1.5"
                disabled={saveMutation.isPending || !organizationId}
                onClick={() =>
                  saveMutation.mutate({
                    defaultInputs,
                    overrideInputs,
                    overrideSnapshot,
                    rows: practiceRows,
                  })
                }
              >
                {saveMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5" />
                )}
                Save targets
              </Button>
            </div>

            {saveSuccessMessage && (
              <div
                className="mx-5 mt-4 flex items-start gap-2 rounded-[10px] border border-success/30 bg-success-muted px-3 py-2.5 text-sm text-success-strong"
                role="status"
              >
                <Check className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{saveSuccessMessage}</span>
              </div>
            )}

            {practiceRows.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-muted-foreground">
                No {rollupUnitLabelPlural} in scope for your account.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] border-collapse text-[13px] text-left">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="px-5 py-[11px] text-[12px] font-semibold text-muted-foreground">
                        {rollupUnitLabel === 'location' ? 'Location' : 'Practice'}
                      </th>
                      <th className="px-3 py-[11px] text-[12px] font-semibold text-muted-foreground">
                        Commit rate %
                      </th>
                      <th className="px-3 py-[11px] text-[12px] font-semibold text-muted-foreground">
                        Contribution/pt
                      </th>
                      <th className="px-3 py-[11px] text-[12px] font-semibold text-muted-foreground">
                        Opp. conversion
                      </th>
                      <th className="px-3 py-[11px] text-[12px] font-semibold text-muted-foreground">
                        Attrition ceiling %
                      </th>
                      <th className="min-w-[150px] px-5 py-[11px] text-[12px] font-semibold text-muted-foreground">
                        Progress
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {practiceRows.map((row) => {
                      const inputs = overrideInputs[row.practiceId] ?? emptyGoalTargetInputs();
                      const effectiveInputs =
                        effectiveOverrideInputs[row.practiceId] ?? emptyGoalTargetInputs();
                      const progressPct = computePracticeGoalProgressPct(
                        row,
                        defaultInputs,
                        effectiveInputs,
                      );
                      const barPct =
                        progressPct != null ? Math.min(Math.max(progressPct, 0), 100) : 0;

                      return (
                        <tr
                          key={row.practiceId}
                          className="border-b border-border/60 last:border-b-0 hover:bg-primary/[0.04]"
                        >
                          <td className="px-5 py-3 font-semibold text-foreground">
                            {row.practiceName}
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              className="h-8 w-[70px] text-xs"
                              value={inputs.commitmentRatePct}
                              onChange={(e) =>
                                updateOverride(row.practiceId, 'commitmentRatePct', e.target.value)
                              }
                              placeholder="inherit"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              className="h-8 w-[80px] text-xs"
                              value={inputs.contributionPerActiveGbp}
                              onChange={(e) =>
                                updateOverride(
                                  row.practiceId,
                                  'contributionPerActiveGbp',
                                  e.target.value,
                                )
                              }
                              placeholder="inherit"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              className="h-8 w-[76px] text-xs"
                              value={inputs.opportunityProgressionGbp}
                              onChange={(e) =>
                                updateOverride(
                                  row.practiceId,
                                  'opportunityProgressionGbp',
                                  e.target.value,
                                )
                              }
                              placeholder="inherit"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              className="h-8 w-[76px] text-xs"
                              value={inputs.attritionCeilingPct}
                              onChange={(e) =>
                                updateOverride(row.practiceId, 'attritionCeilingPct', e.target.value)
                              }
                              placeholder="inherit"
                            />
                          </td>
                          <td className="px-5 py-3">
                            {progressPct != null ? (
                              <div className="flex items-center gap-2">
                                <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted/80">
                                  <div
                                    className={cn(
                                      'h-full rounded-full transition-all',
                                      goalProgressBarClass(progressPct),
                                    )}
                                    style={{ width: `${barPct}%` }}
                                  />
                                </div>
                                <span className="text-[11.5px] font-bold tabular-nums text-muted-foreground">
                                  {progressPct}%
                                </span>
                              </div>
                            ) : (
                              <span className="text-[12px] text-muted-foreground">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
