/**
 * Goal Settings — group defaults vs per-location overrides with remainder split.
 *
 * Table inputs store explicit overrides only (blank = inherit).
 * Sidebars (progress bars + metric cards) use resolveEffectiveGoalInputs.
 */

export type GoalTargetInputs = {
  commitmentRatePct: string;
  contributionPerActiveGbp: string;
  opportunityProgressionGbp: string;
  attritionCeilingPct: string;
};

export type GoalTargetField = keyof GoalTargetInputs;

export const GOAL_TARGET_FIELDS: GoalTargetField[] = [
  'commitmentRatePct',
  'contributionPerActiveGbp',
  'opportunityProgressionGbp',
  'attritionCeilingPct',
];

type FieldMode = 'copyGroup' | 'remainderPool';

const FIELD_MODE: Record<GoalTargetField, FieldMode> = {
  commitmentRatePct: 'copyGroup',
  contributionPerActiveGbp: 'copyGroup',
  opportunityProgressionGbp: 'remainderPool',
  attritionCeilingPct: 'copyGroup',
};

export function emptyGoalTargetInputs(): GoalTargetInputs {
  return {
    commitmentRatePct: '',
    contributionPerActiveGbp: '',
    opportunityProgressionGbp: '',
    attritionCeilingPct: '',
  };
}

export function parseGoalTargetNumber(raw: string): number | null {
  const t = raw.trim().replace(/[£,%]/g, '');
  if (!t) return null;
  const normalized = t.toLowerCase().endsWith('k') ? Number(t.slice(0, -1)) * 1000 : Number(t);
  if (!Number.isFinite(normalized)) return null;
  return normalized;
}

function formatFieldValue(field: GoalTargetField, n: number): string {
  if (!Number.isFinite(n) || n < 0) return '';
  const rounded =
    field === 'opportunityProgressionGbp' ? Math.round(n) : Math.round(n * 100) / 100;
  if (Number.isInteger(rounded)) return String(rounded);
  return String(rounded);
}

function fieldRaw(
  overrideInputs: Record<string, GoalTargetInputs>,
  practiceId: string,
  field: GoalTargetField,
): string {
  return overrideInputs[practiceId]?.[field] ?? '';
}

export function isFieldBlank(
  overrideInputs: Record<string, GoalTargetInputs>,
  practiceId: string,
  field: GoalTargetField,
): boolean {
  return fieldRaw(overrideInputs, practiceId, field).trim() === '';
}

export function isPracticeRowConfigured(
  overrideInputs: Record<string, GoalTargetInputs>,
  practiceId: string,
): boolean {
  return GOAL_TARGET_FIELDS.some((field) => !isFieldBlank(overrideInputs, practiceId, field));
}

/** Effective goal per practice for sidebars (inherited / split values). */
export function resolveEffectiveGoalInputs(
  defaultInputs: GoalTargetInputs,
  overrideInputs: Record<string, GoalTargetInputs>,
  practiceIds: string[],
): Record<string, GoalTargetInputs> {
  const result: Record<string, GoalTargetInputs> = {};

  for (const practiceId of practiceIds) {
    result[practiceId] = { ...emptyGoalTargetInputs() };
  }

  for (const field of GOAL_TARGET_FIELDS) {
    const mode = FIELD_MODE[field];
    const group = parseGoalTargetNumber(defaultInputs[field]);
    const blankIds: string[] = [];
    const explicit: Record<string, number> = {};

    for (const practiceId of practiceIds) {
      const raw = fieldRaw(overrideInputs, practiceId, field);
      if (raw.trim() === '') {
        blankIds.push(practiceId);
      } else {
        const n = parseGoalTargetNumber(raw);
        if (n != null) explicit[practiceId] = n;
      }
    }

    const explicitSum = Object.values(explicit).reduce((sum, n) => sum + n, 0);

    for (const practiceId of practiceIds) {
      const raw = fieldRaw(overrideInputs, practiceId, field);
      if (raw.trim() !== '') {
        result[practiceId][field] = raw;
        continue;
      }

      if (group == null) {
        result[practiceId][field] = '';
        continue;
      }

      if (mode === 'copyGroup') {
        result[practiceId][field] = formatFieldValue(field, group);
        continue;
      }

      const poolRemainder = Math.max(0, group - explicitSum);
      if (blankIds.length === 1 && blankIds[0] === practiceId) {
        result[practiceId][field] = formatFieldValue(field, poolRemainder);
      } else if (blankIds.length > 0) {
        result[practiceId][field] = formatFieldValue(field, poolRemainder / blankIds.length);
      } else {
        result[practiceId][field] = '';
      }
    }
  }

  return result;
}

/** When n−1 locations have an explicit value for one field, fill the last blank input. */
export function applyFieldRemainderFill(
  defaultInputs: GoalTargetInputs,
  overrideInputs: Record<string, GoalTargetInputs>,
  practiceIds: string[],
  field: GoalTargetField,
): Record<string, GoalTargetInputs> {
  if (practiceIds.length < 2) return overrideInputs;

  const blankIds = practiceIds.filter((id) => isFieldBlank(overrideInputs, id, field));
  if (blankIds.length !== 1) return overrideInputs;

  const explicitCount = practiceIds.length - blankIds.length;
  if (explicitCount !== practiceIds.length - 1) return overrideInputs;

  const lastId = blankIds[0];
  const effective = resolveEffectiveGoalInputs(defaultInputs, overrideInputs, practiceIds);

  return {
    ...overrideInputs,
    [lastId]: {
      ...(overrideInputs[lastId] ?? emptyGoalTargetInputs()),
      [field]: effective[lastId][field],
    },
  };
}

/** When n−1 rows have any field set, auto-fill the last empty row (inputs + sidebar). */
export function applyLastRowAutoFill(
  defaultInputs: GoalTargetInputs,
  overrideInputs: Record<string, GoalTargetInputs>,
  practiceIds: string[],
): Record<string, GoalTargetInputs> {
  if (practiceIds.length < 2) return overrideInputs;

  const unconfigured = practiceIds.filter((id) => !isPracticeRowConfigured(overrideInputs, id));
  const configuredCount = practiceIds.length - unconfigured.length;

  if (unconfigured.length !== 1 || configuredCount !== practiceIds.length - 1) {
    return overrideInputs;
  }

  const lastId = unconfigured[0];
  const effective = resolveEffectiveGoalInputs(defaultInputs, overrideInputs, practiceIds);

  return {
    ...overrideInputs,
    [lastId]: {
      ...(overrideInputs[lastId] ?? emptyGoalTargetInputs()),
      ...effective[lastId],
    },
  };
}

/** Whether this row should be included in the save payload. */
export function shouldSaveOverrideRow(
  inputs: GoalTargetInputs,
  snapshot: GoalTargetInputs,
): boolean {
  const hasTableInput = GOAL_TARGET_FIELDS.some((field) => inputs[field].trim() !== '');
  const hadSavedOverride = GOAL_TARGET_FIELDS.some((field) => snapshot[field]?.trim() !== '');
  return hasTableInput || hadSavedOverride;
}

/** Full override row for save — blank table cells = inherit group (null in DB). */
export function buildRowOverrideTargets(inputs: GoalTargetInputs): {
  commitmentRatePct: number | null;
  contributionPerActiveGbp: number | null;
  opportunityProgressionGbp: number | null;
  attritionCeilingPct: number | null;
} {
  const parseField = (raw: string): number | null => {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    return parseGoalTargetNumber(trimmed);
  };

  return {
    commitmentRatePct: parseField(inputs.commitmentRatePct),
    contributionPerActiveGbp: parseField(inputs.contributionPerActiveGbp),
    opportunityProgressionGbp: parseField(inputs.opportunityProgressionGbp),
    attritionCeilingPct: parseField(inputs.attritionCeilingPct),
  };
}

/** @deprecated Use shouldSaveOverrideRow + buildRowOverrideTargets */
export function buildExplicitOverridePayload(
  inputs: GoalTargetInputs,
  snapshot: GoalTargetInputs,
): Partial<{
  commitmentRatePct: number | null;
  contributionPerActiveGbp: number | null;
  opportunityProgressionGbp: number | null;
  attritionCeilingPct: number | null;
}> {
  const out: Partial<{
    commitmentRatePct: number | null;
    contributionPerActiveGbp: number | null;
    opportunityProgressionGbp: number | null;
    attritionCeilingPct: number | null;
  }> = {};

  for (const field of GOAL_TARGET_FIELDS) {
    const raw = inputs[field].trim();
    const snap = snapshot[field]?.trim() ?? '';
    const parsed = raw ? parseGoalTargetNumber(raw) : null;
    if (raw && parsed != null) {
      out[field] = parsed;
    } else if (raw && parsed == null) {
      // Non-empty but unparseable — skip (do not wipe saved value).
    } else if (snap) {
      out[field] = null;
    }
  }

  return out;
}

export function overridePayloadHasChanges(
  payload: Partial<{
    commitmentRatePct: number | null;
    contributionPerActiveGbp: number | null;
    opportunityProgressionGbp: number | null;
    attritionCeilingPct: number | null;
  }>,
): boolean {
  return GOAL_TARGET_FIELDS.some((field) => field in payload);
}
