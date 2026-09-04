/**
 * PE Invoices read layer — aged debt, collection rate, paginated worklist (backend-only).
 */

const { supabaseAdmin } = require('../../config/supabase');
const { loadPeEconomicAssumptions } = require('./peEconomicAssumptions');
const { resolvePeRollupUnits } = require('./peRollupUnits');
const { buildDentallyInvoiceUrl } = require('./dentallyDeepLinks');
const { withPeReadCache } = require('./peReadCache');
const { scopeCacheExtra } = require('./peReadScope');
const { isMatchedInvoiceListRow } = require('./pePatientFactsGrain');

const DEFAULT_LIST_PAGE_SIZE = 25;
const MAX_LIST_PAGE_SIZE = 100;

const AGING_BUCKET_ORDER = ['0-30', '31-60', '61-90', '90+'];
const AGING_BUCKET_LABELS = {
  '0-30': '0–30 days',
  '31-60': '31–60 days',
  '61-90': '61–90 days',
  '90+': '90+ days',
};

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function filterUnitsByLocation(units, scope = {}) {
  if (!scope.locationId) return units;
  return units.filter(
    (u) => u.locationId === scope.locationId || u.unitId === scope.locationId,
  );
}

/** Location scope; preserves TopBar period dates when set. */
function scopeLocationOnly(scope = {}) {
  const out = {};
  if (scope.locationId) out.locationId = scope.locationId;
  if (scope.startDate && scope.endDate) {
    out.startDate = scope.startDate;
    out.endDate = scope.endDate;
  }
  return out;
}

function resolveContextOutstanding(allListRows, practiceId, units, scope = {}) {
  const scopedUnits = filterUnitsByLocation(units, scope);
  if (scopedUnits.length === 0) return [];
  if (!scope.locationId) {
    return allListRows.filter((r) => r.practiceId === practiceId && r.isOutstanding);
  }
  const locationIds = new Set(scopedUnits.map((u) => u.locationId).filter(Boolean));
  const orgIds = new Set(scopedUnits.map((u) => u.organizationId));
  return allListRows.filter((r) => {
    if (!r.isOutstanding) return false;
    if (r.locationId && locationIds.has(r.locationId)) return true;
    return orgIds.has(r.practiceId);
  });
}

function todayUtcYmd() {
  return new Date().toISOString().slice(0, 10);
}

function trailingSinceIsoDate(months) {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

async function loadMappedRowsViaRpc(
  organizationIds,
  locationId,
  periodStart,
  periodEnd,
  { today, cashLeakageWindowDays, agingBucketBoundaryDays } = {},
) {
  if (organizationIds.length === 0) return [];

  const boundaries = agingBucketBoundaryDays || [30, 60, 90];
  const { data, error } = await supabaseAdmin.rpc('pe_invoices_mapped_rows', {
    p_org_ids: organizationIds,
    p_location_id: locationId || null,
    p_period_start: periodStart,
    p_period_end: periodEnd,
    p_today: today || todayUtcYmd(),
    p_cash_leakage_days: cashLeakageWindowDays ?? 30,
    p_aging_b0: boundaries[0] ?? 30,
    p_aging_b1: boundaries[1] ?? 60,
    p_aging_b2: boundaries[2] ?? 90,
  });
  if (error) throw error;
  if (Array.isArray(data)) return data;
  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function parseOutstandingKpisRpc(data) {
  const payload = data && typeof data === 'object' ? data : {};
  const agedBuckets = Array.isArray(payload.agedBuckets) ? payload.agedBuckets : [];
  return {
    totalOutstandingGbp: num(payload.totalOutstandingGbp),
    overdue60PlusGbp: num(payload.overdue60PlusGbp),
    onPaymentPlanOutstandingGbp: num(payload.onPaymentPlanOutstandingGbp),
    onPaymentPlanArrangementCount: num(payload.onPaymentPlanArrangementCount),
    agedBuckets: agedBuckets.map((row) => ({
      bucket: String(row.bucket || '0-30'),
      label: String(row.label || row.bucket || '0-30'),
      outstandingGbp: num(row.outstandingGbp),
      invoiceCount: num(row.invoiceCount),
    })),
  };
}

async function loadOutstandingKpisViaRpc(practiceId, organizationIds, locationId, meta) {
  if (organizationIds.length === 0) {
    return parseOutstandingKpisRpc(null);
  }

  const boundaries = meta.agingBucketBoundaryDays || [30, 60, 90];
  const { data, error } = await supabaseAdmin.rpc('pe_invoices_outstanding_kpis', {
    p_practice_id: practiceId,
    p_org_ids: organizationIds,
    p_location_id: locationId || null,
    p_period_start: meta.periodStart || null,
    p_period_end: meta.periodEnd || null,
    p_today: meta.today,
    p_aging_b0: boundaries[0] ?? 30,
    p_aging_b1: boundaries[1] ?? 60,
    p_aging_b2: boundaries[2] ?? 90,
  });
  if (error) throw error;

  if (typeof data === 'string') {
    try {
      return parseOutstandingKpisRpc(JSON.parse(data));
    } catch {
      return parseOutstandingKpisRpc(null);
    }
  }
  return parseOutstandingKpisRpc(data);
}

function loadOutstandingKpisCached(practiceId, userId, scope, meta, organizationIds) {
  return withPeReadCache(
    'invoices-outstanding-kpis',
    practiceId,
    () => loadOutstandingKpisViaRpc(practiceId, organizationIds, scope.locationId, meta),
    { ttlMs: 60_000, extra: `${userId}:${scopeCacheExtra(scope)}` },
  );
}

function mapRpcRowToListRow(row) {
  const ptId = num(row.patient_id) || null;
  const orgId = String(row.organization_id);
  const invoiceUuid =
    row.invoice_uuid != null && String(row.invoice_uuid).trim()
      ? String(row.invoice_uuid).trim()
      : null;
  const accountUuid =
    row.account_uuid != null && String(row.account_uuid).trim()
      ? String(row.account_uuid).trim()
      : null;
  const dentallyPatientUuid =
    row.pt_unique_id != null && String(row.pt_unique_id).trim()
      ? String(row.pt_unique_id).trim()
      : null;
  const agingBucket = String(row.aging_bucket || '0-30');

  return {
    practiceId: orgId,
    practiceName: String(row.organization_name || 'Practice'),
    platformInvoiceId: String(row.platform_invoice_id),
    invoiceNumber: row.invoice_number != null ? String(row.invoice_number) : null,
    invoiceDate: row.invoice_date ? String(row.invoice_date).slice(0, 10) : null,
    dueDate: row.due_date ? String(row.due_date).slice(0, 10) : null,
    amountGbp: num(row.subtotal),
    outstandingGbp: num(row.outstanding_gbp),
    daysPastDue: num(row.days_past_due),
    daysSinceRaised: num(row.days_since_raised),
    agingBucket,
    status: String(row.status || (row.is_paid ? 'paid' : 'outstanding')),
    isPaid: row.is_paid_display === true,
    isOutstanding: row.is_outstanding === true,
    isCashLeakage: row.is_cash_leakage === true,
    patientId: ptId,
    dentallyPatientUuid,
    patientRecordId: row.patient_record_id != null ? String(row.patient_record_id) : null,
    patientName: row.patient_name != null ? String(row.patient_name) : null,
    onPaymentPlan: row.on_payment_plan === true,
    invoiceUuid,
    accountUuid,
    dentallyInvoiceUrl: buildDentallyInvoiceUrl({
      dentallyPatientUuid,
      accountUuid,
      invoiceUuid,
    }),
    locationId: row.location_id != null ? String(row.location_id) : null,
    locationName: row.location_name != null ? String(row.location_name) : null,
  };
}

function deriveInvoiceDisplayStatus(row) {
  if (row.isPaid || !row.isOutstanding || row.outstandingGbp <= 0) return 'paid';
  if (row.agingBucket !== '0-30' || row.daysPastDue > 30) return 'overdue';
  if (row.amountGbp > 0 && row.outstandingGbp < row.amountGbp) return 'part-paid';
  return 'current';
}

function buildAgedBuckets(outstandingRows) {
  const totals = new Map();
  for (const id of AGING_BUCKET_ORDER) {
    totals.set(id, { gbp: 0, count: 0 });
  }
  for (const row of outstandingRows) {
    const t = totals.get(row.agingBucket);
    if (!t) continue;
    t.gbp += row.outstandingGbp;
    t.count += 1;
  }
  return AGING_BUCKET_ORDER.map((bucket) => ({
    bucket,
    label: AGING_BUCKET_LABELS[bucket],
    outstandingGbp: round2(totals.get(bucket).gbp),
    invoiceCount: totals.get(bucket).count,
  }));
}

async function loadCollectionTotalsViaRpc(units, periodStart, periodEnd) {
  if (units.length === 0) return [];

  const payload = units.map((unit) => ({
    unitId: unit.unitId,
    unitName: unit.unitName,
    organizationId: unit.organizationId,
    locationId: unit.locationId || '',
  }));

  const { data, error } = await supabaseAdmin.rpc('pe_invoices_collection_totals', {
    p_units: payload,
    p_period_start: periodStart,
    p_period_end: periodEnd,
  });
  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];
  return rows.map((row) => ({
    practiceId: String(row.practiceId),
    practiceName: String(row.practiceName || 'Practice'),
    invoicedGbp: num(row.invoicedGbp),
    collectedGbp: num(row.collectedGbp),
    collectionRate: row.collectionRate == null ? null : num(row.collectionRate),
  }));
}

function parseListParams(query = {}) {
  const page = Math.max(1, Math.min(10_000, parseInt(String(query.page || '1'), 10) || 1));
  const pageSize = Math.max(
    1,
    Math.min(MAX_LIST_PAGE_SIZE, parseInt(String(query.pageSize || DEFAULT_LIST_PAGE_SIZE), 10) || DEFAULT_LIST_PAGE_SIZE),
  );
  const sort = String(query.sort || 'outstanding');
  const sortDir = String(query.sortDir || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';
  const search = String(query.search || '').trim().toLowerCase();
  const statusFilter = String(query.statusFilter || 'all');
  const cashLeakageOnly = query.cashLeakageOnly === 'true' || query.cashLeakageOnly === true;

  const validSort = new Set([
    'invoice',
    'patient',
    'practice',
    'raised',
    'amount',
    'outstanding',
    'age',
    'status',
  ]);
  const sortKey = validSort.has(sort) ? sort : 'outstanding';

  const validStatus = new Set(['all', 'paid', 'current', 'part-paid', 'overdue']);
  const status = validStatus.has(statusFilter) ? statusFilter : 'all';

  return { page, pageSize, sortKey, sortDir, search, statusFilter: status, cashLeakageOnly };
}

function compareListRows(a, b, key) {
  switch (key) {
    case 'invoice':
      return (a.invoiceNumber ?? a.platformInvoiceId).localeCompare(
        b.invoiceNumber ?? b.platformInvoiceId,
      );
    case 'patient':
      return (a.patientName ?? '').localeCompare(b.patientName ?? '');
    case 'practice':
      return a.practiceName.localeCompare(b.practiceName);
    case 'raised':
      return (a.invoiceDate ?? '').localeCompare(b.invoiceDate ?? '');
    case 'amount':
      return a.amountGbp - b.amountGbp;
    case 'outstanding':
      return a.outstandingGbp - b.outstandingGbp;
    case 'age':
      return a.daysPastDue - b.daysPastDue;
    case 'status':
      return deriveInvoiceDisplayStatus(a).localeCompare(deriveInvoiceDisplayStatus(b));
    default:
      return 0;
  }
}

function sortListRows(rows, sortKey, sortDir) {
  const mul = sortDir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const cmp = compareListRows(a, b, sortKey);
    if (cmp !== 0) return mul * cmp;
    if (sortKey === 'outstanding' && sortDir === 'desc') {
      return (a.invoiceDate ?? '').localeCompare(b.invoiceDate ?? '');
    }
    return 0;
  });
}

function filterListRows(rows, { search, statusFilter, cashLeakageOnly }) {
  let list = rows;
  if (cashLeakageOnly) list = list.filter((r) => r.isCashLeakage);
  if (statusFilter !== 'all') {
    list = list.filter((r) => deriveInvoiceDisplayStatus(r) === statusFilter);
  }
  if (search) {
    list = list.filter((r) => {
      const hay = [
        r.invoiceNumber,
        r.platformInvoiceId,
        r.patientName,
        r.practiceName,
        r.locationName,
        r.patientId != null ? String(r.patientId) : '',
        r.status,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(search);
    });
  }
  return list;
}

async function loadPeriodAndUnits(practiceId, userId, scope = {}) {
  const [assumptions, { rollupMode, units }] = await Promise.all([
    loadPeEconomicAssumptions(practiceId),
    resolvePeRollupUnits(userId, practiceId),
  ]);
  const trailingMonths = assumptions.collectionRateTrailingMonths || 12;
  const cashLeakageWindowDays = assumptions.cashLeakageCollectionWindowDays || 30;
  const agingBucketBoundaryDays = assumptions.agingBucketBoundaryDays || [30, 60, 90];
  const today = todayUtcYmd();
  const periodStart = scope.startDate || trailingSinceIsoDate(trailingMonths);
  const periodEnd = scope.endDate || today;
  return {
    assumptions,
    trailingMonths,
    cashLeakageWindowDays,
    agingBucketBoundaryDays,
    today,
    periodStart,
    periodEnd,
    rollupMode,
    units,
  };
}

async function buildMappedInvoiceContext(practiceId, userId, scope = {}) {
  const meta = await loadPeriodAndUnits(practiceId, userId, scope);
  const scopedIds = [...new Set(meta.units.map((u) => u.organizationId))];

  const rpcRows = await loadMappedRowsViaRpc(
    scopedIds,
    scope.locationId || null,
    meta.periodStart,
    meta.periodEnd,
    {
      today: meta.today,
      cashLeakageWindowDays: meta.cashLeakageWindowDays,
      agingBucketBoundaryDays: meta.agingBucketBoundaryDays,
    },
  );
  // pe_invoices_mapped_rows filters worklist rows by invoice_date (raised) within period.

  const allListRows = rpcRows.map((row) => mapRpcRowToListRow(row));

  const displayListRows = allListRows.filter(isMatchedInvoiceListRow);
  const contextOutstanding = resolveContextOutstanding(
    allListRows,
    practiceId,
    meta.units,
    scope,
  );

  return {
    practiceId,
    ...meta,
    scopedIds,
    allListRows,
    displayListRows,
    contextOutstanding,
  };
}

function mappedContextCache(practiceId, userId, scope, fn) {
  return withPeReadCache('invoices-mapped', practiceId, fn, {
    ttlMs: 60_000,
    extra: `${userId}:${scopeCacheExtra(scope)}`,
  });
}

function loadMappedInvoiceContextCached(practiceId, userId, scope = {}) {
  return mappedContextCache(practiceId, userId, scope, () =>
    buildMappedInvoiceContext(practiceId, userId, scope),
  );
}

async function buildCollectionByLocation(practiceId, userId, scope = {}) {
  const meta = await loadPeriodAndUnits(practiceId, userId, scope);
  const units = filterUnitsByLocation(meta.units, scope);
  const scopedIds = [...new Set(units.map((u) => u.organizationId))];
  const collectionByPractice = await loadCollectionTotalsViaRpc(
    units,
    meta.periodStart,
    meta.periodEnd,
  );
  return {
    practiceId,
    trailingMonths: meta.trailingMonths,
    trailingSince: meta.periodStart,
    rollupMode: meta.rollupMode,
    scopedIds,
    collectionByPractice,
  };
}

function loadCollectionByLocationCached(practiceId, userId, scope = {}) {
  return withPeReadCache(
    'invoices-collection-by-location',
    practiceId,
    () => buildCollectionByLocation(practiceId, userId, scope),
    { ttlMs: 60_000, extra: `${userId}:${scopeCacheExtra(scope)}` },
  );
}

function outstandingKpis(ctx) {
  const totalOutstandingGbp = round2(
    ctx.contextOutstanding.reduce((s, r) => s + r.outstandingGbp, 0),
  );
  const overdue60PlusGbp = round2(
    ctx.contextOutstanding
      .filter((r) => r.daysPastDue > 60)
      .reduce((s, r) => s + r.outstandingGbp, 0),
  );
  const paymentPlanPatients = new Set();
  let onPaymentPlanOutstandingGbp = 0;
  for (const row of ctx.allListRows) {
    if (!row.isOutstanding || !row.onPaymentPlan) continue;
    onPaymentPlanOutstandingGbp += row.outstandingGbp;
    if (row.patientId != null) paymentPlanPatients.add(`${row.practiceId}:${row.patientId}`);
  }
  return {
    totalOutstandingGbp,
    overdue60PlusGbp,
    onPaymentPlanOutstandingGbp: round2(onPaymentPlanOutstandingGbp),
    onPaymentPlanArrangementCount: paymentPlanPatients.size,
    agedBuckets: buildAgedBuckets(ctx.contextOutstanding),
  };
}

function cashLeakageKpis(ctx) {
  const cashLeakageRows = ctx.allListRows.filter((r) => r.isCashLeakage);
  return {
    cashLeakageCount: cashLeakageRows.length,
    cashLeakageGbp: round2(cashLeakageRows.reduce((s, r) => s + r.outstandingGbp, 0)),
  };
}

async function getInvoicesHero(practiceId, userId, scope = {}) {
  const locationScope = scopeLocationOnly(scope);
  const meta = await loadPeriodAndUnits(practiceId, userId, scope);
  const orgIds = [...new Set(meta.units.map((u) => u.organizationId))];
  const [kpis, kpisLocation, collection] = await Promise.all([
    loadOutstandingKpisCached(practiceId, userId, scope, meta, orgIds),
    loadOutstandingKpisCached(practiceId, userId, locationScope, meta, orgIds),
    loadCollectionByLocationCached(practiceId, userId, scope),
  ]);
  const invoicedAll = round2(
    collection.collectionByPractice.reduce((s, r) => s + r.invoicedGbp, 0),
  );
  const collectedAll = round2(
    collection.collectionByPractice.reduce((s, r) => s + r.collectedGbp, 0),
  );
  const collectionRateAll =
    invoicedAll > 0 ? round2(collectedAll / invoicedAll) : null;
  const contextRow =
    collection.collectionByPractice.find((r) => r.practiceId === practiceId) ??
    collection.collectionByPractice.find((r) => collection.scopedIds.includes(r.practiceId)) ??
    collection.collectionByPractice[0];

  return {
    practiceId,
    trailingMonths: meta.trailingMonths,
    trailingSince: meta.periodStart,
    rollupMode: meta.rollupMode,
    invoicedTrailingGbp: invoicedAll,
    collectedTrailingGbp: collectedAll,
    collectionRate: collectionRateAll,
    contextInvoicedGbp: contextRow?.invoicedGbp ?? 0,
    contextCollectedGbp: contextRow?.collectedGbp ?? 0,
    contextCollectionRate: contextRow?.collectionRate ?? null,
    totalOutstandingGbp: kpis.totalOutstandingGbp,
    overdue60PlusGbp: kpis.overdue60PlusGbp,
    onPaymentPlanOutstandingGbp: kpisLocation.onPaymentPlanOutstandingGbp,
    onPaymentPlanArrangementCount: kpisLocation.onPaymentPlanArrangementCount,
  };
}

async function getInvoicesAgedDebt(practiceId, userId, scope = {}) {
  const meta = await loadPeriodAndUnits(practiceId, userId, scope);
  const orgIds = [...new Set(meta.units.map((u) => u.organizationId))];
  const kpis = await loadOutstandingKpisCached(
    practiceId,
    userId,
    scope,
    meta,
    orgIds,
  );
  return {
    practiceId,
    trailingMonths: meta.trailingMonths,
    trailingSince: meta.periodStart,
    rollupMode: meta.rollupMode,
    totalOutstandingGbp: kpis.totalOutstandingGbp,
    agedBuckets: kpis.agedBuckets,
  };
}

async function getInvoicesCollectionByLocation(practiceId, userId, scope = {}) {
  const collection = await loadCollectionByLocationCached(practiceId, userId, scope);
  return {
    practiceId,
    trailingMonths: collection.trailingMonths,
    trailingSince: collection.trailingSince,
    rollupMode: collection.rollupMode,
    collectionByPractice: collection.collectionByPractice,
  };
}

async function getInvoicesList(practiceId, userId, scope = {}, listQuery = {}) {
  const listParams = parseListParams(listQuery);
  const ctx = await loadMappedInvoiceContextCached(practiceId, userId, scope);
  const leakage = cashLeakageKpis(ctx);
  const filtered = filterListRows(ctx.displayListRows, listParams);
  const sorted = sortListRows(filtered, listParams.sortKey, listParams.sortDir);
  const total = sorted.length;
  const start = (listParams.page - 1) * listParams.pageSize;
  const invoiceListRows = sorted.slice(start, start + listParams.pageSize);

  return {
    practiceId,
    trailingMonths: ctx.trailingMonths,
    trailingSince: ctx.periodStart,
    cashLeakageWindowDays: ctx.cashLeakageWindowDays,
    rollupMode: ctx.rollupMode,
    ...leakage,
    invoiceListRows,
    total,
    page: listParams.page,
    pageSize: listParams.pageSize,
    sort: listParams.sortKey,
    sortDir: listParams.sortDir,
  };
}

/**
 * Combined invoices tab payload (legacy). Prefer the four split reads.
 */
async function getInvoicesSummary(practiceId, userId, scope = {}, listQuery = {}) {
  const [hero, aged, collection, list] = await Promise.all([
    getInvoicesHero(practiceId, userId, scope),
    getInvoicesAgedDebt(practiceId, userId, scope),
    getInvoicesCollectionByLocation(practiceId, userId, scope),
    getInvoicesList(practiceId, userId, scope, listQuery),
  ]);

  return {
    practiceId,
    trailingMonths: hero.trailingMonths,
    trailingSince: hero.trailingSince,
    cashLeakageWindowDays: list.cashLeakageWindowDays,
    rollupMode: hero.rollupMode,
    cashLeakageCount: list.cashLeakageCount,
    cashLeakageGbp: list.cashLeakageGbp,
    totalOutstandingGbp: hero.totalOutstandingGbp,
    overdue60PlusGbp: hero.overdue60PlusGbp,
    collectedTrailingGbp: hero.collectedTrailingGbp,
    invoicedTrailingGbp: hero.invoicedTrailingGbp,
    collectionRate: hero.collectionRate,
    onPaymentPlanOutstandingGbp: hero.onPaymentPlanOutstandingGbp,
    onPaymentPlanArrangementCount: hero.onPaymentPlanArrangementCount,
    agedBuckets: aged.agedBuckets,
    collectionByPractice: collection.collectionByPractice,
    invoiceListRows: list.invoiceListRows,
    total: list.total,
    page: list.page,
    pageSize: list.pageSize,
    sort: list.sort,
    sortDir: list.sortDir,
  };
}

/**
 * Cached wrapper for invoices summary + paginated list.
 */
async function getInvoicesSummaryCached(practiceId, userId, scope = {}, listQuery = {}) {
  const extra = `${scopeCacheExtra(scope)}:${JSON.stringify(parseListParams(listQuery))}`;
  return withPeReadCache(
    'invoices-summary',
    practiceId,
    () => getInvoicesSummary(practiceId, userId, scope, listQuery),
    { ttlMs: 60_000, extra },
  );
}

async function getInvoicesHeroCached(practiceId, userId, scope = {}) {
  return withPeReadCache(
    'invoices-hero',
    practiceId,
    () => getInvoicesHero(practiceId, userId, scope),
    { ttlMs: 60_000, extra: `${userId}:${scopeCacheExtra(scope)}` },
  );
}

async function getInvoicesAgedDebtCached(practiceId, userId, scope = {}) {
  const locationScope = scopeLocationOnly(scope);
  return withPeReadCache(
    'invoices-aged-debt',
    practiceId,
    () => getInvoicesAgedDebt(practiceId, userId, scope),
    { ttlMs: 60_000, extra: `${userId}:${scopeCacheExtra(locationScope)}` },
  );
}

async function getInvoicesCollectionByLocationCached(practiceId, userId, scope = {}) {
  return withPeReadCache(
    'invoices-collection-by-location',
    practiceId,
    () => getInvoicesCollectionByLocation(practiceId, userId, scope),
    { ttlMs: 60_000, extra: `${userId}:${scopeCacheExtra(scope)}` },
  );
}

async function getInvoicesListCached(practiceId, userId, scope = {}, listQuery = {}) {
  const extra = `${userId}:${scopeCacheExtra(scope)}:${JSON.stringify(parseListParams(listQuery))}`;
  return withPeReadCache(
    'invoices-list',
    practiceId,
    () => getInvoicesList(practiceId, userId, scope, listQuery),
    { ttlMs: 60_000, extra },
  );
}

module.exports = {
  getInvoicesSummary,
  getInvoicesSummaryCached,
  getInvoicesHeroCached,
  getInvoicesAgedDebtCached,
  getInvoicesCollectionByLocationCached,
  getInvoicesListCached,
  parseListParams,
  isMatchedInvoiceListRow,
};
