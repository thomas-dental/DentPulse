/**
 * Treatment Economic Journey™ — aggregate event_ledger funnel stages for a practice.
 * Same rules as the former frontend hook: count + payload £, Scheduled dedupe by plan_id.
 */

const { supabaseAdmin } = require('../../config/supabase');

const JOURNEY_STAGES = [
  { key: 'planned', label: 'Planned', eventType: 'PLAN_CREATED' },
  { key: 'scheduled', label: 'Scheduled', eventType: 'APPOINTMENT_LINKED' },
  { key: 'started', label: 'Started', eventType: 'TREATMENT_STARTED' },
  { key: 'completed', label: 'Completed', eventType: 'PLAN_COMPLETED' },
  { key: 'charged', label: 'Charged', eventType: 'INVOICE_RAISED' },
  { key: 'collected', label: 'Collected', eventType: 'PAYMENT_ALLOCATED' },
];

const FUNNEL_EVENT_TYPES = JOURNEY_STAGES.map((s) => s.eventType);

const MIN_PLANNED_EVENTS = 5;
const MIN_TOTAL_FUNNEL_EVENTS = 10;

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Same COALESCE / NULLIF('',) order as the verification SQL / former FE hook. */
function payloadGbp(payload) {
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
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

/**
 * @param {string} practiceId organizations.id
 * @returns {Promise<{
 *   stages: Array<{ key: string, label: string, eventType: string, eventCount: number, valueGbp: number }>,
 *   totalEvents: number,
 *   plannedEventCount: number,
 *   isBackfilling: boolean,
 * }>}
 */
async function getTreatmentEconomicJourney(practiceId) {
  const byType = new Map();
  for (const t of FUNNEL_EVENT_TYPES) {
    byType.set(t, { eventCount: 0, valueGbp: 0 });
  }
  // Scheduled £ is plan-scoped: one plan may have many APPOINTMENT_LINKED rows.
  const scheduledPlanValue = new Map();

  const pageSize = 1000;
  let offset = 0;

  for (let i = 0; i < 500; i++) {
    const { data, error } = await supabaseAdmin
      .from('event_ledger')
      .select('event_type, payload')
      .eq('practice_id', practiceId)
      .in('event_type', FUNNEL_EVENT_TYPES)
      .range(offset, offset + pageSize - 1);

    if (error) {
      const err = new Error(error.message || 'Failed to load event_ledger');
      err.code = error.code;
      throw err;
    }

    const rows = data || [];
    if (rows.length === 0) break;

    for (const row of rows) {
      const bucket = byType.get(row.event_type);
      if (!bucket) continue;
      bucket.eventCount += 1;
      const gbp = payloadGbp(row.payload);

      if (row.event_type === 'APPOINTMENT_LINKED') {
        const p =
          row.payload && typeof row.payload === 'object' ? row.payload : {};
        const planKey = String(p.plan_id ?? p.ta_treatment_plan_id ?? '');
        if (planKey && planKey !== 'null' && planKey !== 'undefined') {
          const prev = scheduledPlanValue.get(planKey) ?? 0;
          if (gbp > prev) scheduledPlanValue.set(planKey, gbp);
        } else {
          bucket.valueGbp += gbp;
        }
      } else {
        bucket.valueGbp += gbp;
      }
    }

    if (rows.length < pageSize) break;
    offset += pageSize;
  }

  const scheduledBucket = byType.get('APPOINTMENT_LINKED');
  if (scheduledBucket) {
    let planSum = 0;
    for (const v of scheduledPlanValue.values()) planSum += v;
    scheduledBucket.valueGbp += planSum;
  }

  const stages = JOURNEY_STAGES.map((s) => {
    const bucket = byType.get(s.eventType);
    return {
      key: s.key,
      label: s.label,
      eventType: s.eventType,
      eventCount: bucket.eventCount,
      valueGbp: Math.round(bucket.valueGbp * 100) / 100,
    };
  });

  const totalEvents = stages.reduce((sum, s) => sum + s.eventCount, 0);
  const plannedEventCount = stages.find((s) => s.key === 'planned')?.eventCount ?? 0;
  const isBackfilling =
    plannedEventCount < MIN_PLANNED_EVENTS || totalEvents < MIN_TOTAL_FUNNEL_EVENTS;

  return { stages, totalEvents, plannedEventCount, isBackfilling };
}

module.exports = {
  JOURNEY_STAGES,
  getTreatmentEconomicJourney,
  payloadGbp,
};
