/**
 * Chunked refresh of PE contribution fact tables (avoids single-statement view scan timeout).
 */

const { supabaseAdmin } = require('../../config/supabase');

const PAGE_SIZE = 1000;
const UPSERT_CHUNK = 200;

const INVOICE_VIEW_SELECT =
  'practice_id, invoice_id, platform_invoice_id, invoice_date, patient_id, pt_id, ' +
  'revenue_private_plan, revenue_nhs, nhs_excluded_amount, is_private_or_plan, is_nhs, ' +
  'dominant_practitioner_id, private_share_rate, has_missing_practitioner, has_missing_rate, ' +
  'revenue_no_practitioner, revenue_missing_rate, clinician_cost, lab_cost, materials_cost, ' +
  'membership_service_cost, allocated_cac, direct_cost, contribution, ' +
  'contribution_provenance_status, revenue_tier, clinician_cost_tier, lab_cost_tier, ' +
  'material_cost_tier, membership_service_cost_tier, allocated_cac_tier, contribution_tier, ' +
  'confidence_score, confidence';

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function mapInvoiceFactRow(row) {
  return {
    practice_id: row.practice_id,
    invoice_id: row.invoice_id,
    platform_invoice_id: row.platform_invoice_id,
    invoice_date: row.invoice_date,
    patient_id: row.patient_id,
    pt_id: row.pt_id,
    revenue_private_plan: num(row.revenue_private_plan),
    revenue_nhs: num(row.revenue_nhs),
    nhs_excluded_amount: num(row.nhs_excluded_amount),
    is_private_or_plan: Boolean(row.is_private_or_plan),
    is_nhs: Boolean(row.is_nhs),
    dominant_practitioner_id: row.dominant_practitioner_id,
    private_share_rate: row.private_share_rate,
    has_missing_practitioner: Boolean(row.has_missing_practitioner),
    has_missing_rate: Boolean(row.has_missing_rate),
    revenue_no_practitioner: num(row.revenue_no_practitioner),
    revenue_missing_rate: num(row.revenue_missing_rate),
    clinician_cost: num(row.clinician_cost),
    lab_cost: num(row.lab_cost),
    materials_cost: num(row.materials_cost),
    membership_service_cost: num(row.membership_service_cost),
    allocated_cac: num(row.allocated_cac),
    direct_cost: num(row.direct_cost),
    contribution: num(row.contribution),
    contribution_provenance_status: String(row.contribution_provenance_status || 'complete'),
    revenue_tier: row.revenue_tier,
    clinician_cost_tier: row.clinician_cost_tier,
    lab_cost_tier: row.lab_cost_tier,
    material_cost_tier: row.material_cost_tier,
    membership_service_cost_tier: row.membership_service_cost_tier,
    allocated_cac_tier: row.allocated_cac_tier,
    contribution_tier: row.contribution_tier,
    confidence_score: row.confidence_score,
    confidence: row.confidence,
    refreshed_at: new Date().toISOString(),
  };
}

async function upsertInChunks(table, rows, onConflict) {
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK);
    const { error } = await supabaseAdmin.from(table).upsert(chunk, { onConflict });
    if (error) throw new Error(`${table} upsert: ${error.message}`);
  }
}

async function refreshInvoiceFacts(practiceId) {
  const { error: delErr } = await supabaseAdmin
    .from('pe_invoice_contribution_facts')
    .delete()
    .eq('practice_id', practiceId);
  if (delErr) throw new Error(`pe_invoice_contribution_facts delete: ${delErr.message}`);

  let offset = 0;
  let total = 0;

  for (let page = 0; page < 500; page++) {
    const { data, error } = await supabaseAdmin
      .from('v_invoice_contribution')
      .select(INVOICE_VIEW_SELECT)
      .eq('practice_id', practiceId)
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw new Error(`v_invoice_contribution page ${page}: ${error.message}`);

    const batch = data ?? [];
    if (batch.length === 0) break;

    const rows = batch.map(mapInvoiceFactRow);
    await upsertInChunks('pe_invoice_contribution_facts', rows, 'practice_id,invoice_id');

    total += batch.length;
    if (batch.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return total;
}

function accumulateInvoiceIntoPatientMap(map, row) {
  if (!row.patient_id) return;
  const pid = String(row.patient_id);
  let agg = map.get(pid);
  if (!agg) {
    agg = {
      practice_id: row.practice_id,
      patient_id: row.patient_id,
      pt_id: row.pt_id,
      contribution: 0,
      revenue_private_plan: 0,
      invoice_count: 0,
      confidence_score_sum: 0,
    };
    map.set(pid, agg);
  }
  agg.contribution += num(row.contribution);
  agg.revenue_private_plan += num(row.revenue_private_plan);
  agg.invoice_count += 1;
  agg.confidence_score_sum += num(row.confidence_score);
  if (row.pt_id != null) agg.pt_id = row.pt_id;
}

function patientRowsFromAggMap(map, retentionByPatient) {
  const rows = [];
  for (const [pid, agg] of map.entries()) {
    rows.push({
      practice_id: agg.practice_id,
      patient_id: agg.patient_id,
      pt_id: agg.pt_id,
      retention_status: retentionByPatient.get(pid) ?? 'active',
      contribution: round2(agg.contribution),
      revenue_private_plan: round2(agg.revenue_private_plan),
      invoice_count: agg.invoice_count,
      confidence_score:
        agg.invoice_count > 0
          ? Math.round(agg.confidence_score_sum / agg.invoice_count)
          : null,
      refreshed_at: new Date().toISOString(),
    });
  }
  return rows;
}

async function refreshPatientFacts(practiceId, retentionByPatient) {
  const { error: delErr } = await supabaseAdmin
    .from('pe_patient_contribution_facts')
    .delete()
    .eq('practice_id', practiceId);
  if (delErr) throw new Error(`pe_patient_contribution_facts delete: ${delErr.message}`);

  const patientAgg = new Map();
  let offset = 0;

  for (let page = 0; page < 500; page++) {
    const { data, error } = await supabaseAdmin
      .from('pe_invoice_contribution_facts')
      .select(
        'practice_id, patient_id, pt_id, contribution, revenue_private_plan, confidence_score',
      )
      .eq('practice_id', practiceId)
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw new Error(`pe_invoice_contribution_facts page ${page}: ${error.message}`);

    const batch = data ?? [];
    for (const row of batch) {
      accumulateInvoiceIntoPatientMap(patientAgg, row);
    }

    if (batch.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  const patientRows = patientRowsFromAggMap(patientAgg, retentionByPatient);

  for (const [pid, status] of retentionByPatient.entries()) {
    if (patientAgg.has(pid)) continue;
    patientRows.push({
      practice_id: practiceId,
      patient_id: pid,
      retention_status: status,
      contribution: 0,
      revenue_private_plan: 0,
      invoice_count: 0,
      refreshed_at: new Date().toISOString(),
    });
  }

  if (patientRows.length > 0) {
    await upsertInChunks(
      'pe_patient_contribution_facts',
      patientRows,
      'practice_id,patient_id',
    );
  }

  return patientRows.length;
}

async function loadRetentionByPatient(practiceId) {
  const map = new Map();
  let offset = 0;

  for (let page = 0; page < 500; page++) {
    const { data, error } = await supabaseAdmin
      .from('v_pe_retention_segment')
      .select('patient_id, retention_status')
      .eq('practice_id', practiceId)
      .range(offset, offset + PAGE_SIZE - 1);

    if (error && error.code === '42P01') break;
    if (error) throw new Error(`v_pe_retention_segment page ${page}: ${error.message}`);

    const batch = data ?? [];
    for (const row of batch) {
      if (row.patient_id == null) continue;
      map.set(String(row.patient_id), String(row.retention_status || 'active'));
    }

    if (batch.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return map;
}

async function refreshPracticeFacts(practiceId) {
  const { data, error } = await supabaseAdmin.rpc('pe_practice_contribution_row', {
    p_practice_id: practiceId,
  });

  if (error) throw new Error(`pe_practice_contribution_row: ${error.message}`);
  if (!data || typeof data !== 'object') return;

  const row = {
    practice_id: practiceId,
    invoice_count: num(data.invoice_count),
    invoices_with_revenue: num(data.invoices_with_revenue),
    patient_count: num(data.patient_count),
    patients_with_revenue: num(data.patients_with_revenue),
    revenue_private_plan: num(data.revenue_private_plan),
    clinician_cost: num(data.clinician_cost),
    direct_cost: num(data.direct_cost),
    contribution: num(data.contribution),
    margin_pct: data.margin_pct != null ? num(data.margin_pct) : null,
    invoices_complete: num(data.invoices_complete),
    invoices_partial_no_practitioner: num(data.invoices_partial_no_practitioner),
    invoices_partial_missing_rate: num(data.invoices_partial_missing_rate),
    pct_complete: data.pct_complete != null ? num(data.pct_complete) : null,
    pct_partial_no_practitioner:
      data.pct_partial_no_practitioner != null ? num(data.pct_partial_no_practitioner) : null,
    pct_partial_missing_rate:
      data.pct_partial_missing_rate != null ? num(data.pct_partial_missing_rate) : null,
    contribution_provenance_status: String(data.contribution_provenance_status || 'complete'),
    revenue_tier: data.revenue_tier,
    clinician_cost_tier: data.clinician_cost_tier,
    lab_cost_tier: data.lab_cost_tier,
    material_cost_tier: data.material_cost_tier,
    contribution_tier: data.contribution_tier,
    confidence_score: data.confidence_score,
    refreshed_at: new Date().toISOString(),
  };

  const { error: upsertErr } = await supabaseAdmin
    .from('pe_practice_contribution_facts')
    .upsert(row, { onConflict: 'practice_id' });

  if (upsertErr) throw new Error(`pe_practice_contribution_facts upsert: ${upsertErr.message}`);
}

/**
 * @param {string} practiceId
 * @returns {Promise<{ invoiceCount: number, patientCount: number }>}
 */
async function refreshPeContributionFacts(practiceId) {
  console.log(`[PE facts] Refresh start practice=${practiceId}`);

  const invoiceCount = await refreshInvoiceFacts(practiceId);
  console.log(`[PE facts] Invoice facts: ${invoiceCount} rows`);

  const retentionByPatient = await loadRetentionByPatient(practiceId);
  console.log(`[PE facts] Retention segment: ${retentionByPatient.size} patients`);

  const patientCount = await refreshPatientFacts(practiceId, retentionByPatient);
  console.log(`[PE facts] Patient facts: ${patientCount} rows`);

  await refreshPracticeFacts(practiceId);
  console.log(`[PE facts] Practice facts updated`);

  const { syncReactivationFlagsForPractice } = require('./peReactivationFlags');
  syncReactivationFlagsForPractice(practiceId).catch((err) => {
    console.warn(`[PE facts] reactivation flag sync failed: ${err.message}`);
  });

  return { invoiceCount, patientCount };
}

module.exports = {
  refreshPeContributionFacts,
};
