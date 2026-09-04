/**
 * Patient Economics read API — mirrors frontend hooks that previously queried Supabase directly.
 * All PE UI list/detail/summary surfaces should call these via economicsEngine routes.
 */

const { supabaseAdmin } = require('../../config/supabase');
const {
  parseRetentionStatus,
  parseRetentionStatusTier,
  retentionDisplayFromRow,
} = require('./peRetentionSegmentation');

const { queryInPatientChunks } = require('./pePatientQueryChunks');
const { withStableOrder, DEFAULT_PAGE_SIZE } = require('./peStablePagination');
const FINANCIAL_RECORD_VIEW = 'v_patient_financial_record';

const PAGE_SIZE = DEFAULT_PAGE_SIZE;
const PATIENT_META_CHUNK = 50;
const PATIENT_IN_CHUNK = 100;
const FINANCIAL_RECORD_IN_CHUNK = 25;

const FINANCIAL_RECORD_SELECT =
  'practice_id, patient_id, pt_id, patient_name, patient_uuid, location_id, invoice_count, invoices_with_revenue, ' +
  'revenue_private_plan, clinician_cost, direct_cost, contribution, margin_pct, invoices_complete, ' +
  'invoices_partial_no_practitioner, invoices_partial_missing_rate, pct_complete, ' +
  'contribution_provenance_status, revenue_tier, clinician_cost_tier, contribution_tier, confidence_score, ' +
  'retention_status, retention_status_tier, opportunity_gross, opportunity_gross_tier, ' +
  'opportunity_weighted, opportunity_weighted_tier, opportunity_weighted_tier_note, ' +
  'patient_economic_value, patient_economic_value_tier, patient_economic_value_tier_note, ' +
  'quality_score, recommended_action, recommended_action_tier, recommended_action_tier_note, ' +
  'cltv_projection, cltv_tier, quality_score_tier, modelled_confidence_score, modelled_computed_at';

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function ukDentalFinancialYear(d) {
  const month = d.getMonth();
  const year = d.getFullYear();
  return month >= 3 ? year : year - 1;
}

function displayName(rawName, ptId) {
  const trimmed = String(rawName ?? '').trim();
  if (trimmed) return trimmed;
  if (ptId != null) return `Patient #${ptId}`;
  return 'Unknown patient';
}

function parseProvenanceStatus(raw) {
  const s = String(raw || 'complete');
  if (s === 'partial_no_practitioner' || s === 'partial_missing_rate') return s;
  return 'complete';
}

function twelveMonthsAgoIsoDate() {
  const d = new Date();
  d.setMonth(d.getMonth() - 12);
  return d.toISOString().slice(0, 10);
}

function formatRecallHint(dentistRecall, hygienistRecall) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const labels = [];

  const fmt = (raw) => {
    const d = new Date(`${raw.slice(0, 10)}T00:00:00`);
    return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
  };

  if (dentistRecall) {
    const d = new Date(`${dentistRecall.slice(0, 10)}T00:00:00`);
    if (d >= today) labels.push(`dentist recall ${fmt(dentistRecall)}`);
  }
  if (hygienistRecall) {
    const d = new Date(`${hygienistRecall.slice(0, 10)}T00:00:00`);
    if (d >= today) labels.push(`hygienist recall ${fmt(hygienistRecall)}`);
  }

  if (labels.length === 0) {
    const past = [dentistRecall, hygienistRecall]
      .filter(Boolean)
      .map((r) => new Date(`${String(r).slice(0, 10)}T00:00:00`))
      .filter((d) => d < today)
      .sort((a, b) => b.getTime() - a.getTime());
    if (past.length > 0) {
      return `recall overdue since ${fmt(past[0].toISOString().slice(0, 10))}`;
    }
    return null;
  }

  return labels[0];
}

async function getPracticeName(practiceId) {
  const { data, error } = await supabaseAdmin
    .from('organizations')
    .select('name')
    .eq('id', practiceId)
    .maybeSingle();
  if (error) throw error;
  return data?.name?.trim() || 'This practice';
}

async function loadLocationsForOrg(practiceId) {
  const { data, error } = await supabaseAdmin
    .from('practice_locations')
    .select('id, location_name')
    .eq('organization_id', practiceId)
    .is('deleted_at', null)
    .order('location_name');

  if (error) throw error;

  return (data ?? [])
    .map((row) => ({
      id: String(row.id),
      name: String(row.location_name || 'Site').trim() || 'Site',
    }))
    .filter((row) => row.id.length > 0);
}

function resolveRollupModeFromLocations(locations) {
  return locations.length > 1 ? 'location' : 'practice';
}

function membershipPlanIdsFromAccounts(raw) {
  const ids = new Set();
  const push = (v) => {
    if (v == null) return;
    if (typeof v === 'number' && Number.isFinite(v)) {
      ids.add(v);
      return;
    }
    if (typeof v === 'string') {
      const t = v.trim();
      if (/^\d+$/.test(t)) ids.add(Number(t));
      return;
    }
    if (typeof v === 'object' && v !== null) {
      const o = v;
      push(o.id ?? o.pp_id ?? o.external_id ?? o.value);
    }
  };
  if (Array.isArray(raw)) {
    for (const item of raw) push(item);
  }
  return ids;
}

async function loadMembershipPlanIds(practiceId) {
  const { data, error } = await supabaseAdmin
    .from('practice_locations')
    .select('membership_income_accounts, provider_membership_income_accounts, membership_income_source')
    .eq('organization_id', practiceId);

  if (error) {
    console.warn('[PE read] membership plan lookup failed:', error.message);
    return loadMembershipPlanIdsFromDentallyPlans(practiceId);
  }

  const ids = new Set();
  for (const row of data ?? []) {
    const source = String(row.membership_income_source || '').trim().toLowerCase();
    if (source && source !== 'pms' && source !== 'dentally') continue;
    for (const id of membershipPlanIdsFromAccounts(row.membership_income_accounts)) ids.add(id);
    for (const id of membershipPlanIdsFromAccounts(row.provider_membership_income_accounts)) {
      ids.add(id);
    }
  }

  if (ids.size === 0) return loadMembershipPlanIdsFromDentallyPlans(practiceId);
  return ids;
}

async function loadMembershipPlanIdsFromDentallyPlans(practiceId) {
  const ids = new Set();
  for (let from = 0; from < 20_000; from += PAGE_SIZE) {
    const query = withStableOrder(
      supabaseAdmin
        .from('payment_plans')
        .select('pp_id, pp_patient_friendly_name, pp_monthly_memberhsip_fee')
        .eq('organization_id', practiceId)
        .is('deleted_at', null),
      'payment_plans',
    );

    const { data, error } = await query.range(from, from + PAGE_SIZE - 1);

    if (error) {
      console.warn('[PE read] payment_plans fallback:', error.message);
      break;
    }
    const rows = data ?? [];
    if (rows.length === 0) break;

    for (const row of rows) {
      const fee = num(row.pp_monthly_memberhsip_fee);
      const name = String(row.pp_patient_friendly_name || '').toLowerCase();
      const looksMembership =
        fee > 0 ||
        /practice\s*plan|denplan|membership|member\s*plan|capitation|subscription/.test(name);
      if (!looksMembership) continue;
      const id = num(row.pp_id);
      if (id) ids.add(id);
    }
    if (rows.length < PAGE_SIZE) break;
  }
  return ids;
}

async function loadMemberPatientPtIds(practiceId, membershipPpIds) {
  if (membershipPpIds.size === 0) return new Set();

  const ppList = [...membershipPpIds];
  const memberPts = new Set();
  for (let from = 0; from < 50_000; from += PAGE_SIZE) {
    const query = withStableOrder(
      supabaseAdmin
        .from('patients')
        .select('pt_id, pt_payment_plan_id')
        .eq('organization_id', practiceId)
        .is('deleted_at', null)
        .in('pt_payment_plan_id', ppList),
      'patients',
    );

    const { data, error } = await query.range(from, from + PAGE_SIZE - 1);

    if (error) {
      console.warn('[PE read] member patients lookup failed:', error.message);
      break;
    }
    const rows = data ?? [];
    for (const row of rows) {
      const pt = num(row.pt_id);
      if (pt) memberPts.add(pt);
    }
    if (rows.length < PAGE_SIZE) break;
  }
  return memberPts;
}

async function loadUdaLens(practiceId, scope = {}) {
  const {
    hasDateScope,
    hasLocationScope,
    dayAfterYmd,
    prorateAnnualByMonthRange,
  } = require('./peReadScope');

  const empty = {
    udaDeliveryPct: null,
    udaClawbackGbp: null,
    udaOnTarget: null,
    hasNhsContract: false,
    nhsContractValue: 0,
    udaDelivered: 0,
    udaObligation: 0,
  };

  const anchorDate = hasDateScope(scope)
    ? new Date(`${scope.startDate}T00:00:00`)
    : new Date();
  const fy = ukDentalFinancialYear(anchorDate);

  let settingsQuery = supabaseAdmin
    .from('uda_settings')
    .select('nhs_contract_value, total_uda_obligation, location_id, contract_type')
    .eq('organization_id', practiceId)
    .eq('financial_year', fy)
    .eq('contract_type', 'NHS');

  if (hasLocationScope(scope)) {
    settingsQuery = settingsQuery.eq('location_id', scope.locationId);
  }

  const { data: settings, error: settingsErr } = await settingsQuery;

  if (settingsErr) {
    console.warn('[PE read] uda_settings:', settingsErr.message);
    return empty;
  }

  const rows = settings ?? [];
  if (rows.length === 0) return empty;

  let obligation = 0;
  let contractValue = 0;
  for (const r of rows) {
    obligation += num(r.total_uda_obligation);
    contractValue += num(r.nhs_contract_value);
  }

  if (obligation <= 0 && contractValue <= 0) return empty;

  if (hasDateScope(scope)) {
    obligation = prorateAnnualByMonthRange(obligation, scope.startDate, scope.endDate);
    contractValue = prorateAnnualByMonthRange(contractValue, scope.startDate, scope.endDate);
  }

  let claimsQuery = supabaseAdmin
    .from('nhs_claims')
    .select('delivered:nc_expected_uda.sum()')
    .eq('organization_id', practiceId)
    .eq('nc_claim_status', 'completed')
    .is('deleted_at', null);

  if (hasLocationScope(scope)) {
    claimsQuery = claimsQuery.eq('location_id', scope.locationId);
  }

  if (hasDateScope(scope)) {
    const endExclusive = dayAfterYmd(scope.endDate);
    claimsQuery = claimsQuery
      .gte('nc_submitted_date', scope.startDate)
      .lt('nc_submitted_date', endExclusive);
  } else {
    const fyStart = `${fy}-04-01`;
    const now = new Date();
    const fyEndExclusive = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
    )
      .toISOString()
      .slice(0, 10);
    claimsQuery = claimsQuery.gte('nc_submitted_date', fyStart).lt('nc_submitted_date', fyEndExclusive);
  }

  const { data: udaSumRows, error: udaSumErr } = await claimsQuery;

  if (udaSumErr) {
    console.warn('[PE read] nhs_claims:', udaSumErr.message);
  }
  const delivered = Math.round(num(udaSumRows?.[0]?.delivered) * 100) / 100;

  const hasNhsContract = obligation > 0 || contractValue > 0;
  if (!hasNhsContract) return empty;

  const deliveryPct = obligation > 0 ? Math.round((delivered / obligation) * 1000) / 10 : null;
  const onTarget = deliveryPct != null ? deliveryPct >= 96 : null;
  const clawback =
    deliveryPct != null && deliveryPct < 100 && contractValue > 0
      ? Math.round(((100 - deliveryPct) / 100) * contractValue)
      : deliveryPct != null
        ? 0
        : null;

  return {
    udaDeliveryPct: deliveryPct,
    udaClawbackGbp: clawback,
    udaOnTarget: onTarget,
    hasNhsContract: true,
    nhsContractValue: contractValue,
    udaDelivered: delivered,
    udaObligation: obligation,
  };
}

function locationFromRow(row) {
  const locationId = row.location_id != null ? String(row.location_id) : null;
  const locationNameRaw = row.location_name;
  const locationName =
    locationNameRaw != null && String(locationNameRaw).trim().length > 0
      ? String(locationNameRaw).trim()
      : null;
  return { locationId, locationName };
}

function mapContributionRowFromFacts(row, practiceName) {
  const ptIdRaw = row.pt_id;
  const ptId =
    ptIdRaw == null || ptIdRaw === ''
      ? null
      : Number.isFinite(Number(ptIdRaw))
        ? Number(ptIdRaw)
        : null;

  const matchedId =
    row.patient_id != null && String(row.patient_id).trim() !== ''
      ? String(row.patient_id).trim()
      : null;

  // Orphans (no patients row) still participate in summary KPIs; tables hide them.
  if (!matchedId && ptId == null) {
    return null;
  }

  const { locationId, locationName } = locationFromRow(row);

  return {
    patientId: matchedId,
    ptId,
    patientName: matchedId ? displayName(null, ptId) : ptId != null ? `Patient #${ptId}` : 'Unknown patient',
    patientUuid: null,
    practiceName,
    locationId: matchedId ? locationId : null,
    locationName: matchedId ? locationName : null,
    isActive: false,
    hasPaymentPlan: false,
    contribution12mo: 0,
    visits12mo: 0,
    visitFreqPerYear: null,
    valuePerVisit: null,
    invoiceCount: num(row.invoice_count),
    invoicesWithRevenue: 0,
    revenuePrivatePlan: num(row.revenue_private_plan),
    clinicianCost: 0,
    directCost: 0,
    contribution: num(row.contribution),
    marginPct: null,
    invoicesComplete: 0,
    invoicesPartialNoPractitioner: 0,
    invoicesPartialMissingRate: 0,
    pctComplete: null,
    contributionProvenanceStatus: 'complete',
    revenueTier: 'Dentally',
    clinicianCostTier: 'Derived',
    contributionTier: 'Derived',
    confidenceScore: row.confidence_score == null ? null : num(row.confidence_score),
    retentionStatus: parseRetentionStatus(row.retention_status),
    retentionStatusTier: 'Modelled',
    opportunityGross: 0,
    opportunityGrossTier: 'Derived',
    opportunityWeighted: 0,
    opportunityWeightedTier: 'Modelled',
    opportunityWeightedTierNote: null,
    opportunityWeightConfidence: 0,
    patientEconomicValue: num(row.contribution),
    patientEconomicValueTier: 'Derived',
    patientEconomicValueTierNote: null,
    qualityScore: null,
    recommendedAction: null,
    recommendedActionTier: null,
    recommendedActionTierNote: null,
    cltvProjection: null,
    cltvTier: null,
    qualityScoreTier: null,
    modelledConfidenceScore: null,
    modelledComputedAt: null,
  };
}

async function loadFinancialRecordByPatientIds(practiceId, patientIds) {
  const map = new Map();
  if (patientIds.length === 0) return map;

  const rows = await queryInPatientChunks(
    patientIds,
    (chunk) =>
      supabaseAdmin
        .from(FINANCIAL_RECORD_VIEW)
        .select(FINANCIAL_RECORD_SELECT)
        .eq('practice_id', practiceId)
        .in('patient_id', chunk),
    FINANCIAL_RECORD_IN_CHUNK,
  );

  for (const row of rows) {
    if (row.patient_id == null) continue;
    map.set(String(row.patient_id), row);
  }
  return map;
}

async function assertPatientFactsReady(practiceId) {
  const { count, error } = await supabaseAdmin
    .from('pe_patient_contribution_facts')
    .select('*', { count: 'exact', head: true })
    .eq('practice_id', practiceId);

  if (error && error.code !== '42P01') throw error;
  if (!count || count === 0) {
    throw new Error(
      'PE contribution facts not refreshed for this practice. Run: node backend/scripts/refreshPeContributionFacts.js <practice_id>',
    );
  }
}

function mapContributionRowFromView(row, practiceName) {
  const status = parseProvenanceStatus(row.contribution_provenance_status);
  const ptIdRaw = row.pt_id;
  const ptId =
    ptIdRaw == null || ptIdRaw === ''
      ? null
      : Number.isFinite(Number(ptIdRaw))
        ? Number(ptIdRaw)
        : null;
  const { locationId, locationName } = locationFromRow(row);

  return {
    patientId: String(row.patient_id),
    ptId,
    patientName: displayName(row.patient_name, ptId),
    patientUuid:
      row.patient_uuid != null && String(row.patient_uuid).length > 0
        ? String(row.patient_uuid)
        : null,
    practiceName,
    locationId,
    locationName,
    isActive: false,
    hasPaymentPlan: false,
    contribution12mo: 0,
    visits12mo: 0,
    visitFreqPerYear: null,
    valuePerVisit: null,
    invoiceCount: num(row.invoice_count),
    invoicesWithRevenue: num(row.invoices_with_revenue),
    revenuePrivatePlan: num(row.revenue_private_plan),
    clinicianCost: num(row.clinician_cost),
    directCost: num(row.direct_cost),
    contribution: num(row.contribution),
    marginPct: row.margin_pct == null ? null : num(row.margin_pct),
    invoicesComplete: num(row.invoices_complete),
    invoicesPartialNoPractitioner: num(row.invoices_partial_no_practitioner),
    invoicesPartialMissingRate: num(row.invoices_partial_missing_rate),
    pctComplete: row.pct_complete == null ? null : num(row.pct_complete),
    contributionProvenanceStatus: status,
    revenueTier: String(row.revenue_tier || 'Dentally'),
    clinicianCostTier: String(row.clinician_cost_tier || 'Derived'),
    contributionTier: String(row.contribution_tier || 'Derived'),
    confidenceScore: row.confidence_score == null ? null : num(row.confidence_score),
    retentionStatus: parseRetentionStatus(row.retention_status),
    retentionStatusTier: parseRetentionStatusTier(row.retention_status_tier),
    opportunityGross: num(row.opportunity_gross),
    opportunityGrossTier: String(row.opportunity_gross_tier || 'Derived'),
    opportunityWeighted: num(row.opportunity_weighted),
    opportunityWeightedTier: String(row.opportunity_weighted_tier || 'Modelled'),
    opportunityWeightedTierNote:
      row.opportunity_weighted_tier_note != null
        ? String(row.opportunity_weighted_tier_note)
        : null,
    opportunityWeightConfidence: 0,
    patientEconomicValue: num(row.patient_economic_value),
    patientEconomicValueTier: String(row.patient_economic_value_tier || 'Modelled'),
    patientEconomicValueTierNote:
      row.patient_economic_value_tier_note != null
        ? String(row.patient_economic_value_tier_note)
        : null,
    qualityScore: num(row.quality_score),
    recommendedAction: String(row.recommended_action || 'monitor'),
    recommendedActionTier: String(row.recommended_action_tier || 'Modelled'),
    recommendedActionTierNote:
      row.recommended_action_tier_note != null
        ? String(row.recommended_action_tier_note)
        : null,
  };
}

function mapFinancialRecordRow(row, practiceName) {
  const base = mapContributionRowFromView(row, practiceName);
  const cltvRaw = row.cltv_projection;
  const cltvProjection = cltvRaw == null || cltvRaw === '' ? null : num(cltvRaw);
  const modelledAt = row.modelled_computed_at;
  return {
    ...base,
    cltvProjection,
    cltvTier: cltvProjection != null ? String(row.cltv_tier || 'Modelled') : null,
    qualityScoreTier:
      cltvProjection != null ? String(row.quality_score_tier || 'Modelled') : null,
    modelledConfidenceScore:
      row.modelled_confidence_score == null ? null : num(row.modelled_confidence_score),
    modelledComputedAt:
      modelledAt != null && String(modelledAt).length > 0 ? String(modelledAt) : null,
  };
}

function modelledFromFinancialRecordRow(row) {
  if (row.cltvProjection == null) return null;
  return {
    cltvProjection: row.cltvProjection,
    qualityScore: row.qualityScore,
    cltvTier: row.cltvTier ?? 'Modelled',
    qualityScoreTier: row.qualityScoreTier ?? 'Modelled',
    confidenceScore: row.modelledConfidenceScore ?? 0,
    computedAt: row.modelledComputedAt ?? '',
  };
}

function mapInvoiceRow(row, dentallyMeta = {}) {
  const dentallyPatientUuid = dentallyMeta.dentallyPatientUuid ?? null;
  const accountUuid = dentallyMeta.accountUuid ?? null;
  const invoiceUuid = dentallyMeta.invoiceUuid ?? null;
  const { buildDentallyInvoiceUrl } = require('./dentallyDeepLinks');

  return {
    invoiceId: String(row.invoice_id),
    platformInvoiceId:
      row.platform_invoice_id != null ? String(row.platform_invoice_id) : null,
    invoiceDate: row.invoice_date != null ? String(row.invoice_date) : null,
    revenuePrivatePlan: num(row.revenue_private_plan),
    revenueNhs: num(row.revenue_nhs),
    clinicianCost: num(row.clinician_cost),
    labCost: num(row.lab_cost),
    materialsCost: num(row.materials_cost),
    directCost: num(row.direct_cost),
    contribution: num(row.contribution),
    privateShareRate: row.private_share_rate == null ? null : num(row.private_share_rate),
    contributionProvenanceStatus: parseProvenanceStatus(row.contribution_provenance_status),
    revenueTier: String(row.revenue_tier || 'Dentally'),
    clinicianCostTier: String(row.clinician_cost_tier || 'Derived'),
    contributionTier: String(row.contribution_tier || 'Derived'),
    confidenceScore: row.confidence_score == null ? null : num(row.confidence_score),
    dentallyPatientUuid,
    invoiceUuid,
    accountUuid,
    dentallyInvoiceUrl: buildDentallyInvoiceUrl({
      dentallyPatientUuid,
      accountUuid,
      invoiceUuid,
    }),
  };
}

async function loadAccountUuidByDaIdMap(practiceId) {
  const map = new Map();
  const { data, error } = await supabaseAdmin
    .from('dentally_patients_accounts')
    .select('da_id, da_uuid')
    .eq('organization_id', practiceId)
    .is('deleted_at', null);

  if (error) throw error;

  for (const row of data ?? []) {
    if (row.da_id != null && row.da_uuid) {
      map.set(Number(row.da_id), String(row.da_uuid));
    }
  }
  return map;
}

async function loadDentallyPatientUuid(practiceId, patientId) {
  const { data, error } = await supabaseAdmin
    .from('patients')
    .select('pt_unique_id')
    .eq('organization_id', practiceId)
    .eq('id', patientId)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) throw error;
  if (!data?.pt_unique_id) return null;
  const uuid = String(data.pt_unique_id).trim();
  return uuid.length > 0 ? uuid : null;
}

async function fetchContribution12moByPatient(practiceId, sinceDate, endDate = null) {
  const { forEachInvoiceGrainPage } = require('./peReadSource');
  const map = new Map();
  const since = sinceDate || twelveMonthsAgoIsoDate();

  await forEachInvoiceGrainPage(
    practiceId,
    {
      select: 'patient_id, contribution',
      applyFilters: (query) => {
        let q = query.gte('invoice_date', since);
        if (endDate) q = q.lte('invoice_date', endDate);
        return q;
      },
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

async function fetchCompletedVisits12moByPtId(practiceId) {
  const map = new Map();
  const since = twelveMonthsAgoIsoDate();

  const { data, error } = await supabaseAdmin.rpc('pe_completed_visits_12mo_by_pt', {
    p_practice_id: practiceId,
    p_since_date: since,
  });

  if (!error && data && typeof data === 'object') {
    for (const [ptId, count] of Object.entries(data)) {
      const n = Number(ptId);
      if (!Number.isFinite(n)) continue;
      map.set(n, num(count));
    }
    return map;
  }

  if (error) {
    console.error(
      `[patientEconomicsRead] pe_completed_visits_12mo_by_pt failed: ${error.message}`,
    );
  }
  return map;
}

function attachTwelveMonthMetrics(rows, contribution12mo, visitsByPtId) {
  return rows.map((row) => {
    const c12 = contribution12mo.get(row.patientId) ?? 0;
    const visits = row.ptId != null ? (visitsByPtId.get(row.ptId) ?? 0) : 0;
    const visitFreqPerYear = visits > 0 ? visits : null;
    const valuePerVisit =
      visits > 0 && c12 > 0 ? c12 / visits : visits > 0 ? 0 : null;

    return {
      ...row,
      contribution12mo: c12,
      visits12mo: visits,
      visitFreqPerYear,
      valuePerVisit,
    };
  });
}

async function enrichPatientMetadata(practiceId, rows, locationNamesById, rollupMode) {
  if (rows.length === 0) return rows;

  const meta = new Map();
  const ids = rows.map((r) => r.patientId);

  for (let i = 0; i < ids.length; i += PATIENT_META_CHUNK) {
    const chunk = ids.slice(i, i + PATIENT_META_CHUNK);
    const { data, error } = await supabaseAdmin
      .from('patients')
      .select(
        'id, is_active, pt_payment_plan_id, location_id, pt_first_name, pt_last_name, pt_id, pt_unique_id',
      )
      .eq('organization_id', practiceId)
      .in('id', chunk);

    if (error) throw error;

    for (const row of data ?? []) {
      const ptId =
        row.pt_id != null && Number.isFinite(Number(row.pt_id)) ? Number(row.pt_id) : null;
      const name =
        `${String(row.pt_first_name || '').trim()} ${String(row.pt_last_name || '').trim()}`.trim();
      const ptUnique =
        row.pt_unique_id != null && String(row.pt_unique_id).trim().length > 0
          ? String(row.pt_unique_id).trim()
          : null;
      meta.set(String(row.id), {
        isActive: row.is_active === true,
        hasPaymentPlan: row.pt_payment_plan_id != null,
        locationId: row.location_id != null ? String(row.location_id) : null,
        patientName: displayName(name, ptId),
        ptId,
        patientUuid: ptUnique,
      });
    }
  }

  return rows.map((row) => {
    const m = meta.get(row.patientId);
    const locationId = m?.locationId ?? null;
    const locationName =
      locationId != null
        ? locationNamesById.get(locationId) ?? 'Unassigned'
        : rollupMode === 'location'
          ? 'Unassigned'
          : null;

    return {
      ...row,
      patientName: m?.patientName ?? row.patientName,
      ptId: m?.ptId ?? row.ptId,
      patientUuid: m?.patientUuid ?? row.patientUuid,
      isActive: m?.isActive ?? false,
      hasPaymentPlan: m?.hasPaymentPlan ?? false,
      locationId,
      locationName,
    };
  });
}

async function fetchPatientInvoices(practiceId, patientId) {
  const { data, error } = await supabaseAdmin
    .from('v_invoice_contribution')
    .select('*')
    .eq('practice_id', practiceId)
    .eq('patient_id', patientId)
    .order('invoice_date', { ascending: false });

  if (error) throw error;

  const rows = data ?? [];
  if (rows.length === 0) return [];

  const dentallyPatientUuid = await loadDentallyPatientUuid(practiceId, patientId);
  const accountUuidByDaId = await loadAccountUuidByDaIdMap(practiceId);
  const { resolveAccountUuidFromDaId } = require('./dentallyDeepLinks');

  const invoiceIds = rows.map((r) => r.invoice_id).filter(Boolean);
  const platformMetaByInvoiceId = new Map();

  for (let i = 0; i < invoiceIds.length; i += 200) {
    const chunk = invoiceIds.slice(i, i + 200);
    const { data: invRows, error: invErr } = await supabaseAdmin
      .from('platform_integration_invoices')
      .select('id, invoice_uuid, account_id')
      .eq('organization_id', practiceId)
      .in('id', chunk);

    if (invErr) throw invErr;

    for (const inv of invRows ?? []) {
      const accountUuid = resolveAccountUuidFromDaId(inv.account_id, accountUuidByDaId);
      platformMetaByInvoiceId.set(String(inv.id), {
        invoiceUuid: inv.invoice_uuid != null ? String(inv.invoice_uuid) : null,
        accountUuid,
      });
    }
  }

  return rows.map((row) => {
    const platformMeta = platformMetaByInvoiceId.get(String(row.invoice_id)) ?? {};
    return mapInvoiceRow(row, {
      dentallyPatientUuid,
      invoiceUuid: platformMeta.invoiceUuid ?? null,
      accountUuid: platformMeta.accountUuid ?? null,
    });
  });
}

async function fetchPatientTreatmentLines(practiceId, patientId, ptId) {
  let dentallyPtId = ptId;
  if (dentallyPtId == null) {
    const { data: patientRow, error: patientErr } = await supabaseAdmin
      .from('patients')
      .select('pt_id')
      .eq('organization_id', practiceId)
      .eq('id', patientId)
      .maybeSingle();
    if (patientErr) throw patientErr;
    dentallyPtId = patientRow?.pt_id ?? null;
  }
  if (dentallyPtId == null) return [];

  const { data: invoices, error: invErr } = await supabaseAdmin
    .from('platform_integration_invoices')
    .select('id, invoice_date')
    .eq('organization_id', practiceId)
    .eq('patient_id', String(dentallyPtId))
    .is('deleted_at', null);

  if (invErr) throw invErr;
  if (!invoices?.length) return [];

  const invoiceIds = invoices.map((i) => i.id);
  const invoiceDateById = new Map(invoices.map((i) => [i.id, i.invoice_date]));

  const { data: invoiceContrib, error: contribErr } = await supabaseAdmin
    .from('v_invoice_contribution')
    .select('invoice_id, revenue_private_plan, direct_cost, contribution')
    .eq('practice_id', practiceId)
    .eq('patient_id', patientId);

  if (contribErr) throw contribErr;

  const contribByInvoice = new Map(
    (invoiceContrib ?? []).map((r) => [String(r.invoice_id), r]),
  );

  const { data: lines, error: lineErr } = await supabaseAdmin
    .from('platform_integration_invoice_line_items')
    .select(
      'id, invoice_id, item_name, description, net, line_amount, gross, practitioner_id, completed_at, service_date, tooth_ref, is_nhs',
    )
    .eq('organization_id', practiceId)
    .in('invoice_id', invoiceIds);

  if (lineErr) throw lineErr;

  const privateLines = (lines ?? []).filter((l) => !l.is_nhs);

  const practitionerExtIds = [
    ...new Set(
      privateLines
        .map((l) => l.practitioner_id)
        .filter((id) => id != null && String(id).trim() !== '')
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id)),
    ),
  ];

  const providerNameByExtId = new Map();
  if (practitionerExtIds.length > 0) {
    const { data: providers, error: providerErr } = await supabaseAdmin
      .from('providers')
      .select('external_id, name, provider_code')
      .eq('organization_id', practiceId)
      .in('external_id', practitionerExtIds);

    if (providerErr) throw providerErr;

    for (const p of providers ?? []) {
      if (p.external_id != null) {
        const label =
          (p.provider_code && p.provider_code.trim()) ||
          (p.name && p.name.trim()) ||
          `ID ${p.external_id}`;
        providerNameByExtId.set(p.external_id, label);
      }
    }
  }

  const rows = [];

  for (const line of privateLines) {
    const revenue = num(line.net ?? line.line_amount ?? line.gross ?? 0);
    if (revenue === 0) continue;

    const invContrib = contribByInvoice.get(String(line.invoice_id));
    const invRevenue = invContrib ? num(invContrib.revenue_private_plan) : revenue;
    const share = invRevenue > 0 ? revenue / invRevenue : 1;
    const cost = invContrib ? num(invContrib.direct_cost) * share : 0;
    const contribution = invContrib ? num(invContrib.contribution) * share : revenue - cost;

    const baseName =
      (line.item_name && String(line.item_name).trim()) ||
      (line.description && String(line.description).trim()) ||
      'Treatment';
    const treatmentLabel = line.tooth_ref ? `${baseName} (${line.tooth_ref})` : baseName;

    const dateRaw =
      line.completed_at?.slice(0, 10) ??
      line.service_date ??
      invoiceDateById.get(line.invoice_id ?? '');

    const clinicianName =
      line.practitioner_id != null && String(line.practitioner_id).trim() !== ''
        ? providerNameByExtId.get(Number(line.practitioner_id)) ?? '—'
        : null;

    rows.push({
      lineId: line.id,
      treatmentLabel,
      date: dateRaw != null ? String(dateRaw).slice(0, 10) : null,
      clinicianName,
      revenue,
      cost,
      contribution,
    });
  }

  rows.sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return b.date.localeCompare(a.date);
  });

  return rows;
}

async function fetchInvoiceContributionSummary(practiceId, scope = {}) {
  const { withPeReadCache } = require('./peReadCache');
  const { scopeCacheExtra } = require('./peReadScope');

  const [uda, rpcPayload] = await Promise.all([
    loadUdaLens(practiceId, scope),
    withPeReadCache('invoice-contribution-summary', practiceId, async () => {
      const { data, error } = await supabaseAdmin.rpc('pe_invoice_contribution_summary', {
        p_practice_id: practiceId,
        p_location_id: scope.locationId || null,
        p_start_date: scope.startDate || null,
        p_end_date: scope.endDate || null,
      });
      if (error) throw error;
      return data ?? {};
    }, { extra: scopeCacheExtra(scope) }),
  ]);

  const invoiceCount = num(rpcPayload.invoice_count);
  const invoicesWithRevenue = num(rpcPayload.invoices_with_revenue);
  const totalContribution = num(rpcPayload.total_contribution);
  const totalRevenue = num(rpcPayload.total_revenue);
  const revenueNhs = num(rpcPayload.revenue_nhs);
  const invoicesMissingPractitioner = num(rpcPayload.invoices_missing_practitioner);
  const invoicesMissingRate = num(rpcPayload.invoices_missing_rate);
  const revenueNoPractitioner = num(rpcPayload.revenue_no_practitioner);
  const revenueMissingRate = num(rpcPayload.revenue_missing_rate);

  let revenuePrivate = 0;
  let revenuePlan = 0;

  if (rpcPayload.revenue_private != null && rpcPayload.revenue_plan != null) {
    revenuePrivate = num(rpcPayload.revenue_private);
    revenuePlan = num(rpcPayload.revenue_plan);
    if (revenuePrivate === 0 && revenuePlan === 0 && totalRevenue > 0) {
      revenuePrivate = totalRevenue;
    }
  } else {
    const membershipPpIds = await loadMembershipPlanIds(practiceId);
    const memberPts = await loadMemberPatientPtIds(practiceId, membershipPpIds);

    if (memberPts.size > 0 && totalRevenue > 0) {
      const factsTable = 'pe_invoice_contribution_facts';
      let offset = 0;
      for (let i = 0; i < 50; i++) {
        const query = withStableOrder(
          supabaseAdmin
            .from(factsTable)
            .select('revenue_private_plan, pt_id')
            .eq('practice_id', practiceId)
            .gt('revenue_private_plan', 0),
          factsTable,
        );

        const { data, error } = await query.range(offset, offset + PAGE_SIZE - 1);

        if (error && error.code === '42P01') break;
        if (error) throw error;

        const rows = data ?? [];
        if (rows.length === 0) break;

        for (const row of rows) {
          const privatePlan = num(row.revenue_private_plan);
          const ptId = num(row.pt_id);
          if (privatePlan > 0 && ptId && memberPts.has(ptId)) {
            revenuePlan += privatePlan;
          } else {
            revenuePrivate += privatePlan;
          }
        }

        if (rows.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
      }

      if (revenuePrivate === 0 && revenuePlan === 0) {
        revenuePrivate = totalRevenue;
      }
    } else {
      revenuePrivate = totalRevenue;
    }
  }

  const hasMissingPractitioner = invoicesMissingPractitioner > 0;
  const hasMissingRate = invoicesMissingRate > 0;
  const dominantProvenanceStatus = hasMissingPractitioner
    ? 'partial_no_practitioner'
    : hasMissingRate
      ? 'partial_missing_rate'
      : 'complete';

  return {
    invoiceCount,
    invoicesWithRevenue,
    patientCount: num(rpcPayload.patient_count),
    patientsWithRevenue: num(rpcPayload.patients_with_revenue),
    totalContribution,
    totalRevenue,
    totalNhsExcluded: revenueNhs,
    revenuePrivate,
    revenuePlan,
    revenueNhs,
    invoicesMissingPractitioner,
    invoicesMissingRate,
    revenueNoPractitioner,
    revenueMissingRate,
    hasMissingPractitioner,
    hasMissingRate,
    hasPartialData: hasMissingPractitioner || hasMissingRate,
    revenueTier: 'Dentally',
    contributionTier: 'Derived',
    clinicianCostTier: dominantProvenanceStatus === 'complete' ? 'Derived' : 'External',
    dominantProvenanceStatus,
    ...uda,
  };
}

async function searchMatchingPatientIds(practiceId, search) {
  const q = String(search || '').trim().toLowerCase();
  if (!q) return null;

  const ids = new Set();

  if (/^\d+$/.test(q)) {
    const { data, error } = await supabaseAdmin
      .from('patients')
      .select('id')
      .eq('organization_id', practiceId)
      .eq('pt_id', Number(q))
      .is('deleted_at', null);
    if (error) throw error;
    for (const row of data ?? []) ids.add(String(row.id));
  }

  const pattern = `%${q}%`;
  const { data, error } = await supabaseAdmin
    .from('patients')
    .select('id, pt_first_name, pt_last_name, pt_id')
    .eq('organization_id', practiceId)
    .is('deleted_at', null)
    .or(`pt_first_name.ilike.${pattern},pt_last_name.ilike.${pattern}`)
    .limit(5000);

  if (error) throw error;

  for (const row of data ?? []) {
    const name = `${String(row.pt_first_name || '').trim()} ${String(row.pt_last_name || '').trim()}`
      .trim()
      .toLowerCase();
    if (name.includes(q) || (row.pt_id != null && String(row.pt_id).includes(q))) {
      ids.add(String(row.id));
    }
  }

  return ids;
}

async function loadScopedContributionFactStubs(practiceId, scope = {}) {
  const { data, error } = await supabaseAdmin.rpc('pe_patient_contribution_facts_scoped', {
    p_practice_id: practiceId,
    p_location_id: scope.locationId || null,
    p_start_date: scope.startDate || null,
    p_end_date: scope.endDate || null,
  });

  if (error) throw error;
  return data ?? [];
}

async function loadContributionFactStubs(practiceId, scope = {}) {
  const { hasAnyScope } = require('./peReadScope');

  if (hasAnyScope(scope)) {
    return await loadScopedContributionFactStubs(practiceId, scope);
  }

  await assertPatientFactsReady(practiceId);

  const all = [];
  let offset = 0;
  for (let page = 0; page < 50; page++) {
    const query = withStableOrder(
      supabaseAdmin
        .from('pe_patient_contribution_facts')
        .select(
          'patient_id, pt_id, retention_status, contribution, revenue_private_plan, invoice_count, confidence_score, location_id',
        )
        .eq('practice_id', practiceId),
      [
        { column: 'contribution', ascending: false },
        { column: 'patient_id', ascending: true },
      ],
    );

    const { data, error } = await query.range(offset, offset + PAGE_SIZE - 1);

    if (error) throw error;

    const batch = data ?? [];
    if (batch.length === 0) break;
    all.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return all;
}

function peRosterRpcArgs(practiceId, scope, listParams) {
  const { hasDateScope } = require('./peReadScope');
  const metricsSince = hasDateScope(scope) ? scope.startDate : twelveMonthsAgoIsoDate();
  const limit = listParams.listAll ? 10_000 : listParams.pageSize;
  const offset = listParams.listAll ? 0 : (listParams.page - 1) * listParams.pageSize;

  return {
    pageArgs: {
      p_practice_id: practiceId,
      p_location_id: scope.locationId || null,
      p_start_date: scope.startDate || null,
      p_end_date: scope.endDate || null,
      p_search: listParams.search || null,
      p_retention_filter: listParams.retentionFilter,
      p_type_filter: listParams.typeFilter,
      p_sort_key: listParams.sortKey,
      p_sort_dir: listParams.sortDir,
      p_limit: limit,
      p_offset: offset,
      p_metrics_since: metricsSince,
    },
    summaryArgs: {
      p_practice_id: practiceId,
      p_location_id: scope.locationId || null,
      p_start_date: scope.startDate || null,
      p_end_date: scope.endDate || null,
      p_search: listParams.search || null,
      p_retention_filter: listParams.retentionFilter,
      p_type_filter: listParams.typeFilter,
      p_metrics_since: metricsSince,
    },
  };
}

async function loadPeRosterListPayload(practiceId, scope, listQuery, pageRpc) {
  const { parsePatientListParams } = require('./pePatientListQuery');
  const { mapRosterPageRow, mapRosterSummaryRpc } = require('./pePatientRosterMap');

  const listParams = parsePatientListParams(listQuery);
  const { pageArgs, summaryArgs } = peRosterRpcArgs(practiceId, scope, listParams);

  const [practiceName, locations, pageRes, summaryRes] = await Promise.all([
    getPracticeName(practiceId),
    loadLocationsForOrg(practiceId),
    supabaseAdmin.rpc(pageRpc, pageArgs),
    supabaseAdmin.rpc('pe_patient_roster_summary', summaryArgs),
  ]);

  if (pageRes.error) throw pageRes.error;
  if (summaryRes.error) throw summaryRes.error;

  const summaryPayload = mapRosterSummaryRpc(
    Array.isArray(summaryRes.data) ? summaryRes.data[0] : summaryRes.data,
  );

  const patients = (pageRes.data ?? [])
    .map((row) => mapRosterPageRow(row, practiceName))
    .filter(Boolean);

  return {
    practiceId,
    practiceName,
    rollupMode: resolveRollupModeFromLocations(locations),
    locations,
    patients,
    total: summaryPayload.matchedTotal,
    totalUnfiltered: summaryPayload.matchedUnfiltered,
    page: listParams.page,
    pageSize: listParams.pageSize,
    sort: listParams.sortKey,
    sortDir: listParams.sortDir,
    summary: summaryPayload.summary,
    baselineSummary: summaryPayload.baselineSummary,
  };
}

async function getPatientContributionList(practiceId, scope = {}, listQuery = {}) {
  return loadPeRosterListPayload(practiceId, scope, listQuery, 'pe_patient_roster_page');
}

async function getPatientFinancialRecordList(practiceId, scope = {}, listQuery = {}) {
  return loadPeRosterListPayload(
    practiceId,
    scope,
    listQuery,
    'pe_patient_financial_roster_page',
  );
}

async function getPatientFinancialRecord(practiceId, patientId) {
  const [practiceNameRes, recRes, invoices] = await Promise.all([
    getPracticeName(practiceId),
    supabaseAdmin.rpc('pe_patient_financial_record', {
      p_practice_id: practiceId,
      p_patient_id: patientId,
    }),
    fetchPatientInvoices(practiceId, patientId),
  ]);

  const { mapRosterPageRow } = require('./pePatientRosterMap');

  if (recRes.error) throw recRes.error;

  const recRow = Array.isArray(recRes.data) ? recRes.data[0] : recRes.data;
  if (!recRow || recRow.patient_id == null) return null;

  const practiceName = practiceNameRes;
  const row = mapRosterPageRow(recRow, practiceName);
  row.isActive = recRow.is_active === true;
  row.hasPaymentPlan = recRow.has_payment_plan === true;

  const recallHint = formatRecallHint(
    recRow.dentist_recall_date != null ? String(recRow.dentist_recall_date) : null,
    recRow.hygienist_recall_date != null ? String(recRow.hygienist_recall_date) : null,
  );

  return {
    row,
    modelled: modelledFromFinancialRecordRow(row),
    retention: retentionDisplayFromRow(row.retentionStatus, row.retentionStatusTier),
    invoices,
    acquisitionSourceName:
      recRow.acquisition_source_name != null && String(recRow.acquisition_source_name).trim()
        ? String(recRow.acquisition_source_name).trim()
        : null,
    recallHint,
  };
}

module.exports = {
  getPatientContributionList,
  getPatientFinancialRecordList,
  getPatientFinancialRecord,
  fetchPatientTreatmentLines,
  fetchPatientInvoices,
  getInvoiceContributionSummary: fetchInvoiceContributionSummary,
};
