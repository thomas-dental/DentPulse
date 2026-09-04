/**
 * Reactivation flags + Recovery Loop.
 *
 * FLAG OPEN (Modelled thresholds from pe_economic_assumptions):
 *   • retention_status ∈ {drifting, lapsed, effectively_lost}
 *   • trailing contribution £ (reactivation_worklist_trailing_months)
 *     ≥ reactivation_min_contribution_at_risk_gbp
 *   • no existing open flag for (practice_id, patient_id)
 *
 * RECOVERY:
 *   • event_ledger PATIENT_REACTIVATED with created_at > flagged_at
 *   • contribution_recovered_gbp = sum invoice contribution in
 *     [reactivated_event_at, reactivated_event_at + recovery_window_days]
 *
 * READ SCOPE (TopBar):
 *   • Recovery Loop (funnel, worklist, in-progress, reactivation £) — location only
 *   • TopBar period does not filter reactivation flags (operational point-in-time)
 */

const { supabaseAdmin } = require('../../config/supabase');
const { resolvePeRollupUnits } = require('./peRollupUnits');
const { loadPeEconomicAssumptions } = require('./peEconomicAssumptions');
const { parseRetentionStatus } = require('./peRetentionSegmentation');
const { withPeReadCache } = require('./peReadCache');
const {
  annualizeTrailingContribution,
  buildRecoveryFunnel,
  resolveWorklistDaysOverdue,
} = require('./peReactivationWorklistLogic');
const { withStableOrder, DEFAULT_PAGE_SIZE } = require('./peStablePagination');

const PAGE_SIZE = DEFAULT_PAGE_SIZE;
const AT_RISK_STATUSES = new Set(['drifting', 'lapsed', 'effectively_lost']);
const DERIVED_TIER = 'Derived';
const RECOVERY_TIER_NOTE =
  'Recovery = invoice contribution £ after PATIENT_REACTIVATED within recovery window. Flag cohort from trailing contribution at flag open.';

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

function daysSinceFlagged(flaggedAt) {
  const flagged = new Date(flaggedAt);
  if (Number.isNaN(flagged.getTime())) return 0;
  const ms = Date.now() - flagged.getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

function deriveWorkflowStatus(flag) {
  if (flag.status === 'recovered') return 'recovered';
  const days = daysSinceFlagged(flag.flaggedAt);
  if (days >= 120) return 'booked';
  if (days >= 30) return 'contacted';
  return 'new';
}

function recoveredThisQuarterGbp(flagRows) {
  const quarterStart = new Date();
  quarterStart.setMonth(quarterStart.getMonth() - 3);
  return round2(
    flagRows
      .filter((f) => {
        if (f.status !== 'recovered' || !f.recoveredAt) return false;
        const t = new Date(f.recoveredAt);
        return !Number.isNaN(t.getTime()) && t >= quarterStart;
      })
      .reduce((s, f) => s + num(f.contributionRecoveredGbp), 0),
  );
}

function buildOpenWorklist(flagRows, worklistMeta) {
  return flagRows
    .filter((f) => f.status === 'open')
    .map((f) => {
      const meta = worklistMeta.get(f.patientId) ?? {};
      const lastVisitAt = meta.lastVisitAt ?? null;
      const daysOverdue = resolveWorklistDaysOverdue(
        lastVisitAt,
        meta.dentistRecallDate,
        meta.hygienistRecallDate,
      );
      const workflowStatus = deriveWorkflowStatus(f);
      return {
        ...f,
        daysSinceFlagged: daysSinceFlagged(f.flaggedAt),
        lastVisitAt,
        daysOverdue,
        histContributionYr: annualizeTrailingContribution(
          f.contributionAtRiskAtFlagTime,
          f.trailingMonths,
        ),
        ownerName: null,
        workflowStatus,
      };
    })
    .sort((a, b) => b.contributionAtRiskAtFlagTime - a.contributionAtRiskAtFlagTime);
}

function trailingSinceIsoDate(months) {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
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

async function fetchTrailingContributionByPatient(practiceId, trailingMonths) {
  const { forEachInvoiceGrainPage } = require('./peReadSource');
  const map = new Map();
  const since = trailingSinceIsoDate(trailingMonths);

  await forEachInvoiceGrainPage(
    practiceId,
    {
      select: 'patient_id, contribution',
      applyFilters: (query) => query.gte('invoice_date', since),
      maxPages: 100,
    },
    async (batch) => {
      for (const row of batch) {
        if (row.patient_id == null) continue;
        const pid = String(row.patient_id);
        map.set(pid, (map.get(pid) ?? 0) + num(row.contribution));
      }
    },
  );

  return map;
}

async function loadOpenFlags(practiceId) {
  const { data, error } = await supabaseAdmin
    .from('pe_reactivation_flags')
    .select('*')
    .eq('practice_id', practiceId)
    .eq('status', 'open');

  if (error) {
    if (error.code === '42P01') return [];
    throw new Error(`pe_reactivation_flags open: ${error.message}`);
  }
  return data ?? [];
}

async function evaluateReactivationRecoveryForPractice(practiceId) {
  const { data, error } = await supabaseAdmin.rpc('pe_evaluate_reactivation_recovery', {
    p_practice_id: practiceId,
  });

  if (error) {
    throw new Error(`pe_evaluate_reactivation_recovery: ${error.message}`);
  }

  const payload = data && typeof data === 'object' ? data : {};
  return num(payload.recovered);
}

async function openFlagsForPractice(practiceId) {
  const assumptions = await loadPeEconomicAssumptions(practiceId);
  const trailingMonths = assumptions.reactivationWorklistTrailingMonths || 12;
  const minGbp = assumptions.reactivationMinContributionAtRiskGbp || 100;
  const recoveryWindowDays = assumptions.reactivationRecoveryContributionWindowDays || 365;

  const [trailingByPatient, openFlags, atRiskPatients] = await Promise.all([
    fetchTrailingContributionByPatient(practiceId, trailingMonths),
    loadOpenFlags(practiceId),
    loadAtRiskPatients(practiceId),
  ]);

  const openPatientIds = new Set(openFlags.map((f) => String(f.patient_id)));
  let opened = 0;

  for (const patient of atRiskPatients) {
    const patientId = String(patient.patient_id);
    if (openPatientIds.has(patientId)) continue;

    const trailing = round2(trailingByPatient.get(patientId) ?? 0);
    if (trailing < minGbp) continue;

    const segment = parseRetentionStatus(patient.retention_status);
    if (!AT_RISK_STATUSES.has(segment)) continue;

    const { error } = await supabaseAdmin.from('pe_reactivation_flags').insert({
      practice_id: practiceId,
      patient_id: patientId,
      segment_at_flag_time: segment,
      contribution_at_risk_at_flag_time: trailing,
      lifetime_contribution_at_flag: trailing,
      trailing_months: trailingMonths,
      recovery_window_days: recoveryWindowDays,
      min_contribution_threshold_gbp: minGbp,
      flagged_at: new Date().toISOString(),
      status: 'open',
    });

    if (error) {
      const msg = String(error.message || '');
      if (
        msg.includes('ux_pe_reactivation_flags_open_patient') ||
        msg.includes('pe_reactivation_flags_one_open_per_patient')
      ) {
        continue;
      }
      throw new Error(`pe_reactivation_flags insert: ${error.message}`);
    }
    opened += 1;
    openPatientIds.add(patientId);
  }

  return opened;
}

async function loadAtRiskPatients(practiceId) {
  const rows = [];
  let offset = 0;
  const tables = ['pe_patient_contribution_facts', 'v_pe_retention_segment'];

  for (const table of tables) {
    rows.length = 0;
    offset = 0;
    let found = false;

    for (let i = 0; i < 100; i++) {
      const query = withStableOrder(
        supabaseAdmin
          .from(table)
          .select('patient_id, retention_status')
          .eq('practice_id', practiceId)
          .in('retention_status', ['drifting', 'lapsed', 'effectively_lost']),
        table,
      );

      const { data, error } = await query.range(offset, offset + PAGE_SIZE - 1);

      if (error && error.code === '42P01') break;
      if (error) throw new Error(`${table} at-risk: ${error.message}`);

      const batch = data ?? [];
      if (batch.length > 0) found = true;
      rows.push(...batch);
      if (batch.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }

    if (found) return rows;
  }

  return rows;
}

async function syncReactivationFlagsForPractice(practiceId) {
  const opened = await openFlagsForPractice(practiceId);
  const recovered = await evaluateReactivationRecoveryForPractice(practiceId);
  const openFlags = await loadOpenFlags(practiceId);
  return { opened, recovered, openRemaining: openFlags.length };
}

function buildRecoveryMetrics(flags) {
  const recovered = flags.filter((f) => f.status === 'recovered');
  const open = flags.filter((f) => f.status === 'open');

  const flaggedValueGbp = round2(
    flags.reduce((s, f) => s + num(f.contribution_at_risk_at_flag_time), 0),
  );
  const recoveredValueGbp = round2(
    recovered.reduce((s, f) => s + num(f.contribution_recovered), 0),
  );
  const recoveredAtRiskGbp = round2(
    recovered.reduce((s, f) => s + num(f.contribution_at_risk_at_flag_time), 0),
  );
  const openValueGbp = round2(
    open.reduce((s, f) => s + num(f.contribution_at_risk_at_flag_time), 0),
  );

  const recoveryRatePct =
    recoveredAtRiskGbp > 0 ? roundPct(recoveredValueGbp / recoveredAtRiskGbp) : null;
  const recoveryFlagRatePct =
    flags.length > 0 ? roundPct(recovered.length / flags.length) : null;

  return {
    flaggedValueGbp,
    recoveredValueGbp,
    recoveredAtRiskGbp,
    openValueGbp,
    openFlagCount: open.length,
    recoveredFlagCount: recovered.length,
    totalFlagCount: flags.length,
    recoveryRatePct,
    recoveryFlagRatePct,
  };
}

function rpcRowToDbFlag(row) {
  return {
    id: row.id,
    practice_id: row.practice_id,
    patient_id: row.patient_id,
    segment_at_flag_time: row.segment_at_flag_time,
    contribution_at_risk_at_flag_time: row.contribution_at_risk_at_flag_time,
    lifetime_contribution_at_flag: row.lifetime_contribution_at_flag,
    flagged_at: row.flagged_at,
    status: row.status,
    recovered_at: row.recovered_at,
    reactivation_event_at: row.reactivation_event_at,
    contribution_recovered: row.contribution_recovered,
    recovery_window_days: row.recovery_window_days,
    trailing_months: row.trailing_months,
  };
}

async function fetchRetentionRecoveryLoopRpc(practiceId, scope = {}) {
  const locationId = scope.locationId || null;
  const startDate = scope.startDate || null;
  const endDate = scope.endDate || null;

  const { data, error } = await supabaseAdmin.rpc('pe_retention_recovery_loop', {
    p_practice_id: practiceId,
    p_location_id: locationId,
    p_start_date: startDate,
    p_end_date: endDate,
  });

  if (error) {
    throw new Error(`pe_retention_recovery_loop: ${error.message}`);
  }

  return data && typeof data === 'object' ? data : {};
}

function resolveRecoveryRpcLocationId(scope, unit, rollupMode) {
  if (scope.locationId) return scope.locationId;
  if (rollupMode === 'location') return unit.locationId || null;
  return null;
}

function mapFlagRow(flag, patientName, currentRetentionStatus, dentallyPatientUuid = null) {
  const preFlag =
    flag.lifetime_contribution_at_flag != null
      ? num(flag.lifetime_contribution_at_flag)
      : num(flag.contribution_at_risk_at_flag_time);
  return {
    flagId: String(flag.id),
    patientId: String(flag.patient_id),
    patientName: patientName || 'Unknown patient',
    dentallyPatientUuid: dentallyPatientUuid || null,
    segmentAtFlagTime: String(flag.segment_at_flag_time),
    currentRetentionStatus:
      currentRetentionStatus != null
        ? String(currentRetentionStatus)
        : String(flag.segment_at_flag_time),
    contributionAtRiskAtFlagTime: round2(num(flag.contribution_at_risk_at_flag_time)),
    contributionPreFlagGbp: round2(preFlag),
    flaggedAt: String(flag.flagged_at),
    status: String(flag.status),
    recoveredAt: flag.recovered_at != null ? String(flag.recovered_at) : null,
    reactivatedEventAt:
      flag.reactivation_event_at != null ? String(flag.reactivation_event_at) : null,
    contributionRecoveredGbp:
      flag.contribution_recovered != null ? round2(num(flag.contribution_recovered)) : null,
    recoveryWindowDays: num(flag.recovery_window_days) || 365,
    trailingMonths: num(flag.trailing_months) || 12,
  };
}

function mapRpcFlagsToRows(rpc) {
  const enrichedFlags = Array.isArray(rpc?.flags) ? rpc.flags : [];
  const dbFlags = enrichedFlags.map(rpcRowToDbFlag);
  const worklistMeta = new Map();
  const flagRows = enrichedFlags.map((row) => {
    const dbFlag = rpcRowToDbFlag(row);
    const pid = String(row.patient_id);
    worklistMeta.set(pid, {
      dentistRecallDate: row.dentist_recall_date ?? null,
      hygienistRecallDate: row.hygienist_recall_date ?? null,
      lastVisitAt: row.last_visit_at != null ? String(row.last_visit_at) : null,
    });
    return mapFlagRow(
      dbFlag,
      row.patient_name,
      row.current_retention_status,
      row.dentally_patient_uuid,
    );
  });
  return { dbFlags, flagRows, worklistMeta };
}

/**
 * Recovery Loop payload — location scoped only (all open/recovered flags at site).
 */
async function buildScopedRecoveryPayload(
  organizationId,
  unitId,
  unitName,
  unitType,
  scope = {},
) {
  const locationScope = { locationId: scope.locationId ?? null };
  const rpc = await fetchRetentionRecoveryLoopRpc(organizationId, locationScope);
  const { dbFlags, flagRows, worklistMeta } = mapRpcFlagsToRows(rpc);
  const metrics = buildRecoveryMetrics(dbFlags);

  const openWorklist = buildOpenWorklist(flagRows, worklistMeta);
  const funnel = buildRecoveryFunnel(flagRows, openWorklist);
  const openValueGbp = round2(metrics.openValueGbp);

  return {
    practiceId: unitId,
    practiceName: unitName,
    unitType,
    organizationId,
    reactivationValueGbp: openValueGbp,
    openFlagCount: metrics.openFlagCount,
    recoveryWindowDays: num(rpc.recoveryWindowDays) || 365,
    minContributionThresholdGbp: num(rpc.minContributionThresholdGbp) || 100,
    trailingMonths: num(rpc.trailingMonths) || 12,
    ...metrics,
    flags: flagRows,
    openWorklist,
    recoveredThisQuarterGbp: recoveredThisQuarterGbp(flagRows),
    inProgressGbp: openValueGbp,
    recoveryFunnel: funnel,
    tier: DERIVED_TIER,
    tierNote: RECOVERY_TIER_NOTE,
  };
}

async function buildPracticeRecoveryPayload(practiceId, practiceName, scope = {}) {
  return buildScopedRecoveryPayload(practiceId, practiceId, practiceName, 'practice', scope);
}

/**
 * @param {string} userId
 * @param {string} contextPracticeId
 * @param {{ locationId?: string | null, startDate?: string | null, endDate?: string | null }} [scope]
 */
async function buildRetentionRecoveryLoop(userId, contextPracticeId, scope = {}) {
  const { rollupMode, units: allUnits } = await resolvePeRollupUnits(userId, contextPracticeId);

  let units = allUnits;
  if (scope.locationId && rollupMode === 'location') {
    units = allUnits.filter(
      (u) => u.locationId === scope.locationId || u.unitId === scope.locationId,
    );
  }

  if (units.length === 0) {
    return {
      contextPracticeId,
      rollupMode: 'practice',
      practice: null,
      group: null,
      hasData: false,
    };
  }

  const practicePayloads = await Promise.all(
    units.map((unit) =>
      buildScopedRecoveryPayload(
        unit.organizationId,
        unit.unitId,
        unit.unitName,
        unit.unitType,
        {
          locationId: resolveRecoveryRpcLocationId(scope, unit, rollupMode),
        },
      ),
    ),
  );

  const context =
    practicePayloads.find((p) => p.practiceId === contextPracticeId) ??
    practicePayloads.find((p) => p.practiceId === scope.locationId) ??
    practicePayloads.find((p) => p.organizationId === contextPracticeId) ??
    practicePayloads[0];

  const groupFlags = practicePayloads.flatMap((p) =>
    p.flags.map((f) => ({ ...f, practiceId: p.practiceId, practiceName: p.practiceName })),
  );
  const groupMetrics = buildRecoveryMetrics(
    practicePayloads.flatMap((p) =>
      p.flags.map((f) => ({
        status: f.status,
        contribution_at_risk_at_flag_time: f.contributionAtRiskAtFlagTime,
        contribution_recovered: f.contributionRecoveredGbp,
      })),
    ),
  );

  const reactivationByPractice = practicePayloads.map((p) => ({
    practiceId: p.practiceId,
    practiceName: p.practiceName,
    reactivationValueGbp: p.reactivationValueGbp,
    openFlagCount: p.openFlagCount,
  }));

  const groupReactivationValueGbp = round2(
    reactivationByPractice.reduce((s, p) => s + p.reactivationValueGbp, 0),
  );

  const groupOpenWorklist = practicePayloads
    .flatMap((p) =>
      p.openWorklist.map((f) => ({
        ...f,
        practiceId: p.practiceId,
        practiceName: p.practiceName,
      })),
    )
    .sort((a, b) => b.contributionAtRiskAtFlagTime - a.contributionAtRiskAtFlagTime);

  const groupFunnel = buildRecoveryFunnel(groupFlags, groupOpenWorklist);
  const groupRecoveredThisQuarter = recoveredThisQuarterGbp(groupFlags);
  const groupInProgress = round2(
    practicePayloads.reduce((s, p) => s + num(p.reactivationValueGbp), 0),
  );

  const hasData =
    context.totalFlagCount > 0 ||
    context.openFlagCount > 0 ||
    practicePayloads.some((p) => p.totalFlagCount > 0 || p.openFlagCount > 0);

  return {
    contextPracticeId,
    rollupMode,
    practiceName: context.practiceName,
    practice: context,
    group: {
      practiceCount: practicePayloads.length,
      rollupUnitCount: practicePayloads.length,
      reactivationValueGbp: groupReactivationValueGbp,
      practices: reactivationByPractice,
      ...groupMetrics,
      flags: groupFlags,
      openWorklist: groupOpenWorklist,
      recoveredThisQuarterGbp: groupRecoveredThisQuarter,
      inProgressGbp: groupInProgress,
      recoveryFunnel: groupFunnel,
      tier: DERIVED_TIER,
      tierNote: RECOVERY_TIER_NOTE,
      recoveryWindowDays: context.recoveryWindowDays,
    },
    hasData,
  };
}

/**
 * @param {string} userId
 * @param {string} contextPracticeId
 */
async function getRetentionRecoveryLoop(userId, contextPracticeId, scope = {}) {
  const { scopeCacheExtra } = require('./peReadScope');

  return withPeReadCache(
    'retention-recovery-loop',
    contextPracticeId,
    () => buildRetentionRecoveryLoop(userId, contextPracticeId, scope),
    { extra: `${userId}:${scopeCacheExtra(scope)}`, ttlMs: 120_000 },
  );
}

module.exports = {
  getRetentionRecoveryLoop,
  syncReactivationFlagsForPractice,
  AT_RISK_STATUSES,
};
