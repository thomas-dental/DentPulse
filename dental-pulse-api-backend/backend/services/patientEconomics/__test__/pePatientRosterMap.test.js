/**
 * Unit tests for SQL-first PE patient roster mappers.
 *
 * Run: node backend/services/patientEconomics/__test__/pePatientRosterMap.test.js
 */

const assert = require('assert');
const {
  mapRosterPageRow,
  mapRosterSummaryRpc,
  isRosterPageDisplayable,
} = require('../pePatientRosterMap');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

console.log('pePatientRosterMap\n');

test('isRosterPageDisplayable hides orphans (null patient_id)', () => {
  assert.strictEqual(isRosterPageDisplayable({ patient_id: null, pt_id: 1 }), false);
  assert.strictEqual(isRosterPageDisplayable({ patient_id: 'aaa', pt_id: 1 }), true);
});

test('mapRosterPageRow returns null for orphan RPC rows', () => {
  assert.strictEqual(mapRosterPageRow({ patient_id: null, pt_id: 99 }, 'Practice'), null);
});

test('mapRosterPageRow maps page fields and window metrics', () => {
  const row = mapRosterPageRow(
    {
      patient_id: '11111111-1111-1111-1111-111111111111',
      pt_id: 42,
      patient_name: 'Ada Lovelace',
      patient_uuid: 'dentally-uuid',
      location_id: '22222222-2222-2222-2222-222222222222',
      location_name: 'Main Site',
      is_active: true,
      has_payment_plan: true,
      retention_status: 'drifting',
      contribution: 100.5,
      revenue_private_plan: 200,
      invoice_count: 3,
      confidence_score: 90,
      clinician_cost: 10,
      direct_cost: 20,
      margin_pct: 50.3,
      contribution_12mo: 80,
      visits_12mo: 4,
      visit_freq_per_year: 4,
      value_per_visit: 20,
      opportunity_gross: 500,
      quality_score: 70,
      patient_economic_value: 100.5,
      cltv_projection: 1200,
      cltv_tier: 'Modelled',
      quality_score_tier: 'Modelled',
      modelled_confidence_score: 80,
      modelled_computed_at: '2026-09-01T00:00:00Z',
    },
    'St Catherines',
  );

  assert.strictEqual(row.patientId, '11111111-1111-1111-1111-111111111111');
  assert.strictEqual(row.patientName, 'Ada Lovelace');
  assert.strictEqual(row.ptId, 42);
  assert.strictEqual(row.locationName, 'Main Site');
  assert.strictEqual(row.isActive, true);
  assert.strictEqual(row.hasPaymentPlan, true);
  assert.strictEqual(row.retentionStatus, 'drifting');
  assert.strictEqual(row.contribution, 100.5);
  assert.strictEqual(row.contribution12mo, 80);
  assert.strictEqual(row.visits12mo, 4);
  assert.strictEqual(row.visitFreqPerYear, 4);
  assert.strictEqual(row.valuePerVisit, 20);
  assert.strictEqual(row.opportunityGross, 500);
  assert.strictEqual(row.invoicesWithRevenue, 0);
  assert.strictEqual(row.opportunityWeighted, 0);
  assert.strictEqual(row.practiceName, 'St Catherines');
  assert.strictEqual(row.cltvProjection, 1200);
});

test('mapRosterPageRow maps financial overlay columns when present', () => {
  const row = mapRosterPageRow(
    {
      patient_id: '11111111-1111-1111-1111-111111111111',
      pt_id: 1,
      patient_name: 'Ada',
      contribution: 10,
      invoices_with_revenue: 2,
      invoices_complete: 2,
      invoices_partial_no_practitioner: 0,
      invoices_partial_missing_rate: 0,
      pct_complete: 100,
      contribution_provenance_status: 'complete',
      revenue_tier: 'Dentally',
      opportunity_weighted: 75.5,
      recommended_action: 'recall_follow_up',
    },
    'Practice',
  );
  assert.strictEqual(row.invoicesWithRevenue, 2);
  assert.strictEqual(row.pctComplete, 100);
  assert.strictEqual(row.opportunityWeighted, 75.5);
  assert.strictEqual(row.recommendedAction, 'recall_follow_up');
});

test('mapRosterSummaryRpc separates table totals from KPI totals (orphans in KPIs)', () => {
  const mapped = mapRosterSummaryRpc({
    matched_total: 10,
    matched_unfiltered: 40,
    total_patients: 12, // includes 2 orphans in filtered KPI set
    active_patients: 8,
    retention_active_count: 5,
    retention_drifting_count: 3,
    retention_lapsed_count: 2,
    retention_effectively_lost_count: 2,
    private_plan_patients: 4,
    member_patients: 2,
    private_type_patients: 2,
    nhs_type_patients: 6,
    average_contribution: 11.5,
    average_projected_ltv: 99,
    baseline_total_patients: 50,
    baseline_active_patients: 30,
    baseline_retention_active_count: 20,
    baseline_retention_drifting_count: 10,
    baseline_retention_lapsed_count: 10,
    baseline_retention_effectively_lost_count: 10,
    baseline_private_plan_patients: 15,
    baseline_member_patients: 5,
    baseline_private_type_patients: 10,
    baseline_nhs_type_patients: 25,
    baseline_average_contribution: 20,
    baseline_average_projected_ltv: 200,
  });

  // Table pagination uses matched counts only (orphans excluded).
  assert.strictEqual(mapped.matchedTotal, 10);
  assert.strictEqual(mapped.matchedUnfiltered, 40);
  // Summary KPIs include orphans (12 > 10).
  assert.strictEqual(mapped.summary.totalPatients, 12);
  assert.strictEqual(mapped.summary.averageContribution, 11.5);
  assert.strictEqual(mapped.baselineSummary.totalPatients, 50);
  assert.ok(mapped.summary.totalPatients > mapped.matchedTotal);
});

test('mapRosterSummaryRpc handles empty payload', () => {
  const mapped = mapRosterSummaryRpc(null);
  assert.strictEqual(mapped.matchedTotal, 0);
  assert.strictEqual(mapped.summary.totalPatients, 0);
  assert.strictEqual(mapped.baselineSummary.totalPatients, 0);
});

console.log(`\n${passed} tests passed`);
