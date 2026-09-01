/**
 * Patient Economics read API — mirrors frontend hooks that previously queried Supabase directly.
 * All PE UI list/detail/summary surfaces should call these via economicsEngine routes.
 */

const { supabaseAdmin } = require('../../config/supabase');
const { applyCommitmentOpportunityWeighting } = require('./opportunityCommitmentWeighting');
const {
  parseRetentionStatus,
  parseRetentionStatusTier,
  retentionDisplayFromRow,
} = require('./peRetentionSegmentation');

const PAGE_SIZE = 1000;
const PATIENT_META_CHUNK = 500;
const FINANCIAL_RECORD_VIEW = 'v_patient_financial_record';

const FINANCIAL_RECORD_SELECT =
  'practice_id, patient_id, pt_id, patient_name, patient_uuid, invoice_count, invoices_with_revenue, ' +
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
    const { data, error } = await supabaseAdmin
      .from('payment_plans')
      .select('pp_id, pp_patient_friendly_name, pp_monthly_memberhsip_fee')
      .eq('organization_id', practiceId)
      .is('deleted_at', null)
      .range(from, from + PAGE_SIZE - 1);

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
    const { data, error } = await supabaseAdmin
      .from('patients')
      .select('pt_id, pt_payment_plan_id')
      .eq('organization_id', practiceId)
      .is('deleted_at', null)
      .in('pt_payment_plan_id', ppList)
      .range(from, from + PAGE_SIZE - 1);

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

async function loadUdaLens(practiceId) {
  const empty = {
    udaDeliveryPct: null,
    udaClawbackGbp: null,
    udaOnTarget: null,
    hasNhsContract: false,
    nhsContractValue: 0,
    udaDelivered: 0,
    udaObligation: 0,
  };

  const fy = ukDentalFinancialYear(new Date());

  const { data: settings, error: settingsErr } = await supabaseAdmin
    .from('uda_settings')
    .select('nhs_contract_value, total_uda_obligation, location_id, contract_type')
    .eq('organization_id', practiceId)
    .eq('financial_year', fy)
    .eq('contract_type', 'NHS');

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

  const fyStart = `${fy}-04-01`;
  const now = new Date();
  const fyEndExclusive = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  )
    .toISOString()
    .slice(0, 10);

  let delivered = 0;
  let offset = 0;
  for (let i = 0; i < 500; i++) {
    const { data, error } = await supabaseAdmin
      .from('nhs_claims')
      .select('nc_expected_uda')
      .eq('organization_id', practiceId)
      .eq('nc_claim_status', 'completed')
      .is('deleted_at', null)
      .gte('nc_submitted_date', fyStart)
      .lt('nc_submitted_date', fyEndExclusive)
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      console.warn('[PE read] nhs_claims:', error.message);
      break;
    }
    const rowsPage = data ?? [];
    if (rowsPage.length === 0) break;
    for (const r of rowsPage) {
      delivered += num(r.nc_expected_uda);
    }
    if (rowsPage.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  delivered = Math.round(delivered * 100) / 100;

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

function mapContributionRowFromView(row, practiceName) {
  const status = parseProvenanceStatus(row.contribution_provenance_status);
  const ptIdRaw = row.pt_id;
  const ptId =
    ptIdRaw == null || ptIdRaw === ''
      ? null
      : Number.isFinite(Number(ptIdRaw))
        ? Number(ptIdRaw)
        : null;

  return {
    patientId: String(row.patient_id),
    ptId,
    patientName: displayName(row.patient_name, ptId),
    patientUuid:
      row.patient_uuid != null && String(row.patient_uuid).length > 0
        ? String(row.patient_uuid)
        : null,
    practiceName,
    locationId: null,
    locationName: null,
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

function mapInvoiceRow(row) {
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
  };
}

async function fetchContribution12moByPatient(practiceId) {
  const map = new Map();
  const since = twelveMonthsAgoIsoDate();
  let offset = 0;

  for (let page = 0; page < 100; page++) {
    const { data, error } = await supabaseAdmin
      .from('v_invoice_contribution')
      .select('patient_id, contribution')
      .eq('practice_id', practiceId)
      .gte('invoice_date', since)
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw error;

    const batch = data ?? [];
    for (const row of batch) {
      if (row.patient_id == null) continue;
      const pid = String(row.patient_id);
      map.set(pid, (map.get(pid) ?? 0) + num(row.contribution));
    }

    if (batch.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return map;
}

async function fetchCompletedVisits12moByPtId(practiceId) {
  const map = new Map();
  const since = twelveMonthsAgoIsoDate();
  let offset = 0;

  for (let page = 0; page < 100; page++) {
    const { data, error } = await supabaseAdmin
      .from('appointments')
      .select('apmt_patient_id, apmt_completed_at, apmt_state')
      .eq('organization_id', practiceId)
      .gte('apmt_completed_at', `${since}T00:00:00`)
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw error;

    const batch = data ?? [];
    for (const row of batch) {
      const ptId = row.apmt_patient_id;
      if (ptId == null || !Number.isFinite(Number(ptId))) continue;
      const state = String(row.apmt_state ?? '').toLowerCase().trim();
      if (state === 'cancelled' || state === 'did not attend' || state === 'dna') continue;
      if (!row.apmt_completed_at && state !== 'completed') continue;
      const n = Number(ptId);
      map.set(n, (map.get(n) ?? 0) + 1);
    }

    if (batch.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
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
      .select('id, is_active, pt_payment_plan_id, location_id')
      .eq('organization_id', practiceId)
      .in('id', chunk);

    if (error) throw error;

    for (const row of data ?? []) {
      meta.set(String(row.id), {
        isActive: row.is_active === true,
        hasPaymentPlan: row.pt_payment_plan_id != null,
        locationId: row.location_id != null ? String(row.location_id) : null,
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
      isActive: m?.isActive ?? false,
      hasPaymentPlan: m?.hasPaymentPlan ?? false,
      locationId,
      locationName,
    };
  });
}

async function fetchAllPatientContributionRows(practiceId, practiceName) {
  const locations = await loadLocationsForOrg(practiceId);
  const rollupMode = resolveRollupModeFromLocations(locations);
  const locationNamesById = new Map(locations.map((loc) => [loc.id, loc.name]));

  const all = [];
  let offset = 0;

  for (let page = 0; page < 50; page++) {
    const { data, error } = await supabaseAdmin
      .from('v_patient_contribution')
      .select('*')
      .eq('practice_id', practiceId)
      .order('contribution', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw error;

    const rows = data ?? [];
    for (const row of rows) {
      all.push(mapContributionRowFromView(row, practiceName));
    }

    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  const withMeta = await enrichPatientMetadata(
    practiceId,
    all,
    locationNamesById,
    rollupMode,
  );
  const [contribution12mo, visitsByPtId] = await Promise.all([
    fetchContribution12moByPatient(practiceId),
    fetchCompletedVisits12moByPtId(practiceId),
  ]);
  const withMetrics = attachTwelveMonthMetrics(withMeta, contribution12mo, visitsByPtId);
  const patients = await applyCommitmentOpportunityWeighting(practiceId, withMetrics);
  return { patients, rollupMode, locations };
}

async function fetchAllFinancialRecordRows(practiceId, practiceName) {
  const locations = await loadLocationsForOrg(practiceId);
  const rollupMode = resolveRollupModeFromLocations(locations);
  const locationNamesById = new Map(locations.map((loc) => [loc.id, loc.name]));

  const all = [];
  let offset = 0;

  for (let page = 0; page < 50; page++) {
    const { data, error } = await supabaseAdmin
      .from(FINANCIAL_RECORD_VIEW)
      .select(FINANCIAL_RECORD_SELECT)
      .eq('practice_id', practiceId)
      .order('contribution', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      if (error.code === '42P01') return { patients: [], rollupMode, locations };
      throw error;
    }

    const rows = data ?? [];
    for (const row of rows) {
      all.push(mapFinancialRecordRow(row, practiceName));
    }

    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  const withMeta = await enrichPatientMetadata(
    practiceId,
    all,
    locationNamesById,
    rollupMode,
  );
  const patients = await applyCommitmentOpportunityWeighting(practiceId, withMeta);
  return { patients, rollupMode, locations };
}

async function fetchPatientInvoices(practiceId, patientId) {
  const { data, error } = await supabaseAdmin
    .from('v_invoice_contribution')
    .select('*')
    .eq('practice_id', practiceId)
    .eq('patient_id', patientId)
    .order('invoice_date', { ascending: false });

  if (error) throw error;
  return (data ?? []).map(mapInvoiceRow);
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

async function fetchInvoiceContributionSummary(practiceId) {
  const [membershipPpIds, uda] = await Promise.all([
    loadMembershipPlanIds(practiceId),
    loadUdaLens(practiceId),
  ]);
  const memberPts = await loadMemberPatientPtIds(practiceId, membershipPpIds);

  let offset = 0;
  let invoiceCount = 0;
  let invoicesWithRevenue = 0;
  let totalContribution = 0;
  let totalRevenue = 0;
  let revenuePrivate = 0;
  let revenuePlan = 0;
  let revenueNhs = 0;
  let invoicesMissingPractitioner = 0;
  let invoicesMissingRate = 0;
  let revenueNoPractitioner = 0;
  let revenueMissingRate = 0;
  const patientIds = new Set();
  const patientsWithRevenue = new Set();

  for (let i = 0; i < 200; i++) {
    const { data, error } = await supabaseAdmin
      .from('v_invoice_contribution')
      .select(
        'contribution, revenue_private_plan, revenue_nhs, nhs_excluded_amount, pt_id, patient_id, has_missing_practitioner, has_missing_rate, revenue_no_practitioner, revenue_missing_rate',
      )
      .eq('practice_id', practiceId)
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw error;
    const rows = data ?? [];
    if (rows.length === 0) break;

    for (const row of rows) {
      invoiceCount += 1;
      const privatePlan = num(row.revenue_private_plan);
      const nhs = num(row.revenue_nhs ?? row.nhs_excluded_amount);
      const contribution = num(row.contribution);
      const ptId = num(row.pt_id);

      totalRevenue += privatePlan;
      totalContribution += contribution;
      revenueNhs += nhs;

      if (privatePlan > 0 && ptId && memberPts.has(ptId)) {
        revenuePlan += privatePlan;
      } else {
        revenuePrivate += privatePlan;
      }

      if (privatePlan > 0) invoicesWithRevenue += 1;

      if (row.has_missing_practitioner) {
        invoicesMissingPractitioner += 1;
        revenueNoPractitioner += num(row.revenue_no_practitioner);
      }
      if (row.has_missing_rate) {
        invoicesMissingRate += 1;
        revenueMissingRate += num(row.revenue_missing_rate);
      }

      const patientKey =
        row.patient_id != null
          ? String(row.patient_id)
          : row.pt_id != null
            ? `pt:${row.pt_id}`
            : null;
      if (patientKey) {
        patientIds.add(patientKey);
        if (privatePlan > 0) patientsWithRevenue.add(patientKey);
      }
    }

    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
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
    patientCount: patientIds.size,
    patientsWithRevenue: patientsWithRevenue.size,
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

async function getPatientContributionList(practiceId) {
  const practiceName = await getPracticeName(practiceId);
  const { patients, rollupMode, locations } = await fetchAllPatientContributionRows(
    practiceId,
    practiceName,
  );
  return { practiceId, practiceName, rollupMode, locations, patients };
}

async function getPatientFinancialRecordList(practiceId) {
  const practiceName = await getPracticeName(practiceId);
  const { patients, rollupMode, locations } = await fetchAllFinancialRecordRows(
    practiceId,
    practiceName,
  );
  return { practiceId, practiceName, rollupMode, locations, patients };
}

async function getPatientFinancialRecord(practiceId, patientId) {
  const practiceName = await getPracticeName(practiceId);

  const { data: recordRow, error: recordErr } = await supabaseAdmin
    .from(FINANCIAL_RECORD_VIEW)
    .select(FINANCIAL_RECORD_SELECT)
    .eq('practice_id', practiceId)
    .eq('patient_id', patientId)
    .maybeSingle();

  if (recordErr) {
    if (recordErr.code === '42P01') return null;
    throw recordErr;
  }
  if (!recordRow) return null;

  const { data: patientRow, error: patientErr } = await supabaseAdmin
    .from('patients')
    .select(
      'id, is_active, pt_payment_plan_id, pt_acquisition_source_name, pt_dentist_recall_date, pt_hygienist_recall_date',
    )
    .eq('organization_id', practiceId)
    .eq('id', patientId)
    .maybeSingle();

  if (patientErr) throw patientErr;

  const [weightedRow] = await applyCommitmentOpportunityWeighting(practiceId, [
    mapFinancialRecordRow(recordRow, practiceName),
  ]);
  const row = weightedRow;
  row.isActive = patientRow?.is_active === true;
  row.hasPaymentPlan = patientRow?.pt_payment_plan_id != null;

  const recallHint = formatRecallHint(
    patientRow?.pt_dentist_recall_date != null
      ? String(patientRow.pt_dentist_recall_date)
      : null,
    patientRow?.pt_hygienist_recall_date != null
      ? String(patientRow.pt_hygienist_recall_date)
      : null,
  );

  const retention = retentionDisplayFromRow(row.retentionStatus, row.retentionStatusTier);
  const modelled = modelledFromFinancialRecordRow(row);
  const invoices = await fetchPatientInvoices(practiceId, patientId);

  return {
    row,
    modelled,
    retention,
    invoices,
    acquisitionSourceName:
      patientRow?.pt_acquisition_source_name != null &&
      String(patientRow.pt_acquisition_source_name).trim()
        ? String(patientRow.pt_acquisition_source_name).trim()
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
