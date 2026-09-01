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
const PATIENT_CHUNK = 100;
const { queryInPatientChunks } = require('./pePatientQueryChunks');
const { withPeReadCache } = require('./peReadCache');

async function loadGrowthLeversTrailingMonths(practiceId) {
  const { loadPeEconomicAssumptions } = require('./peEconomicAssumptions');
  const assumptions = await loadPeEconomicAssumptions(practiceId);
  return assumptions.growthLeversTrailingMonths || DEFAULT_GROWTH_LEVERS_TRAILING_MONTHS;
}

async function countActivePatients(practiceId, locationId = null) {
  let query = supabaseAdmin
    .from('patients')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', practiceId)
    .eq('is_active', true)
    .is('deleted_at', null);

  if (locationId) query = query.eq('location_id', locationId);

  const { count, error } = await query;

  if (error) throw new Error(`patients active count: ${error.message}`);
  return count ?? 0;
}

async function loadCompletedVisits(practiceId, sinceDate, locationId = null) {
  const { data, error } = await supabaseAdmin.rpc('pe_growth_levers_facts', {
    p_practice_id: practiceId,
    p_since_date: sinceDate,
    p_location_id: locationId,
  });

  if (!error && data) {
    const byMonth = new Map();
    const visitsObj = data.visits_by_month ?? {};
    for (const [key, value] of Object.entries(visitsObj)) {
      byMonth.set(key, num(value));
    }
    return { total: num(data.total_completed_visits), byMonth };
  }

  if (error) {
    console.error(
      `[growthLevers] pe_growth_levers_facts failed for ${practiceId}: ${error.message}`,
    );
  }
  return { total: 0, byMonth: new Map() };
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function loadRevenuePrivatePlan(practiceId, sinceDate, locationId = null) {
  const { data, error } = await supabaseAdmin.rpc('pe_growth_levers_facts', {
    p_practice_id: practiceId,
    p_since_date: sinceDate,
    p_location_id: locationId,
  });

  if (!error && data) {
    const byMonth = new Map();
    const revenueObj = data.revenue_by_month ?? {};
    for (const [key, value] of Object.entries(revenueObj)) {
      byMonth.set(key, num(value));
    }
    return { total: round2(num(data.total_revenue_private_plan)), byMonth };
  }

  let total = 0;
  const byMonth = new Map();
  let offset = 0;

  for (let page = 0; page < 200; page++) {
    let query = supabaseAdmin
      .from('pe_invoice_contribution_facts')
      .select('invoice_date, revenue_private_plan, patient_id')
      .eq('practice_id', practiceId)
      .gte('invoice_date', sinceDate);

    const { data: batchData, error: batchError } = await query.range(offset, offset + PAGE_SIZE - 1);

    if (batchError && batchError.code === '42P01') {
      query = supabaseAdmin
        .from('v_invoice_contribution')
        .select('invoice_date, revenue_private_plan, patient_id')
        .eq('practice_id', practiceId)
        .gte('invoice_date', sinceDate);
      const fallback = await query.range(offset, offset + PAGE_SIZE - 1);
      if (fallback.error) throw new Error(`v_invoice_contribution revenue: ${fallback.error.message}`);
      const batch = fallback.data ?? [];
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
      continue;
    }

    if (batchError) throw new Error(`pe_invoice_contribution_facts revenue: ${batchError.message}`);

    const batch = batchData ?? [];
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

async function loadActivePatients(practiceId, locationId = null) {
  const rows = [];
  let offset = 0;

  for (let page = 0; page < 200; page++) {
    let query = supabaseAdmin
      .from('patients')
      .select('id, pt_id')
      .eq('organization_id', practiceId)
      .eq('is_active', true)
      .is('deleted_at', null);

    if (locationId) query = query.eq('location_id', locationId);

    const { data, error } = await query.range(offset, offset + PAGE_SIZE - 1);

    if (error) throw new Error(`patients active list: ${error.message}`);

    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return rows;
}

async function loadFirstCompletedVisitByPtId(practiceId, locationId = null) {
  const map = new Map();
  const { data, error } = await supabaseAdmin.rpc('pe_first_completed_visit_by_pt', {
    p_practice_id: practiceId,
    p_location_id: locationId,
  });

  if (!error && data && typeof data === 'object') {
    for (const [ptId, dateVal] of Object.entries(data)) {
      if (dateVal == null) continue;
      map.set(String(ptId), String(dateVal).slice(0, 10));
    }
    return map;
  }

  if (error) {
    console.error(
      `[growthLevers] pe_first_completed_visit_by_pt failed for ${practiceId}: ${error.message}`,
    );
  }
  return map;
}

async function loadFirstInvoiceDateByPatientId(practiceId, patientUuids = null) {
  const map = new Map();
  let offset = 0;

  if (patientUuids && patientUuids.length === 0) return map;

  const sourceTables = ['pe_invoice_contribution_facts', 'v_invoice_contribution'];

  for (const table of sourceTables) {
    let offset = 0;
    let foundRows = false;

    for (let page = 0; page < 300; page++) {
      if (patientUuids) {
        const chunkRows = await queryInPatientChunks(patientUuids, (chunk) =>
          supabaseAdmin
            .from(table)
            .select('patient_id, invoice_date')
            .eq('practice_id', practiceId)
            .not('invoice_date', 'is', null)
            .in('patient_id', chunk),
        );
        foundRows = chunkRows.length > 0 || foundRows;
        for (const row of chunkRows) {
          if (row.patient_id == null || row.invoice_date == null) continue;
          const key = String(row.patient_id);
          const date = String(row.invoice_date).slice(0, 10);
          const prev = map.get(key);
          if (!prev || date < prev) map.set(key, date);
        }
        break;
      }

      const { data, error } = await supabaseAdmin
        .from(table)
        .select('patient_id, invoice_date')
        .eq('practice_id', practiceId)
        .not('invoice_date', 'is', null)
        .range(offset, offset + PAGE_SIZE - 1);

      if (error && error.code === '42P01') break;
      if (error) throw new Error(`${table} first invoice: ${error.message}`);

      const batch = data ?? [];
      foundRows = batch.length > 0 || foundRows;
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

    if (foundRows) break;
  }

  return map;
}

async function loadRetentionStatusByPatientId(practiceId) {
  const map = new Map();
  let offset = 0;
  const tables = ['pe_patient_contribution_facts', 'v_pe_retention_segment'];

  for (const table of tables) {
    map.clear();
    offset = 0;
    let found = false;

    for (let page = 0; page < 500; page++) {
      const { data, error } = await supabaseAdmin
        .from(table)
        .select('patient_id, retention_status')
        .eq('practice_id', practiceId)
        .range(offset, offset + PAGE_SIZE - 1);

      if (error && error.code === '42P01') break;
      if (error) throw new Error(`${table} retention: ${error.message}`);

      const batch = data ?? [];
      if (batch.length > 0) found = true;
      for (const row of batch) {
        if (row.patient_id == null) continue;
        map.set(String(row.patient_id), row.retention_status);
      }

      if (batch.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }

    if (found) return map;
  }

  return map;
}

/**
 * Tenure (Derived) and projected lifetime (Modelled) — always separate outputs.
 */
async function computePatientLifetimeMetrics(practiceId, locationId = null) {
  const { loadPeEconomicAssumptions, projectedLifetimeYearsMap } = require('./peEconomicAssumptions');
  const assumptions = await loadPeEconomicAssumptions(practiceId);
  const lifetimeMap = projectedLifetimeYearsMap(assumptions);
  const today = todayIsoDate();
  const activePatients = await loadActivePatients(practiceId, locationId);
  const patientIds = activePatients.map((p) => String(p.id));

  const [firstVisitByPtId, firstInvoiceByPatientId, retentionByPatientId] =
    await Promise.all([
      loadFirstCompletedVisitByPtId(practiceId, locationId),
      loadFirstInvoiceDateByPatientId(practiceId, locationId ? patientIds : null),
      loadRetentionStatusByPatientId(practiceId),
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
 * @param {{ locationId?: string | null }} [options]
 */
async function getGrowthLeversSummary(practiceId, options = {}) {
  const locationId = options.locationId || null;
  const trailingMonths = await loadGrowthLeversTrailingMonths(practiceId);
  const sinceDate = trailingSinceIsoDate(trailingMonths);
  const monthKeys = buildTrailingMonthKeys(sinceDate, trailingMonths);

  return withPeReadCache(
    'growth-levers-summary',
    practiceId,
    async () => buildGrowthLeversPayload(practiceId, locationId, trailingMonths, sinceDate, monthKeys),
    { extra: locationId ?? 'all' },
  );
}

async function buildGrowthLeversPayload(
  practiceId,
  locationId,
  trailingMonths,
  sinceDate,
  monthKeys,
) {
  const [activePatientCount, visits, revenue, lifetime] = await Promise.all([
    countActivePatients(practiceId, locationId),
    loadCompletedVisits(practiceId, sinceDate, locationId),
    loadRevenuePrivatePlan(practiceId, sinceDate, locationId),
    computePatientLifetimeMetrics(practiceId, locationId),
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
