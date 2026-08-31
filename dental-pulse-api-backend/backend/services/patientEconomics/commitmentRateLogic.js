/**
 * Practice Commitment Rate — pure logic (no DB).
 *
 * SPEC:
 *   Commitment Rate = (value of eligible items scheduled within N days)
 *                     ÷ (total eligible planned private value)
 *
 *   Eligible item: treatment_plan_item with private treatment (treatment_type != 'nhs').
 *   Same NHS/private separation as v_invoice_contribution (is_nhs=false lines only).
 *
 *   Timing: days from plan PLAN_CREATED ledger event → first APPOINTMENT_LINKED on that plan.
 *   Window N: configurable (default 30) — pe_economic_assumptions.commitment_rate_window_days.
 *
 *   Practice-level only (per-clinician breakdown = Step 5).
 */

const DEFAULT_COMMITMENT_RATE_WINDOW_DAYS = 30;
const STANDARD_COMMITMENT_WINDOWS = [7, 30, 60, 90];

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function payloadPlanId(payload) {
  if (!payload || typeof payload !== 'object') return null;
  for (const key of ['tp_id', 'plan_id', 'ta_treatment_plan_id']) {
    const raw = payload[key];
    if (raw == null || String(raw).trim() === '') continue;
    return String(raw).trim();
  }
  return null;
}

function payloadPlannedValue(payload) {
  if (!payload || typeof payload !== 'object') return 0;
  for (const key of [
    'planned_value',
    'tp_private_treatment_value',
    'value',
    'amount',
    'total',
  ]) {
    const raw = payload[key];
    if (raw == null || raw === '') continue;
    const n = num(raw);
    if (n > 0) return n;
  }
  return 0;
}

/** UTC calendar-day difference (created → linked). */
function daysBetweenUtc(fromIso, toIso) {
  const a = new Date(fromIso);
  const b = new Date(toIso);
  const ms = b.getTime() - a.getTime();
  return Math.floor(ms / 86_400_000);
}

function isCurrentlyUnscheduled(lastLinkedAt, lastUnlinkedAt) {
  if (!lastLinkedAt) return true;
  if (!lastUnlinkedAt) return false;
  return new Date(lastUnlinkedAt) > new Date(lastLinkedAt);
}

/**
 * Aggregate plan state from ledger rows (PLAN_CREATED, LINKED, UNLINKED, COMPLETED).
 * @returns {Map<string, object>}
 */
function aggregatePlansFromLedger(ledgerRows) {
  const plans = new Map();

  for (const row of ledgerRows) {
    const planId = payloadPlanId(row.payload);
    if (!planId) continue;

    let plan = plans.get(planId);
    if (!plan) {
      plan = {
        planId,
        patientId: String(row.patient_id),
        plannedValue: 0,
        planCreatedAt: null,
        firstLinkedAt: null,
        lastLinkedAt: null,
        lastUnlinkedAt: null,
        isCompleted: false,
      };
      plans.set(planId, plan);
    }

    const createdAt = row.created_at;
    const eventType = row.event_type;

    if (eventType === 'PLAN_CREATED') {
      const pv = payloadPlannedValue(row.payload);
      if (pv > plan.plannedValue) plan.plannedValue = pv;
      if (!plan.planCreatedAt || new Date(createdAt) < new Date(plan.planCreatedAt)) {
        plan.planCreatedAt = createdAt;
      }
    } else if (eventType === 'APPOINTMENT_LINKED') {
      if (!plan.firstLinkedAt || new Date(createdAt) < new Date(plan.firstLinkedAt)) {
        plan.firstLinkedAt = createdAt;
      }
      if (!plan.lastLinkedAt || new Date(createdAt) > new Date(plan.lastLinkedAt)) {
        plan.lastLinkedAt = createdAt;
      }
    } else if (eventType === 'APPOINTMENT_UNLINKED') {
      if (!plan.lastUnlinkedAt || new Date(createdAt) > new Date(plan.lastUnlinkedAt)) {
        plan.lastUnlinkedAt = createdAt;
      }
    } else if (eventType === 'PLAN_COMPLETED') {
      plan.isCompleted = true;
    }
  }

  return plans;
}

/**
 * Private planned item eligible for Commitment Rate (excludes NHS treatments).
 *
 * @param {{ value: number, treatmentType: string | null, treatmentId: string | null }} item
 */
function isEligiblePrivatePlanItem(item) {
  const value = num(item.value);
  if (value <= 0) return false;
  if (!item.treatmentId) return false;
  if (item.treatmentType === 'nhs') return false;
  if (item.treatmentType !== 'private') return false;
  return true;
}

/**
 * @param {Map<string, object>} plans
 * @param {Array<{ planId: string, value: number, treatmentType: string | null, treatmentId: string | null, practitionerExtId?: string | null }>} items
 * @param {number} windowDays
 */
function computeCommitmentRateForItemSet(plans, items, windowDays) {
  const window = Math.max(1, Math.round(num(windowDays)) || DEFAULT_COMMITMENT_RATE_WINDOW_DAYS);

  let totalEligibleValue = 0;
  let committedValueWithinWindow = 0;
  let eligibleItemCount = 0;
  let committedItemCount = 0;

  for (const item of items) {
    if (!isEligiblePrivatePlanItem(item)) continue;

    const plan = plans.get(item.planId);
    if (!plan?.planCreatedAt) continue;

    const value = num(item.value);
    totalEligibleValue += value;
    eligibleItemCount += 1;

    if (plan.firstLinkedAt) {
      const days = daysBetweenUtc(plan.planCreatedAt, plan.firstLinkedAt);
      if (days <= window) {
        committedValueWithinWindow += value;
        committedItemCount += 1;
      }
    }
  }

  const commitmentRate =
    totalEligibleValue > 0 ? committedValueWithinWindow / totalEligibleValue : 0;

  return {
    commitmentRate,
    windowDays: window,
    totalEligibleValue: Math.round(totalEligibleValue * 100) / 100,
    committedValueWithinWindow: Math.round(committedValueWithinWindow * 100) / 100,
    eligibleItemCount,
    committedItemCount,
  };
}

/**
 * @param {Map<string, object>} plans
 * @param {Array<{ planId: string, value: number, treatmentType: string | null, treatmentId: string | null, practitionerExtId?: string | null }>} items
 * @param {number} windowDays
 */
function computePracticeCommitmentRate(plans, items, windowDays) {
  return computeCommitmentRateForItemSet(plans, items, windowDays);
}

/**
 * @param {Map<string, object>} plans
 * @param {Array<object>} items
 * @param {number[]} [windows]
 */
function computeCommitmentRatesByWindows(plans, items, windows = STANDARD_COMMITMENT_WINDOWS) {
  return windows.map((w) => computeCommitmentRateForItemSet(plans, items, w));
}

/**
 * Per-clinician commitment using tpi_practitioner_id (Dentally external id) on plan items.
 *
 * @param {Map<string, object>} plans
 * @param {Array<{ planId: string, value: number, treatmentType: string | null, treatmentId: string | null, practitionerExtId?: string | null }>} items
 * @param {number} windowDays
 */
function computeCommitmentRateByClinician(plans, items, windowDays) {
  const byExtId = new Map();
  const unattributed = [];

  for (const item of items) {
    if (!isEligiblePrivatePlanItem(item)) continue;
    const plan = plans.get(item.planId);
    if (!plan?.planCreatedAt) continue;

    const extId =
      item.practitionerExtId != null && String(item.practitionerExtId).trim() !== ''
        ? String(item.practitionerExtId).trim()
        : null;

    if (!extId) {
      unattributed.push(item);
      continue;
    }

    let group = byExtId.get(extId);
    if (!group) {
      group = [];
      byExtId.set(extId, group);
    }
    group.push(item);
  }

  const rows = [];

  for (const [extId, groupItems] of byExtId) {
    const result = computeCommitmentRateForItemSet(plans, groupItems, windowDays);
    rows.push({
      practitionerExtId: extId,
      ...result,
    });
  }

  if (unattributed.length > 0) {
    const result = computeCommitmentRateForItemSet(plans, unattributed, windowDays);
    rows.push({
      practitionerExtId: null,
      ...result,
    });
  }

  rows.sort((a, b) => b.totalEligibleValue - a.totalEligibleValue);
  return rows;
}

function computeCommitmentConfidence(result) {
  if (result.eligibleItemCount <= 0 || result.totalEligibleValue <= 0) return 0;
  const itemFactor = Math.min(result.eligibleItemCount / 10, 1);
  const valueFactor = Math.min(result.totalEligibleValue / 5000, 1);
  return Math.round(25 + 75 * Math.min(itemFactor, valueFactor));
}

function formatCommitmentTierNote(result) {
  const pct = Math.round(result.commitmentRate * 100);
  return (
    `Commitment Rate ${pct}%: £${result.committedValueWithinWindow.toLocaleString('en-GB')} scheduled within ` +
    `${result.windowDays}d ÷ £${result.totalEligibleValue.toLocaleString('en-GB')} eligible private planned ` +
    `(${result.eligibleItemCount} item(s), ${result.committedItemCount} within window). ` +
    'Private-only — NHS treatment items excluded.'
  );
}

function isOpenOpportunityPlan(plan) {
  if (plan.isCompleted) return false;
  if (!plan.planCreatedAt) return false;
  return isCurrentlyUnscheduled(plan.lastLinkedAt, plan.lastUnlinkedAt);
}

/**
 * Weight open pipeline using practice Commitment Rate (value-weighted probability).
 */
function weightOpenPlansByCommitmentRate(plans, commitmentResult) {
  const rate = Math.max(0, Math.min(1, commitmentResult.commitmentRate));
  const confidence = computeCommitmentConfidence(commitmentResult);
  const tierNote = formatCommitmentTierNote(commitmentResult);
  const byPatient = new Map();

  for (const plan of plans.values()) {
    if (!isOpenOpportunityPlan(plan)) continue;

    const grossValue = plan.plannedValue > 0 ? plan.plannedValue : 0;
    if (grossValue <= 0) continue;

    const weightedValue = grossValue * rate;
    const pid = plan.patientId;

    let entry = byPatient.get(pid);
    if (!entry) {
      entry = {
        gross: 0,
        weighted: 0,
        confidence,
        tierNote,
        planCount: 0,
      };
      byPatient.set(pid, entry);
    }

    entry.gross += grossValue;
    entry.weighted += weightedValue;
    entry.planCount += 1;
  }

  for (const entry of byPatient.values()) {
    entry.gross = Math.round(entry.gross * 100) / 100;
    entry.weighted = Math.round(entry.weighted * 100) / 100;
  }

  return { byPatient, commitmentResult, confidence, tierNote };
}

module.exports = {
  DEFAULT_COMMITMENT_RATE_WINDOW_DAYS,
  STANDARD_COMMITMENT_WINDOWS,
  aggregatePlansFromLedger,
  daysBetweenUtc,
  isEligiblePrivatePlanItem,
  computeCommitmentRateForItemSet,
  computePracticeCommitmentRate,
  computeCommitmentRatesByWindows,
  computeCommitmentRateByClinician,
  computeCommitmentConfidence,
  formatCommitmentTierNote,
  weightOpenPlansByCommitmentRate,
  isOpenOpportunityPlan,
};
