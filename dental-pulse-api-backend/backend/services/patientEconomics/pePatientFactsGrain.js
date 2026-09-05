/**
 * Pure helpers for PE patient-facts grain (matched UUID vs orphan pt_id).
 * Kept free of Supabase so unit tests can run without env.
 */

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Stable patient-facts grain: matched UUID, or pt:<dentally_pt_id> for orphans.
 * @param {{ patient_id?: string | null, pt_id?: number | string | null }} row
 * @returns {string | null}
 */
function patientFactsGrainKey(row) {
  if (row.patient_id != null && String(row.patient_id).trim()) {
    return String(row.patient_id).trim();
  }
  if (row.pt_id != null && String(row.pt_id).trim() !== '') {
    return `pt:${row.pt_id}`;
  }
  return null;
}

function accumulateInvoiceIntoPatientMap(map, row) {
  const grainKey = patientFactsGrainKey(row);
  if (!grainKey) return;

  let agg = map.get(grainKey);
  if (!agg) {
    agg = {
      practice_id: row.practice_id,
      patient_id: row.patient_id ?? null,
      pt_id: row.pt_id ?? null,
      contribution: 0,
      revenue_private_plan: 0,
      invoice_count: 0,
      confidence_score_sum: 0,
      min_invoice_date: null,
    };
    map.set(grainKey, agg);
  }
  agg.contribution += num(row.contribution);
  agg.revenue_private_plan += num(row.revenue_private_plan);
  agg.invoice_count += 1;
  agg.confidence_score_sum += num(row.confidence_score);
  if (row.pt_id != null) agg.pt_id = row.pt_id;
  if (row.patient_id != null) agg.patient_id = row.patient_id;
  if (row.invoice_date != null) {
    const date = String(row.invoice_date).slice(0, 10);
    if (!agg.min_invoice_date || date < agg.min_invoice_date) {
      agg.min_invoice_date = date;
    }
  }
}

function patientLifetimeFields(agg, firstVisitByPtId, today) {
  const {
    earliestActivityDate,
    tenureYearsFromFirstActivity,
  } = require('./patientLifetimeLogic');

  const ptKey =
    agg.pt_id != null && Number.isFinite(Number(agg.pt_id))
      ? String(agg.pt_id)
      : null;
  const firstActivity = earliestActivityDate(
    ptKey ? firstVisitByPtId.get(ptKey) ?? null : null,
    agg.min_invoice_date,
  );
  const tenureYears = firstActivity
    ? tenureYearsFromFirstActivity(firstActivity, today)
    : null;

  return {
    first_activity_date: firstActivity,
    tenure_years: tenureYears,
  };
}

function patientRowsFromAggMap(map, retentionByPatient, locationByPatient, firstVisitByPtId, today) {
  const rows = [];
  for (const agg of map.values()) {
    const matchedId =
      agg.patient_id != null && String(agg.patient_id).trim()
        ? String(agg.patient_id).trim()
        : null;
    const location = matchedId ? locationByPatient.get(matchedId) ?? {} : {};
    const lifetime =
      firstVisitByPtId && today
        ? patientLifetimeFields(agg, firstVisitByPtId, today)
        : { first_activity_date: null, tenure_years: null };
    rows.push({
      practice_id: agg.practice_id,
      patient_id: matchedId,
      pt_id: agg.pt_id,
      retention_status: matchedId
        ? retentionByPatient.get(matchedId) ?? 'active'
        : 'active',
      contribution: round2(agg.contribution),
      revenue_private_plan: round2(agg.revenue_private_plan),
      invoice_count: agg.invoice_count,
      confidence_score:
        agg.invoice_count > 0
          ? Math.round(agg.confidence_score_sum / agg.invoice_count)
          : null,
      location_id: location.locationId ?? null,
      first_activity_date: lifetime.first_activity_date,
      tenure_years: lifetime.tenure_years,
      refreshed_at: new Date().toISOString(),
    });
  }
  return rows;
}

/** Table display only — orphan Dentally pt_ids have no patients row. KPIs still include them. */
function isMatchedInvoiceListRow(row) {
  return row != null && row.patientRecordId != null;
}

module.exports = {
  patientFactsGrainKey,
  accumulateInvoiceIntoPatientMap,
  patientRowsFromAggMap,
  isMatchedInvoiceListRow,
};
