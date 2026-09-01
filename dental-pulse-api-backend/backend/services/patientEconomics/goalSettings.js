/**
 * PE Goal Settings — group defaults, per-practice overrides, actual vs target rollups.
 */

const { supabaseAdmin } = require('../../config/supabase');
const { resolvePeRollupUnits } = require('./peRollupUnits');
const { loadPatientUuidsForLocation } = require('./peLocationScope');
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

async function loadLocationOverrides(locationIds) {
  const map = new Map();
  if (locationIds.length === 0) return map;

  const { data, error } = await supabaseAdmin
    .from('pe_goal_location_overrides')
    .select(
      'location_id, target_commitment_rate_pct, target_contribution_per_active_gbp, target_opportunity_progression_gbp, target_attrition_ceiling_pct',
    )
    .in('location_id', locationIds);

  if (error) {
    if (error.code === '42P01') return map;
    throw new Error(`pe_goal_location_overrides: ${error.message}`);
  }

  for (const row of data ?? []) {
    map.set(String(row.location_id), row);
  }
  return map;
}

async function loadPatientRetentionRows(practiceId) {
  const rows = [];
  let offset = 0;

  for (let i = 0; i < 100; i++) {
    const { data, error } = await supabaseAdmin
      .from('v_patient_contribution')
      .select('patient_id, retention_status')
      .eq('practice_id', practiceId)
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw new Error(`v_patient_contribution: ${error.message}`);
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return rows;
}

function scopeRetentionRows(rows, patientUuids) {
  if (!patientUuids) return rows;
  const set = new Set(patientUuids);
  return rows.filter((r) => set.has(String(r.patient_id)));
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

async function computeContributionPerActiveGbp(practiceId, retentionRows) {
  const since = twelveMonthsAgoIsoDate();

  const activeIds = retentionRows
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

async function computeAttritionPct(retentionRows) {
  let total = 0;
  let atRisk = 0;

  for (const row of retentionRows) {
    total += 1;
    const status = String(row.retention_status || '').toLowerCase();
    if (status === 'lapsed' || status === 'effectively_lost') {
      atRisk += 1;
    }
  }

  if (total === 0) return null;
  return roundPct(atRisk / total);
}

async function computePracticeActuals(practiceId, retentionRows) {
  const [commitment, contributionPerActiveGbp, opportunityProgressionGbp, attritionPct] =
    await Promise.all([
      computeCommitmentRate30d(practiceId),
      computeContributionPerActiveGbp(practiceId, retentionRows),
      computeOpportunityProgressionGbp(practiceId),
      computeAttritionPct(retentionRows),
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

function buildPracticeRow(
  practiceId,
  practiceName,
  defaults,
  overrideRow,
  actuals,
  unitType = 'practice',
  organizationId = practiceId,
) {
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
    unitType,
    organizationId,
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
  const { rollupMode, organizationIds, units } = await resolvePeRollupUnits(
    userId,
    contextPracticeId,
  );

  const [defaultsRow, overrides] = await Promise.all([
    loadGoalDefaults(contextPracticeId),
    loadPracticeOverrides(organizationIds),
  ]);

  const locationIds = units
    .filter((unit) => unit.unitType === 'location')
    .map((unit) => unit.unitId);
  const locationOverrides = await loadLocationOverrides(locationIds);

  const defaults = mapDefaultsRow(defaultsRow);

  const retentionRowsByOrg = new Map();
  for (const orgId of organizationIds) {
    if (!retentionRowsByOrg.has(orgId)) {
      retentionRowsByOrg.set(orgId, await loadPatientRetentionRows(orgId));
    }
  }

  const practices = await Promise.all(
    units.map(async (unit) => {
      const orgRows = retentionRowsByOrg.get(unit.organizationId) ?? [];
      let scopedRows = orgRows;
      if (unit.locationId) {
        const patientUuids = await loadPatientUuidsForLocation(
          unit.organizationId,
          unit.locationId,
        );
        if (patientUuids.length === 0) {
          scopedRows = [];
        } else {
          scopedRows = scopeRetentionRows(orgRows, patientUuids);
        }
      }
      const actuals = await computePracticeActuals(unit.organizationId, scopedRows);
      const overrideRow =
        unit.unitType === 'location'
          ? locationOverrides.get(unit.unitId)
          : overrides.get(unit.organizationId);
      return buildPracticeRow(
        unit.unitId,
        unit.unitName,
        defaults,
        overrideRow,
        actuals,
        unit.unitType,
        unit.organizationId,
      );
    }),
  );

  practices.sort((a, b) => a.practiceName.localeCompare(b.practiceName));

  const contextRow =
    practices.find((p) => p.practiceId === contextPracticeId) ??
    practices.find((p) => p.organizationId === contextPracticeId) ??
    practices[0] ??
    null;

  const contextAssumptions = await loadPeEconomicAssumptions(contextPracticeId);

  return {
    contextPracticeId,
    rollupMode,
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

function normalizeOverrideTargets(incoming, existing) {
  const keys = [
    'commitmentRatePct',
    'contributionPerActiveGbp',
    'opportunityProgressionGbp',
    'attritionCeilingPct',
  ];
  const allKeysPresent = keys.every((key) => Object.prototype.hasOwnProperty.call(incoming, key));

  if (allKeysPresent) {
    return {
      commitmentRatePct: parseOptionalPct(incoming.commitmentRatePct),
      contributionPerActiveGbp: parseOptionalGbp(incoming.contributionPerActiveGbp),
      opportunityProgressionGbp: parseOptionalGbp(incoming.opportunityProgressionGbp),
      attritionCeilingPct: parseOptionalPct(incoming.attritionCeilingPct),
    };
  }

  return mergeOverrideTargets(existing, incoming);
}

function mergeOverrideTargets(existing, incoming) {
  const fields = [
    { key: 'commitmentRatePct', parse: parseOptionalPct },
    { key: 'contributionPerActiveGbp', parse: parseOptionalGbp },
    { key: 'opportunityProgressionGbp', parse: parseOptionalGbp },
    { key: 'attritionCeilingPct', parse: parseOptionalPct },
  ];

  const merged = {};
  for (const { key, parse } of fields) {
    if (Object.prototype.hasOwnProperty.call(incoming, key)) {
      merged[key] = parse(incoming[key]);
    } else if (existing?.[key] != null && Number.isFinite(Number(existing[key]))) {
      merged[key] = Number(existing[key]);
    } else {
      merged[key] = null;
    }
  }
  return merged;
}

async function upsertPracticeOverride(practiceId, targets, userId) {
  const { practiceId: _ignored, ...targetFields } = targets;
  const existingMap = await loadPracticeOverrides([practiceId]);
  const existing = mapOverrideRow(existingMap.get(practiceId));
  const merged = normalizeOverrideTargets(targetFields, existing);

  const allNull =
    merged.commitmentRatePct == null &&
    merged.contributionPerActiveGbp == null &&
    merged.opportunityProgressionGbp == null &&
    merged.attritionCeilingPct == null;

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
    target_commitment_rate_pct: parseOptionalPct(merged.commitmentRatePct),
    target_contribution_per_active_gbp: parseOptionalGbp(merged.contributionPerActiveGbp),
    target_opportunity_progression_gbp: parseOptionalGbp(merged.opportunityProgressionGbp),
    target_attrition_ceiling_pct: parseOptionalPct(merged.attritionCeilingPct),
    updated_at: new Date().toISOString(),
    updated_by: userId,
  };

  const { error } = await supabaseAdmin.from('pe_goal_practice_overrides').upsert(row, {
    onConflict: 'practice_id',
  });

  if (error) throw new Error(`pe_goal_practice_overrides upsert: ${error.message}`);
}

async function upsertLocationOverride(locationId, targets, userId) {
  const { practiceId: _ignored, ...targetFields } = targets;
  const existingMap = await loadLocationOverrides([locationId]);
  const existing = mapOverrideRow(existingMap.get(locationId));
  const merged = normalizeOverrideTargets(targetFields, existing);

  const allNull =
    merged.commitmentRatePct == null &&
    merged.contributionPerActiveGbp == null &&
    merged.opportunityProgressionGbp == null &&
    merged.attritionCeilingPct == null;

  if (allNull) {
    const { error } = await supabaseAdmin
      .from('pe_goal_location_overrides')
      .delete()
      .eq('location_id', locationId);
    if (error && error.code !== '42P01') {
      throw new Error(`pe_goal_location_overrides delete: ${error.message}`);
    }
    return;
  }

  const row = {
    location_id: locationId,
    target_commitment_rate_pct: parseOptionalPct(merged.commitmentRatePct),
    target_contribution_per_active_gbp: parseOptionalGbp(merged.contributionPerActiveGbp),
    target_opportunity_progression_gbp: parseOptionalGbp(merged.opportunityProgressionGbp),
    target_attrition_ceiling_pct: parseOptionalPct(merged.attritionCeilingPct),
    updated_at: new Date().toISOString(),
    updated_by: userId,
  };

  const { error } = await supabaseAdmin.from('pe_goal_location_overrides').upsert(row, {
    onConflict: 'location_id',
  });

  if (error) {
    if (error.code === '42P01') return;
    throw new Error(`pe_goal_location_overrides upsert: ${error.message}`);
  }
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

  const { units } = await resolvePeRollupUnits(userId, contextPracticeId);
  const locationIds = new Set(
    units.filter((unit) => unit.unitType === 'location').map((unit) => unit.unitId),
  );

  for (const row of overrides) {
    const practiceId = row?.practiceId;
    if (!practiceId || typeof practiceId !== 'string') continue;
    if (locationIds.has(practiceId)) {
      await upsertLocationOverride(practiceId, row, userId);
    } else {
      await upsertPracticeOverride(practiceId, row, userId);
    }
  }

  return getGoalSettingsSummary(userId, contextPracticeId);
}

module.exports = {
  getGoalSettingsSummary,
  saveGoalSettings,
};
