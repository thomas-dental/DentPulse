/**
 * computePatientModelledScores — Modelled-tier CLTV projection + Quality Score.
 *
 * Inputs (synced Dentally / Day 2.5 contribution):
 *   - v_patient_contribution: revenue, contribution, invoice_count, confidence_score
 *   - patients: is_active, recall dates, payment plan
 *   - appointments: completed visits in trailing 12 months (visit frequency)
 *
 * Provenance: all outputs tagged tier = "Modelled". confidence_score reflects
 * contribution data quality plus coverage of engagement signals (not a fixed spec).
 *
 * ---------------------------------------------------------------------------
 * CLTV projection (first-pass heuristic — NOT contractual methodology)
 * ---------------------------------------------------------------------------
 *   historical     = contribution to date (invoice rollup)
 *   perVisit       = contribution / max(invoice_count, 1)
 *   visitsPerYear  = min(completed_appts_last_12m, 6) — cap outliers
 *   annualRunRate  = perVisit * max(visitsPerYear, 0.5) when patient is active
 *                    else perVisit * visitsPerYear (may be 0)
 *
 *   retentionMultiplier = activeFactor * recallFactor * engagementFactor
 *     activeFactor:   1.0 if is_active else 0.30
 *     recallFactor:   1.0 both recalls future; 0.65 any overdue ≤90d;
 *                     0.35 overdue >90d; 0.85 if no recall dates
 *     engagementFactor: min(visitsPerYear / 2, 1.0) — 2 visits/year = full
 *
 *   discountFactor = Σ_{t=1..5} 1/(1+0.10)^t ≈ 3.7908 (5yr @ 10%)
 *   futureValue    = annualRunRate * retentionMultiplier * discountFactor
 *   cltv_projection = round(historical + futureValue, 2)
 *
 * ---------------------------------------------------------------------------
 * Quality Score (0–100 composite)
 * ---------------------------------------------------------------------------
 *   dataQuality  = contribution confidence_score (or pct_complete fallback)
 *   engagement   = min(visitsPerYear / 2 * 100, 100)
 *   recallScore  = 90 future >30d; 70 due within 30d; 55 overdue ≤90d;
 *                  25 overdue >90d; 50 no recall dates
 *   activeScore  = 100 if is_active else 25
 *   planBonus    = +5 if payment plan (capped at 100 total)
 *
 *   quality_score = round(0.30*dataQuality + 0.25*engagement + 0.25*recallScore
 *                           + 0.20*activeScore + planBonus)
 *
 * ---------------------------------------------------------------------------
 * Modelled confidence_score (0–100, capped at 75 — heuristic tier ceiling)
 * ---------------------------------------------------------------------------
 *   60% contribution confidence + 25% appointment signal + 15% recall signal
 */

const { supabaseAdmin } = require('../../config/supabase');
const {
  getPracticePatValidity,
  listPracticesWithEncryptedPat,
  practiceNeedsReconnection,
} = require('./sync/credentialsStatus');
const { recordTick } = require('./sync/peTickHistory');
const {
  loadPeEconomicAssumptions,
  discountFactorFromAssumptions,
} = require('./peEconomicAssumptions');
const { withStableOrder } = require('./peStablePagination');

const HORIZON_YEARS = 5;
const DISCOUNT_RATE = 0.10;
const DISCOUNT_FACTOR = Array.from({ length: HORIZON_YEARS }, (_, i) =>
  1 / (1 + DISCOUNT_RATE) ** (i + 1),
).reduce((a, b) => a + b, 0);

const MODELLED_TIER = 'Modelled';
const PAGE_SIZE = 500;
const UPSERT_BATCH = 100;

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function daysBetween(fromDate, toDate) {
  const a = new Date(`${fromDate}T00:00:00.000Z`);
  const b = new Date(`${toDate}T00:00:00.000Z`);
  return Math.round((b - a) / 86_400_000);
}

function todayUtcDate() {
  return new Date().toISOString().slice(0, 10);
}

function twelveMonthsAgoUtcDate() {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - 12);
  return d.toISOString().slice(0, 10);
}

/**
 * Recall adherence from dentist + hygienist recall dates vs today.
 * @returns {{ factor: number, score: number }}
 */
function recallSignals(dentistRecall, hygienistRecall, today) {
  const dates = [dentistRecall, hygienistRecall].filter(Boolean);
  if (dates.length === 0) {
    return { factor: 0.85, score: 50 };
  }

  let worstOverdueDays = 0;
  let bestFutureDays = null;

  for (const raw of dates) {
    const days = daysBetween(raw, today);
    if (days < 0) {
      const ahead = -days;
      if (bestFutureDays === null || ahead > bestFutureDays) {
        bestFutureDays = ahead;
      }
    } else if (days > worstOverdueDays) {
      worstOverdueDays = days;
    }
  }

  if (worstOverdueDays > 90) {
    return { factor: 0.35, score: 25 };
  }
  if (worstOverdueDays > 0) {
    return { factor: 0.65, score: 55 };
  }
  if (bestFutureDays !== null && bestFutureDays <= 30) {
    return { factor: 1.0, score: 70 };
  }
  return { factor: 1.0, score: 90 };
}

function computeScores(row, visitsLast12m, today, scoreAssumptions = {}) {
  const visitsCap = scoreAssumptions.visitsPerYearCap ?? 6;
  const minVisitsActive = scoreAssumptions.minVisitsPerYearActive ?? 0.5;
  const inactiveFactor = scoreAssumptions.inactiveRetentionFactor ?? 0.3;
  const fullEngagementVisits = scoreAssumptions.fullEngagementVisitsPerYear ?? 2;
  const planBonusPts = scoreAssumptions.qualityScorePlanBonus ?? 5;
  const discountFactor = scoreAssumptions.discountFactor ?? DISCOUNT_FACTOR;

  const contribution = num(row.contribution);
  const invoiceCount = Math.max(1, num(row.invoice_count));
  const perVisit = contribution / invoiceCount;
  const visitsPerYear = Math.min(visitsLast12m, visitsCap);
  const isActive = row.is_active === true;

  const annualRunRate = isActive
    ? perVisit * Math.max(visitsPerYear, minVisitsActive)
    : perVisit * visitsPerYear;

  const recall = recallSignals(
    row.pt_dentist_recall_date,
    row.pt_hygienist_recall_date,
    today,
  );
  const activeFactor = isActive ? 1.0 : inactiveFactor;
  const engagementFactor = Math.min(visitsPerYear / fullEngagementVisits, 1.0);
  const retentionMultiplier = activeFactor * recall.factor * engagementFactor;

  const futureValue = annualRunRate * retentionMultiplier * discountFactor;
  const cltvProjection = Math.round((contribution + futureValue) * 100) / 100;

  const dataQuality =
    row.confidence_score != null
      ? num(row.confidence_score)
      : num(row.pct_complete) || 50;
  const engagement = Math.min((visitsPerYear / fullEngagementVisits) * 100, 100);
  const activeScore = isActive ? 100 : 25;
  const planBonus = row.pt_payment_plan_id != null ? planBonusPts : 0;

  let qualityScore = Math.round(
    0.3 * dataQuality +
      0.25 * engagement +
      0.25 * recall.score +
      0.2 * activeScore +
      planBonus,
  );
  qualityScore = Math.min(100, Math.max(0, qualityScore));

  const hasAppointmentSignal = visitsLast12m > 0;
  const hasRecallSignal =
    row.pt_dentist_recall_date != null || row.pt_hygienist_recall_date != null;

  let confidenceScore = Math.round(
    0.6 * dataQuality +
      0.25 * (hasAppointmentSignal ? 70 : 40) +
      0.15 * (hasRecallSignal ? 65 : 45),
  );
  confidenceScore = Math.min(75, Math.max(25, confidenceScore));

  return {
    cltv_projection: cltvProjection,
    quality_score: qualityScore,
    cltv_tier: MODELLED_TIER,
    quality_score_tier: MODELLED_TIER,
    confidence_score: confidenceScore,
  };
}

async function loadVisitCountsByPtId(practiceId, sinceIso) {
  const counts = new Map();
  let offset = 0;
  for (let page = 0; page < 200; page++) {
    const query = withStableOrder(
      supabaseAdmin
        .from('appointments')
        .select('apmt_patient_id, apmt_completed_at, apmt_state')
        .eq('organization_id', practiceId)
        .is('deleted_at', null)
        .gte('apmt_start_time', sinceIso),
      'appointments',
    );
    const { data, error } = await query.range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`appointments visit counts: ${error.message}`);
    const rows = data || [];
    for (const row of rows) {
      if (row.apmt_patient_id == null) continue;
      const completed =
        row.apmt_completed_at != null ||
        String(row.apmt_state || '').toLowerCase() === 'completed';
      if (!completed) continue;
      const key = String(row.apmt_patient_id);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return counts;
}

async function loadPatientContributionPage(practiceId, offset) {
  const select =
    'practice_id, patient_id, pt_id, contribution, invoice_count, confidence_score';

  const { data: factsData, error: factsError } = await withStableOrder(
    supabaseAdmin.from('pe_patient_contribution_facts').select(select).eq('practice_id', practiceId),
    'pe_patient_contribution_facts',
  ).range(offset, offset + PAGE_SIZE - 1);

  if (!factsError && (factsData?.length > 0 || offset > 0)) {
    return (factsData ?? []).map((row) => ({
      ...row,
      pct_complete: null,
    }));
  }

  const { data, error } = await withStableOrder(
    supabaseAdmin
      .from('v_patient_contribution')
      .select(
        'practice_id, patient_id, pt_id, contribution, invoice_count, confidence_score, pct_complete',
      )
      .eq('practice_id', practiceId),
    'v_patient_contribution',
  ).range(offset, offset + PAGE_SIZE - 1);
  if (error) throw new Error(`v_patient_contribution: ${error.message}`);
  return data || [];
}

async function enrichPatients(practiceId, patientIds) {
  const map = new Map();
  if (patientIds.length === 0) return map;

  for (let i = 0; i < patientIds.length; i += PAGE_SIZE) {
    const chunk = patientIds.slice(i, i + PAGE_SIZE);
    const { data, error } = await supabaseAdmin
      .from('patients')
      .select(
        'id, is_active, pt_id, pt_dentist_recall_date, pt_hygienist_recall_date, pt_payment_plan_id',
      )
      .eq('organization_id', practiceId)
      .in('id', chunk)
      .is('deleted_at', null);
    if (error) throw new Error(`patients enrich: ${error.message}`);
    for (const row of data || []) {
      map.set(row.id, row);
    }
  }
  return map;
}

async function upsertScores(practiceId, rows, computedAt) {
  let upserted = 0;
  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    const batch = rows.slice(i, i + UPSERT_BATCH).map((r) => ({
      practice_id: practiceId,
      patient_id: r.patient_id,
      cltv_projection: r.cltv_projection,
      quality_score: r.quality_score,
      cltv_tier: r.cltv_tier,
      quality_score_tier: r.quality_score_tier,
      confidence_score: r.confidence_score,
      computed_at: computedAt,
    }));
    const { error } = await supabaseAdmin
      .from('patient_economics_modelled_scores')
      .upsert(batch, { onConflict: 'practice_id,patient_id' });
    if (error) throw new Error(`upsert modelled scores: ${error.message}`);
    upserted += batch.length;
  }
  return upserted;
}

/**
 * @param {string} practiceId organization_id / practice UUID
 * @returns {Promise<{ practiceId: string, patients: number, upserted: number, computedAt: string }>}
 */
async function computeModelledScoresForPractice(practiceId) {
  const assumptions = await loadPeEconomicAssumptions(practiceId);
  const scoreAssumptions = {
    visitsPerYearCap: assumptions.modelledVisitsPerYearCap,
    minVisitsPerYearActive: assumptions.modelledMinVisitsPerYearActive,
    inactiveRetentionFactor: assumptions.modelledInactiveRetentionFactor,
    fullEngagementVisitsPerYear: assumptions.modelledFullEngagementVisitsPerYear,
    qualityScorePlanBonus: assumptions.modelledQualityScorePlanBonus,
    discountFactor: discountFactorFromAssumptions(assumptions),
  };
  const today = todayUtcDate();
  const sinceIso = `${twelveMonthsAgoUtcDate()}T00:00:00.000Z`;
  const computedAt = new Date().toISOString();

  const visitCounts = await loadVisitCountsByPtId(practiceId, sinceIso);

  const scored = [];
  let offset = 0;
  for (let page = 0; page < 200; page++) {
    const contribPage = await loadPatientContributionPage(practiceId, offset);
    if (contribPage.length === 0) break;

    const patientIds = contribPage.map((r) => r.patient_id).filter(Boolean);
    const patients = await enrichPatients(practiceId, patientIds);

    for (const row of contribPage) {
      const patient = patients.get(row.patient_id) || {};
      const merged = {
        ...row,
        is_active: patient.is_active,
        pt_dentist_recall_date: patient.pt_dentist_recall_date,
        pt_hygienist_recall_date: patient.pt_hygienist_recall_date,
        pt_payment_plan_id: patient.pt_payment_plan_id,
      };
      const ptIdKey =
        patient.pt_id != null
          ? String(patient.pt_id)
          : row.pt_id != null
            ? String(row.pt_id)
            : null;
      const visits = ptIdKey ? visitCounts.get(ptIdKey) || 0 : 0;
      const scores = computeScores(merged, visits, today, scoreAssumptions);
      scored.push({
        patient_id: row.patient_id,
        ...scores,
      });
    }

    if (contribPage.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  const upserted = await upsertScores(practiceId, scored, computedAt);

  return {
    practiceId,
    patients: scored.length,
    upserted,
    computedAt,
  };
}

/**
 * Scheduled tick — all practices with valid PAT (same gate as kickoff).
 * @param {{ practiceId?: string, maxPractices?: number }} opts
 */
async function runModelledComputeTick(opts = {}) {
  const maxPractices = Number(
    opts.maxPractices || process.env.PE_MODELLED_MAX_PRACTICES || 20,
  );
  const results = [];

  if (opts.practiceId) {
    const validity = await getPracticePatValidity(opts.practiceId);
    if (!validity.ok) {
      const out = {
        practiceId: opts.practiceId,
        skipped: true,
        reason: validity.reason || 'invalid_pat',
      };
      recordTick({ kind: 'modelled_compute', practicesConsidered: 1, skipped: 1, results: [out] });
      return { practicesConsidered: 1, processed: 0, skipped: 1, results: [out] };
    }
    const result = await computeModelledScoresForPractice(opts.practiceId);
    results.push({ ...result, skipped: false });
    recordTick({
      kind: 'modelled_compute',
      practicesConsidered: 1,
      processed: 1,
      results: [{ practiceId: opts.practiceId, patients: result.patients }],
    });
    return { practicesConsidered: 1, processed: 1, skipped: 0, results };
  }

  const candidates = await listPracticesWithEncryptedPat(maxPractices * 2);
  let considered = 0;

  for (const row of candidates) {
    if (results.length >= maxPractices) break;
    considered += 1;
    const practiceId = row.practiceId;
    if (await practiceNeedsReconnection(practiceId)) {
      results.push({ practiceId, skipped: true, reason: 'needs_reconnection' });
      continue;
    }
    const validity = await getPracticePatValidity(practiceId);
    if (!validity.ok) {
      results.push({ practiceId, skipped: true, reason: validity.reason });
      continue;
    }
    try {
      const result = await computeModelledScoresForPractice(practiceId);
      results.push({ ...result, skipped: false });
    } catch (err) {
      console.error(
        `[PE modelled] Failed for ${practiceId.slice(0, 8)}…:`,
        err.message,
      );
      results.push({ practiceId, skipped: true, error: err.message });
    }
  }

  const processed = results.filter((r) => !r.skipped).length;
  recordTick({
    kind: 'modelled_compute',
    practicesConsidered: considered,
    processed,
    results: results.map((r) => ({
      practiceId: r.practiceId,
      skipped: r.skipped === true,
      patients: r.patients || 0,
      reason: r.reason || r.error || null,
    })),
  });

  return { practicesConsidered: considered, processed, skipped: results.length - processed, results };
}

module.exports = {
  computeModelledScoresForPractice,
  runModelledComputeTick,
  MODELLED_TIER,
};
