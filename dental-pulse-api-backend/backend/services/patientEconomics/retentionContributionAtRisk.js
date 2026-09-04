/**
 * Retention & Reactivation — contribution rollup by 4-tier segment.
 *
 * Sums patient-level contribution from v_patient_contribution grouped by
 * retention_status (pe_retention_status). Practice and group rollups.
 */

const { supabaseAdmin } = require('../../config/supabase');
const { resolvePeRollupUnits } = require('./peRollupUnits');
const { loadPatientUuidsForLocation } = require('./peLocationScope');
const {
  parseRetentionStatus,
  retentionStatusLabel,
} = require('./peRetentionSegmentation');

const PAGE_SIZE = 1000;
const { withPeReadCache } = require('./peReadCache');

const SEGMENT_ORDER = ['active', 'drifting', 'lapsed', 'effectively_lost'];
const AT_RISK_STATUSES = new Set(['drifting', 'lapsed', 'effectively_lost']);

const DERIVED_TIER = 'Derived';
const TIER_NOTE =
  'Sum of invoice contribution on v_patient_contribution per retention segment (pe_retention_status). Segmentation thresholds are Modelled; contribution £ is Derived.';

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function rollupFromContributionRows(rows) {
  const buckets = Object.fromEntries(
    SEGMENT_ORDER.map((status) => [status, { patientCount: 0, contributionGbp: 0 }]),
  );

  for (const row of rows) {
    const status = parseRetentionStatus(row.retention_status);
    if (!buckets[status]) continue;
    buckets[status].patientCount += 1;
    buckets[status].contributionGbp += num(row.contribution);
  }

  const segments = SEGMENT_ORDER.map((status) => ({
    status,
    label: retentionStatusLabel(status),
    patientCount: buckets[status].patientCount,
    contributionGbp: round2(buckets[status].contributionGbp),
  }));

  const totalContributionGbp = round2(
    segments.reduce((sum, s) => sum + s.contributionGbp, 0),
  );
  const totalPatientCount = segments.reduce((sum, s) => sum + s.patientCount, 0);
  const atRiskContributionGbp = round2(
    segments
      .filter((s) => AT_RISK_STATUSES.has(s.status))
      .reduce((sum, s) => sum + s.contributionGbp, 0),
  );
  const atRiskPatientCount = segments
    .filter((s) => AT_RISK_STATUSES.has(s.status))
    .reduce((sum, s) => sum + s.patientCount, 0);

  return {
    segments,
    totalContributionGbp,
    totalPatientCount,
    atRiskContributionGbp,
    atRiskPatientCount,
    tier: DERIVED_TIER,
    tierNote: TIER_NOTE,
  };
}

async function loadUserPracticeIds(userId) {
  const { data, error } = await supabaseAdmin
    .from('user_roles')
    .select('organization_id')
    .eq('user_id', userId);

  if (error) throw new Error(`user_roles: ${error.message}`);

  return [
    ...new Set(
      (data ?? [])
        .map((r) => r.organization_id)
        .filter((id) => typeof id === 'string' && id.length > 0),
    ),
  ];
}

async function loadPracticeNames(practiceIds) {
  const map = new Map();
  if (practiceIds.length === 0) return map;

  const { data, error } = await supabaseAdmin
    .from('organizations')
    .select('id, name')
    .in('id', practiceIds);

  if (error) throw new Error(`organizations: ${error.message}`);

  for (const row of data ?? []) {
    map.set(String(row.id), String(row.name || 'Practice').trim() || 'Practice');
  }
  return map;
}

function rollupFromSegmentRpc(segments) {
  const buckets = Object.fromEntries(
    SEGMENT_ORDER.map((status) => [status, { patientCount: 0, contributionGbp: 0 }]),
  );

  for (const seg of segments ?? []) {
    const status = parseRetentionStatus(seg.retention_status);
    if (!buckets[status]) continue;
    buckets[status].patientCount += num(seg.patient_count);
    buckets[status].contributionGbp += num(seg.contribution_gbp);
  }

  const segmentRows = SEGMENT_ORDER.map((status) => ({
    status,
    label: retentionStatusLabel(status),
    patientCount: buckets[status].patientCount,
    contributionGbp: round2(buckets[status].contributionGbp),
  }));

  const totalContributionGbp = round2(
    segmentRows.reduce((sum, s) => sum + s.contributionGbp, 0),
  );
  const totalPatientCount = segmentRows.reduce((sum, s) => sum + s.patientCount, 0);
  const atRiskContributionGbp = round2(
    segmentRows
      .filter((s) => AT_RISK_STATUSES.has(s.status))
      .reduce((sum, s) => sum + s.contributionGbp, 0),
  );
  const atRiskPatientCount = segmentRows
    .filter((s) => AT_RISK_STATUSES.has(s.status))
    .reduce((sum, s) => sum + s.patientCount, 0);

  return {
    segments: segmentRows,
    totalContributionGbp,
    totalPatientCount,
    atRiskContributionGbp,
    atRiskPatientCount,
    tier: DERIVED_TIER,
    tierNote: TIER_NOTE,
  };
}

async function loadSegmentRollupFromRpc(practiceId, scope = {}) {
  const locationId = scope.locationId || null;
  const { data, error } = await supabaseAdmin.rpc('pe_retention_segment_rollup', {
    p_practice_id: practiceId,
    p_location_id: locationId,
    p_start_date: scope.startDate || null,
    p_end_date: scope.endDate || null,
  });
  if (error) throw new Error(`pe_retention_segment_rollup: ${error.message}`);
  return rollupFromSegmentRpc(data);
}

async function loadContributionRowsForPractice(practiceId, locationId = null) {
  if (!locationId) {
    const rows = [];
    const tables = ['pe_patient_contribution_facts', 'v_pe_retention_segment'];

    for (const table of tables) {
      let offset = 0;
      let found = false;

      for (let i = 0; i < 200; i++) {
        const { data, error } = await supabaseAdmin
          .from(table)
          .select('patient_id, retention_status, contribution')
          .eq('practice_id', practiceId)
          .range(offset, offset + PAGE_SIZE - 1);

        if (error && error.code === '42P01') break;
        if (error) throw new Error(`${table}: ${error.message}`);

        const batch = data ?? [];
        if (batch.length > 0) found = true;
        rows.push(...batch);
        if (batch.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
      }

      if (found) return rows;
    }

    return rows;
  }

  const rows = [];
  const patientUuids = await loadPatientUuidsForLocation(practiceId, locationId);

  if (patientUuids.length === 0) return rows;

  const tables = ['pe_patient_contribution_facts', 'v_patient_contribution'];
  const { queryInPatientChunks } = require('./pePatientQueryChunks');

  for (const table of tables) {
    const chunkRows = await queryInPatientChunks(patientUuids, (chunk) =>
      supabaseAdmin
        .from(table)
        .select('retention_status, contribution')
        .eq('practice_id', practiceId)
        .in('patient_id', chunk),
    );

    if (chunkRows.length > 0) {
      return chunkRows;
    }
  }

  return rows;
}

async function rollupPractice(practiceId, scope = {}) {
  const { scopeCacheExtra } = require('./peReadScope');
  return withPeReadCache(
    'retention-segment-rollup',
    practiceId,
    () => loadSegmentRollupFromRpc(practiceId, scope),
    { extra: scopeCacheExtra(scope) },
  );
}

function rollupGroupFromPracticeRollups(practiceRollups) {
  const buckets = Object.fromEntries(
    SEGMENT_ORDER.map((status) => [status, { patientCount: 0, contributionGbp: 0 }]),
  );

  for (const rollup of practiceRollups) {
    for (const seg of rollup.segments) {
      buckets[seg.status].patientCount += seg.patientCount;
      buckets[seg.status].contributionGbp += seg.contributionGbp;
    }
  }

  const segments = SEGMENT_ORDER.map((status) => ({
    status,
    label: retentionStatusLabel(status),
    patientCount: buckets[status].patientCount,
    contributionGbp: round2(buckets[status].contributionGbp),
  }));

  const totalContributionGbp = round2(
    segments.reduce((sum, s) => sum + s.contributionGbp, 0),
  );
  const totalPatientCount = segments.reduce((sum, s) => sum + s.patientCount, 0);
  const atRiskContributionGbp = round2(
    segments
      .filter((s) => AT_RISK_STATUSES.has(s.status))
      .reduce((sum, s) => sum + s.contributionGbp, 0),
  );
  const atRiskPatientCount = segments
    .filter((s) => AT_RISK_STATUSES.has(s.status))
    .reduce((sum, s) => sum + s.patientCount, 0);

  return {
    segments,
    totalContributionGbp,
    totalPatientCount,
    atRiskContributionGbp,
    atRiskPatientCount,
    tier: DERIVED_TIER,
    tierNote: TIER_NOTE,
  };
}

/**
 * Practice + group contribution rollups for Retention & Reactivation.
 * @param {string} userId
 * @param {string} practiceId — context practice (must be in user's orgs)
 */
async function getRetentionContributionAtRisk(userId, practiceId, scope = {}) {
  const { rollupMode, units: allUnits } = await resolvePeRollupUnits(userId, practiceId);

  let units = allUnits;
  if (scope.locationId) {
    units = allUnits.filter(
      (u) => u.locationId === scope.locationId || u.unitId === scope.locationId,
    );
  }

  const practiceRollups = await Promise.all(
    units.map(async (unit) => {
      try {
        const unitScope = {
          ...scope,
          locationId: scope.locationId || unit.locationId || null,
        };
        const rollup = await rollupPractice(unit.organizationId, unitScope);
        return {
          unitId: unit.unitId,
          unitName: unit.unitName,
          unitType: unit.unitType,
          organizationId: unit.organizationId,
          rollup,
        };
      } catch (err) {
        console.warn(`[RetentionAtRisk] unit ${unit.unitId} rollup failed:`, err.message);
        return {
          unitId: unit.unitId,
          unitName: unit.unitName,
          unitType: unit.unitType,
          organizationId: unit.organizationId,
          rollup: rollupFromContributionRows([]),
        };
      }
    }),
  );

  const contextUnit =
    practiceRollups.find((p) => p.unitId === practiceId) ??
    practiceRollups.find((p) => p.unitId === scope.locationId) ??
    practiceRollups.find((p) => p.organizationId === practiceId) ??
    practiceRollups[0];

  const contextRollup = contextUnit?.rollup ?? rollupFromContributionRows([]);

  const groupRollup = rollupGroupFromPracticeRollups(practiceRollups.map((p) => p.rollup));

  const practices = practiceRollups.map(({ unitId, unitName, unitType, organizationId, rollup }) => ({
    practiceId: unitId,
    practiceName: unitName,
    unitType,
    organizationId,
    ...rollup,
  }));

  const hasData =
    contextRollup.totalPatientCount > 0 ||
    groupRollup.totalPatientCount > 0;

  return {
    practiceId,
    practiceName: contextUnit?.unitName || 'This practice',
    rollupMode,
    practice: {
      practiceId: contextUnit?.unitId ?? practiceId,
      practiceName: contextUnit?.unitName || 'This practice',
      unitType: contextUnit?.unitType ?? 'practice',
      organizationId: contextUnit?.organizationId ?? practiceId,
      ...contextRollup,
    },
    group: {
      ...groupRollup,
      practiceCount: practices.length,
      rollupUnitCount: practices.length,
      practices,
    },
    hasData,
  };
}

module.exports = {
  getRetentionContributionAtRisk,
  SEGMENT_ORDER,
};
