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
 */

const { supabaseAdmin } = require('../../config/supabase');
const { resolvePeRollupUnits } = require('./peRollupUnits');
const { loadPatientUuidsForLocation } = require('./peLocationScope');
const { loadPeEconomicAssumptions } = require('./peEconomicAssumptions');
const { parseRetentionStatus } = require('./peRetentionSegmentation');
const {
  annualizeTrailingContribution,
  buildRecoveryFunnel,
  pickLatestCompletedVisit,
  resolveWorklistDaysOverdue,
} = require('./peReactivationWorklistLogic');

const PAGE_SIZE = 1000;
const { queryInPatientChunks } = require('./pePatientQueryChunks');
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

function addDaysIso(ts, days) {
  const d = new Date(ts);
  d.setUTCDate(d.getUTCDate() + days);
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
  const map = new Map();
  const since = trailingSinceIsoDate(trailingMonths);
  const tables = ['pe_invoice_contribution_facts', 'v_invoice_contribution'];

  for (const table of tables) {
    map.clear();
    let offset = 0;
    let found = false;

    for (let page = 0; page < 100; page++) {
      const { data, error } = await supabaseAdmin
        .from(table)
        .select('patient_id, contribution')
        .eq('practice_id', practiceId)
        .gte('invoice_date', since)
        .range(offset, offset + PAGE_SIZE - 1);

      if (error && error.code === '42P01') break;
      if (error) throw new Error(`${table} trailing: ${error.message}`);

      const batch = data ?? [];
      if (batch.length > 0) found = true;
      for (const row of batch) {
        if (row.patient_id == null) continue;
        const pid = String(row.patient_id);
        map.set(pid, (map.get(pid) ?? 0) + num(row.contribution));
      }

      if (batch.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }

    if (found) return map;
  }

  return map;
}

async function sumContributionBetween(practiceId, patientId, fromIsoDate, toIsoDate) {
  let sum = 0;
  const tables = ['pe_invoice_contribution_facts', 'v_invoice_contribution'];

  for (const table of tables) {
    sum = 0;
    let offset = 0;
    let found = false;

    for (let page = 0; page < 50; page++) {
      const { data, error } = await supabaseAdmin
        .from(table)
        .select('contribution')
        .eq('practice_id', practiceId)
        .eq('patient_id', patientId)
        .gte('invoice_date', fromIsoDate)
        .lte('invoice_date', toIsoDate)
        .range(offset, offset + PAGE_SIZE - 1);

      if (error && error.code === '42P01') break;
      if (error) throw new Error(`${table} recovery sum: ${error.message}`);

      const batch = data ?? [];
      if (batch.length > 0) found = true;
      for (const row of batch) {
        sum += num(row.contribution);
      }

      if (batch.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }

    if (found) return round2(sum);
  }

  return round2(sum);
}

async function findReactivationEventAfter(practiceId, patientId, flaggedAt) {
  const { data, error } = await supabaseAdmin
    .from('event_ledger')
    .select('id, created_at')
    .eq('practice_id', practiceId)
    .eq('patient_id', patientId)
    .eq('event_type', 'PATIENT_REACTIVATED')
    .gt('created_at', flaggedAt)
    .order('created_at', { ascending: true })
    .limit(1);

  if (error) throw new Error(`event_ledger PATIENT_REACTIVATED: ${error.message}`);
  return data?.[0] ?? null;
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

async function loadAllFlags(practiceId) {
  const rows = [];
  let offset = 0;

  for (let i = 0; i < 100; i++) {
    const { data, error } = await supabaseAdmin
      .from('pe_reactivation_flags')
      .select('*')
      .eq('practice_id', practiceId)
      .order('flagged_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      if (error.code === '42P01') return [];
      throw new Error(`pe_reactivation_flags: ${error.message}`);
    }

    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return rows;
}

async function evaluateRecoveryForFlag(flag) {
  const event = await findReactivationEventAfter(
    flag.practice_id,
    flag.patient_id,
    flag.flagged_at,
  );
  if (!event) return false;

  const reactivatedAt = event.created_at;
  const windowDays = num(flag.recovery_window_days) || 365;
  const windowEnd = addDaysIso(reactivatedAt, windowDays);
  const recoveredGbp = await sumContributionBetween(
    flag.practice_id,
    flag.patient_id,
    reactivatedAt.slice(0, 10),
    windowEnd,
  );

  const { error } = await supabaseAdmin
    .from('pe_reactivation_flags')
    .update({
      status: 'recovered',
      recovered_at: reactivatedAt,
      reactivation_event_at: reactivatedAt,
      contribution_recovered: recoveredGbp,
      updated_at: new Date().toISOString(),
    })
    .eq('id', flag.id)
    .eq('status', 'open');

  if (error) throw new Error(`pe_reactivation_flags recover: ${error.message}`);
  return true;
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
      const { data, error } = await supabaseAdmin
        .from(table)
        .select('patient_id, retention_status')
        .eq('practice_id', practiceId)
        .in('retention_status', ['drifting', 'lapsed', 'effectively_lost'])
        .range(offset, offset + PAGE_SIZE - 1);

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
  const openFlags = await loadOpenFlags(practiceId);
  let recovered = 0;
  for (const flag of openFlags) {
    const did = await evaluateRecoveryForFlag(flag);
    if (did) recovered += 1;
  }
  return { opened, recovered, openRemaining: openFlags.length - recovered };
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

async function loadPatientWorklistMeta(practiceId, patientIds) {
  const names = new Map();
  const retentionStatuses = new Map();
  const worklistMeta = new Map();
  if (patientIds.length === 0) return { names, retentionStatuses, worklistMeta };

  for (let i = 0; i < patientIds.length; i += 300) {
    const chunk = patientIds.slice(i, i + 300);
    const { data, error } = await supabaseAdmin
      .from('patients')
      .select(
        'id, pt_first_name, pt_last_name, pt_dentist_recall_date, pt_hygienist_recall_date, pt_id',
      )
      .eq('organization_id', practiceId)
      .in('id', chunk);

    if (error) throw new Error(`patient worklist meta: ${error.message}`);

    for (const row of data ?? []) {
      if (row.id == null) continue;
      const pid = String(row.id);
      names.set(
        pid,
        `${String(row.pt_first_name || '').trim()} ${String(row.pt_last_name || '').trim()}`.trim() ||
          'Unknown patient',
      );
      worklistMeta.set(pid, {
        dentistRecallDate: row.pt_dentist_recall_date,
        hygienistRecallDate: row.pt_hygienist_recall_date,
        ptId: row.pt_id,
        lastVisitAt: null,
      });
    }
  }

  const ptIds = [...worklistMeta.values()]
    .map((m) => m.ptId)
    .filter((id) => id != null && String(id).length > 0);

  if (ptIds.length > 0) {
    for (let i = 0; i < ptIds.length; i += 300) {
      const chunk = ptIds.slice(i, i + 300);
      const { data, error } = await supabaseAdmin
        .from('appointments')
        .select('apmt_patient_id, apmt_completed_at, apmt_state')
        .eq('organization_id', practiceId)
        .in('apmt_patient_id', chunk);

      if (error) throw new Error(`appointment last visit: ${error.message}`);

      const lastByPtId = new Map();
      const byPtId = new Map();
      for (const appt of data ?? []) {
        const ptId = String(appt.apmt_patient_id);
        if (!byPtId.has(ptId)) byPtId.set(ptId, []);
        byPtId.get(ptId).push(appt);
      }
      for (const [ptId, appts] of byPtId.entries()) {
        const last = pickLatestCompletedVisit(appts);
        if (last) lastByPtId.set(ptId, last);
      }

      for (const [pid, meta] of worklistMeta.entries()) {
        if (meta.ptId == null) continue;
        const last = lastByPtId.get(String(meta.ptId));
        if (last) meta.lastVisitAt = String(last);
      }
    }
  }

  const contribRows = await queryInPatientChunks(patientIds, (chunk) =>
    supabaseAdmin
      .from('pe_patient_contribution_facts')
      .select('patient_id, retention_status')
      .eq('practice_id', practiceId)
      .in('patient_id', chunk),
  );

  if (contribRows.length === 0) {
    const fallbackRows = await queryInPatientChunks(patientIds, (chunk) =>
      supabaseAdmin
        .from('v_patient_contribution')
        .select('patient_id, retention_status')
        .eq('practice_id', practiceId)
        .in('patient_id', chunk),
    );
    for (const row of fallbackRows) {
      if (row.patient_id == null) continue;
      const pid = String(row.patient_id);
      if (row.retention_status != null) {
        retentionStatuses.set(pid, String(row.retention_status));
      }
    }
  } else {
    for (const row of contribRows) {
      if (row.patient_id == null) continue;
      const pid = String(row.patient_id);
      if (row.retention_status != null) {
        retentionStatuses.set(pid, String(row.retention_status));
      }
    }
  }

  return { names, retentionStatuses, worklistMeta };
}

function mapFlagRow(flag, patientName, currentRetentionStatus) {
  const preFlag =
    flag.lifetime_contribution_at_flag != null
      ? num(flag.lifetime_contribution_at_flag)
      : num(flag.contribution_at_risk_at_flag_time);
  return {
    flagId: String(flag.id),
    patientId: String(flag.patient_id),
    patientName: patientName || 'Unknown patient',
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

async function buildScopedRecoveryPayload(
  organizationId,
  unitId,
  unitName,
  unitType,
  locationId = null,
) {
  const allFlags = await loadAllFlags(organizationId);

  let flags = allFlags;
  if (locationId) {
    const patientUuids = await loadPatientUuidsForLocation(organizationId, locationId);
    const patientSet = new Set(patientUuids);
    flags = allFlags.filter((f) => patientSet.has(String(f.patient_id)));
  }

  const metrics = buildRecoveryMetrics(flags);

  const patientIds = [...new Set(flags.map((f) => String(f.patient_id)))];
  const { names, retentionStatuses, worklistMeta } = await loadPatientWorklistMeta(
    organizationId,
    patientIds,
  );

  const openValueGbp = round2(
    flags
      .filter((f) => f.status === 'open')
      .reduce((s, f) => s + num(f.contribution_at_risk_at_flag_time), 0),
  );
  const openFlagCount = flags.filter((f) => f.status === 'open').length;

  const flagRows = flags.map((f) => {
    const pid = String(f.patient_id);
    return mapFlagRow(f, names.get(pid), retentionStatuses.get(pid));
  });
  const openWorklist = buildOpenWorklist(flagRows, worklistMeta);
  const funnel = buildRecoveryFunnel(flagRows, openWorklist);

  const assumptions = await loadPeEconomicAssumptions(organizationId);

  return {
    practiceId: unitId,
    practiceName: unitName,
    unitType,
    organizationId,
    reactivationValueGbp: openValueGbp,
    openFlagCount,
    recoveryWindowDays: assumptions.reactivationRecoveryContributionWindowDays,
    minContributionThresholdGbp: assumptions.reactivationMinContributionAtRiskGbp,
    trailingMonths: assumptions.reactivationWorklistTrailingMonths,
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

async function buildPracticeRecoveryPayload(practiceId, practiceName) {
  return buildScopedRecoveryPayload(practiceId, practiceId, practiceName, 'practice', null);
}

/**
 * @param {string} userId
 * @param {string} contextPracticeId
 */
async function getRetentionRecoveryLoop(userId, contextPracticeId) {
  const { rollupMode, units } = await resolvePeRollupUnits(userId, contextPracticeId);

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
        unit.locationId,
      ),
    ),
  );

  const context =
    practicePayloads.find((p) => p.practiceId === contextPracticeId) ??
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
  const groupInProgress = round2(groupMetrics.openValueGbp);

  const hasData =
    context.totalFlagCount > 0 ||
    practicePayloads.some((p) => p.totalFlagCount > 0);

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

module.exports = {
  getRetentionRecoveryLoop,
  syncReactivationFlagsForPractice,
  AT_RISK_STATUSES,
};
