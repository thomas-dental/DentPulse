/**
 * PE Goal Settings — group defaults, per-practice overrides, actual vs target rollups.
 */

const { supabaseAdmin } = require('../../config/supabase');
const {
  aggregatePlansFromLedger,
  computePracticeCommitmentRate,
} = require('./commitmentRateLogic');
const {
  loadLedgerPlanEvents,
  loadEligiblePlanItems,
} = require('./commitmentRate');
const { loadPeEconomicAssumptions } = require('./peEconomicAssumptions');

const PAGE_SIZE = 1000;

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function roundPct(rate) {
  if (!Number.isFinite(rate)) return null;
  return Math.round(rate * 1000) / 1000;
}

function parseOptionalPct(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return round2(n);
}

function parseOptionalGbp(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return round2(n);
}

function effectiveTarget(defaults, override, key) {
  const o = override?.[key];
  if (o != null && Number.isFinite(Number(o))) return Number(o);
  const d = defaults?.[key];
  if (d != null && Number.isFinite(Number(d))) return Number(d);
  return null;
}

function progressPct(actual, target, higherIsBetter = true) {
  if (target == null || target <= 0 || actual == null) return null;
  if (higherIsBetter) return roundPct(actual / target);
  return roundPct(target / actual);
}

function onTrackStatus(actual, target, higherIsBetter = true) {
  if (actual == null || target == null) return null;
  if (higherIsBetter) return actual >= target;
  return actual <= target;
}

function currentQuarterStartYmd() {
  const d = new Date();
  const qStartMonth = Math.floor(d.getUTCMonth() / 3) * 3;
  return new Date(Date.UTC(d.getUTCFullYear(), qStartMonth, 1)).toISOString().slice(0, 10);
}

function twelveMonthsAgoIsoDate() {
  const d = new Date();
  d.setMonth(d.getMonth() - 12);
  return d.toISOString().slice(0, 10);
}

async function loadUserPracticeIds(userId) {
  const { data, error } = await supabaseAdmin
    .from('user_roles')
    .select('organization_id')
    .eq('user_id', userId);

  if (error) throw new Error(`user_roles: ${error.message}`);

  return [
    ...new Set(
      (data ?? [])
        .map((r) => r.organization_id)
        .filter((id) => typeof id === 'string' && id.length > 0),
    ),
  ];
}

async function loadPracticeNames(practiceIds) {
  const map = new Map();
  if (practiceIds.length === 0) return map;

  const { data, error } = await supabaseAdmin
    .from('organizations')
    .select('id, name')
    .in('id', practiceIds);

  if (error) throw new Error(`organizations: ${error.message}`);

  for (const row of data ?? []) {
    map.set(String(row.id), String(row.name || 'Practice').trim() || 'Practice');
  }
  return map;
}

async function loadGoalDefaults(organizationId) {
  const { data, error } = await supabaseAdmin
    .from('pe_goal_defaults')
    .select(
      'target_commitment_rate_pct, target_contribution_per_active_gbp, target_opportunity_progression_gbp, target_attrition_ceiling_pct',
    )
    .eq('organization_id', organizationId)
    .maybeSingle();

  if (error && !String(error.message || '').includes('pe_goal_defaults')) {
    throw new Error(`pe_goal_defaults: ${error.message}`);
  }

  return data ?? null;
}

async function loadPracticeOverrides(practiceIds) {
  const map = new Map();
  if (practiceIds.length === 0) return map;

  const { data, error } = await supabaseAdmin
    .from('pe_goal_practice_overrides')
    .select(
      'practice_id, target_commitment_rate_pct, target_contribution_per_active_gbp, target_opportunity_progression_gbp, target_attrition_ceiling_pct',
    )
    .in('practice_id', practiceIds);

  if (error) throw new Error(`pe_goal_practice_overrides: ${error.message}`);

  for (const row of data ?? []) {
    map.set(String(row.practice_id), row);
  }
  return map;
}

async function computeCommitmentRate30d(practiceId) {
  const assumptions = await loadPeEconomicAssumptions(practiceId);
  const windowDays = assumptions.commitmentRateWindowDays;
  const ledgerRows = await loadLedgerPlanEvents(practiceId);
  const plans = aggregatePlansFromLedger(ledgerRows);
  const planIds = [...plans.keys()];
  const items = await loadEligiblePlanItems(practiceId, planIds);
  const result = computePracticeCommitmentRate(plans, items, windowDays);
  return { rate: roundPct(result.commitmentRate), windowDays };
}

async function computeContributionPerActiveGbp(practiceId) {
  const since = twelveMonthsAgoIsoDate();
  const patients = [];
  let offset = 0;

  for (let i = 0; i < 100; i++) {
    const { data, error } = await supabaseAdmin
      .from('v_patient_contribution')
      .select('patient_id, retention_status')
      .eq('practice_id', practiceId)
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw new Error(`v_patient_contribution: ${error.message}`);
    const batch = data ?? [];
    patients.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  const activeIds = patients
    .filter((r) => String(r.retention_status || '').toLowerCase() === 'active')
    .map((r) => String(r.patient_id));

  if (activeIds.length === 0) return null;

  let contributionSum = 0;
  for (let i = 0; i < activeIds.length; i += 300) {
    const chunk = activeIds.slice(i, i + 300);
    const { data, error } = await supabaseAdmin
      .from('v_invoice_contribution')
      .select('contribution')
      .eq('practice_id', practiceId)
      .gte('invoice_date', since)
      .in('patient_id', chunk);

    if (error) throw new Error(`v_invoice_contribution: ${error.message}`);
    for (const row of data ?? []) {
      contributionSum += num(row.contribution);
    }
  }

  return round2(contributionSum / activeIds.length);
}

async function computeOpportunityProgressionGbp(practiceId) {
  const quarterStart = currentQuarterStartYmd();
  let offset = 0;
  let total = 0;

  for (let page = 0; page < 200; page++) {
    const { data, error } = await supabaseAdmin
      .from('event_ledger')
      .select('payload, created_at')
      .eq('practice_id', practiceId)
      .eq('event_type', 'APPOINTMENT_LINKED')
      .gte('created_at', `${quarterStart}T00:00:00.000Z`)
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw new Error(`event_ledger: ${error.message}`);

    const batch = data ?? [];
    for (const row of batch) {
      const payload = row.payload || {};
      for (const key of ['planned_value', 'tp_private_treatment_value', 'value', 'amount', 'total']) {
        const raw = payload[key];
        if (raw == null || raw === '') continue;
        const n = num(raw);
        if (n > 0) {
          total += n;
          break;
        }
      }
    }

    if (batch.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return round2(total);
}

async function computeAttritionPct(practiceId) {
  let offset = 0;
  let total = 0;
  let atRisk = 0;

  for (let i = 0; i < 100; i++) {
    const { data, error } = await supabaseAdmin
      .from('v_patient_contribution')
      .select('retention_status')
      .eq('practice_id', practiceId)
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw new Error(`v_patient_contribution: ${error.message}`);
    const batch = data ?? [];
    for (const row of batch) {
      total += 1;
      const status = String(row.retention_status || '').toLowerCase();
      if (status === 'lapsed' || status === 'effectively_lost') {
        atRisk += 1;
      }
    }
    if (batch.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  if (total === 0) return null;
  return roundPct(atRisk / total);
}

async function computePracticeActuals(practiceId) {
  const [commitment, contributionPerActiveGbp, opportunityProgressionGbp, attritionPct] =
    await Promise.all([
      computeCommitmentRate30d(practiceId),
      computeContributionPerActiveGbp(practiceId),
      computeOpportunityProgressionGbp(practiceId),
      computeAttritionPct(practiceId),
    ]);

  return {
    commitmentRate30d: commitment.rate,
    commitmentWindowDays: commitment.windowDays,
    contributionPerActiveGbp,
    opportunityProgressionGbp,
    attritionPct,
  };
}

function mapDefaultsRow(row) {
  if (!row) {
    return {
      commitmentRatePct: null,
      contributionPerActiveGbp: null,
      opportunityProgressionGbp: null,
      attritionCeilingPct: null,
    };
  }
  return {
    commitmentRatePct:
      row.target_commitment_rate_pct != null ? num(row.target_commitment_rate_pct) : null,
    contributionPerActiveGbp:
      row.target_contribution_per_active_gbp != null
        ? num(row.target_contribution_per_active_gbp)
        : null,
    opportunityProgressionGbp:
      row.target_opportunity_progression_gbp != null
        ? num(row.target_opportunity_progression_gbp)
        : null,
    attritionCeilingPct:
      row.target_attrition_ceiling_pct != null ? num(row.target_attrition_ceiling_pct) : null,
  };
}

function mapOverrideRow(row) {
  if (!row) return null;
  return {
    commitmentRatePct:
      row.target_commitment_rate_pct != null ? num(row.target_commitment_rate_pct) : null,
    contributionPerActiveGbp:
      row.target_contribution_per_active_gbp != null
        ? num(row.target_contribution_per_active_gbp)
        : null,
    opportunityProgressionGbp:
      row.target_opportunity_progression_gbp != null
        ? num(row.target_opportunity_progression_gbp)
        : null,
    attritionCeilingPct:
      row.target_attrition_ceiling_pct != null ? num(row.target_attrition_ceiling_pct) : null,
  };
}

function buildMetricRollup(actual, target, higherIsBetter = true) {
  const progress = progressPct(actual, target, higherIsBetter);
  return {
    actual,
    target,
    progressPct: progress != null ? Math.min(progress, 1.5) : null,
    onTrack: onTrackStatus(actual, target, higherIsBetter),
  };
}

function buildPracticeRow(practiceId, practiceName, defaults, overrideRow, actuals) {
  const override = mapOverrideRow(overrideRow);
  const targets = {
    commitmentRatePct: effectiveTarget(defaults, override, 'commitmentRatePct'),
    contributionPerActiveGbp: effectiveTarget(defaults, override, 'contributionPerActiveGbp'),
    opportunityProgressionGbp: effectiveTarget(defaults, override, 'opportunityProgressionGbp'),
    attritionCeilingPct: effectiveTarget(defaults, override, 'attritionCeilingPct'),
  };

  const attritionTarget =
    targets.attritionCeilingPct != null ? targets.attritionCeilingPct / 100 : null;
  const attritionActual = actuals.attritionPct;

  return {
    practiceId,
    practiceName,
    override,
    targets,
    actuals,
    metrics: {
      commitmentRate: buildMetricRollup(
        actuals.commitmentRate30d,
        targets.commitmentRatePct != null ? targets.commitmentRatePct / 100 : null,
        true,
      ),
      contributionPerActive: buildMetricRollup(
        actuals.contributionPerActiveGbp,
        targets.contributionPerActiveGbp,
        true,
      ),
      opportunityProgression: buildMetricRollup(
        actuals.opportunityProgressionGbp,
        targets.opportunityProgressionGbp,
        true,
      ),
      attritionCeiling: buildMetricRollup(attritionActual, attritionTarget, false),
    },
  };
}

/**
 * @param {string} userId
 * @param {string} contextPracticeId
 */
async function getGoalSettingsSummary(userId, contextPracticeId) {
  const practiceIds = await loadUserPracticeIds(userId);
  const scopedIds =
    practiceIds.length > 0
      ? practiceIds.includes(contextPracticeId)
        ? practiceIds
        : [...practiceIds, contextPracticeId]
      : [contextPracticeId];

  const [names, defaultsRow, overrides] = await Promise.all([
    loadPracticeNames(scopedIds),
    loadGoalDefaults(contextPracticeId),
    loadPracticeOverrides(scopedIds),
  ]);

  const defaults = mapDefaultsRow(defaultsRow);

  const practices = await Promise.all(
    scopedIds.map(async (pid) => {
      const actuals = await computePracticeActuals(pid);
      return buildPracticeRow(
        pid,
        names.get(pid) || 'Practice',
        defaults,
        overrides.get(pid),
        actuals,
      );
    }),
  );

  practices.sort((a, b) => a.practiceName.localeCompare(b.practiceName));

  const contextRow =
    practices.find((p) => p.practiceId === contextPracticeId) ?? practices[0] ?? null;

  const contextAssumptions = await loadPeEconomicAssumptions(contextPracticeId);

  return {
    contextPracticeId,
    commitmentWindowDays: contextAssumptions.commitmentRateWindowDays,
    quarterStart: currentQuarterStartYmd(),
    defaults,
    contextMetrics: contextRow?.metrics ?? null,
    practices,
    hasData: practices.some(
      (p) =>
        p.actuals.commitmentRate30d != null ||
        p.actuals.contributionPerActiveGbp != null ||
        p.actuals.opportunityProgressionGbp != null ||
        p.actuals.attritionPct != null,
    ),
  };
}

async function upsertGoalDefaults(organizationId, targets, userId) {
  const row = {
    organization_id: organizationId,
    target_commitment_rate_pct: parseOptionalPct(targets.commitmentRatePct),
    target_contribution_per_active_gbp: parseOptionalGbp(targets.contributionPerActiveGbp),
    target_opportunity_progression_gbp: parseOptionalGbp(targets.opportunityProgressionGbp),
    target_attrition_ceiling_pct: parseOptionalPct(targets.attritionCeilingPct),
    updated_at: new Date().toISOString(),
    updated_by: userId,
  };

  const { error } = await supabaseAdmin.from('pe_goal_defaults').upsert(row, {
    onConflict: 'organization_id',
  });

  if (error) throw new Error(`pe_goal_defaults upsert: ${error.message}`);
}

async function upsertPracticeOverride(practiceId, targets, userId) {
  const allNull =
    targets.commitmentRatePct == null &&
    targets.contributionPerActiveGbp == null &&
    targets.opportunityProgressionGbp == null &&
    targets.attritionCeilingPct == null;

  if (allNull) {
    const { error } = await supabaseAdmin
      .from('pe_goal_practice_overrides')
      .delete()
      .eq('practice_id', practiceId);
    if (error) throw new Error(`pe_goal_practice_overrides delete: ${error.message}`);
    return;
  }

  const row = {
    practice_id: practiceId,
    target_commitment_rate_pct: parseOptionalPct(targets.commitmentRatePct),
    target_contribution_per_active_gbp: parseOptionalGbp(targets.contributionPerActiveGbp),
    target_opportunity_progression_gbp: parseOptionalGbp(targets.opportunityProgressionGbp),
    target_attrition_ceiling_pct: parseOptionalPct(targets.attritionCeilingPct),
    updated_at: new Date().toISOString(),
    updated_by: userId,
  };

  const { error } = await supabaseAdmin.from('pe_goal_practice_overrides').upsert(row, {
    onConflict: 'practice_id',
  });

  if (error) throw new Error(`pe_goal_practice_overrides upsert: ${error.message}`);
}

/**
 * @param {string} userId
 * @param {string} contextPracticeId
 * @param {{ defaults: object, practiceOverrides: Array<{ practiceId: string, ... }> }} payload
 */
async function saveGoalSettings(userId, contextPracticeId, payload) {
  const defaults = payload?.defaults ?? {};
  const overrides = Array.isArray(payload?.practiceOverrides) ? payload.practiceOverrides : [];

  await upsertGoalDefaults(contextPracticeId, defaults, userId);

  for (const row of overrides) {
    const practiceId = row?.practiceId;
    if (!practiceId || typeof practiceId !== 'string') continue;
    await upsertPracticeOverride(practiceId, row, userId);
  }

  return getGoalSettingsSummary(userId, contextPracticeId);
}

module.exports = {
  getGoalSettingsSummary,
  saveGoalSettings,
};
