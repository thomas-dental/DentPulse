/**
 * Growth Levers — practice rollup (visit frequency + value per visit).
 */

const { supabaseAdmin } = require('../../config/supabase');
const {
  DERIVED_TIER,
  DEFAULT_GROWTH_LEVERS_TRAILING_MONTHS,
  DERIVED_TIER_NOTE,
  trailingSinceIsoDate,
  monthKeyFromIsoDate,
  buildTrailingMonthKeys,
  round2,
  isCompletedAppointment,
  computePracticeLevers,
} = require('./growthLeversLogic');
const {
  MODELLED_TIER,
  TENURE_DERIVED_TIER_NOTE,
  PROJECTED_LIFETIME_TIER_NOTE,
  tenureYearsFromFirstActivity,
  averageTenureYears,
  averageProjectedLifetimeYears,
  earliestActivityDate,
} = require('./patientLifetimeLogic');

const PAGE_SIZE = 1000;
const PATIENT_CHUNK = 200;

async function loadGrowthLeversTrailingMonths(practiceId) {
  const { loadPeEconomicAssumptions } = require('./peEconomicAssumptions');
  const assumptions = await loadPeEconomicAssumptions(practiceId);
  return assumptions.growthLeversTrailingMonths || DEFAULT_GROWTH_LEVERS_TRAILING_MONTHS;
}

async function countActivePatients(practiceId) {
  const { count, error } = await supabaseAdmin
    .from('patients')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', practiceId)
    .eq('is_active', true)
    .is('deleted_at', null);

  if (error) throw new Error(`patients active count: ${error.message}`);
  return count ?? 0;
}

async function loadCompletedVisits(practiceId, sinceDate) {
  const sinceIso = `${sinceDate}T00:00:00`;
  let total = 0;
  const byMonth = new Map();
  let offset = 0;

  for (let page = 0; page < 200; page++) {
    const { data, error } = await supabaseAdmin
      .from('appointments')
      .select('apmt_completed_at, apmt_state')
      .eq('organization_id', practiceId)
      .gte('apmt_completed_at', sinceIso)
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw new Error(`appointments visits: ${error.message}`);

    const batch = data ?? [];
    for (const row of batch) {
      if (!isCompletedAppointment(row)) continue;
      total += 1;
      const completedAt = row.apmt_completed_at;
      if (!completedAt) continue;
      const key = monthKeyFromIsoDate(String(completedAt));
      byMonth.set(key, (byMonth.get(key) ?? 0) + 1);
    }

    if (batch.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return { total, byMonth };
}

async function loadRevenuePrivatePlan(practiceId, sinceDate) {
  let total = 0;
  const byMonth = new Map();
  let offset = 0;

  for (let page = 0; page < 200; page++) {
    const { data, error } = await supabaseAdmin
      .from('v_invoice_contribution')
      .select('invoice_date, revenue_private_plan')
      .eq('practice_id', practiceId)
      .gte('invoice_date', sinceDate)
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw new Error(`v_invoice_contribution revenue: ${error.message}`);

    const batch = data ?? [];
    for (const row of batch) {
      const revenue = Number(row.revenue_private_plan) || 0;
      if (revenue <= 0) continue;
      total += revenue;
      const key = monthKeyFromIsoDate(String(row.invoice_date ?? ''));
      if (!key || key.length < 7) continue;
      byMonth.set(key, (byMonth.get(key) ?? 0) + revenue);
    }

    if (batch.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return { total: round2(total), byMonth };
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

async function loadActivePatients(practiceId) {
  const rows = [];
  let offset = 0;

  for (let page = 0; page < 200; page++) {
    const { data, error } = await supabaseAdmin
      .from('patients')
      .select('id, pt_id')
      .eq('organization_id', practiceId)
      .eq('is_active', true)
      .is('deleted_at', null)
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw new Error(`patients active list: ${error.message}`);

    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return rows;
}

async function loadFirstCompletedVisitByPtId(practiceId) {
  const map = new Map();
  let offset = 0;

  for (let page = 0; page < 300; page++) {
    const { data, error } = await supabaseAdmin
      .from('appointments')
      .select('apmt_patient_id, apmt_completed_at, apmt_state')
      .eq('organization_id', practiceId)
      .not('apmt_completed_at', 'is', null)
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw new Error(`appointments first visit: ${error.message}`);

    const batch = data ?? [];
    for (const row of batch) {
      if (!isCompletedAppointment(row)) continue;
      const ptId = row.apmt_patient_id;
      if (ptId == null) continue;
      const key = String(ptId);
      const date = String(row.apmt_completed_at).slice(0, 10);
      const prev = map.get(key);
      if (!prev || date < prev) map.set(key, date);
    }

    if (batch.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return map;
}

async function loadFirstInvoiceDateByPatientId(practiceId) {
  const map = new Map();
  let offset = 0;

  for (let page = 0; page < 300; page++) {
    const { data, error } = await supabaseAdmin
      .from('v_invoice_contribution')
      .select('patient_id, invoice_date')
      .eq('practice_id', practiceId)
      .not('invoice_date', 'is', null)
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw new Error(`v_invoice_contribution first invoice: ${error.message}`);

    const batch = data ?? [];
    for (const row of batch) {
      if (row.patient_id == null || row.invoice_date == null) continue;
      const key = String(row.patient_id);
      const date = String(row.invoice_date).slice(0, 10);
      const prev = map.get(key);
      if (!prev || date < prev) map.set(key, date);
    }

    if (batch.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return map;
}

async function loadRetentionStatusByPatientId(practiceId, patientIds) {
  const map = new Map();
  if (patientIds.length === 0) return map;

  for (let i = 0; i < patientIds.length; i += PATIENT_CHUNK) {
    const chunk = patientIds.slice(i, i + PATIENT_CHUNK);
    const { data, error } = await supabaseAdmin
      .from('v_patient_contribution')
      .select('patient_id, retention_status')
      .eq('practice_id', practiceId)
      .in('patient_id', chunk);

    if (error) throw new Error(`v_patient_contribution retention: ${error.message}`);

    for (const row of data ?? []) {
      if (row.patient_id == null) continue;
      map.set(String(row.patient_id), row.retention_status);
    }
  }

  return map;
}

/**
 * Tenure (Derived) and projected lifetime (Modelled) — always separate outputs.
 */
async function computePatientLifetimeMetrics(practiceId) {
  const { loadPeEconomicAssumptions, projectedLifetimeYearsMap } = require('./peEconomicAssumptions');
  const assumptions = await loadPeEconomicAssumptions(practiceId);
  const lifetimeMap = projectedLifetimeYearsMap(assumptions);
  const today = todayIsoDate();
  const activePatients = await loadActivePatients(practiceId);
  const patientIds = activePatients.map((p) => String(p.id));

  const [firstVisitByPtId, firstInvoiceByPatientId, retentionByPatientId] =
    await Promise.all([
      loadFirstCompletedVisitByPtId(practiceId),
      loadFirstInvoiceDateByPatientId(practiceId),
      loadRetentionStatusByPatientId(practiceId, patientIds),
    ]);

  const tenureYearsList = [];
  const retentionStatuses = [];

  for (const patient of activePatients) {
    const patientId = String(patient.id);
    const ptKey =
      patient.pt_id != null && Number.isFinite(Number(patient.pt_id))
        ? String(patient.pt_id)
        : null;

    const firstActivity = earliestActivityDate(
      ptKey ? firstVisitByPtId.get(ptKey) : null,
      firstInvoiceByPatientId.get(patientId),
    );

    if (firstActivity) {
      const years = tenureYearsFromFirstActivity(firstActivity, today);
      if (years != null) tenureYearsList.push(years);
    }

    const status = retentionByPatientId.get(patientId);
    if (status != null) {
      retentionStatuses.push(String(status));
    } else {
      retentionStatuses.push('active');
    }
  }

  const tenureYears = averageTenureYears(tenureYearsList);
  const projectedLifetimeYears = averageProjectedLifetimeYears(retentionStatuses, lifetimeMap);

  return {
    tenureYears,
    tenureTier: DERIVED_TIER,
    tenureTierNote: TENURE_DERIVED_TIER_NOTE,
    tenurePatientCount: tenureYearsList.length,
    projectedLifetimeYears,
    projectedLifetimeTier: MODELLED_TIER,
    projectedLifetimeTierNote: PROJECTED_LIFETIME_TIER_NOTE,
    projectedLifetimePatientCount: retentionStatuses.length,
    hasTenureData: tenureYearsList.length > 0,
    hasProjectedLifetimeData: retentionStatuses.length > 0,
  };
}

function buildMonthlySeries(monthKeys, visitsByMonth, revenueByMonth) {
  return monthKeys.map((month) => {
    const visits = visitsByMonth.get(month) ?? 0;
    const revenue = revenueByMonth.get(month) ?? 0;
    const valuePerVisit = visits > 0 ? round2(revenue / visits) : null;
    return {
      month,
      completedVisits: visits,
      revenuePrivatePlan: round2(revenue),
      valuePerVisit,
    };
  });
}

/**
 * @param {string} practiceId
 */
async function getGrowthLeversSummary(practiceId) {
  const trailingMonths = await loadGrowthLeversTrailingMonths(practiceId);
  const sinceDate = trailingSinceIsoDate(trailingMonths);
  const monthKeys = buildTrailingMonthKeys(sinceDate, trailingMonths);

  const [activePatientCount, visits, revenue, lifetime] = await Promise.all([
    countActivePatients(practiceId),
    loadCompletedVisits(practiceId, sinceDate),
    loadRevenuePrivatePlan(practiceId, sinceDate),
    computePatientLifetimeMetrics(practiceId),
  ]);

  const levers = computePracticeLevers(
    visits.total,
    activePatientCount,
    revenue.total,
  );

  const monthly = buildMonthlySeries(monthKeys, visits.byMonth, revenue.byMonth);

  const hasAppointmentData = visits.total > 0;
  const hasRevenueData = revenue.total > 0;
  const hasActivePatients = activePatientCount > 0;

  return {
    practiceId,
    trailingMonths,
    sinceDate,
    visitFrequency: levers.visitFrequency,
    visitFrequencyTier: DERIVED_TIER,
    visitFrequencyTierNote: DERIVED_TIER_NOTE,
    valuePerVisit: levers.valuePerVisit,
    valuePerVisitTier: DERIVED_TIER,
    valuePerVisitTierNote: DERIVED_TIER_NOTE,
    totalCompletedVisits: levers.totalCompletedVisits,
    totalRevenuePrivatePlan: levers.totalRevenuePrivatePlan,
    activePatientCount: levers.activePatientCount,
    tenureYears: lifetime.tenureYears,
    tenureTier: lifetime.tenureTier,
    tenureTierNote: lifetime.tenureTierNote,
    tenurePatientCount: lifetime.tenurePatientCount,
    projectedLifetimeYears: lifetime.projectedLifetimeYears,
    projectedLifetimeTier: lifetime.projectedLifetimeTier,
    projectedLifetimeTierNote: lifetime.projectedLifetimeTierNote,
    projectedLifetimePatientCount: lifetime.projectedLifetimePatientCount,
    hasTenureData: lifetime.hasTenureData,
    hasProjectedLifetimeData: lifetime.hasProjectedLifetimeData,
    monthly,
    hasAppointmentData,
    hasRevenueData,
    hasActivePatients,
    tier: DERIVED_TIER,
    tierNote: DERIVED_TIER_NOTE,
  };
}

module.exports = {
  getGrowthLeversSummary,
  loadGrowthLeversTrailingMonths,
};
