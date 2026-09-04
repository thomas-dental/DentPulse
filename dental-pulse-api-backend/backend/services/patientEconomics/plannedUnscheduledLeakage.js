/**
 * Planned > N days unscheduled — API read layer (pe_planned_unscheduled_leakage RPC).
 */

const { supabaseAdmin } = require('../../config/supabase');
const { DEFAULT_LEAKAGE_UNSCHEDULED_THRESHOLD_DAYS } = require('./plannedUnscheduledLeakageLogic');
const { withPeReadCache } = require('./peReadCache');
const { scopeCacheExtra } = require('./peReadScope');

const TIER = 'Derived';
const TIER_NOTE =
  'Private planned items on ledger plans with no active appointment link beyond threshold days after PLAN_CREATED. NHS items excluded.';

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function mapPlannedUnscheduledLeakageRpc(practiceId, raw) {
  const payload = raw && typeof raw === 'object' ? raw : {};
  const rows = Array.isArray(payload.rows) ? payload.rows : [];

  return {
    practiceId,
    thresholdDays: num(payload.thresholdDays) || DEFAULT_LEAKAGE_UNSCHEDULED_THRESHOLD_DAYS,
    tier: TIER,
    tierNote: TIER_NOTE,
    marginPct: payload.marginPct == null ? null : num(payload.marginPct),
    contributionOpportunity:
      payload.contributionOpportunity == null ? null : num(payload.contributionOpportunity),
    itemCount: num(payload.itemCount),
    totalValueAtRisk: num(payload.totalValueAtRisk),
    rows: rows.map((row) => ({
      planId: String(row.planId ?? ''),
      tpiId: row.tpiId != null ? String(row.tpiId) : null,
      patientId: String(row.patientId ?? ''),
      patientName: String(row.patientName ?? 'Unknown patient'),
      dentallyPatientUuid:
        row.dentallyPatientUuid != null && String(row.dentallyPatientUuid).trim()
          ? String(row.dentallyPatientUuid).trim()
          : null,
      treatmentValue: num(row.treatmentValue),
      daysUnscheduled: num(row.daysUnscheduled),
      planCreatedAt: row.planCreatedAt ?? null,
    })),
  };
}

async function fetchPlannedUnscheduledLeakageRpc(
  practiceId,
  locationId = null,
  startDate = null,
  endDate = null,
) {
  const { data, error } = await supabaseAdmin.rpc('pe_planned_unscheduled_leakage', {
    p_practice_id: practiceId,
    p_location_id: locationId,
    p_start_date: startDate,
    p_end_date: endDate,
  });

  if (error) {
    throw new Error(`pe_planned_unscheduled_leakage: ${error.message}`);
  }

  return mapPlannedUnscheduledLeakageRpc(practiceId, data);
}

/**
 * @param {string} practiceId
 * @param {{ locationId?: string | null, startDate?: string | null, endDate?: string | null }} [scope]
 */
async function getPlannedUnscheduledLeakage(practiceId, scope = {}) {
  const locationId = scope.locationId || null;
  const startDate = scope.startDate || null;
  const endDate = scope.endDate || null;

  return withPeReadCache(
    'planned-unscheduled-leakage',
    practiceId,
    () => fetchPlannedUnscheduledLeakageRpc(practiceId, locationId, startDate, endDate),
    { extra: scopeCacheExtra(scope), ttlMs: 120_000 },
  );
}

module.exports = {
  DEFAULT_LEAKAGE_UNSCHEDULED_THRESHOLD_DAYS,
  getPlannedUnscheduledLeakage,
};
