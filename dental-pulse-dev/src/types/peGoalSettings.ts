/**
 * PE Goal Settings — types aligned with GET /read/goal-settings API.
 */

export type PeGoalTargets = {
  commitmentRatePct: number | null;
  contributionPerActiveGbp: number | null;
  opportunityProgressionGbp: number | null;
  attritionCeilingPct: number | null;
};

export type PeGoalMetricRollup = {
  actual: number | null;
  target: number | null;
  progressPct: number | null;
  onTrack: boolean | null;
};

export type PeGoalPracticeActuals = {
  commitmentRate30d: number | null;
  contributionPerActiveGbp: number | null;
  opportunityProgressionGbp: number | null;
  attritionPct: number | null;
};

export type PeGoalPracticeRow = {
  practiceId: string;
  practiceName: string;
  unitType?: 'location' | 'practice';
  organizationId?: string;
  override: PeGoalTargets | null;
  targets: PeGoalTargets;
  actuals: PeGoalPracticeActuals;
  metrics: {
    commitmentRate: PeGoalMetricRollup;
    contributionPerActive: PeGoalMetricRollup;
    opportunityProgression: PeGoalMetricRollup;
    attritionCeiling: PeGoalMetricRollup;
  };
};

export type PeGoalSettingsSummary = {
  contextPracticeId: string;
  rollupMode?: 'location' | 'practice';
  commitmentWindowDays: number;
  quarterStart: string;
  defaults: PeGoalTargets;
  contextMetrics: PeGoalPracticeRow['metrics'] | null;
  practices: PeGoalPracticeRow[];
  hasData: boolean;
};

export type SavePeGoalSettingsPayload = {
  contextPracticeId: string;
  defaults: PeGoalTargets;
  practiceOverrides: Array<PeGoalTargets & { practiceId: string }>;
};
