/**
 * Pure helpers for Treatment Economic Journey™ aggregation from event_ledger rows.
 */

const JOURNEY_STAGES = [
  { key: 'planned', label: 'Planned', eventType: 'PLAN_CREATED' },
  { key: 'scheduled', label: 'Scheduled', eventType: 'APPOINTMENT_LINKED' },
  { key: 'started', label: 'Started', eventType: 'TREATMENT_STARTED' },
  { key: 'completed', label: 'Completed', eventType: 'PLAN_COMPLETED' },
  { key: 'charged', label: 'Charged', eventType: 'INVOICE_RAISED' },
  { key: 'collected', label: 'Collected', eventType: 'PAYMENT_ALLOCATED' },
];

const FUNNEL_EVENT_TYPES = JOURNEY_STAGES.map((s) => s.eventType);

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normalizeBigInt(value) {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

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

function payloadPtId(payload) {
  if (!payload || typeof payload !== 'object') return null;
  for (const key of [
    'pt_id',
    'tp_patient_id',
    'ta_patient_id',
    'tpi_patient_id',
    'dp_patient_id',
  ]) {
    const ptId = normalizeBigInt(payload[key]);
    if (ptId != null) return ptId;
  }
  return null;
}

function emptyBuckets() {
  const byType = new Map();
  for (const t of FUNNEL_EVENT_TYPES) {
    byType.set(t, { eventCount: 0, valueGbp: 0 });
  }
  return byType;
}

function rowMatchesLocationScope(row, patientIdSet, ptIdSet, locationId = null) {
  if (locationId) {
    return row.location_id != null && String(row.location_id) === String(locationId);
  }
  if (!patientIdSet && !ptIdSet) return true;

  if (row.patient_id != null && patientIdSet?.has(String(row.patient_id))) {
    return true;
  }

  const ptId = payloadPtId(row.payload);
  if (ptId != null && ptIdSet?.has(ptId)) return true;

  return false;
}

function aggregateFunnelRows(rows, byType, scheduledPlanValue) {
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
}

function buildJourneyResult(
  byType,
  scheduledPlanValue,
  minPlannedEvents,
  minTotalFunnelEvents,
) {
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
  const plannedEventCount =
    stages.find((s) => s.key === 'planned')?.eventCount ?? 0;
  const isBackfilling =
    plannedEventCount < minPlannedEvents || totalEvents < minTotalFunnelEvents;

  return { stages, totalEvents, plannedEventCount, isBackfilling };
}

function mapJourneyRpcResult(raw) {
  const payload = raw && typeof raw === 'object' ? raw : {};
  const stages = Array.isArray(payload.stages) ? payload.stages : [];

  return {
    stages: stages.map((stage) => ({
      key: String(stage.key ?? ''),
      label: String(stage.label ?? ''),
      eventType: String(stage.eventType ?? ''),
      eventCount: num(stage.eventCount),
      valueGbp: num(stage.valueGbp),
    })),
    totalEvents: num(payload.totalEvents),
    plannedEventCount: num(payload.plannedEventCount),
    isBackfilling: Boolean(payload.isBackfilling),
  };
}

module.exports = {
  JOURNEY_STAGES,
  FUNNEL_EVENT_TYPES,
  payloadGbp,
  payloadPtId,
  emptyBuckets,
  rowMatchesLocationScope,
  aggregateFunnelRows,
  buildJourneyResult,
  mapJourneyRpcResult,
};
