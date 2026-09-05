/**
 * Shared patient list query parsing, filter, sort, and summary for PE roster APIs.
 */

const DEFAULT_LIST_PAGE_SIZE = 25;
const MAX_LIST_PAGE_SIZE = 100;

const VALID_SORT_KEYS = new Set([
  'patientName',
  'ptId',
  'revenuePrivatePlan',
  'directCost',
  'contribution',
  'contribution12mo',
  'visitFreqPerYear',
  'valuePerVisit',
  'opportunityWeighted',
  'patientEconomicValue',
  'qualityScore',
]);

const VALID_RETENTION = new Set(['all', 'active', 'drifting', 'lapsed', 'effectively_lost']);
const VALID_TYPE = new Set(['all', 'private', 'nhs', 'member']);

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function parsePatientListParams(query = {}) {
  const listAll = query.listAll === 'true' || query.listAll === true;
  const page = Math.max(1, Math.min(10_000, parseInt(String(query.page || '1'), 10) || 1));
  const rawPageSize =
    parseInt(String(query.pageSize || DEFAULT_LIST_PAGE_SIZE), 10) || DEFAULT_LIST_PAGE_SIZE;
  const pageSize = listAll
    ? Math.max(1, Math.min(10_000, rawPageSize))
    : Math.max(1, Math.min(MAX_LIST_PAGE_SIZE, rawPageSize));
  const sortRaw = String(query.sort || 'contribution');
  const sortKey = VALID_SORT_KEYS.has(sortRaw) ? sortRaw : 'contribution';
  const sortDir = String(query.sortDir || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';
  const search = String(query.search || '').trim().toLowerCase();
  const retentionRaw = String(query.retentionFilter || 'all');
  const retentionFilter = VALID_RETENTION.has(retentionRaw) ? retentionRaw : 'all';
  const typeRaw = String(query.typeFilter || 'all');
  const typeFilter = VALID_TYPE.has(typeRaw) ? typeRaw : 'all';

  return {
    page,
    pageSize,
    sortKey,
    sortDir,
    search,
    retentionFilter,
    typeFilter,
    listAll,
  };
}

function isPrivatePlanPatient(row) {
  return num(row.revenuePrivatePlan) > 0 || row.hasPaymentPlan === true;
}

function patientTypeLabel(row) {
  if (row.hasPaymentPlan) return 'Member';
  if (num(row.revenuePrivatePlan) > 0) return 'Private';
  if (num(row.contribution) > 0 || num(row.invoiceCount) > 0) return 'NHS';
  return null;
}

function matchesRetentionFilter(row, retentionFilter) {
  if (retentionFilter === 'all') return true;
  const status = String(row.retentionStatus || 'active');
  if (retentionFilter === 'active') return status === 'active';
  if (retentionFilter === 'drifting') return status === 'drifting';
  if (retentionFilter === 'lapsed') return status === 'lapsed';
  if (retentionFilter === 'effectively_lost') return status === 'effectively_lost';
  return true;
}

function matchesTypeFilter(row, typeFilter) {
  if (typeFilter === 'all') return true;
  const type = patientTypeLabel(row);
  if (typeFilter === 'member') return type === 'Member';
  if (typeFilter === 'private') return type === 'Private';
  if (typeFilter === 'nhs') return type === 'NHS';
  return true;
}

function matchesSearch(row, search) {
  if (!search) return true;
  const name = String(row.patientName || '').toLowerCase();
  if (name.includes(search)) return true;
  if (row.ptId != null && String(row.ptId).includes(search)) return true;
  return false;
}

function isDisplayablePatientRow(row) {
  return row != null && row.patientId != null && String(row.patientId).trim() !== '';
}

function filterPatientRows(rows, { search, retentionFilter, typeFilter }) {
  let out = rows;
  if (search) {
    out = out.filter((row) => matchesSearch(row, search));
  }
  if (retentionFilter !== 'all') {
    out = out.filter((row) => matchesRetentionFilter(row, retentionFilter));
  }
  if (typeFilter !== 'all') {
    out = out.filter((row) => matchesTypeFilter(row, typeFilter));
  }
  return out;
}

function contributionMarginRate(row) {
  if (row.marginPct != null && num(row.marginPct) > 0) return num(row.marginPct) / 100;
  if (num(row.revenuePrivatePlan) > 0) return num(row.contribution) / num(row.revenuePrivatePlan);
  return 0;
}

function probabilityWeightedContribution(row) {
  return num(row.opportunityWeighted) * contributionMarginRate(row);
}

function sortPatientRows(rows, sortKey, sortDir) {
  const mul = sortDir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    let av = a[sortKey];
    let bv = b[sortKey];

    if (sortKey === 'visitFreqPerYear' || sortKey === 'valuePerVisit') {
      av = a[sortKey];
      bv = b[sortKey];
    }

    if (sortKey === 'opportunityWeighted') {
      av = probabilityWeightedContribution(a);
      bv = probabilityWeightedContribution(b);
    }

    if (av == null && bv == null) {
      return mul * String(a.patientName || '').localeCompare(String(b.patientName || ''), 'en-GB');
    }
    if (av == null) return 1;
    if (bv == null) return -1;

    if (typeof av === 'string' && typeof bv === 'string') {
      return mul * av.localeCompare(bv, 'en-GB');
    }

    const an = Number(av);
    const bn = Number(bv);
    if (an === bn) {
      return mul * String(a.patientName || '').localeCompare(String(b.patientName || ''), 'en-GB');
    }
    return mul * (an - bn);
  });
}

function computePatientListSummary(rows) {
  const totalPatients = rows.length;
  if (totalPatients === 0) {
    return {
      totalPatients: 0,
      activePatients: 0,
      retentionActiveCount: 0,
      retentionDriftingCount: 0,
      retentionLapsedCount: 0,
      retentionEffectivelyLostCount: 0,
      privatePlanPatients: 0,
      memberPatients: 0,
      privateTypePatients: 0,
      nhsTypePatients: 0,
      averageContribution: 0,
      averageProjectedLtv: 0,
    };
  }

  let activePatients = 0;
  let retentionActiveCount = 0;
  let retentionDriftingCount = 0;
  let retentionLapsedCount = 0;
  let retentionEffectivelyLostCount = 0;
  let privatePlanPatients = 0;
  let memberPatients = 0;
  let privateTypePatients = 0;
  let nhsTypePatients = 0;
  let contributionSum = 0;
  let ltvSum = 0;

  for (const row of rows) {
    if (row.isActive) activePatients += 1;
    const status = String(row.retentionStatus || 'active');
    if (status === 'active') retentionActiveCount += 1;
    if (status === 'drifting') retentionDriftingCount += 1;
    if (status === 'lapsed') retentionLapsedCount += 1;
    if (status === 'effectively_lost') retentionEffectivelyLostCount += 1;
    if (isPrivatePlanPatient(row)) privatePlanPatients += 1;
    const type = patientTypeLabel(row);
    if (type === 'Member') memberPatients += 1;
    if (type === 'Private') privateTypePatients += 1;
    if (type === 'NHS') nhsTypePatients += 1;
    contributionSum += num(row.contribution12mo);
    ltvSum += num(row.patientEconomicValue);
  }

  return {
    totalPatients,
    activePatients,
    retentionActiveCount,
    retentionDriftingCount,
    retentionLapsedCount,
    retentionEffectivelyLostCount,
    privatePlanPatients,
    memberPatients,
    privateTypePatients,
    nhsTypePatients,
    averageContribution: contributionSum / totalPatients,
    averageProjectedLtv: ltvSum / totalPatients,
  };
}

module.exports = {
  DEFAULT_LIST_PAGE_SIZE,
  MAX_LIST_PAGE_SIZE,
  parsePatientListParams,
  filterPatientRows,
  sortPatientRows,
  computePatientListSummary,
  matchesSearch,
  matchesRetentionFilter,
  isDisplayablePatientRow,
};
